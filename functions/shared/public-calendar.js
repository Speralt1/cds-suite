// GENERADO por scripts/build-shared.mjs desde lib/shared/public-calendar.ts — NO EDITAR.
"use strict";
// Proyección pública del calendario (18a §E.1). Se arma por LISTA BLANCA con
// literales explícitos: nunca spread de la actividad interna. La usan la
// Function `calendarPublicFeed` (vía functions/shared) y los tests del cliente.
//
// Nunca sale: internalNotes, cancelReason, archiveReason, motivos de
// excepciones o de la serie, uids (createdBy/updatedBy/by), correos ni
// permisos. "Realizada" no se expone: una ocurrencia pasada sale "scheduled".
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_TIME_ZONE = exports.CHURCH_NAME = exports.PUBLIC_CALENDAR_KEYS = exports.PUBLIC_AREA_KEYS = exports.PUBLIC_EVENT_KEYS = void 0;
exports.fnv1a64 = fnv1a64;
exports.toPublicArea = toPublicArea;
exports.publicRecurrenceLabel = publicRecurrenceLabel;
exports.toPublicEvent = toPublicEvent;
exports.publicRange = publicRange;
exports.sortPublicEvents = sortPublicEvents;
exports.isSeriesCutOccurrence = isSeriesCutOccurrence;
exports.buildPublicCalendar = buildPublicCalendar;
const calendar_core_1 = require("./calendar-core");
const dates_1 = require("./dates");
const recurrence_1 = require("./recurrence");
const types_1 = require("./types");
exports.PUBLIC_EVENT_KEYS = [
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
];
exports.PUBLIC_AREA_KEYS = ["slug", "name", "color"];
exports.PUBLIC_CALENDAR_KEYS = ["churchName", "timeZone", "range", "areas", "events"];
exports.CHURCH_NAME = "Casa de Salvación";
exports.PUBLIC_TIME_ZONE = dates_1.SANTIAGO_TIME_ZONE;
const FALLBACK_COLOR = "pizarra";
const FNV64_OFFSET = BigInt("0xcbf29ce484222325");
const FNV64_PRIME = BigInt("0x100000001b3");
const FNV64_MASK = BigInt("0xffffffffffffffff");
/** FNV-1a de 64 bits (sobre unidades UTF-16) en 16 hex: id público opaco que no revela el id interno. */
function fnv1a64(text) {
    let h = FNV64_OFFSET;
    for (let i = 0; i < text.length; i++) {
        h ^= BigInt(text.charCodeAt(i));
        h = (h * FNV64_PRIME) & FNV64_MASK;
    }
    return h.toString(16).padStart(16, "0");
}
function textOrNull(value) {
    return typeof value === "string" && value.trim() ? value : null;
}
function safeColor(value) {
    return typeof value === "string" && types_1.AREA_COLORS.includes(value) ? value : FALLBACK_COLOR;
}
function toPublicArea(a) {
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
function publicRecurrenceLabel(e) {
    if (!e.seriesCancellation)
        return (0, recurrence_1.recurrenceDetailText)({ startDate: e.startDate, recurrence: e.recurrence });
    if (e.recurrence.freq === "none")
        return null;
    const cut = (0, dates_1.addDays)(e.seriesCancellation.from, -1);
    const until = e.recurrence.until && (0, dates_1.compareLocal)(e.recurrence.until, cut) < 0 ? e.recurrence.until : cut;
    if ((0, dates_1.compareLocal)(until, e.startDate) < 0)
        return null;
    if (!(0, recurrence_1.candidateDates)({ startDate: e.startDate, endDate: e.startDate, recurrence: e.recurrence }, e.startDate, until).length)
        return null;
    return (0, recurrence_1.recurrenceDetailText)({ startDate: e.startDate, recurrence: { ...e.recurrence, until } });
}
function toPublicEvent(o, e, areas) {
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
            .filter((a) => !!a)
            .map(toPublicArea),
        status: o.status === "cancelled" ? "cancelled" : "scheduled",
        recurrenceLabel: publicRecurrenceLabel(e),
    };
}
/** Rango navegable: desde el primer día del mes anterior hasta el último día de hoy + 6 meses. */
function publicRange(today) {
    return {
        from: (0, dates_1.firstOfMonth)((0, dates_1.addMonthsClamped)((0, dates_1.firstOfMonth)(today), -1)),
        to: (0, dates_1.lastOfMonth)((0, dates_1.addMonthsClamped)((0, dates_1.firstOfMonth)(today), 6)),
    };
}
/** Ordena eventos públicos con el mismo comparador que el resto de las vistas (compareDayOrder); desempate por id. */
function sortPublicEvents(list) {
    const key = (e) => ({
        date: e.startDate,
        allDay: e.allDay,
        startTime: e.startTime,
        areaName: e.responsibleArea.name,
        title: e.title,
    });
    return [...list].sort((a, b) => (0, calendar_core_1.compareDayOrder)(key(a), key(b)) || (0, dates_1.compareLocal)(a.id, b.id));
}
/** ¿La actividad tiene la forma mínima para expandirse sin sorpresas? */
function isExpandable(e) {
    return (!!e &&
        typeof e.id === "string" &&
        (0, dates_1.isValidYmd)(e.startDate) &&
        (0, dates_1.isValidYmd)(e.endDate) &&
        (0, dates_1.compareLocal)(e.endDate, e.startDate) >= 0 &&
        !!e.recurrence &&
        typeof e.recurrence.freq === "string" &&
        (e.recurrence.freq === "none" || (0, dates_1.isValidYmd)(e.recurrence.until)));
}
/**
 * ¿La ocurrencia está cancelada SOLO por la cancelación de la serie
 * (`seriesCancellation.from` ≤ fecha, sin excepción propia ese día)? Esas no se
 * publican: tras el corte la serie simplemente termina. Una excepción de una
 * fecha (aunque caiga después del corte) sí se publica como "Cancelada", igual
 * que en recurrence.ts, donde la excepción tiene precedencia.
 */
function isSeriesCutOccurrence(o) {
    const e = o.event;
    const cut = e.seriesCancellation;
    if (o.status !== "cancelled" || !cut || !(0, dates_1.isValidYmd)(cut.from) || (0, dates_1.compareLocal)(o.date, cut.from) < 0)
        return false;
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
function buildPublicCalendar(input) {
    const range = publicRange(input.today);
    const areaMap = new Map(input.areas.map((a) => [a.id, a]));
    const visible = input.events.filter((e) => isExpandable(e) && e.visibility === "public" && e.status !== "archived" && (0, dates_1.compareLocal)(e.startDate, range.to) <= 0);
    const events = sortPublicEvents((0, calendar_core_1.occurrencesInRange)(visible, range.from, range.to, input.now, input.areas)
        .filter((o) => !isSeriesCutOccurrence(o))
        .map((o) => toPublicEvent(o, o.event, areaMap)));
    const used = new Set(events.flatMap((e) => [e.responsibleArea.slug, ...e.participantAreas.map((a) => a.slug)]));
    const areas = input.areas
        .filter((a) => a.active === true && used.has(a.id))
        .map(toPublicArea)
        .sort((a, b) => a.name.localeCompare(b.name, "es") || (0, dates_1.compareLocal)(a.slug, b.slug));
    return {
        churchName: exports.CHURCH_NAME,
        timeZone: exports.PUBLIC_TIME_ZONE,
        range: { from: range.from, to: range.to },
        areas,
        events,
    };
}
