import { describe, expect, it } from "vitest";
import { confirmBatch, moveInProposal, proposeDistribution, reassign, releaseOwner } from "@/lib/outreach/distribution";
import type { TeamMember } from "@/lib/outreach/model";
import { SIM_EDITION, simRegistrations, simTeam, withAttendance } from "@/lib/outreach/sim/fixtures";
import { consent, reg } from "./helpers";

const opts = { editionId: SIM_EDITION.id, batchId: "lote-1", defaultMax: 20 };
const scenario = () => withAttendance(simRegistrations());
const ownerUids = (n = 15) => simTeam(n).filter((m) => m.roles.includes("responsable")).map((m) => m.uid);

describe("proposeDistribution · 300 inscritas / 15 responsables", () => {
  it("asigna solo a quienes asistieron y autorizaron; los demás quedan excluidos", () => {
    const regs = scenario();
    const p = proposeDistribution(regs, simTeam(), opts);
    const byId = new Map(regs.map((r) => [r.id, r]));
    expect(p.assignments).toHaveLength(240);
    expect(p.unassigned).toHaveLength(0);
    for (const a of p.assignments) {
      const r = byId.get(a.registrationId)!;
      expect(r.attendance).toBe("asistio");
      expect(r.consents.some((c) => c.purpose === "seguimiento_evento" && !c.revokedAt)).toBe(true);
    }
    expect(p.excluded).toHaveLength(60);
    expect(p.excluded.every((e) => e.reason === "no_asistio" || e.reason === "sin_confirmar")).toBe(true);
  });

  it("nunca supera 20 por responsable y reparte parejo", () => {
    const p = proposeDistribution(scenario(), simTeam(), opts);
    const counts = new Map<string, number>();
    for (const a of p.assignments) counts.set(a.ownerUid, (counts.get(a.ownerUid) ?? 0) + 1);
    expect(counts.size).toBe(15);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(20);
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
    expect(Object.values(p.loads).reduce((a, b) => a + b, 0)).toBe(240);
  });

  it("es determinista: misma entrada, misma salida, sin importar el orden de entrada", () => {
    const regs = scenario();
    const a = proposeDistribution(regs, simTeam(), opts);
    const b = proposeDistribution(regs, simTeam(), opts);
    expect(b).toEqual(a);
    const shuffled = [...regs].reverse();
    expect(proposeDistribution(shuffled, simTeam(), opts)).toEqual(a);
  });

  it("incluye «Sin confirmar» solo si se pide", () => {
    const regs = scenario();
    const p = proposeDistribution(regs, simTeam(), { ...opts, includeUnconfirmed: true });
    expect(p.assignments).toHaveLength(260);
    expect(p.excluded).toHaveLength(40);
  });

  it("respeta el vínculo previo mientras haya cupo", () => {
    const regs = scenario();
    const attended = regs.filter((r) => r.attendance === "asistio").slice(0, 5);
    const affinity = Object.fromEntries(attended.map((r) => [r.id, "sim-resp-03"]));
    const p = proposeDistribution(regs, simTeam(), { ...opts, affinity });
    for (const r of attended) {
      const a = p.assignments.find((x) => x.registrationId === r.id)!;
      expect(a.ownerUid).toBe("sim-resp-03");
      expect(a.reason).toBe("vinculo_previo");
    }
  });

  it("ignora un vínculo previo cuando el responsable ya no tiene cupo", () => {
    const regs = scenario();
    const attended = regs.filter((r) => r.attendance === "asistio").slice(0, 25);
    const affinity = Object.fromEntries(attended.map((r) => [r.id, "sim-resp-01"]));
    const p = proposeDistribution(regs, simTeam(), { ...opts, affinity });
    expect(p.assignments.filter((a) => a.ownerUid === "sim-resp-01").length).toBeLessThanOrEqual(20);
    expect(p.assignments.filter((a) => a.reason === "vinculo_previo")).toHaveLength(20);
  });

  it("deja sin asignar cuando se acaba la capacidad (15 × 10)", () => {
    const team = simTeam().map((m) => (m.roles.includes("responsable") ? { ...m, maxAssigned: 10 } : m));
    const p = proposeDistribution(scenario(), team, opts);
    expect(p.assignments).toHaveLength(150);
    expect(p.unassigned).toHaveLength(90);
    expect(p.unassigned.every((u) => u.reason === "sin_capacidad")).toBe(true);
    for (const uid of ownerUids()) expect(p.loads[uid]).toBe(10);
  });

  it("sin responsables activos todo queda sin_responsables", () => {
    const team = simTeam().map((m) => ({ ...m, active: false }));
    const p = proposeDistribution(scenario(), team, opts);
    expect(p.assignments).toHaveLength(0);
    expect(p.unassigned).toHaveLength(240);
    expect(p.unassigned.every((u) => u.reason === "sin_responsables")).toBe(true);
  });

  it("excluye bajas, sin autorización, inactivas, ya asignadas y traspasadas con su motivo", () => {
    const base = { attendance: "asistio" as const };
    const regs = [
      reg({ id: "a", ...base, doNotContact: true }),
      reg({ id: "b", ...base, consents: [] }),
      reg({ id: "c", ...base, status: "cancelada" }),
      reg({ id: "d", ...base, ownerUid: "sim-resp-01" }),
      reg({ id: "e", ...base, handedOffAt: "2026-12-01T10:00" }),
      reg({ id: "f", ...base }),
    ];
    const p = proposeDistribution(regs, simTeam(), opts);
    expect(Object.fromEntries(p.excluded.map((e) => [e.registrationId, e.reason]))).toEqual({
      a: "baja",
      b: "sin_autorizacion",
      c: "no_activa",
      d: "ya_asignada",
      e: "traspasada",
    });
    expect(p.assignments.map((a) => a.registrationId)).toEqual(["f"]);
  });

  it("la distribución no toca ninguna referencia a personas de Consolidación", () => {
    const regs = scenario();
    const p = proposeDistribution(regs, simTeam(), opts);
    const { registrations } = confirmBatch(regs, p);
    expect(registrations.every((r) => r.memberPersonId === null && r.handedOffAt === null)).toBe(true);
    // Solo cambian propietario, lote y revisión.
    const before = new Map(regs.map((r) => [r.id, r]));
    for (const r of registrations) {
      const { ownerUid, assignmentBatchId, revision, ...rest } = r;
      const { ownerUid: o2, assignmentBatchId: b2, revision: v2, ...restBefore } = before.get(r.id)!;
      expect(rest).toEqual(restBefore);
      void [ownerUid, assignmentBatchId, revision, o2, b2, v2];
    }
  });
});

describe("moveInProposal", () => {
  const small = () => {
    const regs = [reg({ id: "r1", attendance: "asistio" }), reg({ id: "r2", attendance: "asistio" }), reg({ id: "r3", attendance: "asistio" })];
    const team: TeamMember[] = [
      { uid: "u1", displayName: "U1", roles: ["responsable"], active: true, maxAssigned: 2 },
      { uid: "u2", displayName: "U2", roles: ["responsable"], active: true, maxAssigned: 1 },
    ];
    return { regs, team, p: proposeDistribution(regs, team, { editionId: "vplt-2026", batchId: "b", defaultMax: 20 }) };
  };

  it("mover dentro del tope no pide motivo y ajusta cargas", () => {
    const { p } = small();
    expect(p.loads).toEqual({ u1: 2, u2: 1 });
    const moved = moveInProposal(p, "r1", "u1");
    expect(moved.ok).toBe(true);
  });

  it("pasarse del tope exige motivo escrito y lo guarda", () => {
    const { p } = small();
    const target = p.assignments.find((a) => a.ownerUid === "u1")!.registrationId;
    const other = p.assignments.find((a) => a.ownerUid === "u2")!.registrationId;
    expect(moveInProposal(p, other, "u1")).toEqual({ ok: false, error: "motivo_requerido" });
    expect(moveInProposal(p, other, "u1", "  ")).toEqual({ ok: false, error: "motivo_requerido" });
    const ok = moveInProposal(p, other, "u1", "Es su familiar");
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const a = ok.value.assignments.find((x) => x.registrationId === other)!;
      expect(a).toMatchObject({ ownerUid: "u1", reason: "ajuste_coordinacion", note: "Es su familiar" });
      expect(ok.value.loads).toEqual({ u1: 3, u2: 0 });
    }
    expect(target).toBeTruthy();
  });

  it("rechaza responsables inválidos y personas fuera de la propuesta", () => {
    const { p } = small();
    expect(moveInProposal(p, "r1", "nadie")).toEqual({ ok: false, error: "responsable_invalido" });
    expect(moveInProposal(p, "zzz", "u1")).toEqual({ ok: false, error: "no_en_propuesta" });
  });

  it("una persona sin asignar puede asignarse a mano conservando su revisión base", () => {
    const regs = [reg({ id: "r1", attendance: "asistio", revision: 4 })];
    const team: TeamMember[] = [{ uid: "u1", displayName: "U1", roles: ["responsable"], active: true, maxAssigned: 0 }];
    const p = proposeDistribution(regs, team, { editionId: "vplt-2026", batchId: "b", defaultMax: 20 });
    expect(p.unassigned).toHaveLength(1);
    const res = moveInProposal(p, "r1", "u1", "Excepción acordada");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.unassigned).toHaveLength(0);
      expect(res.value.assignments[0].baseRevision).toBe(4);
    }
  });

  it("no muta la propuesta original", () => {
    const { p } = small();
    const snapshot = JSON.stringify(p);
    const other = p.assignments.find((a) => a.ownerUid === "u2")!.registrationId;
    moveInProposal(p, other, "u1", "motivo");
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe("confirmBatch", () => {
  const prepared = () => {
    const regs = scenario();
    const proposal = proposeDistribution(regs, simTeam(), opts);
    return { regs, proposal };
  };

  it("aplica el lote completo una vez", () => {
    const { regs, proposal } = prepared();
    const { registrations, result } = confirmBatch(regs, proposal);
    expect(result.applied).toHaveLength(240);
    expect(result.conflicts).toHaveLength(0);
    expect(registrations.filter((r) => r.ownerUid).every((r) => r.assignmentBatchId === "lote-1")).toBe(true);
    // El estado de entrada no se muta.
    expect(regs.every((r) => r.ownerUid === null)).toBe(true);
  });

  it("es idempotente: confirmar dos veces no vuelve a aplicar nada", () => {
    const { regs, proposal } = prepared();
    const first = confirmBatch(regs, proposal);
    const second = confirmBatch(first.registrations, proposal);
    expect(second.result.applied).toHaveLength(0);
    expect(second.result.alreadyApplied).toHaveLength(240);
    expect(second.result.conflicts).toHaveLength(0);
    expect(second.registrations).toEqual(first.registrations);
  });

  it("informa conflicto si la revisión cambió y no sobreescribe", () => {
    const { regs, proposal } = prepared();
    const target = proposal.assignments[0].registrationId;
    const changed = regs.map((r) => (r.id === target ? { ...r, fullName: "Editada en CDS", revision: r.revision + 1 } : r));
    const { registrations, result } = confirmBatch(changed, proposal);
    expect(result.conflicts).toEqual([{ registrationId: target, reason: "revision" }]);
    expect(result.applied).toHaveLength(239);
    expect(registrations.find((r) => r.id === target)).toMatchObject({ ownerUid: null, fullName: "Editada en CDS" });
  });

  it("informa conflicto si alguien la asignó o pidió la baja entre propuesta y confirmación", () => {
    const { regs, proposal } = prepared();
    const [a, b, c] = proposal.assignments.map((x) => x.registrationId);
    const changed = regs.map((r) => {
      if (r.id === a) return { ...r, ownerUid: "sim-resp-15", revision: r.revision + 1 };
      if (r.id === b) return { ...r, doNotContact: true, revision: r.revision + 1 };
      if (r.id === c) return { ...r, status: "cancelada" as const, revision: r.revision + 1 };
      return r;
    });
    const { registrations, result } = confirmBatch(changed, proposal);
    expect(Object.fromEntries(result.conflicts.map((x) => [x.registrationId, x.reason]))).toEqual({ [a]: "ya_asignada", [b]: "baja", [c]: "no_activa" });
    expect(registrations.find((r) => r.id === a)!.ownerUid).toBe("sim-resp-15");
    expect(registrations.find((r) => r.id === b)!.ownerUid).toBeNull();
    expect(registrations.find((r) => r.id === c)!.ownerUid).toBeNull();
    expect(result.applied).toHaveLength(237);
  });
});

describe("reassign", () => {
  const team = simTeam();
  const assigned = reg({ ownerUid: "sim-resp-01", assignmentBatchId: "lote-1", revision: 3 });

  it("reasigna con motivo, revisión esperada y responsable activo", () => {
    const res = reassign(assigned, team, "sim-resp-02", "Cambio de carga", 3);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toMatchObject({ ownerUid: "sim-resp-02", assignmentBatchId: null, revision: 4 });
  });

  it("exige motivo", () => {
    expect(reassign(assigned, team, "sim-resp-02", "  ", 3)).toEqual({ ok: false, error: "motivo_requerido" });
  });

  it("exige la revisión esperada", () => {
    expect(reassign(assigned, team, "sim-resp-02", "x", 2)).toEqual({ ok: false, error: "revision" });
  });

  it("exige un responsable activo con rol de responsable", () => {
    const inactive = team.map((m) => (m.uid === "sim-resp-02" ? { ...m, active: false } : m));
    expect(reassign(assigned, inactive, "sim-resp-02", "x", 3)).toEqual({ ok: false, error: "responsable_invalido" });
    expect(reassign(assigned, team, "sim-recep-1", "x", 3)).toEqual({ ok: false, error: "responsable_invalido" });
    expect(reassign(assigned, team, "nadie", "x", 3)).toEqual({ ok: false, error: "responsable_invalido" });
  });

  it("no reasigna bajas ni al mismo responsable", () => {
    expect(reassign({ ...assigned, doNotContact: true }, team, "sim-resp-02", "x", 3)).toEqual({ ok: false, error: "baja" });
    expect(reassign(assigned, team, "sim-resp-01", "x", 3)).toEqual({ ok: false, error: "sin_cambio" });
  });
});

describe("releaseOwner", () => {
  it("devuelve las personas a la cola sin perder el historial de seguimiento", () => {
    const followUp = { lastContactAt: "2026-11-30", lastResult: "sin_respuesta" as const, attempts: 1, nextAction: "Reintentar", nextActionDate: "2026-12-06" };
    const regs = [
      reg({ id: "a", ownerUid: "u1", followUp, consents: [consent("seguimiento_evento")] }),
      reg({ id: "b", ownerUid: "u1", handedOffAt: "2026-12-01T10:00" }),
      reg({ id: "c", ownerUid: "u2" }),
    ];
    const { registrations, released } = releaseOwner(regs, "u1");
    expect(released).toEqual(["a"]);
    expect(registrations[0]).toMatchObject({ ownerUid: null, assignmentBatchId: null, revision: 2, followUp });
    expect(registrations[1].ownerUid).toBe("u1");
    expect(registrations[2].ownerUid).toBe("u2");
    // Quedan disponibles para una nueva propuesta (no se reparten solos).
    const p = proposeDistribution(registrations.map((r) => ({ ...r, attendance: "asistio" as const })), simTeam(), opts);
    expect(p.assignments.map((x) => x.registrationId)).toContain("a");
  });
});
