// Calendario: ocurrencias, permisos de gestión, filtros, grillas y validación.

import { can } from "./access";
import { areaById, selectableAreas } from "./areas";
import { addDays, compareLocal, dayLabel, daysBetween, daysInMonth, isValidTime, isValidYmd, parseYmd, startOfWeek, ymd } from "./dates";
import { expandRecurrence, isRecurring, validateRecurrence } from "./recurrence";
import type { AccessProfile, Area, CalendarEvent, EventInput, EventPatch, LocalDateTime, Occurrence, Ymd } from "./types";

/**
 * Ocurrencias visibles (sin archivadas) en [from, to], ordenadas con
 * compareDayOrder. Pasa `areas` para desempatar por nombre del área responsable.
 */
export function occurrencesInRange(
  events: readonly CalendarEvent[],
  from: Ymd,
  to: Ymd,
  now: LocalDateTime,
  areas?: readonly Area[],
): Occurrence[] {
  return sortOccurrences(events.flatMap((e) => expandRecurrence(e, from, to, now)), areas);
}

/** Claves de orden de una actividad dentro de un día (mismo orden en todas las vistas). */
export interface DayOrderKey {
  date: Ymd;
  allDay: boolean;
  startTime?: string | null;
  areaName: string;
  title: string;
}

/**
 * Comparador ÚNICO (Mes, Semana, Agenda, móvil, público y reporte): por fecha;
 * dentro del día, primero todo el día, luego hora de inicio, nombre del área
 * responsable y título.
 */
export function compareDayOrder(a: DayOrderKey, b: DayOrderKey): number {
  return (
    compareLocal(a.date, b.date) ||
    Number(b.allDay) - Number(a.allDay) ||
    compareLocal(a.allDay ? "" : (a.startTime ?? ""), b.allDay ? "" : (b.startTime ?? "")) ||
    a.areaName.localeCompare(b.areaName, "es") ||
    a.title.localeCompare(b.title, "es")
  );
}

/**
 * Clave de orden de una ocurrencia. El nombre del área sale de `areas`; sin
 * ellas no se desempata por área (solo por título).
 */
export function occurrenceOrderKey(o: Occurrence, areas?: readonly Area[]): DayOrderKey {
  const areaName = areas ? (areaById(areas, o.event.responsibleAreaId)?.name ?? "") : "";
  return { date: o.date, allDay: o.allDay, startTime: o.startTime, areaName, title: o.event.title };
}

/** Ordena con compareDayOrder. */
export function sortOccurrences(list: readonly Occurrence[], areas?: readonly Area[]): Occurrence[] {
  const keys = new Map(list.map((o) => [o, occurrenceOrderKey(o, areas)] as const));
  return [...list].sort((a, b) => compareDayOrder(keys.get(a)!, keys.get(b)!));
}

function responsibleIsMine(p: AccessProfile, e: CalendarEvent, areas: readonly Area[]): boolean {
  const area = areaById(areas, e.responsibleAreaId);
  return !!area && area.active && p.areaIds.includes(area.id);
}

/**
 * ¿Puede editar/cancelar esta actividad (o esta fecha)?
 * archivada → no · manage_all → sí · manage_assigned → solo si el responsable es
 * un área activa suya y la fecha no es pasada (pasado = solo lectura).
 */
export function canManageEvent(p: AccessProfile, e: CalendarEvent, areas: readonly Area[], today: Ymd, occurrenceDate?: Ymd): boolean {
  if (e.status === "archivada") return false;
  // Una actividad simple cancelada queda en solo lectura (para todos).
  if (e.status === "cancelada" && !isRecurring(e)) return false;
  if (can(p, "calendar.events.manage_all")) return true;
  if (!can(p, "calendar.events.manage_assigned")) return false;
  if (!responsibleIsMine(p, e, areas)) return false;
  const ref = occurrenceDate ?? (isRecurring(e) ? (e.recurrence.until ?? e.endDate) : e.endDate);
  return compareLocal(ref, today) >= 0;
}

/** La serie ya terminó: su fecha final (`until`) es anterior a hoy. Sin `until` nunca termina. */
export function isSeriesEnded(e: Pick<CalendarEvent, "recurrence">, today: Ymd): boolean {
  return !!e.recurrence.until && compareLocal(e.recurrence.until, today) < 0;
}

/**
 * Igual que canManageEvent sin la regla de pasado por fecha (las acciones de
 * serie solo tocan ≥ hoy). Con `today`, una serie terminada (until < hoy) es
 * solo lectura para manage_assigned.
 */
export function canManageSeries(p: AccessProfile, e: CalendarEvent, areas: readonly Area[], today?: Ymd): boolean {
  if (e.status === "archivada") return false;
  if (can(p, "calendar.events.manage_all")) return true;
  if (!can(p, "calendar.events.manage_assigned") || !responsibleIsMine(p, e, areas)) return false;
  return !today || !isSeriesEnded(e, today);
}

/** "Eliminar" (archivar): manage_assigned no archiva actividades que ya empezaron (16c §C.5, R10). */
export function canArchiveEvent(p: AccessProfile, e: CalendarEvent, areas: readonly Area[], today: Ymd): boolean {
  if (e.status === "archivada") return false;
  if (can(p, "calendar.events.manage_all")) return true;
  return canManageSeries(p, e, areas) && compareLocal(e.startDate, today) >= 0;
}

/** Áreas que puede elegir como responsable al crear (alias de selectableAreas). */
export function creatableAreas(p: AccessProfile, areas: readonly Area[]): Area[] {
  return selectableAreas(p, areas);
}

export function canCreateEvents(p: AccessProfile, areas: readonly Area[]): boolean {
  return creatableAreas(p, areas).length > 0;
}

export interface MyActivity {
  occurrence: Occurrence;
  role: "responsable" | "participante";
  /** Participar no da edición; el pasado es solo lectura para manage_assigned. */
  readOnly: boolean;
}

/** Actividades de mis áreas (responsable o participante) en el rango. */
export function myActivities(
  p: AccessProfile,
  events: readonly CalendarEvent[],
  areas: readonly Area[],
  from: Ymd,
  to: Ymd,
  now: LocalDateTime,
): MyActivity[] {
  const mine = new Set(p.areaIds);
  const today = now.slice(0, 10);
  return occurrencesInRange(events, from, to, now, areas)
    .filter((o) => mine.has(o.event.responsibleAreaId) || o.event.participantAreaIds.some((id) => mine.has(id)))
    .map((o) => {
      const role = mine.has(o.event.responsibleAreaId) ? "responsable" : "participante";
      return {
        occurrence: o,
        role,
        readOnly: role === "participante" || !canManageEvent(p, o.event, areas, today, o.date),
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

export interface MonthCell {
  date: Ymd;
  inMonth: boolean;
}

/** Grilla del mes, semanas de lunes a domingo (4–6 filas). */
export function monthGrid(year: number, month: number): MonthCell[][] {
  const first = ymd(year, month, 1);
  const last = ymd(year, month, daysInMonth(year, month));
  const start = startOfWeek(first);
  const weeks: MonthCell[][] = [];
  for (let d = start; compareLocal(d, last) <= 0; d = addDays(d, 7)) {
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
  | "temporal";

export type EventErrors = Partial<Record<EventField, string>>;

/**
 * Valida una actividad nueva o editada. `existing` = la actividad editada
 * (para no exigir que el responsable actual siga siendo elegible si no cambia).
 */
export function validateEvent(
  input: EventInput,
  ctx: { profile: AccessProfile; areas: readonly Area[]; today: Ymd; existing?: CalendarEvent },
): EventErrors {
  const e: EventErrors = {};
  const title = input.title?.trim() ?? "";
  if (!title) e.title = "Escribe el nombre de la actividad.";
  else if (title.length > 120) e.title = "Máximo 120 caracteres.";

  const allowed = creatableAreas(ctx.profile, ctx.areas).map((a) => a.id);
  if (!input.responsibleAreaId) e.responsibleAreaId = "Elige el área responsable.";
  else if (!allowed.includes(input.responsibleAreaId) && input.responsibleAreaId !== ctx.existing?.responsibleAreaId)
    e.responsibleAreaId = "Solo puedes elegir tus áreas activas como responsable.";

  const participants = input.participantAreaIds ?? [];
  if (new Set(participants).size !== participants.length) e.participantAreaIds = "Hay áreas participantes repetidas.";
  else if (participants.includes(input.responsibleAreaId)) e.participantAreaIds = "El área responsable no va como participante.";
  else if (participants.length > 8) e.participantAreaIds = "Máximo 8 áreas participantes.";
  else if (participants.some((id) => !areaById(ctx.areas, id))) e.participantAreaIds = "Hay áreas que no existen.";

  const endDate = input.endDate ?? input.startDate;
  if (!isValidYmd(input.startDate)) e.startDate = "Elige la fecha.";
  else if (!ctx.existing && !can(ctx.profile, "calendar.events.manage_all") && compareLocal(input.startDate, ctx.today) < 0)
    e.startDate = "No puedes crear actividades en fechas pasadas.";
  if (!isValidYmd(endDate)) e.endDate = "Elige la fecha de término.";
  else if (isValidYmd(input.startDate) && compareLocal(endDate, input.startDate) < 0)
    e.endDate = "La fecha de término no puede ser anterior al inicio.";

  if (!input.allDay) {
    if (!isValidTime(input.startTime)) e.startTime = "Elige la hora de inicio.";
    if (input.endTime && !isValidTime(input.endTime)) e.endTime = "Hora no válida.";
    else if (input.endTime && endDate === input.startDate && isValidTime(input.startTime) && input.endTime <= input.startTime!)
      e.endTime = "El término debe ser posterior al inicio.";
  }
  if ((input.location ?? "").length > 120) e.location = "Máximo 120 caracteres.";
  if ((input.publicDescription ?? "").length > 1000) e.publicDescription = "Máximo 1.000 caracteres.";
  if ((input.internalNotes ?? "").length > 1000) e.internalNotes = "Máximo 1.000 caracteres.";

  if (input.recurrence && !e.startDate && !e.endDate) {
    const errs = validateRecurrence(input.recurrence, input.startDate, endDate);
    if (errs.length) e.recurrence = errs[0];
  }
  return e;
}

/** La serie (o actividad) ya empezó: su primera fecha es anterior a hoy. */
export function isSeriesStarted(e: Pick<CalendarEvent, "startDate">, today: Ymd): boolean {
  return compareLocal(e.startDate, today) < 0;
}

export const TEMPORAL_LOCK_HELP = "Para cambiar día u hora desde una fecha: Esta y las siguientes (Propuesta).";

/** Combina una actividad con un patch para validarla como EventInput. */
export function mergeEventPatch(e: CalendarEvent, patch: EventPatch): EventInput {
  return {
    title: patch.title ?? e.title,
    responsibleAreaId: patch.responsibleAreaId ?? e.responsibleAreaId,
    participantAreaIds: patch.participantAreaIds ?? e.participantAreaIds,
    startDate: patch.startDate ?? e.startDate,
    endDate: patch.endDate ?? e.endDate,
    allDay: patch.allDay ?? e.allDay,
    startTime: "startTime" in patch ? patch.startTime : e.startTime,
    endTime: "endTime" in patch ? patch.endTime : e.endTime,
    location: patch.location ?? e.location,
    publicDescription: patch.publicDescription ?? e.publicDescription,
    internalNotes: patch.internalNotes ?? e.internalNotes,
    visibility: patch.visibility ?? e.visibility,
    recurrence: patch.recurrence ?? e.recurrence,
  };
}

/**
 * "Editar toda la serie" (16c §C.1): en una serie ya iniciada solo se cambian
 * campos no temporales; `until` puede moverse si queda ≥ hoy.
 */
export function validateSeriesPatch(
  e: CalendarEvent,
  patch: EventPatch,
  ctx: { profile: AccessProfile; areas: readonly Area[]; today: Ymd },
): EventErrors {
  const errors: EventErrors = {};
  if (isSeriesStarted(e, ctx.today)) {
    const merged = mergeEventPatch(e, patch);
    const r = merged.recurrence!;
    const temporalChanged =
      merged.startDate !== e.startDate ||
      merged.endDate !== e.endDate ||
      !!merged.allDay !== e.allDay ||
      (merged.startTime ?? "") !== (e.startTime ?? "") ||
      (merged.endTime ?? "") !== (e.endTime ?? "") ||
      r.freq !== e.recurrence.freq ||
      JSON.stringify(r.monthly ?? null) !== JSON.stringify(e.recurrence.monthly ?? null);
    if (temporalChanged) errors.temporal = TEMPORAL_LOCK_HELP;
    if (r.until !== e.recurrence.until && r.until && compareLocal(r.until, ctx.today) < 0)
      errors.recurrence = "La fecha final no puede quedar en el pasado.";
  }
  const base = validateEvent(mergeEventPatch(e, patch), { ...ctx, existing: e });
  // Una serie iniciada conserva su fecha de inicio pasada: no es un error.
  if (isSeriesStarted(e, ctx.today)) delete base.startDate;
  return { ...base, ...errors };
}

/** Ocurrencias de un mes para una celda de la grilla (incluye las que cruzan el día). */
export function occurrencesOnDay(list: readonly Occurrence[], date: Ymd): Occurrence[] {
  return list.filter((o) => compareLocal(o.date, date) <= 0 && compareLocal(o.endDate, date) >= 0);
}

/** Rango [primer día, último día] del mes de una fecha. */
export function monthRange(date: Ymd): { from: Ymd; to: Ymd } {
  const { y, m } = parseYmd(date);
  return { from: ymd(y, m, 1), to: ymd(y, m, daysInMonth(y, m)) };
}
