// Aritmética de fechas LOCALES ("YYYY-MM-DD") mediante epoch-days.
// Es el ÚNICO archivo de lib/suite-preview que usa Date (solo Date.UTC, para
// contar días): nunca se construyen instantes ni se usa new Date("YYYY-MM-DD"),
// así los cambios de horario de Chile no corren ninguna fecha.

import type { LocalDateTime, Ymd } from "./types";

const DAY_MS = 86_400_000;

export function parseYmd(ymd: Ymd): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

export function ymd(y: number, m: number, d: number): Ymd {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isValidYmd(value: string | undefined | null): value is Ymd {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parseYmd(value);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function isValidTime(value: string | undefined | null): value is string {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [h, min] = value.split(":").map(Number);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

export function toEpochDay(value: Ymd): number {
  const { y, m, d } = parseYmd(value);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromEpochDay(n: number): Ymd {
  const date = new Date(n * DAY_MS);
  return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(value: Ymd, n: number): Ymd {
  return fromEpochDay(toEpochDay(value) + n);
}

/** b − a en días calendario. */
export function daysBetween(a: Ymd, b: Ymd): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** 0 = domingo … 6 = sábado (1970-01-01 fue jueves). */
export function weekdayOf(value: Ymd): number {
  return (((toEpochDay(value) + 4) % 7) + 7) % 7;
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** "2026-10" → { y: 2026, m: 10 } desplazado n meses. */
export function shiftMonth(y: number, m: number, n: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + n;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Suma n meses; si el día no existe en el mes destino, usa el último. */
export function addMonthsClamped(value: Ymd, n: number): Ymd {
  const { y, m, d } = parseYmd(value);
  const t = shiftMonth(y, m, n);
  return ymd(t.y, t.m, Math.min(d, daysInMonth(t.y, t.m)));
}

export function firstOfMonth(value: Ymd): Ymd {
  const { y, m } = parseYmd(value);
  return ymd(y, m, 1);
}

export function lastOfMonth(value: Ymd): Ymd {
  const { y, m } = parseYmd(value);
  return ymd(y, m, daysInMonth(y, m));
}

/** "YYYY-MM" de una fecha. */
export function monthKey(value: Ymd): string {
  return value.slice(0, 7);
}

/**
 * n-ésimo día de semana del mes (ord 1–4) o el último (ord −1).
 * Devuelve null si no existe (p. ej. un 5.º que no se pide nunca).
 */
export function nthWeekdayOfMonth(y: number, m: number, wd: number, ord: number): Ymd | null {
  const dim = daysInMonth(y, m);
  if (ord === -1) {
    const lastWd = weekdayOf(ymd(y, m, dim));
    return ymd(y, m, dim - ((lastWd - wd + 7) % 7));
  }
  const first = 1 + ((wd - weekdayOf(ymd(y, m, 1)) + 7) % 7);
  const day = first + 7 * (ord - 1);
  return day <= dim ? ymd(y, m, day) : null;
}

/** Lunes de la semana de la fecha (la semana empieza el lunes). */
export function startOfWeek(value: Ymd): Ymd {
  return addDays(value, -((weekdayOf(value) + 6) % 7));
}

/** Comparación lexicográfica de fechas u horas locales con el mismo formato. */
export function compareLocal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Minutos desde la época de una fecha-hora local (para ventanas como "48 h"). */
export function localToMinutes(value: LocalDateTime): number {
  const day = toEpochDay(value.slice(0, 10));
  const [h, min] = (value.slice(11, 16) || "00:00").split(":").map(Number);
  return day * 1440 + h * 60 + min;
}

export function hoursBetween(a: LocalDateTime, b: LocalDateTime): number {
  return (localToMinutes(b) - localToMinutes(a)) / 60;
}

export function dateOf(value: LocalDateTime): Ymd {
  return value.slice(0, 10);
}

export const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

export const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
/** Encabezados de calendario (semana lunes–domingo). */
export const WEEKDAY_HEADERS_MON_FIRST = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"] as const;

/** "Octubre 2026" */
export function monthTitle(y: number, m: number): string {
  const name = MONTH_NAMES[m - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
}

/** "domingo 4 de octubre" */
export function dayLabel(value: Ymd): string {
  const { m, d } = parseYmd(value);
  return `${WEEKDAY_NAMES[weekdayOf(value)]} ${d} de ${MONTH_NAMES[m - 1]}`;
}

/** "04-10-2026" (formato usado en el resto de CDS). */
export function numericYmd(value: Ymd): string {
  const { y, m, d } = parseYmd(value);
  return `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${y}`;
}
