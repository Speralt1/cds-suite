// GENERADO por scripts/build-shared.mjs desde lib/shared/calendar-core.ts — NO EDITAR.
"use strict";
// Núcleo del calendario compartido por cliente y Functions: ocurrencias en un
// rango, el comparador único de orden dentro del día y `lastDate`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventSpan = void 0;
exports.compareDayOrder = compareDayOrder;
exports.occurrenceOrderKey = occurrenceOrderKey;
exports.sortOccurrences = sortOccurrences;
exports.occurrencesInRange = occurrencesInRange;
exports.lastDateOf = lastDateOf;
const dates_1 = require("./dates");
const recurrence_1 = require("./recurrence");
Object.defineProperty(exports, "eventSpan", { enumerable: true, get: function () { return recurrence_1.eventSpan; } });
/**
 * Comparador ÚNICO (Mes, Semana, Agenda, móvil, público y reporte): por fecha;
 * dentro del día, primero todo el día, luego hora de inicio, nombre del área
 * responsable y título.
 */
function compareDayOrder(a, b) {
    return ((0, dates_1.compareLocal)(a.date, b.date) ||
        Number(b.allDay) - Number(a.allDay) ||
        (0, dates_1.compareLocal)(a.allDay ? "" : (a.startTime ?? ""), b.allDay ? "" : (b.startTime ?? "")) ||
        a.areaName.localeCompare(b.areaName, "es") ||
        a.title.localeCompare(b.title, "es"));
}
/** Clave de orden de una ocurrencia. Sin `areas` no se desempata por área (solo por título). */
function occurrenceOrderKey(o, areas) {
    const areaId = o.event.responsibleAreaId;
    const areaName = areas && areaId ? (areas.find((a) => a.id === areaId)?.name ?? "") : "";
    return {
        date: o.date,
        allDay: o.allDay,
        startTime: o.startTime,
        areaName: typeof areaName === "string" ? areaName : "",
        title: typeof o.event.title === "string" ? o.event.title : "",
    };
}
/** Ordena con compareDayOrder (estable; desempate final por clave de ocurrencia). */
function sortOccurrences(list, areas) {
    const keys = new Map(list.map((o) => [o, occurrenceOrderKey(o, areas)]));
    return [...list].sort((a, b) => compareDayOrder(keys.get(a), keys.get(b)) || (0, dates_1.compareLocal)(a.key, b.key));
}
/**
 * Ocurrencias visibles (sin archivadas) en [from, to], ordenadas con
 * compareDayOrder. Pasa `areas` para desempatar por nombre del área responsable.
 */
function occurrencesInRange(events, from, to, now, areas) {
    return sortOccurrences(events.flatMap((e) => (0, recurrence_1.expandRecurrence)(e, from, to, now)), areas);
}
/**
 * `lastDate` guardado para consultas por rango (18a §C.3):
 * sin recurrencia → endDate ; recurrente → until + span (span ≤ 1).
 */
function lastDateOf(e) {
    if (!(0, recurrence_1.isRecurring)(e))
        return e.endDate;
    const until = e.recurrence.until ?? e.startDate;
    return (0, dates_1.addDays)(until, (0, recurrence_1.eventSpan)(e));
}
