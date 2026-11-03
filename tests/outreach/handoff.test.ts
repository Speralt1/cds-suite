import { describe, expect, it } from "vitest";
import { planHandoff, type HandoffInput } from "@/lib/outreach/handoff";
import { consent, edition, reg } from "./helpers";

const actor = { uid: "sim-coord", canCoordinate: true, canManageConsolidation: true };
const input = (over: Partial<HandoffInput> = {}): HandoffInput => ({
  reg: reg({ attendance: "asistio", email: "p@example.test", invitedByName: "Invitante Ficticio", ownerUid: "sim-resp-01" }),
  edition: edition({ calendarEventId: "cal-evento-1" }),
  actor,
  reason: "Quiere acompañamiento habitual",
  requestId: "req-1",
  ...over,
});

describe("planHandoff · reglas", () => {
  it("traspasa a quien asistió y autorizó el traspaso", () => {
    const res = planHandoff(input());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.kind).toBe("crear");
  });

  it("exige coordinación Y consolidation.manage", () => {
    expect(planHandoff(input({ actor: { ...actor, canCoordinate: false } }))).toEqual({ ok: false, error: "sin_permiso" });
    expect(planHandoff(input({ actor: { ...actor, canManageConsolidation: false } }))).toEqual({ ok: false, error: "sin_permiso" });
  });

  it("solo traspasa a quien asistió (ni sin confirmar ni ausente)", () => {
    expect(planHandoff(input({ reg: reg({ attendance: "sin_confirmar" }) }))).toEqual({ ok: false, error: "no_asistio" });
    expect(planHandoff(input({ reg: reg({ attendance: "no_asistio" }) }))).toEqual({ ok: false, error: "no_asistio" });
  });

  it("exige la autorización específica de traspaso, aunque tenga las demás", () => {
    const r = reg({ attendance: "asistio", consents: [consent("seguimiento_evento"), consent("mensajes_whatsapp")] });
    expect(planHandoff(input({ reg: r }))).toEqual({ ok: false, error: "sin_autorizacion" });
    const revoked = reg({ attendance: "asistio", consents: [consent("traspaso_consolidacion", "2026-12-01T10:00")] });
    expect(planHandoff(input({ reg: revoked }))).toEqual({ ok: false, error: "sin_autorizacion" });
  });

  it("rechaza bajas, ya traspasadas, edición cerrada, sin fecha, sin motivo y sin teléfono", () => {
    expect(planHandoff(input({ reg: reg({ attendance: "asistio", doNotContact: true }) }))).toEqual({ ok: false, error: "baja" });
    expect(planHandoff(input({ reg: reg({ attendance: "asistio", handedOffAt: "2026-12-01T10:00" }) }))).toEqual({ ok: false, error: "ya_traspasada" });
    expect(planHandoff(input({ reg: reg({ attendance: "asistio", memberPersonId: "p1" }) }))).toEqual({ ok: false, error: "ya_traspasada" });
    expect(planHandoff(input({ edition: edition({ status: "cerrada" }) }))).toEqual({ ok: false, error: "edicion_cerrada" });
    expect(planHandoff(input({ edition: edition({ eventDate: null }) }))).toEqual({ ok: false, error: "edicion_sin_fecha" });
    expect(planHandoff(input({ reason: "  " }))).toEqual({ ok: false, error: "motivo_requerido" });
    expect(planHandoff(input({ reg: reg({ attendance: "asistio", phoneE164: null }) }))).toEqual({ ok: false, error: "telefono_requerido" });
  });
});

describe("planHandoff · resultado", () => {
  it("la clave de idempotencia es estable por inscripción", () => {
    const a = planHandoff(input({ requestId: "req-1" }));
    const b = planHandoff(input({ requestId: "req-2", reason: "Otro motivo" }));
    if (!a.ok || !b.ok) throw new Error("debían planificarse");
    expect(a.value.idempotencyKey).toBe("handoff_vplt-2026_web_t1");
    expect(b.value.idempotencyKey).toBe(a.value.idempotencyKey);
    const other = planHandoff(input({ reg: reg({ id: "otra", attendance: "asistio" }) }));
    expect(other.ok && other.value.idempotencyKey).not.toBe(a.value.idempotencyKey);
  });

  it("vincular a una ficha existente no pide teléfono y usa la misma clave", () => {
    const res = planHandoff(input({ reg: reg({ attendance: "asistio", phoneE164: null }), linkToPersonId: "persona-9" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toMatchObject({ kind: "vincular", personId: "persona-9", registrationId: "vplt-2026_web_t1", idempotencyKey: "handoff_vplt-2026_web_t1" });
  });

  it("la solicitud usa la fecha del evento como primera visita y origen evangelismo", () => {
    const res = planHandoff(input());
    if (!res.ok || res.value.kind !== "crear") throw new Error("debía crear");
    expect(res.value.request).toMatchObject({
      requestId: "req-1",
      fullName: "Persona Ficticia Uno",
      phone: "+56900000001",
      email: "p@example.test",
      firstVisitDate: "2026-11-28",
      calendarEventId: "cal-evento-1",
      arrivalSource: "evangelismo",
      invitedBy: "Invitante Ficticio",
    });
  });

  it("no traspasa responsable, nota, decisión ni contactos del evento", () => {
    const withHistory = reg({
      attendance: "asistio",
      ownerUid: "sim-resp-01",
      followUp: { lastContactAt: "2026-11-30", lastResult: "contactado", attempts: 2, nextAction: "Llamar", nextActionDate: "2026-12-06" },
    });
    const res = planHandoff(input({ reg: withHistory }));
    if (!res.ok || res.value.kind !== "crear") throw new Error("debía crear");
    expect(res.value.request.followUpOwnerUid).toBeNull();
    expect(res.value.request.visitNote).toBeNull();
    const json = JSON.stringify(res.value.request).toLowerCase();
    for (const forbidden of ["decision", "decisión", "contact", "attempts", "nextaction", "sim-resp-01"]) {
      expect(json).not.toContain(forbidden);
    }
    expect(Object.keys(res.value.request)).not.toContain("decision");
  });
});
