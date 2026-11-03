import { describe, expect, it } from "vitest";
import {
  PAYLOAD_KEYS,
  SimulatedTransport,
  cancelForRegistration,
  dispatch,
  outboxKey,
  planMessages,
  type ApprovedTemplate,
  type DispatchOptions,
  type OutboxItem,
} from "@/lib/outreach/outbox";
import { simRegistrations } from "@/lib/outreach/sim/fixtures";
import { consent, reg } from "./helpers";

const template: ApprovedTemplate = { id: "bienvenida-v1", purpose: "bienvenida_evento", approvedBy: "admin", approvedAt: "2026-11-01T10:00" };
const open: DispatchOptions = { enabled: true, maxPerRun: 1000, maxAttempts: 3, stillAllowed: () => true };
const plan = (regs = [reg()], existing: OutboxItem[] = []) => planMessages(existing, regs, template);

describe("planMessages", () => {
  it("es idempotente: planificar dos veces no duplica", () => {
    const regs = simRegistrations();
    const first = planMessages([], regs, template);
    const second = planMessages(first.items, regs, template);
    expect(second.items).toHaveLength(first.items.length);
    expect(new Set(first.items.map((i) => i.key)).size).toBe(first.items.length);
    expect(second.skipped.filter((s) => s.reason === "ya_planificado")).toHaveLength(first.items.length);
  });

  it("omite sin autorización de WhatsApp, baja, sin teléfono y canceladas", () => {
    const regs = [
      reg({ id: "ok" }),
      reg({ id: "sin-consent", consents: [consent("seguimiento_evento")] }),
      reg({ id: "revocado", consents: [consent("mensajes_whatsapp", "2026-11-12T10:00")] }),
      reg({ id: "baja", doNotContact: true }),
      reg({ id: "sin-tel", phoneE164: null }),
      reg({ id: "cancelada", status: "cancelada" }),
    ];
    const { items, skipped } = plan(regs);
    expect(items.map((i) => i.registrationId)).toEqual(["ok"]);
    expect(Object.fromEntries(skipped.map((s) => [s.registrationId, s.reason]))).toEqual({
      "sin-consent": "sin_autorizacion_whatsapp",
      revocado: "sin_autorizacion_whatsapp",
      baja: "baja",
      "sin-tel": "sin_telefono",
      cancelada: "no_activa",
    });
  });

  it("el payload tiene exactamente las claves permitidas y nada más", () => {
    const { items } = plan([reg({ id: "p1", fullName: "Gabriela Ficticia Soto", email: "x@example.test", invitedByName: "Otra Persona" })]);
    const p = items[0].payload;
    expect(Object.keys(p).sort()).toEqual([...PAYLOAD_KEYS].sort());
    expect(p).toMatchObject({ firstName: "Gabriela", toE164: "+56900000001", templateId: template.id, purpose: "bienvenida_evento" });
    expect(p.idempotencyKey).toBe(outboxKey("vplt-2026", "p1", template.id));
    expect(items[0].key).toBe(p.idempotencyKey);
  });

  it("el payload no contiene decisión, notas, correo, nombre completo ni montos", () => {
    const regs = simRegistrations({ count: 50 }).map((r) => ({ ...r, attendance: "asistio" as const }));
    const { items } = planMessages([], regs, template);
    const byId = new Map(regs.map((r) => [r.id, r]));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      const json = JSON.stringify(i.payload).toLowerCase();
      for (const forbidden of ["decision", "decisión", "note", "nota", "amount", "monto", "email", "correo", "fullname"]) {
        expect(json).not.toContain(forbidden);
      }
      const full = byId.get(i.registrationId)!.fullName;
      expect(JSON.stringify(i.payload)).not.toContain(full);
    }
  });
});

describe("cancelForRegistration", () => {
  it("cancela pendientes y fallidos de esa inscripción y deja el resto igual", () => {
    const { items } = plan([reg({ id: "a" }), reg({ id: "b" })]);
    const mixed: OutboxItem[] = [items[0], { ...items[0], key: "k2", status: "fallido" }, { ...items[0], key: "k3", status: "enviado_al_motor" }, { ...items[0], key: "k4", status: "incierto" }, items[1]];
    const out = cancelForRegistration(mixed, "a");
    expect(out.map((i) => i.status)).toEqual(["cancelado", "cancelado", "enviado_al_motor", "incierto", "pendiente"]);
  });
});

describe("dispatch", () => {
  const sendable = () => plan(simRegistrations({ count: 30 })).items;

  it("con el interruptor apagado no sale nada", async () => {
    const t = new SimulatedTransport();
    const items = sendable();
    const out = await dispatch(items, t, { ...open, enabled: false });
    expect(t.sent).toHaveLength(0);
    expect(out).toEqual(items);
    expect(out.every((i) => i.status === "pendiente")).toBe(true);
  });

  it("acepta, marca enviado_al_motor y suma el intento", async () => {
    const t = new SimulatedTransport();
    const items = sendable();
    const out = await dispatch(items, t, open);
    expect(out.every((i) => i.status === "enviado_al_motor" && i.attempts === 1)).toBe(true);
    expect(t.sent).toHaveLength(items.length);
    for (const p of t.sent) expect(Object.keys(p).sort()).toEqual([...PAYLOAD_KEYS].sort());
  });

  it("rechazado queda fallido y se reintenta hasta maxAttempts", async () => {
    const t = new SimulatedTransport(() => ({ kind: "rechazado", error: "motor caído" }));
    let items = plan().items;
    for (let run = 1; run <= 5; run++) {
      items = await dispatch(items, t, open);
      expect(items[0].status).toBe("fallido");
      expect(items[0].attempts).toBe(Math.min(run, 3));
      expect(items[0].lastError).toBe("motor caído");
    }
    expect(t.sent).toHaveLength(0);
  });

  it("un fallido se recupera si el motor responde en un reintento", async () => {
    let calls = 0;
    const t = new SimulatedTransport(() => (++calls === 1 ? { kind: "rechazado", error: "x" } : { kind: "aceptado" }));
    let items = await dispatch(plan().items, t, open);
    expect(items[0].status).toBe("fallido");
    items = await dispatch(items, t, open);
    expect(items[0]).toMatchObject({ status: "enviado_al_motor", attempts: 2, lastError: null });
  });

  it("sin_respuesta queda incierto y NUNCA se reintenta", async () => {
    let calls = 0;
    const t = new SimulatedTransport(() => {
      calls++;
      return { kind: "sin_respuesta" };
    });
    let items = await dispatch(plan().items, t, open);
    expect(items[0]).toMatchObject({ status: "incierto", attempts: 1 });
    for (let i = 0; i < 4; i++) items = await dispatch(items, t, open);
    expect(items[0]).toMatchObject({ status: "incierto", attempts: 1 });
    expect(calls).toBe(1);
  });

  it("una excepción del transporte se trata como incierto, no como fallo reintentable", async () => {
    const boom = { send: async () => { throw new Error("red"); } };
    const items = await dispatch(plan().items, boom, open);
    expect(items[0].status).toBe("incierto");
  });

  it("revalida justo antes de despachar: una baja reciente cancela el envío", async () => {
    const t = new SimulatedTransport();
    const regs = [reg({ id: "a" }), reg({ id: "b" })];
    const out = await dispatch(plan(regs).items, t, { ...open, stillAllowed: (id) => id !== "a" });
    expect(out.map((i) => i.status)).toEqual(["cancelado", "enviado_al_motor"]);
    expect(t.sent.map((p) => p.idempotencyKey)).toEqual([outboxKey("vplt-2026", "b", template.id)]);
  });

  it("respeta el presupuesto maxPerRun", async () => {
    const t = new SimulatedTransport();
    const items = sendable();
    const out = await dispatch(items, t, { ...open, maxPerRun: 7 });
    expect(out.filter((i) => i.status === "enviado_al_motor")).toHaveLength(7);
    expect(out.filter((i) => i.status === "pendiente")).toHaveLength(items.length - 7);
    expect(t.sent).toHaveLength(7);
  });

  it("no toca enviados, cancelados ni omitidos", async () => {
    const t = new SimulatedTransport();
    const base = plan().items[0];
    const items: OutboxItem[] = (["enviado_al_motor", "cancelado", "omitido"] as const).map((status, n) => ({ ...base, key: `k${n}`, status }));
    const out = await dispatch(items, t, open);
    expect(out).toEqual(items);
    expect(t.sent).toHaveLength(0);
  });

  it("un payload con campos extra se omite y no sale", async () => {
    const t = new SimulatedTransport();
    const item = plan().items[0];
    const dirty = { ...item, payload: { ...item.payload, decision: "acepto_a_cristo" } as unknown as OutboxItem["payload"] };
    const out = await dispatch([dirty], t, open);
    expect(out[0].status).toBe("omitido");
    expect(out[0].lastError).toContain("decision");
    expect(t.sent).toHaveLength(0);
  });

  it("reenviar la misma clave no duplica el mensaje en el transporte", async () => {
    const t = new SimulatedTransport();
    const item = plan().items[0];
    await dispatch([item], t, open);
    await dispatch([item], t, open);
    expect(t.sent).toHaveLength(1);
  });
});
