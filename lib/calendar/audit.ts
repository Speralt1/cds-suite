// Auditoría de actividades: cada escritura de `calendarEvents/{id}` va en el
// MISMO lote que `calendarEvents/{id}/changes/r{revision}` (18a §C.4, §D.4).
// Puro: los planes reciben `now` (serverTimestamp() en el cliente) y el uid.
//
// Espejo EXACTO de lo que exigen las reglas:
// - evento: revision = anterior + 1, lastChangeId = "r" + revision,
//   updatedBy = uid, updatedAt = now; createdBy/createdAt intactos;
// - change: actorUid = uid, at = now, action = expectedAction(),
//   changedFields = claves afectadas del diff − {revision, lastChangeId,
//   updatedBy, updatedAt, lastDate}; before/after ⊆ changedFields y nunca
//   con `internalNotes` (solo su nombre en changedFields); `created` lleva
//   before = after = null y changedFields = [].

import { lastDateOf } from "@/lib/shared/calendar-core";
import type {
  CalendarEvent,
  CalendarEventDoc,
  EventChangeAction,
  EventChangeDoc,
  RecurrenceException,
  RecurrenceRule,
  Visibility,
  Ymd,
} from "@/lib/shared/types";
import type { EventInput } from "./calendar";

/** Claves que el diff de auditoría ignora (igual que `changeEventLinked` de las reglas). */
export const AUDIT_IGNORED_FIELDS = ["revision", "lastChangeId", "updatedBy", "updatedAt", "lastDate"] as const;

/** Campos cuyo valor puede quedar en before/after (nunca internalNotes, motivos, timestamps ni excepciones). */
export const AUDIT_VALUE_FIELDS = [
  "title",
  "responsibleAreaId",
  "participantAreaIds",
  "startDate",
  "endDate",
  "allDay",
  "startTime",
  "endTime",
  "location",
  "publicDescription",
  "visibility",
  "recurrence",
  "status",
] as const;

export const REASON_MIN = 3;
export const REASON_MAX = 300;

export interface AuditContext {
  actorUid: string;
  /** Marca de tiempo del servidor (serverTimestamp()); la misma en evento y change. */
  now: unknown;
}

export interface ChangeOptions extends AuditContext {
  scope?: "event" | "occurrence" | "series";
  occurrenceDate?: Ymd;
  reason?: string | null;
}

type EventDocLike = CalendarEventDoc & Partial<Pick<CalendarEvent, "id">>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

/** Igualdad profunda con la semántica del diff de Firestore (mapas sin orden de claves). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const eq = (a as { isEqual?: (o: unknown) => boolean }).isEqual;
  if (typeof eq === "function") return eq.call(a, b);
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function withoutId(e: EventDocLike): CalendarEventDoc {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) if (k !== "id" && v !== undefined) out[k] = v;
  return out as unknown as CalendarEventDoc;
}

/** Claves afectadas entre dos estados (como `diff().affectedKeys()`), en orden alfabético. */
export function affectedKeys(before: object, after: object): string[] {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].filter((k) => !deepEqual(b[k], a[k])).sort();
}

/** changedFields del registro: affectedKeys − AUDIT_IGNORED_FIELDS. */
export function changedFields(before: object, after: object): string[] {
  const ignored = new Set<string>(AUDIT_IGNORED_FIELDS);
  return affectedKeys(before, after).filter((k) => !ignored.has(k));
}

/** Acción esperada: espejo de `expectedAction(n, o, k)` de las reglas. */
export function expectedAction(before: CalendarEventDoc, after: CalendarEventDoc): EventChangeAction {
  const k = new Set(affectedKeys(before, after));
  if (after.status === "archived" && before.status !== "archived") return "archived";
  if ((after.status === "cancelled" && before.status !== "cancelled") || k.has("exceptions") || k.has("seriesCancellation"))
    return "cancelled";
  if (k.has("visibility")) return "visibility_changed";
  if (k.has("recurrence")) return "recurrence_updated";
  return "updated";
}

function valueMap(state: CalendarEventDoc, fields: readonly string[]): Record<string, unknown> | null {
  const allowed = new Set<string>(AUDIT_VALUE_FIELDS);
  const out: Record<string, unknown> = {};
  const src = state as unknown as Record<string, unknown>;
  for (const f of fields) if (allowed.has(f) && src[f] !== undefined) out[f] = src[f];
  return Object.keys(out).length ? out : null;
}

/**
 * Registro de cambios de una escritura. `before` null = creación.
 * `after` es el estado completo resultante del evento (con `now` como marcas).
 */
export function buildChange(before: EventDocLike | null, after: EventDocLike, opts: ChangeOptions): EventChangeDoc {
  const next = withoutId(after);
  const base = { revision: next.revision, actorUid: opts.actorUid, at: opts.now };
  if (!before) {
    return { ...base, action: "created", changedFields: [], before: null, after: null, reason: null };
  }
  const prev = withoutId(before);
  const fields = changedFields(prev, next);
  const change: EventChangeDoc = {
    ...base,
    action: expectedAction(prev, next),
    changedFields: fields,
    before: valueMap(prev, fields),
    after: valueMap(next, fields),
    reason: opts.reason ? opts.reason : null,
  };
  if (opts.scope) change.scope = opts.scope;
  if (opts.occurrenceDate) change.occurrenceDate = opts.occurrenceDate;
  return change;
}

// ---------- Planes de escritura (evento + change, un lote) ----------

export interface CreatePlan {
  /** Documento completo del evento nuevo. */
  data: CalendarEventDoc;
  /** `changes/r1`. */
  changeId: string;
  change: EventChangeDoc;
}

export interface UpdatePlan {
  /** Solo los campos que cambian + metadatos (para `update()`). */
  patch: Partial<CalendarEventDoc>;
  /** Estado completo resultante (para validar y auditar). */
  next: CalendarEventDoc;
  changeId: string;
  change: EventChangeDoc;
}

export function changeIdFor(revision: number): string {
  return `r${revision}`;
}

function cleanRule(r: RecurrenceRule): RecurrenceRule {
  if (r.freq === "none") return { freq: "none" };
  const out: RecurrenceRule = { freq: r.freq };
  if (r.until) out.until = r.until;
  if (r.freq === "monthly" && r.monthly)
    out.monthly = { mode: "nth_weekday", weekday: r.monthly.weekday, ordinal: r.monthly.ordinal };
  return out;
}

/** Campos editables normalizados como los guarda Firestore (sin undefined, recortados). */
export function normalizeInput(input: EventInput): EventInput {
  const endDate = input.endDate || input.startDate;
  return {
    title: input.title.trim(),
    responsibleAreaId: input.responsibleAreaId,
    participantAreaIds: [...new Set(input.participantAreaIds)].filter((id) => id !== input.responsibleAreaId),
    startDate: input.startDate,
    endDate,
    allDay: input.allDay,
    startTime: input.allDay ? null : (input.startTime || null),
    endTime: input.allDay ? null : (input.endTime || null),
    location: input.location.trim(),
    publicDescription: input.publicDescription.trim(),
    internalNotes: input.internalNotes.trim(),
    visibility: input.visibility,
    recurrence: cleanRule(input.recurrence),
  };
}

export function cleanReason(reason: string): string {
  return reason.trim().slice(0, REASON_MAX);
}

export function isValidReason(reason: string): boolean {
  const r = reason.trim();
  return r.length >= REASON_MIN && r.length <= REASON_MAX;
}

/** Crear: revision 1, scheduled, sin excepciones; change `created` vacío. */
export function planCreate(input: EventInput, ctx: AuditContext): CreatePlan {
  const fields = normalizeInput(input);
  const data: CalendarEventDoc = {
    ...fields,
    status: "scheduled",
    exceptions: [],
    lastDate: lastDateOf(fields),
    revision: 1,
    lastChangeId: changeIdFor(1),
    createdBy: ctx.actorUid,
    createdAt: ctx.now,
    updatedBy: ctx.actorUid,
    updatedAt: ctx.now,
  };
  return { data, changeId: changeIdFor(1), change: buildChange(null, data, ctx) };
}

function planPatch(
  event: EventDocLike,
  patch: Partial<CalendarEventDoc>,
  opts: ChangeOptions,
): UpdatePlan {
  const prev = withoutId(event);
  const revision = prev.revision + 1;
  const meta = {
    revision,
    lastChangeId: changeIdFor(revision),
    updatedBy: opts.actorUid,
    updatedAt: opts.now,
  };
  const full = { ...patch, ...meta };
  const next = { ...prev, ...full } as CalendarEventDoc;
  return { patch: full, next, changeId: meta.lastChangeId, change: buildChange(prev, next, opts) };
}

/** Editar (toda la serie): solo los campos que cambian + `lastDate` recalculado. */
export function planUpdate(event: EventDocLike, input: EventInput, ctx: AuditContext): UpdatePlan {
  const fields = normalizeInput(input);
  const prev = withoutId(event) as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (!deepEqual(prev[k], v)) patch[k] = v;
  const lastDate = lastDateOf(fields);
  if (lastDate !== event.lastDate) patch.lastDate = lastDate;
  return planPatch(event, patch as Partial<CalendarEventDoc>, { ...ctx, scope: "event" });
}

/** Publicar / dejar de publicar (solo `visibility`). */
export function planVisibility(event: EventDocLike, visibility: Visibility, ctx: AuditContext): UpdatePlan {
  return planPatch(event, { visibility }, { ...ctx, scope: "event" });
}

/** Cancelar una actividad simple: status cancelled + motivo. */
export function planCancelEvent(event: EventDocLike, reason: string, ctx: AuditContext): UpdatePlan {
  const r = cleanReason(reason);
  return planPatch(event, { status: "cancelled", cancelReason: r }, { ...ctx, scope: "event", reason: r });
}

/** Cancelar solo una fecha de una serie (agrega una excepción). */
export function planCancelOccurrence(event: EventDocLike, date: Ymd, reason: string, ctx: AuditContext): UpdatePlan {
  const r = cleanReason(reason);
  const exception: RecurrenceException = { date, type: "cancelled", reason: r, by: ctx.actorUid };
  const exceptions = [...(event.exceptions ?? []), exception];
  return planPatch(event, { exceptions }, { ...ctx, scope: "occurrence", occurrenceDate: date, reason: r });
}

/** Cancelar toda la serie desde una fecha (una sola vez). */
export function planCancelSeriesFrom(event: EventDocLike, from: Ymd, reason: string, ctx: AuditContext): UpdatePlan {
  const r = cleanReason(reason);
  return planPatch(
    event,
    { seriesCancellation: { from, reason: r, by: ctx.actorUid, at: ctx.now } },
    { ...ctx, scope: "series", occurrenceDate: from, reason: r },
  );
}

/** "Eliminar" = archivar con motivo (nada se borra). */
export function planArchive(event: EventDocLike, reason: string, ctx: AuditContext): UpdatePlan {
  const r = cleanReason(reason);
  return planPatch(event, { status: "archived", archivedAt: ctx.now, archiveReason: r }, { ...ctx, scope: "event", reason: r });
}
