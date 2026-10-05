// Modelo de vista de Consolidación: rutas, textos y fechas legibles para las
// pantallas (sin React). Port de components/suite-preview/members/model.ts.

import { daysBetween, numericYmd, parseYmd } from "@/lib/shared/dates";
import { longDateEcho, shortDay, MONTHS_SHORT } from "@/components/calendar/labels";
import type { PersonView } from "@/lib/members/consolidation";
import type { Alert, Ymd } from "@/lib/members/types";

export const C_BASE = "/integrantes/consolidacion";
export const NEW_PERSON_HREF = `${C_BASE}/nueva`;
export const ATTENTION_HREF = `${C_BASE}/atencion`;
export const PEOPLE_HREF = `${C_BASE}/personas`;
export const personHref = (id: string) => `${C_BASE}/persona?id=${encodeURIComponent(id)}`;
export const peopleHref = (params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params).toString();
  return `${PEOPLE_HREF}${q ? `?${q}` : ""}`;
};

export const PRIVACY_NOTE = "Datos personales de uso pastoral. Solo los ve el equipo de Consolidación.";
export const CALENDAR_FALLBACK_TITLE = "Actividad del calendario";

/** "Ana T." (nombre + inicial del apellido). */
export function shortName(name: string): string {
  const w = name.trim().split(/\s+/);
  return w.length > 1 ? `${w[0]} ${w[1][0]}.` : name;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** "vie 9 oct". */
export const shortDate = (d: Ymd) => shortDay(d);

/** "dom 13 sep 2026". */
export function shortDateYear(d: Ymd): string {
  return `${shortDay(d)} ${parseYmd(d).y}`;
}

/** "13 sep" */
export function dayMonth(d: Ymd): string {
  const { m, d: day } = parseYmd(d);
  return `${day} ${MONTHS_SHORT[m - 1]}`;
}

export { numericYmd };

/** "hoy", "ayer", "mañana" o "mié 30 sep". */
export function relDay(d: Ymd, today: Ymd): string {
  const diff = daysBetween(today, d);
  if (diff === 0) return "hoy";
  if (diff === -1) return "ayer";
  if (diff === 1) return "mañana";
  return shortDay(d);
}

/** "hoy", "ayer", "hace 4 días". */
export function agoText(d: Ymd, today: Ymd): string {
  const n = daysBetween(d, today);
  if (n <= 0) return "hoy";
  if (n === 1) return "ayer";
  return `hace ${n} días`;
}

/** "3.ª visita". */
export function visitOrdinal(n: number): string {
  return `${n}.ª visita`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Texto sin tildes y en minúsculas (búsqueda). */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Eco legible bajo un input de fecha: "domingo 4 de octubre de 2026" (null si no es válida). */
export function dateEcho(d: string): string | null {
  return longDateEcho(d) || null;
}

/** Motivo principal de una alerta para la fila de atención (16b §9.2). */
export function alertReason(a: Alert, v: PersonView, today: Ymd): { strong: string; rest: string } {
  const entry = v.person.entryDate;
  switch (a.type) {
    case "sin_responsable":
      return { strong: "Sin responsable", rest: `${a.detail} · llegó ${relDay(entry, today)}` };
    case "sin_primer_contacto":
      return {
        strong: "Sin primer contacto",
        rest: `llegó el ${shortDay(entry)} (${agoText(entry, today)}) · ${a.detail === "Sin intentos" ? "sin intentos" : a.detail}`,
      };
    case "seguimiento_vencido":
      return { strong: "Seguimiento vencido", rest: `${v.next?.text ?? "Próxima acción"} · era para el ${shortDay(a.since)}` };
    case "volvio":
      return { strong: "Volvió sin seguimiento", rest: `${visitOrdinal(v.person.projection.visitCount)} · ${agoText(a.since, today)}` };
    case "varios_dias_sin_volver":
      return { strong: a.detail, rest: `última visita el ${shortDay(a.since)}` };
    case "posible_duplicado_telefono":
    case "posible_duplicado_correo":
      return { strong: "Posible duplicado", rest: a.detail };
  }
}
