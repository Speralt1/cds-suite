// Ensayo general de punta a punta del dominio «Ve por los tuyos»: 300 inscripciones
// ficticias, recepción, distribución 15 × ≤20, seguimiento, bajas, mensajes
// simulados y traspaso. Sin red, sin Firebase, sin mensajes reales y sin imprimir
// datos personales.
import { describe, expect, it } from "vitest";
import { confirmBatch, proposeDistribution } from "@/lib/outreach/distribution";
import { planHandoff } from "@/lib/outreach/handoff";
import { editionMetrics } from "@/lib/outreach/metrics";
import {
  changeAttendance,
  EMPTY_FOLLOW_UP,
  recordContact,
  type Registration,
} from "@/lib/outreach/model";
import { PAYLOAD_KEYS, SimulatedTransport, cancelForRegistration, dispatch, planMessages, type ApprovedTemplate } from "@/lib/outreach/outbox";
import { SIM_EDITION, simTeam } from "@/lib/outreach/sim/fixtures";
import { applyInbound } from "@/lib/outreach/sync";
import { NOW, consent, freshState, inboundFromSim } from "./helpers";

const template: ApprovedTemplate = { id: "seguimiento-v1", purpose: "seguimiento_evento", approvedBy: "admin", approvedAt: "2026-11-01T10:00" };
const eventDay = { status: "evento" } as const;
const followUp = { ...SIM_EDITION, status: "seguimiento" } as const;

describe("ensayo general", () => {
  it("recorre todo el flujo y deja métricas coherentes sin filtrar nada fuera de la lista blanca", async () => {
    // 1. Sincronización entrante (dos veces).
    const batch = inboundFromSim();
    const s1 = applyInbound(freshState(), batch, { now: NOW });
    const s2 = applyInbound(s1.state, batch, { now: NOW });
    expect(s2.state.registrations).toHaveLength(300);
    expect(s2.report.unchanged).toBe(300);
    let regs: Registration[] = s2.state.registrations;

    // 2. Recepción: 240 asisten; dos recepcionistas tocan a la misma persona.
    const mark = (r: Registration, by: string) => changeAttendance(r, eventDay, { to: "asistio", at: "2026-11-29T19:40", by });
    regs = regs.map((r, i) => {
      if (i >= 240) return r;
      const first = mark(r, "sim-recep-1");
      if (!first.ok) throw new Error("debía marcar");
      const second = mark(first.value, "sim-recep-2");
      expect(second).toEqual({ ok: false, error: "sin_cambio" });
      return first.value;
    });
    expect(regs.filter((r) => r.attendance === "asistio" && r.attendanceBy === "sim-recep-1")).toHaveLength(240);

    // 2b. 10 llegadas sin inscripción.
    for (let n = 1; n <= 10; n++) {
      regs.push({
        id: `vplt-2026_rec_${n}`,
        editionId: "vplt-2026",
        identityId: null,
        source: "recepcion",
        externalRef: null,
        fullName: `Visita Ficticia ${n}`,
        phoneE164: `+56900001${String(n).padStart(3, "0")}`,
        email: null,
        invitedByName: null,
        status: "activa",
        duplicateOf: null,
        attendance: "asistio",
        attendanceAt: "2026-11-29T19:50",
        attendanceBy: "sim-recep-2",
        consents: [{ ...consent("seguimiento_evento"), source: "verbal_recepcion" }, { ...consent("mensajes_whatsapp"), source: "verbal_recepcion" }],
        doNotContact: false,
        ownerUid: null,
        assignmentBatchId: null,
        locallyEdited: [],
        followUp: { ...EMPTY_FOLLOW_UP },
        memberPersonId: null,
        handedOffAt: null,
        createdAt: "2026-11-29T19:50",
        revision: 1,
      });
    }

    // 3. Coordinación confirma 40 ausencias y deja 20 sin confirmar.
    let absent = 0;
    regs = regs.map((r) => {
      if (r.source !== "web" || r.attendance !== "sin_confirmar" || absent >= 40) return r;
      const res = changeAttendance(r, followUp, { to: "no_asistio", at: "2026-11-29T23:00", by: "sim-coord" });
      if (!res.ok) throw new Error("coordinación debía confirmar");
      absent++;
      return res.value;
    });
    expect(absent).toBe(40);

    // 4. Distribución 15 × ≤20 y confirmación.
    const team = simTeam(15);
    const proposal = proposeDistribution(regs, team, { editionId: "vplt-2026", batchId: "lote-ensayo", defaultMax: 20 });
    expect(proposal.assignments).toHaveLength(250);
    expect(proposal.unassigned).toHaveLength(0);
    const confirmed = confirmBatch(regs, proposal);
    expect(confirmed.result.applied).toHaveLength(250);
    expect(confirmBatch(confirmed.registrations, proposal).result.applied).toHaveLength(0);
    regs = confirmed.registrations;
    expect(regs.every((r) => r.memberPersonId === null)).toBe(true);

    // 5. Mensajes planificados antes de las bajas (idempotente).
    const planned = planMessages([], regs, template);
    expect(planMessages(planned.items, regs, template).items).toHaveLength(planned.items.length);
    let outbox = planned.items;
    expect(outbox.length).toBeGreaterThan(0);

    // 6. Seguimiento: 40 bajas (cancelan mensajes) y un primer contacto por responsable.
    const assigned = regs.filter((r) => r.ownerUid).sort((a, b) => a.id.localeCompare(b.id));
    const optOutIds = new Set(assigned.slice(0, 40).map((r) => r.id));
    const contact = (r: Registration, result: "contactado" | "pidio_no_contacto") =>
      recordContact(r, followUp, {
        id: `c-${r.id}`,
        registrationId: r.id,
        editionId: r.editionId,
        date: "2026-11-30",
        channel: "whatsapp",
        result,
        nextAction: result === "contactado" ? "Seguimiento" : null,
        nextActionDate: result === "contactado" ? "2026-12-06" : null,
        byUid: r.ownerUid as string,
      });
    const contactedOwners = new Set<string>();
    regs = regs.map((r) => {
      if (optOutIds.has(r.id)) {
        const res = contact(r, "pidio_no_contacto");
        if (!res.ok) throw new Error("debía registrar la baja");
        outbox = cancelForRegistration(outbox, r.id);
        return res.value;
      }
      if (r.ownerUid && !contactedOwners.has(r.ownerUid)) {
        const res = contact(r, "contactado");
        if (!res.ok) throw new Error("debía registrar el contacto");
        contactedOwners.add(r.ownerUid);
        return res.value;
      }
      return r;
    });
    expect(contactedOwners.size).toBe(15);
    expect(regs.filter((r) => r.doNotContact)).toHaveLength(40);

    // 7. Despacho simulado: nada sale hacia las bajas.
    const byId = new Map(regs.map((r) => [r.id, r]));
    const transport = new SimulatedTransport();
    outbox = await dispatch(outbox, transport, {
      enabled: true,
      maxPerRun: 1000,
      maxAttempts: 3,
      stillAllowed: (id) => {
        const r = byId.get(id);
        return !!r && r.status === "activa" && !r.doNotContact;
      },
    });
    const optedKeys = new Set(outbox.filter((i) => optOutIds.has(i.registrationId)).map((i) => i.key));
    expect(transport.sent.some((p) => optedKeys.has(p.idempotencyKey))).toBe(false);
    expect(outbox.filter((i) => optOutIds.has(i.registrationId)).every((i) => i.status === "cancelado")).toBe(true);
    expect(outbox.every((i) => ["enviado_al_motor", "cancelado"].includes(i.status))).toBe(true);
    for (const p of transport.sent) {
      expect(Object.keys(p).sort()).toEqual([...PAYLOAD_KEYS].sort());
      const json = JSON.stringify(p).toLowerCase();
      for (const forbidden of ["decision", "nota", "note", "amount", "monto"]) expect(json).not.toContain(forbidden);
    }

    // 8. Traspaso de algunas personas.
    const handoffs = regs
      .filter((r) => r.attendance === "asistio" && !r.doNotContact && r.consents.some((c) => c.purpose === "traspaso_consolidacion" && !c.revokedAt))
      .slice(0, 5);
    expect(handoffs).toHaveLength(5);
    const handedIds = new Set<string>();
    for (const r of handoffs) {
      const plan = planHandoff({
        reg: r,
        edition: { ...SIM_EDITION, status: "seguimiento" },
        actor: { uid: "sim-coord", canCoordinate: true, canManageConsolidation: true },
        reason: "Desea acompañamiento habitual",
        requestId: `req-${r.id}`,
      });
      if (!plan.ok) throw new Error(`traspaso rechazado: ${plan.error}`);
      handedIds.add(r.id);
    }
    regs = regs.map((r) => (handedIds.has(r.id) ? { ...r, handedOffAt: "2026-12-02T10:00", memberPersonId: `persona-ficticia-${r.id}` } : r));

    // 9. Métricas finales.
    const m = editionMetrics(regs, "2026-12-03", SIM_EDITION.eventDate);
    expect(m).toMatchObject({
      registered: 310,
      attended: 250,
      absentConfirmed: 40,
      attendancePending: 20,
      walkIns: 10,
      optedOut: 40,
      handedOff: 5,
      contactable: 270,
    });
    expect(m.assigned).toBe(245);
    expect(Object.values(m.loadByOwner).reduce((a, b) => a + b, 0)).toBe(205);
    expect(Math.max(...Object.values(m.loadByOwner))).toBeLessThanOrEqual(20);
    // Los 20 sin confirmar y los 40 ausentes siguen contactables pero sin responsable.
    // Las 60 contactables sin responsable no asistieron o siguen sin confirmar: no quedan por distribuir.
    expect(m.unassignedContactable).toBe(0);
  });
});
