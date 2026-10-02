// Proyección pública del calendario (16c §E). Se arma por LISTA BLANCA con
// literales explícitos: nunca spread de la actividad interna.

import { addDays, addMonthsClamped, compareLocal, firstOfMonth, lastOfMonth } from "./dates";
import { compareDayOrder, occurrencesInRange } from "./calendar";
import { candidateDates, recurrenceDetailText } from "./recurrence";
import type { Area, CalendarEvent, LocalDateTime, Occurrence, PublicArea, PublicCalendar, PublicEvent, ShareLink, Ymd } from "./types";

export const PUBLIC_EVENT_KEYS = [
  "id",
  "title",
  "startDate",
  "endDate",
  "allDay",
  "startTime",
  "endTime",
  "location",
  "publicDescription",
  "responsibleArea",
  "participantAreas",
  "status",
  "recurrenceLabel",
] as const;

export const PUBLIC_AREA_KEYS = ["slug", "name", "color"] as const;
export const PUBLIC_CALENDAR_KEYS = ["churchName", "range", "areas", "events"] as const;

export const CHURCH_NAME = "Casa de Salvación";
export const UNAVAILABLE_TEXT = "Este calendario no está disponible";

/** Token presentado cuando la URL no trae `?t=`. */
export const DEFAULT_PRESENTED_TOKEN = "demo";

/** Pool fijo de tokens "regenerados" de la preview (deterministas). */
export const PREVIEW_SHARE_TOKENS = ["demo-k7p2", "demo-x9m4", "demo-q3v8", "demo-t5n1"] as const;

export function nextPreviewToken(regenerations: number): string {
  return PREVIEW_SHARE_TOKENS[regenerations] ?? `demo-r${regenerations + 1}`;
}

/** FNV-1a de 32 bits en hex: id público opaco (no revela el id interno). */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function toPublicArea(a: Area): PublicArea {
  return { slug: a.id, name: a.name, color: a.color };
}

export function toPublicEvent(o: Occurrence, e: CalendarEvent, areas: ReadonlyMap<string, Area>): PublicEvent {
  const responsible = areas.get(e.responsibleAreaId);
  return {
    id: `pe_${fnv1a(`${e.id}@${o.date}`)}`,
    title: e.title,
    startDate: o.date,
    endDate: o.endDate,
    allDay: o.allDay,
    startTime: o.allDay ? null : (o.startTime ?? null),
    endTime: o.allDay ? null : (o.endTime ?? null),
    location: e.location ?? null,
    publicDescription: e.publicDescription ?? null,
    responsibleArea: responsible
      ? toPublicArea(responsible)
      : { slug: e.responsibleAreaId, name: e.responsibleAreaId, color: "pizarra" },
    participantAreas: e.participantAreaIds
      .map((id) => areas.get(id))
      .filter((a): a is Area => !!a)
      .map(toPublicArea),
    status: o.status === "cancelada" ? "cancelada" : "programada",
    recurrenceLabel: publicRecurrenceLabel(e),
  };
}

/**
 * Texto de recurrencia publicado. Con la serie cancelada (`seriesCancellation`)
 * se repite "hasta" el día anterior a `from` (o el `until` original si es
 * anterior); si no queda ninguna fecha antes del corte, null.
 */
export function publicRecurrenceLabel(e: Pick<CalendarEvent, "startDate" | "endDate" | "recurrence" | "seriesCancellation">): string | null {
  if (!e.seriesCancellation) return recurrenceDetailText({ startDate: e.startDate, recurrence: e.recurrence });
  if (e.recurrence.freq === "none") return null;
  const cut = addDays(e.seriesCancellation.from, -1);
  const until = e.recurrence.until && compareLocal(e.recurrence.until, cut) < 0 ? e.recurrence.until : cut;
  if (compareLocal(until, e.startDate) < 0) return null;
  if (!candidateDates({ startDate: e.startDate, endDate: e.startDate, recurrence: e.recurrence }, e.startDate, until).length) return null;
  return recurrenceDetailText({ startDate: e.startDate, recurrence: { ...e.recurrence, until } });
}

/** Rango navegable: desde el primer día del mes anterior hasta el último día de hoy + 6 meses. */
export function publicRange(today: Ymd): { from: Ymd; to: Ymd } {
  return { from: firstOfMonth(addMonthsClamped(firstOfMonth(today), -1)), to: lastOfMonth(addMonthsClamped(firstOfMonth(today), 6)) };
}

/**
 * Calendario público para un token presentado, o null si el enlace está
 * desactivado o el token no coincide (misma respuesta en ambos casos).
 */
export function resolvePublicCalendar(i: {
  link: ShareLink;
  events: readonly CalendarEvent[];
  areas: readonly Area[];
  presentedToken: string | null;
  today: Ymd;
  now: LocalDateTime;
}): PublicCalendar | null {
  if (!i.link.active || !i.presentedToken || i.presentedToken !== i.link.token) return null;
  const range = publicRange(i.today);
  const map = new Map(i.areas.map((a) => [a.id, a] as const));
  const publicEvents = i.events.filter((e) => e.visibility === "public" && e.status !== "archivada");
  const events = occurrencesInRange(publicEvents, range.from, range.to, i.now, i.areas).map((o) => toPublicEvent(o, o.event, map));
  const used = new Set(events.flatMap((e) => [e.responsibleArea.slug, ...e.participantAreas.map((a) => a.slug)]));
  const areas = i.areas
    .filter((a) => a.active && used.has(a.id))
    .sort((a, b) => a.order - b.order)
    .map(toPublicArea);
  return { churchName: CHURCH_NAME, range: { from: range.from, to: range.to }, areas, events };
}

/** Href interno de la vista pública para un token (la ruta es estática: /compartir/demo?t=…). */
export function previewShareHref(token: string): string {
  return token === DEFAULT_PRESENTED_TOKEN ? "/preview/calendario/compartir/demo" : `/preview/calendario/compartir/demo?t=${encodeURIComponent(token)}`;
}

/** Dominio neutro reservado (.example) para mostrar el formato del enlace en la preview. */
export const PRODUCTION_SHARE_ORIGIN = "https://suite.casadesalvacion.example";

/** URL con formato de producción, SOLO como texto (no navegable en la preview). */
export function productionShareUrl(token: string): string {
  return `${PRODUCTION_SHARE_ORIGIN}/calendario/compartir/${token}`;
}

/** Ordena eventos públicos con el mismo comparador que el resto de las vistas (compareDayOrder). */
export function sortPublicEvents(list: readonly PublicEvent[]): PublicEvent[] {
  const key = (e: PublicEvent) => ({ date: e.startDate, allDay: e.allDay, startTime: e.startTime, areaName: e.responsibleArea.name, title: e.title });
  return [...list].sort((a, b) => compareDayOrder(key(a), key(b)));
}
