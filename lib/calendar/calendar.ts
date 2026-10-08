// Calendario (cliente): permisos de gestión y de publicación, filtros, grillas
// y validación de actividades. Puro (sin React ni Firebase). La expansión de la
// recurrencia, el orden único y las fechas viven en lib/shared y NO se duplican.
//
// Espejo de las reglas (firestore.rules §calendarEvents): la UI anticipa lo que
// las reglas rechazarían para explicar por qué una acción no está disponible.

import { normalizeAccess, profilePermissions } from "@/lib/shared/access";
import { lastDateOf, occurrencesInRange, sortOccurrences } from "@/lib/shared/calendar-core";
import {
  addDays,
  compareLocal,
  dayLabel,
  daysBetween,
  daysInMonth,
  isValidTime,
  isValidYmd,
  parseYmd,
  startOfWeek,
  ymd,
} from "@/lib/shared/dates";
import { isRecurring, validateRecurrence } from "@/lib/shared/recurrence";
import { activeAreas, areaById } from "./areas";
import type {
  Area,
  CalendarEvent,
  HHmm,
  LocalDateTime,
  Occurrence,
  Permission,
  RecurrenceRule,
  UserAccessDoc,
  Visibility,
  Ymd,
} from "@/lib/shared/types";

export { isRecurring, lastDateOf };

/**
 * Lo que la lógica del calendario necesita del usuario actual. Es compatible
 * con el modelo de acceso del cliente (`accessModel()` de lib/access/model).
 */
export interface CalendarActor {
  can(permission: Permission): boolean;
  areaIds: readonly string[];
}

/** Actor desde un documento `users/{uid}` (legacy o v1) con el cierre compartido. */
export function actorFromUserDoc(doc: UserAccessDoc | null | undefined): CalendarActor {
  const profile = normalizeAccess(doc);
  const eff = profilePermissions(profile);
  return { can: (p) => eff.has(p), areaIds: profile?.areaIds ?? [] };
}

/** Campos editables de una actividad (formulario de crear y editar). */
export interface EventInput {
  title: string;
  responsibleAreaId: string;
  participantAreaIds: string[];
  startDate: Ymd;
  endDate: Ymd;
  allDay: boolean;
  startTime: HHmm | null;
  endTime: HHmm | null;
  location: string;
  publicDescription: string;
  internalNotes: string;
  visibility: Visibility;
  recurrence: RecurrenceRule;
}

/** Campos que se publican (iguales a `publicFields()` de las reglas). */
export const PUBLIC_EVENT_FIELDS = [
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
  "recurrence",
] as const;

/** Campos temporales bloqueados en una actividad o serie ya iniciada. */
export const TEMPORAL_EVENT_FIELDS = ["startDate", "endDate", "allDay", "startTime", "endTime"] as const;

export const MAX_PARTICIPANT_AREAS = 8;

// ---------- Áreas ----------

export { areaById };

/** Áreas activas ordenadas por nombre (las de lib/calendar/areas). */
export function activeAreasOf(areas: readonly Area[]): Area[] {
  return activeAreas(areas);
}

function responsibleIsMine(actor: CalendarActor, areaId: string, areas: readonly Area[]): boolean {
  const area = areaById(areas, areaId);
  return !!area && area.active && actor.areaIds.includes(area.id);
}

// ---------- Permisos ----------

/** La serie ya terminó: su fecha final (`until`) es anterior a hoy. */
export function isSeriesEnded(e: Pick<CalendarEvent, "recurrence">, today: Ymd): boolean {
  return isRecurring(e) && !!e.recurrence.until && compareLocal(e.recurrence.until, today) < 0;
}

/** La serie (o actividad) ya empezó: su primera fecha es anterior a hoy. */
export function isSeriesStarted(e: Pick<CalendarEvent, "startDate">, today: Ymd): boolean {
  return compareLocal(e.startDate, today) < 0;
}

/**
 * ¿Puede editar o cancelar esta actividad (o esta fecha)?
 * archivada → no · simple cancelada → no (solo lectura) · manage_all → sí ·
 * manage_assigned → solo si el responsable es un área ACTIVA suya, la serie no
 * está cancelada y la fecha no es pasada (pasado = solo lectura).
 * Ser área participante NO da edición.
 */
export function canManageEvent(
  actor: CalendarActor | null,
  e: CalendarEvent,
  areas: readonly Area[],
  today: Ymd,
  occurrenceDate?: Ymd,
): boolean {
  if (!actor || e.status === "archived") return false;
  if (e.status === "cancelled" && !isRecurring(e)) return false;
  if (actor.can("calendar.events.manage_all")) return true;
  if (!actor.can("calendar.events.manage_assigned")) return false;
  if (!responsibleIsMine(actor, e.responsibleAreaId, areas)) return false;
  if (e.seriesCancellation) return false;
  const ref = occurrenceDate ?? lastDateOf(e);
  return compareLocal(ref, today) >= 0;
}

/**
 * Acciones sobre la serie completa (editar, cancelar desde hoy): igual que
 * canManageEvent sin la regla de pasado por ocurrencia. Con `today`, una serie
 * terminada es solo lectura para manage_assigned.
 */
export function canManageSeries(actor: CalendarActor | null, e: CalendarEvent, areas: readonly Area[], today?: Ymd): boolean {
  if (!actor || e.status === "archived") return false;
  if (actor.can("calendar.events.manage_all")) return true;
  if (!actor.can("calendar.events.manage_assigned") || !responsibleIsMine(actor, e.responsibleAreaId, areas)) return false;
  if (e.seriesCancellation) return false;
  if (!today) return true;
  return compareLocal(lastDateOf(e), today) >= 0;
}

/** "Eliminar" (archivar): manage_assigned no archiva actividades que ya empezaron. */
export function canArchiveEvent(actor: CalendarActor | null, e: CalendarEvent, areas: readonly Area[], today: Ymd): boolean {
  if (!actor || e.status === "archived") return false;
  if (actor.can("calendar.events.manage_all")) return true;
  return canManageSeries(actor, e, areas) && compareLocal(e.startDate, today) >= 0;
}

/**
 * Publicar está separado de gestionar: manage_all, o publish_assigned con el
 * área responsable entre sus áreas (igual que `calendarPublish()` de las reglas).
 */
export function canPublishEvent(actor: CalendarActor | null, e: Pick<CalendarEvent, "responsibleAreaId">): boolean {
  if (!actor) return false;
  if (actor.can("calendar.events.manage_all")) return true;
  return actor.can("calendar.events.publish_assigned") && actor.areaIds.includes(e.responsibleAreaId);
}

/** Áreas que puede elegir como responsable: manage_all → activas; manage_assigned → activas ∩ suyas. */
export function creatableAreas(actor: CalendarActor | null, areas: readonly Area[]): Area[] {
  if (!actor) return [];
  if (actor.can("calendar.events.manage_all")) return activeAreasOf(areas);
  if (!actor.can("calendar.events.manage_assigned")) return [];
  return activeAreasOf(areas).filter((a) => actor.areaIds.includes(a.id));
}

/** Áreas responsables con las que además puede marcar la actividad como Pública. */
export function publishableAreas(actor: CalendarActor | null, areas: readonly Area[]): Area[] {
  return creatableAreas(actor, areas).filter((a) => canPublishEvent(actor, { responsibleAreaId: a.id }));
}

export function canCreateEvents(actor: CalendarActor | null, areas: readonly Area[]): boolean {
  return creatableAreas(actor, areas).length > 0;
}

// ---------- Mis actividades y filtros ----------

/**
 * ¿Se ofrece "Mis actividades" (pestaña y ruta)?
 * - con áreas asignadas, aunque solo lea (18 §11.7);
 * - con `manage_assigned` sin áreas: llega al vacío "Aún no tienes áreas
 *   asignadas" (sabe que debe pedir un área);
 * - Pastor/Administración (`manage_all`) sin áreas no la necesitan: ya
 *   administran todo desde el Calendario;
 * - solo lectura sin áreas: no hay nada que mostrar.
 */
export function showsMyActivities(actor: CalendarActor | null): boolean {
  if (!actor) return false;
  if (actor.areaIds.length > 0) return true;
  return actor.can("calendar.events.manage_assigned") && !actor.can("calendar.events.manage_all");
}

/**
 * Qué hace la ruta /calendario/mis-actividades: "show" si la pestaña se ofrece
 * o si administra todo (entra por enlace directo y ve el vacío); "redirect" al
 * Calendario (con aviso) para quien solo lee y no tiene áreas.
 */
export function myActivitiesRoute(actor: CalendarActor | null): "show" | "redirect" {
  if (showsMyActivities(actor) || actor?.can("calendar.events.manage_all")) return "show";
  return "redirect";
}

export interface MyActivity {
  occurrence: Occurrence;
  role: "responsable" | "participante";
  /** Participar no da edición; el pasado es solo lectura para manage_assigned. */
  readOnly: boolean;
}

/** Actividades de mis áreas (responsable o participante) en el rango. */
export function myActivities(
  actor: CalendarActor,
  events: readonly CalendarEvent[],
  areas: readonly Area[],
  from: Ymd,
  to: Ymd,
  now: LocalDateTime,
): MyActivity[] {
  const mine = new Set(actor.areaIds);
  const today = now.slice(0, 10);
  return occurrencesInRange(events, from, to, now, areas)
    .filter((o) => mine.has(o.event.responsibleAreaId) || o.event.participantAreaIds.some((id) => mine.has(id)))
    .map((o) => {
      const role = mine.has(o.event.responsibleAreaId) ? "responsable" : "participante";
      return {
        occurrence: o,
        role,
        readOnly: role === "participante" || !canManageEvent(actor, o.event, areas, today, o.date),
      };
    });
}

/** Filtro por áreas: vacío = todas. onlyResponsible ignora participantes. */
export function filterByAreas(list: readonly Occurrence[], areaIds: readonly string[], onlyResponsible = false): Occurrence[] {
  if (!areaIds.length) return [...list];
  const set = new Set(areaIds);
  return list.filter(
    (o) => set.has(o.event.responsibleAreaId) || (!onlyResponsible && o.event.participantAreaIds.some((id) => set.has(id))),
  );
}

// ---------- Grillas ----------

export interface MonthCell {
  date: Ymd;
  inMonth: boolean;
}

/** Grilla del mes, semanas de lunes a domingo (4–6 filas). */
export function monthGrid(year: number, month: number): MonthCell[][] {
  const first = ymd(year, month, 1);
  const last = ymd(year, month, daysInMonth(year, month));
  const weeks: MonthCell[][] = [];
  for (let d = startOfWeek(first); compareLocal(d, last) <= 0; d = addDays(d, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(d, i);
        return { date, inMonth: date.slice(0, 7) === first.slice(0, 7) };
      }),
    );
  }
  return weeks;
}

/** Semana (lunes–domingo) que contiene la fecha. */
export function weekRange(date: Ymd): { from: Ymd; to: Ymd; days: Ymd[] } {
  const from = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return { from, to: days[6], days };
}

/** Rango [primer día, último día] del mes de una fecha. */
export function monthRange(date: Ymd): { from: Ymd; to: Ymd } {
  const { y, m } = parseYmd(date);
  return { from: ymd(y, m, 1), to: ymd(y, m, daysInMonth(y, m)) };
}

/** Ocurrencias que tocan un día (incluye las que cruzan el día). */
export function occurrencesOnDay(list: readonly Occurrence[], date: Ymd): Occurrence[] {
  return list.filter((o) => compareLocal(o.date, date) <= 0 && compareLocal(o.endDate, date) >= 0);
}

export interface AgendaGroup {
  date: Ymd;
  /** "Hoy · domingo 4 de octubre", "Mañana · lunes 5 de octubre", "martes 6 de octubre". */
  label: string;
  isToday: boolean;
  items: Occurrence[];
}

/**
 * Agenda: solo días con actividades. Cada ocurrencia va en su día de inicio;
 * si empezó antes del rango (vigilia, campamento), va en el primer día del rango.
 */
export function agendaGroups(list: readonly Occurrence[], today: Ymd, from?: Ymd, areas?: readonly Area[]): AgendaGroup[] {
  const groups = new Map<Ymd, Occurrence[]>();
  for (const o of sortOccurrences(list, areas)) {
    const day = from && compareLocal(o.date, from) < 0 ? from : o.date;
    groups.set(day, [...(groups.get(day) ?? []), o]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareLocal(a, b))
    .map(([date, items]) => {
      const diff = daysBetween(today, date);
      const prefix = diff === 0 ? "Hoy · " : diff === 1 ? "Mañana · " : "";
      return { date, label: `${prefix}${dayLabel(date)}`, isToday: diff === 0, items };
    });
}

/** "11:00–13:00", "19:00", "Todo el día". */
export function occurrenceTimeLabel(o: Pick<Occurrence, "allDay" | "startTime" | "endTime">): string {
  if (o.allDay) return "Todo el día";
  return o.endTime ? `${o.startTime}–${o.endTime}` : (o.startTime ?? "");
}

// ---------- Validación ----------

export type EventField =
  | "title"
  | "responsibleAreaId"
  | "participantAreaIds"
  | "startDate"
  | "endDate"
  | "startTime"
  | "endTime"
  | "location"
  | "publicDescription"
  | "internalNotes"
  | "recurrence"
  | "visibility"
  | "temporal";

export type EventErrors = Partial<Record<EventField, string>>;

export interface ValidationContext {
  actor: CalendarActor | null;
  areas: readonly Area[];
  today: Ymd;
  /** Actividad que se edita (null/undefined = nueva). */
  existing?: CalendarEvent | null;
}

export const STARTED_SERIES_HELP =
  "Esta serie ya empezó: no se puede cambiar el día, la hora ni la frecuencia. Puedes cambiar hasta cuándo se repite y los demás datos.";
export const PAST_START_EDIT_ERROR = "No puedes mover la actividad a una fecha pasada. Elige hoy o una fecha futura.";
export const STARTED_EVENT_HELP = "Esta actividad ya empezó: no se pueden cambiar la fecha ni la hora.";

/** Explicación de una línea para una actividad o serie ya iniciada. */
export function startedLockHelp(e: Pick<CalendarEvent, "recurrence">): string {
  return isRecurring(e) ? STARTED_SERIES_HELP : STARTED_EVENT_HELP;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function normalizeRule(r: RecurrenceRule): unknown {
  if (r.freq === "none") return { freq: "none" };
  return { freq: r.freq, until: r.until ?? null, monthly: r.monthly ? { ...r.monthly } : null };
}

/** ¿Cambia algún campo público respecto de la actividad guardada? */
export function publicFieldsChanged(e: CalendarEvent, input: EventInput): boolean {
  return PUBLIC_EVENT_FIELDS.some((f) =>
    f === "recurrence" ? !sameValue(normalizeRule(e.recurrence), normalizeRule(input.recurrence)) : !sameValue(e[f], input[f]),
  );
}

/** ¿Cambia algún campo temporal (día, hora, frecuencia)? */
export function temporalChanged(e: CalendarEvent, input: EventInput): boolean {
  return (
    TEMPORAL_EVENT_FIELDS.some((f) => !sameValue(e[f], input[f])) ||
    input.recurrence.freq !== e.recurrence.freq ||
    !sameValue(input.recurrence.monthly ?? null, e.recurrence.monthly ?? null)
  );
}

/**
 * Valida una actividad nueva o editada (los mismos límites que las reglas).
 * `existing` = la actividad editada (su área responsable actual sigue siendo
 * válida aunque ya no sea elegible).
 */
export function validateEvent(input: EventInput, ctx: ValidationContext): EventErrors {
  const e: EventErrors = {};
  const existing = ctx.existing ?? null;
  const title = input.title?.trim() ?? "";
  if (!title) e.title = "Escribe el nombre de la actividad.";
  else if (title.length > 120) e.title = "Máximo 120 caracteres.";

  const allowed = creatableAreas(ctx.actor, ctx.areas).map((a) => a.id);
  if (!input.responsibleAreaId) e.responsibleAreaId = "Elige el área responsable.";
  else if (!allowed.includes(input.responsibleAreaId) && input.responsibleAreaId !== existing?.responsibleAreaId)
    e.responsibleAreaId = "Solo puedes elegir tus áreas activas como responsable.";

  const participants = input.participantAreaIds ?? [];
  if (new Set(participants).size !== participants.length) e.participantAreaIds = "Hay áreas participantes repetidas.";
  else if (participants.includes(input.responsibleAreaId)) e.participantAreaIds = "El área responsable no va como participante.";
  else if (participants.length > MAX_PARTICIPANT_AREAS) e.participantAreaIds = "Máximo 8 áreas participantes.";
  else if (participants.some((id) => !areaById(ctx.areas, id))) e.participantAreaIds = "Hay áreas que no existen.";

  const endDate = input.endDate || input.startDate;
  const manageAll = !!ctx.actor?.can("calendar.events.manage_all");
  if (!isValidYmd(input.startDate)) e.startDate = "Elige la fecha.";
  else if (!existing && !manageAll && compareLocal(input.startDate, ctx.today) < 0)
    e.startDate = "No puedes crear actividades en fechas pasadas.";
  else if (existing && !manageAll && input.startDate !== existing.startDate && compareLocal(input.startDate, ctx.today) < 0)
    // Espejo de editOk() en las reglas: sin manage_all, la fecha no se mueve al pasado.
    e.startDate = PAST_START_EDIT_ERROR;
  if (!isValidYmd(endDate)) e.endDate = "Elige la fecha de término.";
  else if (isValidYmd(input.startDate) && compareLocal(endDate, input.startDate) < 0)
    e.endDate = "La fecha de término no puede ser anterior al inicio.";
  else if (isValidYmd(input.startDate) && daysBetween(input.startDate, endDate) > 31)
    e.endDate = "Una actividad puede durar como máximo 31 días.";

  if (!input.allDay) {
    if (!isValidTime(input.startTime)) e.startTime = "Indica la hora de inicio o marca «Todo el día».";
    if (input.endTime && !isValidTime(input.endTime)) e.endTime = "Hora no válida.";
    else if (input.endTime && endDate === input.startDate && isValidTime(input.startTime) && input.endTime <= (input.startTime ?? ""))
      e.endTime = "El término debe ser posterior al inicio.";
  }
  if ((input.location ?? "").length > 120) e.location = "Máximo 120 caracteres.";
  if ((input.publicDescription ?? "").length > 1000) e.publicDescription = "Máximo 1.000 caracteres.";
  if ((input.internalNotes ?? "").length > 1000) e.internalNotes = "Máximo 1.000 caracteres.";

  if (input.recurrence && !e.startDate && !e.endDate) {
    if (input.recurrence.freq !== "none" && !input.recurrence.until) e.recurrence = "Indica hasta cuándo se repite.";
    else {
      const errs = validateRecurrence(input.recurrence, input.startDate, endDate);
      if (errs.length) e.recurrence = errs[0];
    }
  }

  // Publicar ≠ gestionar (R10).
  if (input.visibility === "public") {
    const canNew = canPublishEvent(ctx.actor, { responsibleAreaId: input.responsibleAreaId });
    const wasPublic = existing?.visibility === "public";
    if (!wasPublic && !canNew) e.visibility = "No tienes permiso para publicar actividades de esta área. Guárdala como Solo equipo.";
    else if (wasPublic && existing && !canNew && publicFieldsChanged(existing, input)) {
      // Espejo de publishOk(): editar campos públicos de una actividad pública exige publicar en su área.
      e.visibility =
        "Esta actividad es pública: solo quien puede publicar cambia su título, fecha, lugar, áreas o descripción. Puedes editar las notas internas.";
    }
  }
  return e;
}

/**
 * "Editar toda la serie": en una serie (o actividad) ya iniciada no cambian
 * día, hora ni frecuencia; `until` puede moverse si queda ≥ hoy.
 */
export function validateSeriesPatch(e: CalendarEvent, input: EventInput, ctx: Omit<ValidationContext, "existing">): EventErrors {
  const errors: EventErrors = {};
  const started = isSeriesStarted(e, ctx.today);
  if (started) {
    if (temporalChanged(e, input)) errors.temporal = startedLockHelp(e);
    const until = input.recurrence.until;
    if (isRecurring(input) && until !== e.recurrence.until && until && compareLocal(until, ctx.today) < 0)
      errors.recurrence = "La fecha final no puede quedar en el pasado.";
  }
  const base = validateEvent(input, { ...ctx, existing: e });
  // Una serie iniciada conserva su fecha de inicio pasada: no es un error.
  if (started) delete base.startDate;
  return { ...base, ...errors };
}
