// Bandeja de salida hacia el motor de mensajería (doc 40 §8). Independiente de
// la sincronización de inscripciones: si una se pausa, la otra sigue.
//
// - CDS decide QUÉ y A QUIÉN; el motor solo transporta. El payload es mínimo y
//   cerrado: nombre de pila, teléfono E.164, propósito y plantilla aprobada.
//   Nunca decisiones, notas, historial pastoral ni datos financieros.
// - Clave de idempotencia estable por edición/inscripción/propósito/plantilla:
//   planificar dos veces no duplica.
// - «enviado_al_motor» no significa entregado. «incierto» nunca se reintenta
//   solo: lo revisa una persona.
// - Una baja o revocación cancela lo que siga pendiente antes del despacho.
// - Transporte simulado en pruebas; ningún envío real sin aprobación (doc 41).

import { hasConsent, type Registration } from "./outreach-model";

export const OUTBOX_STATUSES = ["pendiente", "enviado_al_motor", "fallido", "incierto", "cancelado", "omitido"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const OUTBOX_STATUS_LABEL: Readonly<Record<OutboxStatus, string>> = {
  pendiente: "Pendiente",
  enviado_al_motor: "Entregado al motor (no confirma recepción)",
  fallido: "Falló",
  incierto: "Resultado incierto · revisar",
  cancelado: "Cancelado",
  omitido: "Omitido",
};

/** Plantillas aprobadas por el administrador; el texto vive en el motor, no aquí. */
export interface ApprovedTemplate {
  id: string;
  purpose: "bienvenida_evento" | "recordatorio_evento" | "seguimiento_evento";
  approvedBy: string;
  approvedAt: string;
}

/** Lo ÚNICO que sale de CDS hacia el motor. */
export interface OutboundPayload {
  idempotencyKey: string;
  toE164: string;
  firstName: string;
  templateId: string;
  purpose: ApprovedTemplate["purpose"];
}

export interface OutboxItem {
  key: string;
  registrationId: string;
  editionId: string;
  payload: OutboundPayload;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
}

export const PAYLOAD_KEYS: readonly (keyof OutboundPayload)[] = ["idempotencyKey", "toE164", "firstName", "templateId", "purpose"];

export function outboxKey(editionId: string, registrationId: string, templateId: string): string {
  return `${editionId}:${registrationId}:${templateId}`;
}

export type SkipReason = "sin_telefono" | "sin_autorizacion_whatsapp" | "sin_autorizacion_seguimiento" | "baja" | "no_activa" | "ya_planificado";

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? "";
}

/** Planifica mensajes para un grupo de inscripciones; idempotente por clave. */
export function planMessages(
  existing: readonly OutboxItem[],
  regs: readonly Registration[],
  template: ApprovedTemplate,
): { items: OutboxItem[]; skipped: { registrationId: string; reason: SkipReason }[] } {
  const keys = new Set(existing.map((i) => i.key));
  const items: OutboxItem[] = [...existing];
  const skipped: { registrationId: string; reason: SkipReason }[] = [];
  for (const reg of regs) {
    const key = outboxKey(reg.editionId, reg.id, template.id);
    if (keys.has(key)) skipped.push({ registrationId: reg.id, reason: "ya_planificado" });
    else if (reg.status !== "activa") skipped.push({ registrationId: reg.id, reason: "no_activa" });
    else if (reg.doNotContact) skipped.push({ registrationId: reg.id, reason: "baja" });
    else if (!hasConsent(reg, "mensajes_whatsapp")) skipped.push({ registrationId: reg.id, reason: "sin_autorizacion_whatsapp" });
    // Un mensaje de seguimiento exige además la autorización de seguimiento del evento.
    else if (template.purpose === "seguimiento_evento" && !hasConsent(reg, "seguimiento_evento")) skipped.push({ registrationId: reg.id, reason: "sin_autorizacion_seguimiento" });
    else if (!reg.phoneE164) skipped.push({ registrationId: reg.id, reason: "sin_telefono" });
    else {
      keys.add(key);
      items.push({
        key,
        registrationId: reg.id,
        editionId: reg.editionId,
        payload: { idempotencyKey: key, toE164: reg.phoneE164, firstName: firstName(reg.fullName), templateId: template.id, purpose: template.purpose },
        status: "pendiente",
        attempts: 0,
        lastError: null,
      });
    }
  }
  return { items, skipped };
}

/** Baja o revocación: cancela todo lo pendiente de esa inscripción. */
export function cancelForRegistration(items: readonly OutboxItem[], registrationId: string): OutboxItem[] {
  return items.map((i) => (i.registrationId === registrationId && (i.status === "pendiente" || i.status === "fallido") ? { ...i, status: "cancelado" } : i));
}

export type TransportResult = { kind: "aceptado" } | { kind: "rechazado"; error: string } | { kind: "sin_respuesta" };

export interface Transport {
  send(payload: OutboundPayload): Promise<TransportResult>;
}

export interface DispatchOptions {
  /** Interruptor del administrador: con false no sale nada. */
  enabled: boolean;
  maxPerRun: number;
  maxAttempts: number;
  /** Revalidación justo antes de despachar (bajas recientes, inscripción cancelada). */
  stillAllowed: (registrationId: string) => boolean;
}

/**
 * Despacha pendientes (y fallidos reintentables). Nunca toca «incierto»,
 * «enviado_al_motor» ni «cancelado». Verifica que el payload no tenga campos extra.
 */
export async function dispatch(items: readonly OutboxItem[], transport: Transport, opts: DispatchOptions): Promise<OutboxItem[]> {
  if (!opts.enabled) return [...items];
  let budget = opts.maxPerRun;
  const out: OutboxItem[] = [];
  for (const item of items) {
    const retryable = item.status === "pendiente" || (item.status === "fallido" && item.attempts < opts.maxAttempts);
    if (!retryable || budget <= 0) {
      out.push(item);
      continue;
    }
    if (!opts.stillAllowed(item.registrationId)) {
      out.push({ ...item, status: "cancelado" });
      continue;
    }
    const extra = Object.keys(item.payload).filter((k) => !(PAYLOAD_KEYS as readonly string[]).includes(k));
    if (extra.length) {
      out.push({ ...item, status: "omitido", lastError: `campos no permitidos: ${extra.join(", ")}` });
      continue;
    }
    budget--;
    let res: TransportResult;
    try {
      res = await transport.send(item.payload);
    } catch {
      res = { kind: "sin_respuesta" };
    }
    const attempts = item.attempts + 1;
    if (res.kind === "aceptado") out.push({ ...item, status: "enviado_al_motor", attempts, lastError: null });
    else if (res.kind === "rechazado") out.push({ ...item, status: "fallido", attempts, lastError: res.error });
    else out.push({ ...item, status: "incierto", attempts, lastError: "sin respuesta del motor" });
  }
  return out;
}

/** Transporte falso para pruebas y ensayos: registra lo que habría salido. */
export class SimulatedTransport implements Transport {
  readonly sent: OutboundPayload[] = [];
  private readonly seen = new Set<string>();
  constructor(private readonly behavior: (p: OutboundPayload, n: number) => TransportResult = () => ({ kind: "aceptado" })) {}
  async send(payload: OutboundPayload): Promise<TransportResult> {
    const res = this.behavior(payload, this.sent.length);
    // El motor deduplica por clave: un reenvío con la misma clave no genera otro mensaje.
    if (res.kind === "aceptado" && !this.seen.has(payload.idempotencyKey)) {
      this.seen.add(payload.idempotencyKey);
      this.sent.push(payload);
    }
    return res;
  }
}
