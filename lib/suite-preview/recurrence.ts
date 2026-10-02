// Recurrencia (16c §C): weekly · biweekly · monthly "n-ésimo día de la semana"
// con `until` inclusivo. Todo en fechas locales mediante epoch-days.

import {
  addDays,
  addMonthsClamped,
  compareLocal,
  daysBetween,
  daysInMonth,
  monthKey,
  nthWeekdayOfMonth,
  parseYmd,
  shiftMonth,
  toEpochDay,
  weekdayOf,
  WEEKDAY_NAMES,
  numericYmd,
} from "./dates";
import type { CalendarEvent, LocalDateTime, Occurrence, Ordinal, RecurrenceRule, Ymd } from "./types";

export const MAX_OCCURRENCES = 60;
export const MAX_MONTHS = 12;

type EventLike = Pick<
  CalendarEvent,
  | "id"
  | "startDate"
  | "endDate"
  | "allDay"
  | "startTime"
  | "endTime"
  | "status"
  | "recurrence"
  | "exceptions"
  | "seriesCancellation"
  | "cancelReason"
>;

export function eventSpan(e: Pick<CalendarEvent, "startDate" | "endDate">): number {
  return Math.max(0, daysBetween(e.startDate, e.endDate));
}

export function isRecurring(e: Pick<CalendarEvent, "recurrence">): boolean {
  return e.recurrence.freq !== "none";
}

/** Fechas de inicio que genera la regla dentro de [from, to] (sin filtrar estado). */
export function candidateDates(e: Pick<CalendarEvent, "startDate" | "endDate" | "recurrence">, from: Ymd, to: Ymd): Ymd[] {
  const span = eventSpan(e);
  const r = e.recurrence;
  const out: Ymd[] = [];
  if (r.freq === "none") {
    out.push(e.startDate);
  } else if (r.freq === "weekly" || r.freq === "biweekly") {
    const step = r.freq === "weekly" ? 7 : 14;
    const until = r.until ?? e.startDate;
    const start = toEpochDay(e.startDate);
    const k0 = Math.max(0, Math.floor((toEpochDay(from) - span - start) / step));
    for (let k = k0, guard = 0; guard < 1000; k++, guard++) {
      const d = addDays(e.startDate, k * step);
      if (compareLocal(d, until) > 0 || compareLocal(d, to) > 0) break;
      out.push(d);
    }
  } else if (r.freq === "monthly" && r.monthly) {
    const until = r.until ?? e.startDate;
    const last = compareLocal(until, to) < 0 ? until : to;
    const s = parseYmd(e.startDate);
    const lastKey = monthKey(last);
    for (let i = 0; i < 1000; i++) {
      const { y, m } = shiftMonth(s.y, s.m, i);
      const key = `${y}-${String(m).padStart(2, "0")}`;
      if (key > lastKey) break;
      const d = nthWeekdayOfMonth(y, m, r.monthly.weekday, r.monthly.ordinal);
      if (d && compareLocal(d, e.startDate) >= 0 && compareLocal(d, until) <= 0) out.push(d);
    }
  }
  // Intersección con el rango: la vigilia (span 1) aparece también al consultar el día siguiente.
  return out.filter((d) => compareLocal(d, to) <= 0 && compareLocal(addDays(d, span), from) >= 0);
}

/** ¿La regla genera esta fecha de inicio? */
export function isOccurrenceDate(e: Pick<CalendarEvent, "startDate" | "endDate" | "recurrence">, date: Ymd): boolean {
  return candidateDates({ ...e, endDate: e.startDate }, date, date).includes(date);
}

/** Fin de una ocurrencia como fecha-hora local. */
export function occurrenceEnd(e: Pick<CalendarEvent, "startDate" | "endDate" | "allDay" | "startTime" | "endTime">, date: Ymd): LocalDateTime {
  const end = addDays(date, eventSpan(e));
  const time = e.endTime ?? (e.allDay ? "23:59" : (e.startTime ?? "23:59"));
  return `${end}T${time}`;
}

/** Expande una actividad a sus ocurrencias en [from, to] con su estado derivado. */
export function expandRecurrence(e: EventLike & Partial<CalendarEvent>, from: Ymd, to: Ymd, now: LocalDateTime): Occurrence[] {
  if (e.status === "archivada") return [];
  const span = eventSpan(e);
  return candidateDates(e, from, to).map((d) => {
    const exception = e.exceptions.find((x) => x.date === d && x.type === "cancelled");
    let status: Occurrence["status"];
    let cancelReason: string | undefined;
    if (exception) {
      status = "cancelada";
      cancelReason = exception.reason;
    } else if (e.seriesCancellation && compareLocal(d, e.seriesCancellation.from) >= 0) {
      status = "cancelada";
      cancelReason = e.seriesCancellation.reason;
    } else if (e.status === "cancelada") {
      status = "cancelada";
      cancelReason = e.cancelReason;
    } else if (compareLocal(occurrenceEnd(e, d), now) < 0) {
      status = "realizada";
    } else {
      status = "programada";
    }
    return {
      key: `${e.id}@${d}`,
      eventId: e.id,
      event: e as CalendarEvent,
      date: d,
      endDate: addDays(d, span),
      allDay: e.allDay,
      startTime: e.startTime,
      endTime: e.endTime,
      status,
      cancelReason,
      isRecurring: isRecurring(e),
    };
  });
}

/** Ordinales ofrecidos al crear una serie mensual a partir de su fecha de inicio. */
export function monthlyOrdinalOptions(date: Ymd): Ordinal[] {
  const { y, m, d } = parseYmd(date);
  const n = Math.ceil(d / 7);
  if (n >= 5) return [-1];
  if (d + 7 > daysInMonth(y, m)) return [n as Ordinal, -1];
  return [n as Ordinal];
}

const ORDINAL_LABEL: Record<string, string> = { "1": "primer", "2": "segundo", "3": "tercer", "4": "cuarto", "-1": "último" };

export function ordinalLabel(ord: Ordinal): string {
  return ORDINAL_LABEL[String(ord)];
}

/** "el primer sábado", "el último viernes". */
export function monthlyRuleLabel(weekday: number, ord: Ordinal): string {
  return `el ${ordinalLabel(ord)} ${WEEKDAY_NAMES[weekday]}`;
}

/** Resumen en texto: "Cada semana, los domingos, hasta el 28-02-2027". */
export function recurrenceSummary(e: Pick<CalendarEvent, "startDate" | "recurrence">): string {
  const r = e.recurrence;
  const wd = WEEKDAY_NAMES[weekdayOf(e.startDate)];
  const until = r.until ? `, hasta el ${numericYmd(r.until)}` : "";
  switch (r.freq) {
    case "none":
      return "No se repite";
    case "weekly":
      return `Cada semana, los ${wd === "sábado" || wd === "domingo" ? `${wd}s` : wd}${until}`;
    case "biweekly":
      return `Cada 2 semanas, los ${wd === "sábado" || wd === "domingo" ? `${wd}s` : wd}${until}`;
    case "monthly":
      return r.monthly ? `Cada mes, ${monthlyRuleLabel(r.monthly.weekday, r.monthly.ordinal)}${until}` : `Cada mes${until}`;
  }
}

/** Errores de la regla (vacío = válida). */
export function validateRecurrence(rule: RecurrenceRule, startDate: Ymd, endDate: Ymd): string[] {
  const errors: string[] = [];
  if (rule.freq === "none") return errors;
  if (daysBetween(startDate, endDate) > 1)
    errors.push("Las actividades de varios días no se repiten. Crea cada fecha por separado.");
  if (!rule.until) {
    errors.push("Elige hasta cuándo se repite.");
    return errors;
  }
  if (compareLocal(rule.until, startDate) < 0) errors.push("La fecha final debe ser posterior al inicio.");
  if (compareLocal(rule.until, addMonthsClamped(startDate, MAX_MONTHS)) > 0)
    errors.push("Una serie puede durar como máximo 12 meses.");
  if (rule.freq === "monthly") {
    if (!rule.monthly) errors.push("Elige qué día del mes se repite.");
    else {
      const { y, m } = parseYmd(startDate);
      if (nthWeekdayOfMonth(y, m, rule.monthly.weekday, rule.monthly.ordinal) !== startDate)
        errors.push("La fecha de inicio no cumple la regla mensual elegida.");
    }
  }
  if (!errors.length) {
    const count = candidateDates({ startDate, endDate: startDate, recurrence: rule }, startDate, rule.until).length;
    if (count > MAX_OCCURRENCES) errors.push(`Una serie puede tener como máximo ${MAX_OCCURRENCES} fechas.`);
  }
  return errors;
}
