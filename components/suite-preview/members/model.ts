// Modelo de vista de Consolidación: compone los derivados de
// lib/suite-preview/consolidation para las pantallas (sin React).

import {
  ATTENTION_PRIORITY,
  ageAt,
  alertsFor,
  currentNextAction,
  isValidOwner,
  personBadges,
  personStats,
  type ConsolidationData,
  type PersonStats,
} from "@/lib/suite-preview/consolidation";
import { compareLocal, daysBetween, parseYmd } from "@/lib/suite-preview/dates";
import { formatPhone } from "@/lib/suite-preview/phone";
import type { AccessProfile, Alert, ConsolidationSettings, Person, Ymd } from "@/lib/suite-preview/types";
import { shortDate } from "@/lib/finance-preview/format";
import type { DerivedBadge } from "./vocab";

export const C_BASE = "/preview/integrantes/consolidacion";
export const personHref = (id: string) => `${C_BASE}/persona?id=${encodeURIComponent(id)}`;
export const peopleHref = (params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params).toString();
  return `${C_BASE}/personas${q ? `?${q}` : ""}`;
};

export interface PersonView {
  person: Person;
  age: number | null;
  stats: PersonStats;
  badges: DerivedBadge[];
  next: ReturnType<typeof currentNextAction>;
  nextOverdue: boolean;
  alerts: Alert[];
  /** Alertas que entran en "Necesitan atención" (sin cumpleaños). */
  attention: Alert[];
  ownerName: string;
  ownerValid: boolean;
  phone: string;
  /** Activa en Consolidación (no integrada ni cerrada). */
  active: boolean;
}

export function shortName(name: string): string {
  if (name.includes("(")) return name;
  const w = name.trim().split(/\s+/);
  return w.length > 1 ? `${w[0]} ${w[1][0]}.` : name;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function userName(uid: string | null | undefined, users: readonly AccessProfile[]): string | null {
  if (!uid) return null;
  return users.find((u) => u.uid === uid)?.displayName ?? null;
}

export function buildView(
  p: Person,
  data: ConsolidationData,
  alerts: readonly Alert[],
  today: Ymd,
  settings: ConsolidationSettings,
): PersonView {
  const stats = personStats(p.id, data.visits);
  const b = personBadges(p, data, today, settings);
  const badges: DerivedBadge[] = [];
  const active = p.lifecycleStage === "en_consolidacion" && p.consolidationStatus !== "sin_continuidad";
  if (b.isNew && active) badges.push("nuevo");
  if (b.returned && active) badges.push("volvio");
  if (b.minor) badges.push("menor");
  if (p.doNotContact) badges.push("no_contactar");
  const next = currentNextAction(p.id, data.followUps);
  const mine = alertsFor(p.id, alerts);
  const ownerValid = isValidOwner(p.followUpOwnerUid, data.users);
  const owner = userName(p.followUpOwnerUid, data.users);
  return {
    person: p,
    age: ageAt(p.birthDate, today),
    stats,
    badges,
    next,
    nextOverdue: !!next?.date && compareLocal(next.date, today) < 0,
    alerts: mine,
    attention: mine.filter((a) => ATTENTION_PRIORITY.includes(a.type)),
    ownerName: owner ?? "Sin asignar",
    ownerValid,
    phone: formatPhone(p.phoneE164, p.phoneRaw),
    active,
  };
}

// ---------- Fechas legibles ----------

/** "hoy", "ayer", "mañana" o "mié 30 sep". */
export function relDay(d: Ymd, today: Ymd): string {
  const diff = daysBetween(today, d);
  if (diff === 0) return "hoy";
  if (diff === -1) return "ayer";
  if (diff === 1) return "mañana";
  return shortDate(d);
}

/** "hoy", "ayer", "hace 4 días". */
export function agoText(d: Ymd, today: Ymd): string {
  const n = daysBetween(d, today);
  if (n <= 0) return "hoy";
  if (n === 1) return "ayer";
  return `hace ${n} días`;
}

/** "dom 13 sep 2026". */
export function shortDateYear(d: Ymd): string {
  return `${shortDate(d)} ${parseYmd(d).y}`;
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

/** Motivo principal de una alerta para la fila de atención (16b §9.2). */
export function alertReason(a: Alert, v: PersonView, today: Ymd): { strong: string; rest: string } {
  switch (a.type) {
    case "sin_responsable":
      return { strong: "Sin responsable", rest: `${a.detail} · llegó ${relDay(v.person.entryDate, today)}` };
    case "sin_primer_contacto":
      return {
        strong: "Sin primer contacto",
        rest: `llegó el ${shortDate(v.person.entryDate)} (${agoText(v.person.entryDate, today)}) · ${a.detail === "Sin intentos" ? "sin intentos" : a.detail}`,
      };
    case "seguimiento_vencido":
      return { strong: "Seguimiento vencido", rest: `${v.next?.text ?? "Próxima acción"} · era para el ${shortDate(a.since)}` };
    case "volvio":
      return { strong: "Volvió sin seguimiento", rest: `${visitOrdinal(v.stats.visitCount)} · ${agoText(a.since, today)}` };
    case "varios_dias_sin_volver":
      return { strong: a.detail, rest: `última visita el ${shortDate(a.since)}` };
    case "posible_duplicado_telefono":
    case "posible_duplicado_correo":
      return { strong: "Posible duplicado", rest: a.detail };
    case "cumpleanos_proximo":
      return { strong: "Cumpleaños próximo", rest: a.detail };
  }
}
