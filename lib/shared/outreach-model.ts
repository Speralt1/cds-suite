// Integrantes › Consolidación › «Ve por los tuyos» (doc 40). Modelo de dominio
// del evento anual: TypeScript puro, sin React, sin Firebase y sin APIs del
// navegador, para que el mismo código pueda pasar a lib/shared cuando exista
// el backend (callables `outreach*`). PROPUESTO: nada de esto tiene Rules,
// Functions ni colecciones desplegadas.
//
// Ejes independientes (nunca se deducen unos de otros):
//   inscripción (status) · asistencia (attendance) · consentimiento (consents)
//   · decisión voluntaria (registro aparte, acceso pastoral) · asignación
//   (ownerUid) · seguimiento del evento (contactos) · traspaso a Consolidación.

import type { LocalDateTime, Ymd } from "./types";

export type { LocalDateTime, Ymd };

// ---------- Edición ----------

export const EDITION_STATUSES = ["preparacion", "inscripcion", "evento", "seguimiento", "cerrada"] as const;
export type EditionStatus = (typeof EDITION_STATUSES)[number];

export const EDITION_STATUS_LABEL: Readonly<Record<EditionStatus, string>> = {
  preparacion: "Preparación",
  inscripcion: "Inscripciones abiertas",
  evento: "Día del evento",
  seguimiento: "Seguimiento",
  cerrada: "Cerrada",
};

/** Transiciones permitidas; volver atrás solo un paso y con motivo (lo exige el backend). */
const EDITION_NEXT: Readonly<Record<EditionStatus, readonly EditionStatus[]>> = {
  preparacion: ["inscripcion"],
  inscripcion: ["evento", "preparacion"],
  evento: ["seguimiento", "inscripcion"],
  seguimiento: ["cerrada", "evento"],
  cerrada: [],
};

export function canMoveEdition(from: EditionStatus, to: EditionStatus): boolean {
  return EDITION_NEXT[from].includes(to);
}

/** `outreachEditions/{editionId}`; id estable `vplt-YYYY`. */
export interface Edition {
  id: string;
  year: number;
  title: string;
  /** Fecha del evento (D); puede no estar definida todavía. */
  eventDate: Ymd | null;
  status: EditionStatus;
  /** Actividad del Calendario que representa el evento (se reutiliza, no se copia). */
  calendarEventId: string | null;
  /** Carga inicial sugerida por responsable. */
  maxPerOwner: number;
  /** Edición de la que se copió el equipo (solo estructura, nunca personas). */
  teamCopiedFrom: string | null;
}

export const EDITION_ID_RE = /^vplt-(\d{4})$/;

export function editionIdFor(year: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("año de edición inválido");
  return `vplt-${year}`;
}

/** Una edición cerrada es de solo lectura: sus pendientes no aparecen en la edición vigente. */
export function isReadOnly(edition: Pick<Edition, "status">): boolean {
  return edition.status === "cerrada";
}

// ---------- Equipo de la edición ----------

export const TEAM_ROLES = ["coordinacion", "recepcion", "responsable"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_ROLE_LABEL: Readonly<Record<TeamRole, string>> = {
  coordinacion: "Coordinación",
  recepcion: "Recepción",
  responsable: "Responsable",
};

/** `outreachEditions/{editionId}/team/{uid}`: el rol vale solo dentro de la edición. */
export interface TeamMember {
  uid: string;
  displayName: string;
  roles: TeamRole[];
  active: boolean;
  /** Tope propio; si es null usa `edition.maxPerOwner`. */
  maxAssigned: number | null;
}

/** Copia la ESTRUCTURA del equipo a una edición nueva: sin personas, cargas ni historial. */
export function copyTeamStructure(previous: readonly TeamMember[]): TeamMember[] {
  return previous
    .filter((m) => m.active)
    .map((m) => ({ uid: m.uid, displayName: m.displayName, roles: [...m.roles], active: true, maxAssigned: m.maxAssigned }));
}

// ---------- Inscripción (padrón de la edición) ----------

export const REGISTRATION_SOURCES = ["web", "recepcion", "coordinacion", "mesa"] as const;
export type RegistrationSource = (typeof REGISTRATION_SOURCES)[number];

export const REGISTRATION_SOURCE_LABEL: Readonly<Record<RegistrationSource, string>> = {
  web: "Inscripción web",
  recepcion: "Llegó sin inscripción",
  coordinacion: "Agregada por coordinación",
  mesa: "Agregada en su mesa",
};

export const REGISTRATION_STATUSES = ["activa", "cancelada", "duplicada"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const ATTENDANCE = ["sin_confirmar", "asistio", "no_asistio"] as const;
export type Attendance = (typeof ATTENDANCE)[number];

export const ATTENDANCE_LABEL: Readonly<Record<Attendance, string>> = {
  sin_confirmar: "Sin confirmar",
  asistio: "Asistió",
  no_asistio: "No asistió",
};

export const CONSENT_PURPOSES = ["seguimiento_evento", "mensajes_whatsapp", "traspaso_consolidacion"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_PURPOSE_LABEL: Readonly<Record<ConsentPurpose, string>> = {
  seguimiento_evento: "Contacto de seguimiento del evento",
  mensajes_whatsapp: "Mensajes por WhatsApp",
  traspaso_consolidacion: "Acompañamiento habitual de la iglesia",
};

export const CONSENT_SOURCES = ["formulario_web", "verbal_recepcion", "verbal_responsable", "verbal_mesa"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** Autorización con propósito, fuente y revocación. Sin registro = sin autorización. */
export interface ConsentRecord {
  purpose: ConsentPurpose;
  grantedAt: LocalDateTime;
  source: ConsentSource;
  /** Versión del texto que aceptó la persona (p. ej. «web-2026-1»). */
  textVersion: string;
  revokedAt: LocalDateTime | null;
}

/** Referencia a un sistema externo; el par (system, id) es la clave de idempotencia. */
export interface ExternalRef {
  system: "vplt-web";
  id: string;
  /** Versión monótona de la fuente (updatedAt/revision); solo avanza. */
  sourceRevision: number;
}

/**
 * `outreachRegistrations/{registrationId}`: una persona en UNA edición.
 * `identityId` (`outreachIdentities`, sin datos personales) reconoce a la misma
 * persona entre ediciones: lo SUGIERE el backend por teléfono/correo y lo
 * CONFIRMA coordinación; nunca se fusiona ni se sobreescribe solo.
 * `memberPersonId` solo existe después de un traspaso explícito a Consolidación.
 */
export interface Registration {
  id: string;
  editionId: string;
  identityId: string | null;
  source: RegistrationSource;
  externalRef: ExternalRef | null;
  fullName: string;
  phoneE164: string | null;
  email: string | null;
  /** Nombre de quien invitó (texto de la inscripción, no un usuario). */
  invitedByName: string | null;
  status: RegistrationStatus;
  /** Si status = duplicada: la inscripción que queda vigente. */
  duplicateOf: string | null;
  attendance: Attendance;
  attendanceAt: LocalDateTime | null;
  attendanceBy: string | null;
  consents: ConsentRecord[];
  /** Pidió no recibir más contacto: anula cualquier autorización. */
  doNotContact: boolean;
  ownerUid: string | null;
  /** Lote de distribución que fijó la asignación vigente. */
  assignmentBatchId: string | null;
  /** Campos editados en CDS: la sincronización web ya no los sobreescribe. */
  locallyEdited: string[];
  /** Seguimiento del evento (proyección de los contactos). */
  followUp: EventFollowUpProjection;
  memberPersonId: string | null;
  handedOffAt: LocalDateTime | null;
  /** Mesa del evento donde quedó (doc 40 §6b); su encargado la acompaña después. */
  tableNumber?: number | null;
  /** Código corto de la entrada del sitio (el mismo del QR), para identificarla en la mesa. */
  ticketCode?: string | null;
  createdAt: LocalDateTime;
  revision: number;
}

export interface EventFollowUpProjection {
  lastContactAt: Ymd | null;
  lastResult: EventContactResult | null;
  attempts: number;
  nextAction: string | null;
  nextActionDate: Ymd | null;
}

export const EMPTY_FOLLOW_UP: EventFollowUpProjection = Object.freeze({
  lastContactAt: null,
  lastResult: null,
  attempts: 0,
  nextAction: null,
  nextActionDate: null,
});

export function hasConsent(reg: Pick<Registration, "consents" | "doNotContact">, purpose: ConsentPurpose): boolean {
  if (reg.doNotContact) return false;
  return reg.consents.some((c) => c.purpose === purpose && c.revokedAt === null);
}

/** Contactable para el seguimiento del evento: activa, sin baja y con autorización vigente. */
export function isContactable(reg: Registration): boolean {
  return reg.status === "activa" && hasConsent(reg, "seguimiento_evento");
}

// ---------- Asistencia ----------

export type AttendanceError = "edicion_cerrada" | "inscripcion_inactiva" | "sin_cambio" | "motivo_requerido" | "fuera_del_evento";

export interface AttendanceChange {
  to: Attendance;
  at: LocalDateTime;
  by: string;
  /** Obligatorio para corregir una marca ya hecha. */
  reason?: string;
}

/**
 * «Asistió» se marca con un toque en recepción. «No asistió» solo lo confirma
 * coordinación al cierre (nunca se deduce del silencio). Corregir una marca
 * exige motivo. Repetir la misma marca no cambia nada (idempotente).
 */
export function changeAttendance(
  reg: Registration,
  edition: Pick<Edition, "status">,
  change: AttendanceChange,
): { ok: true; value: Registration } | { ok: false; error: AttendanceError } {
  if (isReadOnly(edition)) return { ok: false, error: "edicion_cerrada" };
  if (reg.status !== "activa") return { ok: false, error: "inscripcion_inactiva" };
  if (reg.attendance === change.to) return { ok: false, error: "sin_cambio" };
  if (change.to === "no_asistio" && edition.status !== "evento" && edition.status !== "seguimiento") {
    return { ok: false, error: "fuera_del_evento" };
  }
  if (reg.attendance !== "sin_confirmar" && !change.reason?.trim()) return { ok: false, error: "motivo_requerido" };
  return {
    ok: true,
    value: { ...reg, attendance: change.to, attendanceAt: change.at, attendanceBy: change.by, revision: reg.revision + 1 },
  };
}

/** Candidatas a «No asistió» al cierre: coordinación las revisa y confirma en lote. */
export function pendingAttendance(regs: readonly Registration[]): Registration[] {
  return regs.filter((r) => r.status === "activa" && r.attendance === "sin_confirmar");
}

// ---------- Seguimiento del evento ----------

export const EVENT_CONTACT_RESULTS = ["contactado", "sin_respuesta", "numero_invalido", "pidio_no_contacto"] as const;
export type EventContactResult = (typeof EVENT_CONTACT_RESULTS)[number];

export const EVENT_CONTACT_RESULT_LABEL: Readonly<Record<EventContactResult, string>> = {
  contactado: "Conversamos",
  sin_respuesta: "No respondió",
  numero_invalido: "Número no válido",
  pidio_no_contacto: "Pidió no ser contactado",
};

/** `outreachRegistrations/{id}/contacts/{id}` (append-only): contactos del EVENTO, nunca `membersFollowUps`. */
export interface EventContact {
  id: string;
  registrationId: string;
  editionId: string;
  date: Ymd;
  channel: "whatsapp" | "llamada" | "presencial";
  result: EventContactResult;
  nextAction: string | null;
  nextActionDate: Ymd | null;
  byUid: string;
}

/** Política de intentos acordada en doc 38 §7: primer contacto D+1–D+2, un segundo intento hasta D+7. */
export const FOLLOW_UP_POLICY = Object.freeze({ firstContactWithinDays: 2, secondAttemptAtDay: 7, maxNoAnswerAttempts: 2 });

export type ContactError = "no_contactable" | "no_asignada" | "edicion_cerrada" | "proxima_accion_incompleta" | "traspasada";

export function recordContact(
  reg: Registration,
  edition: Pick<Edition, "status">,
  contact: EventContact,
): { ok: true; value: Registration } | { ok: false; error: ContactError } {
  if (isReadOnly(edition)) return { ok: false, error: "edicion_cerrada" };
  if (reg.handedOffAt) return { ok: false, error: "traspasada" };
  if (!isContactable(reg)) return { ok: false, error: "no_contactable" };
  if (reg.ownerUid !== contact.byUid) return { ok: false, error: "no_asignada" };
  if ((contact.nextAction === null) !== (contact.nextActionDate === null)) return { ok: false, error: "proxima_accion_incompleta" };
  const optOut = contact.result === "pidio_no_contacto";
  return {
    ok: true,
    value: {
      ...reg,
      doNotContact: reg.doNotContact || optOut,
      followUp: {
        lastContactAt: contact.date,
        lastResult: contact.result,
        attempts: reg.followUp.attempts + 1,
        // Una baja cancela cualquier pendiente en el mismo paso.
        nextAction: optOut ? null : contact.nextAction,
        nextActionDate: optOut ? null : contact.nextActionDate,
      },
      revision: reg.revision + 1,
    },
  };
}

export type QueueBucket = "primer_contacto" | "vencido" | "hoy" | "proximo" | "al_dia" | "baja";

/** En qué fila de «Mi lista» va una persona asignada, relativo a hoy y a D. */
export function queueBucket(reg: Registration, today: Ymd, eventDate: Ymd | null): QueueBucket {
  if (reg.doNotContact || !hasConsent(reg, "seguimiento_evento")) return "baja";
  const f = reg.followUp;
  if (f.attempts === 0) {
    if (!eventDate) return "primer_contacto";
    const due = addDaysSafe(eventDate, FOLLOW_UP_POLICY.firstContactWithinDays);
    return today > due ? "vencido" : "primer_contacto";
  }
  if (!f.nextActionDate) return "al_dia";
  if (f.nextActionDate < today) return "vencido";
  if (f.nextActionDate === today) return "hoy";
  return "proximo";
}

function addDaysSafe(value: Ymd, n: number): Ymd {
  const [y, m, d] = value.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

// ---------- Decisión voluntaria (restringida) ----------

/**
 * PROPUESTO, requiere aprobación (doc 38 §7.3): valores, acceso y conservación.
 * Vive en `outreachDecisions/{registrationId}`, legible solo con
 * `outreach.decisions.read`; nunca en notas, nunca en el documento que lee el
 * responsable, nunca hacia WSP. Sin documento = «No registrada».
 */
export const DECISION_VALUES = ["acepto_a_cristo", "desea_conversar", "no_por_ahora"] as const;
export type DecisionValue = (typeof DECISION_VALUES)[number];

export const DECISION_LABEL: Readonly<Record<DecisionValue | "no_registrada", string>> = {
  no_registrada: "No registrada",
  acepto_a_cristo: "Aceptó a Cristo",
  desea_conversar: "Desea conversar",
  no_por_ahora: "No por ahora",
};

export interface DecisionRecord {
  registrationId: string;
  editionId: string;
  value: DecisionValue;
  /** Siempre la persona: nadie declara por otro. */
  declaredBy: "la_persona";
  /** La persona autorizó que se registre (texto/versión mostrada). */
  consentTextVersion: string;
  recordedAt: LocalDateTime;
  recordedBy: string;
  /** Mesa que la marcó, si se registró en el evento. */
  tableNumber?: number | null;
}

export function parseDecision(raw: Partial<DecisionRecord>): { ok: true; value: DecisionRecord } | { ok: false; error: string } {
  if (!raw.registrationId || !raw.editionId) return { ok: false, error: "inscripcion_requerida" };
  if (!raw.value || !(DECISION_VALUES as readonly string[]).includes(raw.value)) return { ok: false, error: "valor_invalido" };
  if (raw.declaredBy !== "la_persona") return { ok: false, error: "solo_declaracion_propia" };
  if (!raw.consentTextVersion?.trim()) return { ok: false, error: "consentimiento_requerido" };
  if (!raw.recordedAt || !raw.recordedBy) return { ok: false, error: "auditoria_requerida" };
  return { ok: true, value: raw as DecisionRecord };
}
