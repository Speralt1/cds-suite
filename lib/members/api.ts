"use client";

// Callables de Consolidación V1 (doc 23 §5, región southamerica-west1). Toda
// escritura pasa por aquí: el cliente NO escribe en Firestore. Sin
// actualizaciones optimistas: la UI muestra el resultado cuando el callable
// resuelve y onSnapshot refresca los datos.
//
// Errores: `HttpsError` con clave `members/*` (en `message` o en
// `details.key`) y, para datos inválidos, `details.fields` con códigos por campo
// (FieldErrorCode). Aquí se traducen a español; nunca se muestran códigos.

import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase";
import { errorCode, errorKey } from "@/lib/calendar/errors";
import {
  FIELD_ERROR_TEXT,
  MEMBERS_CALLABLES,
  MEMBERS_ERROR_KEYS,
  REQUEST_ID_PATTERN,
  type FieldErrorCode,
  type FollowUpCreateRequest,
  type PersonCreateRequest,
  type PersonUpdateRequest,
  type StatusChangeRequest,
  type VisitCreateRequest,
} from "@/lib/shared/members";
import type { OwnerOption } from "./types";

// ---------- requestId (idempotencia ante doble envío) ----------

/** Id de solicitud: uno por formulario abierto, reutilizado en cada reintento. */
export function newRequestId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  let id = "";
  if (c && typeof c.randomUUID === "function") id = c.randomUUID().replace(/-/g, "");
  else if (c && typeof c.getRandomValues === "function")
    id = Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  else id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  return REQUEST_ID_PATTERN.test(id) ? id : `r${id.replace(/[^A-Za-z0-9_-]/g, "").padEnd(16, "0").slice(0, 63)}`;
}

// ---------- Errores ----------

export type MembersErrorKind =
  | "conflict"
  | "fields"
  | "permission"
  | "network"
  | "not_found"
  | "invalid_owner"
  | "invalid_transition"
  | "suggestion_mismatch"
  | "calendar"
  | "other";

export const MEMBERS_ERROR_TEXT: Readonly<Record<string, string>> = {
  [MEMBERS_ERROR_KEYS.unauthenticated]: "Tu sesión expiró. Vuelve a iniciar sesión.",
  [MEMBERS_ERROR_KEYS.forbidden]: "No tienes permiso para hacer este cambio. Si cambiaron tus permisos, recarga la página.",
  [MEMBERS_ERROR_KEYS.invalidArgument]: "Revisa los datos marcados.",
  [MEMBERS_ERROR_KEYS.payloadTooLarge]: "Los datos son demasiado largos. Acorta las notas e inténtalo de nuevo.",
  [MEMBERS_ERROR_KEYS.notFound]: "No encontramos esta persona. Recarga la página.",
  [MEMBERS_ERROR_KEYS.conflict]: "Alguien actualizó esta persona. Recarga para ver los cambios.",
  [MEMBERS_ERROR_KEYS.invalidOwner]: "El responsable elegido ya no tiene acceso a Consolidación. Elige otro.",
  [MEMBERS_ERROR_KEYS.invalidTransition]: "Ese cambio de estado ya no es posible. Recarga para ver el estado actual.",
  [MEMBERS_ERROR_KEYS.suggestionMismatch]:
    "La situación de esta persona cambió. Revisa la sugerencia y vuelve a guardar.",
  [MEMBERS_ERROR_KEYS.calendarForbidden]: "No tienes acceso al calendario para asociar una actividad. Guarda sin actividad.",
  [MEMBERS_ERROR_KEYS.calendarNotFound]: "La actividad elegida ya no está disponible. Elige otra o guarda sin actividad.",
  [MEMBERS_ERROR_KEYS.requestReused]: "Esta solicitud ya se usó con otros datos. Cierra el formulario y vuelve a abrirlo.",
  [MEMBERS_ERROR_KEYS.internal]: "Algo salió mal. Inténtalo de nuevo en unos minutos.",
};

export const MEMBERS_NETWORK_TEXT = "No pudimos guardar. Revisa tu conexión e inténtalo de nuevo.";
export const MEMBERS_UNEXPECTED_TEXT = "Algo salió mal. Inténtalo de nuevo en unos minutos.";
export const MEMBERS_CONFLICT_TEXT = MEMBERS_ERROR_TEXT[MEMBERS_ERROR_KEYS.conflict];

/** Textos por campo más específicos que FIELD_ERROR_TEXT. */
const FIELD_OVERRIDES: Readonly<Record<string, Partial<Record<FieldErrorCode, string>>>> = {
  fullName: { required: "Escribe el nombre." },
  phone: { required: "Escribe el teléfono.", invalid: "Revisa el número: debe tener 9 dígitos (o el código de país con +)." },
  email: { invalid: "Correo no válido." },
  firstVisitDate: { required: "Indica la fecha de la primera visita.", future_date: "La primera visita no puede ser futura." },
  date: { required: "Indica la fecha de la visita.", future_date: "La visita no puede ser futura." },
  contactDate: { required: "Indica la fecha del contacto.", future_date: "El seguimiento no puede ser futuro." },
  result: { required: "Elige el resultado del contacto." },
  type: { required: "Elige el tipo de contacto." },
  status: { required: "Elige el nuevo estado." },
  closedReason: { required: "Elige el motivo de Sin continuidad." },
  reasonNote: { required: "Escribe el motivo." },
  nextActionDate: { invalid: "Revisa la fecha de la próxima acción (máximo un año)." },
  followUpOwnerUid: { invalid: "Elige un responsable de la lista." },
  ownerUid: { invalid: "Elige un responsable de la lista." },
  calendarEventId: { invalid: "Elige una actividad de la lista." },
};

/** Mensaje en español para un campo con error (código del validador compartido). */
export function fieldMessage(field: string, code: FieldErrorCode): string {
  return FIELD_OVERRIDES[field]?.[code] ?? FIELD_ERROR_TEXT[code] ?? FIELD_ERROR_TEXT.invalid;
}

/** Errores por campo (códigos) → mensajes en español. */
export function fieldMessages(errors: Partial<Record<string, FieldErrorCode>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, code] of Object.entries(errors)) if (code) out[k] = fieldMessage(k, code);
  return out;
}

export class MembersApiError extends Error {
  readonly key: string;
  readonly kind: MembersErrorKind;
  /** Mensajes por campo (solo `members/invalid-argument` con details.fields, o invalid-owner). */
  readonly fields: Record<string, string>;
  constructor(key: string, kind: MembersErrorKind, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "MembersApiError";
    this.key = key;
    this.kind = kind;
    this.fields = fields;
  }
}

const NETWORK_CODES = new Set(["unavailable", "deadline-exceeded", "network-request-failed", "cancelled", "resource-exhausted"]);

function detailsOf(error: unknown): Record<string, unknown> {
  const d = typeof error === "object" && error !== null ? (error as { details?: unknown }).details : null;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
}

/** Cualquier error de un callable → MembersApiError con mensaje en español. */
export function toMembersError(error: unknown): MembersApiError {
  if (error instanceof MembersApiError) return error;
  const details = detailsOf(error);
  const msg = errorKey(error);
  const key = msg.startsWith("members/")
    ? msg
    : typeof details.key === "string" && details.key.startsWith("members/")
      ? details.key
      : "";
  const code = errorCode(error);
  const rawFields = details.fields && typeof details.fields === "object" ? (details.fields as Record<string, unknown>) : {};
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFields)) {
    if (k === "_") continue;
    fields[k] = typeof v === "string" && v in FIELD_ERROR_TEXT ? fieldMessage(k, v as FieldErrorCode) : FIELD_ERROR_TEXT.invalid;
  }
  const K = MEMBERS_ERROR_KEYS;
  switch (key) {
    case K.conflict:
      return new MembersApiError(key, "conflict", MEMBERS_ERROR_TEXT[key]);
    case K.invalidArgument:
      return new MembersApiError(key, Object.keys(fields).length ? "fields" : "other", MEMBERS_ERROR_TEXT[key], fields);
    case K.payloadTooLarge:
      return new MembersApiError(key, "other", MEMBERS_ERROR_TEXT[key], fields);
    case K.unauthenticated:
    case K.forbidden:
      return new MembersApiError(key, "permission", MEMBERS_ERROR_TEXT[key]);
    case K.notFound:
      return new MembersApiError(key, "not_found", MEMBERS_ERROR_TEXT[key]);
    case K.invalidOwner:
      return new MembersApiError(key, "invalid_owner", MEMBERS_ERROR_TEXT[key], fields);
    case K.invalidTransition:
      return new MembersApiError(key, "invalid_transition", MEMBERS_ERROR_TEXT[key]);
    case K.suggestionMismatch:
      return new MembersApiError(key, "suggestion_mismatch", MEMBERS_ERROR_TEXT[key]);
    case K.calendarForbidden:
    case K.calendarNotFound:
      return new MembersApiError(key, "calendar", MEMBERS_ERROR_TEXT[key], { calendarEventId: MEMBERS_ERROR_TEXT[key] });
    case K.requestReused:
    case K.internal:
      return new MembersApiError(key, "other", MEMBERS_ERROR_TEXT[key]);
  }
  if (NETWORK_CODES.has(code) || /network|offline/i.test(msg)) return new MembersApiError("", "network", MEMBERS_NETWORK_TEXT);
  if (code === "permission-denied" || code === "unauthenticated")
    return new MembersApiError("", "permission", MEMBERS_ERROR_TEXT[K.forbidden]);
  return new MembersApiError("", "other", MEMBERS_UNEXPECTED_TEXT);
}

// ---------- Respuestas (tolerantes) ----------

export interface DuplicateRef {
  personId: string;
  by: ("telefono" | "correo")[];
}

export interface PersonCreateResult {
  personId: string;
  replay: boolean;
  /** Posibles duplicados detectados por el servidor (advertencia, nunca bloquea). */
  duplicates: DuplicateRef[];
}

export interface VisitCreateResult {
  visitId: string;
  replay: boolean;
  /** Persona en Sin continuidad que volvió: se SUGIERE reabrir (no se aplica sola). */
  suggestReopen: boolean;
  /** Revisión de la persona tras el cambio (si el servidor la informa). */
  revision: number | null;
}

export interface WriteResult {
  replay: boolean;
  revision: number | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const revisionOf = (d: Obj) => (typeof d.revision === "number" && Number.isInteger(d.revision) ? d.revision : null);

function parseDuplicates(v: unknown): DuplicateRef[] {
  if (!Array.isArray(v)) return [];
  const out: DuplicateRef[] = [];
  for (const item of v) {
    if (typeof item === "string" && item) {
      out.push({ personId: item, by: [] });
      continue;
    }
    const d = obj(item);
    const personId = typeof d.personId === "string" ? d.personId : typeof d.id === "string" ? d.id : "";
    if (!personId) continue;
    const raw = Array.isArray(d.by) ? d.by : Array.isArray(d.matches) ? d.matches : typeof d.by === "string" ? [d.by] : [];
    const by = raw
      .map((x) => (x === "phone" || x === "phoneE164" || x === "telefono" ? "telefono" : x === "email" || x === "correo" ? "correo" : null))
      .filter((x): x is "telefono" | "correo" => !!x);
    out.push({ personId, by: [...new Set(by)] });
  }
  return out;
}

async function callRaw<Req>(name: string, payload: Req): Promise<unknown> {
  try {
    const fn = httpsCallable<Req, unknown>(getFirebaseFunctions(), name);
    const { data } = await fn(payload);
    return data;
  } catch (error) {
    throw toMembersError(error);
  }
}

async function call<Req>(name: string, payload: Req): Promise<Obj> {
  return obj(await callRaw(name, payload));
}

/** Quita claves undefined (el servidor rechaza claves desconocidas, no las ausentes). */
function clean<T extends object>(payload: T): T {
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)) as T;
}

// ---------- Callables ----------

export async function createPerson(req: PersonCreateRequest): Promise<PersonCreateResult> {
  const d = await call(MEMBERS_CALLABLES.personCreate, clean(req));
  const personId = typeof d.personId === "string" ? d.personId : "";
  if (!personId) throw new MembersApiError("", "other", MEMBERS_UNEXPECTED_TEXT);
  return { personId, replay: d.replay === true, duplicates: parseDuplicates(d.duplicates) };
}

export async function updatePerson(req: PersonUpdateRequest): Promise<WriteResult> {
  const d = await call(MEMBERS_CALLABLES.personUpdate, clean(req));
  return { replay: d.replay === true, revision: revisionOf(d) };
}

export async function changeStatus(req: StatusChangeRequest): Promise<WriteResult> {
  const d = await call(MEMBERS_CALLABLES.statusChange, clean(req));
  return { replay: d.replay === true, revision: revisionOf(d) };
}

export async function createVisit(req: VisitCreateRequest): Promise<VisitCreateResult> {
  const d = await call(MEMBERS_CALLABLES.visitCreate, clean(req));
  return {
    visitId: typeof d.visitId === "string" ? d.visitId : "",
    replay: d.replay === true,
    suggestReopen: d.suggestReopen === true,
    revision: revisionOf(d),
  };
}

export async function createFollowUp(req: FollowUpCreateRequest): Promise<WriteResult & { followUpId: string }> {
  const d = await call(MEMBERS_CALLABLES.followUpCreate, clean(req));
  return { followUpId: typeof d.followUpId === "string" ? d.followUpId : "", replay: d.replay === true, revision: revisionOf(d) };
}

/** Usuarios activos con members.consolidation.manage: `{uid, displayName}` (sin correos). */
export async function fetchOwnerOptions(): Promise<OwnerOption[]> {
  const raw = await callRaw<Record<string, never>>(MEMBERS_CALLABLES.ownerOptions, {});
  const d = obj(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(d.owners)
      ? d.owners
      : Array.isArray(d.options)
        ? d.options
        : Array.isArray(d.users)
          ? d.users
          : [];
  const out: OwnerOption[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const o = obj(item);
    const uid = typeof o.uid === "string" ? o.uid : "";
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    const name = typeof o.displayName === "string" ? o.displayName.replace(/\s+/g, " ").trim() : "";
    out.push({ uid, displayName: name && !name.includes("@") ? name : "Sin nombre" });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
}
