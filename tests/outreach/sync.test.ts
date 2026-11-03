import { describe, expect, it } from "vitest";
import { applyInbound } from "@/lib/outreach/sync";
import { NOW, freshState, inbound, inboundFromSim } from "./helpers";

const ctx = { now: NOW };

describe("applyInbound · idempotencia", () => {
  it("300 registros aplicados dos veces dan 300 inscripciones y la segunda corrida no cambia nada", () => {
    const batch = inboundFromSim();
    const first = applyInbound(freshState(), batch, ctx);
    expect(first.interrupted).toBe(false);
    expect(first.state.registrations).toHaveLength(300);
    expect(first.report).toMatchObject({ created: 300, updated: 0, unchanged: 0, toReview: 0, cursor: 300 });

    const second = applyInbound(first.state, batch, ctx);
    expect(second.state.registrations).toHaveLength(300);
    expect(second.report).toMatchObject({ created: 0, updated: 0, cancelled: 0, unchanged: 300, stale: 0, toReview: 0 });
    expect(second.state.registrations).toEqual(first.state.registrations);
    expect(new Set(second.state.registrations.map((r) => r.id)).size).toBe(300);
  });

  it("las inscripciones nuevas nacen sin asistencia, sin dueño y sin vínculo a Consolidación", () => {
    const { state } = applyInbound(freshState(), inboundFromSim(10), ctx);
    for (const r of state.registrations) {
      expect(r).toMatchObject({ source: "web", status: "activa", attendance: "sin_confirmar", ownerUid: null, memberPersonId: null, doNotContact: false, revision: 1 });
    }
  });

  it("no muta el estado de entrada", () => {
    const prev = freshState();
    applyInbound(prev, inboundFromSim(5), ctx);
    expect(prev.registrations).toHaveLength(0);
    expect(prev.cursor).toBe(0);
  });
});

describe("applyInbound · interrupción y reanudación", () => {
  it("cortado tras N y reanudado con el estado devuelto queda en exactamente 300 sin duplicados", () => {
    const batch = inboundFromSim();
    const cut = applyInbound(freshState(), batch, { ...ctx, failAfter: 120 });
    expect(cut.interrupted).toBe(true);
    expect(cut.state.registrations).toHaveLength(120);
    expect(cut.state.cursor).toBe(120);
    expect(cut.report.cursor).toBe(120);

    const resumed = applyInbound(cut.state, batch, ctx);
    expect(resumed.interrupted).toBe(false);
    expect(resumed.state.registrations).toHaveLength(300);
    expect(new Set(resumed.state.registrations.map((r) => r.id)).size).toBe(300);
    expect(resumed.report).toMatchObject({ created: 180, unchanged: 120 });
    expect(resumed.state.cursor).toBe(300);
    expect(resumed.state.cursor).toBeGreaterThanOrEqual(cut.state.cursor);
  });

  it("varios cortes sucesivos nunca retroceden el cursor ni pierden registros", () => {
    const batch = inboundFromSim();
    let state = freshState();
    let last = 0;
    for (const n of [50, 10, 99, 200]) {
      const step = applyInbound(state, batch, { ...ctx, failAfter: n });
      expect(step.state.cursor).toBeGreaterThanOrEqual(last);
      last = step.state.cursor;
      state = step.state;
    }
    const done = applyInbound(state, batch, ctx);
    expect(done.state.registrations).toHaveLength(300);
    expect(done.state.cursor).toBe(300);
  });

  it("el lote desordenado se procesa por sourceRevision", () => {
    const batch = inboundFromSim(20).reverse();
    const cut = applyInbound(freshState(), batch, { ...ctx, failAfter: 5 });
    expect(cut.state.cursor).toBe(5);
    expect(cut.state.registrations.map((r) => r.externalRef!.id)).toEqual(["sim001", "sim002", "sim003", "sim004", "sim005"]);
  });
});

describe("applyInbound · versiones", () => {
  it("una revisión menor que la ya procesada se ignora como obsoleta", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 5, fullName: "Nombre Nuevo" })], ctx);
    const b = applyInbound(a.state, [inbound({ sourceRevision: 3, fullName: "Nombre Viejo" })], ctx);
    expect(b.report.stale).toBe(1);
    expect(b.state.registrations[0].fullName).toBe("Nombre Nuevo");
    expect(b.state.cursor).toBe(5);
  });

  it("una revisión mayor actualiza los campos públicos y sube la revisión", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 1 })], ctx);
    const b = applyInbound(a.state, [inbound({ sourceRevision: 2, fullName: "Persona Ficticia Uno Editada", invitedByName: "Invitante" })], ctx);
    expect(b.report).toMatchObject({ updated: 1, created: 0 });
    expect(b.state.registrations).toHaveLength(1);
    expect(b.state.registrations[0]).toMatchObject({ fullName: "Persona Ficticia Uno Editada", invitedByName: "Invitante", revision: 2 });
  });
});

describe("applyInbound · revisión manual sin bloquear al resto", () => {
  it("año de edición distinto va a revisión", () => {
    const { state, report } = applyInbound(freshState(), [inbound({ editionYear: 2025 }), inbound({ externalId: "x2", sourceRevision: 2 })], ctx);
    expect(state.registrations).toHaveLength(1);
    expect(state.review).toMatchObject([{ externalId: "x1", issue: "edicion_no_coincide", registrationId: null }]);
    expect(report.toReview).toBe(1);
    expect(state.cursor).toBe(2);
  });

  it("edición cerrada no recibe inscripciones nuevas", () => {
    const { state } = applyInbound({ ...freshState(), editionClosed: true }, [inbound()], ctx);
    expect(state.registrations).toHaveLength(0);
    expect(state.review[0].issue).toBe("edicion_cerrada");
  });

  it("teléfono inválido, nombre vacío y correo inválido van a revisión y el resto sigue", () => {
    const batch = [
      inbound({ externalId: "a", sourceRevision: 1, phone: "123" }),
      inbound({ externalId: "b", sourceRevision: 2, fullName: "   ", phone: "+56900000002" }),
      inbound({ externalId: "d", sourceRevision: 4, email: "no-es-correo", phone: "+56900000004" }),
      inbound({ externalId: "ok", sourceRevision: 5, fullName: "Beatriz Lagos Rojas", phone: "+56900000005" }),
    ];
    const { state, report } = applyInbound(freshState(), batch, ctx);
    expect(Object.fromEntries(state.review.map((r) => [r.externalId, r.issue]))).toEqual({
      a: "telefono_invalido",
      b: "nombre_requerido",
      d: "correo_invalido",
    });
    expect(state.registrations.map((r) => r.externalRef!.id)).toEqual(["ok"]);
    expect(report).toMatchObject({ created: 1, toReview: 3, cursor: 5 });
  });

  it("un menor se omite sin guardar nada (ni en revisión), avanza el cursor y se cuenta", () => {
    const batch = [
      inbound({ externalId: "m", sourceRevision: 1, adultConfirmed: false, fullName: "Menor Ficticio", phone: "+56900000009" }),
      inbound({ externalId: "ok", sourceRevision: 2, fullName: "Beatriz Lagos Rojas", phone: "+56900000005" }),
    ];
    const a = applyInbound(freshState(), batch, ctx);
    expect(a.report).toMatchObject({ created: 1, skippedMinors: 1, toReview: 0, cursor: 2 });
    expect(a.state.review).toHaveLength(0);
    expect(a.state.registrations.map((r) => r.externalRef!.id)).toEqual(["ok"]);
    expect(JSON.stringify(a.state)).not.toContain("Menor Ficticio");
    expect(a.state.seen.m).toBe(1);
    const b = applyInbound(a.state, batch, ctx);
    expect(b.report).toMatchObject({ skippedMinors: 0, unchanged: 2 });
  });

  it("repetir el lote no duplica los elementos de revisión", () => {
    const batch = [inbound({ phone: "123" })];
    const a = applyInbound(freshState(), batch, ctx);
    const b = applyInbound(a.state, batch, ctx);
    expect(b.state.review).toHaveLength(1);
  });

  it("un posible duplicado se crea Y se marca para revisión; nunca se fusiona", () => {
    const batch = [
      inbound({ externalId: "a", sourceRevision: 1, fullName: "Ana Araya Bravo", phone: "+56900000007" }),
      inbound({ externalId: "b", sourceRevision: 2, fullName: "Ana Araya", phone: "+56900000007" }),
    ];
    const { state } = applyInbound(freshState(), batch, ctx);
    expect(state.registrations).toHaveLength(2);
    expect(state.registrations.every((r) => r.status === "activa" && r.duplicateOf === null)).toBe(true);
    expect(state.review).toHaveLength(1);
    expect(state.review[0]).toMatchObject({ issue: "posible_duplicado", externalId: "b" });
    expect(state.review[0].candidates).toEqual([state.registrations[0].id]);
  });

  it("mismo teléfono con nombre distinto no se marca como duplicado", () => {
    const batch = [
      inbound({ externalId: "a", sourceRevision: 1, fullName: "Ana Araya", phone: "+56900000007" }),
      inbound({ externalId: "b", sourceRevision: 2, fullName: "Pedro Quiroga", phone: "+56900000007" }),
    ];
    expect(applyInbound(freshState(), batch, ctx).state.review).toHaveLength(0);
  });
});

describe("applyInbound · ediciones locales, cancelaciones y consentimiento", () => {
  it("lo editado en CDS no se sobreescribe: conflicto_edicion_local", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 1 })], ctx);
    const edited = { ...a.state, registrations: a.state.registrations.map((r) => ({ ...r, fullName: "Nombre Corregido en CDS", locallyEdited: ["fullName"] })) };
    const b = applyInbound(edited, [inbound({ sourceRevision: 2, fullName: "Otro Nombre Web", invitedByName: "Invitante Web" })], ctx);
    expect(b.state.registrations[0].fullName).toBe("Nombre Corregido en CDS");
    // Los campos no editados en CDS sí se actualizan.
    expect(b.state.registrations[0].invitedByName).toBe("Invitante Web");
    expect(b.state.review).toMatchObject([{ issue: "conflicto_edicion_local", externalId: "x1" }]);
  });

  it("una cancelación deja la inscripción «cancelada» sin borrarla", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 1 })], ctx);
    const b = applyInbound(a.state, [inbound({ sourceRevision: 2, cancelled: true })], ctx);
    expect(b.report.cancelled).toBe(1);
    expect(b.state.registrations).toHaveLength(1);
    expect(b.state.registrations[0]).toMatchObject({ status: "cancelada", revision: 2 });
  });

  it("cancelación de quien ya asistió va a revisión y la inscripción sigue activa", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 1 })], ctx);
    const attended = { ...a.state, registrations: a.state.registrations.map((r) => ({ ...r, attendance: "asistio" as const })) };
    const b = applyInbound(attended, [inbound({ sourceRevision: 2, cancelled: true })], ctx);
    expect(b.state.registrations[0].status).toBe("activa");
    expect(b.state.review).toMatchObject([{ issue: "cancelada_con_asistencia" }]);
    expect(b.report.cancelled).toBe(0);
  });

  it("cancelar algo desconocido no crea nada", () => {
    const { state, report } = applyInbound(freshState(), [inbound({ cancelled: true })], ctx);
    expect(state.registrations).toHaveLength(0);
    expect(report.unchanged).toBe(1);
  });

  it("una revocación hecha en CDS no la revierte la web", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 1 })], ctx);
    const revoked = {
      ...a.state,
      registrations: a.state.registrations.map((r) => ({ ...r, consents: r.consents.map((c) => ({ ...c, revokedAt: "2026-11-30T10:00" })) })),
    };
    const b = applyInbound(revoked, [inbound({ sourceRevision: 2, invitedByName: "Cambio" })], ctx);
    expect(b.state.registrations[0].consents).toHaveLength(1);
    expect(b.state.registrations[0].consents[0].revokedAt).toBe("2026-11-30T10:00");
  });

  it("una autorización nueva del formulario se agrega sin tocar las existentes", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 1 })], ctx);
    const b = applyInbound(
      a.state,
      [inbound({ sourceRevision: 2, consents: [
        { purpose: "seguimiento_evento", textVersion: "web-2026-1", grantedAt: "2026-11-10T19:00" },
        { purpose: "mensajes_whatsapp", textVersion: "web-2026-1", grantedAt: "2026-11-11T19:00" },
      ] })],
      ctx,
    );
    expect(b.state.registrations[0].consents.map((c) => c.purpose).sort()).toEqual(["mensajes_whatsapp", "seguimiento_evento"]);
  });
});

describe("applyInbound · check-in en la puerta del origen", () => {
  it("attendedAt marca «asistió» con autor vplt-web y cuenta como actualización", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 1 })], ctx);
    const b = applyInbound(a.state, [inbound({ sourceRevision: 2, attendedAt: "2026-11-29T19:35" })], ctx);
    expect(b.report.updated).toBe(1);
    expect(b.state.registrations[0]).toMatchObject({ attendance: "asistio", attendanceAt: "2026-11-29T19:35", attendanceBy: "vplt-web", revision: 2 });
  });

  it("una inscripción nueva con attendedAt nace asistida", () => {
    const { state } = applyInbound(freshState(), [inbound({ attendedAt: "2026-11-29T19:35" })], ctx);
    expect(state.registrations[0]).toMatchObject({ attendance: "asistio", attendanceBy: "vplt-web" });
  });

  it("no pisa una asistencia ya marcada en CDS", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 1 })], ctx);
    const marked = { ...a.state, registrations: a.state.registrations.map((r) => ({ ...r, attendance: "asistio" as const, attendanceAt: "2026-11-29T19:10", attendanceBy: "recep-1" })) };
    const b = applyInbound(marked, [inbound({ sourceRevision: 2, attendedAt: "2026-11-29T19:35" })], ctx);
    expect(b.state.registrations[0]).toMatchObject({ attendanceAt: "2026-11-29T19:10", attendanceBy: "recep-1" });
  });

  it("nunca marca «no asistió» desde la web, ni siquiera si CDS ya lo confirmó", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 1 })], ctx);
    expect(a.state.registrations[0].attendance).toBe("sin_confirmar");
    const absent = { ...a.state, registrations: a.state.registrations.map((r) => ({ ...r, attendance: "no_asistio" as const })) };
    const b = applyInbound(absent, [inbound({ sourceRevision: 2, attendedAt: "2026-11-29T19:35" })], ctx);
    expect(b.state.registrations[0].attendance).toBe("no_asistio");
  });

  it("deshacer el check-in en el origen no revierte CDS: va a revisión", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 1, attendedAt: "2026-11-29T19:35" })], ctx);
    const b = applyInbound(a.state, [inbound({ sourceRevision: 2, attendedAt: null })], ctx);
    expect(b.state.registrations[0].attendance).toBe("asistio");
    expect(b.state.review).toMatchObject([{ issue: "asistencia_revertida_en_origen", externalId: "x1" }]);
  });

  it("si la asistencia la marcó CDS, la ausencia de attendedAt en la web es normal", () => {
    const a = applyInbound(freshState(), [inbound({ sourceRevision: 1 })], ctx);
    const marked = { ...a.state, registrations: a.state.registrations.map((r) => ({ ...r, attendance: "asistio" as const, attendanceBy: "recep-1" })) };
    const b = applyInbound(marked, [inbound({ sourceRevision: 2, invitedByName: "Otro" })], ctx);
    expect(b.state.review).toHaveLength(0);
  });
});
