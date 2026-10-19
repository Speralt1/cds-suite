"use strict";

/**
 * functions/members/service.js
 *
 * Integrantes › Consolidación V1 (doc 23 §5). Servicio de los callables
 * `membersPersonCreate`, `membersPersonUpdate`, `membersStatusChange`,
 * `membersVisitCreate`, `membersFollowUpCreate` y `membersOwnerOptions`.
 *
 * Inyectable: recibe `store` (ver firestore-store.js; en tests, un store en
 * memoria), `clock` y `logger`. Toda la validación de payloads, el pipeline,
 * las sugerencias y la proyección vienen del modelo compartido
 * (lib/shared/members.ts → functions/shared/members.js).
 *
 * Reglas transversales:
 * - Auth obligatoria; permiso con `can()` (admin implícito, sin fallback legacy).
 * - Idempotencia: ids deterministas sha256(`${uid}:${kind}:${requestId}`)[0..24].
 *   Si el documento ya existe y es del mismo actor → misma respuesta, `replay: true`,
 *   sin escribir; si es de otro actor → `members/request-reused`.
 * - Concurrencia: `expectedRevision` ≠ `revision` → `members/conflict`.
 * - Auditoría append-only en `membersPersonChanges` (`${personId}-r${revision}-${n}`).
 *   Los cambios de perfil guardan SOLO los nombres de los campos, nunca sus valores.
 * - Errores: HttpsError con message = clave `members/*`. Los errores inesperados
 *   se registran solo como { method, name, code } (nunca nombres, teléfonos,
 *   correos ni el payload) y se devuelven como `members/internal`.
 */

const crypto = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { can } = require("../shared/access");
const { localToday } = require("../shared/dates");
const members = require("../shared/members");

const {
  parsePersonCreate,
  parsePersonUpdate,
  parseStatusChange,
  parseVisitCreate,
  parseFollowUpCreate,
  payloadTooLarge,
  checkTransition,
  stageFor,
  suggestAfterFollowUp,
  suggestReopenOnVisit,
  projectVisit,
  projectFollowUp,
  projectionOf,
  EMPTY_PROJECTION,
  MEMBERS_ERROR_KEYS: E,
  MEMBERS_COLLECTIONS: C,
  PROFILE_FIELDS,
} = members;

const PERM_MANAGE = "members.consolidation.manage";
const PERM_READ = "members.consolidation.read";
const PERM_CALENDAR_READ = "calendar.read";

const METHODS = Object.freeze(["personCreate", "personUpdate", "statusChange", "visitCreate", "followUpCreate", "ownerOptions"]);

/** Nombre visible cuando el perfil no tiene uno utilizable (nunca un correo). */
const UNNAMED_USER = "Usuario sin nombre";
const DUPLICATE_LIMIT = 5;

/** Id determinista de 24 hex para la idempotencia (doble envío). */
function deterministicId(uid, kind, requestId) {
  return crypto.createHash("sha256").update(`${uid}:${kind}:${requestId}`).digest("hex").slice(0, 24);
}

function changeId(personId, revision, n) {
  return `${personId}-r${revision}-${n}`;
}

/** Responsable válido: perfil existente, `active === true` y con manage (doc 23 §5). */
function isValidOwner(userDoc) {
  return !!userDoc && userDoc.active === true && can(userDoc, PERM_MANAGE);
}

/** Nombre visible seguro: trim, ≤120, nunca un correo. */
function ownerDisplayName(userDoc) {
  const name = userDoc && typeof userDoc.displayName === "string" ? userDoc.displayName.replace(/\s+/g, " ").trim() : "";
  if (!name || name.includes("@")) return UNNAMED_USER;
  return name.slice(0, 120);
}

function revisionOf(doc) {
  return Number.isInteger(doc && doc.revision) && doc.revision > 0 ? doc.revision : 1;
}

function invalidArgument(errors) {
  return new HttpsError("invalid-argument", E.invalidArgument, { fields: { ...errors } });
}

/** Proyección como campos planos del documento de la persona. */
function projectionFields(projection) {
  return {
    visitCount: projection.visitCount,
    firstVisitDate: projection.firstVisitDate,
    lastVisitDate: projection.lastVisitDate,
    followUpCount: projection.followUpCount,
    lastFollowUpDate: projection.lastFollowUpDate,
    firstContactDate: projection.firstContactDate,
    nextAction: projection.nextAction,
    nextActionDate: projection.nextActionDate,
    nextActionOwnerUid: projection.nextActionOwnerUid,
  };
}

/** Estado del pipeline de un documento guardado (tolerante). */
function pipelineOf(person) {
  return {
    lifecycleStage: person.lifecycleStage === "integrante" ? "integrante" : "en_consolidacion",
    consolidationStatus: person.consolidationStatus,
  };
}

/**
 * @param {{
 *   store: {
 *     getUser(uid: string): Promise<object|null>,
 *     listUsers(): Promise<Array<{ uid: string, data: object }>>,
 *     getCalendarEvent(id: string): Promise<object|null>,
 *     findPeople(field: string, value: string, limit: number): Promise<Array<{ id: string, data: object }>>,
 *     serverTimestamp(): unknown,
 *     runTransaction(fn: (tx: {
 *       get(collection: string, id: string): Promise<object|null>,
 *       create(collection: string, id: string, data: object): void,
 *       update(collection: string, id: string, data: object): void,
 *     }) => Promise<any>): Promise<any>,
 *   },
 *   clock: { now(): number },
 *   logger?: { error: Function },
 * }} deps
 */
function createMembersService({ store, clock, logger = console }) {
  if (!store || !clock) throw new Error("createMembersService: store y clock son obligatorios");

  const today = () => localToday(clock.now());

  /** Auth + perfil + permiso. Devuelve el documento users/{uid}. */
  async function authorize(uid, permission) {
    if (!uid || typeof uid !== "string") throw new HttpsError("unauthenticated", E.unauthenticated);
    const userDoc = await store.getUser(uid);
    if (!can(userDoc, permission)) throw new HttpsError("permission-denied", E.forbidden);
    return userDoc;
  }

  function checkPayload(data) {
    if (payloadTooLarge(data)) throw new HttpsError("invalid-argument", E.payloadTooLarge);
  }

  function unwrap(parsed) {
    if (!parsed.ok) throw invalidArgument(parsed.errors);
    return parsed.value;
  }

  /** Actividad del calendario: solo con calendar.read; debe existir y no estar archivada. Solo se guarda el id. */
  async function assertCalendarEvent(userDoc, eventId) {
    if (!eventId) return;
    if (!can(userDoc, PERM_CALENDAR_READ)) throw new HttpsError("permission-denied", E.calendarForbidden);
    const event = await store.getCalendarEvent(eventId);
    if (!event || event.status === "archived") throw new HttpsError("not-found", E.calendarNotFound);
  }

  async function assertOwner(tx, ownerUid) {
    if (!ownerUid) return;
    const ownerDoc = await tx.get("users", ownerUid);
    if (!isValidOwner(ownerDoc)) throw new HttpsError("failed-precondition", E.invalidOwner);
  }

  async function loadPerson(tx, personId) {
    const person = await tx.get(C.people, personId);
    if (!person) throw new HttpsError("not-found", E.notFound);
    return person;
  }

  function assertRevision(person, expectedRevision) {
    if (revisionOf(person) !== expectedRevision) throw new HttpsError("aborted", E.conflict);
  }

  /** Escritor de cambios de auditoría con ids `${personId}-r${revision}-${n}`. */
  function changeWriter(tx, personId, revision, actorUid, at) {
    let n = 0;
    return (entry) => {
      n += 1;
      tx.create(C.changes, changeId(personId, revision, n), {
        personId,
        action: entry.action,
        field: entry.field ?? null,
        from: entry.from ?? null,
        to: entry.to ?? null,
        changedFields: entry.changedFields ? [...entry.changedFields] : [],
        reason: entry.reason ?? null,
        reasonNote: entry.reasonNote ?? null,
        refId: entry.refId ?? null,
        revision,
        actorUid,
        at,
      });
    };
  }

  /** Posibles duplicados (mismo teléfono o correo en otra persona). Advierte, nunca bloquea. */
  async function findDuplicates(personId, phoneE164, email) {
    const found = new Map();
    const add = (rows, by) => {
      for (const row of rows) {
        if (row.id === personId) continue;
        const prev = found.get(row.id);
        if (prev) {
          if (!prev.by.includes(by)) prev.by.push(by);
        } else {
          const fullName = row.data && typeof row.data.fullName === "string" ? row.data.fullName : "";
          found.set(row.id, { personId: row.id, fullName, by: [by] });
        }
      }
    };
    if (phoneE164) add(await store.findPeople("phoneE164", phoneE164, DUPLICATE_LIMIT), "telefono");
    if (email) add(await store.findPeople("email", email, DUPLICATE_LIMIT), "correo");
    return [...found.values()];
  }

  // ---------- personCreate ----------

  async function personCreate(uid, data) {
    const userDoc = await authorize(uid, PERM_MANAGE);
    checkPayload(data);
    const day = today();
    const input = unwrap(parsePersonCreate(data, day));
    await assertCalendarEvent(userDoc, input.calendarEventId);

    const personId = deterministicId(uid, "person", input.requestId);
    const visitId = deterministicId(uid, "visit0", input.requestId);

    const outcome = await store.runTransaction(async (tx) => {
      const existing = await tx.get(C.people, personId);
      if (existing) {
        if (existing.createdBy !== uid) throw new HttpsError("already-exists", E.requestReused);
        return { revision: revisionOf(existing), replay: true, phoneE164: existing.phoneE164, email: existing.email ?? null };
      }
      await assertOwner(tx, input.followUpOwnerUid);

      const at = store.serverTimestamp();
      const revision = 1;
      const projection = projectVisit(EMPTY_PROJECTION, input.firstVisitDate);
      tx.create(C.people, personId, {
        fullName: input.fullName,
        phoneE164: input.phoneE164,
        email: input.email,
        entryDate: day,
        firstVisitAt: input.firstVisitDate,
        arrivalSource: input.arrivalSource,
        calendarEventId: input.calendarEventId,
        invitedBy: input.invitedBy,
        lifecycleStage: "en_consolidacion",
        consolidationStatus: "por_contactar",
        closedReason: null,
        followUpOwnerUid: input.followUpOwnerUid,
        doNotContact: false,
        ...projectionFields(projection),
        createdAt: at,
        createdBy: uid,
        updatedAt: at,
        updatedBy: uid,
        revision,
      });
      tx.create(C.visits, visitId, {
        personId,
        date: input.firstVisitDate,
        calendarEventId: input.calendarEventId,
        note: input.visitNote,
        firstVisit: true,
        createdAt: at,
        createdBy: uid,
      });
      const record = changeWriter(tx, personId, revision, uid, at);
      record({ action: "person_created", refId: visitId });
      if (input.followUpOwnerUid) {
        record({ action: "owner_changed", field: "followUpOwnerUid", from: null, to: input.followUpOwnerUid });
      }
      return { revision, replay: false, phoneE164: input.phoneE164, email: input.email };
    });

    const duplicates = await findDuplicates(personId, outcome.phoneE164, outcome.email);
    return { personId, revision: outcome.revision, replay: outcome.replay, duplicates };
  }

  // ---------- personUpdate ----------

  async function personUpdate(uid, data) {
    await authorize(uid, PERM_MANAGE);
    checkPayload(data);
    const input = unwrap(parsePersonUpdate(data));

    return store.runTransaction(async (tx) => {
      const person = await loadPerson(tx, input.personId);
      assertRevision(person, input.expectedRevision);

      const changed = [];
      for (const [field, value] of Object.entries(input.patch)) {
        const before = field === "doNotContact" ? person.doNotContact === true : (person[field] ?? null);
        if (before !== value) changed.push(field);
      }
      if (!changed.length) return { personId: input.personId, revision: revisionOf(person), changed: [] };

      if (changed.includes("followUpOwnerUid")) await assertOwner(tx, input.patch.followUpOwnerUid);

      const at = store.serverTimestamp();
      const revision = revisionOf(person) + 1;
      const update = { updatedAt: at, updatedBy: uid, revision };
      for (const field of changed) update[field] = input.patch[field];
      tx.update(C.people, input.personId, update);

      const record = changeWriter(tx, input.personId, revision, uid, at);
      const profileChanged = PROFILE_FIELDS.filter((f) => changed.includes(f));
      if (profileChanged.length) record({ action: "profile_updated", changedFields: profileChanged });
      if (changed.includes("followUpOwnerUid")) {
        record({
          action: "owner_changed",
          field: "followUpOwnerUid",
          from: person.followUpOwnerUid ?? null,
          to: input.patch.followUpOwnerUid,
        });
      }
      if (changed.includes("doNotContact")) {
        record({
          action: "do_not_contact_changed",
          field: "doNotContact",
          from: person.doNotContact === true,
          to: input.patch.doNotContact,
        });
      }
      return { personId: input.personId, revision, changed };
    });
  }

  // ---------- statusChange ----------

  async function statusChange(uid, data) {
    await authorize(uid, PERM_MANAGE);
    checkPayload(data);
    const input = unwrap(parseStatusChange(data));

    return store.runTransaction(async (tx) => {
      const person = await loadPerson(tx, input.personId);
      assertRevision(person, input.expectedRevision);
      const from = pipelineOf(person);
      if (!checkTransition(from, input.status).ok) throw new HttpsError("failed-precondition", E.invalidTransition);

      const stage = stageFor(input.status, from.lifecycleStage);
      const closedReason = input.status === "sin_continuidad" ? input.closedReason : null;
      const at = store.serverTimestamp();
      const revision = revisionOf(person) + 1;
      tx.update(C.people, input.personId, {
        consolidationStatus: input.status,
        lifecycleStage: stage,
        closedReason,
        updatedAt: at,
        updatedBy: uid,
        revision,
      });
      const record = changeWriter(tx, input.personId, revision, uid, at);
      record({
        action: "status_changed",
        field: "consolidationStatus",
        from: from.consolidationStatus,
        to: input.status,
        reason: closedReason,
        reasonNote: closedReason ? input.reasonNote : null,
      });
      if (stage !== from.lifecycleStage) {
        record({ action: "stage_changed", field: "lifecycleStage", from: from.lifecycleStage, to: stage });
      }
      return { personId: input.personId, revision };
    });
  }

  // ---------- visitCreate ----------

  async function visitCreate(uid, data) {
    const userDoc = await authorize(uid, PERM_MANAGE);
    checkPayload(data);
    const input = unwrap(parseVisitCreate(data, today()));
    await assertCalendarEvent(userDoc, input.calendarEventId);
    const visitId = deterministicId(uid, "visit", input.requestId);

    return store.runTransaction(async (tx) => {
      const existing = await tx.get(C.visits, visitId);
      const person = await loadPerson(tx, input.personId);
      if (existing) {
        if (existing.createdBy !== uid || existing.personId !== input.personId) {
          throw new HttpsError("already-exists", E.requestReused);
        }
        return {
          visitId,
          personId: input.personId,
          revision: revisionOf(person),
          replay: true,
          suggestReopen: suggestReopenOnVisit(pipelineOf(person)),
        };
      }

      const at = store.serverTimestamp();
      const revision = revisionOf(person) + 1;
      const projection = projectVisit(projectionOf(person), input.date);
      tx.create(C.visits, visitId, {
        personId: input.personId,
        date: input.date,
        calendarEventId: input.calendarEventId,
        note: input.note,
        firstVisit: false,
        createdAt: at,
        createdBy: uid,
      });
      tx.update(C.people, input.personId, { ...projectionFields(projection), updatedAt: at, updatedBy: uid, revision });
      changeWriter(tx, input.personId, revision, uid, at)({ action: "visit_recorded", refId: visitId });
      return {
        visitId,
        personId: input.personId,
        revision,
        replay: false,
        suggestReopen: suggestReopenOnVisit(pipelineOf(person)),
      };
    });
  }

  // ---------- followUpCreate ----------

  async function followUpCreate(uid, data) {
    await authorize(uid, PERM_MANAGE);
    checkPayload(data);
    const input = unwrap(parseFollowUpCreate(data, today()));
    const followUpId = deterministicId(uid, "followup", input.requestId);

    return store.runTransaction(async (tx) => {
      const existing = await tx.get(C.followUps, followUpId);
      const person = await loadPerson(tx, input.personId);
      if (existing) {
        if (existing.createdBy !== uid || existing.personId !== input.personId) {
          throw new HttpsError("already-exists", E.requestReused);
        }
        // El doble envío repite el mismo payload, que ya fue validado y aplicado.
        return {
          followUpId,
          personId: input.personId,
          revision: revisionOf(person),
          replay: true,
          applied: { status: input.applyStatus, doNotContact: input.applyDoNotContact },
        };
      }

      if (input.ownerUid) await assertOwner(tx, input.ownerUid);
      const ownerUid = input.ownerUid ?? (typeof person.followUpOwnerUid === "string" && person.followUpOwnerUid ? person.followUpOwnerUid : null);

      const before = projectionOf(person);
      const pipeline = pipelineOf(person);
      const suggestion = suggestAfterFollowUp(
        { ...pipeline, doNotContact: person.doNotContact === true, firstContactDate: before.firstContactDate },
        input.result,
      );
      if (input.applyStatus !== null && input.applyStatus !== suggestion.status) {
        throw new HttpsError("failed-precondition", E.suggestionMismatch);
      }
      if (input.applyDoNotContact && !suggestion.doNotContact) {
        throw new HttpsError("failed-precondition", E.suggestionMismatch);
      }

      const at = store.serverTimestamp();
      const revision = revisionOf(person) + 1;
      const projection = projectFollowUp(before, {
        contactDate: input.contactDate,
        result: input.result,
        nextAction: input.nextAction,
        nextActionDate: input.nextActionDate,
        ownerUid,
      });
      tx.create(C.followUps, followUpId, {
        personId: input.personId,
        contactDate: input.contactDate,
        type: input.type,
        result: input.result,
        note: input.note,
        nextAction: input.nextAction,
        nextActionDate: input.nextActionDate,
        ownerUid,
        createdAt: at,
        createdBy: uid,
      });

      const update = { ...projectionFields(projection), updatedAt: at, updatedBy: uid, revision };
      let stage = pipeline.lifecycleStage;
      if (input.applyStatus) {
        stage = stageFor(input.applyStatus, pipeline.lifecycleStage);
        update.consolidationStatus = input.applyStatus;
        update.lifecycleStage = stage;
        update.closedReason = input.applyStatus === "sin_continuidad" ? suggestion.closedReason : null;
      }
      if (input.applyDoNotContact) update.doNotContact = true;
      tx.update(C.people, input.personId, update);

      const record = changeWriter(tx, input.personId, revision, uid, at);
      record({ action: "follow_up_recorded", refId: followUpId });
      if (input.applyStatus) {
        record({
          action: "status_changed",
          field: "consolidationStatus",
          from: pipeline.consolidationStatus,
          to: input.applyStatus,
          reason: input.applyStatus === "sin_continuidad" ? suggestion.closedReason : null,
          refId: followUpId,
        });
        if (stage !== pipeline.lifecycleStage) {
          record({ action: "stage_changed", field: "lifecycleStage", from: pipeline.lifecycleStage, to: stage, refId: followUpId });
        }
      }
      if (input.applyDoNotContact) {
        record({ action: "do_not_contact_changed", field: "doNotContact", from: person.doNotContact === true, to: true, refId: followUpId });
      }
      return {
        followUpId,
        personId: input.personId,
        revision,
        replay: false,
        applied: { status: input.applyStatus, doNotContact: input.applyDoNotContact },
      };
    });
  }

  // ---------- ownerOptions ----------

  async function ownerOptions(uid) {
    await authorize(uid, PERM_READ);
    const users = await store.listUsers();
    const owners = users
      .filter((u) => u && typeof u.uid === "string" && isValidOwner(u.data))
      .map((u) => ({ uid: u.uid, displayName: ownerDisplayName(u.data) }));
    owners.sort((a, b) => a.displayName.localeCompare(b.displayName, "es", { sensitivity: "base" }) || a.uid.localeCompare(b.uid));
    return { owners };
  }

  /** Errores conocidos pasan tal cual; el resto se sanitiza (log sin PII) → members/internal. */
  function guarded(method, fn) {
    return async (uid, data) => {
      try {
        return await fn(uid, data);
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error("members", {
          method,
          name: error && error.name ? String(error.name) : "Error",
          code: error && error.code !== undefined ? String(error.code) : undefined,
        });
        throw new HttpsError("internal", E.internal);
      }
    };
  }

  return {
    personCreate: guarded("personCreate", personCreate),
    personUpdate: guarded("personUpdate", personUpdate),
    statusChange: guarded("statusChange", statusChange),
    visitCreate: guarded("visitCreate", visitCreate),
    followUpCreate: guarded("followUpCreate", followUpCreate),
    ownerOptions: guarded("ownerOptions", (uid) => ownerOptions(uid)),
  };
}

/** Adaptador onCall: `(request) => service[method](request.auth?.uid ?? null, request.data)`. */
function createMembersCallableHandler(service, method) {
  if (!METHODS.includes(method) || typeof service[method] !== "function") {
    throw new Error(`createMembersCallableHandler: método desconocido ${method}`);
  }
  return async function membersCallableHandler(request) {
    const uid = request && request.auth && typeof request.auth.uid === "string" ? request.auth.uid : null;
    return service[method](uid, request ? request.data : undefined);
  };
}

module.exports = {
  createMembersService,
  createMembersCallableHandler,
  deterministicId,
  changeId,
  ownerDisplayName,
  METHODS,
  UNNAMED_USER,
};
