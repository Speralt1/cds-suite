// @vitest-environment node
// Servicio «Ve por los tuyos» (doc 40 · H3b) con store en memoria: permisos,
// idempotencia, enlaces de mesa y la simulación completa 300 personas / 35 mesas.
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { simRegistrations, simTeam } from "@/lib/outreach/sim/fixtures";
import { registrationIdFor } from "@/lib/shared/outreach-sync";
import { OutreachMemoryStore, fixedClock, type Doc } from "./outreach-memory-store";

const require = createRequire(import.meta.url);
const { createOutreachService, createOutreachCallableHandler, RATE_LIMIT } = require("../../functions/outreach/service.js");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = Record<string, (...args: unknown[]) => Promise<any>>;

const EVENT = "2026-11-28";
const NIGHT = "2026-11-28T21:00:00-03:00";
const v1 = (permissions: string[], extra: Doc = {}): Doc => ({ accessSchemaVersion: 1, role: "leader", active: true, baseRole: "standard", permissions, areaIds: [], homeModule: "calendar", ...extra });
const COORD = "members.outreach.coordinate";
const FOLLOW = "members.outreach.followup_assigned";
const DEC = "members.outreach.decisions";

function setup(iso = NIGHT) {
  const clock = fixedClock(iso);
  const store = new OutreachMemoryStore(clock);
  const team = simTeam(35);
  for (const m of team) store.put("users", m.uid, v1(m.roles.includes("responsable") ? [FOLLOW] : [COORD], { displayName: m.displayName }));
  store.put("users", "pastor", v1([DEC], { displayName: "Pastor Prueba" }));
  store.put("users", "decisor-coord", v1([COORD, DEC], { displayName: "Coordinación y decisiones" }));
  store.put("users", "admin", { role: "admin", active: true, displayName: "Administración" });
  store.put("users", "nobody", v1([], { displayName: "Sin permisos" }));
  store.put("users", "inactive", v1([COORD], { active: false, displayName: "Inactiva" }));
  store.put("users", "legacy-leader", { role: "leader", active: true, displayName: "Líder legado" });
  const logger = { error: vi.fn((...a: unknown[]) => { if (process.env.DBG) console.log(a); }) };
  let n = 0;
  const randomBytes = (size: number) => Buffer.alloc(size, ++n); // token determinista (solo pruebas)
  const service = createOutreachService({ store, clock, logger, randomBytes }) as Svc;
  return { store, clock, logger, service, team };
}

let seq = 0;
const rid = () => `req-${String(++seq).padStart(6, "0")}`;
async function fails(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    const err = e as { code?: string; message?: string; details?: unknown };
    return { code: err.code, message: err.message, details: err.details };
  }
  throw new Error("se esperaba un rechazo");
}

const rowOf = (r: ReturnType<typeof simRegistrations>[number], attended = false) => ({
  externalId: r.externalRef!.id,
  sourceRevision: r.externalRef!.sourceRevision,
  editionYear: 2026,
  fullName: r.fullName,
  phone: r.phoneE164,
  email: r.email,
  invitedByName: r.invitedByName,
  adultConfirmed: true,
  consents: r.consents.map((c) => ({ purpose: c.purpose, textVersion: c.textVersion, grantedAt: c.grantedAt })),
  cancelled: false,
  attendedAt: attended ? "2026-11-28T19:40" : null,
});

/** Edición con equipo, 35 mesas y enlaces; en estado `status`. */
async function bootstrap(ctx: ReturnType<typeof setup>, status: "preparacion" | "inscripcion" | "evento" | "seguimiento" = "evento") {
  const { service, team } = ctx;
  await service.editionCreate("sim-coord", { year: 2026, eventDate: EVENT, maxPerOwner: 20 });
  await service.teamSet("sim-coord", { editionId: "vplt-2026", members: team.map((m) => ({ uid: m.uid, roles: m.roles, active: true })) });
  const leaders = team.filter((m) => m.roles.includes("responsable"));
  await service.tablesSet("sim-coord", { editionId: "vplt-2026", tables: leaders.map((m, i) => ({ number: i + 1, leaderUid: m.uid })) });
  let rev = 1;
  for (const to of ["inscripcion", "evento", "seguimiento"] as const) {
    if (["preparacion", "inscripcion", "evento", "seguimiento"].indexOf(status) < ["preparacion", "inscripcion", "evento", "seguimiento"].indexOf(to)) break;
    rev = (await service.editionTransition("sim-coord", { editionId: "vplt-2026", to, expectedRevision: rev })).revision;
  }
  return { leaders, rev };
}

const tokens = async (service: Svc, n = 35) => {
  const out: Record<number, string> = {};
  for (let i = 1; i <= n; i += 1) out[i] = (await service.tableLinkIssue("sim-coord", { editionId: "vplt-2026", number: i })).token;
  return out;
};

describe("permisos por operación", () => {
  const COORD_CALLS: Array<[string, Doc]> = [
    ["editionCreate", { year: 2027 }],
    ["editionUpdate", { editionId: "vplt-2026", expectedRevision: 1, title: "x" }],
    ["editionTransition", { editionId: "vplt-2026", to: "inscripcion", expectedRevision: 1 }],
    ["teamSet", { editionId: "vplt-2026", members: [] }],
    ["tablesSet", { editionId: "vplt-2026", tables: [] }],
    ["tableLinkIssue", { editionId: "vplt-2026", number: 1 }],
    ["tableLinkRevoke", { editionId: "vplt-2026", number: 1 }],
    ["importRegistrations", { editionId: "vplt-2026", rows: [] }],
    ["confirmAbsences", { editionId: "vplt-2026", ids: [], expectedUnknownCount: 0 }],
    ["distributionPropose", { editionId: "vplt-2026", requestId: "req-aaaaaa" }],
    ["distributionConfirm", { editionId: "vplt-2026", batchId: "b-x" }],
    ["reassign", { editionId: "vplt-2026", registrationId: "r", toUid: "u", reason: "x", expectedRevision: 1 }],
    ["releaseAssignee", { editionId: "vplt-2026", uid: "u", reason: "x" }],
    ["stats", { editionId: "vplt-2026" }],
  ];
  it.each(COORD_CALLS)("coordinación: %s exige sesión y members.outreach.coordinate (o admin)", async (op, payload) => {
    const { service } = setup();
    expect((await fails(service[op](null, payload))).message).toBe("outreach/unauthenticated");
    for (const uid of ["nobody", "inactive", "legacy-leader", "pastor", "sim-resp-01", "ghost"]) {
      expect((await fails(service[op](uid, payload))).message, `${op} ${uid}`).toBe("outreach/forbidden");
    }
  });
  it("admin y coordinación pasan la puerta (editionCreate)", async () => {
    const { service } = setup();
    expect((await service.editionCreate("admin", { year: 2030 })).id).toBe("vplt-2030");
    expect((await service.editionCreate("sim-coord", { year: 2031 })).id).toBe("vplt-2031");
  });
  it("seguimiento: followup_assigned o coordinate; decisiones: solo decisions o admin", async () => {
    const { service } = setup();
    const contact = { editionId: "vplt-2026", registrationId: "r1", requestId: "req-abcdef", date: "2026-11-30", channel: "llamada", result: "contactado" };
    for (const op of ["contactRecord", "doNotContactSet"]) {
      const payload = op === "contactRecord" ? contact : { editionId: "vplt-2026", registrationId: "r1", value: true };
      expect((await fails(service[op](null, payload))).message).toBe("outreach/unauthenticated");
      for (const uid of ["nobody", "pastor", "legacy-leader"]) expect((await fails(service[op](uid, payload))).message).toBe("outreach/forbidden");
    }
    const dec = { editionId: "vplt-2026", registrationId: "r1", value: "acepto_a_cristo", declaredBy: "la_persona", consentTextVersion: "v1", requestId: "req-abcdef" };
    for (const [op, payload] of [["decisionRecord", dec], ["decisionList", { editionId: "vplt-2026" }], ["decisionStats", { editionId: "vplt-2026" }]] as const) {
      expect((await fails(service[op](null, payload))).message).toBe("outreach/unauthenticated");
      for (const uid of ["nobody", "sim-coord", "sim-resp-01"]) expect((await fails(service[op](uid, payload))).message, `${op} ${uid}`).toBe("outreach/forbidden");
    }
  });
  it("validación estricta: claves desconocidas, tipos y tamaño", async () => {
    const { service } = setup();
    const r = await fails(service.editionCreate("sim-coord", { year: 2027, extra: 1 }));
    expect(r.message).toBe("outreach/invalid-argument");
    expect((r.details as { fields: Doc }).fields.extra).toBe("unknown");
    expect((await fails(service.editionCreate("sim-coord", { year: "2027" }))).message).toBe("outreach/invalid-argument");
    expect((await fails(service.editionCreate("sim-coord", { year: 2027, title: "x".repeat(5000) }))).message).toBe("outreach/payload-too-large");
  });
  it("el adaptador onCall solo despacha operaciones de su grupo", async () => {
    const { service } = setup();
    const h = createOutreachCallableHandler(service, "coordinator");
    expect((await fails(h({ auth: { uid: "sim-coord" }, data: { op: "contactRecord", payload: {} } }))).message).toBe("outreach/invalid-argument");
    expect((await fails(h({ data: { op: "stats", payload: { editionId: "vplt-2026" } } }))).message).toBe("outreach/unauthenticated");
    const t = createOutreachCallableHandler(service, "table");
    expect((await fails(t({ data: { op: "stats", payload: {} } }))).message).toBe("outreach/invalid-argument");
  });
});

describe("edición, equipo, mesas y desnormalización", () => {
  it("editionCreate es idempotente; editionUpdate con revisión", async () => {
    const { service, store } = setup();
    const a = await service.editionCreate("sim-coord", { year: 2026, eventDate: EVENT });
    const b = await service.editionCreate("sim-coord", { year: 2026, eventDate: "2026-12-01" });
    expect([a.replay, b.replay]).toEqual([false, true]);
    expect(store.doc("outreachEditions", "vplt-2026")!.eventDate).toBe(EVENT);
    const u = await service.editionUpdate("sim-coord", { editionId: "vplt-2026", expectedRevision: 1, title: "Nuevo" });
    expect(u.revision).toBe(2);
    expect((await service.editionUpdate("sim-coord", { editionId: "vplt-2026", expectedRevision: 1, title: "Nuevo" })).replay).toBe(true);
    expect((await fails(service.editionUpdate("sim-coord", { editionId: "vplt-2026", expectedRevision: 1, title: "Otro" }))).message).toBe("outreach/conflict");
  });
  it("transiciones: revisión, salto inválido, motivo al retroceder, replay y denormalización en lotes", async () => {
    const ctx = setup();
    const { service, store } = ctx;
    await service.editionCreate("sim-coord", { year: 2026, eventDate: EVENT });
    for (let i = 0; i < 250; i += 1) store.put("outreachRegistrations", `r${String(i).padStart(4, "0")}`, { editionId: "vplt-2026", editionActive: false, receptionOpen: false, status: "activa" });
    store.put("outreachDecisions", "r0003", { editionId: "vplt-2026", editionActive: false, assigneeUid: null });
    expect((await fails(service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "evento", expectedRevision: 1 }))).message).toBe("outreach/invalid-transition");
    expect((await fails(service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "inscripcion", expectedRevision: 9 }))).message).toBe("outreach/conflict");
    const t1 = await service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "inscripcion", expectedRevision: 1 });
    expect(t1).toMatchObject({ status: "inscripcion", revision: 2, denormalized: true, processed: 250 });
    expect(store.all("outreachRegistrations").every((r) => r.data.editionActive === true && r.data.receptionOpen === false)).toBe(true);
    expect(store.doc("outreachDecisions", "r0003")!.editionActive).toBe(true);
    // ningún lote de la denormalización excede 100 inscripciones + sus decisiones
    expect(store.commits.every((c) => c.length <= 300)).toBe(true);
    const again = await service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "inscripcion", expectedRevision: 1 });
    expect(again.replay).toBe(true);
    await service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "evento", expectedRevision: 2 });
    expect(store.doc("outreachRegistrations", "r0100")!.receptionOpen).toBe(true);
    expect((await fails(service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "inscripcion", expectedRevision: 3 }))).message).toBe("outreach/reason-required");
    await service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "inscripcion", expectedRevision: 3, reason: "se adelantó" });
    expect(store.doc("outreachRegistrations", "r0100")!.receptionOpen).toBe(false);
  });
  it("la denormalización se reanuda desde el cursor si se interrumpe", async () => {
    const { service, store } = setup();
    await service.editionCreate("sim-coord", { year: 2026, eventDate: EVENT });
    for (let i = 0; i < 150; i += 1) store.put("outreachRegistrations", `r${String(i).padStart(4, "0")}`, { editionId: "vplt-2026", editionActive: false, receptionOpen: false, status: "activa" });
    store.failNextTransaction = null;
    // La primera transacción es la de la transición; hacemos fallar la del primer lote.
    const real = store.runTransaction.bind(store);
    let calls = 0;
    store.runTransaction = ((fn: never) => {
      calls += 1;
      if (calls === 2) return Promise.reject(Object.assign(new Error("corte"), { code: 14 }));
      return real(fn);
    }) as typeof store.runTransaction;
    await fails(service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "inscripcion", expectedRevision: 1 }));
    store.runTransaction = real;
    expect(store.doc("outreachEditions", "vplt-2026")!.denorm).toMatchObject({ done: false });
    const resumed = await service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "inscripcion", expectedRevision: 1 });
    expect(resumed.denormalized).toBe(true);
    expect(store.all("outreachRegistrations").every((r) => r.data.editionActive === true)).toBe(true);
  });
  it("teamSet valida usuarios activos y roles; tablesSet exige un responsable del equipo", async () => {
    const { service, store } = setup();
    await service.editionCreate("sim-coord", { year: 2026, eventDate: EVENT });
    expect((await fails(service.teamSet("sim-coord", { editionId: "vplt-2026", members: [{ uid: "inactive", roles: ["responsable"] }] }))).message).toBe("outreach/invalid-user");
    expect((await fails(service.teamSet("sim-coord", { editionId: "vplt-2026", members: [{ uid: "ghost", roles: ["responsable"] }] }))).message).toBe("outreach/invalid-user");
    expect((await fails(service.teamSet("sim-coord", { editionId: "vplt-2026", members: [{ uid: "sim-resp-01", roles: ["jefe"] }] }))).message).toBe("outreach/invalid-argument");
    const members = [{ uid: "sim-resp-01", roles: ["responsable"] }, { uid: "sim-recep-1", roles: ["recepcion"] }];
    await service.teamSet("sim-coord", { editionId: "vplt-2026", members });
    await service.teamSet("sim-coord", { editionId: "vplt-2026", members });
    expect(store.all("outreachEditions/vplt-2026/team")).toHaveLength(2);
    expect((await fails(service.tablesSet("sim-coord", { editionId: "vplt-2026", tables: [{ number: 1, leaderUid: "sim-recep-1" }] }))).message).toBe("outreach/invalid-leader");
    const t = [{ number: 1, leaderUid: "sim-resp-01" }];
    await service.tablesSet("sim-coord", { editionId: "vplt-2026", tables: t });
    await service.tablesSet("sim-coord", { editionId: "vplt-2026", tables: t });
    expect(store.doc("outreachEditions/vplt-2026/tables", "1")).toMatchObject({ leaderUid: "sim-resp-01", linkActive: false });
  });
});

describe("enlace de mesa (sin sesión)", () => {
  async function ready() {
    const ctx = setup();
    await bootstrap(ctx);
    const toks = await tokens(ctx.service, 3);
    ctx.store.put("outreachRegistrations", "p1", { id: "p1", editionId: "vplt-2026", fullName: "Persona Ficticia", status: "activa", source: "web", attendance: "sin_confirmar", consents: [], doNotContact: false, ownerUid: null, assignmentBatchId: null, locallyEdited: [], followUp: { lastContactAt: null, lastResult: null, attempts: 0, nextAction: null, nextActionDate: null }, memberPersonId: null, handedOffAt: null, createdAt: "2026-11-01T10:00", revision: 1, editionActive: true, receptionOpen: true, assigneeUid: null, ticketCode: "VP001" });
    return { ...ctx, toks, base: (n: number) => ({ editionId: "vplt-2026", table: n, token: toks[n] }) };
  }
  it("token mal formado, incorrecto o de otra mesa → mismo rechazo genérico", async () => {
    const { service, toks, base } = await ready();
    for (const token of ["corto", "A".repeat(43), toks[2]]) {
      const r = await fails(service.tableSearch({ ...base(1), token, q: "Persona" }));
      expect(["outreach/link-unavailable", "outreach/invalid-argument"]).toContain(r.message);
      expect(r.code).not.toBe("internal");
    }
    expect((await fails(service.tableSearch({ ...base(1), token: "A".repeat(43), q: "Persona" }))).message).toBe("outreach/link-unavailable");
  });
  it("search: solo {id, fullName, tableNumber, mark}, máx. 8; por código o ≥3 letras", async () => {
    const { service, store, base } = await ready();
    for (let i = 0; i < 12; i += 1) store.put("outreachRegistrations", `q${i}`, { ...store.doc("outreachRegistrations", "p1"), id: `q${i}`, fullName: `Carlos Prueba ${i}`, ticketCode: `Q${i}ZZ` });
    const byCode = await service.tableSearch({ ...base(1), q: "vp001" });
    expect(byCode.rows).toEqual([{ id: "p1", fullName: "Persona Ficticia", tableNumber: null, mark: null }]);
    expect((await service.tableSearch({ ...base(1), q: "carl" })).rows).toHaveLength(8);
    expect((await service.tableSearch({ ...base(1), q: "ca" })).rows).toEqual([]);
    expect(Object.keys(byCode.rows[0]).sort()).toEqual(["fullName", "id", "mark", "tableNumber"]);
  });
  it("mark/unmark/addWalkIn: repetir no cambia nada; auditoría sin token ni valor", async () => {
    const { service, store, base, toks } = await ready();
    const m = { ...base(1), registrationId: "p1", mark: "acepto_a_cristo", personAgreed: true, requestId: rid() };
    expect((await service.tableMark(m)).replay).toBe(false);
    expect((await service.tableMark(m)).replay).toBe(true);
    expect((await service.tableMark({ ...m, requestId: rid() })).replay).toBe(true); // mismo valor y mesa
    expect(store.all("outreachDecisions")).toHaveLength(1);
    expect(store.doc("outreachRegistrations", "p1")).toMatchObject({ tableNumber: 1, attendance: "asistio", editionActive: true, assigneeUid: null });
    expect(store.doc("outreachDecisions", "p1")).toMatchObject({ value: "acepto_a_cristo", editionActive: true, assigneeUid: null, tableNumber: 1 });
    // otra mesa: rechazo con la mesa actual; con moveHere pasa
    const other = await fails(service.tableMark({ ...base(2), registrationId: "p1", mark: "desea_conversar", personAgreed: true, requestId: rid() }));
    expect(other).toMatchObject({ message: "outreach/otra-mesa", details: { otherTable: 1 } });
    expect((await service.tableMark({ ...base(2), registrationId: "p1", mark: "desea_conversar", personAgreed: true, moveHere: true, requestId: rid() })).replay).toBe(false);
    // sin permiso de la persona
    expect((await fails(service.tableMark({ ...base(2), registrationId: "p1", mark: "acepto_a_cristo", personAgreed: false, requestId: rid() }))).message).toBe("outreach/sin-permiso-persona");
    // deshacer solo la mesa que marcó
    expect((await fails(service.tableUnmark({ ...base(1), registrationId: "p1", requestId: rid() }))).message).toBe("outreach/no-es-de-esta-mesa");
    const un = { ...base(2), registrationId: "p1", requestId: rid() };
    expect((await service.tableUnmark(un)).replay).toBe(false);
    expect((await service.tableUnmark(un)).replay).toBe(true);
    expect(store.doc("outreachDecisions", "p1")).toBeUndefined();
    expect(store.all("outreachDecisions/p1/history").map((h) => h.data.action).sort()).toEqual(["cambio", "marca", "retirada"]);
    // walk-in idempotente por requestId
    const w = { ...base(3), fullName: "Visita Sin Inscripción", phone: "9 8765 4321", requestId: rid() };
    const first = await service.tableAddWalkIn(w);
    expect((await service.tableAddWalkIn(w)).replay).toBe(true);
    expect(first.row).toMatchObject({ fullName: "Visita Sin Inscripción", tableNumber: 3, mark: null });
    expect(store.all("outreachRegistrations").filter((r) => r.data.source === "mesa")).toHaveLength(1);
    // auditoría: mesa, operación, inscripción y momento; nunca token ni decisión
    const audit = JSON.stringify(store.all("outreachTableMarks"));
    for (const t of Object.values(toks)) expect(audit).not.toContain(t);
    expect(audit).not.toMatch(/acepto_a_cristo|desea_conversar/);
    expect(store.all("outreachTableMarks").every((a) => Object.keys(a.data).sort().join() === "at,editionId,op,registrationId,table")).toBe(true);
  });
  it("walk-in con teléfono repetido genera revisión, no fusiona", async () => {
    const { service, store, base } = await ready();
    store.put("outreachRegistrations", "p2", { ...store.doc("outreachRegistrations", "p1"), id: "p2", phoneE164: "+56987654321" });
    await service.tableAddWalkIn({ ...base(1), fullName: "Otra Persona", phone: "987654321", requestId: rid() });
    expect(store.all("outreachInbox").filter((r) => r.data.issue === "posible_duplicado")).toHaveLength(1);
    expect((await fails(service.tableAddWalkIn({ ...base(1), fullName: "Nombre Ok", phone: "123", requestId: rid() }))).message).toBe("outreach/telefono-invalido");
  });
  it("revocado, reemitido, fuera de ventana y cuota por mesa", async () => {
    const { service, clock, base, toks } = await ready();
    const q = { q: "Persona" };
    expect((await service.tableSearch({ ...base(1), ...q })).rows).toHaveLength(1);
    await service.tableLinkRevoke("sim-coord", { editionId: "vplt-2026", number: 1 });
    expect((await service.tableLinkRevoke("sim-coord", { editionId: "vplt-2026", number: 1 })).replay).toBe(true);
    expect((await fails(service.tableSearch({ ...base(1), ...q }))).message).toBe("outreach/link-revoked");
    const fresh = (await service.tableLinkIssue("sim-coord", { editionId: "vplt-2026", number: 1 })).token;
    expect(fresh).not.toBe(toks[1]);
    expect((await fails(service.tableSearch({ ...base(1), ...q }))).message).toBe("outreach/link-unavailable"); // el anterior ya no sirve
    expect((await service.tableSearch({ editionId: "vplt-2026", table: 1, token: fresh, ...q })).rows).toHaveLength(1);
    // cuota: RATE_LIMIT.max por ventana, luego se libera
    for (let i = 0; i < RATE_LIMIT.max - 1; i += 1) await service.tableSearch({ editionId: "vplt-2026", table: 1, token: fresh, ...q });
    expect((await fails(service.tableSearch({ editionId: "vplt-2026", table: 1, token: fresh, ...q }))).message).toBe("outreach/rate-limited");
    expect((await service.tableSearch({ ...base(2), ...q })).rows).toHaveLength(1); // otra mesa no se ve afectada
    clock.advance(RATE_LIMIT.windowMs + 1000);
    expect((await service.tableSearch({ editionId: "vplt-2026", table: 1, token: fresh, ...q })).rows).toHaveLength(1);
    clock.set("2026-11-28T15:00:00-03:00");
    expect((await fails(service.tableSearch({ editionId: "vplt-2026", table: 1, token: fresh, ...q }))).message).toBe("outreach/link-out-of-window");
    clock.set("2026-11-29T03:00:00-03:00");
    expect((await fails(service.tableSearch({ editionId: "vplt-2026", table: 1, token: fresh, ...q }))).message).toBe("outreach/link-out-of-window");
  });
  it("tableLinkIssue guarda solo el hash (nunca el token en claro)", async () => {
    const { store, toks } = await ready();
    const all = JSON.stringify(store.allWithPrefix("outreach"));
    for (const t of Object.values(toks)) expect(all).not.toContain(t);
    expect(store.doc("outreachEditions/vplt-2026/tableSecrets", "1")!.linkHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(store.doc("outreachEditions/vplt-2026/tables", "1"))).not.toContain("linkHash");
  });
  it("errores inesperados: log sin token ni PII", async () => {
    const { service, store, logger, base, toks } = await ready();
    store.failNextTransaction = Object.assign(new Error(`boom ${toks[1]}`), { code: 13 });
    const r = await fails(service.tableSearch({ ...base(1), q: "Persona" }));
    expect(r.message).toBe("outreach/internal");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(toks[1]);
  });
});

describe("seguimiento, reasignación y decisiones", () => {
  async function withPeople() {
    const ctx = setup();
    await bootstrap(ctx);
    const regs = simRegistrations({ count: 6 }).map((r, i) => rowOf(r, i < 4));
    await ctx.service.importRegistrations("sim-coord", { editionId: "vplt-2026", rows: regs });
    const ids = regs.map((r) => registrationIdFor("vplt-2026", r.externalId));
    const toks = await tokens(ctx.service, 2);
    for (const id of ids.slice(0, 4)) await ctx.service.tableMark({ editionId: "vplt-2026", table: 1, token: toks[1], registrationId: id, mark: "desea_conversar", personAgreed: true, requestId: rid() });
    await ctx.service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "seguimiento", expectedRevision: 3 });
    const prop = await ctx.service.distributionPropose("sim-coord", { editionId: "vplt-2026", requestId: rid() });
    await ctx.service.distributionConfirm("sim-coord", { editionId: "vplt-2026", batchId: prop.batchId });
    return { ...ctx, ids, owner: "sim-resp-01" };
  }
  it("contactRecord: idempotente, solo el responsable, re-verificado al reasignar", async () => {
    const { service, store, ids, owner } = await withPeople();
    const id = ids[0];
    expect(store.doc("outreachRegistrations", id)).toMatchObject({ ownerUid: owner, assigneeUid: owner });
    const c = { editionId: "vplt-2026", registrationId: id, requestId: rid(), date: "2026-11-30", channel: "llamada", result: "contactado", nextAction: "Visitar", nextActionDate: "2026-12-03" };
    expect((await fails(service.contactRecord("sim-resp-02", c))).message).toBe("outreach/not-assigned");
    const a = await service.contactRecord(owner, c);
    const b = await service.contactRecord(owner, c);
    expect([a.replay, b.replay]).toEqual([false, true]);
    expect(store.all(`outreachRegistrations/${id}/contacts`)).toHaveLength(1);
    // reasignada: el anterior pierde el acceso (misma transacción)
    const rev = store.doc("outreachRegistrations", id)!.revision as number;
    const re = { editionId: "vplt-2026", registrationId: id, toUid: "sim-resp-02", reason: "carga", expectedRevision: rev };
    expect((await service.reassign("sim-coord", re)).replay).toBe(false);
    expect((await service.reassign("sim-coord", re)).replay).toBe(true);
    expect((await service.reassign("sim-coord", { ...re, reason: "otra" })).replay).toBe(true);
    expect((await fails(service.contactRecord(owner, { ...c, requestId: rid() }))).message).toBe("outreach/not-assigned");
    expect(store.doc("outreachRegistrations", id)!.assigneeUid).toBe("sim-resp-02");
    expect(store.doc("outreachDecisions", id)!.assigneeUid).toBe("sim-resp-02");
    expect((await service.contactRecord("sim-resp-02", { ...c, requestId: rid() })).replay).toBe(false);
    expect((await fails(service.reassign("sim-coord", { ...re, expectedRevision: 99, toUid: "sim-recep-1" }))).message).toBe("outreach/conflict");
  });
  it("opt-out cancela la cola de salida en la misma transacción y doNotContactSet es idempotente", async () => {
    const { service, store, ids, owner } = await withPeople();
    const [a, b] = [ids[0], ids[1]];
    store.put("outreachOutbox", "k1", { key: "k1", registrationId: a, editionId: "vplt-2026", status: "pendiente", attempts: 0, lastError: null, payload: {} });
    store.put("outreachOutbox", "k2", { key: "k2", registrationId: b, editionId: "vplt-2026", status: "pendiente", attempts: 0, lastError: null, payload: {} });
    const before = store.commits.length;
    await service.contactRecord(owner, { editionId: "vplt-2026", registrationId: a, requestId: rid(), date: "2026-11-30", channel: "whatsapp", result: "pidio_no_contacto" });
    expect(store.commits.length).toBe(before + 1); // una sola transacción confirmada
    expect(store.doc("outreachOutbox", "k1")!.status).toBe("cancelado");
    expect(store.doc("outreachOutbox", "k2")!.status).toBe("pendiente");
    expect(store.doc("outreachRegistrations", a)).toMatchObject({ doNotContact: true });
    const s = { editionId: "vplt-2026", registrationId: b, value: true };
    expect((await service.doNotContactSet(owner, s)).replay).toBe(false);
    expect((await service.doNotContactSet(owner, s)).replay).toBe(true);
    expect(store.doc("outreachOutbox", "k2")!.status).toBe("cancelado");
    expect((await fails(service.doNotContactSet("sim-resp-02", { ...s, registrationId: ids[2] }))).message).toBe("outreach/not-assigned");
    expect((await fails(service.doNotContactSet(owner, { ...s, value: false, reason: "x" }))).message).toBe("outreach/forbidden");
    expect((await service.doNotContactSet("sim-coord", { ...s, value: false, reason: "lo pidió" })).replay).toBe(false);
  });
  it("releaseAssignee devuelve a la cola de coordinación (idempotente)", async () => {
    const { service, store, ids, owner } = await withPeople();
    const r = await service.releaseAssignee("sim-coord", { editionId: "vplt-2026", uid: owner, reason: "se fue" });
    expect(r).toMatchObject({ done: true });
    expect(r.released).toBeGreaterThan(0);
    expect(store.doc("outreachRegistrations", ids[0])).toMatchObject({ ownerUid: null, assigneeUid: null });
    expect(store.doc("outreachDecisions", ids[0])!.assigneeUid).toBeNull();
    expect((await service.releaseAssignee("sim-coord", { editionId: "vplt-2026", uid: owner, reason: "se fue" })).released).toBe(0);
  });
  it("decisionRecord (por la persona, con versión de consentimiento) y decisionList", async () => {
    const { service, store, ids } = await withPeople();
    const id = ids[5]; // no asistió ni marcó
    const d = { editionId: "vplt-2026", registrationId: id, value: "acepto_a_cristo", declaredBy: "la_persona", consentTextVersion: "coord-2026-1", requestId: rid() };
    expect((await fails(service.decisionRecord("pastor", { ...d, declaredBy: "otro" }))).message).toBe("outreach/invalid-argument");
    expect((await service.decisionRecord("pastor", d)).replay).toBe(false);
    expect((await service.decisionRecord("pastor", d)).replay).toBe(true);
    expect((await service.decisionRecord("admin", { ...d, requestId: rid(), value: "desea_conversar" })).replay).toBe(false);
    expect(store.doc("outreachDecisions", id)).toMatchObject({ value: "desea_conversar", recordedBy: "admin", declaredBy: "la_persona" });
    expect(store.all(`outreachDecisions/${id}/history`)).toHaveLength(2);
    const list = await service.decisionList("pastor", { editionId: "vplt-2026", limit: 3 });
    expect(list.rows).toHaveLength(3);
    expect(list.nextCursor).toBeTruthy();
    const rest = await service.decisionList("pastor", { editionId: "vplt-2026", cursor: list.nextCursor });
    expect(list.rows.length + rest.rows.length).toBe(5);
    expect(list.rows[0]).toHaveProperty("fullName");
  });
  it("stats: la coordinación sin permiso de decisiones no ve decisiones; con permiso, celdas <5 suprimidas", async () => {
    const { service } = await withPeople();
    const plain = await service.stats("sim-coord", { editionId: "vplt-2026" });
    expect(plain.decisions).toBeUndefined();
    expect(JSON.stringify(plain)).not.toMatch(/accepted|wantsToTalk|desea_conversar/);
    const full = await service.stats("decisor-coord", { editionId: "vplt-2026" });
    expect(full.decisions.summary.desea_conversar).toBe(4);
    expect(full.decisions.byTable.every((t: { accepted: number | null; wantsToTalk: number | null }) => t.accepted === null && t.wantsToTalk === null)).toBe(true);
    const ds = await service.decisionStats("pastor", { editionId: "vplt-2026" });
    expect(ds.suppressedBelow).toBe(5);
  });
});

describe("simulación completa: 300 personas, 35 mesas", () => {
  it("de la inscripción al seguimiento, con idempotencia, sin tocar members* ni Finanzas", async () => {
    const ctx = setup();
    const { service, store, clock, logger } = ctx;
    const { leaders } = await bootstrap(ctx, "inscripcion");
    expect(leaders).toHaveLength(35);

    // Enlaces de las 35 mesas
    const toks = await tokens(service);
    expect(new Set(Object.values(toks)).size).toBe(35);

    // Importación: 300; 240 ya marcaron llegada en la puerta del sitio.
    const sim = simRegistrations({ count: 300 });
    const rows = sim.map((r, i) => rowOf(r, i < 240));
    const dry = await service.importRegistrations("sim-coord", { editionId: "vplt-2026", rows, dryRun: true });
    expect(dry.report).toMatchObject({ created: 300, unchanged: 0 });
    expect(store.all("outreachRegistrations")).toHaveLength(0);
    const apply = await service.importRegistrations("sim-coord", { editionId: "vplt-2026", rows });
    expect(apply.report).toMatchObject({ created: 300, updated: 0, toReview: 0 });
    const commitsAfterImport = store.commits.length;
    const again = await service.importRegistrations("sim-coord", { editionId: "vplt-2026", rows });
    expect(again.report).toMatchObject({ created: 0, updated: 0, cancelled: 0, unchanged: 300 });
    expect(store.commits.length).toBe(commitsAfterImport); // ningún cambio
    expect(store.all("outreachRegistrations")).toHaveLength(300);
    expect(store.all("outreachRegistrations").every((r) => r.data.editionActive === true && r.data.receptionOpen === false)).toBe(true);

    // Día del evento
    await service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "evento", expectedRevision: 2 });
    expect(store.all("outreachRegistrations").every((r) => r.data.receptionOpen === true)).toBe(true);
    const id = (i: number) => registrationIdFor("vplt-2026", rows[i].externalId);

    // 35 mesas marcan a sus 240 asistentes (~1/3 «Aceptó a Cristo»)
    let accepted = 0;
    for (let i = 0; i < 240; i += 1) {
      const table = (i % 35) + 1;
      const mark = i % 3 === 0 ? "acepto_a_cristo" : "desea_conversar";
      if (mark === "acepto_a_cristo") accepted += 1;
      await service.tableMark({ editionId: "vplt-2026", table, token: toks[table], registrationId: id(i), mark, personAgreed: true, requestId: rid() });
    }
    // Llegadas sin inscripción, en su mesa
    for (let k = 0; k < 10; k += 1) {
      const table = k + 1;
      const w = await service.tableAddWalkIn({ editionId: "vplt-2026", table, token: toks[table], fullName: `Visita Mesa ${k}`, phone: `9 7000 ${String(1000 + k)}`, requestId: rid() });
      expect(w.row.tableNumber).toBe(table);
    }
    expect(store.all("outreachDecisions")).toHaveLength(240);

    // Coordinación confirma 40 ausencias de forma explícita (60 sin confirmar → 20 quedan)
    const unknown = store.all("outreachRegistrations").filter((r) => r.data.attendance === "sin_confirmar" && r.data.status === "activa");
    expect(unknown).toHaveLength(60);
    const absent = unknown.slice(0, 40).map((r) => r.id);
    expect((await fails(service.confirmAbsences("sim-coord", { editionId: "vplt-2026", ids: absent, expectedUnknownCount: 59 }))).message).toBe("outreach/conflict");
    expect(await service.confirmAbsences("sim-coord", { editionId: "vplt-2026", ids: absent, expectedUnknownCount: 60 })).toMatchObject({ confirmed: 40, skipped: [] });
    expect((await service.confirmAbsences("sim-coord", { editionId: "vplt-2026", ids: absent, expectedUnknownCount: 20 })).confirmed).toBe(0);

    // Seguimiento: distribución por mesa
    await service.editionTransition("sim-coord", { editionId: "vplt-2026", to: "seguimiento", expectedRevision: 3 });
    expect(store.all("outreachRegistrations").every((r) => r.data.receptionOpen === false && r.data.editionActive === true)).toBe(true);
    const reqId = rid();
    const prop = await service.distributionPropose("sim-coord", { editionId: "vplt-2026", requestId: reqId });
    expect((await service.distributionPropose("sim-coord", { editionId: "vplt-2026", requestId: reqId })).replay).toBe(true);
    expect(prop.summary.assignments).toBe(250);
    const conf = await service.distributionConfirm("sim-coord", { editionId: "vplt-2026", batchId: prop.batchId });
    expect(conf).toMatchObject({ applied: 250, conflicts: [] });
    expect((await service.distributionConfirm("sim-coord", { editionId: "vplt-2026", batchId: prop.batchId })).replay).toBe(true);

    const regs = store.all("outreachRegistrations").map((r) => r.data);
    const byOwner: Record<string, number> = {};
    for (const r of regs) if (r.ownerUid) byOwner[r.ownerUid as string] = (byOwner[r.ownerUid as string] || 0) + 1;
    expect(Math.max(...Object.values(byOwner))).toBeLessThanOrEqual(20);
    const leaderOf = new Map(leaders.map((m, i) => [i + 1, m.uid]));
    const seated = regs.filter((r) => r.attendance === "asistio");
    expect(seated).toHaveLength(250);
    expect(seated.every((r) => r.ownerUid === leaderOf.get(r.tableNumber as number) && r.assigneeUid === r.ownerUid)).toBe(true);
    expect(regs.filter((r) => r.ownerUid)).toHaveLength(250);
    // las decisiones siguen a su responsable
    expect(store.all("outreachDecisions").every((d) => d.data.assigneeUid === leaderOf.get(d.data.tableNumber as number) && d.data.editionActive === true)).toBe(true);

    // Cada responsable registra el primer contacto de su mesa; 40 piden no ser contactados
    clock.set("2026-11-30T12:00:00-03:00");
    const mine = regs.filter((r) => r.ownerUid);
    let optOuts = 0;
    for (const [n, r] of mine.entries()) {
      const out = n % 6 === 0 && optOuts < 40;
      if (out) optOuts += 1;
      const call = { editionId: "vplt-2026", registrationId: r.id as string, requestId: rid(), date: "2026-11-30", channel: "whatsapp", result: out ? "pidio_no_contacto" : "contactado" };
      if (!r.consents || !(r.consents as { purpose: string }[]).some((c) => c.purpose === "seguimiento_evento")) throw new Error("sin consentimiento");
      expect((await service.contactRecord(r.ownerUid, call)).replay).toBe(false);
      if (n % 17 === 0) expect((await service.contactRecord(r.ownerUid, call)).replay).toBe(true);
    }
    expect(optOuts).toBe(40);

    // Estadísticas consistentes
    const stats = await service.stats("decisor-coord", { editionId: "vplt-2026" });
    expect(stats.metrics).toMatchObject({ registered: 310, attended: 250, absentConfirmed: 40, attendancePending: 20, optedOut: 40, assigned: 250, walkIns: 0 });
    expect(stats.tables.reduce((a: number, t: { people: number }) => a + t.people, 0)).toBe(250);
    expect(stats.decisions.summary.acepto_a_cristo + stats.decisions.summary.desea_conversar).toBe(240);
    expect(stats.decisions.summary.acepto_a_cristo).toBe(accepted);

    // Privacidad: ninguna decisión fuera de outreachDecisions (+ historial)
    const leaked = store.allWithPrefix("outreach").filter((d) => !d.collection.startsWith("outreachDecisions") && /acepto_a_cristo|desea_conversar/.test(JSON.stringify(d.data)));
    expect(leaked).toEqual([]);
    // Token jamás guardado en claro ni logueado
    const dump = JSON.stringify([...store.collections.entries()].map(([c, m]) => [c, [...m.entries()]]));
    for (const t of Object.values(toks)) expect(dump).not.toContain(t);
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/[A-Za-z0-9_-]{43}/);
    // Nada en members* ni Finanzas: solo outreach* y (lectura) users
    const touched = new Set(store.commits.flat().map((w) => w.collection.split("/")[0]));
    expect([...touched].every((c) => c.startsWith("outreach"))).toBe(true);
    expect([...touched].some((c) => /^(members|finance|sumup|tithe|offering|calendar)/i.test(c))).toBe(false);
  });
});
