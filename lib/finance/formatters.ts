import { Timestamp } from "firebase/firestore";
import { MONTHS } from "./constants";
import type { PeriodSelection } from "./types";
export function clp(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}
// Signed CLP for the Resumen ledger (28 §B): real minus sign U+2212 and a
// thin space (U+2009) between the sign and the amount, so a negative never
// reads as "$-20.400". Zero has no sign. `plus: false` omits the "+" (the
// period result shows "$4.109.132" but "− $20.400").
export const MINUS_SIGN = "\u2212";
export const THIN_SPACE = "\u2009";
export function clpSigned(value: number, { plus = true }: { plus?: boolean } = {}) {
  const n = Number.isFinite(value) ? value : 0;
  if (n === 0) return clp(0);
  const amount = clp(Math.abs(n));
  if (n < 0) return `${MINUS_SIGN}${THIN_SPACE}${amount}`;
  return plus ? `+${THIN_SPACE}${amount}` : amount;
}
// Compact CLP for tight spaces (calendar cells): "$165 mil", "$1,2 M".
export function clpShort(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const millions = n / 1_000_000;
    return `$${millions.toLocaleString("es-CL", { maximumFractionDigits: 1 })} M`;
  }
  if (abs >= 1_000) {
    return `$${Math.round(n / 1_000).toLocaleString("es-CL")} mil`;
  }
  return clp(n);
}
export function today() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}
/** Fecha civil en Chile continental, independiente de la zona del navegador. */
export function santiagoToday() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Selecciona una fecha válida.");
  const d = new Date(`${value}T12:00:00.000Z`);
  if (
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== value ||
    d.getUTCFullYear() < 2000 ||
    d.getUTCFullYear() > 2100
  )
    throw new Error("Selecciona una fecha entre 2000 y 2100.");
  return Timestamp.fromDate(d);
}
export function isoDate(value?: Timestamp) {
  return value?.toDate?.().toISOString().slice(0, 10) || "";
}
export function dateLabel(value?: Timestamp) {
  const d = value?.toDate?.();
  return d && Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("es-CL", {
        timeZone: "UTC",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(d)
    : "Sin registro";
}
/** Fecha civil del diezmo en Chile, incluso si su instante cae en otro día UTC. */
export function santiagoDateLabel(value?: Timestamp) {
  const d = value?.toDate?.();
  return d && Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("es-CL", {
        timeZone: "America/Santiago",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(d)
    : "Sin registro";
}
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/**
 * Fecha y hora de Chile continental (America/Santiago), p. ej. "08-10-2026 14:58".
 * Para auditoría (Creado el / Modificado el / Anulado el): distingue dos registros del mismo día.
 */
export function dateTimeLabel(value?: Timestamp) {
  const d = value?.toDate?.();
  if (!d || !Number.isFinite(d.getTime())) return "Sin registro";
  const part = Object.fromEntries(
    DATE_TIME_FORMAT.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${part.day}-${part.month}-${part.year} ${part.hour}:${part.minute}`;
}
/** Referencia corta y visible de un movimiento: últimos 6 caracteres del id ("…5UFRhF"). */
export function shortReference(id: string) {
  return id.length > 6 ? `…${id.slice(-6)}` : id;
}
export function periodId(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}
export function periodBounds(p: PeriodSelection) {
  return {
    start: periodId(p.year, p.view === "year" ? 1 : p.month) + "-01",
    end:
      (p.view === "year" || p.month === 12
        ? periodId(p.year + 1, 1)
        : periodId(p.year, p.month + 1)) + "-01",
  };
}
export function previousPeriod(p: PeriodSelection): PeriodSelection {
  return p.view === "year"
    ? { ...p, year: p.year - 1 }
    : {
        ...p,
        year: p.month === 1 ? p.year - 1 : p.year,
        month: p.month === 1 ? 12 : p.month - 1,
      };
}
export function periodLabel(p: PeriodSelection) {
  return p.view === "year"
    ? String(p.year)
    : `${MONTHS[p.month - 1]} ${p.year}`;
}
export function errorMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code.includes("permission-denied"))
    return "No tienes permiso para esta operación. Revisa tu acceso y las reglas de Firestore con el administrador.";
  if (code.includes("unavailable") || code.includes("deadline"))
    return "No pudimos confirmar la operación. Revisa tu conexión y vuelve a intentarlo. No cierres el formulario.";
  if (code.includes("failed-precondition"))
    return "La consulta necesita un índice de Firestore. El administrador debe desplegar los índices del proyecto.";
  return error instanceof Error
    ? error.message
    : "No pudimos completar la operación. Inténtalo nuevamente.";
}
