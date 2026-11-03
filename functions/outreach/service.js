"use strict";

/**
 * functions/outreach/service.js
 *
 * «Ve por los tuyos» (doc 40) · backend H3b. Cuatro grupos de callables
 * (`outreachCoordinatorOp`, `outreachFollowupOp`, `outreachTableOp`,
 * `outreachDecisionOp`); cada operación es un método del servicio y se prueba
 * por separado. El dominio puro viene de lib/shared/outreach-*.ts compilado a
 * functions/shared/outreach-*.js: aquí NO se reimplementa.
 *
 * Reglas transversales (mismo patrón que el servicio de Integrantes):
 * - Inyectable: `store` (firestore-store.js o memoria), `clock`, `logger`.
 * - Auth + permiso con `can()` (admin implícito). La mesa NO tiene sesión: el
 *   token (43 car. base64url) viaja en el cuerpo (POST), se guarda solo su
 *   SHA-256 en `outreachEditions/{e}/tableSecrets/{n}` y se compara en tiempo
 *   constante. Nunca se loguea ni se guarda en claro.
 * - Idempotencia por requestId (ids deterministas) y por (system, externalId).
 * - Concurrencia: `expectedRevision` → `outreach/conflict`; asignaciones
 *   re-verificadas DENTRO de la transacción.
 * - Las decisiones de fe jamás aparecen en contactos, cola de salida ni
 *   auditoría de coordinación; solo en `outreachDecisions` (+ historial).
 * - Nunca escribe `members*` ni Finanzas (el traspaso queda fuera de H3).
 * - Errores: HttpsError con message = clave `outreach/*`; los inesperados se
 *   registran solo como { method, name, code } y salen como `outreach/internal`.
 */

const crypto = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { can } = require("../shared/access");
const { localNow, localToday } = require("../shared/dates");
const { normalizePhone } = require("../shared/members");
const model = require("../shared/outreach-model");
const tablesDomain = require("../shared/outreach-tables");
const syncDomain = require("../shared/outreach-sync");
const dist = require("../shared/outreach-distribution");
const metricsDomain = require("../shared/outreach-metrics");
const outboxDomain = require("../shared/outreach-outbox");
const { generateShareToken, hashShareToken, isWellFormedShareToken } = require("../calendar/share-token");
const { parse, sizeOf } = require("./parse");

const PERM = Object.freeze({
  coordinate: "members.outreach.coordinate",
  followup: "members.outreach.followup_assigned",
  decisions: "members.outreach.decisions",
});

const C = Object.freeze({
  editions: "outreachEditions",
  regs: "outreachRegistrations",
  decisions: "outreachDecisions",
  batches: "outreachAssignmentBatches",
  marks: "outreachTableMarks",
  inbox: "outreachInbox",
  outbox: "outreachOutbox",
});

const OUTREACH_ERROR_KEYS = Object.freeze({
  unauthenticated: "outreach/unauthenticated",
  forbidden: "outreach/forbidden",
  invalidArgument: "outreach/invalid-argument",
  payloadTooLarge: "outreach/payload-too-large",
  notFound: "outreach/not-found",
  conflict: "outreach/conflict",
  requestReused: "outreach/request-reused",
  editionClosed: "outreach/edition-closed",
  invalidTransition: "outreach/invalid-transition",
  invalidUser: "outreach/invalid-user",
  invalidLeader: "outreach/invalid-leader",
  notAssigned: "outreach/not-assigned",
  linkUnavailable: "outreach/link-unavailable",
  linkRevoked: "outreach/link-revoked",
  linkOutOfWindow: "outreach/link-out-of-window",
  rateLimited: "outreach/rate-limited",
  internal: "outreach/internal",
});
const E = OUTREACH_ERROR_KEYS;

const COORDINATOR_OPS = Object.freeze([
  "editionCreate",
  "editionUpdate",
  "editionTransition",
  "teamSet",
  "tablesSet",
  "tableLinkIssue",
  "tableLinkRevoke",
  "importRegistrations",
  "confirmAbsences",
  "distributionPropose",
  "distributionConfirm",
  "reassign",
  "releaseAssignee",
  "stats",
]);
const FOLLOWUP_OPS = Object.freeze(["contactRecord", "doNotContactSet"]);
/** op público → método del servicio. */
const TABLE_OPS = Object.freeze({ search: "tableSearch", mark: "tableMark", unmark: "tableUnmark", addWalkIn: "tableAddWalkIn" });
const DECISION_OPS = Object.freeze(["decisionRecord", "decisionList", "decisionStats"]);

const EDITION_ACTIVE = new Set(["inscripcion", "evento", "seguimiento"]);
const CHUNK = 100;
const RATE_LIMIT = Object.freeze({ windowMs: 10 * 60 * 1000, max: 120 });
const SUPPRESS_BELOW = 5;
const SMALL = 4096;

const flagsFor = (status) => ({ editionActive: EDITION_ACTIVE.has(status), receptionOpen: status === "evento" });
const flagsOfDoc = (doc) => ({ editionActive: doc.editionActive === true, receptionOpen: doc.receptionOpen === true });

/** Quita `undefined` (Firestore no lo admite). */
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = clean(v);
    return out;
  }
  return value;
}

const sha = (text, n = 24) => crypto.createHash("sha256").update(text).digest("hex").slice(0, n);
const deterministicId = (uid, kind, requestId) => sha(`${uid}:${kind}:${requestId}`);
const sub = (editionId, name) => `${C.editions}/${editionId}/${name}`;
const regSub = (regId, name) => `${C.regs}/${regId}/${name}`;

/** Inscripción ↔ documento (el documento añade assigneeUid/editionActive/receptionOpen para las reglas). */
function regDoc(reg, flags) {
  return clean({ ...reg, tableNumber: reg.tableNumber ?? null, ticketCode: reg.ticketCode ?? null, assigneeUid: reg.ownerUid ?? null, ...flags });
}
function regFromDoc(doc) {
  const { assigneeUid, editionActive, receptionOpen, ...rest } = doc;
  void assigneeUid;
  void editionActive;
  void receptionOpen;
  return { ...rest, consents: rest.consents || [], locallyEdited: rest.locallyEdited || [], followUp: rest.followUp || { ...model.EMPTY_FOLLOW_UP } };
}
function decFromDoc(doc) {
  return {
    registrationId: doc.registrationId,
    editionId: doc.editionId,
    value: doc.value,
    declaredBy: doc.declaredBy,
    consentTextVersion: doc.consentTextVersion,
    recordedAt: doc.recordedAt,
    recordedBy: doc.recordedBy,
    tableNumber: doc.tableNumber ?? null,
  };
}
const decDoc = (record, assigneeUid, editionActive) => clean({ ...record, assigneeUid: assigneeUid ?? null, editionActive: editionActive === true });

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function safeName(userDoc) {
  const name = userDoc && typeof userDoc.displayName === "string" ? userDoc.displayName.replace(/\s+/g, " ").trim() : "";
  return !name || name.includes("@") ? "Usuario sin nombre" : name.slice(0, 120);
}

/** Error de dominio → HttpsError con clave estable. */
function domainFail(error, extra) {
  if (error === "no_asignada") return new HttpsError("permission-denied", E.notAssigned);
  if (error === "revision") return new HttpsError("aborted", E.conflict);
  if (error === "edicion_cerrada") return new HttpsError("failed-precondition", E.editionClosed);
  return new HttpsError("failed-precondition", `outreach/${String(error).replace(/_/g, "-")}`, extra);
}

const ROW_SPEC = Object.freeze({
  externalId: ["str", { max: 120 }],
  sourceRevision: ["int", { min: 0, max: Number.MAX_SAFE_INTEGER }],
  editionYear: ["int", { min: 2000, max: 2100 }],
  fullName: ["str", { max: 200, min: 0 }],
  phone: ["str", { max: 40, opt: true, min: 0 }],
  email: ["str", { max: 200, opt: true, min: 0 }],
  invitedByName: ["str", { max: 200, opt: true, min: 0 }],
  adultConfirmed: ["bool"],
  consents: ["list", { max: 3, of: { purpose: ["enum", { values: model.CONSENT_PURPOSES }], textVersion: ["str", { max: 40 }], grantedAt: ["str", { max: 32 }] } }],
  cancelled: ["bool"],
  attendedAt: ["str", { max: 32, opt: true, min: 0 }],
});

/**
 * @param {{
 *   store: {
 *     getUser(uid: string): Promise<object|null>,
 *     get(collection: string, id: string): Promise<object|null>,
 *     list(collection: string, opts?: { where?: Array<[string, string, unknown]>, limit?: number, afterId?: string|null }): Promise<Array<{ id: string, data: object }>>,
 *     serverTimestamp(): unknown,
 *     runTransaction(fn: (tx: object) => Promise<any>): Promise<any>,
 *   },
 *   clock: { now(): number },
 *   logger?: { error: Function },
 *   randomBytes?: (size: number) => Buffer,
 * }} deps
 */
function createOutreachService({ store, clock, logger = console, randomBytes }) {
  if (!store || !clock) throw new Error("createOutreachService: store y clock son obligatorios");

  const nowLocal = () => localNow(clock.now());
  const today = () => localToday(clock.now());

  // ---------- utilidades ----------

  async function authorize(uid, permissions) {
    if (!uid || typeof uid !== "string") throw new HttpsError("unauthenticated", E.unauthenticated);
    const userDoc = await store.getUser(uid);
    if (!permissions.some((p) => can(userDoc, p))) throw new HttpsError("permission-denied", E.forbidden);
    return userDoc;
  }

  function checkSize(data, max = SMALL) {
    if (sizeOf(data) > max) throw new HttpsError("invalid-argument", E.payloadTooLarge);
  }

  async function listAll(collection, where, cap = 5000) {
    const out = [];
    let afterId = null;
    while (out.length < cap) {
      const page = await store.list(collection, { where, limit: 500, afterId });
      out.push(...page);
      if (page.length < 500) break;
      afterId = page[page.length - 1].id;
    }
    return out;
  }

  async function loadEdition(tx, editionId) {
    const ed = await tx.get(C.editions, editionId);
    if (!ed) throw new HttpsError("not-found", E.notFound);
    return ed;
  }
  const assertOpen = (ed) => {
    if (ed.status === "cerrada") throw new HttpsError("failed-precondition", E.editionClosed);
  };

  async function loadReg(tx, editionId, regId) {
    const doc = await tx.get(C.regs, regId);
    if (!doc || doc.editionId !== editionId) throw new HttpsError("not-found", E.notFound);
    return doc;
  }

  function writeChange(tx, regId, revision, entry, actorUid) {
    tx.create(regSub(regId, "changes"), `r${revision}-${entry.action}`, {
      action: entry.action,
      fields: entry.fields || [],
      reason: entry.reason ?? null,
      revision,
      actorUid,
      at: store.serverTimestamp(),
    });
  }

  async function teamMembers(tx, editionId, uids) {
    const out = [];
    for (const uid of uids) {
      const m = await tx.get(sub(editionId, "team"), uid);
      if (m) out.push(m);
    }
    return out;
  }

  const editionSummary = (id, ed) => ({
    id,
    status: ed.status,
    revision: ed.revision,
    eventDate: ed.eventDate ?? null,
    title: ed.title,
    maxPerOwner: ed.maxPerOwner,
    editionActive: ed.editionActive === true,
    receptionOpen: ed.receptionOpen === true,
  });

  // =====================================================================
  // COORDINACIÓN
  // =====================================================================

  async function editionCreate(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data);
    const input = parse(data, {
      year: ["int", { min: 2000, max: 2100 }],
      title: ["str", { opt: true, max: 120 }],
      eventDate: ["ymd", { opt: true }],
      calendarEventId: ["id", { opt: true }],
      maxPerOwner: ["int", { opt: true, def: 20, min: 1, max: 100 }],
      copyTeamFrom: ["id", { opt: true }],
    });
    const id = model.editionIdFor(input.year);
    return store.runTransaction(async (tx) => {
      const existing = await tx.get(C.editions, id);
      if (existing) return { ...editionSummary(id, existing), replay: true };
      const previous = input.copyTeamFrom ? await tx.list(sub(input.copyTeamFrom, "team"), [], 100) : [];
      const copied = model.copyTeamStructure(previous.map((p) => p.data));
      const ed = {
        id,
        year: input.year,
        title: input.title || `Ve por los tuyos ${input.year}`,
        eventDate: input.eventDate,
        status: "preparacion",
        calendarEventId: input.calendarEventId,
        maxPerOwner: input.maxPerOwner,
        teamCopiedFrom: input.copyTeamFrom,
        revision: 1,
        syncCursor: 0,
        denorm: null,
        ...flagsFor("preparacion"),
        createdBy: uid,
        createdAt: store.serverTimestamp(),
      };
      tx.create(C.editions, id, clean(ed));
      for (const m of copied) tx.set(sub(id, "team"), m.uid, clean({ ...m, updatedAt: store.serverTimestamp() }));
      return { ...editionSummary(id, ed), replay: false, copiedTeam: copied.length };
    });
  }

  async function editionUpdate(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data);
    const input = parse(data, {
      editionId: ["id"],
      expectedRevision: ["int", { min: 1 }],
      title: ["str", { opt: true, max: 120 }],
      eventDate: ["ymd", { opt: true }],
      calendarEventId: ["id", { opt: true }],
      maxPerOwner: ["int", { opt: true, min: 1, max: 100 }],
    });
    return store.runTransaction(async (tx) => {
      const ed = await loadEdition(tx, input.editionId);
      assertOpen(ed);
      const patch = {};
      for (const k of ["title", "eventDate", "calendarEventId", "maxPerOwner"]) if (input[k] !== null && input[k] !== ed[k]) patch[k] = input[k];
      if (Object.keys(patch).length === 0) return { ...editionSummary(input.editionId, ed), replay: true };
      if (ed.revision !== input.expectedRevision) throw new HttpsError("aborted", E.conflict);
      const next = { ...ed, ...patch, revision: ed.revision + 1 };
      tx.update(C.editions, input.editionId, clean({ ...patch, revision: next.revision }));
      return { ...editionSummary(input.editionId, next), replay: false };
    });
  }

  /** Reaplica `editionActive`/`receptionOpen` a inscripciones y decisiones en lotes ≤100 con cursor persistido. */
  async function runDenormalization(editionId) {
    let processed = 0;
    for (let i = 0; i < 12; i += 1) {
      const ed = await store.get(C.editions, editionId);
      if (!ed || !ed.denorm || ed.denorm.done) return { done: true, processed };
      const page = await store.list(C.regs, { where: [["editionId", "==", editionId]], limit: CHUNK, afterId: ed.denorm.cursor });
      const finished = await store.runTransaction(async (tx) => {
        const cur = await tx.get(C.editions, editionId);
        if (!cur.denorm || cur.denorm.done || cur.denorm.cursor !== ed.denorm.cursor) return false; // otro proceso avanzó
        const target = cur.denorm.target;
        const regs = [];
        const decs = [];
        for (const row of page) {
          regs.push(await tx.get(C.regs, row.id));
          decs.push(await tx.get(C.decisions, row.id));
        }
        page.forEach((row, n) => {
          if (regs[n]) tx.update(C.regs, row.id, { editionActive: target.editionActive, receptionOpen: target.receptionOpen });
          if (decs[n]) tx.update(C.decisions, row.id, { editionActive: target.editionActive });
        });
        const done = page.length < CHUNK;
        tx.update(C.editions, editionId, { denorm: { target, cursor: page.length ? page[page.length - 1].id : cur.denorm.cursor, done } });
        return true;
      });
      if (finished) processed += page.length;
    }
    const after = await store.get(C.editions, editionId);
    return { done: !after.denorm || after.denorm.done, processed };
  }

  async function editionTransition(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data);
    const input = parse(data, {
      editionId: ["id"],
      to: ["enum", { values: model.EDITION_STATUSES }],
      expectedRevision: ["int", { min: 1 }],
      reason: ["str", { opt: true, max: 200 }],
    });
    const outcome = await store.runTransaction(async (tx) => {
      const ed = await loadEdition(tx, input.editionId);
      if (ed.status === input.to) return { revision: ed.revision, replay: true };
      if (ed.revision !== input.expectedRevision) throw new HttpsError("aborted", E.conflict);
      if (!model.canMoveEdition(ed.status, input.to)) throw new HttpsError("failed-precondition", E.invalidTransition);
      const back = model.EDITION_STATUSES.indexOf(input.to) < model.EDITION_STATUSES.indexOf(ed.status);
      if (back && !input.reason) throw new HttpsError("failed-precondition", "outreach/reason-required");
      if (input.to === "evento" && !ed.eventDate) throw new HttpsError("failed-precondition", "outreach/event-date-required");
      const flags = flagsFor(input.to);
      const revision = ed.revision + 1;
      tx.update(C.editions, input.editionId, {
        status: input.to,
        revision,
        ...flags,
        denorm: { target: flags, cursor: null, done: false },
        lastTransition: { from: ed.status, to: input.to, by: uid, reason: input.reason ?? null, at: store.serverTimestamp() },
      });
      return { revision, replay: false };
    });
    const denorm = await runDenormalization(input.editionId);
    return { editionId: input.editionId, status: input.to, revision: outcome.revision, replay: outcome.replay && denorm.processed === 0, denormalized: denorm.done, processed: denorm.processed };
  }

  async function teamSet(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data, 16384);
    const input = parse(data, {
      editionId: ["id"],
      members: [
        "list",
        {
          max: 60,
          of: {
            uid: ["id"],
            roles: ["list", { max: 3, of: "str" }],
            active: ["bool", { opt: true, def: true }],
            maxAssigned: ["int", { opt: true, min: 1, max: 100 }],
          },
        },
      ],
    });
    const seen = new Set();
    const errors = {};
    input.members.forEach((m, i) => {
      if (seen.has(m.uid)) errors[`members[${i}].uid`] = "duplicate";
      seen.add(m.uid);
      if (m.roles.some((r) => !model.TEAM_ROLES.includes(r))) errors[`members[${i}].roles`] = "invalid";
      if (m.active && m.roles.length === 0) errors[`members[${i}].roles`] = "required";
    });
    if (Object.keys(errors).length) throw new HttpsError("invalid-argument", E.invalidArgument, { fields: errors });
    const names = {};
    for (const m of input.members) {
      const userDoc = await store.getUser(m.uid);
      if (!userDoc || userDoc.active !== true) throw new HttpsError("failed-precondition", E.invalidUser);
      names[m.uid] = safeName(userDoc);
    }
    return store.runTransaction(async (tx) => {
      const ed = await loadEdition(tx, input.editionId);
      assertOpen(ed);
      for (const m of input.members) {
        tx.set(
          sub(input.editionId, "team"),
          m.uid,
          clean({ uid: m.uid, displayName: names[m.uid], roles: [...new Set(m.roles)], active: m.active, maxAssigned: m.maxAssigned ?? null, updatedBy: uid, updatedAt: store.serverTimestamp() }),
        );
      }
      return { count: input.members.length };
    });
  }

  async function tablesSet(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data, 16384);
    const input = parse(data, {
      editionId: ["id"],
      tables: ["list", { max: 80, of: { number: ["int", { min: 1, max: 99 }], leaderUid: ["id", { opt: true }] } }],
    });
    const numbers = new Set();
    for (const t of input.tables) {
      if (numbers.has(t.number)) throw new HttpsError("invalid-argument", E.invalidArgument, { fields: { tables: "duplicate" } });
      numbers.add(t.number);
    }
    return store.runTransaction(async (tx) => {
      const ed = await loadEdition(tx, input.editionId);
      assertOpen(ed);
      const leaders = {};
      for (const t of input.tables) {
        if (!t.leaderUid || t.leaderUid in leaders) continue;
        const m = await tx.get(sub(input.editionId, "team"), t.leaderUid);
        if (!m || m.active !== true || !m.roles.includes("responsable")) throw new HttpsError("failed-precondition", E.invalidLeader);
        leaders[t.leaderUid] = m.displayName;
      }
      const existing = [];
      for (const t of input.tables) existing.push(await tx.get(sub(input.editionId, "tables"), String(t.number)));
      input.tables.forEach((t, i) => {
        const prev = existing[i];
        tx.set(
          sub(input.editionId, "tables"),
          String(t.number),
          clean({
            number: t.number,
            leaderUid: t.leaderUid,
            leaderName: t.leaderUid ? leaders[t.leaderUid] : null,
            linkActive: prev ? prev.linkActive === true : false,
            linkRevokedAt: prev ? prev.linkRevokedAt ?? null : null,
            linkIssuedAt: prev ? prev.linkIssuedAt ?? null : null,
          }),
        );
      });
      return { count: input.tables.length };
    });
  }

  async function tableLinkIssue(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data);
    const input = parse(data, { editionId: ["id"], number: ["int", { min: 1, max: 99 }] });
    const token = randomBytes ? generateShareToken(randomBytes) : generateShareToken();
    const linkHash = hashShareToken(token);
    const out = await store.runTransaction(async (tx) => {
      const ed = await loadEdition(tx, input.editionId);
      assertOpen(ed);
      const table = await tx.get(sub(input.editionId, "tables"), String(input.number));
      if (!table) throw new HttpsError("not-found", E.notFound);
      tx.set(sub(input.editionId, "tableSecrets"), String(input.number), { linkHash, linkRevokedAt: null, issuedBy: uid, issuedAt: nowLocal(), rate: { windowStart: 0, count: 0 } });
      tx.update(sub(input.editionId, "tables"), String(input.number), { linkActive: true, linkRevokedAt: null, linkIssuedAt: nowLocal() });
      return { window: ed.eventDate ? tablesDomain.tableLinkWindow(ed.eventDate) : null };
    });
    // El token en claro se devuelve UNA vez; reemitir invalida el anterior.
    return { editionId: input.editionId, number: input.number, token, window: out.window };
  }

  async function tableLinkRevoke(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data);
    const input = parse(data, { editionId: ["id"], number: ["int", { min: 1, max: 99 }] });
    return store.runTransaction(async (tx) => {
      const table = await tx.get(sub(input.editionId, "tables"), String(input.number));
      if (!table) throw new HttpsError("not-found", E.notFound);
      const secret = await tx.get(sub(input.editionId, "tableSecrets"), String(input.number));
      if (!secret || secret.linkRevokedAt) return { revoked: true, replay: true };
      const at = nowLocal();
      tx.update(sub(input.editionId, "tableSecrets"), String(input.number), { linkRevokedAt: at });
      tx.update(sub(input.editionId, "tables"), String(input.number), { linkActive: false, linkRevokedAt: at });
      return { revoked: true, replay: false };
    });
  }

  // ---------- importación ----------

  const seenId = (editionId, externalId) => `${editionId}_seen_${sha(externalId)}`;
  const reviewId = (editionId, item) => `${editionId}_rv_${sha(`${item.externalId}|${item.sourceRevision}|${item.issue}`)}`;

  async function importRegistrations(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data, 600_000);
    const input = parse(data, { editionId: ["id"], dryRun: ["bool", { opt: true, def: false }], rows: ["list", { max: 1000, of: ROW_SPEC }] });
    const ed = await store.get(C.editions, input.editionId);
    if (!ed) throw new HttpsError("not-found", E.notFound);
    assertOpen(ed);
    const flags = flagsFor(ed.status);
    const snapshot = new Map((await listAll(C.regs, [["editionId", "==", input.editionId]])).map(({ id, data: d }) => [id, regFromDoc(d)]));
    const rows = input.rows.map((r) => ({ ...r, phone: r.phone || null, email: r.email || null, invitedByName: r.invitedByName || null, attendedAt: r.attendedAt || null }));
    rows.sort((a, b) => a.sourceRevision - b.sourceRevision);

    const totals = { created: 0, updated: 0, cancelled: 0, unchanged: 0, stale: 0, toReview: 0, skippedMinors: 0 };
    const reviewOut = [];
    let cursor = ed.syncCursor || 0;

    /** Calcula (y, con `writer`, escribe) un lote. No toca acumuladores: se fusionan solo si la transacción confirma. */
    const processChunk = async (reader, writer, chunk, cursorIn) => {
      const ids = chunk.map((r) => syncDomain.registrationIdFor(input.editionId, r.externalId));
      const existingDocs = new Map();
      const seenDocs = new Map();
      for (let i = 0; i < chunk.length; i += 1) {
        const d = await reader.get(C.regs, ids[i]);
        if (d) existingDocs.set(ids[i], d);
        else {
          const s = await reader.get(C.inbox, seenId(input.editionId, chunk[i].externalId));
          if (s) seenDocs.set(chunk[i].externalId, s);
        }
      }
      const initial = new Map(snapshot);
      for (const [id, d] of existingDocs) initial.set(id, regFromDoc(d));
      const seen = {};
      chunk.forEach((r, i) => {
        const e = initial.get(ids[i]);
        if (e && e.externalRef) seen[r.externalId] = e.externalRef.sourceRevision;
        else if (seenDocs.has(r.externalId)) seen[r.externalId] = seenDocs.get(r.externalId).sourceRevision;
      });
      const startState = { editionId: input.editionId, editionClosed: false, registrations: [...initial.values()], seen, cursor: cursorIn, review: [] };
      const res = syncDomain.applyInbound(startState, chunk, { now: nowLocal() });
      const before = new Map(startState.registrations.map((r) => [r.id, r]));
      const created = [];
      const changed = [];
      for (const r of res.state.registrations) {
        const prev = before.get(r.id);
        if (!prev) created.push(r);
        else if (existingDocs.has(r.id) && (prev.revision !== r.revision || (prev.externalRef && prev.externalRef.sourceRevision) !== (r.externalRef && r.externalRef.sourceRevision))) changed.push(r);
      }
      const reviewDocs = new Map();
      for (const item of res.state.review) {
        const id = reviewId(input.editionId, item);
        reviewDocs.set(id, await reader.get(C.inbox, id));
      }
      if (writer) {
        for (const r of created) writer.create(C.regs, r.id, regDoc(r, flags));
        for (const r of changed) writer.update(C.regs, r.id, regDoc(r, flagsOfDoc(existingDocs.get(r.id))));
        for (const item of res.state.review) {
          const id = reviewId(input.editionId, item);
          if (!reviewDocs.get(id)) writer.create(C.inbox, id, { kind: "review", editionId: input.editionId, ...item, at: store.serverTimestamp() });
        }
        const createdIds = new Set(created.map((r) => r.id));
        chunk.forEach((r, i) => {
          if (existingDocs.has(ids[i]) || createdIds.has(ids[i])) return;
          const rev = res.state.seen[r.externalId];
          const prev = seenDocs.get(r.externalId);
          if (rev !== undefined && (!prev || prev.sourceRevision < rev)) writer.set(C.inbox, seenId(input.editionId, r.externalId), { kind: "seen", editionId: input.editionId, externalId: r.externalId, sourceRevision: rev });
        });
      }
      return { report: res.report, review: res.state.review, cursor: res.state.cursor, created, changed };
    };

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const done = input.dryRun ? await processChunk(store, null, chunk, cursor) : await store.runTransaction((tx) => processChunk(tx, tx, chunk, cursor));
      for (const k of Object.keys(totals)) totals[k] += done.report[k];
      reviewOut.push(...done.review);
      cursor = Math.max(cursor, done.cursor);
      for (const r of done.created) snapshot.set(r.id, r);
      for (const r of done.changed) snapshot.set(r.id, r);
    }
    if (!input.dryRun && cursor > (ed.syncCursor || 0)) {
      await store.runTransaction(async (tx) => {
        const cur = await tx.get(C.editions, input.editionId);
        if ((cur.syncCursor || 0) < cursor) tx.update(C.editions, input.editionId, { syncCursor: cursor });
      });
    }
    return { dryRun: input.dryRun, rows: rows.length, report: { ...totals, cursor }, review: reviewOut.slice(0, 200), reviewTotal: reviewOut.length };
  }

  async function confirmAbsences(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data, 32768);
    const input = parse(data, { editionId: ["id"], ids: ["list", { max: 400, of: "id" }], expectedUnknownCount: ["int", { min: 0 }] });
    const ed = await store.get(C.editions, input.editionId);
    if (!ed) throw new HttpsError("not-found", E.notFound);
    assertOpen(ed);
    const unknown = (await listAll(C.regs, [["editionId", "==", input.editionId], ["attendance", "==", "sin_confirmar"]])).filter((r) => r.data.status === "activa");
    if (unknown.length !== input.expectedUnknownCount) throw new HttpsError("aborted", E.conflict, { unknownCount: unknown.length });
    const ids = [...new Set(input.ids)];
    const result = { confirmed: 0, unchanged: 0, skipped: [] };
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const part = await store.runTransaction(async (tx) => {
        const cur = await loadEdition(tx, input.editionId);
        const docs = [];
        for (const id of chunk) docs.push(await tx.get(C.regs, id));
        const out = { confirmed: 0, unchanged: 0, skipped: [], writes: [] };
        chunk.forEach((id, n) => {
          const doc = docs[n];
          if (!doc || doc.editionId !== input.editionId) return void out.skipped.push({ id, reason: "no-encontrada" });
          const res = model.changeAttendance(regFromDoc(doc), { status: cur.status }, { to: "no_asistio", at: nowLocal(), by: uid });
          if (!res.ok) {
            if (res.error === "sin_cambio") out.unchanged += 1;
            else out.skipped.push({ id, reason: res.error.replace(/_/g, "-") });
            return;
          }
          out.confirmed += 1;
          out.writes.push([id, res.value, flagsOfDoc(doc)]);
        });
        for (const [id, reg, flags] of out.writes) {
          tx.update(C.regs, id, regDoc(reg, flags));
          writeChange(tx, id, reg.revision, { action: "asistencia", fields: ["attendance"] }, uid);
        }
        return out;
      });
      result.confirmed += part.confirmed;
      result.unchanged += part.unchanged;
      result.skipped.push(...part.skipped);
    }
    return result;
  }

  // ---------- distribución ----------

  async function loadTables(editionId) {
    return (await listAll(sub(editionId, "tables"), [], 200)).map(({ data: t }) => ({ number: t.number, leaderUid: t.leaderUid ?? null, leaderName: t.leaderName ?? null, linkHash: null, linkRevokedAt: t.linkRevokedAt ?? null }));
  }
  const loadTeam = async (editionId) => (await listAll(sub(editionId, "team"), [], 200)).map((r) => r.data);

  async function distributionPropose(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data);
    const input = parse(data, { editionId: ["id"], requestId: ["requestId"], includeUnconfirmed: ["bool", { opt: true, def: false }] });
    const batchId = `b-${deterministicId(uid, "batch", input.requestId)}`;
    const existing = await store.get(C.batches, batchId);
    if (existing) {
      if (existing.createdBy !== uid) throw new HttpsError("already-exists", E.requestReused);
      return { batchId, replay: true, status: existing.status, summary: existing.summary };
    }
    const ed = await store.get(C.editions, input.editionId);
    if (!ed) throw new HttpsError("not-found", E.notFound);
    if (ed.status !== "evento" && ed.status !== "seguimiento") throw new HttpsError("failed-precondition", E.invalidTransition);
    const regs = (await listAll(C.regs, [["editionId", "==", input.editionId]])).map((r) => regFromDoc(r.data));
    const team = await loadTeam(input.editionId);
    const tables = await loadTables(input.editionId);
    const proposal = dist.proposeDistribution(regs, team, {
      editionId: input.editionId,
      batchId,
      defaultMax: ed.maxPerOwner,
      includeUnconfirmed: input.includeUnconfirmed,
      affinity: tablesDomain.tableAffinity(regs, tables),
    });
    const excludedByReason = {};
    for (const x of proposal.excluded) excludedByReason[x.reason] = (excludedByReason[x.reason] || 0) + 1;
    const summary = { assignments: proposal.assignments.length, unassigned: proposal.unassigned.length, excluded: excludedByReason, loads: proposal.loads, caps: proposal.caps };
    if (proposal.assignments.length + proposal.unassigned.length > 3000) throw new HttpsError("failed-precondition", E.payloadTooLarge);
    await store.runTransaction(async (tx) => {
      if (await tx.get(C.batches, batchId)) return;
      tx.create(C.batches, batchId, clean({ editionId: input.editionId, status: "propuesto", createdBy: uid, createdAt: store.serverTimestamp(), assignments: proposal.assignments, unassigned: proposal.unassigned, summary }));
    });
    return { batchId, replay: false, status: "propuesto", summary, assignments: proposal.assignments, unassigned: proposal.unassigned };
  }

  async function distributionConfirm(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data);
    const input = parse(data, { editionId: ["id"], batchId: ["id"] });
    const batch = await store.get(C.batches, input.batchId);
    if (!batch || batch.editionId !== input.editionId) throw new HttpsError("not-found", E.notFound);
    if (batch.status === "confirmado") return { batchId: input.batchId, replay: true, ...batch.result };
    const ed = await store.get(C.editions, input.editionId);
    if (!ed) throw new HttpsError("not-found", E.notFound);
    if (ed.status !== "evento" && ed.status !== "seguimiento") throw new HttpsError("failed-precondition", E.invalidTransition);
    const team = await loadTeam(input.editionId);
    const caps = {};
    const loads = {};
    for (const m of team) if (m.active && m.roles.includes("responsable")) (caps[m.uid] = m.maxAssigned ?? ed.maxPerOwner), (loads[m.uid] = 0);
    for (const r of await listAll(C.regs, [["editionId", "==", input.editionId]])) if (r.data.ownerUid in loads && r.data.status === "activa" && !r.data.doNotContact) loads[r.data.ownerUid] += 1;

    const result = { applied: 0, alreadyApplied: 0, conflicts: [] };
    const all = batch.assignments;
    for (let i = 0; i < all.length; i += CHUNK) {
      const chunk = all.slice(i, i + CHUNK);
      const part = await store.runTransaction(async (tx) => {
        const edNow = await loadEdition(tx, input.editionId);
        assertOpen(edNow);
        const docs = new Map();
        const decs = new Map();
        for (const a of chunk) {
          const d = await tx.get(C.regs, a.registrationId);
          if (d) docs.set(a.registrationId, d);
          decs.set(a.registrationId, await tx.get(C.decisions, a.registrationId));
        }
        const localLoads = { ...loads };
        const out = { applied: [], alreadyApplied: 0, conflicts: [] };
        const toApply = [];
        for (const a of chunk) {
          const d = docs.get(a.registrationId);
          if (!d) continue;
          if (d.assignmentBatchId === input.batchId && d.ownerUid === a.ownerUid) {
            out.alreadyApplied += 1;
            continue;
          }
          if (!(a.ownerUid in caps)) out.conflicts.push({ registrationId: a.registrationId, reason: "responsable_invalido" });
          else if (!d.ownerUid && localLoads[a.ownerUid] >= caps[a.ownerUid]) out.conflicts.push({ registrationId: a.registrationId, reason: "sin_capacidad" });
          else {
            if (!d.ownerUid) localLoads[a.ownerUid] += 1;
            toApply.push(a);
          }
        }
        const res = dist.confirmBatch(
          [...docs.values()].map(regFromDoc),
          { editionId: input.editionId, batchId: input.batchId, assignments: toApply, unassigned: [], excluded: [], loads: {}, caps },
        );
        for (const c of res.result.conflicts) out.conflicts.push(c);
        const appliedSet = new Set(res.result.applied);
        for (const reg of res.registrations) {
          if (!appliedSet.has(reg.id)) continue;
          const raw = docs.get(reg.id);
          tx.update(C.regs, reg.id, regDoc(reg, flagsOfDoc(raw)));
          tx.create(regSub(reg.id, "assignments"), input.batchId, { ownerUid: reg.ownerUid, previousOwnerUid: null, batchId: input.batchId, reason: null, byUid: uid, revision: reg.revision, at: store.serverTimestamp() });
          writeChange(tx, reg.id, reg.revision, { action: "asignacion", fields: ["ownerUid"] }, uid);
          if (decs.get(reg.id)) tx.update(C.decisions, reg.id, { assigneeUid: reg.ownerUid, editionActive: raw.editionActive === true });
          out.applied.push(reg.id);
        }
        return out;
      });
      for (const id of part.applied) loads[docsOwner(batch, id)] += 1;
      result.applied += part.applied.length;
      result.alreadyApplied += part.alreadyApplied;
      result.conflicts.push(...part.conflicts);
    }
    await store.runTransaction(async (tx) => {
      const cur = await tx.get(C.batches, input.batchId);
      if (cur.status !== "confirmado") tx.update(C.batches, input.batchId, { status: "confirmado", confirmedBy: uid, confirmedAt: store.serverTimestamp(), result });
    });
    return { batchId: input.batchId, replay: false, ...result };
  }
  const docsOwner = (batch, regId) => batch.assignments.find((a) => a.registrationId === regId).ownerUid;

  async function reassign(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data);
    const input = parse(data, {
      editionId: ["id"],
      registrationId: ["id"],
      toUid: ["id"],
      reason: ["str", { max: 200 }],
      expectedRevision: ["int", { min: 1 }],
    });
    return store.runTransaction(async (tx) => {
      const ed = await loadEdition(tx, input.editionId);
      assertOpen(ed);
      const doc = await loadReg(tx, input.editionId, input.registrationId);
      const done = await tx.get(regSub(input.registrationId, "assignments"), `r${input.expectedRevision + 1}`);
      const members = await teamMembers(tx, input.editionId, [input.toUid]);
      const dec = await tx.get(C.decisions, input.registrationId);
      if (done && done.byUid === uid && done.ownerUid === input.toUid) return { revision: doc.revision, replay: true };
      const res = dist.reassign(regFromDoc(doc), members, input.toUid, input.reason, input.expectedRevision);
      if (!res.ok) throw domainFail(res.error);
      const reg = res.value;
      tx.update(C.regs, reg.id, regDoc(reg, flagsOfDoc(doc)));
      tx.create(regSub(reg.id, "assignments"), `r${reg.revision}`, { ownerUid: reg.ownerUid, previousOwnerUid: doc.ownerUid ?? null, batchId: null, reason: input.reason, byUid: uid, revision: reg.revision, at: store.serverTimestamp() });
      writeChange(tx, reg.id, reg.revision, { action: "reasignacion", fields: ["ownerUid"], reason: input.reason }, uid);
      if (dec) tx.update(C.decisions, reg.id, { assigneeUid: reg.ownerUid, editionActive: doc.editionActive === true });
      return { revision: reg.revision, replay: false };
    });
  }

  async function releaseAssignee(uid, data) {
    await authorize(uid, [PERM.coordinate]);
    checkSize(data);
    const input = parse(data, { editionId: ["id"], uid: ["id"], reason: ["str", { max: 200 }] });
    let released = 0;
    for (let i = 0; i < 25; i += 1) {
      const page = await store.list(C.regs, { where: [["editionId", "==", input.editionId], ["ownerUid", "==", input.uid]], limit: CHUNK });
      if (page.length === 0) return { released, done: true };
      const n = await store.runTransaction(async (tx) => {
        const ed = await loadEdition(tx, input.editionId);
        assertOpen(ed);
        const docs = [];
        const decs = [];
        for (const row of page) {
          docs.push(await tx.get(C.regs, row.id));
          decs.push(await tx.get(C.decisions, row.id));
        }
        const live = docs.map((d, k) => (d && d.ownerUid === input.uid && !d.handedOffAt ? { d, dec: decs[k] } : null)).filter(Boolean);
        const res = dist.releaseOwner(live.map((x) => regFromDoc(x.d)), input.uid);
        const byId = new Map(res.registrations.map((r) => [r.id, r]));
        for (const { d, dec } of live) {
          const reg = byId.get(d.id);
          tx.update(C.regs, reg.id, regDoc(reg, flagsOfDoc(d)));
          tx.create(regSub(reg.id, "assignments"), `r${reg.revision}`, { ownerUid: null, previousOwnerUid: input.uid, batchId: null, reason: input.reason, byUid: uid, revision: reg.revision, at: store.serverTimestamp() });
          writeChange(tx, reg.id, reg.revision, { action: "liberacion", fields: ["ownerUid"], reason: input.reason }, uid);
          if (dec) tx.update(C.decisions, reg.id, { assigneeUid: null, editionActive: d.editionActive === true });
        }
        return res.released.length;
      });
      released += n;
      if (n === 0) return { released, done: true }; // todas traspasadas: nada más que liberar
    }
    return { released, done: false };
  }

  // ---------- estadísticas ----------

  function decisionAggregate(regs, decisionRecords, tables) {
    const summary = metricsDomain.decisionSummary(regs, decisionRecords);
    const byTable = tablesDomain.tableSummaries(regs, decisionRecords, tables).map((t) => ({
      number: t.number,
      accepted: t.accepted < SUPPRESS_BELOW ? null : t.accepted,
      wantsToTalk: t.wantsToTalk < SUPPRESS_BELOW ? null : t.wantsToTalk,
    }));
    return { summary, byTable, suppressedBelow: SUPPRESS_BELOW };
  }

  async function stats(uid, data) {
    const userDoc = await authorize(uid, [PERM.coordinate]);
    checkSize(data);
    const input = parse(data, { editionId: ["id"] });
    const ed = await store.get(C.editions, input.editionId);
    if (!ed) throw new HttpsError("not-found", E.notFound);
    const regs = (await listAll(C.regs, [["editionId", "==", input.editionId]])).map((r) => regFromDoc(r.data));
    const tables = await loadTables(input.editionId);
    const m = metricsDomain.editionMetrics(regs, today(), ed.eventDate ?? null);
    const withDecisions = can(userDoc, PERM.decisions);
    const decisionRecords = withDecisions ? (await listAll(C.decisions, [["editionId", "==", input.editionId]])).map((r) => decFromDoc(r.data)) : [];
    const summaries = tablesDomain.tableSummaries(regs, [], tables).map((t) => ({ number: t.number, leaderName: t.leaderName, people: t.people }));
    const review = (await listAll(C.inbox, [["editionId", "==", input.editionId]])).filter((r) => r.data.kind === "review");
    const byIssue = {};
    for (const r of review) byIssue[r.data.issue] = (byIssue[r.data.issue] || 0) + 1;
    return {
      edition: editionSummary(input.editionId, ed),
      metrics: m,
      tables: summaries,
      review: { total: review.length, byIssue },
      ...(withDecisions ? { decisions: decisionAggregate(regs, decisionRecords, tables) } : {}),
    };
  }

  // =====================================================================
  // SEGUIMIENTO (responsable asignado)
  // =====================================================================

  async function cancelOutbox(tx, regId, items) {
    void tx;
    const domainItems = items.map((i) => ({ ...i.data, key: i.data.key ?? i.id }));
    const cancelled = outboxDomain.cancelForRegistration(domainItems, regId);
    return items.filter((_, k) => cancelled[k].status !== domainItems[k].status && cancelled[k].status === "cancelado");
  }

  async function contactRecord(uid, data) {
    await authorize(uid, [PERM.followup, PERM.coordinate]);
    checkSize(data);
    const input = parse(data, {
      editionId: ["id"],
      registrationId: ["id"],
      requestId: ["requestId"],
      date: ["ymd"],
      channel: ["enum", { values: ["whatsapp", "llamada", "presencial"] }],
      result: ["enum", { values: model.EVENT_CONTACT_RESULTS }],
      nextAction: ["str", { opt: true, max: 200 }],
      nextActionDate: ["ymd", { opt: true }],
    });
    const contactId = deterministicId(uid, "contact", input.requestId);
    return store.runTransaction(async (tx) => {
      const prior = await tx.get(regSub(input.registrationId, "contacts"), contactId);
      if (prior) {
        if (prior.byUid !== uid) throw new HttpsError("already-exists", E.requestReused);
        return { contactId, replay: true };
      }
      const ed = await loadEdition(tx, input.editionId);
      const doc = await loadReg(tx, input.editionId, input.registrationId);
      const optOut = input.result === "pidio_no_contacto";
      const items = optOut ? await tx.list(C.outbox, [["registrationId", "==", input.registrationId]], 50) : [];
      const contact = { id: contactId, registrationId: input.registrationId, editionId: input.editionId, date: input.date, channel: input.channel, result: input.result, nextAction: input.nextAction, nextActionDate: input.nextActionDate, byUid: uid };
      // El responsable se re-verifica AQUÍ, dentro de la transacción (puede haber sido reasignado).
      const res = model.recordContact(regFromDoc(doc), { status: ed.status }, contact);
      if (!res.ok) throw domainFail(res.error);
      tx.create(regSub(input.registrationId, "contacts"), contactId, clean({ ...contact, at: store.serverTimestamp() }));
      tx.update(C.regs, input.registrationId, regDoc(res.value, flagsOfDoc(doc)));
      if (optOut) {
        writeChange(tx, input.registrationId, res.value.revision, { action: "baja", fields: ["doNotContact"] }, uid);
        for (const item of await cancelOutbox(tx, input.registrationId, items)) tx.update(C.outbox, item.id, { status: "cancelado" });
      }
      return { contactId, revision: res.value.revision, replay: false, optedOut: optOut };
    });
  }

  async function doNotContactSet(uid, data) {
    const userDoc = await authorize(uid, [PERM.followup, PERM.coordinate]);
    checkSize(data);
    const input = parse(data, { editionId: ["id"], registrationId: ["id"], value: ["bool"], reason: ["str", { opt: true, max: 200 }] });
    const coordinator = can(userDoc, PERM.coordinate);
    if (!input.value && (!coordinator || !input.reason)) throw new HttpsError("permission-denied", E.forbidden);
    return store.runTransaction(async (tx) => {
      const ed = await loadEdition(tx, input.editionId);
      assertOpen(ed);
      const doc = await loadReg(tx, input.editionId, input.registrationId);
      // Responsable: solo lo suyo, verificado dentro de la transacción.
      if (!coordinator && doc.ownerUid !== uid) throw new HttpsError("permission-denied", E.notAssigned);
      if ((doc.doNotContact === true) === input.value) return { revision: doc.revision, replay: true };
      const items = input.value ? await tx.list(C.outbox, [["registrationId", "==", input.registrationId]], 50) : [];
      const reg = regFromDoc(doc);
      const next = {
        ...reg,
        doNotContact: input.value,
        followUp: input.value ? { ...reg.followUp, nextAction: null, nextActionDate: null } : reg.followUp,
        revision: reg.revision + 1,
      };
      tx.update(C.regs, reg.id, regDoc(next, flagsOfDoc(doc)));
      writeChange(tx, reg.id, next.revision, { action: input.value ? "baja" : "baja_revertida", fields: ["doNotContact"], reason: input.reason }, uid);
      if (input.value) for (const item of await cancelOutbox(tx, reg.id, items)) tx.update(C.outbox, item.id, { status: "cancelado" });
      return { revision: next.revision, replay: false };
    });
  }

  // =====================================================================
  // DECISIONES (pastoral)
  // =====================================================================

  async function decisionRecord(uid, data) {
    await authorize(uid, [PERM.decisions]);
    checkSize(data);
    const input = parse(data, {
      editionId: ["id"],
      registrationId: ["id"],
      value: ["enum", { values: model.DECISION_VALUES }],
      declaredBy: ["enum", { values: ["la_persona"] }],
      consentTextVersion: ["str", { max: 40 }],
      requestId: ["requestId"],
    });
    const historyId = deterministicId(uid, "decision", input.requestId);
    return store.runTransaction(async (tx) => {
      const prior = await tx.get(`${C.decisions}/${input.registrationId}/history`, historyId);
      if (prior) {
        if (prior.by !== uid) throw new HttpsError("already-exists", E.requestReused);
        return { registrationId: input.registrationId, replay: true };
      }
      const ed = await loadEdition(tx, input.editionId);
      assertOpen(ed);
      const doc = await loadReg(tx, input.editionId, input.registrationId);
      const current = await tx.get(C.decisions, input.registrationId);
      if (doc.status !== "activa") throw domainFail("inscripcion_inactiva");
      if (doc.doNotContact) throw domainFail("pidio_no_contacto");
      const parsed = model.parseDecision({
        registrationId: input.registrationId,
        editionId: input.editionId,
        value: input.value,
        declaredBy: input.declaredBy,
        consentTextVersion: input.consentTextVersion,
        recordedAt: nowLocal(),
        recordedBy: uid,
        tableNumber: doc.tableNumber ?? null,
      });
      if (!parsed.ok) throw new HttpsError("invalid-argument", E.invalidArgument, { fields: { decision: parsed.error } });
      tx.set(C.decisions, input.registrationId, decDoc(parsed.value, doc.ownerUid, doc.editionActive));
      tx.create(`${C.decisions}/${input.registrationId}/history`, historyId, { action: current ? "cambio" : "registro", value: input.value, previousValue: current ? current.value : null, by: uid, tableNumber: doc.tableNumber ?? null, at: store.serverTimestamp() });
      return { registrationId: input.registrationId, replay: false };
    });
  }

  async function decisionList(uid, data) {
    await authorize(uid, [PERM.decisions]);
    checkSize(data);
    const input = parse(data, { editionId: ["id"], cursor: ["id", { opt: true }], limit: ["int", { opt: true, def: 50, min: 1, max: 100 }] });
    const page = await store.list(C.decisions, { where: [["editionId", "==", input.editionId]], limit: input.limit, afterId: input.cursor });
    const rows = [];
    for (const { id, data: d } of page) {
      const reg = await store.get(C.regs, id);
      rows.push({ registrationId: id, fullName: reg ? reg.fullName : null, value: d.value, tableNumber: d.tableNumber ?? null, recordedAt: d.recordedAt, recordedBy: d.recordedBy });
    }
    return { rows, nextCursor: page.length === input.limit ? page[page.length - 1].id : null };
  }

  async function decisionStats(uid, data) {
    await authorize(uid, [PERM.decisions]);
    checkSize(data);
    const input = parse(data, { editionId: ["id"] });
    const regs = (await listAll(C.regs, [["editionId", "==", input.editionId]])).map((r) => regFromDoc(r.data));
    const records = (await listAll(C.decisions, [["editionId", "==", input.editionId]])).map((r) => decFromDoc(r.data));
    return decisionAggregate(regs, records, await loadTables(input.editionId));
  }

  // =====================================================================
  // MESA (sin sesión; token en el cuerpo)
  // =====================================================================

  const TABLE_AUTH = Object.freeze({ editionId: ["id"], table: ["int", { min: 1, max: 99 }], token: ["str", { min: 43, max: 43, raw: true }] });

  /** Valida token (tiempo constante), edición, ventana y cuota. Lanza si no corresponde. */
  async function openTable(tx, input) {
    if (!isWellFormedShareToken(input.token)) throw new HttpsError("permission-denied", E.linkUnavailable);
    const hash = hashShareToken(input.token);
    const secretPath = sub(input.editionId, "tableSecrets");
    const secret = await tx.get(secretPath, String(input.table));
    const table = await tx.get(sub(input.editionId, "tables"), String(input.table));
    const ed = await tx.get(C.editions, input.editionId);
    if (!secret || !table || !ed || !constantTimeEqual(secret.linkHash, hash) || ed.status === "cerrada") throw new HttpsError("permission-denied", E.linkUnavailable);
    const eventTable = { number: input.table, leaderUid: table.leaderUid ?? null, leaderName: table.leaderName ?? null, linkHash: secret.linkHash, linkRevokedAt: secret.linkRevokedAt ?? null };
    const usable = tablesDomain.linkUsable(eventTable, ed.eventDate ?? null, nowLocal());
    if (!usable.ok) {
      if (usable.error === "revocado") throw new HttpsError("permission-denied", E.linkRevoked);
      if (usable.error === "fuera_de_horario") throw new HttpsError("permission-denied", E.linkOutOfWindow);
      throw new HttpsError("permission-denied", E.linkUnavailable);
    }
    const nowMs = clock.now();
    const w = secret.rate || { windowStart: 0, count: 0 };
    const rate = nowMs - w.windowStart >= RATE_LIMIT.windowMs ? { windowStart: nowMs, count: 1 } : { windowStart: w.windowStart, count: w.count + 1 };
    if (rate.count > RATE_LIMIT.max) throw new HttpsError("resource-exhausted", E.rateLimited);
    return { eventTable, ed, rate, secretPath, flags: flagsFor(ed.status) };
  }

  /** Abre la mesa y ejecuta `fn`; la cuota se cobra aunque la operación devuelva un rechazo de dominio. */
  async function withTable(data, fn) {
    checkSize(data);
    const out = await store.runTransaction(async (tx) => {
      const ctx = await openTable(tx, data);
      const res = await fn(tx, ctx);
      tx.update(ctx.secretPath, String(data.table), { rate: ctx.rate }); // fn no escribe nada cuando devuelve un rechazo
      return res;
    });
    if (out && out.fail) throw out.fail;
    return out;
  }

  const auditId = (ctx, kind, key) => `${ctx.eventTable.number}-${sha(`${kind}:${key}`)}`;
  function writeMark(tx, ctx, id, op, registrationId) {
    // Nunca el token ni el valor de la marca: solo mesa, operación, inscripción y momento.
    tx.create(C.marks, id, clean({ editionId: ctx.ed.id, table: ctx.eventTable.number, op, registrationId: registrationId ?? null, at: store.serverTimestamp() }));
  }

  async function tableSearch(data) {
    const input = parse(data, { ...TABLE_AUTH, q: ["str", { max: 80 }] });
    return withTable(input, async (_tx, ctx) => {
      const regs = (await listAll(C.regs, [["editionId", "==", input.editionId]])).map((r) => regFromDoc(r.data));
      const found = tablesDomain.searchForTable(regs, [], input.q);
      const rows = [];
      for (const row of found) {
        const dec = await store.get(C.decisions, row.id);
        const reg = regs.find((r) => r.id === row.id);
        const own = dec && dec.tableNumber === ctx.eventTable.number ? [decFromDoc(dec)] : [];
        rows.push(tablesDomain.toRow(reg, own));
      }
      return { rows };
    });
  }

  async function tableMark(data) {
    const input = parse(data, {
      ...TABLE_AUTH,
      registrationId: ["id"],
      mark: ["enum", { values: tablesDomain.TABLE_MARKS }],
      personAgreed: ["bool"],
      moveHere: ["bool", { opt: true, def: false }],
      requestId: ["requestId"],
    });
    return withTable(input, async (tx, ctx) => {
      const id = auditId(ctx, "mark", `${input.registrationId}:${input.requestId}`);
      if (await tx.get(C.marks, id)) return { replay: true, registrationId: input.registrationId };
      const doc = await tx.get(C.regs, input.registrationId);
      const current = await tx.get(C.decisions, input.registrationId);
      if (!doc || doc.editionId !== input.editionId) return { fail: new HttpsError("not-found", E.notFound) };
      const res = tablesDomain.markAtTable(
        { registrations: [regFromDoc(doc)], decisions: current ? [decFromDoc(current)] : [] },
        { table: ctx.eventTable, eventDate: ctx.ed.eventDate ?? null, registrationId: input.registrationId, mark: input.mark, personAgreed: input.personAgreed, moveHere: input.moveHere, now: nowLocal() },
      );
      if (!res.ok) {
        if (res.error === "sin_cambio") return { replay: true, registrationId: input.registrationId };
        return { fail: domainFail(res.error, res.otherTable != null ? { otherTable: res.otherTable } : undefined) };
      }
      const reg = res.value.registrations[0];
      const decision = res.value.decisions[res.value.decisions.length - 1];
      tx.update(C.regs, reg.id, regDoc(reg, flagsOfDoc(doc)));
      tx.set(C.decisions, reg.id, decDoc(decision, reg.ownerUid, doc.editionActive));
      tx.create(`${C.decisions}/${reg.id}/history`, id, { action: current ? "cambio" : "marca", value: decision.value, previousValue: current ? current.value : null, by: decision.recordedBy, tableNumber: ctx.eventTable.number, at: store.serverTimestamp() });
      writeMark(tx, ctx, id, "mark", reg.id);
      return { replay: false, registrationId: reg.id };
    });
  }

  async function tableUnmark(data) {
    const input = parse(data, { ...TABLE_AUTH, registrationId: ["id"], requestId: ["requestId"] });
    return withTable(input, async (tx, ctx) => {
      const id = auditId(ctx, "unmark", `${input.registrationId}:${input.requestId}`);
      if (await tx.get(C.marks, id)) return { replay: true, registrationId: input.registrationId };
      const current = await tx.get(C.decisions, input.registrationId);
      const res = tablesDomain.unmarkAtTable(
        { registrations: [], decisions: current ? [decFromDoc(current)] : [] },
        { table: ctx.eventTable, eventDate: ctx.ed.eventDate ?? null, registrationId: input.registrationId, now: nowLocal() },
      );
      if (!res.ok) {
        if (res.error === "sin_cambio") return { replay: true, registrationId: input.registrationId };
        return { fail: domainFail(res.error) };
      }
      tx.delete(C.decisions, input.registrationId);
      tx.create(`${C.decisions}/${input.registrationId}/history`, id, { action: "retirada", value: null, previousValue: current.value, by: `mesa-${ctx.eventTable.number}`, tableNumber: ctx.eventTable.number, at: store.serverTimestamp() });
      writeMark(tx, ctx, id, "unmark", input.registrationId);
      return { replay: false, registrationId: input.registrationId };
    });
  }

  async function tableAddWalkIn(data) {
    const input = parse(data, { ...TABLE_AUTH, fullName: ["str", { max: 200 }], phone: ["str", { max: 40 }], requestId: ["requestId"] });
    return withTable(input, async (tx, ctx) => {
      const base = { table: ctx.eventTable, eventDate: ctx.ed.eventDate ?? null, editionId: input.editionId, fullName: input.fullName, phone: input.phone, requestId: input.requestId, now: nowLocal() };
      const probe = tablesDomain.addAtTable([], base);
      if (!probe.ok) return { fail: domainFail(probe.error) };
      const id = probe.created.id;
      const existing = await tx.get(C.regs, id);
      if (existing) return { replay: true, row: tablesDomain.toRow(regFromDoc(existing), []), possibleDuplicates: 0 };
      const phone = normalizePhone(input.phone);
      const same = phone.ok ? await tx.list(C.regs, [["editionId", "==", input.editionId], ["phoneE164", "==", phone.e164]], 20) : [];
      const res = tablesDomain.addAtTable(same.map((r) => regFromDoc(r.data)), base);
      if (!res.ok) return { fail: domainFail(res.error) };
      const reg = res.created;
      const markId = auditId(ctx, "walkin", reg.id);
      tx.create(C.regs, reg.id, regDoc(reg, ctx.flags));
      writeMark(tx, ctx, markId, "walkin", reg.id);
      if (res.possibleDuplicates.length) {
        tx.create(C.inbox, `${input.editionId}_rv_${sha(`walkin|${reg.id}`)}`, { kind: "review", editionId: input.editionId, externalId: null, sourceRevision: 0, issue: "posible_duplicado", registrationId: reg.id, candidates: res.possibleDuplicates, at: store.serverTimestamp() });
      }
      return { replay: false, row: tablesDomain.toRow(reg, []), possibleDuplicates: res.possibleDuplicates.length };
    });
  }

  // =====================================================================

  /** Errores conocidos pasan tal cual; el resto se sanitiza (log sin PII ni token) → outreach/internal. */
  function guarded(method, fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error("outreach", { method, name: error && error.name ? String(error.name) : "Error", code: error && error.code !== undefined ? String(error.code) : undefined });
        throw new HttpsError("internal", E.internal);
      }
    };
  }

  const ops = {
    editionCreate,
    editionUpdate,
    editionTransition,
    teamSet,
    tablesSet,
    tableLinkIssue,
    tableLinkRevoke,
    importRegistrations,
    confirmAbsences,
    distributionPropose,
    distributionConfirm,
    reassign,
    releaseAssignee,
    stats,
    contactRecord,
    doNotContactSet,
    decisionRecord,
    decisionList,
    decisionStats,
    tableSearch,
    tableMark,
    tableUnmark,
    tableAddWalkIn,
  };
  const service = {};
  for (const [name, fn] of Object.entries(ops)) service[name] = guarded(name, fn);
  return service;
}

/** Adaptador onCall: `request.data = { op, payload }`; la mesa ignora `request.auth`. */
function createOutreachCallableHandler(service, group) {
  const names = { coordinator: COORDINATOR_OPS, followup: FOLLOWUP_OPS, decision: DECISION_OPS };
  if (group !== "table" && !names[group]) throw new Error(`createOutreachCallableHandler: grupo desconocido ${group}`);
  return async function outreachCallableHandler(request) {
    const data = request ? request.data : undefined;
    const op = data && typeof data === "object" ? data.op : undefined;
    const method = group === "table" ? (typeof op === "string" && Object.hasOwn(TABLE_OPS, op) ? TABLE_OPS[op] : null) : typeof op === "string" && names[group].includes(op) ? op : null;
    if (!method || typeof service[method] !== "function") throw new HttpsError("invalid-argument", E.invalidArgument, { fields: { op: "invalid" } });
    if (group === "table") return service[method](data.payload);
    const uid = request && request.auth && typeof request.auth.uid === "string" ? request.auth.uid : null;
    return service[method](uid, data.payload);
  };
}

module.exports = {
  createOutreachService,
  createOutreachCallableHandler,
  deterministicId,
  OUTREACH_ERROR_KEYS,
  COORDINATOR_OPS,
  FOLLOWUP_OPS,
  TABLE_OPS,
  DECISION_OPS,
  RATE_LIMIT,
  SUPPRESS_BELOW,
};
