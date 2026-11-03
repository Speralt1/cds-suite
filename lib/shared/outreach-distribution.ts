// Distribución posterior al evento (doc 40 §6). Pertenece a la EDICIÓN: nunca
// toca `membersPeople.followUpOwnerUid` ni los seguimientos habituales.
//
// 1. proposeDistribution: propuesta determinista y equilibrada (≤ tope por
//    responsable), respetando bajas, vínculo previo y responsables activos.
// 2. Coordinación revisa y ajusta (moveInProposal, con motivo si excede el tope).
// 3. confirmBatch: aplica el lote. Idempotente por batchId y por revisión: si
//    una inscripción cambió desde la propuesta, se informa como conflicto y no
//    se sobreescribe.

import { hasConsent, type Registration, type TeamMember } from "./outreach-model";

export type ProposalReason = "vinculo_previo" | "equilibrio" | "ajuste_coordinacion";
export type UnassignedReason = "sin_capacidad" | "sin_responsables";

export interface ProposedAssignment {
  registrationId: string;
  ownerUid: string;
  reason: ProposalReason;
  /** Revisión de la inscripción cuando se propuso (control de concurrencia). */
  baseRevision: number;
  /** Motivo escrito por coordinación cuando el ajuste supera el tope. */
  note: string | null;
}

export interface DistributionProposal {
  editionId: string;
  batchId: string;
  assignments: ProposedAssignment[];
  unassigned: { registrationId: string; reason: UnassignedReason; baseRevision: number }[];
  /** No entran al reparto: baja, sin autorización, inactiva, ya asignada o traspasada. */
  excluded: { registrationId: string; reason: ExcludedReason }[];
  loads: Record<string, number>;
  caps: Record<string, number>;
}

export type ExcludedReason = "baja" | "sin_autorizacion" | "no_activa" | "ya_asignada" | "traspasada" | "no_asistio" | "sin_confirmar";

export interface ProposeOptions {
  editionId: string;
  batchId: string;
  defaultMax: number;
  /** Incluir «Sin confirmar» además de «Asistió». Por defecto solo asistentes. */
  includeUnconfirmed?: boolean;
  /** Vínculo previo: responsable que ya conoce a la persona (p. ej. edición anterior o quien la invitó). */
  affinity?: Readonly<Record<string, string>>;
}

function eligibility(reg: Registration, includeUnconfirmed: boolean): ExcludedReason | null {
  if (reg.status !== "activa") return "no_activa";
  if (reg.handedOffAt) return "traspasada";
  if (reg.ownerUid) return "ya_asignada";
  if (reg.doNotContact) return "baja";
  if (!hasConsent(reg, "seguimiento_evento")) return "sin_autorizacion";
  if (reg.attendance === "no_asistio") return "no_asistio";
  if (reg.attendance === "sin_confirmar" && !includeUnconfirmed) return "sin_confirmar";
  return null;
}

/** Responsables activos con su tope y la carga que ya tienen en ESTA edición. */
function ownersOf(team: readonly TeamMember[], regs: readonly Registration[], defaultMax: number) {
  const caps: Record<string, number> = {};
  const loads: Record<string, number> = {};
  for (const m of team) {
    if (!m.active || !m.roles.includes("responsable")) continue;
    caps[m.uid] = m.maxAssigned ?? defaultMax;
    loads[m.uid] = 0;
  }
  for (const r of regs) if (r.ownerUid && r.ownerUid in loads && r.status === "activa" && !r.doNotContact) loads[r.ownerUid]++;
  return { caps, loads };
}

export function proposeDistribution(
  regs: readonly Registration[],
  team: readonly TeamMember[],
  opts: ProposeOptions,
): DistributionProposal {
  const { caps, loads } = ownersOf(team, regs, opts.defaultMax);
  const owners = Object.keys(caps).sort();
  const proposal: DistributionProposal = {
    editionId: opts.editionId,
    batchId: opts.batchId,
    assignments: [],
    unassigned: [],
    excluded: [],
    loads,
    caps,
  };
  // Orden estable: llegada y luego id, para que dos corridas den lo mismo.
  const pool = [...regs].sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)));
  const waiting: Registration[] = [];
  for (const reg of pool) {
    const ex = eligibility(reg, !!opts.includeUnconfirmed);
    if (ex) {
      proposal.excluded.push({ registrationId: reg.id, reason: ex });
      continue;
    }
    const preferred = opts.affinity?.[reg.id];
    if (preferred && preferred in caps && loads[preferred] < caps[preferred]) {
      loads[preferred]++;
      proposal.assignments.push({ registrationId: reg.id, ownerUid: preferred, reason: "vinculo_previo", baseRevision: reg.revision, note: null });
    } else {
      waiting.push(reg);
    }
  }
  for (const reg of waiting) {
    if (owners.length === 0) {
      proposal.unassigned.push({ registrationId: reg.id, reason: "sin_responsables", baseRevision: reg.revision });
      continue;
    }
    // Menor carga relativa primero; empate por uid.
    let best: string | null = null;
    for (const uid of owners) {
      if (loads[uid] >= caps[uid]) continue;
      if (best === null || loads[uid] / caps[uid] < loads[best] / caps[best]) best = uid;
    }
    if (best === null) {
      proposal.unassigned.push({ registrationId: reg.id, reason: "sin_capacidad", baseRevision: reg.revision });
      continue;
    }
    loads[best]++;
    proposal.assignments.push({ registrationId: reg.id, ownerUid: best, reason: "equilibrio", baseRevision: reg.revision, note: null });
  }
  return proposal;
}

export type MoveError = "no_en_propuesta" | "responsable_invalido" | "motivo_requerido";

/** Ajuste de coordinación dentro de la propuesta; superar el tope exige motivo. */
export function moveInProposal(
  proposal: DistributionProposal,
  registrationId: string,
  toUid: string,
  note?: string,
): { ok: true; value: DistributionProposal } | { ok: false; error: MoveError } {
  if (!(toUid in proposal.caps)) return { ok: false, error: "responsable_invalido" };
  const fromUnassigned = proposal.unassigned.find((u) => u.registrationId === registrationId);
  const current = proposal.assignments.find((a) => a.registrationId === registrationId);
  if (!current && !fromUnassigned) return { ok: false, error: "no_en_propuesta" };
  if (current?.ownerUid === toUid) return { ok: true, value: proposal };
  const over = proposal.loads[toUid] + 1 > proposal.caps[toUid];
  if (over && !note?.trim()) return { ok: false, error: "motivo_requerido" };
  const loads = { ...proposal.loads, [toUid]: proposal.loads[toUid] + 1 };
  if (current) loads[current.ownerUid]--;
  const baseRevision = current?.baseRevision ?? (fromUnassigned as { baseRevision: number }).baseRevision;
  const moved: ProposedAssignment = {
    registrationId,
    ownerUid: toUid,
    reason: "ajuste_coordinacion",
    baseRevision,
    note: note?.trim() || null,
  };
  return {
    ok: true,
    value: {
      ...proposal,
      loads,
      assignments: current
        ? proposal.assignments.map((a) => (a.registrationId === registrationId ? moved : a))
        : [...proposal.assignments, moved],
      unassigned: proposal.unassigned.filter((u) => u.registrationId !== registrationId),
    },
  };
}

export interface BatchResult {
  batchId: string;
  applied: string[];
  /** Cambiaron desde la propuesta (otra asignación, baja, edición): se dejan como están. */
  conflicts: { registrationId: string; reason: "revision" | "ya_asignada" | "baja" | "no_activa" }[];
  /** Ya estaban aplicadas por este mismo lote: repetir la confirmación no hace nada. */
  alreadyApplied: string[];
}

/**
 * Aplica un lote confirmado sobre el estado actual. Pura: devuelve el estado
 * nuevo y el informe; el backend hará lo mismo dentro de una transacción por
 * grupo de inscripciones con el batchId como clave de idempotencia.
 */
export function confirmBatch(
  regs: readonly Registration[],
  proposal: DistributionProposal,
): { registrations: Registration[]; result: BatchResult } {
  const byId = new Map(regs.map((r) => [r.id, r]));
  const result: BatchResult = { batchId: proposal.batchId, applied: [], conflicts: [], alreadyApplied: [] };
  for (const a of proposal.assignments) {
    const reg = byId.get(a.registrationId);
    if (!reg) continue;
    if (reg.assignmentBatchId === proposal.batchId && reg.ownerUid === a.ownerUid) {
      result.alreadyApplied.push(reg.id);
      continue;
    }
    if (reg.status !== "activa") result.conflicts.push({ registrationId: reg.id, reason: "no_activa" });
    else if (reg.doNotContact) result.conflicts.push({ registrationId: reg.id, reason: "baja" });
    else if (reg.ownerUid) result.conflicts.push({ registrationId: reg.id, reason: "ya_asignada" });
    else if (reg.revision !== a.baseRevision) result.conflicts.push({ registrationId: reg.id, reason: "revision" });
    else {
      byId.set(reg.id, { ...reg, ownerUid: a.ownerUid, assignmentBatchId: proposal.batchId, revision: reg.revision + 1 });
      result.applied.push(reg.id);
    }
  }
  return { registrations: regs.map((r) => byId.get(r.id) as Registration), result };
}

export type ReassignError = "motivo_requerido" | "responsable_invalido" | "baja" | "sin_cambio" | "revision";

/** Reasignación individual después de confirmar: siempre con motivo y revisión esperada. */
export function reassign(
  reg: Registration,
  team: readonly TeamMember[],
  toUid: string,
  reason: string,
  expectedRevision: number,
): { ok: true; value: Registration } | { ok: false; error: ReassignError } {
  if (!reason.trim()) return { ok: false, error: "motivo_requerido" };
  if (reg.revision !== expectedRevision) return { ok: false, error: "revision" };
  if (reg.doNotContact) return { ok: false, error: "baja" };
  if (reg.ownerUid === toUid) return { ok: false, error: "sin_cambio" };
  const owner = team.find((m) => m.uid === toUid);
  if (!owner || !owner.active || !owner.roles.includes("responsable")) return { ok: false, error: "responsable_invalido" };
  return { ok: true, value: { ...reg, ownerUid: toUid, assignmentBatchId: null, revision: reg.revision + 1 } };
}

/**
 * Responsable desactivado: sus pendientes vuelven a la cola de coordinación
 * (sin responsable), con su historial intacto. No se reparten solos.
 */
export function releaseOwner(regs: readonly Registration[], uid: string): { registrations: Registration[]; released: string[] } {
  const released: string[] = [];
  const registrations = regs.map((r) => {
    if (r.ownerUid !== uid || r.handedOffAt) return r;
    released.push(r.id);
    return { ...r, ownerUid: null, assignmentBatchId: null, revision: r.revision + 1 };
  });
  return { registrations, released };
}
