// GENERADO por scripts/build-shared.mjs desde lib/shared/outreach-tables.ts — NO EDITAR.
"use strict";
// Mesas del evento (doc 40 §6b). Decisión del administrador (03/11/2026):
// ~35 mesas, cada una con un encargado que la acompaña después del evento.
// El permiso para anotar se pide al solicitar la entrada (texto nuevo del
// sitio) y en la mesa se confirma con UN toque, porque quien pidió la entrada
// no siempre es quien asiste.
//
// Enlace por mesa, sin usuario ni contraseña: el backend guarda solo el hash
// del token (patrón del calendario público: token en el fragmento + POST),
// vale una ventana el día D y se puede revocar. Desde la mesa solo se puede
// buscar (código de entrada o ≥3 letras), marcar y deshacer lo propio; nunca
// se ven teléfonos, correos ni el padrón completo.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TABLE_CONSENT_VERSION = exports.TABLE_MARK_LABEL = exports.TABLE_MARKS = void 0;
exports.tableLinkWindow = tableLinkWindow;
exports.linkUsable = linkUsable;
exports.normalizeTicketCode = normalizeTicketCode;
exports.searchForTable = searchForTable;
exports.toRow = toRow;
exports.markAtTable = markAtTable;
exports.unmarkAtTable = unmarkAtTable;
exports.addAtTable = addAtTable;
exports.tableAffinity = tableAffinity;
exports.tableSummaries = tableSummaries;
const dates_1 = require("./dates");
const members_1 = require("./members");
const outreach_model_1 = require("./outreach-model");
/** Marcas posibles en la mesa: sin marca = «No registrada». */
exports.TABLE_MARKS = ["acepto_a_cristo", "desea_conversar"];
exports.TABLE_MARK_LABEL = {
    acepto_a_cristo: "Aceptó a Cristo",
    desea_conversar: "Quiere conversar",
};
/** Versión del texto que se confirma en la mesa («¿Te podemos anotar para acompañarte?»). */
exports.TABLE_CONSENT_VERSION = "mesa-2026-1";
/** Ventana del enlace: D 16:00 → D+1 02:00 (hora de Santiago, de pared). */
function tableLinkWindow(eventDate) {
    const next = (0, dates_1.addDays)(eventDate, 1);
    return { opensAt: `${eventDate}T16:00`, closesAt: `${next}T02:00` };
}
function linkUsable(table, eventDate, now) {
    if (!eventDate)
        return { ok: false, error: "sin_fecha" };
    if (!table.linkHash)
        return { ok: false, error: "sin_enlace" };
    if (table.linkRevokedAt)
        return { ok: false, error: "revocado" };
    const w = tableLinkWindow(eventDate);
    if (now < w.opensAt || now >= w.closesAt)
        return { ok: false, error: "fuera_de_horario" };
    return { ok: true };
}
function fold(s) {
    return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es").trim();
}
function normalizeTicketCode(raw) {
    return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
}
/**
 * Búsqueda desde la mesa: código de entrada exacto, o todas las palabras
 * (≥3 letras en total) al inicio de alguna palabra del nombre. Máximo 8.
 */
function searchForTable(regs, decisions, query) {
    const q = query.trim();
    if (!q)
        return [];
    const active = regs.filter((r) => r.status === "activa");
    const code = normalizeTicketCode(q);
    const byCode = code.length >= 4 ? active.filter((r) => r.ticketCode && normalizeTicketCode(r.ticketCode) === code) : [];
    let found = byCode;
    if (!found.length) {
        const parts = fold(q).split(/\s+/).filter(Boolean);
        if (parts.join("").length < 3)
            return [];
        found = active.filter((r) => {
            const words = fold(r.fullName).split(/\s+/);
            return parts.every((p) => words.some((w) => w.startsWith(p)));
        });
    }
    return found.slice(0, 8).map((r) => toRow(r, decisions));
}
function toRow(reg, decisions) {
    const d = latestDecision(decisions, reg.id);
    return { id: reg.id, fullName: reg.fullName, tableNumber: reg.tableNumber ?? null, mark: d && isTableMark(d.value) ? d.value : null };
}
function isTableMark(v) {
    return exports.TABLE_MARKS.includes(v);
}
function latestDecision(decisions, regId) {
    let best = null;
    for (const d of decisions)
        if (d.registrationId === regId && (!best || d.recordedAt >= best.recordedAt))
            best = d;
    return best;
}
/**
 * Marca una decisión desde la mesa. Efectos en el mismo paso: la persona queda
 * en esta mesa (y con su encargado después), con asistencia «Asistió» porque
 * está presente, y con la autorización de seguimiento confirmada en la mesa.
 */
function markAtTable(state, input) {
    const link = linkUsable(input.table, input.eventDate, input.now);
    if (!link.ok)
        return link;
    if (!input.personAgreed)
        return { ok: false, error: "sin_permiso_persona" };
    const idx = state.registrations.findIndex((r) => r.id === input.registrationId);
    if (idx < 0)
        return { ok: false, error: "no_encontrada" };
    const reg = state.registrations[idx];
    if (reg.status !== "activa")
        return { ok: false, error: "inscripcion_inactiva" };
    if (reg.doNotContact)
        return { ok: false, error: "pidio_no_contacto" };
    const here = input.table.number;
    if (reg.tableNumber != null && reg.tableNumber !== here && !input.moveHere)
        return { ok: false, error: "otra_mesa", otherTable: reg.tableNumber };
    const current = latestDecision(state.decisions, reg.id);
    if (current?.value === input.mark && reg.tableNumber === here)
        return { ok: false, error: "sin_cambio" };
    const by = `mesa-${here}`;
    const consents = reg.consents.some((c) => c.purpose === "seguimiento_evento" && c.revokedAt === null)
        ? reg.consents
        : [...reg.consents, { purpose: "seguimiento_evento", grantedAt: input.now, source: "verbal_mesa", textVersion: exports.TABLE_CONSENT_VERSION, revokedAt: null }];
    const next = {
        ...reg,
        tableNumber: here,
        consents,
        ...(reg.attendance !== "asistio" ? { attendance: "asistio", attendanceAt: input.now, attendanceBy: by } : {}),
        revision: reg.revision + 1,
    };
    const decision = {
        registrationId: reg.id,
        editionId: reg.editionId,
        value: input.mark,
        declaredBy: "la_persona",
        consentTextVersion: exports.TABLE_CONSENT_VERSION,
        recordedAt: input.now,
        recordedBy: by,
        tableNumber: here,
    };
    const registrations = [...state.registrations];
    registrations[idx] = next;
    return { ok: true, value: { registrations, decisions: [...state.decisions, decision] } };
}
/** Deshacer: solo la mesa que marcó y dentro de la ventana. La historia queda en el backend. */
function unmarkAtTable(state, input) {
    const link = linkUsable(input.table, input.eventDate, input.now);
    if (!link.ok)
        return link;
    const current = latestDecision(state.decisions, input.registrationId);
    if (!current)
        return { ok: false, error: "sin_cambio" };
    if (current.tableNumber !== input.table.number)
        return { ok: false, error: "no_es_de_esta_mesa" };
    return { ok: true, value: { ...state, decisions: state.decisions.filter((d) => d.registrationId !== input.registrationId) } };
}
/**
 * Llegó sin inscripción y está en la mesa: se agrega con nombre y teléfono,
 * presente y en esta mesa. Idempotente por requestId. Los posibles duplicados
 * se informan para que coordinación los revise; nunca se fusionan.
 */
function addAtTable(regs, input) {
    const link = linkUsable(input.table, input.eventDate, input.now);
    if (!link.ok)
        return link;
    const name = input.fullName.trim().replace(/\s+/g, " ");
    if (name.length < 2)
        return { ok: false, error: "nombre_requerido" };
    const phone = (0, members_1.normalizePhone)(input.phone);
    if (!phone.ok)
        return { ok: false, error: "telefono_invalido" };
    const id = `${input.editionId}_mesa_${input.requestId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;
    const existing = regs.find((r) => r.id === id);
    if (existing)
        return { ok: true, value: [...regs], created: existing, possibleDuplicates: [] };
    const by = `mesa-${input.table.number}`;
    const created = {
        id,
        editionId: input.editionId,
        identityId: null,
        source: "mesa",
        externalRef: null,
        fullName: name,
        phoneE164: phone.e164,
        email: null,
        invitedByName: null,
        status: "activa",
        duplicateOf: null,
        attendance: "asistio",
        attendanceAt: input.now,
        attendanceBy: by,
        consents: [{ purpose: "seguimiento_evento", grantedAt: input.now, source: "verbal_mesa", textVersion: exports.TABLE_CONSENT_VERSION, revokedAt: null }],
        doNotContact: false,
        ownerUid: null,
        assignmentBatchId: null,
        locallyEdited: [],
        followUp: { ...outreach_model_1.EMPTY_FOLLOW_UP },
        memberPersonId: null,
        handedOffAt: null,
        tableNumber: input.table.number,
        ticketCode: null,
        createdAt: input.now,
        revision: 1,
    };
    const possibleDuplicates = regs.filter((r) => r.status === "activa" && r.phoneE164 === phone.e164).map((r) => r.id);
    return { ok: true, value: [...regs, created], created, possibleDuplicates };
}
/** Vínculo para la distribución: cada persona con el encargado de su mesa. */
function tableAffinity(regs, tables) {
    const leader = new Map(tables.filter((t) => t.leaderUid).map((t) => [t.number, t.leaderUid]));
    const out = {};
    for (const r of regs) {
        const uid = r.tableNumber != null ? leader.get(r.tableNumber) : undefined;
        if (uid && r.status === "activa")
            out[r.id] = uid;
    }
    return out;
}
/** Conteos por mesa (sin nombres): para coordinación esa noche y al día siguiente. */
function tableSummaries(regs, decisions, tables) {
    return tables.map((t) => {
        const mine = regs.filter((r) => r.status === "activa" && r.tableNumber === t.number);
        let accepted = 0;
        let wantsToTalk = 0;
        for (const r of mine) {
            const d = latestDecision(decisions, r.id);
            if (d?.value === "acepto_a_cristo")
                accepted++;
            else if (d?.value === "desea_conversar")
                wantsToTalk++;
        }
        return { number: t.number, leaderName: t.leaderName, people: mine.length, accepted, wantsToTalk };
    });
}
