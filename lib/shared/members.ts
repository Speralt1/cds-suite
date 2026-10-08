// Integrantes › Consolidación V1 (doc 23). Fuente única de:
// - vocabulario guardado (estados, etapas, tipos y resultados de seguimiento);
// - normalización de teléfono (E.164 con reglas chilenas) y correo;
// - validación ESTRICTA de los payloads de las Functions (claves desconocidas,
//   tipos y largos), que el cliente reutiliza para mostrar errores;
// - transiciones del pipeline y sugerencias (nunca se aplican solas);
// - proyección del resumen de la persona (contadores derivados del historial).
//
// Lo usan el cliente (Next) y las Functions (CommonJS generado en
// functions/shared/members.js por scripts/build-shared.mjs). TS puro: sin
// React, sin Firebase, sin Date (las fechas llegan como "YYYY-MM-DD").
//
// Privacidad V1 (doc 23 §3): NO existen aquí confesión de fe, bautismo, fecha
// de nacimiento, menores, datos médicos/legales/familiares ni archivos.

import { addDays, compareLocal, isValidYmd } from "./dates";
import type { Ymd } from "./types";

// ---------- Vocabulario guardado ----------

export const LIFECYCLE_STAGES = ["en_consolidacion", "integrante"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const CONSOLIDATION_STATUSES = [
  "por_contactar",
  "en_seguimiento",
  "integrandose",
  "integrado",
  "sin_continuidad",
] as const;
export type ConsolidationStatus = (typeof CONSOLIDATION_STATUSES)[number];

/** Estados con acompañamiento abierto. */
export const ACTIVE_STATUSES: readonly ConsolidationStatus[] = ["por_contactar", "en_seguimiento", "integrandose"];

export const CLOSED_REASONS = ["no_responde", "cambio_iglesia", "se_mudo", "no_desea_contacto", "otro"] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];

export const FOLLOW_UP_TYPES = ["whatsapp", "llamada", "presencial", "otro"] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export const FOLLOW_UP_RESULTS = ["contactado", "sin_respuesta", "numero_invalido", "no_desea_contacto", "otro"] as const;
export type FollowUpResult = (typeof FOLLOW_UP_RESULTS)[number];

/** Cómo llegó (opcional). Decisión V1 del doc 23 §4; se puede ajustar sin migración. */
export const ARRIVAL_SOURCES = ["invitacion", "redes_sociales", "evangelismo", "paso_por_el_lugar", "actividad", "otro"] as const;
export type ArrivalSource = (typeof ARRIVAL_SOURCES)[number];

export const STATUS_LABEL: Readonly<Record<ConsolidationStatus, string>> = {
  por_contactar: "Por contactar",
  en_seguimiento: "En seguimiento",
  integrandose: "Integrándose",
  integrado: "Integrado",
  sin_continuidad: "Sin continuidad",
};
export const LIFECYCLE_LABEL: Readonly<Record<LifecycleStage, string>> = {
  en_consolidacion: "En consolidación",
  integrante: "Integrante",
};
export const CLOSED_REASON_LABEL: Readonly<Record<ClosedReason, string>> = {
  no_responde: "No responde",
  cambio_iglesia: "Se cambió de iglesia",
  se_mudo: "Se mudó",
  no_desea_contacto: "No desea contacto",
  otro: "Otro",
};
export const FOLLOW_UP_TYPE_LABEL: Readonly<Record<FollowUpType, string>> = {
  whatsapp: "WhatsApp",
  llamada: "Llamada",
  presencial: "Presencial",
  otro: "Otro",
};
export const FOLLOW_UP_RESULT_LABEL: Readonly<Record<FollowUpResult, string>> = {
  contactado: "Contactado",
  sin_respuesta: "Sin respuesta",
  numero_invalido: "Número inválido",
  no_desea_contacto: "No desea contacto",
  otro: "Otro",
};
export const ARRIVAL_SOURCE_LABEL: Readonly<Record<ArrivalSource, string>> = {
  invitacion: "Lo invitó alguien",
  redes_sociales: "Redes sociales o transmisión en vivo",
  evangelismo: "Evangelismo o campaña",
  paso_por_el_lugar: "Pasaba por el lugar",
  actividad: "Actividad o evento",
  otro: "Otro",
};

// ---------- Límites (iguales en cliente y Functions) ----------

export const MEMBERS_LIMITS = Object.freeze({
  fullName: 120,
  email: 160,
  invitedBy: 80,
  /** Notas operacionales breves (visita y seguimiento). */
  note: 280,
  nextAction: 120,
  closedReasonNote: 200,
  /** Ventana hacia atrás para registrar una visita o un seguimiento. */
  pastDays: 365,
  /** Ventana hacia adelante para la próxima acción. */
  futureDays: 365,
  /** Tamaño máximo del payload serializado de cualquier callable. */
  payloadBytes: 4096,
});

/** Advertencia visible en todo formulario con notas (doc 23 §5). */
export const SENSITIVE_NOTE_WARNING =
  "No registres información médica, legal, familiar sensible ni detalles pastorales confidenciales.";

/** Limitación operativa visible (doc 23 §3). */
export const ADULTS_ONLY_NOTICE = "Consolidación V1 es solo para personas adultas. No registres menores de edad.";

// ---------- Teléfono y correo ----------

export type PhoneResult =
  | { ok: true; e164: string; isChile: boolean }
  | { ok: false; reason: "empty" | "invalid" };

export const PHONE_HELP = "Si es extranjero, escribe el código de país con +.";

/**
 * Normaliza un teléfono (16c §F, validado en la preview). En orden:
 * 1. trim; quitar espacios, guiones, puntos, paréntesis y barras; "00" inicial = "+".
 * 2. Con "+": solo dígitos, 8–15 en total; "+56" exige 9 dígitos nacionales.
 * 3. 11 dígitos con "56" → +56 + 9. 4–5. 9 dígitos (9 celular, 2–8 fijo) → +56.
 * 6. 10 dígitos con "0" inicial cuyo resto cumple 4–5 → se quita el 0.
 * 7. 8 dígitos → +569 (celular anterior a 2012). 8. Lo demás es inválido.
 */
export function normalizePhone(raw: unknown): PhoneResult {
  if (typeof raw !== "string") return { ok: false, reason: raw === undefined || raw === null ? "empty" : "invalid" };
  let s = raw.trim();
  if (!s) return { ok: false, reason: "empty" };
  if (s.length > 40) return { ok: false, reason: "invalid" };
  s = s.replace(/[\s\-.()/]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  const chile = (national: string): PhoneResult => ({ ok: true, e164: `+56${national}`, isChile: true });
  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^\d{8,15}$/.test(digits)) return { ok: false, reason: "invalid" };
    if (digits.startsWith("56")) {
      const national = digits.slice(2);
      return national.length === 9 && /^[2-9]/.test(national) ? chile(national) : { ok: false, reason: "invalid" };
    }
    return { ok: true, e164: `+${digits}`, isChile: false };
  }
  if (!/^\d+$/.test(s)) return { ok: false, reason: "invalid" };
  if (s.length === 11 && s.startsWith("56") && /^[2-9]/.test(s.slice(2))) return chile(s.slice(2));
  if (s.length === 9 && /^[2-9]/.test(s)) return chile(s);
  if (s.length === 10 && s.startsWith("0") && /^[2-9]/.test(s.slice(1))) return chile(s.slice(1));
  if (s.length === 8) return chile(`9${s}`);
  return { ok: false, reason: "invalid" };
}

export function isE164(value: unknown): value is string {
  return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
}

/** Visible: celular "+56 9 1234 5678", Santiago "+56 2 1234 5678", otros fijos "+56 XX XXX XXXX"; extranjeros, tal cual. */
export function formatPhone(e164: string): string {
  if (/^\+56[29]\d{8}$/.test(e164)) return `+56 ${e164[3]} ${e164.slice(4, 8)} ${e164.slice(8)}`;
  if (/^\+56\d{9}$/.test(e164)) return `+56 ${e164.slice(3, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}`;
  return e164;
}

/** "https://wa.me/56912345678": sin texto prellenado, generado localmente. null si no corresponde. */
export function whatsappLink(person: { phoneE164?: unknown; doNotContact?: unknown }): string | null {
  if (person.doNotContact !== false) return null;
  if (!isE164(person.phoneE164)) return null;
  return `https://wa.me/${person.phoneE164.slice(1)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** trim + minúsculas (sin otras transformaciones). */
export function normalizeEmail(raw: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  const value = raw.trim().toLowerCase();
  if (!value || value.length > MEMBERS_LIMITS.email || !EMAIL_RE.test(value)) return { ok: false };
  return { ok: true, value };
}

// ---------- Validación de payloads ----------

/** Códigos de error por campo (el cliente los traduce con FIELD_ERROR_TEXT). */
export type FieldErrorCode =
  | "required"
  | "invalid"
  | "too_long"
  | "unknown_field"
  | "future_date"
  | "too_old"
  | "before_contact"
  | "pair_required"
  | "confirm_required";

export type FieldErrors = Record<string, FieldErrorCode>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export const FIELD_ERROR_TEXT: Readonly<Record<FieldErrorCode, string>> = {
  required: "Este dato es obligatorio.",
  invalid: "El valor no es válido.",
  too_long: "El texto es demasiado largo.",
  unknown_field: "Hay un dato que no corresponde.",
  future_date: "La fecha no puede ser futura.",
  too_old: "La fecha es demasiado antigua.",
  before_contact: "La próxima acción no puede ser anterior al contacto.",
  pair_required: "Completa la próxima acción y su fecha, o deja ambas vacías.",
  confirm_required: "Confirma el cambio para continuar.",
};

/** Id de solicitud generado por el cliente (idempotencia ante doble envío). */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
/** Ids de documento: los genera el servidor (hex) o el calendario. */
export const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface PersonCreateRequest {
  requestId: string;
  fullName: string;
  phone: string;
  email?: string | null;
  /** Fecha de la primera visita (≤ hoy). La fecha de ingreso la pone el servidor. */
  firstVisitDate: Ymd;
  calendarEventId?: string | null;
  arrivalSource?: ArrivalSource | null;
  invitedBy?: string | null;
  followUpOwnerUid?: string | null;
  /** Observación breve de la primera visita. */
  visitNote?: string | null;
}

export interface PersonCreateInput {
  requestId: string;
  fullName: string;
  phoneE164: string;
  email: string | null;
  firstVisitDate: Ymd;
  calendarEventId: string | null;
  arrivalSource: ArrivalSource | null;
  invitedBy: string | null;
  followUpOwnerUid: string | null;
  visitNote: string | null;
}

/** Edición de datos operacionales. Cada clave presente se cambia; null borra (si es opcional). */
export interface PersonUpdateRequest {
  personId: string;
  expectedRevision: number;
  fullName?: string;
  phone?: string;
  email?: string | null;
  arrivalSource?: ArrivalSource | null;
  invitedBy?: string | null;
  followUpOwnerUid?: string | null;
  doNotContact?: boolean;
}

export interface PersonUpdateInput {
  personId: string;
  expectedRevision: number;
  patch: {
    fullName?: string;
    phoneE164?: string;
    email?: string | null;
    arrivalSource?: ArrivalSource | null;
    invitedBy?: string | null;
    followUpOwnerUid?: string | null;
    doNotContact?: boolean;
  };
}

export interface StatusChangeRequest {
  personId: string;
  expectedRevision: number;
  status: ConsolidationStatus;
  /** Obligatorio para "sin_continuidad". */
  closedReason?: ClosedReason | null;
  /** Obligatorio si closedReason = "otro". */
  reasonNote?: string | null;
  /** Obligatorio (true) para "integrado". */
  confirmIntegrated?: boolean;
}

export interface StatusChangeInput {
  personId: string;
  expectedRevision: number;
  status: ConsolidationStatus;
  closedReason: ClosedReason | null;
  reasonNote: string | null;
  confirmIntegrated: boolean;
}

export interface VisitCreateRequest {
  requestId: string;
  personId: string;
  date: Ymd;
  calendarEventId?: string | null;
  note?: string | null;
}

export interface VisitCreateInput {
  requestId: string;
  personId: string;
  date: Ymd;
  calendarEventId: string | null;
  note: string | null;
}

export interface FollowUpCreateRequest {
  requestId: string;
  personId: string;
  contactDate: Ymd;
  type: FollowUpType;
  result: FollowUpResult;
  note?: string | null;
  nextAction?: string | null;
  nextActionDate?: Ymd | null;
  /** Responsable de la próxima acción (por defecto, el de la persona). */
  ownerUid?: string | null;
  /** Sugerencia CONFIRMADA por quien guarda. El servidor la recalcula y rechaza si no coincide. */
  applyStatus?: ConsolidationStatus | null;
  applyDoNotContact?: boolean;
}

export interface FollowUpCreateInput {
  requestId: string;
  personId: string;
  contactDate: Ymd;
  type: FollowUpType;
  result: FollowUpResult;
  note: string | null;
  nextAction: string | null;
  nextActionDate: Ymd | null;
  ownerUid: string | null;
  applyStatus: ConsolidationStatus | null;
  applyDoNotContact: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Tamaño aproximado del JSON (cuenta caracteres; el límite es generoso). */
export function payloadTooLarge(raw: unknown): boolean {
  try {
    return JSON.stringify(raw ?? null).length > MEMBERS_LIMITS.payloadBytes;
  } catch {
    return true;
  }
}

/** Caracteres de control (salvo \t y \n) e invisibles de dirección de texto: nunca en datos guardados. */
const UNSAFE_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

class Reader {
  readonly errors: FieldErrors = {};
  constructor(
    private readonly data: Record<string, unknown>,
    allowed: readonly string[],
  ) {
    for (const key of Object.keys(data)) if (!allowed.includes(key)) this.errors[key] = "unknown_field";
  }
  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }
  raw(key: string): unknown {
    return this.data[key];
  }
  fail(key: string, code: FieldErrorCode): null {
    if (!this.errors[key]) this.errors[key] = code;
    return null;
  }
  /** Texto obligatorio, colapsa espacios. */
  text(key: string, max: number): string | null {
    const v = this.data[key];
    if (v === undefined || v === null) return this.fail(key, "required");
    if (typeof v !== "string" || UNSAFE_TEXT.test(v)) return this.fail(key, "invalid");
    const t = v.replace(/\s+/g, " ").trim();
    if (!t) return this.fail(key, "required");
    if (t.length > max) return this.fail(key, "too_long");
    return t;
  }
  /** Texto opcional: ausente/null/"" → null. */
  optText(key: string, max: number, multiline = false): string | null {
    const v = this.data[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || UNSAFE_TEXT.test(v)) return this.fail(key, "invalid");
    const t = (multiline ? v.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : v.replace(/\s+/g, " ")).trim();
    if (!t) return null;
    if (t.length > max) return this.fail(key, "too_long");
    return t;
  }
  enumValue<T extends string>(key: string, values: readonly T[], optional: boolean): T | null {
    const v = this.data[key];
    if (v === undefined || v === null) return optional ? null : this.fail(key, "required");
    if (typeof v !== "string" || !(values as readonly string[]).includes(v)) return this.fail(key, "invalid");
    return v as T;
  }
  id(key: string, pattern: RegExp, optional: boolean): string | null {
    const v = this.data[key];
    if (v === undefined || v === null || v === "") return optional ? null : this.fail(key, "required");
    if (typeof v !== "string" || !pattern.test(v)) return this.fail(key, "invalid");
    return v;
  }
  /** Fecha local en [today - pastDays, today]. */
  pastDate(key: string, today: Ymd, optional = false): Ymd | null {
    const v = this.data[key];
    if (v === undefined || v === null || v === "") return optional ? null : this.fail(key, "required");
    if (typeof v !== "string" || !isValidYmd(v)) return this.fail(key, "invalid");
    if (compareLocal(v, today) > 0) return this.fail(key, "future_date");
    if (compareLocal(v, addDays(today, -MEMBERS_LIMITS.pastDays)) < 0) return this.fail(key, "too_old");
    return v;
  }
  bool(key: string, optional: boolean): boolean | null {
    const v = this.data[key];
    if (v === undefined) return optional ? null : this.fail(key, "required");
    if (typeof v !== "boolean") return this.fail(key, "invalid");
    return v;
  }
  revision(key: string): number | null {
    const v = this.data[key];
    if (v === undefined || v === null) return this.fail(key, "required");
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1_000_000) return this.fail(key, "invalid");
    return v;
  }
  done<T>(value: T): Parsed<T> {
    return Object.keys(this.errors).length ? { ok: false, errors: { ...this.errors } } : { ok: true, value };
  }
}

function start(raw: unknown, allowed: readonly string[]): Reader | Parsed<never> {
  if (!isPlainObject(raw)) return { ok: false, errors: { _: "invalid" } };
  return new Reader(raw, allowed);
}

function phoneOf(r: Reader, key: string): string | null {
  const res = normalizePhone(r.raw(key));
  if (!res.ok) return r.fail(key, res.reason === "empty" ? "required" : "invalid");
  return res.e164;
}

function emailOf(r: Reader, key: string): string | null {
  const v = r.raw(key);
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return null;
  const res = normalizeEmail(v);
  return res.ok ? res.value : r.fail(key, "invalid");
}

const OWNER_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const PERSON_CREATE_KEYS = [
  "requestId",
  "fullName",
  "phone",
  "email",
  "firstVisitDate",
  "calendarEventId",
  "arrivalSource",
  "invitedBy",
  "followUpOwnerUid",
  "visitNote",
] as const;

export function parsePersonCreate(raw: unknown, today: Ymd): Parsed<PersonCreateInput> {
  const r = start(raw, PERSON_CREATE_KEYS);
  if (!(r instanceof Reader)) return r;
  const value: PersonCreateInput = {
    requestId: r.id("requestId", REQUEST_ID_PATTERN, false) ?? "",
    fullName: r.text("fullName", MEMBERS_LIMITS.fullName) ?? "",
    phoneE164: phoneOf(r, "phone") ?? "",
    email: emailOf(r, "email"),
    firstVisitDate: r.pastDate("firstVisitDate", today) ?? "",
    calendarEventId: r.id("calendarEventId", DOC_ID_PATTERN, true),
    arrivalSource: r.enumValue("arrivalSource", ARRIVAL_SOURCES, true),
    invitedBy: r.optText("invitedBy", MEMBERS_LIMITS.invitedBy),
    followUpOwnerUid: r.id("followUpOwnerUid", OWNER_ID, true),
    visitNote: r.optText("visitNote", MEMBERS_LIMITS.note, true),
  };
  return r.done(value);
}

export const PERSON_UPDATE_KEYS = [
  "personId",
  "expectedRevision",
  "fullName",
  "phone",
  "email",
  "arrivalSource",
  "invitedBy",
  "followUpOwnerUid",
  "doNotContact",
] as const;

export function parsePersonUpdate(raw: unknown): Parsed<PersonUpdateInput> {
  const r = start(raw, PERSON_UPDATE_KEYS);
  if (!(r instanceof Reader)) return r;
  const patch: PersonUpdateInput["patch"] = {};
  if (r.has("fullName")) patch.fullName = r.text("fullName", MEMBERS_LIMITS.fullName) ?? "";
  if (r.has("phone")) patch.phoneE164 = phoneOf(r, "phone") ?? "";
  if (r.has("email")) patch.email = emailOf(r, "email");
  if (r.has("arrivalSource")) patch.arrivalSource = r.enumValue("arrivalSource", ARRIVAL_SOURCES, true);
  if (r.has("invitedBy")) patch.invitedBy = r.optText("invitedBy", MEMBERS_LIMITS.invitedBy);
  if (r.has("followUpOwnerUid")) patch.followUpOwnerUid = r.id("followUpOwnerUid", OWNER_ID, true);
  if (r.has("doNotContact")) patch.doNotContact = r.bool("doNotContact", false) ?? false;
  const value: PersonUpdateInput = {
    personId: r.id("personId", DOC_ID_PATTERN, false) ?? "",
    expectedRevision: r.revision("expectedRevision") ?? 0,
    patch,
  };
  if (!Object.keys(patch).length && !Object.keys(r.errors).length) r.fail("_", "required");
  return r.done(value);
}

export const STATUS_CHANGE_KEYS = [
  "personId",
  "expectedRevision",
  "status",
  "closedReason",
  "reasonNote",
  "confirmIntegrated",
] as const;

export function parseStatusChange(raw: unknown): Parsed<StatusChangeInput> {
  const r = start(raw, STATUS_CHANGE_KEYS);
  if (!(r instanceof Reader)) return r;
  const status = r.enumValue("status", CONSOLIDATION_STATUSES, false);
  const closedReason = r.enumValue("closedReason", CLOSED_REASONS, true);
  const reasonNote = r.optText("reasonNote", MEMBERS_LIMITS.closedReasonNote);
  const confirmIntegrated = r.bool("confirmIntegrated", true) ?? false;
  if (status === "sin_continuidad") {
    if (!closedReason) r.fail("closedReason", "required");
    else if (closedReason === "otro" && !reasonNote) r.fail("reasonNote", "required");
  } else {
    if (closedReason) r.fail("closedReason", "invalid");
    if (reasonNote) r.fail("reasonNote", "invalid");
  }
  if (status === "integrado" && !confirmIntegrated) r.fail("confirmIntegrated", "confirm_required");
  const value: StatusChangeInput = {
    personId: r.id("personId", DOC_ID_PATTERN, false) ?? "",
    expectedRevision: r.revision("expectedRevision") ?? 0,
    status: (status ?? "por_contactar") as ConsolidationStatus,
    closedReason,
    reasonNote,
    confirmIntegrated,
  };
  return r.done(value);
}

export const VISIT_CREATE_KEYS = ["requestId", "personId", "date", "calendarEventId", "note"] as const;

export function parseVisitCreate(raw: unknown, today: Ymd): Parsed<VisitCreateInput> {
  const r = start(raw, VISIT_CREATE_KEYS);
  if (!(r instanceof Reader)) return r;
  return r.done({
    requestId: r.id("requestId", REQUEST_ID_PATTERN, false) ?? "",
    personId: r.id("personId", DOC_ID_PATTERN, false) ?? "",
    date: r.pastDate("date", today) ?? "",
    calendarEventId: r.id("calendarEventId", DOC_ID_PATTERN, true),
    note: r.optText("note", MEMBERS_LIMITS.note, true),
  });
}

export const FOLLOW_UP_CREATE_KEYS = [
  "requestId",
  "personId",
  "contactDate",
  "type",
  "result",
  "note",
  "nextAction",
  "nextActionDate",
  "ownerUid",
  "applyStatus",
  "applyDoNotContact",
] as const;

export function parseFollowUpCreate(raw: unknown, today: Ymd): Parsed<FollowUpCreateInput> {
  const r = start(raw, FOLLOW_UP_CREATE_KEYS);
  if (!(r instanceof Reader)) return r;
  const contactDate = r.pastDate("contactDate", today);
  const nextAction = r.optText("nextAction", MEMBERS_LIMITS.nextAction);
  let nextActionDate: Ymd | null = null;
  const rawNext = r.raw("nextActionDate");
  if (rawNext !== undefined && rawNext !== null && rawNext !== "") {
    if (typeof rawNext !== "string" || !isValidYmd(rawNext)) r.fail("nextActionDate", "invalid");
    else if (contactDate && compareLocal(rawNext, contactDate) < 0) r.fail("nextActionDate", "before_contact");
    else if (compareLocal(rawNext, addDays(today, MEMBERS_LIMITS.futureDays)) > 0) r.fail("nextActionDate", "invalid");
    else nextActionDate = rawNext;
  }
  if (!!nextAction !== !!nextActionDate && !r.errors.nextAction && !r.errors.nextActionDate) {
    r.fail(nextAction ? "nextActionDate" : "nextAction", "pair_required");
  }
  return r.done({
    requestId: r.id("requestId", REQUEST_ID_PATTERN, false) ?? "",
    personId: r.id("personId", DOC_ID_PATTERN, false) ?? "",
    contactDate: contactDate ?? "",
    type: (r.enumValue("type", FOLLOW_UP_TYPES, false) ?? "otro") as FollowUpType,
    result: (r.enumValue("result", FOLLOW_UP_RESULTS, false) ?? "otro") as FollowUpResult,
    note: r.optText("note", MEMBERS_LIMITS.note, true),
    nextAction,
    nextActionDate,
    ownerUid: r.id("ownerUid", OWNER_ID, true),
    applyStatus: r.enumValue("applyStatus", CONSOLIDATION_STATUSES, true),
    applyDoNotContact: r.bool("applyDoNotContact", true) ?? false,
  });
}

// ---------- Pipeline ----------

export interface PipelineState {
  lifecycleStage: LifecycleStage;
  consolidationStatus: ConsolidationStatus;
}

export type TransitionCheck = { ok: true } | { ok: false; reason: "same" | "closed_integrated" | "invalid" };

/**
 * Transiciones manuales permitidas (16a D.2):
 * - entre estados activos, en cualquier sentido;
 * - activo → integrado (con confirmación) o → sin_continuidad (con motivo);
 * - sin_continuidad → en_seguimiento ("Reabrir");
 * - integrado no se reabre en V1 (pertenece a Integrantes, LATER).
 */
export function checkTransition(from: PipelineState, to: ConsolidationStatus): TransitionCheck {
  if (!(CONSOLIDATION_STATUSES as readonly string[]).includes(to)) return { ok: false, reason: "invalid" };
  if (from.consolidationStatus === to) return { ok: false, reason: "same" };
  if (from.consolidationStatus === "integrado" || from.lifecycleStage === "integrante") return { ok: false, reason: "closed_integrated" };
  if (from.consolidationStatus === "sin_continuidad") return to === "en_seguimiento" ? { ok: true } : { ok: false, reason: "invalid" };
  return { ok: true };
}

/** Etapa resultante: solo "integrado" la cambia (una sola identidad, sin crear otra persona). */
export function stageFor(status: ConsolidationStatus, current: LifecycleStage): LifecycleStage {
  return status === "integrado" ? "integrante" : current;
}

export interface FollowUpSuggestion {
  status: ConsolidationStatus | null;
  doNotContact: boolean;
  closedReason: ClosedReason | null;
}

/**
 * Lo que el formulario de seguimiento propone y quien guarda confirma:
 * - primer "contactado" estando Por contactar → En seguimiento;
 * - "no desea contacto" → No contactar + Sin continuidad (motivo: no desea contacto).
 * Nunca se aplica solo: el servidor solo acepta applyStatus/applyDoNotContact iguales a esto.
 */
export function suggestAfterFollowUp(
  person: PipelineState & { doNotContact: boolean; firstContactDate: Ymd | null },
  result: FollowUpResult,
): FollowUpSuggestion {
  const none: FollowUpSuggestion = { status: null, doNotContact: false, closedReason: null };
  if (person.lifecycleStage !== "en_consolidacion") return none;
  if (result === "no_desea_contacto") {
    const canClose = checkTransition(person, "sin_continuidad").ok;
    return {
      status: canClose ? "sin_continuidad" : null,
      doNotContact: !person.doNotContact,
      closedReason: canClose ? "no_desea_contacto" : null,
    };
  }
  if (result === "contactado" && !person.firstContactDate && person.consolidationStatus === "por_contactar") {
    return { status: "en_seguimiento", doNotContact: false, closedReason: null };
  }
  return none;
}

/** Al registrar una visita de una persona cerrada se sugiere "Reabrir seguimiento". */
export function suggestReopenOnVisit(person: PipelineState): boolean {
  return person.lifecycleStage === "en_consolidacion" && person.consolidationStatus === "sin_continuidad";
}

// ---------- Proyección del resumen (lo mantiene la Function en la misma transacción) ----------

/** Campos derivados del historial append-only, guardados en membersPeople para leer sin escanear historial. */
export interface PersonProjection {
  visitCount: number;
  firstVisitDate: Ymd | null;
  lastVisitDate: Ymd | null;
  followUpCount: number;
  lastFollowUpDate: Ymd | null;
  /** Fecha del primer seguimiento con resultado "contactado". */
  firstContactDate: Ymd | null;
  /** Próxima acción vigente: la del seguimiento registrado más recientemente. */
  nextAction: string | null;
  nextActionDate: Ymd | null;
  nextActionOwnerUid: string | null;
}

export const EMPTY_PROJECTION: PersonProjection = Object.freeze({
  visitCount: 0,
  firstVisitDate: null,
  lastVisitDate: null,
  followUpCount: 0,
  lastFollowUpDate: null,
  firstContactDate: null,
  nextAction: null,
  nextActionDate: null,
  nextActionOwnerUid: null,
});

const minYmd = (a: Ymd | null, b: Ymd): Ymd => (a && compareLocal(a, b) <= 0 ? a : b);
const maxYmd = (a: Ymd | null, b: Ymd): Ymd => (a && compareLocal(a, b) >= 0 ? a : b);

export function projectVisit(p: PersonProjection, date: Ymd): PersonProjection {
  return {
    ...p,
    visitCount: p.visitCount + 1,
    firstVisitDate: minYmd(p.firstVisitDate, date),
    lastVisitDate: maxYmd(p.lastVisitDate, date),
  };
}

export function projectFollowUp(
  p: PersonProjection,
  f: Pick<FollowUpCreateInput, "contactDate" | "result" | "nextAction" | "nextActionDate"> & { ownerUid: string | null },
): PersonProjection {
  return {
    ...p,
    followUpCount: p.followUpCount + 1,
    lastFollowUpDate: maxYmd(p.lastFollowUpDate, f.contactDate),
    firstContactDate: f.result === "contactado" ? minYmd(p.firstContactDate, f.contactDate) : p.firstContactDate,
    nextAction: f.nextAction,
    nextActionDate: f.nextActionDate,
    nextActionOwnerUid: f.nextAction ? f.ownerUid : null,
  };
}

/** Lee la proyección de un documento guardado (tolerante). */
export function projectionOf(doc: Record<string, unknown> | null | undefined): PersonProjection {
  const d = doc ?? {};
  const ymdOrNull = (v: unknown): Ymd | null => (typeof v === "string" && isValidYmd(v) ? v : null);
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    visitCount: int(d.visitCount),
    firstVisitDate: ymdOrNull(d.firstVisitDate),
    lastVisitDate: ymdOrNull(d.lastVisitDate),
    followUpCount: int(d.followUpCount),
    lastFollowUpDate: ymdOrNull(d.lastFollowUpDate),
    firstContactDate: ymdOrNull(d.firstContactDate),
    nextAction: str(d.nextAction),
    nextActionDate: ymdOrNull(d.nextActionDate),
    nextActionOwnerUid: str(d.nextActionOwnerUid),
  };
}

// ---------- Auditoría ----------

export const PERSON_CHANGE_ACTIONS = [
  "person_created",
  "profile_updated",
  "owner_changed",
  "do_not_contact_changed",
  "status_changed",
  "stage_changed",
  "visit_recorded",
  "follow_up_recorded",
] as const;
export type PersonChangeAction = (typeof PERSON_CHANGE_ACTIONS)[number];

/** Campos de perfil cuyo VALOR nunca entra al registro de cambios (solo el nombre del campo). */
export const PROFILE_FIELDS = ["fullName", "phoneE164", "email", "arrivalSource", "invitedBy"] as const;

// ---------- Errores de las Functions ----------

export const MEMBERS_ERROR_KEYS = Object.freeze({
  unauthenticated: "members/unauthenticated",
  forbidden: "members/forbidden",
  invalidArgument: "members/invalid-argument",
  payloadTooLarge: "members/payload-too-large",
  notFound: "members/not-found",
  conflict: "members/conflict",
  invalidOwner: "members/invalid-owner",
  invalidTransition: "members/invalid-transition",
  suggestionMismatch: "members/suggestion-mismatch",
  calendarForbidden: "members/calendar-forbidden",
  calendarNotFound: "members/calendar-not-found",
  requestReused: "members/request-reused",
  internal: "members/internal",
});

/** Nombres de los callables (región southamerica-west1). */
export const MEMBERS_CALLABLES = Object.freeze({
  personCreate: "membersPersonCreate",
  personUpdate: "membersPersonUpdate",
  statusChange: "membersStatusChange",
  visitCreate: "membersVisitCreate",
  followUpCreate: "membersFollowUpCreate",
  ownerOptions: "membersOwnerOptions",
});

/** Colecciones (solo lectura para el cliente; escribe el Admin SDK). */
export const MEMBERS_COLLECTIONS = Object.freeze({
  people: "membersPeople",
  visits: "membersVisits",
  followUps: "membersFollowUps",
  changes: "membersPersonChanges",
});
