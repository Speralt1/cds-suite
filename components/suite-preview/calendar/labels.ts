// Textos derivados del Calendario (es-CL): fechas, horas, recurrencia y
// etiquetas accesibles. Puro (sin React). Fechas siempre locales "YYYY-MM-DD".

import { areaById } from "@/lib/suite-preview/areas";
import { addMonthsClamped, compareLocal, dayLabel, isValidYmd, MONTH_NAMES, parseYmd, weekdayOf, WEEKDAY_NAMES } from "@/lib/suite-preview/dates";
import { candidateDates, isRecurring, monthlyOrdinalOptions, ordinalLabel, recurrenceDetailText, weekdayPluralName } from "@/lib/suite-preview/recurrence";
import type { AccessProfile, Area, CalendarEvent, Occurrence, Ordinal, RecurrenceRule, Ymd } from "@/lib/suite-preview/types";

export const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;
export const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;

/** "vie 9 oct" */
export function shortDay(date: Ymd): string {
  const { m, d } = parseYmd(date);
  return `${WEEKDAYS_SHORT[weekdayOf(date)]} ${d} ${MONTHS_SHORT[m - 1]}`;
}

/** "18 dic 2026" */
export function shortDateYear(date: Ymd): string {
  const { y, m, d } = parseYmd(date);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "9 oct" */
export function dayMonthShort(date: Ymd): string {
  const { m, d } = parseYmd(date);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

/** "28 sep – 4 oct 2026" */
export function weekTitle(from: Ymd, to: Ymd): string {
  const a = parseYmd(from);
  const b = parseYmd(to);
  const left = a.m === b.m ? `${a.d}` : `${a.d} ${MONTHS_SHORT[a.m - 1]}${a.y !== b.y ? ` ${a.y}` : ""}`;
  return `${left} – ${b.d} ${MONTHS_SHORT[b.m - 1]} ${b.y}`;
}

/** "domingos", "lunes", "sábados". */
export function weekdayPlural(wd: number): string {
  return weekdayPluralName(wd);
}

export function capitalize(text: string): string {
  return text ? text[0].toLocaleUpperCase("es") + text.slice(1) : text;
}

/** "viernes 9 de octubre · 20:00 – 22:00" (o "Todo el día", o con fin otro día). */
export function occurrenceWhen(o: Pick<Occurrence, "date" | "endDate" | "allDay" | "startTime" | "endTime">): string {
  const multi = compareLocal(o.endDate, o.date) > 0;
  if (o.allDay) {
    return multi ? `${dayLabel(o.date)} – ${dayLabel(o.endDate)} · Todo el día` : `${dayLabel(o.date)} · Todo el día`;
  }
  const time = o.endTime ? `${o.startTime} – ${o.endTime}` : (o.startTime ?? "");
  return multi ? `${dayLabel(o.date)} · ${time} (termina el ${dayLabel(o.endDate)})` : `${dayLabel(o.date)} · ${time}`;
}

/** "11:00 a 13:00" para lectores de pantalla. */
export function spokenTime(o: Pick<Occurrence, "allDay" | "startTime" | "endTime">): string {
  if (o.allDay) return "todo el día";
  return o.endTime ? `${o.startTime} a ${o.endTime}` : (o.startTime ?? "");
}

/** Texto de la recurrencia en el detalle: "Se repite cada viernes hasta el 18 dic 2026". */
export function recurrenceText(e: Pick<CalendarEvent, "startDate" | "recurrence">): string | null {
  return recurrenceDetailText(e);
}

/** "1 fecha cancelada (vie 16 oct)". */
export function exceptionsText(e: Pick<CalendarEvent, "exceptions">): string | null {
  const list = e.exceptions.filter((x) => x.type === "cancelled");
  if (!list.length) return null;
  const dates = list.map((x) => shortDay(x.date)).join(", ");
  return `${list.length} ${list.length === 1 ? "fecha cancelada" : "fechas canceladas"} (${dates})`;
}

/** "con Alabanza, Multimedia +1" (máx. 2 nombres). */
export function participantsLine(e: Pick<CalendarEvent, "participantAreaIds">, areas: readonly Area[], max = 2): string | null {
  const names = e.participantAreaIds.map((id) => areaById(areas, id)?.name).filter((n): n is string => !!n);
  if (!names.length) return null;
  const shown = names.slice(0, max).join(", ");
  return `con ${shown}${names.length > max ? ` +${names.length - max}` : ""}`;
}

export function statusWord(o: Pick<Occurrence, "status">): string {
  return o.status === "cancelada" ? "cancelada" : o.status === "realizada" ? "realizada" : "programada";
}

/** aria-label completo: título, fecha, hora, área, visibilidad y estado. */
export function occurrenceAria(o: Occurrence, areas: readonly Area[]): string {
  const area = areaById(areas, o.event.responsibleAreaId)?.name ?? "";
  const vis = o.event.visibility === "public" ? "pública" : "solo equipo";
  const status = o.status === "programada" ? "" : `, ${statusWord(o)}`;
  return `${o.event.title}, ${dayLabel(o.date)}, ${spokenTime(o)}, ${area}, ${vis}${status}`;
}

/** Nombre humano de un usuario demo (nunca su identificador interno). */
export function personName(users: readonly AccessProfile[], uid: string | undefined): string {
  if (!uid) return "—";
  return users.find((u) => u.uid === uid)?.displayName ?? "Usuario de CDS";
}

// ---------- Repetición en el formulario ----------

export type RepeatValue = "none" | "weekly" | "biweekly" | `monthly:${Ordinal}`;

export interface RepeatOption {
  value: RepeatValue;
  label: string;
}

/**
 * Etiquetas calculadas desde la fecha de inicio (16b §5.8): "Cada semana, los
 * domingos", "Cada 2 semanas, los domingos", "Cada mes, el primer domingo",
 * "Cada mes, el último viernes".
 */
export function repeatOptions(startDate: Ymd): RepeatOption[] {
  const wd = weekdayOf(startDate);
  const name = WEEKDAY_NAMES[wd];
  const plural = weekdayPlural(wd);
  const opts: RepeatOption[] = [
    { value: "none", label: "No se repite" },
    { value: "weekly", label: `Cada semana, los ${plural}` },
    { value: "biweekly", label: `Cada 2 semanas, los ${plural}` },
  ];
  for (const ord of monthlyOrdinalOptions(startDate)) {
    opts.push({ value: `monthly:${ord}`, label: `Cada mes, el ${ordinalLabel(ord)} ${name}` });
  }
  return opts;
}

export function repeatValueOf(r: RecurrenceRule): RepeatValue {
  if (r.freq === "monthly") return `monthly:${r.monthly?.ordinal ?? 1}` as RepeatValue;
  return r.freq;
}

/** Regla desde el valor del select (el orden de claves de `monthly` coincide con las fixtures). */
export function ruleFromRepeat(value: RepeatValue, startDate: Ymd, until: Ymd | undefined): RecurrenceRule {
  if (value === "none") return { freq: "none" };
  if (value === "weekly" || value === "biweekly") return { freq: value, ...(until ? { until } : {}) };
  const ordinal = Number(value.split(":")[1]) as Ordinal;
  return {
    freq: "monthly",
    ...(until ? { until } : {}),
    monthly: { mode: "nth_weekday", weekday: weekdayOf(startDate), ordinal },
  };
}

/** "Se repetirá 11 veces: del 9 oct al 18 dic 2026." */
export function seriesSummary(rule: RecurrenceRule, startDate: Ymd): string | null {
  if (rule.freq === "none" || !rule.until || compareLocal(rule.until, startDate) < 0) return null;
  const dates = candidateDates({ startDate, endDate: startDate, recurrence: rule }, startDate, rule.until);
  if (!dates.length) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  const times = dates.length === 1 ? "1 vez" : `${dates.length} veces`;
  return `Se repetirá ${times}: del ${dayMonthShort(first)} al ${shortDateYear(last)}.`;
}

/** Fecha máxima de "Hasta" (inicio + 12 meses). */
export function maxUntil(startDate: Ymd): Ymd {
  return addMonthsClamped(startDate, 12);
}

/** "octubre" */
export function monthName(date: Ymd): string {
  return MONTH_NAMES[parseYmd(date).m - 1];
}

export { isRecurring };

/** Eco legible de un input de fecha: "domingo 4 de octubre de 2026" ("" si no es válida). */
export function longDateEcho(date: string): string {
  if (!isValidYmd(date)) return "";
  return `${dayLabel(date)} de ${parseYmd(date).y}`;
}

/** Eco legible de las horas: "19:00 – 21:00", "desde las 19:00" ("" sin hora de inicio). */
export function timeRangeEcho(start: string, end: string): string {
  if (!start) return "";
  return end ? `${start} – ${end}` : `desde las ${start}`;
}
