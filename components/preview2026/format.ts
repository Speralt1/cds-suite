// Utilidades locales del preview 2026. Sin dependencias de firebase/firestore
// ni de lib/finance/* (que sí depende de firebase) para mantener el preview
// completamente aislado, según el Gate de experiencia visual (§5).

const MINUS_SIGN = "−";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

/** Formatea un monto en pesos chilenos (es-CL), sin decimales. */
export function formatCLPAbs(value: number) {
  const abs = Math.abs(Math.round(Number.isFinite(value) ? value : 0));
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(abs);
}

/** Formatea con el signo "−" real (U+2212), además del color aplicado por CSS. */
export function formatCLPSigned(value: number) {
  const isNegative = Number.isFinite(value) && value < 0;
  return `${isNegative ? MINUS_SIGN : ""}${formatCLPAbs(value)}`;
}

export function spokenSign(value: number) {
  return Number.isFinite(value) && value < 0 ? "menos " : "";
}

export function formatDateShort(iso: string) {
  const d = new Date(`${iso}T12:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
  }).format(d);
}

export function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
