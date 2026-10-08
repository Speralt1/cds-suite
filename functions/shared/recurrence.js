// GENERADO por scripts/build-shared.mjs desde lib/shared/recurrence.ts — NO EDITAR.
"use strict";
// Recurrencia V1 (portada de PR #4, revisada): none · weekly · biweekly ·
// monthly "n-ésimo día de la semana" con `until` inclusivo. Todo en fechas
// locales mediante epoch-days: los cambios de horario de Chile no corren nada.
//
// Estados guardados: scheduled | cancelled (solo actividades simples) | archived.
// "realized" se deriva (fin de la ocurrencia < ahora en Santiago); nunca se guarda.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RECURRING_SPAN_DAYS = exports.MAX_MONTHS = exports.MAX_OCCURRENCES = void 0;
exports.eventSpan = eventSpan;
exports.isRecurring = isRecurring;
exports.candidateDates = candidateDates;
exports.isOccurrenceDate = isOccurrenceDate;
exports.occurrenceEnd = occurrenceEnd;
exports.expandRecurrence = expandRecurrence;
exports.monthlyOrdinalOptions = monthlyOrdinalOptions;
exports.ordinalLabel = ordinalLabel;
exports.monthlyRuleLabel = monthlyRuleLabel;
exports.recurrenceSummary = recurrenceSummary;
exports.weekdayPluralName = weekdayPluralName;
exports.recurrenceDetailText = recurrenceDetailText;
exports.validateRecurrence = validateRecurrence;
const dates_1 = require("./dates");
exports.MAX_OCCURRENCES = 60;
exports.MAX_MONTHS = 12;
/** Una serie recurrente dura como máximo 1 día extra (vigilia). */
exports.MAX_RECURRING_SPAN_DAYS = 1;
/** Días que dura una actividad más allá de su fecha de inicio (0 = un día). */
function eventSpan(e) {
    return Math.max(0, (0, dates_1.daysBetween)(e.startDate, e.endDate));
}
function isRecurring(e) {
    return !!e.recurrence && e.recurrence.freq !== "none";
}
/** Fechas de inicio que genera la regla dentro de [from, to] (sin filtrar estado). */
function candidateDates(e, from, to) {
    const span = eventSpan(e);
    const r = e.recurrence;
    const out = [];
    if (r.freq === "none") {
        out.push(e.startDate);
    }
    else if (r.freq === "weekly" || r.freq === "biweekly") {
        const step = r.freq === "weekly" ? 7 : 14;
        const until = r.until ?? e.startDate;
        const start = (0, dates_1.toEpochDay)(e.startDate);
        const k0 = Math.max(0, Math.floor(((0, dates_1.toEpochDay)(from) - span - start) / step));
        for (let k = k0, guard = 0; guard < 1000; k++, guard++) {
            const d = (0, dates_1.addDays)(e.startDate, k * step);
            if ((0, dates_1.compareLocal)(d, until) > 0 || (0, dates_1.compareLocal)(d, to) > 0)
                break;
            out.push(d);
        }
    }
    else if (r.freq === "monthly" && r.monthly) {
        const until = r.until ?? e.startDate;
        const last = (0, dates_1.compareLocal)(until, to) < 0 ? until : to;
        const s = (0, dates_1.parseYmd)(e.startDate);
        const lastKey = (0, dates_1.monthKey)(last);
        for (let i = 0; i < 1000; i++) {
            const { y, m } = (0, dates_1.shiftMonth)(s.y, s.m, i);
            const key = `${y}-${String(m).padStart(2, "0")}`;
            if (key > lastKey)
                break;
            const d = (0, dates_1.nthWeekdayOfMonth)(y, m, r.monthly.weekday, r.monthly.ordinal);
            if (d && (0, dates_1.compareLocal)(d, e.startDate) >= 0 && (0, dates_1.compareLocal)(d, until) <= 0)
                out.push(d);
        }
    }
    // Intersección con el rango: la vigilia (span 1) aparece también al consultar el día siguiente.
    return out.filter((d) => (0, dates_1.compareLocal)(d, to) <= 0 && (0, dates_1.compareLocal)((0, dates_1.addDays)(d, span), from) >= 0);
}
/** ¿La regla genera esta fecha de inicio? */
function isOccurrenceDate(e, date) {
    return candidateDates({ ...e, endDate: e.startDate }, date, date).includes(date);
}
/** Fin de una ocurrencia como fecha-hora local. */
function occurrenceEnd(e, date) {
    const end = (0, dates_1.addDays)(date, eventSpan(e));
    const time = e.endTime ?? (e.allDay ? "23:59" : (e.startTime ?? "23:59"));
    return `${end}T${time}`;
}
/** Expande una actividad a sus ocurrencias en [from, to] con su estado derivado. Las archivadas no generan nada. */
function expandRecurrence(e, from, to, now) {
    if (e.status === "archived")
        return [];
    const span = eventSpan(e);
    const exceptions = Array.isArray(e.exceptions) ? e.exceptions : [];
    const recurring = isRecurring(e);
    return candidateDates(e, from, to).map((d) => {
        const exception = exceptions.find((x) => x.date === d && x.type === "cancelled");
        let status;
        let cancelReason = null;
        if (exception) {
            status = "cancelled";
            cancelReason = exception.reason ?? null;
        }
        else if (e.seriesCancellation && (0, dates_1.compareLocal)(d, e.seriesCancellation.from) >= 0) {
            status = "cancelled";
            cancelReason = e.seriesCancellation.reason ?? null;
        }
        else if (e.status === "cancelled") {
            status = "cancelled";
            cancelReason = e.cancelReason ?? null;
        }
        else if ((0, dates_1.compareLocal)(occurrenceEnd(e, d), now) < 0) {
            status = "realized";
        }
        else {
            status = "scheduled";
        }
        return {
            key: `${e.id}@${d}`,
            eventId: e.id,
            event: e,
            date: d,
            endDate: (0, dates_1.addDays)(d, span),
            allDay: e.allDay,
            startTime: e.allDay ? null : (e.startTime ?? null),
            endTime: e.allDay ? null : (e.endTime ?? null),
            status,
            cancelReason,
            isRecurring: recurring,
        };
    });
}
/** Ordinales ofrecidos al crear una serie mensual a partir de su fecha de inicio. */
function monthlyOrdinalOptions(date) {
    const { y, m, d } = (0, dates_1.parseYmd)(date);
    const n = Math.ceil(d / 7);
    if (n >= 5)
        return [-1];
    if (d + 7 > (0, dates_1.daysInMonth)(y, m))
        return [n, -1];
    return [n];
}
const ORDINAL_LABEL = { "1": "primer", "2": "segundo", "3": "tercer", "4": "cuarto", "-1": "último" };
function ordinalLabel(ord) {
    return ORDINAL_LABEL[String(ord)];
}
/** "el primer sábado", "el último viernes". */
function monthlyRuleLabel(weekday, ord) {
    return `el ${ordinalLabel(ord)} ${dates_1.WEEKDAY_NAMES[weekday]}`;
}
/** Resumen en texto: "Cada semana, los domingos, hasta el 28-02-2027". */
function recurrenceSummary(e) {
    const r = e.recurrence;
    const wd = dates_1.WEEKDAY_NAMES[(0, dates_1.weekdayOf)(e.startDate)];
    const until = r.until ? `, hasta el ${(0, dates_1.numericYmd)(r.until)}` : "";
    switch (r.freq) {
        case "none":
            return "No se repite";
        case "weekly":
            return `Cada semana, los ${wd === "sábado" || wd === "domingo" ? `${wd}s` : wd}${until}`;
        case "biweekly":
            return `Cada 2 semanas, los ${wd === "sábado" || wd === "domingo" ? `${wd}s` : wd}${until}`;
        case "monthly":
            return r.monthly ? `Cada mes, ${monthlyRuleLabel(r.monthly.weekday, r.monthly.ordinal)}${until}` : `Cada mes${until}`;
    }
}
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "domingos", "lunes", "sábados". */
function weekdayPluralName(wd) {
    const name = dates_1.WEEKDAY_NAMES[wd];
    return name.endsWith("s") ? name : `${name}s`;
}
/**
 * Texto de la recurrencia en el detalle, también publicado en la proyección
 * pública: "Se repite cada viernes hasta el 18 dic 2026",
 * "Cada 2 semanas, los martes, hasta el …", "El primer sábado de cada mes hasta el …".
 */
function recurrenceDetailText(e) {
    const r = e.recurrence;
    if (r.freq === "none")
        return null;
    const wd = (0, dates_1.weekdayOf)(e.startDate);
    let until = "";
    if (r.until) {
        const { y, m, d } = (0, dates_1.parseYmd)(r.until);
        until = ` hasta el ${d} ${MONTHS_SHORT[m - 1]} ${y}`;
    }
    switch (r.freq) {
        case "weekly":
            return `Se repite cada ${dates_1.WEEKDAY_NAMES[wd]}${until}`;
        case "biweekly":
            return `Cada 2 semanas, los ${weekdayPluralName(wd)}${until ? `,${until}` : ""}`;
        case "monthly": {
            if (!r.monthly)
                return `Cada mes${until}`;
            const text = `el ${ordinalLabel(r.monthly.ordinal)} ${dates_1.WEEKDAY_NAMES[r.monthly.weekday]} de cada mes${until}`;
            return text[0].toLocaleUpperCase("es") + text.slice(1);
        }
        default:
            return null;
    }
}
/**
 * Errores de la regla (vacío = válida). Límites V1: `until` obligatorio,
 * ≤ 12 meses desde el inicio, ≤ 60 fechas y span ≤ 1 día para las recurrentes.
 */
function validateRecurrence(rule, startDate, endDate) {
    const errors = [];
    if (rule.freq === "none")
        return errors;
    if (!["weekly", "biweekly", "monthly"].includes(rule.freq)) {
        errors.push("La frecuencia elegida no es válida.");
        return errors;
    }
    if ((0, dates_1.daysBetween)(startDate, endDate) > exports.MAX_RECURRING_SPAN_DAYS)
        errors.push("Las actividades de varios días no se repiten. Crea cada fecha por separado.");
    if (!rule.until) {
        errors.push("Elige hasta cuándo se repite.");
        return errors;
    }
    if ((0, dates_1.compareLocal)(rule.until, startDate) < 0)
        errors.push("La fecha final debe ser posterior al inicio.");
    if ((0, dates_1.compareLocal)(rule.until, (0, dates_1.addMonthsClamped)(startDate, exports.MAX_MONTHS)) > 0)
        errors.push("Una serie puede durar como máximo 12 meses.");
    if (rule.freq === "monthly") {
        if (!rule.monthly)
            errors.push("Elige qué día del mes se repite.");
        else {
            const { y, m } = (0, dates_1.parseYmd)(startDate);
            if ((0, dates_1.nthWeekdayOfMonth)(y, m, rule.monthly.weekday, rule.monthly.ordinal) !== startDate)
                errors.push("La fecha de inicio no cumple la regla mensual elegida.");
        }
    }
    if (!errors.length) {
        const count = candidateDates({ startDate, endDate: startDate, recurrence: rule }, startDate, rule.until).length;
        if (count > exports.MAX_OCCURRENCES)
            errors.push(`Una serie puede tener como máximo ${exports.MAX_OCCURRENCES} fechas.`);
    }
    return errors;
}
