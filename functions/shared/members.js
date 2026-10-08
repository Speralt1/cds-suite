// GENERADO por scripts/build-shared.mjs desde lib/shared/members.ts — NO EDITAR.
"use strict";
// Integrantes › Consolidación V1 (doc 23). Fuente única de:
// - vocabulario guardado (estados, etapas, tipos y resultados de seguimiento);
// - normalización de teléfono (E.164 con reglas chilenas) y correo;
// - validación ESTRICTA de los payloads de las Functions (claves desconocidas,
//   tipos y largos), que el cliente reutiliza para mostrar errores;
// - transiciones del pipeline y sugerencias (nunca se aplican solas);
// - proyección del resumen de la persona (contadores derivados del historial).
//
// Lo usan el cliente (Next) y las Functions (CommonJS generado en
// functions/shared/members.js por scripts/build-shared.mjs). TS puro: sin
// React, sin Firebase, sin Date (las fechas llegan como "YYYY-MM-DD").
//
// Privacidad V1 (doc 23 §3): NO existen aquí confesión de fe, bautismo, fecha
// de nacimiento, menores, datos médicos/legales/familiares ni archivos.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMBERS_COLLECTIONS = exports.MEMBERS_CALLABLES = exports.MEMBERS_ERROR_KEYS = exports.PROFILE_FIELDS = exports.PERSON_CHANGE_ACTIONS = exports.EMPTY_PROJECTION = exports.FOLLOW_UP_CREATE_KEYS = exports.VISIT_CREATE_KEYS = exports.STATUS_CHANGE_KEYS = exports.PERSON_UPDATE_KEYS = exports.PERSON_CREATE_KEYS = exports.DOC_ID_PATTERN = exports.REQUEST_ID_PATTERN = exports.FIELD_ERROR_TEXT = exports.PHONE_HELP = exports.ADULTS_ONLY_NOTICE = exports.SENSITIVE_NOTE_WARNING = exports.MEMBERS_LIMITS = exports.ARRIVAL_SOURCE_LABEL = exports.FOLLOW_UP_RESULT_LABEL = exports.FOLLOW_UP_TYPE_LABEL = exports.CLOSED_REASON_LABEL = exports.LIFECYCLE_LABEL = exports.STATUS_LABEL = exports.ARRIVAL_SOURCES = exports.FOLLOW_UP_RESULTS = exports.FOLLOW_UP_TYPES = exports.CLOSED_REASONS = exports.ACTIVE_STATUSES = exports.CONSOLIDATION_STATUSES = exports.LIFECYCLE_STAGES = void 0;
exports.normalizePhone = normalizePhone;
exports.isE164 = isE164;
exports.formatPhone = formatPhone;
exports.whatsappLink = whatsappLink;
exports.normalizeEmail = normalizeEmail;
exports.payloadTooLarge = payloadTooLarge;
exports.parsePersonCreate = parsePersonCreate;
exports.parsePersonUpdate = parsePersonUpdate;
exports.parseStatusChange = parseStatusChange;
exports.parseVisitCreate = parseVisitCreate;
exports.parseFollowUpCreate = parseFollowUpCreate;
exports.checkTransition = checkTransition;
exports.stageFor = stageFor;
exports.suggestAfterFollowUp = suggestAfterFollowUp;
exports.suggestReopenOnVisit = suggestReopenOnVisit;
exports.projectVisit = projectVisit;
exports.projectFollowUp = projectFollowUp;
exports.projectionOf = projectionOf;
const dates_1 = require("./dates");
// ---------- Vocabulario guardado ----------
exports.LIFECYCLE_STAGES = ["en_consolidacion", "integrante"];
exports.CONSOLIDATION_STATUSES = [
    "por_contactar",
    "en_seguimiento",
    "integrandose",
    "integrado",
    "sin_continuidad",
];
/** Estados con acompañamiento abierto. */
exports.ACTIVE_STATUSES = ["por_contactar", "en_seguimiento", "integrandose"];
exports.CLOSED_REASONS = ["no_responde", "cambio_iglesia", "se_mudo", "no_desea_contacto", "otro"];
exports.FOLLOW_UP_TYPES = ["whatsapp", "llamada", "presencial", "otro"];
exports.FOLLOW_UP_RESULTS = ["contactado", "sin_respuesta", "numero_invalido", "no_desea_contacto", "otro"];
/** Cómo llegó (opcional). Decisión V1 del doc 23 §4; se puede ajustar sin migración. */
exports.ARRIVAL_SOURCES = ["invitacion", "redes_sociales", "evangelismo", "paso_por_el_lugar", "actividad", "otro"];
exports.STATUS_LABEL = {
    por_contactar: "Por contactar",
    en_seguimiento: "En seguimiento",
    integrandose: "Integrándose",
    integrado: "Integrado",
    sin_continuidad: "Sin continuidad",
};
exports.LIFECYCLE_LABEL = {
    en_consolidacion: "En consolidación",
    integrante: "Integrante",
};
exports.CLOSED_REASON_LABEL = {
    no_responde: "No responde",
    cambio_iglesia: "Se cambió de iglesia",
    se_mudo: "Se mudó",
    no_desea_contacto: "No desea contacto",
    otro: "Otro",
};
exports.FOLLOW_UP_TYPE_LABEL = {
    whatsapp: "WhatsApp",
    llamada: "Llamada",
    presencial: "Presencial",
    otro: "Otro",
};
exports.FOLLOW_UP_RESULT_LABEL = {
    contactado: "Contactado",
    sin_respuesta: "Sin respuesta",
    numero_invalido: "Número inválido",
    no_desea_contacto: "No desea contacto",
    otro: "Otro",
};
exports.ARRIVAL_SOURCE_LABEL = {
    invitacion: "Lo invitó alguien",
    redes_sociales: "Redes sociales o transmisión en vivo",
    evangelismo: "Evangelismo o campaña",
    paso_por_el_lugar: "Pasaba por el lugar",
    actividad: "Actividad o evento",
    otro: "Otro",
};
// ---------- Límites (iguales en cliente y Functions) ----------
exports.MEMBERS_LIMITS = Object.freeze({
    fullName: 120,
    email: 160,
    invitedBy: 80,
    /** Notas operacionales breves (visita y seguimiento). */
    note: 280,
    nextAction: 120,
    closedReasonNote: 200,
    /** Ventana hacia atrás para registrar una visita o un seguimiento. */
    pastDays: 365,
    /** Ventana hacia adelante para la próxima acción. */
    futureDays: 365,
    /** Tamaño máximo del payload serializado de cualquier callable. */
    payloadBytes: 4096,
});
/** Advertencia visible en todo formulario con notas (doc 23 §5). */
exports.SENSITIVE_NOTE_WARNING = "No registres información médica, legal, familiar sensible ni detalles pastorales confidenciales.";
/** Limitación operativa visible (doc 23 §3). */
exports.ADULTS_ONLY_NOTICE = "Consolidación V1 es solo para personas adultas. No registres menores de edad.";
exports.PHONE_HELP = "Si es extranjero, escribe el código de país con +.";
/**
 * Normaliza un teléfono (16c §F, validado en la preview). En orden:
 * 1. trim; quitar espacios, guiones, puntos, paréntesis y barras; "00" inicial = "+".
 * 2. Con "+": solo dígitos, 8–15 en total; "+56" exige 9 dígitos nacionales.
 * 3. 11 dígitos con "56" → +56 + 9. 4–5. 9 dígitos (9 celular, 2–8 fijo) → +56.
 * 6. 10 dígitos con "0" inicial cuyo resto cumple 4–5 → se quita el 0.
 * 7. 8 dígitos → +569 (celular anterior a 2012). 8. Lo demás es inválido.
 */
function normalizePhone(raw) {
    if (typeof raw !== "string")
        return { ok: false, reason: raw === undefined || raw === null ? "empty" : "invalid" };
    let s = raw.trim();
    if (!s)
        return { ok: false, reason: "empty" };
    if (s.length > 40)
        return { ok: false, reason: "invalid" };
    s = s.replace(/[\s\-.()/]/g, "");
    if (s.startsWith("00"))
        s = `+${s.slice(2)}`;
    const chile = (national) => ({ ok: true, e164: `+56${national}`, isChile: true });
    if (s.startsWith("+")) {
        const digits = s.slice(1);
        if (!/^\d{8,15}$/.test(digits))
            return { ok: false, reason: "invalid" };
        if (digits.startsWith("56")) {
            const national = digits.slice(2);
            return national.length === 9 && /^[2-9]/.test(national) ? chile(national) : { ok: false, reason: "invalid" };
        }
        return { ok: true, e164: `+${digits}`, isChile: false };
    }
    if (!/^\d+$/.test(s))
        return { ok: false, reason: "invalid" };
    if (s.length === 11 && s.startsWith("56") && /^[2-9]/.test(s.slice(2)))
        return chile(s.slice(2));
    if (s.length === 9 && /^[2-9]/.test(s))
        return chile(s);
    if (s.length === 10 && s.startsWith("0") && /^[2-9]/.test(s.slice(1)))
        return chile(s.slice(1));
    if (s.length === 8)
        return chile(`9${s}`);
    return { ok: false, reason: "invalid" };
}
function isE164(value) {
    return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
}
/** Visible: celular "+56 9 1234 5678", Santiago "+56 2 1234 5678", otros fijos "+56 XX XXX XXXX"; extranjeros, tal cual. */
function formatPhone(e164) {
    if (/^\+56[29]\d{8}$/.test(e164))
        return `+56 ${e164[3]} ${e164.slice(4, 8)} ${e164.slice(8)}`;
    if (/^\+56\d{9}$/.test(e164))
        return `+56 ${e164.slice(3, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}`;
    return e164;
}
/** "https://wa.me/56912345678": sin texto prellenado, generado localmente. null si no corresponde. */
function whatsappLink(person) {
    if (person.doNotContact !== false)
        return null;
    if (!isE164(person.phoneE164))
        return null;
    return `https://wa.me/${person.phoneE164.slice(1)}`;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** trim + minúsculas (sin otras transformaciones). */
function normalizeEmail(raw) {
    if (typeof raw !== "string")
        return { ok: false };
    const value = raw.trim().toLowerCase();
    if (!value || value.length > exports.MEMBERS_LIMITS.email || !EMAIL_RE.test(value))
        return { ok: false };
    return { ok: true, value };
}
exports.FIELD_ERROR_TEXT = {
    required: "Este dato es obligatorio.",
    invalid: "El valor no es válido.",
    too_long: "El texto es demasiado largo.",
    unknown_field: "Hay un dato que no corresponde.",
    future_date: "La fecha no puede ser futura.",
    too_old: "La fecha es demasiado antigua.",
    before_contact: "La próxima acción no puede ser anterior al contacto.",
    pair_required: "Completa la próxima acción y su fecha, o deja ambas vacías.",
    confirm_required: "Confirma el cambio para continuar.",
};
/** Id de solicitud generado por el cliente (idempotencia ante doble envío). */
exports.REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
/** Ids de documento: los genera el servidor (hex) o el calendario. */
exports.DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
/** Tamaño aproximado del JSON (cuenta caracteres; el límite es generoso). */
function payloadTooLarge(raw) {
    try {
        return JSON.stringify(raw ?? null).length > exports.MEMBERS_LIMITS.payloadBytes;
    }
    catch {
        return true;
    }
}
/** Caracteres de control (salvo \t y \n) e invisibles de dirección de texto: nunca en datos guardados. */
const UNSAFE_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
class Reader {
    data;
    errors = {};
    constructor(data, allowed) {
        this.data = data;
        for (const key of Object.keys(data))
            if (!allowed.includes(key))
                this.errors[key] = "unknown_field";
    }
    has(key) {
        return Object.prototype.hasOwnProperty.call(this.data, key);
    }
    raw(key) {
        return this.data[key];
    }
    fail(key, code) {
        if (!this.errors[key])
            this.errors[key] = code;
        return null;
    }
    /** Texto obligatorio, colapsa espacios. */
    text(key, max) {
        const v = this.data[key];
        if (v === undefined || v === null)
            return this.fail(key, "required");
        if (typeof v !== "string" || UNSAFE_TEXT.test(v))
            return this.fail(key, "invalid");
        const t = v.replace(/\s+/g, " ").trim();
        if (!t)
            return this.fail(key, "required");
        if (t.length > max)
            return this.fail(key, "too_long");
        return t;
    }
    /** Texto opcional: ausente/null/"" → null. */
    optText(key, max, multiline = false) {
        const v = this.data[key];
        if (v === undefined || v === null)
            return null;
        if (typeof v !== "string" || UNSAFE_TEXT.test(v))
            return this.fail(key, "invalid");
        const t = (multiline ? v.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : v.replace(/\s+/g, " ")).trim();
        if (!t)
            return null;
        if (t.length > max)
            return this.fail(key, "too_long");
        return t;
    }
    enumValue(key, values, optional) {
        const v = this.data[key];
        if (v === undefined || v === null)
            return optional ? null : this.fail(key, "required");
        if (typeof v !== "string" || !values.includes(v))
            return this.fail(key, "invalid");
        return v;
    }
    id(key, pattern, optional) {
        const v = this.data[key];
        if (v === undefined || v === null || v === "")
            return optional ? null : this.fail(key, "required");
        if (typeof v !== "string" || !pattern.test(v))
            return this.fail(key, "invalid");
        return v;
    }
    /** Fecha local en [today - pastDays, today]. */
    pastDate(key, today, optional = false) {
        const v = this.data[key];
        if (v === undefined || v === null || v === "")
            return optional ? null : this.fail(key, "required");
        if (typeof v !== "string" || !(0, dates_1.isValidYmd)(v))
            return this.fail(key, "invalid");
        if ((0, dates_1.compareLocal)(v, today) > 0)
            return this.fail(key, "future_date");
        if ((0, dates_1.compareLocal)(v, (0, dates_1.addDays)(today, -exports.MEMBERS_LIMITS.pastDays)) < 0)
            return this.fail(key, "too_old");
        return v;
    }
    bool(key, optional) {
        const v = this.data[key];
        if (v === undefined)
            return optional ? null : this.fail(key, "required");
        if (typeof v !== "boolean")
            return this.fail(key, "invalid");
        return v;
    }
    revision(key) {
        const v = this.data[key];
        if (v === undefined || v === null)
            return this.fail(key, "required");
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1_000_000)
            return this.fail(key, "invalid");
        return v;
    }
    done(value) {
        return Object.keys(this.errors).length ? { ok: false, errors: { ...this.errors } } : { ok: true, value };
    }
}
function start(raw, allowed) {
    if (!isPlainObject(raw))
        return { ok: false, errors: { _: "invalid" } };
    return new Reader(raw, allowed);
}
function phoneOf(r, key) {
    const res = normalizePhone(r.raw(key));
    if (!res.ok)
        return r.fail(key, res.reason === "empty" ? "required" : "invalid");
    return res.e164;
}
function emailOf(r, key) {
    const v = r.raw(key);
    if (v === undefined || v === null || (typeof v === "string" && !v.trim()))
        return null;
    const res = normalizeEmail(v);
    return res.ok ? res.value : r.fail(key, "invalid");
}
const OWNER_ID = /^[A-Za-z0-9_-]{1,128}$/;
exports.PERSON_CREATE_KEYS = [
    "requestId",
    "fullName",
    "phone",
    "email",
    "firstVisitDate",
    "calendarEventId",
    "arrivalSource",
    "invitedBy",
    "followUpOwnerUid",
    "visitNote",
];
function parsePersonCreate(raw, today) {
    const r = start(raw, exports.PERSON_CREATE_KEYS);
    if (!(r instanceof Reader))
        return r;
    const value = {
        requestId: r.id("requestId", exports.REQUEST_ID_PATTERN, false) ?? "",
        fullName: r.text("fullName", exports.MEMBERS_LIMITS.fullName) ?? "",
        phoneE164: phoneOf(r, "phone") ?? "",
        email: emailOf(r, "email"),
        firstVisitDate: r.pastDate("firstVisitDate", today) ?? "",
        calendarEventId: r.id("calendarEventId", exports.DOC_ID_PATTERN, true),
        arrivalSource: r.enumValue("arrivalSource", exports.ARRIVAL_SOURCES, true),
        invitedBy: r.optText("invitedBy", exports.MEMBERS_LIMITS.invitedBy),
        followUpOwnerUid: r.id("followUpOwnerUid", OWNER_ID, true),
        visitNote: r.optText("visitNote", exports.MEMBERS_LIMITS.note, true),
    };
    return r.done(value);
}
exports.PERSON_UPDATE_KEYS = [
    "personId",
    "expectedRevision",
    "fullName",
    "phone",
    "email",
    "arrivalSource",
    "invitedBy",
    "followUpOwnerUid",
    "doNotContact",
];
function parsePersonUpdate(raw) {
    const r = start(raw, exports.PERSON_UPDATE_KEYS);
    if (!(r instanceof Reader))
        return r;
    const patch = {};
    if (r.has("fullName"))
        patch.fullName = r.text("fullName", exports.MEMBERS_LIMITS.fullName) ?? "";
    if (r.has("phone"))
        patch.phoneE164 = phoneOf(r, "phone") ?? "";
    if (r.has("email"))
        patch.email = emailOf(r, "email");
    if (r.has("arrivalSource"))
        patch.arrivalSource = r.enumValue("arrivalSource", exports.ARRIVAL_SOURCES, true);
    if (r.has("invitedBy"))
        patch.invitedBy = r.optText("invitedBy", exports.MEMBERS_LIMITS.invitedBy);
    if (r.has("followUpOwnerUid"))
        patch.followUpOwnerUid = r.id("followUpOwnerUid", OWNER_ID, true);
    if (r.has("doNotContact"))
        patch.doNotContact = r.bool("doNotContact", false) ?? false;
    const value = {
        personId: r.id("personId", exports.DOC_ID_PATTERN, false) ?? "",
        expectedRevision: r.revision("expectedRevision") ?? 0,
        patch,
    };
    if (!Object.keys(patch).length && !Object.keys(r.errors).length)
        r.fail("_", "required");
    return r.done(value);
}
exports.STATUS_CHANGE_KEYS = [
    "personId",
    "expectedRevision",
    "status",
    "closedReason",
    "reasonNote",
    "confirmIntegrated",
];
function parseStatusChange(raw) {
    const r = start(raw, exports.STATUS_CHANGE_KEYS);
    if (!(r instanceof Reader))
        return r;
    const status = r.enumValue("status", exports.CONSOLIDATION_STATUSES, false);
    const closedReason = r.enumValue("closedReason", exports.CLOSED_REASONS, true);
    const reasonNote = r.optText("reasonNote", exports.MEMBERS_LIMITS.closedReasonNote);
    const confirmIntegrated = r.bool("confirmIntegrated", true) ?? false;
    if (status === "sin_continuidad") {
        if (!closedReason)
            r.fail("closedReason", "required");
        else if (closedReason === "otro" && !reasonNote)
            r.fail("reasonNote", "required");
    }
    else {
        if (closedReason)
            r.fail("closedReason", "invalid");
        if (reasonNote)
            r.fail("reasonNote", "invalid");
    }
    if (status === "integrado" && !confirmIntegrated)
        r.fail("confirmIntegrated", "confirm_required");
    const value = {
        personId: r.id("personId", exports.DOC_ID_PATTERN, false) ?? "",
        expectedRevision: r.revision("expectedRevision") ?? 0,
        status: (status ?? "por_contactar"),
        closedReason,
        reasonNote,
        confirmIntegrated,
    };
    return r.done(value);
}
exports.VISIT_CREATE_KEYS = ["requestId", "personId", "date", "calendarEventId", "note"];
function parseVisitCreate(raw, today) {
    const r = start(raw, exports.VISIT_CREATE_KEYS);
    if (!(r instanceof Reader))
        return r;
    return r.done({
        requestId: r.id("requestId", exports.REQUEST_ID_PATTERN, false) ?? "",
        personId: r.id("personId", exports.DOC_ID_PATTERN, false) ?? "",
        date: r.pastDate("date", today) ?? "",
        calendarEventId: r.id("calendarEventId", exports.DOC_ID_PATTERN, true),
        note: r.optText("note", exports.MEMBERS_LIMITS.note, true),
    });
}
exports.FOLLOW_UP_CREATE_KEYS = [
    "requestId",
    "personId",
    "contactDate",
    "type",
    "result",
    "note",
    "nextAction",
    "nextActionDate",
    "ownerUid",
    "applyStatus",
    "applyDoNotContact",
];
function parseFollowUpCreate(raw, today) {
    const r = start(raw, exports.FOLLOW_UP_CREATE_KEYS);
    if (!(r instanceof Reader))
        return r;
    const contactDate = r.pastDate("contactDate", today);
    const nextAction = r.optText("nextAction", exports.MEMBERS_LIMITS.nextAction);
    let nextActionDate = null;
    const rawNext = r.raw("nextActionDate");
    if (rawNext !== undefined && rawNext !== null && rawNext !== "") {
        if (typeof rawNext !== "string" || !(0, dates_1.isValidYmd)(rawNext))
            r.fail("nextActionDate", "invalid");
        else if (contactDate && (0, dates_1.compareLocal)(rawNext, contactDate) < 0)
            r.fail("nextActionDate", "before_contact");
        else if ((0, dates_1.compareLocal)(rawNext, (0, dates_1.addDays)(today, exports.MEMBERS_LIMITS.futureDays)) > 0)
            r.fail("nextActionDate", "invalid");
        else
            nextActionDate = rawNext;
    }
    if (!!nextAction !== !!nextActionDate && !r.errors.nextAction && !r.errors.nextActionDate) {
        r.fail(nextAction ? "nextActionDate" : "nextAction", "pair_required");
    }
    return r.done({
        requestId: r.id("requestId", exports.REQUEST_ID_PATTERN, false) ?? "",
        personId: r.id("personId", exports.DOC_ID_PATTERN, false) ?? "",
        contactDate: contactDate ?? "",
        type: (r.enumValue("type", exports.FOLLOW_UP_TYPES, false) ?? "otro"),
        result: (r.enumValue("result", exports.FOLLOW_UP_RESULTS, false) ?? "otro"),
        note: r.optText("note", exports.MEMBERS_LIMITS.note, true),
        nextAction,
        nextActionDate,
        ownerUid: r.id("ownerUid", OWNER_ID, true),
        applyStatus: r.enumValue("applyStatus", exports.CONSOLIDATION_STATUSES, true),
        applyDoNotContact: r.bool("applyDoNotContact", true) ?? false,
    });
}
/**
 * Transiciones manuales permitidas (16a D.2):
 * - entre estados activos, en cualquier sentido;
 * - activo → integrado (con confirmación) o → sin_continuidad (con motivo);
 * - sin_continuidad → en_seguimiento ("Reabrir");
 * - integrado no se reabre en V1 (pertenece a Integrantes, LATER).
 */
function checkTransition(from, to) {
    if (!exports.CONSOLIDATION_STATUSES.includes(to))
        return { ok: false, reason: "invalid" };
    if (from.consolidationStatus === to)
        return { ok: false, reason: "same" };
    if (from.consolidationStatus === "integrado" || from.lifecycleStage === "integrante")
        return { ok: false, reason: "closed_integrated" };
    if (from.consolidationStatus === "sin_continuidad")
        return to === "en_seguimiento" ? { ok: true } : { ok: false, reason: "invalid" };
    return { ok: true };
}
/** Etapa resultante: solo "integrado" la cambia (una sola identidad, sin crear otra persona). */
function stageFor(status, current) {
    return status === "integrado" ? "integrante" : current;
}
/**
 * Lo que el formulario de seguimiento propone y quien guarda confirma:
 * - primer "contactado" estando Por contactar → En seguimiento;
 * - "no desea contacto" → No contactar + Sin continuidad (motivo: no desea contacto).
 * Nunca se aplica solo: el servidor solo acepta applyStatus/applyDoNotContact iguales a esto.
 */
function suggestAfterFollowUp(person, result) {
    const none = { status: null, doNotContact: false, closedReason: null };
    if (person.lifecycleStage !== "en_consolidacion")
        return none;
    if (result === "no_desea_contacto") {
        const canClose = checkTransition(person, "sin_continuidad").ok;
        return {
            status: canClose ? "sin_continuidad" : null,
            doNotContact: !person.doNotContact,
            closedReason: canClose ? "no_desea_contacto" : null,
        };
    }
    if (result === "contactado" && !person.firstContactDate && person.consolidationStatus === "por_contactar") {
        return { status: "en_seguimiento", doNotContact: false, closedReason: null };
    }
    return none;
}
/** Al registrar una visita de una persona cerrada se sugiere "Reabrir seguimiento". */
function suggestReopenOnVisit(person) {
    return person.lifecycleStage === "en_consolidacion" && person.consolidationStatus === "sin_continuidad";
}
exports.EMPTY_PROJECTION = Object.freeze({
    visitCount: 0,
    firstVisitDate: null,
    lastVisitDate: null,
    followUpCount: 0,
    lastFollowUpDate: null,
    firstContactDate: null,
    nextAction: null,
    nextActionDate: null,
    nextActionOwnerUid: null,
});
const minYmd = (a, b) => (a && (0, dates_1.compareLocal)(a, b) <= 0 ? a : b);
const maxYmd = (a, b) => (a && (0, dates_1.compareLocal)(a, b) >= 0 ? a : b);
function projectVisit(p, date) {
    return {
        ...p,
        visitCount: p.visitCount + 1,
        firstVisitDate: minYmd(p.firstVisitDate, date),
        lastVisitDate: maxYmd(p.lastVisitDate, date),
    };
}
function projectFollowUp(p, f) {
    return {
        ...p,
        followUpCount: p.followUpCount + 1,
        lastFollowUpDate: maxYmd(p.lastFollowUpDate, f.contactDate),
        firstContactDate: f.result === "contactado" ? minYmd(p.firstContactDate, f.contactDate) : p.firstContactDate,
        nextAction: f.nextAction,
        nextActionDate: f.nextActionDate,
        nextActionOwnerUid: f.nextAction ? f.ownerUid : null,
    };
}
/** Lee la proyección de un documento guardado (tolerante). */
function projectionOf(doc) {
    const d = doc ?? {};
    const ymdOrNull = (v) => (typeof v === "string" && (0, dates_1.isValidYmd)(v) ? v : null);
    const int = (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
    const str = (v) => (typeof v === "string" && v ? v : null);
    return {
        visitCount: int(d.visitCount),
        firstVisitDate: ymdOrNull(d.firstVisitDate),
        lastVisitDate: ymdOrNull(d.lastVisitDate),
        followUpCount: int(d.followUpCount),
        lastFollowUpDate: ymdOrNull(d.lastFollowUpDate),
        firstContactDate: ymdOrNull(d.firstContactDate),
        nextAction: str(d.nextAction),
        nextActionDate: ymdOrNull(d.nextActionDate),
        nextActionOwnerUid: str(d.nextActionOwnerUid),
    };
}
// ---------- Auditoría ----------
exports.PERSON_CHANGE_ACTIONS = [
    "person_created",
    "profile_updated",
    "owner_changed",
    "do_not_contact_changed",
    "status_changed",
    "stage_changed",
    "visit_recorded",
    "follow_up_recorded",
];
/** Campos de perfil cuyo VALOR nunca entra al registro de cambios (solo el nombre del campo). */
exports.PROFILE_FIELDS = ["fullName", "phoneE164", "email", "arrivalSource", "invitedBy"];
// ---------- Errores de las Functions ----------
exports.MEMBERS_ERROR_KEYS = Object.freeze({
    unauthenticated: "members/unauthenticated",
    forbidden: "members/forbidden",
    invalidArgument: "members/invalid-argument",
    payloadTooLarge: "members/payload-too-large",
    notFound: "members/not-found",
    conflict: "members/conflict",
    invalidOwner: "members/invalid-owner",
    invalidTransition: "members/invalid-transition",
    suggestionMismatch: "members/suggestion-mismatch",
    calendarForbidden: "members/calendar-forbidden",
    calendarNotFound: "members/calendar-not-found",
    requestReused: "members/request-reused",
    internal: "members/internal",
});
/** Nombres de los callables (región southamerica-west1). */
exports.MEMBERS_CALLABLES = Object.freeze({
    personCreate: "membersPersonCreate",
    personUpdate: "membersPersonUpdate",
    statusChange: "membersStatusChange",
    visitCreate: "membersVisitCreate",
    followUpCreate: "membersFollowUpCreate",
    ownerOptions: "membersOwnerOptions",
});
/** Colecciones (solo lectura para el cliente; escribe el Admin SDK). */
exports.MEMBERS_COLLECTIONS = Object.freeze({
    people: "membersPeople",
    visits: "membersVisits",
    followUps: "membersFollowUps",
    changes: "membersPersonChanges",
});
