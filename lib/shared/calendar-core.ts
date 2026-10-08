// Núcleo del calendario compartido por cliente y Functions: ocurrencias en un
// rango, el comparador único de orden dentro del día y `lastDate`.

import { addDays, compareLocal } from "./dates";
import { eventSpan, expandRecurrence, isRecurring } from "./recurrence";
import type { Area, CalendarEvent, LocalDateTime, Occurrence, RecurrenceEventLike, Ymd } from "./types";

export { eventSpan };

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

type OrderableEvent = RecurrenceEventLike & Partial<Pick<CalendarEvent, "title" | "responsibleAreaId">>;

/** Clave de orden de una ocurrencia. Sin `areas` no se desempata por área (solo por título). */
export function occurrenceOrderKey<E extends OrderableEvent>(o: Occurrence<E>, areas?: readonly Area[]): DayOrderKey {
  const areaId = o.event.responsibleAreaId;
  const areaName = areas && areaId ? (areas.find((a) => a.id === areaId)?.name ?? "") : "";
  return {
    date: o.date,
    allDay: o.allDay,
    startTime: o.startTime,
    areaName: typeof areaName === "string" ? areaName : "",
    title: typeof o.event.title === "string" ? o.event.title : "",
  };
}

/** Ordena con compareDayOrder (estable; desempate final por clave de ocurrencia). */
export function sortOccurrences<E extends OrderableEvent>(list: readonly Occurrence<E>[], areas?: readonly Area[]): Occurrence<E>[] {
  const keys = new Map(list.map((o) => [o, occurrenceOrderKey(o, areas)] as const));
  return [...list].sort(
    (a, b) => compareDayOrder(keys.get(a) as DayOrderKey, keys.get(b) as DayOrderKey) || compareLocal(a.key, b.key),
  );
}

/**
 * Ocurrencias visibles (sin archivadas) en [from, to], ordenadas con
 * compareDayOrder. Pasa `areas` para desempatar por nombre del área responsable.
 */
export function occurrencesInRange<E extends OrderableEvent>(
  events: readonly E[],
  from: Ymd,
  to: Ymd,
  now: LocalDateTime,
  areas?: readonly Area[],
): Occurrence<E>[] {
  return sortOccurrences(
    events.flatMap((e) => expandRecurrence(e, from, to, now)),
    areas,
  );
}

/**
 * `lastDate` guardado para consultas por rango (18a §C.3):
 * sin recurrencia → endDate ; recurrente → until + span (span ≤ 1).
 */
export function lastDateOf(e: Pick<CalendarEvent, "startDate" | "endDate" | "recurrence">): Ymd {
  if (!isRecurring(e)) return e.endDate;
  const until = e.recurrence.until ?? e.startDate;
  return addDays(until, eventSpan(e));
}
