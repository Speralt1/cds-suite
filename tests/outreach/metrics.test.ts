import { describe, expect, it } from "vitest";
import { confirmBatch, proposeDistribution } from "@/lib/outreach/distribution";
import { decisionSummary, editionMetrics } from "@/lib/outreach/metrics";
import type { DecisionRecord, DecisionValue } from "@/lib/outreach/model";
import { SIM_EDITION, simRegistrations, simTeam, withAttendance } from "@/lib/outreach/sim/fixtures";
import { EVENT_DATE } from "./helpers";

const TODAY = "2026-12-01";
const decision = (registrationId: string, value: DecisionValue): DecisionRecord => ({
  registrationId,
  editionId: "vplt-2026",
  value,
  declaredBy: "la_persona",
  consentTextVersion: "dec-1",
  recordedAt: "2026-11-29T20:00",
  recordedBy: "sim-resp-01",
});

describe("editionMetrics · escenario 240/40/20", () => {
  const regs = withAttendance(simRegistrations());

  it("denominadores de asistencia", () => {
    const m = editionMetrics(regs, TODAY, EVENT_DATE);
    expect(m).toMatchObject({ registered: 300, attended: 240, absentConfirmed: 40, attendancePending: 20, walkIns: 0, optedOut: 0, handedOff: 0 });
    expect(m.attended + m.absentConfirmed + m.attendancePending).toBe(m.registered);
  });

  it("antes de distribuir nadie está asignado y todos los contactables están sin responsable", () => {
    const m = editionMetrics(regs, TODAY, EVENT_DATE);
    expect(m).toMatchObject({ contactable: 300, assigned: 0, unassignedContactable: 240, firstContactPending: 0, overdue: 0 });
    expect(m.loadByOwner).toEqual({});
  });

  it("después de distribuir: 240 asignadas, 60 sin asignar y primer contacto pendiente", () => {
    const p = proposeDistribution(regs, simTeam(), { editionId: SIM_EDITION.id, batchId: "b1", defaultMax: 20 });
    const { registrations } = confirmBatch(regs, p);
    const m = editionMetrics(registrations, "2026-11-30", EVENT_DATE);
    expect(m.assigned).toBe(240);
    // Solo falta distribuir a quien asistió: las 60 ausentes o sin confirmar no cuentan como pendiente.
    expect(m.unassignedContactable).toBe(0);
    expect(m.assigned + 60).toBe(m.contactable);
    expect(m.firstContactPending).toBe(240);
    expect(Object.values(m.loadByOwner).reduce((a, b) => a + b, 0)).toBe(240);
    expect(Math.max(...Object.values(m.loadByOwner))).toBeLessThanOrEqual(20);
    // Pasado D+2 sin contactar, pasan a vencidas.
    const late = editionMetrics(registrations, "2026-12-02", EVENT_DATE);
    expect(late).toMatchObject({ firstContactPending: 0, overdue: 240 });
  });

  it("canceladas y duplicadas no entran a «inscritas»", () => {
    const changed = regs.map((r, i) => (i < 5 ? { ...r, status: "cancelada" as const } : i < 8 ? { ...r, status: "duplicada" as const } : r));
    expect(editionMetrics(changed, TODAY, EVENT_DATE).registered).toBe(292);
  });

  it("las bajas y los traspasos se cuentan aparte y las bajas no son contactables ni cargan al responsable", () => {
    const p = proposeDistribution(regs, simTeam(), { editionId: SIM_EDITION.id, batchId: "b1", defaultMax: 20 });
    const { registrations } = confirmBatch(regs, p);
    const owned = registrations.filter((r) => r.ownerUid);
    const withOptOut = registrations.map((r) => (r.id === owned[0].id ? { ...r, doNotContact: true } : r.id === owned[1].id ? { ...r, handedOffAt: "2026-12-01T10:00" } : r));
    const m = editionMetrics(withOptOut, TODAY, EVENT_DATE);
    expect(m.optedOut).toBe(1);
    expect(m.handedOff).toBe(1);
    expect(m.contactable).toBe(299);
    expect(m.assigned).toBe(239);
    expect(Object.values(m.loadByOwner).reduce((a, b) => a + b, 0)).toBe(238);
  });

  it("cuenta las llegadas sin inscripción", () => {
    const withWalkIns = [...regs, ...regs.slice(0, 3).map((r, i) => ({ ...r, id: `walk${i}`, source: "recepcion" as const }))];
    expect(editionMetrics(withWalkIns, TODAY, EVENT_DATE).walkIns).toBe(3);
  });
});

describe("decisionSummary", () => {
  const regs = simRegistrations({ count: 10 });

  it("cuenta «No registrada» aparte y no la suma a ninguna decisión", () => {
    const out = decisionSummary(regs, [decision(regs[0].id, "acepto_a_cristo"), decision(regs[1].id, "desea_conversar"), decision(regs[2].id, "no_por_ahora")]);
    expect(out).toEqual({ no_registrada: 7, acepto_a_cristo: 1, desea_conversar: 1, no_por_ahora: 1 });
  });

  it("sin decisiones todo es «No registrada»", () => {
    expect(decisionSummary(regs, [])).toEqual({ no_registrada: 10, acepto_a_cristo: 0, desea_conversar: 0, no_por_ahora: 0 });
  });

  it("ignora inscripciones canceladas y decisiones de inscripciones desconocidas", () => {
    const changed = regs.map((r, i) => (i === 0 ? { ...r, status: "cancelada" as const } : r));
    const out = decisionSummary(changed, [decision(regs[0].id, "acepto_a_cristo"), decision("no-existe", "acepto_a_cristo"), decision(regs[1].id, "desea_conversar")]);
    expect(out).toEqual({ no_registrada: 8, acepto_a_cristo: 0, desea_conversar: 1, no_por_ahora: 0 });
  });

  it("un documento duplicado de la misma persona cuenta una sola vez (el primero)", () => {
    const out = decisionSummary(regs, [decision(regs[0].id, "desea_conversar"), decision(regs[0].id, "acepto_a_cristo")]);
    expect(out).toMatchObject({ desea_conversar: 1, acepto_a_cristo: 0, no_registrada: 9 });
  });

  it("solo devuelve conteos, sin identificadores ni nombres", () => {
    const out = decisionSummary(regs, [decision(regs[0].id, "desea_conversar")]);
    expect(Object.keys(out).sort()).toEqual(["acepto_a_cristo", "desea_conversar", "no_por_ahora", "no_registrada"]);
    expect(Object.values(out).every((v) => typeof v === "number")).toBe(true);
  });
});
