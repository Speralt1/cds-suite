// Proyección pública del calendario (18a §E.1). Se arma por LISTA BLANCA con
// literales explícitos: nunca spread de la actividad interna. La usan la
// Function `calendarPublicFeed` (vía functions/shared) y los tests del cliente.
//
// Nunca sale: internalNotes, cancelReason, archiveReason, motivos de
// excepciones o de la serie, uids (createdBy/updatedBy/by), correos ni
// permisos. "Realizada" no se expone: una ocurrencia pasada sale "scheduled".

import { compareDayOrder, occurrencesInRange } from "./calendar-core";
import { addDays, addMonthsClamped, compareLocal, firstOfMonth, isValidYmd, lastOfMonth, SANTIAGO_TIME_ZONE } from "./dates";
import { candidateDates, recurrenceDetailText } from "./recurrence";
import { AREA_COLORS } from "./types";
import type {
  Area,
  AreaColor,
  CalendarEvent,
  LocalDateTime,
  Occurrence,
  PublicArea,
  PublicCalendar,
  PublicEvent,
  RecurrenceEventLike,
  Ymd,
} from "./types";

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
export const PUBLIC_CALENDAR_KEYS = ["churchName", "timeZone", "range", "areas", "events"] as const;

export const CHURCH_NAME = "Casa de Salvación";
export const PUBLIC_TIME_ZONE = SANTIAGO_TIME_ZONE;
const FALLBACK_COLOR: AreaColor = "pizarra";

/** Lo que la proyección pública lee de una actividad (todo lo demás se ignora). */
export type PublicSourceEvent = RecurrenceEventLike &
  Pick<CalendarEvent, "title" | "responsibleAreaId" | "participantAreaIds" | "visibility"> &
  Partial<Pick<CalendarEvent, "location" | "publicDescription">>;

const FNV64_OFFSET = BigInt("0xcbf29ce484222325");
const FNV64_PRIME = BigInt("0x100000001b3");
const FNV64_MASK = BigInt("0xffffffffffffffff");

/** FNV-1a de 64 bits (sobre unidades UTF-16) en 16 hex: id público opaco que no revela el id interno. */
export function fnv1a64(text: string): string {
  let h = FNV64_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * FNV64_PRIME) & FNV64_MASK;
  }
  return h.toString(16).padStart(16, "0");
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function safeColor(value: unknown): AreaColor {
  return typeof value === "string" && (AREA_COLORS as readonly string[]).includes(value) ? (value as AreaColor) : FALLBACK_COLOR;
}

export function toPublicArea(a: Pick<Area, "id" | "name" | "color">): PublicArea {
  return {
    slug: String(a.id),
    name: typeof a.name === "string" ? a.name : String(a.id),
    color: safeColor(a.color),
  };
}

/**
 * Texto de recurrencia publicado. Con la serie cancelada (`seriesCancellation`)
 * se repite "hasta" el día anterior a `from` (o el `until` original si es
 * anterior); si no queda ninguna fecha antes del corte, null.
 */
export function publicRecurrenceLabel(
  e: Pick<CalendarEvent, "startDate" | "endDate" | "recurrence"> & Partial<Pick<CalendarEvent, "seriesCancellation">>,
): string | null {
  if (!e.seriesCancellation) return recurrenceDetailText({ startDate: e.startDate, recurrence: e.recurrence });
  if (e.recurrence.freq === "none") return null;
  const cut = addDays(e.seriesCancellation.from, -1);
  const until = e.recurrence.until && compareLocal(e.recurrence.until, cut) < 0 ? e.recurrence.until : cut;
  if (compareLocal(until, e.startDate) < 0) return null;
  if (!candidateDates({ startDate: e.startDate, endDate: e.startDate, recurrence: e.recurrence }, e.startDate, until).length)
    return null;
  return recurrenceDetailText({ startDate: e.startDate, recurrence: { ...e.recurrence, until } });
}

export function toPublicEvent<E extends PublicSourceEvent>(
  o: Occurrence<E>,
  e: E,
  areas: ReadonlyMap<string, Pick<Area, "id" | "name" | "color">>,
): PublicEvent {
  const responsible = areas.get(e.responsibleAreaId);
  const participantIds = Array.isArray(e.participantAreaIds) ? e.participantAreaIds : [];
  return {
    id: `pe_${fnv1a64(`${e.id}@${o.date}`)}`,
    title: typeof e.title === "string" ? e.title : "",
    startDate: o.date,
    endDate: o.endDate,
    allDay: o.allDay === true,
    startTime: o.allDay ? null : textOrNull(o.startTime),
    endTime: o.allDay ? null : textOrNull(o.endTime),
    location: textOrNull(e.location),
    publicDescription: textOrNull(e.publicDescription),
    responsibleArea: responsible
      ? toPublicArea(responsible)
      : { slug: String(e.responsibleAreaId), name: String(e.responsibleAreaId), color: FALLBACK_COLOR },
    participantAreas: participantIds
      .map((id) => areas.get(id))
      .filter((a): a is Pick<Area, "id" | "name" | "color"> => !!a)
      .map(toPublicArea),
    status: o.status === "cancelled" ? "cancelled" : "scheduled",
    recurrenceLabel: publicRecurrenceLabel(e),
  };
}

/** Rango navegable: desde el primer día del mes anterior hasta el último día de hoy + 6 meses. */
export function publicRange(today: Ymd): { from: Ymd; to: Ymd } {
  return {
    from: firstOfMonth(addMonthsClamped(firstOfMonth(today), -1)),
    to: lastOfMonth(addMonthsClamped(firstOfMonth(today), 6)),
  };
}

/** Ordena eventos públicos con el mismo comparador que el resto de las vistas (compareDayOrder); desempate por id. */
export function sortPublicEvents(list: readonly PublicEvent[]): PublicEvent[] {
  const key = (e: PublicEvent) => ({
    date: e.startDate,
    allDay: e.allDay,
    startTime: e.startTime,
    areaName: e.responsibleArea.name,
    title: e.title,
  });
  return [...list].sort((a, b) => compareDayOrder(key(a), key(b)) || compareLocal(a.id, b.id));
}

/** ¿La actividad tiene la forma mínima para expandirse sin sorpresas? */
function isExpandable(e: PublicSourceEvent): boolean {
  return (
    !!e &&
    typeof e.id === "string" &&
    isValidYmd(e.startDate) &&
    isValidYmd(e.endDate) &&
    compareLocal(e.endDate, e.startDate) >= 0 &&
    !!e.recurrence &&
    typeof e.recurrence.freq === "string" &&
    (e.recurrence.freq === "none" || isValidYmd(e.recurrence.until))
  );
}

/**
 * ¿La ocurrencia está cancelada SOLO por la cancelación de la serie
 * (`seriesCancellation.from` ≤ fecha, sin excepción propia ese día)? Esas no se
 * publican: tras el corte la serie simplemente termina. Una excepción de una
 * fecha (aunque caiga después del corte) sí se publica como "Cancelada", igual
 * que en recurrence.ts, donde la excepción tiene precedencia.
 */
export function isSeriesCutOccurrence(
  o: Pick<Occurrence<PublicSourceEvent>, "date" | "status" | "event">,
): boolean {
  const e = o.event as PublicSourceEvent & Partial<Pick<CalendarEvent, "seriesCancellation" | "exceptions">>;
  const cut = e.seriesCancellation;
  if (o.status !== "cancelled" || !cut || !isValidYmd(cut.from) || compareLocal(o.date, cut.from) < 0) return false;
  const exceptions = Array.isArray(e.exceptions) ? e.exceptions : [];
  return !exceptions.some((x) => x && x.date === o.date && x.type === "cancelled");
}

/**
 * Calendario público: solo actividades `public` no archivadas, expandidas en
 * `publicRange(today)` y proyectadas por lista blanca. Las ocurrencias que
 * caen después del corte de una serie cancelada no se publican (las fechas
 * canceladas una a una sí, como "Cancelada"). Las áreas del encabezado son las
 * activas que aparecen en alguna actividad publicada.
 */
export function buildPublicCalendar<E extends PublicSourceEvent>(input: {
  events: readonly E[];
  areas: readonly Area[];
  today: Ymd;
  now: LocalDateTime;
}): PublicCalendar {
  const range = publicRange(input.today);
  const areaMap = new Map(input.areas.map((a) => [a.id, a] as const));
  const visible = input.events.filter(
    (e) =>
      isExpandable(e) && e.visibility === "public" && e.status !== "archived" && compareLocal(e.startDate, range.to) <= 0,
  );
  const events = sortPublicEvents(
    occurrencesInRange(visible, range.from, range.to, input.now, input.areas)
      .filter((o) => !isSeriesCutOccurrence(o))
      .map((o) => toPublicEvent(o, o.event, areaMap)),
  );
  const used = new Set(events.flatMap((e) => [e.responsibleArea.slug, ...e.participantAreas.map((a) => a.slug)]));
  const areas = input.areas
    .filter((a) => a.active === true && used.has(a.id))
    .map(toPublicArea)
    .sort((a, b) => a.name.localeCompare(b.name, "es") || compareLocal(a.slug, b.slug));
  return {
    churchName: CHURCH_NAME,
    timeZone: PUBLIC_TIME_ZONE,
    range: { from: range.from, to: range.to },
    areas,
    events,
  };
}
