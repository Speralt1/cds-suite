// Métricas de una edición con denominadores explícitos (doc 38 §7). Las
// decisiones NO están aquí: se agregan aparte y solo con permiso pastoral.

import { hasConsent, queueBucket, type Registration } from "./outreach-model";
import type { DecisionRecord, DecisionValue } from "./outreach-model";
import type { Ymd } from "./types";

export interface EditionMetrics {
  /** Inscripciones activas (sin canceladas ni duplicadas). */
  registered: number;
  attended: number;
  absentConfirmed: number;
  attendancePending: number;
  /** Llegaron sin inscripción previa. */
  walkIns: number;
  /** Activas con autorización vigente para seguimiento y sin baja. */
  contactable: number;
  assigned: number;
  /** Asistieron, autorizaron seguimiento y aún no tienen responsable (lo que falta distribuir). */
  unassignedContactable: number;
  firstContactPending: number;
  overdue: number;
  optedOut: number;
  handedOff: number;
  /** Carga por responsable (solo activas y no traspasadas). */
  loadByOwner: Record<string, number>;
}

export function editionMetrics(regs: readonly Registration[], today: Ymd, eventDate: Ymd | null): EditionMetrics {
  const active = regs.filter((r) => r.status === "activa");
  const m: EditionMetrics = {
    registered: active.length,
    attended: 0,
    absentConfirmed: 0,
    attendancePending: 0,
    walkIns: 0,
    contactable: 0,
    assigned: 0,
    unassignedContactable: 0,
    firstContactPending: 0,
    overdue: 0,
    optedOut: 0,
    handedOff: 0,
    loadByOwner: {},
  };
  for (const r of active) {
    if (r.attendance === "asistio") m.attended++;
    else if (r.attendance === "no_asistio") m.absentConfirmed++;
    else m.attendancePending++;
    if (r.source === "recepcion") m.walkIns++;
    if (r.doNotContact) m.optedOut++;
    if (r.handedOffAt) m.handedOff++;
    const contactable = !r.doNotContact && hasConsent(r, "seguimiento_evento");
    if (contactable) m.contactable++;
    if (r.ownerUid && !r.handedOffAt) {
      m.assigned++;
      if (!r.doNotContact) m.loadByOwner[r.ownerUid] = (m.loadByOwner[r.ownerUid] ?? 0) + 1;
      const bucket = queueBucket(r, today, eventDate);
      if (bucket === "primer_contacto") m.firstContactPending++;
      if (bucket === "vencido") m.overdue++;
    } else if (contactable && !r.handedOffAt && r.attendance === "asistio") m.unassignedContactable++;
  }
  return m;
}

/**
 * Agregado pastoral: «No registrada» se cuenta aparte y NUNCA se suma a una
 * decisión. Solo conteos; no devuelve nombres.
 */
export function decisionSummary(regs: readonly Registration[], decisions: readonly DecisionRecord[]): Record<DecisionValue | "no_registrada", number> {
  const active = new Set(regs.filter((r) => r.status === "activa").map((r) => r.id));
  const out: Record<DecisionValue | "no_registrada", number> = { no_registrada: 0, acepto_a_cristo: 0, desea_conversar: 0, no_por_ahora: 0 };
  // Por inscripción vale la decisión más reciente (recordedAt), sin depender del orden de entrada.
  const latest = new Map<string, DecisionRecord>();
  for (const d of decisions) {
    if (!active.has(d.registrationId)) continue;
    const prev = latest.get(d.registrationId);
    if (!prev || d.recordedAt > prev.recordedAt) latest.set(d.registrationId, d);
  }
  for (const d of latest.values()) out[d.value]++;
  const withDecision = latest;
  out.no_registrada = active.size - withDecision.size;
  return out;
}
