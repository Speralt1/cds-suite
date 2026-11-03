// GENERADO por scripts/build-shared.mjs desde lib/shared/outreach-metrics.ts — NO EDITAR.
"use strict";
// Métricas de una edición con denominadores explícitos (doc 38 §7). Las
// decisiones NO están aquí: se agregan aparte y solo con permiso pastoral.
Object.defineProperty(exports, "__esModule", { value: true });
exports.editionMetrics = editionMetrics;
exports.decisionSummary = decisionSummary;
const outreach_model_1 = require("./outreach-model");
function editionMetrics(regs, today, eventDate) {
    const active = regs.filter((r) => r.status === "activa");
    const m = {
        registered: active.length,
        attended: 0,
        absentConfirmed: 0,
        attendancePending: 0,
        walkIns: 0,
        contactable: 0,
        assigned: 0,
        unassignedContactable: 0,
        firstContactPending: 0,
        overdue: 0,
        optedOut: 0,
        handedOff: 0,
        loadByOwner: {},
    };
    for (const r of active) {
        if (r.attendance === "asistio")
            m.attended++;
        else if (r.attendance === "no_asistio")
            m.absentConfirmed++;
        else
            m.attendancePending++;
        if (r.source === "recepcion")
            m.walkIns++;
        if (r.doNotContact)
            m.optedOut++;
        if (r.handedOffAt)
            m.handedOff++;
        const contactable = !r.doNotContact && (0, outreach_model_1.hasConsent)(r, "seguimiento_evento");
        if (contactable)
            m.contactable++;
        if (r.ownerUid && !r.handedOffAt) {
            m.assigned++;
            if (!r.doNotContact)
                m.loadByOwner[r.ownerUid] = (m.loadByOwner[r.ownerUid] ?? 0) + 1;
            const bucket = (0, outreach_model_1.queueBucket)(r, today, eventDate);
            if (bucket === "primer_contacto")
                m.firstContactPending++;
            if (bucket === "vencido")
                m.overdue++;
        }
        else if (contactable && !r.handedOffAt && r.attendance === "asistio")
            m.unassignedContactable++;
    }
    return m;
}
/**
 * Agregado pastoral: «No registrada» se cuenta aparte y NUNCA se suma a una
 * decisión. Solo conteos; no devuelve nombres.
 */
function decisionSummary(regs, decisions) {
    const active = new Set(regs.filter((r) => r.status === "activa").map((r) => r.id));
    const out = { no_registrada: 0, acepto_a_cristo: 0, desea_conversar: 0, no_por_ahora: 0 };
    // Por inscripción vale la decisión más reciente (recordedAt), sin depender del orden de entrada.
    const latest = new Map();
    for (const d of decisions) {
        if (!active.has(d.registrationId))
            continue;
        const prev = latest.get(d.registrationId);
        if (!prev || d.recordedAt > prev.recordedAt)
            latest.set(d.registrationId, d);
    }
    for (const d of latest.values())
        out[d.value]++;
    const withDecision = latest;
    out.no_registrada = active.size - withDecision.size;
    return out;
}
