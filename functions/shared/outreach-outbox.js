// GENERADO por scripts/build-shared.mjs desde lib/shared/outreach-outbox.ts — NO EDITAR.
"use strict";
// Bandeja de salida hacia el motor de mensajería (doc 40 §8). Independiente de
// la sincronización de inscripciones: si una se pausa, la otra sigue.
//
// - CDS decide QUÉ y A QUIÉN; el motor solo transporta. El payload es mínimo y
//   cerrado: nombre de pila, teléfono E.164, propósito y plantilla aprobada.
//   Nunca decisiones, notas, historial pastoral ni datos financieros.
// - Clave de idempotencia estable por edición/inscripción/propósito/plantilla:
//   planificar dos veces no duplica.
// - «enviado_al_motor» no significa entregado. «incierto» nunca se reintenta
//   solo: lo revisa una persona.
// - Una baja o revocación cancela lo que siga pendiente antes del despacho.
// - Transporte simulado en pruebas; ningún envío real sin aprobación (doc 41).
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulatedTransport = exports.PAYLOAD_KEYS = exports.OUTBOX_STATUS_LABEL = exports.OUTBOX_STATUSES = void 0;
exports.outboxKey = outboxKey;
exports.planMessages = planMessages;
exports.cancelForRegistration = cancelForRegistration;
exports.dispatch = dispatch;
const outreach_model_1 = require("./outreach-model");
exports.OUTBOX_STATUSES = ["pendiente", "enviado_al_motor", "fallido", "incierto", "cancelado", "omitido"];
exports.OUTBOX_STATUS_LABEL = {
    pendiente: "Pendiente",
    enviado_al_motor: "Entregado al motor (no confirma recepción)",
    fallido: "Falló",
    incierto: "Resultado incierto · revisar",
    cancelado: "Cancelado",
    omitido: "Omitido",
};
exports.PAYLOAD_KEYS = ["idempotencyKey", "toE164", "firstName", "templateId", "purpose"];
function outboxKey(editionId, registrationId, templateId) {
    return `${editionId}:${registrationId}:${templateId}`;
}
function firstName(full) {
    return full.trim().split(/\s+/)[0] ?? "";
}
/** Planifica mensajes para un grupo de inscripciones; idempotente por clave. */
function planMessages(existing, regs, template) {
    const keys = new Set(existing.map((i) => i.key));
    const items = [...existing];
    const skipped = [];
    for (const reg of regs) {
        const key = outboxKey(reg.editionId, reg.id, template.id);
        if (keys.has(key))
            skipped.push({ registrationId: reg.id, reason: "ya_planificado" });
        else if (reg.status !== "activa")
            skipped.push({ registrationId: reg.id, reason: "no_activa" });
        else if (reg.doNotContact)
            skipped.push({ registrationId: reg.id, reason: "baja" });
        else if (!(0, outreach_model_1.hasConsent)(reg, "mensajes_whatsapp"))
            skipped.push({ registrationId: reg.id, reason: "sin_autorizacion_whatsapp" });
        // Un mensaje de seguimiento exige además la autorización de seguimiento del evento.
        else if (template.purpose === "seguimiento_evento" && !(0, outreach_model_1.hasConsent)(reg, "seguimiento_evento"))
            skipped.push({ registrationId: reg.id, reason: "sin_autorizacion_seguimiento" });
        else if (!reg.phoneE164)
            skipped.push({ registrationId: reg.id, reason: "sin_telefono" });
        else {
            keys.add(key);
            items.push({
                key,
                registrationId: reg.id,
                editionId: reg.editionId,
                payload: { idempotencyKey: key, toE164: reg.phoneE164, firstName: firstName(reg.fullName), templateId: template.id, purpose: template.purpose },
                status: "pendiente",
                attempts: 0,
                lastError: null,
            });
        }
    }
    return { items, skipped };
}
/** Baja o revocación: cancela todo lo pendiente de esa inscripción. */
function cancelForRegistration(items, registrationId) {
    return items.map((i) => (i.registrationId === registrationId && (i.status === "pendiente" || i.status === "fallido") ? { ...i, status: "cancelado" } : i));
}
/**
 * Despacha pendientes (y fallidos reintentables). Nunca toca «incierto»,
 * «enviado_al_motor» ni «cancelado». Verifica que el payload no tenga campos extra.
 */
async function dispatch(items, transport, opts) {
    if (!opts.enabled)
        return [...items];
    let budget = opts.maxPerRun;
    const out = [];
    for (const item of items) {
        const retryable = item.status === "pendiente" || (item.status === "fallido" && item.attempts < opts.maxAttempts);
        if (!retryable || budget <= 0) {
            out.push(item);
            continue;
        }
        if (!opts.stillAllowed(item.registrationId)) {
            out.push({ ...item, status: "cancelado" });
            continue;
        }
        const extra = Object.keys(item.payload).filter((k) => !exports.PAYLOAD_KEYS.includes(k));
        if (extra.length) {
            out.push({ ...item, status: "omitido", lastError: `campos no permitidos: ${extra.join(", ")}` });
            continue;
        }
        budget--;
        let res;
        try {
            res = await transport.send(item.payload);
        }
        catch {
            res = { kind: "sin_respuesta" };
        }
        const attempts = item.attempts + 1;
        if (res.kind === "aceptado")
            out.push({ ...item, status: "enviado_al_motor", attempts, lastError: null });
        else if (res.kind === "rechazado")
            out.push({ ...item, status: "fallido", attempts, lastError: res.error });
        else
            out.push({ ...item, status: "incierto", attempts, lastError: "sin respuesta del motor" });
    }
    return out;
}
/** Transporte falso para pruebas y ensayos: registra lo que habría salido. */
class SimulatedTransport {
    behavior;
    sent = [];
    seen = new Set();
    constructor(behavior = () => ({ kind: "aceptado" })) {
        this.behavior = behavior;
    }
    async send(payload) {
        const res = this.behavior(payload, this.sent.length);
        // El motor deduplica por clave: un reenvío con la misma clave no genera otro mensaje.
        if (res.kind === "aceptado" && !this.seen.has(payload.idempotencyKey)) {
            this.seen.add(payload.idempotencyKey);
            this.sent.push(payload);
        }
        return res;
    }
}
exports.SimulatedTransport = SimulatedTransport;
