// @vitest-environment node
// Ensayo determinista del servicio real, en memoria: sin red, Auth real,
// Firestore real ni mensajes. No es una medición de carga de Firebase.
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { MembersMemoryStore, fixedClock } from "./members-memory-store";
import { toPerson } from "@/lib/members/client";
import { attentionQueue, computeAlerts } from "@/lib/members/consolidation";
import { whatsappLink } from "@/lib/shared/members";

const require = createRequire(import.meta.url);
const { createMembersService } = require("../../functions/members/service.js");
const TODAY = "2026-11-03";
const owners = Array.from(
  { length: 15 },
  (_, i) => `responsable-ficticio-${i + 1}`,
);
function setup() {
  const clock = fixedClock(`${TODAY}T15:00:00Z`);
  const store = new MembersMemoryStore(clock);
  for (const uid of owners)
    store.put("users", uid, {
      role: "leader",
      baseRole: "standard",
      active: true,
      accessSchemaVersion: 1,
      permissions: ["members.consolidation.manage", "calendar.read"],
      areaIds: [],
      homeModule: "calendar",
      displayName: `Responsable ${uid.split("-").at(-1)}`,
    });
  store.put("calendarEvents", "evento-ficticio", {
    title: "Evento ficticio",
    status: "scheduled",
  });
  const logger = { error: vi.fn() };
  return {
    store,
    clock,
    logger,
    service: createMembersService({ store, clock, logger }),
  };
}
function payload(i: number) {
  return {
    requestId: `ensayo-persona-${i.toString().padStart(4, "0")}`,
    fullName: `Persona ficticia ${i + 1}`,
    phone: `+5690000${i.toString().padStart(4, "0")}`,
    email: `ficticia-${i}@example.test`,
    firstVisitDate: TODAY,
    calendarEventId: "evento-ficticio",
    arrivalSource: "actividad",
    followUpOwnerUid: owners[i % owners.length],
  };
}

describe("ensayo 300 personas / 15 responsables", () => {
  it("conserva 300 fichas, 20 por responsable, historial, bajas y reintentos sin duplicar", async () => {
    const { store, service, logger } = setup();
    const ids: string[] = [];
    const requests = Array.from({ length: 300 }, (_, i) => payload(i));
    for (const request of requests) {
      const result = await service.personCreate(owners[0], request);
      ids.push(result.personId);
    }
    expect(new Set(ids).size).toBe(300);
    expect(store.all("membersPeople")).toHaveLength(300);
    expect(store.all("membersVisits")).toHaveLength(300);
    const createCommits = store.commits.length;
    // Misma solicitud tras perder la respuesta: 300 replay, ninguna escritura.
    for (let i = 0; i < 300; i++) {
      expect(await service.personCreate(owners[0], requests[i])).toMatchObject({
        personId: ids[i],
        replay: true,
      });
    }
    expect(store.commits).toHaveLength(createCommits);
    for (const uid of owners) {
      expect(
        store
          .all("membersPeople")
          .filter((p) => p.data.followUpOwnerUid === uid),
      ).toHaveLength(20);
    }
    expect((await service.ownerOptions(owners[0])).owners).toHaveLength(15);

    // 200 contactados, 60 sin respuesta, 40 que piden no recibir contacto.
    for (let i = 0; i < 300; i++) {
      const optOut = i >= 260;
      const contacted = i < 200;
      const followUp = {
        requestId: `ensayo-seguimiento-${i.toString().padStart(4, "0")}`,
        personId: ids[i],
        contactDate: TODAY,
        type: "whatsapp",
        result: optOut
          ? "no_desea_contacto"
          : contacted
            ? "contactado"
            : "sin_respuesta",
        applyStatus: optOut
          ? "sin_continuidad"
          : contacted
            ? "en_seguimiento"
            : null,
        applyDoNotContact: optOut,
        ...(optOut
          ? {}
          : {
              nextAction: "Revisar seguimiento",
              nextActionDate: "2026-11-04",
            }),
      };
      const first = await service.followUpCreate(
        owners[i % owners.length],
        followUp,
      );
      const commitCount = store.commits.length;
      expect(
        await service.followUpCreate(owners[i % owners.length], followUp),
      ).toMatchObject({ followUpId: first.followUpId, replay: true });
      expect(store.commits).toHaveLength(commitCount);
    }
    const people = store
      .all("membersPeople")
      .map((p) => toPerson(p.id, p.data));
    expect(store.all("membersFollowUps")).toHaveLength(300);
    expect(people.filter((p) => p.doNotContact)).toHaveLength(40);
    expect(
      people.filter((p) => p.consolidationStatus === "en_seguimiento"),
    ).toHaveLength(200);
    expect(
      people.every(
        (p) =>
          p.projection.visitCount === 1 &&
          p.projection.followUpCount === 1 &&
          p.revision === 2,
      ),
    ).toBe(true);
    const alerts = computeAlerts(people, new Set(owners), "2026-11-06T12:00");
    expect(alerts.filter((a) => a.type === "sin_responsable")).toHaveLength(0);
    expect(alerts.filter((a) => a.type === "sin_primer_contacto")).toHaveLength(
      60,
    );
    expect(alerts.filter((a) => a.type === "seguimiento_vencido")).toHaveLength(
      260,
    );
    expect(attentionQueue(alerts)).toHaveLength(260);
    for (const p of people.filter((p) => p.doNotContact)) {
      expect(whatsappLink(p)).toBeNull();
      expect(alerts.some((a) => a.personId === p.id)).toBe(false);
    }
    expect(
      store
        .all("membersPersonChanges")
        .every((c) => owners.includes(c.data.actorUid as string)),
    ).toBe(true);
    expect(
      store
        .all("membersPersonChanges")
        .filter((c) => c.data.action === "person_created"),
    ).toHaveLength(300);
    expect(
      store
        .all("membersPersonChanges")
        .filter((c) => c.data.action === "follow_up_recorded"),
    ).toHaveLength(300);
    expect(
      store
        .all("membersPersonChanges")
        .filter((c) => c.data.action === "do_not_contact_changed"),
    ).toHaveLength(40);
    expect(
      [...store.collections.keys()].every(
        (c) =>
          c === "users" || c === "calendarEvents" || c.startsWith("members"),
      ),
    ).toBe(true);
    expect(store.all("calendarEvents")).toEqual([
      {
        id: "evento-ficticio",
        data: { title: "Evento ficticio", status: "scheduled" },
      },
    ]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("corte antes de confirmar la transacción: reintentar recupera sin ficha ni visita parcial", async () => {
    const { store, service } = setup();
    store.failNextTransaction = new Error("Corte ficticio");
    await expect(
      service.personCreate(owners[0], payload(0)),
    ).rejects.toMatchObject({ code: "internal" });
    expect(store.all("membersPeople")).toHaveLength(0);
    expect(store.all("membersVisits")).toHaveLength(0);
    expect(store.all("membersPersonChanges")).toHaveLength(0);
    expect(await service.personCreate(owners[0], payload(0))).toMatchObject({
      replay: false,
    });
    expect(store.all("membersPeople")).toHaveLength(1);
  });

  it("rechaza edición obsoleta, responsable desactivado y actor de Finanzas sin permiso", async () => {
    const { store, service } = setup();
    const p = await service.personCreate(owners[0], payload(0));
    await service.personUpdate(owners[0], {
      personId: p.personId,
      expectedRevision: 1,
      followUpOwnerUid: owners[1],
    });
    await expect(
      service.personUpdate(owners[0], {
        personId: p.personId,
        expectedRevision: 1,
        followUpOwnerUid: owners[2],
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    store.put("users", owners[2], { role: "admin", active: false });
    await expect(
      service.personUpdate(owners[0], {
        personId: p.personId,
        expectedRevision: 2,
        followUpOwnerUid: owners[2],
      }),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    store.put("users", "solo-finanzas", { role: "finance", active: true });
    await expect(
      service.personCreate("solo-finanzas", payload(1)),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(store.doc("membersPeople", p.personId)).toMatchObject({
      revision: 2,
      followUpOwnerUid: owners[1],
    });
  });

  it("expone el límite V1: no permite padrón sin visita ni campo de decisión religiosa", async () => {
    const { store, service } = setup();
    await expect(
      service.personCreate(owners[0], { ...payload(0), firstVisitDate: null }),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      service.personCreate(owners[0], {
        ...payload(0),
        decision: "dato-no-admitido",
      }),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(store.all("membersPeople")).toHaveLength(0);
  });
});
