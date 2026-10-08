// Recurrencia V1 (portada de PR #4, revisada): none · weekly · biweekly ·
// monthly "n-ésimo día de la semana" con `until` inclusivo. Todo en fechas
// locales mediante epoch-days: los cambios de horario de Chile no corren nada.
//
// Estados guardados: scheduled | cancelled (solo actividades simples) | archived.
// "realized" se deriva (fin de la ocurrencia < ahora en Santiago); nunca se guarda.

import {
  addDays,
  addMonthsClamped,
  compareLocal,
  daysBetween,
  daysInMonth,
  monthKey,
  nthWeekdayOfMonth,
  numericYmd,
  parseYmd,
  shiftMonth,
  toEpochDay,
  weekdayOf,
  WEEKDAY_NAMES,
} from "./dates";
import type {
  CalendarEvent,
  LocalDateTime,
  Occurrence,
  OccurrenceStatus,
  Ordinal,
  RecurrenceEventLike,
  RecurrenceRule,
  Ymd,
} from "./types";

export const MAX_OCCURRENCES = 60;
export const MAX_MONTHS = 12;
/** Una serie recurrente dura como máximo 1 día extra (vigilia). */
export const MAX_RECURRING_SPAN_DAYS = 1;

type DatesLike = Pick<CalendarEvent, "startDate" | "endDate">;
type RuleLike = Pick<CalendarEvent, "startDate" | "endDate" | "recurrence">;

/** Días que dura una actividad más allá de su fecha de inicio (0 = un día). */
export function eventSpan(e: DatesLike): number {
  return Math.max(0, daysBetween(e.startDate, e.endDate));
}

export function isRecurring(e: Pick<CalendarEvent, "recurrence">): boolean {
  return !!e.recurrence && e.recurrence.freq !== "none";
}

/** Fechas de inicio que genera la regla dentro de [from, to] (sin filtrar estado). */
export function candidateDates(e: RuleLike, from: Ymd, to: Ymd): Ymd[] {
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
export function isOccurrenceDate(e: RuleLike, date: Ymd): boolean {
  return candidateDates({ ...e, endDate: e.startDate }, date, date).includes(date);
}

/** Fin de una ocurrencia como fecha-hora local. */
export function occurrenceEnd(
  e: Pick<CalendarEvent, "startDate" | "endDate" | "allDay" | "startTime" | "endTime">,
  date: Ymd,
): LocalDateTime {
  const end = addDays(date, eventSpan(e));
  const time = e.endTime ?? (e.allDay ? "23:59" : (e.startTime ?? "23:59"));
  return `${end}T${time}`;
}

/** Expande una actividad a sus ocurrencias en [from, to] con su estado derivado. Las archivadas no generan nada. */
export function expandRecurrence<E extends RecurrenceEventLike>(e: E, from: Ymd, to: Ymd, now: LocalDateTime): Occurrence<E>[] {
  if (e.status === "archived") return [];
  const span = eventSpan(e);
  const exceptions = Array.isArray(e.exceptions) ? e.exceptions : [];
  const recurring = isRecurring(e);
  return candidateDates(e, from, to).map((d) => {
    const exception = exceptions.find((x) => x.date === d && x.type === "cancelled");
    let status: OccurrenceStatus;
    let cancelReason: string | null = null;
    if (exception) {
      status = "cancelled";
      cancelReason = exception.reason ?? null;
    } else if (e.seriesCancellation && compareLocal(d, e.seriesCancellation.from) >= 0) {
      status = "cancelled";
      cancelReason = e.seriesCancellation.reason ?? null;
    } else if (e.status === "cancelled") {
      status = "cancelled";
      cancelReason = e.cancelReason ?? null;
    } else if (compareLocal(occurrenceEnd(e, d), now) < 0) {
      status = "realized";
    } else {
      status = "scheduled";
    }
    return {
      key: `${e.id}@${d}`,
      eventId: e.id,
      event: e,
      date: d,
      endDate: addDays(d, span),
      allDay: e.allDay,
      startTime: e.allDay ? null : (e.startTime ?? null),
      endTime: e.allDay ? null : (e.endTime ?? null),
      status,
      cancelReason,
      isRecurring: recurring,
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

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

/** "domingos", "lunes", "sábados". */
export function weekdayPluralName(wd: number): string {
  const name = WEEKDAY_NAMES[wd];
  return name.endsWith("s") ? name : `${name}s`;
}

/**
 * Texto de la recurrencia en el detalle, también publicado en la proyección
 * pública: "Se repite cada viernes hasta el 18 dic 2026",
 * "Cada 2 semanas, los martes, hasta el …", "El primer sábado de cada mes hasta el …".
 */
export function recurrenceDetailText(e: Pick<CalendarEvent, "startDate" | "recurrence">): string | null {
  const r = e.recurrence;
  if (r.freq === "none") return null;
  const wd = weekdayOf(e.startDate);
  let until = "";
  if (r.until) {
    const { y, m, d } = parseYmd(r.until);
    until = ` hasta el ${d} ${MONTHS_SHORT[m - 1]} ${y}`;
  }
  switch (r.freq) {
    case "weekly":
      return `Se repite cada ${WEEKDAY_NAMES[wd]}${until}`;
    case "biweekly":
      return `Cada 2 semanas, los ${weekdayPluralName(wd)}${until ? `,${until}` : ""}`;
    case "monthly": {
      if (!r.monthly) return `Cada mes${until}`;
      const text = `el ${ordinalLabel(r.monthly.ordinal)} ${WEEKDAY_NAMES[r.monthly.weekday]} de cada mes${until}`;
      return text[0].toLocaleUpperCase("es") + text.slice(1);
    }
    default:
      return null;
  }
}

/**
 * Errores de la regla (vacío = válida). Límites V1: `until` obligatorio,
 * ≤ 12 meses desde el inicio, ≤ 60 fechas y span ≤ 1 día para las recurrentes.
 */
export function validateRecurrence(rule: RecurrenceRule, startDate: Ymd, endDate: Ymd): string[] {
  const errors: string[] = [];
  if (rule.freq === "none") return errors;
  if (!["weekly", "biweekly", "monthly"].includes(rule.freq)) {
    errors.push("La frecuencia elegida no es válida.");
    return errors;
  }
  if (daysBetween(startDate, endDate) > MAX_RECURRING_SPAN_DAYS)
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
