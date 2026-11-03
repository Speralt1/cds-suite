// GENERADO por scripts/build-shared.mjs desde lib/shared/outreach-model.ts — NO EDITAR.
"use strict";
// Integrantes › Consolidación › «Ve por los tuyos» (doc 40). Modelo de dominio
// del evento anual: TypeScript puro, sin React, sin Firebase y sin APIs del
// navegador, para que el mismo código pueda pasar a lib/shared cuando exista
// el backend (callables `outreach*`). PROPUESTO: nada de esto tiene Rules,
// Functions ni colecciones desplegadas.
//
// Ejes independientes (nunca se deducen unos de otros):
//   inscripción (status) · asistencia (attendance) · consentimiento (consents)
//   · decisión voluntaria (registro aparte, acceso pastoral) · asignación
//   (ownerUid) · seguimiento del evento (contactos) · traspaso a Consolidación.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECISION_LABEL = exports.DECISION_VALUES = exports.FOLLOW_UP_POLICY = exports.EVENT_CONTACT_RESULT_LABEL = exports.EVENT_CONTACT_RESULTS = exports.EMPTY_FOLLOW_UP = exports.CONSENT_SOURCES = exports.CONSENT_PURPOSE_LABEL = exports.CONSENT_PURPOSES = exports.ATTENDANCE_LABEL = exports.ATTENDANCE = exports.REGISTRATION_STATUSES = exports.REGISTRATION_SOURCE_LABEL = exports.REGISTRATION_SOURCES = exports.TEAM_ROLE_LABEL = exports.TEAM_ROLES = exports.EDITION_ID_RE = exports.EDITION_STATUS_LABEL = exports.EDITION_STATUSES = void 0;
exports.canMoveEdition = canMoveEdition;
exports.editionIdFor = editionIdFor;
exports.isReadOnly = isReadOnly;
exports.copyTeamStructure = copyTeamStructure;
exports.hasConsent = hasConsent;
exports.isContactable = isContactable;
exports.changeAttendance = changeAttendance;
exports.pendingAttendance = pendingAttendance;
exports.recordContact = recordContact;
exports.queueBucket = queueBucket;
exports.parseDecision = parseDecision;
// ---------- Edición ----------
exports.EDITION_STATUSES = ["preparacion", "inscripcion", "evento", "seguimiento", "cerrada"];
exports.EDITION_STATUS_LABEL = {
    preparacion: "Preparación",
    inscripcion: "Inscripciones abiertas",
    evento: "Día del evento",
    seguimiento: "Seguimiento",
    cerrada: "Cerrada",
};
/** Transiciones permitidas; volver atrás solo un paso y con motivo (lo exige el backend). */
const EDITION_NEXT = {
    preparacion: ["inscripcion"],
    inscripcion: ["evento", "preparacion"],
    evento: ["seguimiento", "inscripcion"],
    seguimiento: ["cerrada", "evento"],
    cerrada: [],
};
function canMoveEdition(from, to) {
    return EDITION_NEXT[from].includes(to);
}
exports.EDITION_ID_RE = /^vplt-(\d{4})$/;
function editionIdFor(year) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
        throw new Error("año de edición inválido");
    return `vplt-${year}`;
}
/** Una edición cerrada es de solo lectura: sus pendientes no aparecen en la edición vigente. */
function isReadOnly(edition) {
    return edition.status === "cerrada";
}
// ---------- Equipo de la edición ----------
exports.TEAM_ROLES = ["coordinacion", "recepcion", "responsable"];
exports.TEAM_ROLE_LABEL = {
    coordinacion: "Coordinación",
    recepcion: "Recepción",
    responsable: "Responsable",
};
/** Copia la ESTRUCTURA del equipo a una edición nueva: sin personas, cargas ni historial. */
function copyTeamStructure(previous) {
    return previous
        .filter((m) => m.active)
        .map((m) => ({ uid: m.uid, displayName: m.displayName, roles: [...m.roles], active: true, maxAssigned: m.maxAssigned }));
}
// ---------- Inscripción (padrón de la edición) ----------
exports.REGISTRATION_SOURCES = ["web", "recepcion", "coordinacion", "mesa"];
exports.REGISTRATION_SOURCE_LABEL = {
    web: "Inscripción web",
    recepcion: "Llegó sin inscripción",
    coordinacion: "Agregada por coordinación",
    mesa: "Agregada en su mesa",
};
exports.REGISTRATION_STATUSES = ["activa", "cancelada", "duplicada"];
exports.ATTENDANCE = ["sin_confirmar", "asistio", "no_asistio"];
exports.ATTENDANCE_LABEL = {
    sin_confirmar: "Sin confirmar",
    asistio: "Asistió",
    no_asistio: "No asistió",
};
exports.CONSENT_PURPOSES = ["seguimiento_evento", "mensajes_whatsapp", "traspaso_consolidacion"];
exports.CONSENT_PURPOSE_LABEL = {
    seguimiento_evento: "Contacto de seguimiento del evento",
    mensajes_whatsapp: "Mensajes por WhatsApp",
    traspaso_consolidacion: "Acompañamiento habitual de la iglesia",
};
exports.CONSENT_SOURCES = ["formulario_web", "verbal_recepcion", "verbal_responsable", "verbal_mesa"];
exports.EMPTY_FOLLOW_UP = Object.freeze({
    lastContactAt: null,
    lastResult: null,
    attempts: 0,
    nextAction: null,
    nextActionDate: null,
});
function hasConsent(reg, purpose) {
    if (reg.doNotContact)
        return false;
    return reg.consents.some((c) => c.purpose === purpose && c.revokedAt === null);
}
/** Contactable para el seguimiento del evento: activa, sin baja y con autorización vigente. */
function isContactable(reg) {
    return reg.status === "activa" && hasConsent(reg, "seguimiento_evento");
}
/**
 * «Asistió» se marca con un toque en recepción. «No asistió» solo lo confirma
 * coordinación al cierre (nunca se deduce del silencio). Corregir una marca
 * exige motivo. Repetir la misma marca no cambia nada (idempotente).
 */
function changeAttendance(reg, edition, change) {
    if (isReadOnly(edition))
        return { ok: false, error: "edicion_cerrada" };
    if (reg.status !== "activa")
        return { ok: false, error: "inscripcion_inactiva" };
    if (reg.attendance === change.to)
        return { ok: false, error: "sin_cambio" };
    if (change.to === "no_asistio" && edition.status !== "evento" && edition.status !== "seguimiento") {
        return { ok: false, error: "fuera_del_evento" };
    }
    if (reg.attendance !== "sin_confirmar" && !change.reason?.trim())
        return { ok: false, error: "motivo_requerido" };
    return {
        ok: true,
        value: { ...reg, attendance: change.to, attendanceAt: change.at, attendanceBy: change.by, revision: reg.revision + 1 },
    };
}
/** Candidatas a «No asistió» al cierre: coordinación las revisa y confirma en lote. */
function pendingAttendance(regs) {
    return regs.filter((r) => r.status === "activa" && r.attendance === "sin_confirmar");
}
// ---------- Seguimiento del evento ----------
exports.EVENT_CONTACT_RESULTS = ["contactado", "sin_respuesta", "numero_invalido", "pidio_no_contacto"];
exports.EVENT_CONTACT_RESULT_LABEL = {
    contactado: "Conversamos",
    sin_respuesta: "No respondió",
    numero_invalido: "Número no válido",
    pidio_no_contacto: "Pidió no ser contactado",
};
/** Política de intentos acordada en doc 38 §7: primer contacto D+1–D+2, un segundo intento hasta D+7. */
exports.FOLLOW_UP_POLICY = Object.freeze({ firstContactWithinDays: 2, secondAttemptAtDay: 7, maxNoAnswerAttempts: 2 });
function recordContact(reg, edition, contact) {
    if (isReadOnly(edition))
        return { ok: false, error: "edicion_cerrada" };
    if (reg.handedOffAt)
        return { ok: false, error: "traspasada" };
    if (!isContactable(reg))
        return { ok: false, error: "no_contactable" };
    if (reg.ownerUid !== contact.byUid)
        return { ok: false, error: "no_asignada" };
    if ((contact.nextAction === null) !== (contact.nextActionDate === null))
        return { ok: false, error: "proxima_accion_incompleta" };
    const optOut = contact.result === "pidio_no_contacto";
    return {
        ok: true,
        value: {
            ...reg,
            doNotContact: reg.doNotContact || optOut,
            followUp: {
                lastContactAt: contact.date,
                lastResult: contact.result,
                attempts: reg.followUp.attempts + 1,
                // Una baja cancela cualquier pendiente en el mismo paso.
                nextAction: optOut ? null : contact.nextAction,
                nextActionDate: optOut ? null : contact.nextActionDate,
            },
            revision: reg.revision + 1,
        },
    };
}
/** En qué fila de «Mi lista» va una persona asignada, relativo a hoy y a D. */
function queueBucket(reg, today, eventDate) {
    if (reg.doNotContact || !hasConsent(reg, "seguimiento_evento"))
        return "baja";
    const f = reg.followUp;
    if (f.attempts === 0) {
        if (!eventDate)
            return "primer_contacto";
        const due = addDaysSafe(eventDate, exports.FOLLOW_UP_POLICY.firstContactWithinDays);
        return today > due ? "vencido" : "primer_contacto";
    }
    if (!f.nextActionDate)
        return "al_dia";
    if (f.nextActionDate < today)
        return "vencido";
    if (f.nextActionDate === today)
        return "hoy";
    return "proximo";
}
function addDaysSafe(value, n) {
    const [y, m, d] = value.split("-").map(Number);
    const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
}
// ---------- Decisión voluntaria (restringida) ----------
/**
 * PROPUESTO, requiere aprobación (doc 38 §7.3): valores, acceso y conservación.
 * Vive en `outreachDecisions/{registrationId}`, legible solo con
 * `outreach.decisions.read`; nunca en notas, nunca en el documento que lee el
 * responsable, nunca hacia WSP. Sin documento = «No registrada».
 */
exports.DECISION_VALUES = ["acepto_a_cristo", "desea_conversar", "no_por_ahora"];
exports.DECISION_LABEL = {
    no_registrada: "No registrada",
    acepto_a_cristo: "Aceptó a Cristo",
    desea_conversar: "Desea conversar",
    no_por_ahora: "No por ahora",
};
function parseDecision(raw) {
    if (!raw.registrationId || !raw.editionId)
        return { ok: false, error: "inscripcion_requerida" };
    if (!raw.value || !exports.DECISION_VALUES.includes(raw.value))
        return { ok: false, error: "valor_invalido" };
    if (raw.declaredBy !== "la_persona")
        return { ok: false, error: "solo_declaracion_propia" };
    if (!raw.consentTextVersion?.trim())
        return { ok: false, error: "consentimiento_requerido" };
    if (!raw.recordedAt || !raw.recordedBy)
        return { ok: false, error: "auditoria_requerida" };
    return { ok: true, value: raw };
}
