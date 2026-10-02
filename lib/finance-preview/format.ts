// Formateadores puros del preview Financial UX 2026.
// No importan nada de Firebase: `lib/finance/formatters.ts` depende de
// `firebase/firestore` (Timestamp), por eso el preview tiene los suyos.

const MINUS = "−"; // signo menos tipográfico, no guion

const clpFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

/** "$1.234.567". Nunca devuelve signo: el signo lo decide quien llama. */
export function clpAbs(value: number) {
  return clpFormatter.format(Math.abs(Number.isFinite(value) ? value : 0));
}

/** "$1.234.567" o "−$1.234.567" (con el menos real, no "-"). */
export function clp(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return n < 0 ? `${MINUS}${clpAbs(n)}` : clpAbs(n);
}

/** Con signo explícito: "+$1.000", "−$4.500", "$0". */
export function clpSigned(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  if (n === 0) return clpAbs(0);
  return `${n > 0 ? "+" : MINUS}${clpAbs(n)}`;
}

/** Compacto para ejes y celdas: "$165 mil", "$1,2 M". */
export function clpShort(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? MINUS : "";
  if (abs >= 1_000_000)
    return `${sign}$${(abs / 1_000_000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} M`;
  if (abs >= 1_000)
    return `${sign}$${Math.round(abs / 1_000).toLocaleString("es-CL")} mil`;
  return clp(n);
}

/** Lectura para lectores de pantalla: "menos 4.500 pesos". */
export function clpSpoken(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  const digits = Math.abs(n).toLocaleString("es-CL", { maximumFractionDigits: 0 });
  return `${n < 0 ? "menos " : ""}${digits} pesos`;
}

/** "43,6 %" */
export function percent(part: number, total: number, digits = 1) {
  if (!total) return "—";
  return `${((part / total) * 100).toLocaleString("es-CL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
}

/** Variación relativa con signo real: "+12,4 %", "−3,0 %". null si no comparable. */
export function variation(current: number, previous: number) {
  if (!previous) return null;
  const v = ((current - previous) / Math.abs(previous)) * 100;
  const text = Math.abs(v).toLocaleString("es-CL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return { value: v, label: `${v > 0 ? "+" : v < 0 ? MINUS : ""}${text} %` };
}

const MONTHS = [
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
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function parts(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, weekday };
}

export function capitalize(text: string) {
  return text ? text[0].toLocaleUpperCase("es") + text.slice(1) : text;
}

/** "30 sep" */
export function dayMonth(iso: string) {
  const { m, d } = parts(iso);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

/** "mié 30 sep" */
export function shortDate(iso: string) {
  const { m, d, weekday } = parts(iso);
  return `${WEEKDAYS_SHORT[weekday]} ${d} ${MONTHS_SHORT[m - 1]}`;
}

/** "miércoles 30 de septiembre de 2026" */
export function longDate(iso: string) {
  const { y, m, d, weekday } = parts(iso);
  return `${WEEKDAYS[weekday]} ${d} de ${MONTHS[m - 1]} de ${y}`;
}

/** "30-09-2026" (formato usado en el resto de CDS). */
export function numericDate(iso: string) {
  const { y, m, d } = parts(iso);
  return `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${y}`;
}

/** "Septiembre 2026" a partir de "2026-09". */
export function monthLabel(period: string) {
  const [y, m] = period.split("-").map(Number);
  return `${capitalize(MONTHS[m - 1])} ${y}`;
}

/** "sep" a partir de "2026-09". */
export function monthShort(period: string) {
  const m = Number(period.split("-")[1]);
  return MONTHS_SHORT[m - 1];
}

export function weekdayOf(iso: string) {
  return parts(iso).weekday;
}

/** "10:41" a partir de un ISO con hora. */
export function timeOf(isoDateTime: string) {
  return isoDateTime.slice(11, 16);
}

/** Diferencia en días calendario entre dos fechas ISO (b − a). */
export function daysBetween(a: string, b: string) {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round(
    (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000,
  );
}

/** "hoy", "ayer", "hace 3 d" */
export function ageLabel(iso: string, today: string) {
  const days = daysBetween(iso, today);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} d`;
}
