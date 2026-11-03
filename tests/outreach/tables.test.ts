import { describe, expect, it } from "vitest";
import { proposeDistribution } from "@/lib/outreach/distribution";
import type { DecisionRecord, Registration } from "@/lib/outreach/model";
import { SIM_EDITION, simDecisions, simRegistrations, simTables, simTeam, withAttendance, withTables } from "@/lib/outreach/sim/fixtures";
import {
  TABLE_CONSENT_VERSION,
  addAtTable,
  linkUsable,
  markAtTable,
  searchForTable,
  seatAtTable,
  tableAffinity,
  tableLinkWindow,
  tableSummaries,
  unmarkAtTable,
  type EventTable,
} from "@/lib/outreach/tables";
import { consent, reg } from "./helpers";

const D = "2026-11-28";
const OPEN = "2026-11-28T20:00";
const table = (over: Partial<EventTable> = {}): EventTable => ({ number: 3, leaderUid: "sim-resp-03", leaderName: "Encargado Tres", linkHash: "h3", linkRevokedAt: null, ...over });
const person = (over: Partial<Registration> = {}) => reg({ id: "p1", fullName: "José Pérez Soto", ticketCode: "VP001", ...over });
type State = { registrations: Registration[]; decisions: DecisionRecord[] };
const mark = (state: State, over: Partial<Parameters<typeof markAtTable>[1]> = {}) =>
  markAtTable(state, { table: table(), eventDate: D, registrationId: "p1", mark: "acepto_a_cristo", personAgreed: true, now: OPEN, ...over });
const st = (...r: Registration[]): State => ({ registrations: r, decisions: [] });
const must = (r: ReturnType<typeof mark>): State => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("ventana del enlace de mesa", () => {
  it("abre el día D a las 16:00 y cierra a las 02:00 del día siguiente", () => {
    expect(tableLinkWindow(D)).toEqual({ opensAt: "2026-11-28T16:00", closesAt: "2026-11-29T02:00" });
  });
  it("cruza el fin de mes (30/11 → 01/12) y de año", () => {
    expect(tableLinkWindow("2026-11-30").closesAt).toBe("2026-12-01T02:00");
    expect(tableLinkWindow("2026-12-31").closesAt).toBe("2027-01-01T02:00");
  });
  it("es usable dentro de la ventana y excluye el instante de cierre", () => {
    expect(linkUsable(table(), D, "2026-11-28T16:00")).toEqual({ ok: true });
    expect(linkUsable(table(), D, "2026-11-29T01:59")).toEqual({ ok: true });
    expect(linkUsable(table(), D, "2026-11-29T02:00")).toEqual({ ok: false, error: "fuera_de_horario" });
    expect(linkUsable(table(), D, "2026-11-28T15:59")).toEqual({ ok: false, error: "fuera_de_horario" });
  });
  it("rechaza enlace revocado, inexistente o edición sin fecha", () => {
    expect(linkUsable(table({ linkRevokedAt: "2026-11-28T18:00" }), D, OPEN)).toEqual({ ok: false, error: "revocado" });
    expect(linkUsable(table({ linkHash: null }), D, OPEN)).toEqual({ ok: false, error: "sin_enlace" });
    expect(linkUsable(table(), null, OPEN)).toEqual({ ok: false, error: "sin_fecha" });
  });
});

describe("searchForTable", () => {
  const regs = [
    person(),
    person({ id: "p2", fullName: "Josefa Araya", ticketCode: "VP002" }),
    person({ id: "p3", fullName: "María José Díaz", ticketCode: "VP003" }),
    person({ id: "p4", fullName: "José Anulado", ticketCode: "VP004", status: "cancelada" }),
  ];
  it("encuentra por código exacto sin importar mayúsculas ni guiones", () => {
    expect(searchForTable(regs, [], "vp-001").map((r) => r.id)).toEqual(["p1"]);
    expect(searchForTable(regs, [], " VP 002 ").map((r) => r.id)).toEqual(["p2"]);
  });
  it("encuentra por prefijo de nombre sin tildes", () => {
    expect(searchForTable(regs, [], "jose").map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
  });
  it("exige que todas las palabras coincidan", () => {
    expect(searchForTable(regs, [], "jose perez").map((r) => r.id)).toEqual(["p1"]);
    expect(searchForTable(regs, [], "jose araya").map((r) => r.id)).toEqual(["p2"]);
    expect(searchForTable(regs, [], "jose zzz")).toEqual([]);
  });
  it("con menos de 3 letras no devuelve nada", () => {
    expect(searchForTable(regs, [], "jo")).toEqual([]);
    expect(searchForTable(regs, [], "  ")).toEqual([]);
  });
  it("devuelve como máximo 8 resultados", () => {
    const many = Array.from({ length: 20 }, (_, i) => person({ id: `m${i}`, fullName: `Ana ${i}`, ticketCode: `VP9${i}` }));
    expect(searchForTable(many, [], "ana")).toHaveLength(8);
  });
  it("solo considera inscripciones activas", () => {
    expect(searchForTable(regs, [], "anulado")).toEqual([]);
    expect(searchForTable(regs, [], "VP004")).toEqual([]);
  });
  it("expone únicamente id, nombre, mesa y marca", () => {
    const rows = searchForTable([person({ email: "x@y.cl", tableNumber: 5 })], [], "jose");
    expect(Object.keys(rows[0]).sort()).toEqual(["fullName", "id", "mark", "tableNumber"]);
    expect(rows[0]).toEqual({ id: "p1", fullName: "José Pérez Soto", tableNumber: 5, mark: null });
  });
  it("refleja la marca más reciente", () => {
    const s = must(mark(st(person())));
    expect(searchForTable(s.registrations, s.decisions, "VP001")[0].mark).toBe("acepto_a_cristo");
  });
});

describe("markAtTable", () => {
  it("exige que la persona haya aceptado", () => {
    expect(mark(st(person()), { personAgreed: false })).toEqual({ ok: false, error: "sin_permiso_persona" });
  });
  it("deja a la persona en la mesa, presente por mesa-N y con consentimiento verbal", () => {
    const s = must(mark(st(person({ consents: [consent("mensajes_whatsapp")] }))));
    const p = s.registrations[0];
    expect(p.tableNumber).toBe(3);
    expect(p).toMatchObject({ attendance: "asistio", attendanceAt: OPEN, attendanceBy: "mesa-3", revision: 2 });
    const c = p.consents.filter((x) => x.purpose === "seguimiento_evento");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ source: "verbal_mesa", textVersion: TABLE_CONSENT_VERSION, revokedAt: null });
    expect(s.decisions).toEqual([
      { registrationId: "p1", editionId: "vplt-2026", value: "acepto_a_cristo", declaredBy: "la_persona", consentTextVersion: TABLE_CONSENT_VERSION, recordedAt: OPEN, recordedBy: "mesa-3", tableNumber: 3 },
    ]);
  });
  it("no toca la asistencia ya registrada ni duplica el consentimiento vigente", () => {
    const base = person({ attendance: "asistio", attendanceAt: "2026-11-28T19:00", attendanceBy: "sim-recep-1" });
    const p = must(mark(st(base))).registrations[0];
    expect(p).toMatchObject({ attendanceAt: "2026-11-28T19:00", attendanceBy: "sim-recep-1" });
    expect(p.consents).toEqual(base.consents);
  });
  it("agrega el consentimiento si el anterior fue revocado", () => {
    const p = must(mark(st(person({ consents: [consent("seguimiento_evento", "2026-11-12T10:00")] })))).registrations[0];
    expect(p.consents.filter((c) => c.revokedAt === null && c.source === "verbal_mesa")).toHaveLength(1);
  });
  it("repetir la misma marca devuelve sin_cambio", () => {
    expect(mark(must(mark(st(person()))))).toEqual({ ok: false, error: "sin_cambio" });
  });
  it("cambiar la marca agrega una decisión más nueva, incluso dentro del mismo minuto", () => {
    const s2 = must(mark(must(mark(st(person()))), { mark: "desea_conversar" }));
    expect(s2.decisions).toHaveLength(2);
    expect(searchForTable(s2.registrations, s2.decisions, "VP001")[0].mark).toBe("desea_conversar");
    const s3 = must(mark(s2, { mark: "acepto_a_cristo", now: "2026-11-28T20:05" }));
    expect(searchForTable(s3.registrations, s3.decisions, "VP001")[0].mark).toBe("acepto_a_cristo");
  });
  it("si está en otra mesa responde otra_mesa, salvo que se confirme moveHere", () => {
    const s = st(person({ tableNumber: 7 }));
    expect(mark(s)).toEqual({ ok: false, error: "otra_mesa", otherTable: 7 });
    expect(must(mark(s, { moveHere: true })).registrations[0].tableNumber).toBe(3);
  });
  it("rechaza a quien pidió no ser contactado, inscripciones inactivas e ids desconocidos", () => {
    expect(mark(st(person({ doNotContact: true })))).toEqual({ ok: false, error: "pidio_no_contacto" });
    expect(mark(st(person({ status: "cancelada" })))).toEqual({ ok: false, error: "inscripcion_inactiva" });
    expect(mark(st(person()), { registrationId: "zz" })).toEqual({ ok: false, error: "no_encontrada" });
  });
  it("respeta la ventana y el enlace", () => {
    expect(mark(st(person()), { now: "2026-11-29T02:00" })).toEqual({ ok: false, error: "fuera_de_horario" });
    expect(mark(st(person()), { table: table({ linkRevokedAt: "2026-11-28T17:00" }) })).toEqual({ ok: false, error: "revocado" });
  });
  it("nunca asigna ni traspasa: dueño, seguimiento y persona vinculada quedan igual", () => {
    const base = person({ ownerUid: "otro", memberPersonId: "m1", assignmentBatchId: "lote-0" });
    const p = must(mark(st(base))).registrations[0];
    expect(p.ownerUid).toBe("otro");
    expect(p.memberPersonId).toBe("m1");
    expect(p.assignmentBatchId).toBe("lote-0");
    expect(p.followUp).toEqual(base.followUp);
    expect(p.handedOffAt).toBeNull();
    const free = must(mark(st(person()))).registrations[0];
    expect(free.ownerUid).toBeNull();
    expect(free.memberPersonId).toBeNull();
    expect(free.assignmentBatchId).toBeNull();
  });
});

describe("seatAtTable", () => {
  const seat = (state: State, over: Partial<Parameters<typeof seatAtTable>[1]> = {}) => seatAtTable(state, { table: table(), eventDate: D, registrationId: "p1", now: OPEN, ...over });
  it("sienta, marca asistencia por mesa-N y no crea decisión ni consentimiento", () => {
    const r = seat(st(person({ consents: [] })));
    if (!r.ok) throw new Error(r.error);
    const p = r.value.registrations[0];
    expect(p).toMatchObject({ tableNumber: 3, attendance: "asistio", attendanceBy: "mesa-3", revision: 2 });
    expect(p.consents).toEqual([]);
    expect(r.value.decisions).toEqual([]);
  });
  it("conserva la asistencia ya registrada", () => {
    const r = seat(st(person({ attendance: "asistio", attendanceAt: "2026-11-28T17:00", attendanceBy: "coord" })));
    if (!r.ok) throw new Error(r.error);
    expect(r.value.registrations[0]).toMatchObject({ attendanceAt: "2026-11-28T17:00", attendanceBy: "coord" });
  });
  it("repetir devuelve sin_cambio; otra mesa exige moveHere", () => {
    expect(seat(st(person({ tableNumber: 3 })))).toMatchObject({ ok: false, error: "sin_cambio" });
    expect(seat(st(person({ tableNumber: 5 })))).toMatchObject({ ok: false, error: "otra_mesa", otherTable: 5 });
    const moved = seat(st(person({ tableNumber: 5 })), { moveHere: true });
    expect(moved.ok && moved.value.registrations[0].tableNumber).toBe(3);
  });
  it("rechaza desconocidas, inactivas y enlace/ventana inválidos", () => {
    expect(seat(st(person()), { registrationId: "zz" })).toMatchObject({ error: "no_encontrada" });
    expect(seat(st(person({ status: "cancelada" })))).toMatchObject({ error: "inscripcion_inactiva" });
    expect(seat(st(person()), { now: "2026-11-28T15:00" })).toMatchObject({ error: "fuera_de_horario" });
    expect(seat(st(person()), { table: table({ linkHash: null }) })).toMatchObject({ error: "sin_enlace" });
  });
});

describe("unmarkAtTable", () => {
  const marked = () => must(mark(st(person())));
  it("la mesa que marcó puede deshacer", () => {
    const r = unmarkAtTable(marked(), { table: table(), eventDate: D, registrationId: "p1", now: OPEN });
    expect(r.ok && r.value.decisions).toEqual([]);
  });
  it("otra mesa no puede deshacer", () => {
    expect(unmarkAtTable(marked(), { table: table({ number: 4 }), eventDate: D, registrationId: "p1", now: OPEN })).toEqual({ ok: false, error: "no_es_de_esta_mesa" });
  });
  it("sin marca previa no hay nada que deshacer", () => {
    expect(unmarkAtTable(st(person()), { table: table(), eventDate: D, registrationId: "p1", now: OPEN })).toEqual({ ok: false, error: "sin_cambio" });
  });
  it("fuera de la ventana no deshace", () => {
    expect(unmarkAtTable(marked(), { table: table(), eventDate: D, registrationId: "p1", now: "2026-11-29T03:00" })).toEqual({ ok: false, error: "fuera_de_horario" });
  });
});

describe("addAtTable", () => {
  const input = { table: table(), eventDate: D, editionId: "vplt-2026", fullName: "  Luz   Nueva ", phone: "+56900000555", requestId: "req-1", now: OPEN };
  it("crea la inscripción en la mesa, presente y con consentimiento verbal", () => {
    const r = addAtTable([], input);
    if (!r.ok) throw new Error(r.error);
    expect(r.created).toMatchObject({ fullName: "Luz Nueva", source: "mesa", attendance: "asistio", attendanceBy: "mesa-3", tableNumber: 3, ownerUid: null, status: "activa" });
    expect(r.created.consents).toHaveLength(1);
    expect(r.created.consents[0]).toMatchObject({ purpose: "seguimiento_evento", source: "verbal_mesa", textVersion: TABLE_CONSENT_VERSION });
    expect(r.value).toHaveLength(1);
  });
  it("es idempotente por requestId", () => {
    const a = addAtTable([], input);
    if (!a.ok) throw new Error(a.error);
    const b = addAtTable(a.value, input);
    if (!b.ok) throw new Error(b.error);
    expect(b.created.id).toBe(a.created.id);
    expect(b.value).toHaveLength(1);
  });
  it("valida nombre, teléfono y ventana", () => {
    expect(addAtTable([], { ...input, fullName: " a " })).toEqual({ ok: false, error: "nombre_requerido" });
    expect(addAtTable([], { ...input, phone: "123" })).toEqual({ ok: false, error: "telefono_invalido" });
    expect(addAtTable([], { ...input, now: "2026-11-29T05:00" })).toEqual({ ok: false, error: "fuera_de_horario" });
  });
  it("informa posibles duplicados por teléfono sin fusionarlos", () => {
    const existing = person({ phoneE164: "+56900000555" });
    const inactive = person({ id: "p9", phoneE164: "+56900000555", status: "cancelada" });
    const r = addAtTable([existing, inactive], input);
    if (!r.ok) throw new Error(r.error);
    expect(r.possibleDuplicates).toEqual(["p1"]);
    expect(r.value).toHaveLength(3);
    expect(r.created.duplicateOf).toBeNull();
    expect(r.value[0]).toEqual(existing);
  });
});

describe("mesas + distribución con la simulación (35 mesas)", () => {
  const team = simTeam(35);
  const tables = simTables(team);
  const regs = withTables(withAttendance(simRegistrations()), tables);
  const decisions = simDecisions(regs);
  const opts = { editionId: SIM_EDITION.id, batchId: "lote-1", defaultMax: 20 };

  it("propone a cada asistente autorizado con el encargado de su mesa (vinculo_previo)", () => {
    const p = proposeDistribution(regs, team, { ...opts, affinity: tableAffinity(regs, tables) });
    const leader = new Map(tables.map((t) => [t.number, t.leaderUid]));
    const byId = new Map(regs.map((r) => [r.id, r]));
    expect(p.assignments).toHaveLength(240);
    for (const a of p.assignments) {
      expect(a.reason).toBe("vinculo_previo");
      expect(a.ownerUid).toBe(leader.get(byId.get(a.registrationId)!.tableNumber!));
    }
    for (const n of Object.values(p.loads)) expect(n).toBeLessThanOrEqual(20);
  });

  it("quien no tiene mesa o cuyo encargado está inactivo cae al equilibrio", () => {
    const first = regs.findIndex((x) => x.attendance === "asistio");
    const noTable = regs.map((r, i) => (i === first ? { ...r, tableNumber: null } : r));
    const inactiveTeam = team.map((m) => (m.uid === "sim-resp-01" ? { ...m, active: false } : m));
    const p = proposeDistribution(noTable, inactiveTeam, { ...opts, affinity: tableAffinity(noTable, tables) });
    const byId = new Map(noTable.map((r) => [r.id, r]));
    expect(p.assignments).toHaveLength(240);
    expect(p.assignments.some((a) => a.ownerUid === "sim-resp-01")).toBe(false);
    const fallbacks = p.assignments.filter((a) => a.reason === "equilibrio");
    expect(fallbacks.length).toBeGreaterThan(1);
    for (const a of fallbacks) {
      const r = byId.get(a.registrationId)!;
      expect(r.tableNumber == null || r.tableNumber === 1).toBe(true);
    }
    for (const n of Object.values(p.loads)) expect(n).toBeLessThanOrEqual(20);
  });

  it("tableSummaries coincide con las decisiones simuladas y no trae nombres de personas", () => {
    const s = tableSummaries(regs, decisions, tables);
    expect(s).toHaveLength(35);
    expect(s.reduce((a, t) => a + t.people, 0)).toBe(240);
    expect(s.reduce((a, t) => a + t.accepted, 0)).toBe(decisions.filter((d) => d.value === "acepto_a_cristo").length);
    expect(s.reduce((a, t) => a + t.wantsToTalk, 0)).toBe(decisions.filter((d) => d.value === "desea_conversar").length);
    for (const t of s) expect(Object.keys(t).sort()).toEqual(["accepted", "leaderName", "number", "people", "wantsToTalk"]);
    const json = JSON.stringify(s);
    for (const r of regs) expect(json).not.toContain(r.fullName);
  });
});

describe("privacidad de la vista de mesa", () => {
  it("ni la búsqueda ni los resúmenes contienen teléfonos ni correos", () => {
    const tables = simTables(simTeam(35));
    const regs = withTables(withAttendance(simRegistrations()), tables);
    const decisions = simDecisions(regs);
    const rows = ["ana", "VP003", "garcia", "muñoz", "rojas soto"].flatMap((q) => searchForTable(regs, decisions, q));
    expect(rows.length).toBeGreaterThan(0);
    for (const json of [JSON.stringify(rows), JSON.stringify(tableSummaries(regs, decisions, tables))]) {
      expect(json).not.toContain("+569");
      expect(json).not.toContain("@");
    }
  });
});
