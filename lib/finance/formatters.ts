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
export function today() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
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
