// Traspaso explícito del evento a Consolidación habitual (doc 40 §5).
//
// Es la ÚNICA puerta entre los dos flujos. Nunca ocurre por efecto colateral
// de asistir, ser asignado o responder. Requiere permiso de coordinación del
// evento + members.consolidation.manage, motivo y clave de idempotencia. El
// evento conserva su historia (solo lectura); Consolidación recibe una ficha
// nueva o se vincula a una existente confirmada por una persona.
//
// V1 de Consolidación exige primera visita: por eso solo se traspasa a quien
// asistió, con la fecha del evento como primera visita y la actividad del
// Calendario como origen. No viajan decisiones, contactos del evento ni notas.

import type { PersonCreateRequest } from "@/lib/shared/members";
import { hasConsent, type Edition, type Registration } from "./model";

export type HandoffError =
  | "sin_permiso"
  | "no_asistio"
  | "baja"
  | "ya_traspasada"
  | "edicion_sin_fecha"
  | "motivo_requerido"
  | "telefono_requerido"
  | "edicion_cerrada"
  | "sin_autorizacion";

export interface HandoffInput {
  reg: Registration;
  edition: Edition;
  actor: { uid: string; canCoordinate: boolean; canManageConsolidation: boolean };
  reason: string;
  /** Si coordinación confirmó que ya existe en Consolidación, se vincula en vez de crear. */
  linkToPersonId?: string;
  requestId: string;
}

export type HandoffPlan =
  | { kind: "crear"; idempotencyKey: string; request: PersonCreateRequest; registrationId: string; reason: string }
  | { kind: "vincular"; idempotencyKey: string; personId: string; registrationId: string; reason: string };

export function planHandoff(input: HandoffInput): { ok: true; value: HandoffPlan } | { ok: false; error: HandoffError } {
  const { reg, edition, actor } = input;
  if (!actor.canCoordinate || !actor.canManageConsolidation) return { ok: false, error: "sin_permiso" };
  if (edition.status === "cerrada") return { ok: false, error: "edicion_cerrada" };
  if (reg.handedOffAt || reg.memberPersonId) return { ok: false, error: "ya_traspasada" };
  if (reg.doNotContact) return { ok: false, error: "baja" };
  if (reg.attendance !== "asistio") return { ok: false, error: "no_asistio" };
  if (!hasConsent(reg, "traspaso_consolidacion")) return { ok: false, error: "sin_autorizacion" };
  if (!edition.eventDate) return { ok: false, error: "edicion_sin_fecha" };
  if (!input.reason.trim()) return { ok: false, error: "motivo_requerido" };
  // La clave es la inscripción: dos traspasos de la misma persona no crean dos fichas.
  const idempotencyKey = `handoff_${reg.id}`;
  if (input.linkToPersonId) {
    return { ok: true, value: { kind: "vincular", idempotencyKey, personId: input.linkToPersonId, registrationId: reg.id, reason: input.reason.trim() } };
  }
  if (!reg.phoneE164) return { ok: false, error: "telefono_requerido" };
  // Sin responsable: el traspaso no reasigna; Consolidación lo asigna en su flujo.
  const request: PersonCreateRequest = {
    requestId: input.requestId,
    fullName: reg.fullName,
    phone: reg.phoneE164,
    email: reg.email,
    firstVisitDate: edition.eventDate,
    calendarEventId: edition.calendarEventId,
    arrivalSource: "evangelismo",
    invitedBy: reg.invitedByName,
    followUpOwnerUid: null,
    visitNote: null,
  };
  return { ok: true, value: { kind: "crear", idempotencyKey, request, registrationId: reg.id, reason: input.reason.trim() } };
}
