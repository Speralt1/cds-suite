// GENERADO por scripts/build-shared.mjs desde lib/shared/dates.ts — NO EDITAR.
"use strict";
// Aritmética de fechas LOCALES ("YYYY-MM-DD") mediante epoch-days, más la
// conversión de un instante a la hora de pared de America/Santiago.
// Es el ÚNICO archivo de lib/shared que usa Date: Date.UTC para contar días y
// `localNow(instante)` con el reloj INYECTADO por quien llama (nunca Date.now()).
// Nunca se usa new Date("YYYY-MM-DD"), así los cambios de horario de Chile no
// corren ninguna fecha.
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEEKDAY_HEADERS_MON_FIRST = exports.WEEKDAY_NAMES = exports.MONTH_NAMES = exports.SANTIAGO_TIME_ZONE = void 0;
exports.parseYmd = parseYmd;
exports.ymd = ymd;
exports.isValidYmd = isValidYmd;
exports.isValidTime = isValidTime;
exports.toEpochDay = toEpochDay;
exports.fromEpochDay = fromEpochDay;
exports.addDays = addDays;
exports.daysBetween = daysBetween;
exports.weekdayOf = weekdayOf;
exports.isLeap = isLeap;
exports.daysInMonth = daysInMonth;
exports.shiftMonth = shiftMonth;
exports.addMonthsClamped = addMonthsClamped;
exports.firstOfMonth = firstOfMonth;
exports.lastOfMonth = lastOfMonth;
exports.monthKey = monthKey;
exports.nthWeekdayOfMonth = nthWeekdayOfMonth;
exports.startOfWeek = startOfWeek;
exports.compareLocal = compareLocal;
exports.localToMinutes = localToMinutes;
exports.hoursBetween = hoursBetween;
exports.dateOf = dateOf;
exports.monthTitle = monthTitle;
exports.dayLabel = dayLabel;
exports.numericYmd = numericYmd;
exports.localNow = localNow;
exports.localToday = localToday;
exports.SANTIAGO_TIME_ZONE = "America/Santiago";
const DAY_MS = 86_400_000;
function parseYmd(ymd) {
    const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
    return { y, m, d };
}
function ymd(y, m, d) {
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function isValidYmd(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const { y, m, d } = parseYmd(value);
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
function isValidTime(value) {
    if (!value || !/^\d{2}:\d{2}$/.test(value))
        return false;
    const [h, min] = value.split(":").map(Number);
    return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}
function toEpochDay(value) {
    const { y, m, d } = parseYmd(value);
    return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}
function fromEpochDay(n) {
    const date = new Date(n * DAY_MS);
    return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
function addDays(value, n) {
    return fromEpochDay(toEpochDay(value) + n);
}
/** b − a en días calendario. */
function daysBetween(a, b) {
    return toEpochDay(b) - toEpochDay(a);
}
/** 0 = domingo … 6 = sábado (1970-01-01 fue jueves). */
function weekdayOf(value) {
    return (((toEpochDay(value) + 4) % 7) + 7) % 7;
}
function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function daysInMonth(y, m) {
    return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
/** "2026-10" → { y: 2026, m: 10 } desplazado n meses. */
function shiftMonth(y, m, n) {
    const idx = y * 12 + (m - 1) + n;
    return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}
/** Suma n meses; si el día no existe en el mes destino, usa el último. */
function addMonthsClamped(value, n) {
    const { y, m, d } = parseYmd(value);
    const t = shiftMonth(y, m, n);
    return ymd(t.y, t.m, Math.min(d, daysInMonth(t.y, t.m)));
}
function firstOfMonth(value) {
    const { y, m } = parseYmd(value);
    return ymd(y, m, 1);
}
function lastOfMonth(value) {
    const { y, m } = parseYmd(value);
    return ymd(y, m, daysInMonth(y, m));
}
/** "YYYY-MM" de una fecha. */
function monthKey(value) {
    return value.slice(0, 7);
}
/**
 * n-ésimo día de semana del mes (ord 1–4) o el último (ord −1).
 * Devuelve null si no existe (p. ej. un 5.º que no se pide nunca).
 */
function nthWeekdayOfMonth(y, m, wd, ord) {
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
function startOfWeek(value) {
    return addDays(value, -((weekdayOf(value) + 6) % 7));
}
/** Comparación lexicográfica de fechas u horas locales con el mismo formato. */
function compareLocal(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
/** Minutos desde la época de una fecha-hora local (para ventanas como "48 h"). */
function localToMinutes(value) {
    const day = toEpochDay(value.slice(0, 10));
    const [h, min] = (value.slice(11, 16) || "00:00").split(":").map(Number);
    return day * 1440 + h * 60 + min;
}
function hoursBetween(a, b) {
    return (localToMinutes(b) - localToMinutes(a)) / 60;
}
function dateOf(value) {
    return value.slice(0, 10);
}
exports.MONTH_NAMES = [
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
];
exports.WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
/** Encabezados de calendario (semana lunes–domingo). */
exports.WEEKDAY_HEADERS_MON_FIRST = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
/** "Octubre 2026" */
function monthTitle(y, m) {
    const name = exports.MONTH_NAMES[m - 1];
    return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
}
/** "domingo 4 de octubre" */
function dayLabel(value) {
    const { m, d } = parseYmd(value);
    return `${exports.WEEKDAY_NAMES[weekdayOf(value)]} ${d} de ${exports.MONTH_NAMES[m - 1]}`;
}
/** "04-10-2026" (formato usado en el resto de CDS). */
function numericYmd(value) {
    const { y, m, d } = parseYmd(value);
    return `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${y}`;
}
const formatters = new Map();
function formatterFor(timeZone) {
    let f = formatters.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        });
        formatters.set(timeZone, f);
    }
    return f;
}
/**
 * Fecha y hora de pared ("YYYY-MM-DDTHH:mm") de un instante en `timeZone`
 * (por defecto America/Santiago). El instante lo inyecta quien llama
 * (`clock.now()`), así esta función es determinista y testeable.
 */
function localNow(instant, timeZone = exports.SANTIAGO_TIME_ZONE) {
    const date = typeof instant === "number" ? new Date(instant) : instant;
    const parts = {};
    for (const part of formatterFor(timeZone).formatToParts(date))
        parts[part.type] = part.value;
    const hour = parts.hour === "24" ? "00" : parts.hour;
    return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}
/** Fecha de pared ("YYYY-MM-DD") de un instante en `timeZone` (por defecto America/Santiago). */
function localToday(instant, timeZone = exports.SANTIAGO_TIME_ZONE) {
    return localNow(instant, timeZone).slice(0, 10);
}
