// @vitest-environment node
// Servicio de los callables de Integrantes › Consolidación V1 (doc 23 §5–6),
// con un store en memoria. Los números (9)…(41) son los de la matriz de pruebas
// de la misión.
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { MembersMemoryStore, fixedClock, type Doc } from "./members-memory-store";

const require = createRequire(import.meta.url);
const { createMembersService, createMembersCallableHandler, deterministicId, UNNAMED_USER } = require("../../functions/members/service.js");
const { MEMBERS_ERROR_KEYS: E, MEMBERS_CALLABLES } = require("../../functions/shared/members.js");

const T0 = "2026-10-05T15:00:00.000Z"; // 12:00 en Santiago → hoy = 2026-10-05
const TODAY = "2026-10-05";

const MANAGE = "members.consolidation.manage";
const READ = "members.consolidation.read";

const v1 = (permissions: string[], extra: Doc = {}): Doc => ({
  accessSchemaVersion: 1,
  role: "leader",
  active: true,
  baseRole: "standard",
  permissions,
  areaIds: [],
  homeModule: "calendar",
  ...extra,
});

const USERS: Record<string, Doc> = {
  "u-coord": v1([MANAGE, "calendar.read"], { displayName: "Coordinadora Prueba" }),
  "u-coord-nocal": v1([MANAGE], { displayName: "Bruno Sin Calendario" }),
  "u-owner": v1([MANAGE], { displayName: "  Ana   Pérez " }),
  "u-noname": v1([MANAGE], { displayName: "correo@example.test" }),
  "u-apoyo": v1([READ], { displayName: "Apoyo Prueba" }),
  "u-admin": { role: "admin", active: true, displayName: "Administración" },
  "u-admin-v1": v1([], { baseRole: "admin", role: "admin", displayName: "Zoe Admin" }),
  "u-coord-inactive": v1([MANAGE], { active: false, displayName: "Inactiva" }),
  "u-pastor": { role: "pastor", active: true, displayName: "Pastor Legacy" },
  "u-leader-cal": v1(["calendar.read", "calendar.events.manage_assigned"], { displayName: "Líder Calendario" }),
  "u-finance": { role: "finance", active: true, displayName: "Finanzas" },
};

function setup(iso = T0) {
  const clock = fixedClock(iso);
  const store = new MembersMemoryStore(clock);
  for (const [uid, doc] of Object.entries(USERS)) store.put("users", uid, doc);
  store.put("calendarEvents", "ev-culto", { title: "Culto dominical", status: "scheduled" });
  store.put("calendarEvents", "ev-cancelado", { title: "Evangelismo", status: "cancelled" });
  store.put("calendarEvents", "ev-archivado", { title: "Duplicado", status: "archived" });
  const logger = { error: vi.fn() };
  const service = createMembersService({ store, clock, logger });
  return { store, clock, service, logger };
}

let seq = 0;
const rid = () => `req-${String(++seq).padStart(6, "0")}`;

const basePerson = (extra: Doc = {}): Doc => ({
  requestId: rid(),
  fullName: "  Persona   Ficticia Uno ",
  phone: "9 1234 5678",
  firstVisitDate: "2026-10-04",
  ...extra,
});

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message?: string; details?: unknown };
    return { code: e.code, message: e.message, details: e.details };
  }
  throw new Error("se esperaba un error");
}

const peopleOf = (store: MembersMemoryStore) => store.all("membersPeople");
const visitsOf = (store: MembersMemoryStore, personId: string) => store.all("membersVisits").filter((v) => v.data.personId === personId);
const followUpsOf = (store: MembersMemoryStore, personId: string) => store.all("membersFollowUps").filter((v) => v.data.personId === personId);
const changesOf = (store: MembersMemoryStore, personId: string) =>
  store
    .all("membersPersonChanges")
    .filter((c) => c.data.personId === personId)
    .sort((a, b) => (a.data.revision as number) - (b.data.revision as number) || a.id.localeCompare(b.id));

const CHANGE_KEYS = ["action", "actorUid", "at", "changedFields", "field", "from", "personId", "reason", "reasonNote", "refId", "revision", "to"];
const PERSON_KEYS = [
  "arrivalSource", "calendarEventId", "closedReason", "consolidationStatus", "createdAt", "createdBy", "doNotContact", "email", "entryDate",
  "firstContactDate", "firstVisitAt", "firstVisitDate", "followUpCount", "followUpOwnerUid", "fullName", "invitedBy", "lastFollowUpDate",
  "lastVisitDate", "lifecycleStage", "nextAction", "nextActionDate", "nextActionOwnerUid", "phoneE164", "revision", "updatedAt", "updatedBy",
  "visitCount",
];

async function createPerson(service: ReturnType<typeof setup>["service"], extra: Doc = {}, uid = "u-coord") {
  return service.personCreate(uid, basePerson(extra));
}

describe("membersPersonCreate", () => {
  it("(9)(18) crea persona válida con primera visita, proyección y auditoría", async () => {
    const { service, store } = setup();
    const res = await createPerson(service, { email: "  Persona.Uno@Example.TEST ", invitedBy: "Hermana   Rosa", arrivalSource: "invitacion", visitNote: "Llegó con su familia." });
    expect(res).toEqual({ personId: expect.stringMatching(/^[0-9a-f]{24}$/), revision: 1, replay: false, duplicates: [] });
    const person = store.doc("membersPeople", res.personId)!;
    expect(Object.keys(person).sort()).toEqual(PERSON_KEYS);
    expect(person).toMatchObject({
      fullName: "Persona Ficticia Uno",
      phoneE164: "+56912345678",
      email: "persona.uno@example.test",
      entryDate: TODAY,
      firstVisitAt: "2026-10-04",
      arrivalSource: "invitacion",
      calendarEventId: null,
      invitedBy: "Hermana Rosa",
      lifecycleStage: "en_consolidacion",
      consolidationStatus: "por_contactar",
      closedReason: null,
      followUpOwnerUid: null,
      doNotContact: false,
      revision: 1,
      createdBy: "u-coord",
      updatedBy: "u-coord",
      visitCount: 1,
      firstVisitDate: "2026-10-04",
      lastVisitDate: "2026-10-04",
      followUpCount: 0,
      lastFollowUpDate: null,
      firstContactDate: null,
      nextAction: null,
      nextActionDate: null,
      nextActionOwnerUid: null,
    });
    expect(person.createdAt).toEqual(new Date(T0));
    const visits = visitsOf(store, res.personId);
    expect(visits).toHaveLength(1);
    expect(visits[0].data).toEqual({
      personId: res.personId,
      date: "2026-10-04",
      calendarEventId: null,
      note: "Llegó con su familia.",
      firstVisit: true,
      createdAt: new Date(T0),
      createdBy: "u-coord",
    });
    const changes = changesOf(store, res.personId);
    expect(changes.map((c) => c.id)).toEqual([`${res.personId}-r1-1`]);
    expect(Object.keys(changes[0].data).sort()).toEqual(CHANGE_KEYS);
    expect(changes[0].data).toMatchObject({ action: "person_created", revision: 1, actorUid: "u-coord", refId: visits[0].id, changedFields: [], at: new Date(T0) });
    // Todo en una sola transacción.
    expect(store.commits).toHaveLength(1);
  });

  it("(10) teléfono chileno normalizado a E.164 (varios formatos)", async () => {
    const { service, store } = setup();
    for (const [raw, e164] of [
      ["912345678", "+56912345678"],
      ["+56 9 8765 4321", "+56987654321"],
      ["56 2 2345 6789", "+56223456789"],
      ["(09) 1111-2222", "+56911112222"],
    ]) {
      const res = await createPerson(service, { phone: raw });
      expect(store.doc("membersPeople", res.personId)!.phoneE164).toBe(e164);
    }
  });

  it("(11) teléfono extranjero con + se conserva", async () => {
    const { service, store } = setup();
    const res = await createPerson(service, { phone: "+54 9 11 2345 6789" });
    expect(store.doc("membersPeople", res.personId)!.phoneE164).toBe("+5491123456789");
  });

  it("(12) teléfono inválido falla con members/invalid-argument y el código del campo (sin eco del valor)", async () => {
    const { service, store } = setup();
    const err = await rejection(createPerson(service, { phone: "12-34" }));
    expect(err).toMatchObject({ code: "invalid-argument", message: E.invalidArgument, details: { fields: { phone: "invalid" } } });
    expect(JSON.stringify(err.details)).not.toContain("12-34");
    expect(peopleOf(store)).toHaveLength(0);
  });

  it("(13) correo trim + minúsculas; vacío → null", async () => {
    const { service, store } = setup();
    const a = await createPerson(service, { email: "  MIXTO@Example.Test  " });
    expect(store.doc("membersPeople", a.personId)!.email).toBe("mixto@example.test");
    const b = await createPerson(service, { email: "   ", phone: "+56911110000" });
    expect(store.doc("membersPeople", b.personId)!.email).toBeNull();
    expect(await rejection(createPerson(service, { email: "sin-arroba" }))).toMatchObject({ details: { fields: { email: "invalid" } } });
  });

  it("(14)(15)(16) duplicados por teléfono y correo se advierten sin bloquear", async () => {
    const { service, store } = setup();
    const first = await createPerson(service, { fullName: "Primera Ficticia", email: "dup@example.test" });
    const byPhone = await createPerson(service, { fullName: "Segunda Ficticia", phone: "+56 9 1234 5678" });
    expect(byPhone.duplicates).toEqual([{ personId: first.personId, fullName: "Primera Ficticia", by: ["telefono"] }]);
    const byEmail = await createPerson(service, { fullName: "Tercera Ficticia", phone: "+56922223333", email: "DUP@example.test" });
    expect(byEmail.duplicates).toEqual([{ personId: first.personId, fullName: "Primera Ficticia", by: ["correo"] }]);
    const both = await createPerson(service, { fullName: "Cuarta Ficticia", email: "dup@example.test" });
    expect(both.duplicates).toEqual(
      expect.arrayContaining([
        { personId: first.personId, fullName: "Primera Ficticia", by: ["telefono", "correo"] },
        { personId: byPhone.personId, fullName: "Segunda Ficticia", by: ["telefono"] },
        { personId: byEmail.personId, fullName: "Tercera Ficticia", by: ["correo"] },
      ]),
    );
    // (16) nunca bloquea: las cuatro personas existen.
    expect(peopleOf(store)).toHaveLength(4);
  });

  it("(17) doble envío con el mismo requestId → una persona, replay true, sin escribir", async () => {
    const { service, store } = setup();
    const payload = basePerson({ followUpOwnerUid: "u-owner" });
    const a = await service.personCreate("u-coord", payload);
    const commits = store.commits.length;
    const b = await service.personCreate("u-coord", { ...payload });
    expect(b).toEqual({ ...a, replay: true });
    expect(a.replay).toBe(false);
    expect(peopleOf(store)).toHaveLength(1);
    expect(visitsOf(store, a.personId)).toHaveLength(1);
    expect(store.commits.length).toBe(commits);
    expect(a.personId).toBe(deterministicId("u-coord", "person", payload.requestId));
  });

  it("el mismo requestId de otro actor → members/request-reused", async () => {
    const { service, store } = setup();
    const payload = basePerson();
    const a = await service.personCreate("u-coord", payload);
    // Mismo id solo si coincide uid; forzamos la colisión con un documento ajeno.
    const foreignId = deterministicId("u-owner", "person", payload.requestId);
    store.put("membersPeople", foreignId, { ...store.doc("membersPeople", a.personId)!, createdBy: "otro" });
    expect(await rejection(service.personCreate("u-owner", payload))).toMatchObject({ code: "already-exists", message: E.requestReused });
  });

  it("responsable válido → owner_changed null → uid en la misma revisión", async () => {
    const { service, store } = setup();
    const res = await createPerson(service, { followUpOwnerUid: "u-owner" });
    expect(store.doc("membersPeople", res.personId)!.followUpOwnerUid).toBe("u-owner");
    const changes = changesOf(store, res.personId);
    expect(changes.map((c) => [c.id, c.data.action])).toEqual([
      [`${res.personId}-r1-1`, "person_created"],
      [`${res.personId}-r1-2`, "owner_changed"],
    ]);
    expect(changes[1].data).toMatchObject({ field: "followUpOwnerUid", from: null, to: "u-owner", revision: 1, actorUid: "u-coord" });
  });

  it("admin (legacy y v1) puede ser responsable", async () => {
    const { service, store } = setup();
    const a = await createPerson(service, { followUpOwnerUid: "u-admin" });
    const b = await createPerson(service, { followUpOwnerUid: "u-admin-v1", phone: "+56933334444" });
    expect(store.doc("membersPeople", a.personId)!.followUpOwnerUid).toBe("u-admin");
    expect(store.doc("membersPeople", b.personId)!.followUpOwnerUid).toBe("u-admin-v1");
  });

  it.each([
    ["inexistente", "u-nadie"],
    ["desactivado", "u-coord-inactive"],
    ["sin manage (solo lectura)", "u-apoyo"],
    ["sin manage (calendario)", "u-leader-cal"],
    ["pastor legacy", "u-pastor"],
  ])("(39) responsable %s → members/invalid-owner, sin escribir", async (_label, owner) => {
    const { service, store } = setup();
    expect(await rejection(createPerson(service, { followUpOwnerUid: owner }))).toMatchObject({ code: "failed-precondition", message: E.invalidOwner });
    expect(peopleOf(store)).toHaveLength(0);
    expect(store.all("membersVisits")).toHaveLength(0);
  });

  it("(22) actividad del calendario aceptada con calendar.read; solo se guarda el id", async () => {
    const { service, store } = setup();
    const res = await createPerson(service, { calendarEventId: "ev-culto" });
    const person = store.doc("membersPeople", res.personId)!;
    expect(person.calendarEventId).toBe("ev-culto");
    expect(visitsOf(store, res.personId)[0].data.calendarEventId).toBe("ev-culto");
    expect(JSON.stringify(store.all("membersPeople"))).not.toContain("Culto dominical");
    // Nunca escribe en el calendario.
    expect(store.doc("calendarEvents", "ev-culto")).toEqual({ title: "Culto dominical", status: "scheduled" });
    expect(store.commits.flat().some((w) => w.collection === "calendarEvents")).toBe(false);
    // Una actividad cancelada (no archivada) también se acepta.
    await createPerson(service, { calendarEventId: "ev-cancelado", phone: "+56944445555" });
  });

  it("(22) actividad rechazada sin calendar.read, archivada o inexistente", async () => {
    const { service, store } = setup();
    expect(await rejection(createPerson(service, { calendarEventId: "ev-culto" }, "u-coord-nocal"))).toMatchObject({
      code: "permission-denied",
      message: E.calendarForbidden,
    });
    expect(await rejection(createPerson(service, { calendarEventId: "ev-archivado" }))).toMatchObject({ code: "not-found", message: E.calendarNotFound });
    expect(await rejection(createPerson(service, { calendarEventId: "ev-nada" }))).toMatchObject({ code: "not-found", message: E.calendarNotFound });
    expect(peopleOf(store)).toHaveLength(0);
  });

  it("fecha de primera visita futura o demasiado antigua → invalid-argument", async () => {
    const { service } = setup();
    expect(await rejection(createPerson(service, { firstVisitDate: "2026-10-06" }))).toMatchObject({ details: { fields: { firstVisitDate: "future_date" } } });
    expect(await rejection(createPerson(service, { firstVisitDate: "2025-01-01" }))).toMatchObject({ details: { fields: { firstVisitDate: "too_old" } } });
  });

  it("hoy se calcula en America/Santiago (03:30 UTC → día anterior local)", async () => {
    const { service, store } = setup("2026-10-06T02:30:00.000Z");
    const res = await createPerson(service, { firstVisitDate: "2026-10-05" });
    expect(store.doc("membersPeople", res.personId)!.entryDate).toBe("2026-10-05");
    expect(await rejection(createPerson(service, { firstVisitDate: "2026-10-06" }))).toMatchObject({ details: { fields: { firstVisitDate: "future_date" } } });
  });
});

describe("validación y acceso comunes", () => {
  it("(37) sin autenticación → members/unauthenticated en todos los callables", async () => {
    const { service } = setup();
    for (const method of ["personCreate", "personUpdate", "statusChange", "visitCreate", "followUpCreate", "ownerOptions"]) {
      expect(await rejection(service[method](null, {}))).toMatchObject({ code: "unauthenticated", message: E.unauthenticated });
      expect(await rejection(service[method]("", {}))).toMatchObject({ code: "unauthenticated", message: E.unauthenticated });
    }
  });

  it.each([
    ["solo lectura", "u-apoyo"],
    ["coordinadora inactiva", "u-coord-inactive"],
    ["pastor legacy (sin fallback para Integrantes)", "u-pastor"],
    ["líder solo calendario", "u-leader-cal"],
    ["finanzas legacy", "u-finance"],
    ["sin perfil", "u-fantasma"],
  ])("(38) %s no puede escribir → members/forbidden", async (_label, uid) => {
    const { service, store } = setup();
    for (const method of ["personCreate", "personUpdate", "statusChange", "visitCreate", "followUpCreate"]) {
      expect(await rejection(service[method](uid, basePerson()))).toMatchObject({ code: "permission-denied", message: E.forbidden });
    }
    expect(store.commits).toHaveLength(0);
  });

  it("(38) ownerOptions exige read: apoyo sí; calendario, pastor e inactiva no", async () => {
    const { service } = setup();
    await expect(service.ownerOptions("u-apoyo")).resolves.toHaveProperty("owners");
    for (const uid of ["u-leader-cal", "u-pastor", "u-coord-inactive"]) {
      expect(await rejection(service.ownerOptions(uid))).toMatchObject({ code: "permission-denied", message: E.forbidden });
    }
  });

  it("(40) claves desconocidas → invalid-argument con unknown_field", async () => {
    const { service } = setup();
    const err = await rejection(createPerson(service, { baptismDate: "2020-01-01", faith: true }));
    expect(err).toMatchObject({ code: "invalid-argument", message: E.invalidArgument, details: { fields: { baptismDate: "unknown_field", faith: "unknown_field" } } });
    const { personId } = await createPerson(service);
    expect(await rejection(service.personUpdate("u-coord", { personId, expectedRevision: 1, fullName: "X", notes: "y" }))).toMatchObject({
      details: { fields: { notes: "unknown_field" } },
    });
    expect(await rejection(service.visitCreate("u-coord", { requestId: rid(), personId, date: TODAY, extra: 1 }))).toMatchObject({
      details: { fields: { extra: "unknown_field" } },
    });
    expect(await rejection(service.personCreate("u-coord", ["no", "objeto"]))).toMatchObject({ details: { fields: { _: "invalid" } } });
  });

  it("(41) payload sobredimensionado → members/payload-too-large", async () => {
    const { service, store } = setup();
    const err = await rejection(createPerson(service, { visitNote: "x".repeat(5000) }));
    expect(err).toMatchObject({ code: "invalid-argument", message: E.payloadTooLarge });
    expect(peopleOf(store)).toHaveLength(0);
  });

  it("notas demasiado largas → too_long", async () => {
    const { service } = setup();
    expect(await rejection(createPerson(service, { visitNote: "x".repeat(281) }))).toMatchObject({ details: { fields: { visitNote: "too_long" } } });
  });

  it("errores inesperados: log sin PII y members/internal", async () => {
    const { service, store, logger } = setup();
    store.failNextTransaction = Object.assign(new Error("boom Persona Ficticia +56912345678"), { code: 13 });
    expect(await rejection(createPerson(service, { email: "secreto@example.test" }))).toMatchObject({ code: "internal", message: E.internal });
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, meta] = logger.error.mock.calls[0];
    expect(meta).toEqual({ method: "personCreate", name: "Error", code: "13" });
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/Ficticia|\+569|secreto|example/);
  });

  it("adaptador onCall pasa auth.uid y data; métodos desconocidos no se cablean", async () => {
    const { service } = setup();
    const handler = createMembersCallableHandler(service, "ownerOptions");
    await expect(handler({ auth: { uid: "u-coord" }, data: {} })).resolves.toHaveProperty("owners");
    expect(await rejection(handler({ data: {} }))).toMatchObject({ code: "unauthenticated" });
    expect(() => createMembersCallableHandler(service, "deleteEverything")).toThrow();
    expect(Object.keys(MEMBERS_CALLABLES).sort()).toEqual(["followUpCreate", "ownerOptions", "personCreate", "personUpdate", "statusChange", "visitCreate"]);
  });
});

describe("membersPersonUpdate", () => {
  it("cambia perfil, responsable y No contactar; auditoría sin valores de perfil", async () => {
    const { service, store, clock } = setup();
    const { personId } = await createPerson(service, { email: "antes@example.test", invitedBy: "Rosa" });
    clock.advance(60_000);
    const res = await service.personUpdate("u-owner", {
      personId,
      expectedRevision: 1,
      fullName: "Nombre Nuevo Ficticio",
      phone: "+56 9 9999 0000",
      email: "despues@example.test",
      invitedBy: "Rosa",
      followUpOwnerUid: "u-owner",
      doNotContact: true,
    });
    expect(res).toEqual({ personId, revision: 2, changed: ["fullName", "phoneE164", "email", "followUpOwnerUid", "doNotContact"] });
    const person = store.doc("membersPeople", personId)!;
    expect(person).toMatchObject({ fullName: "Nombre Nuevo Ficticio", phoneE164: "+56999990000", email: "despues@example.test", followUpOwnerUid: "u-owner", doNotContact: true, revision: 2, updatedBy: "u-owner", createdBy: "u-coord" });
    expect(person.updatedAt).toEqual(new Date(clock.now()));
    const changes = changesOf(store, personId).filter((c) => c.data.revision === 2);
    expect(changes.map((c) => [c.id, c.data.action])).toEqual([
      [`${personId}-r2-1`, "profile_updated"],
      [`${personId}-r2-2`, "owner_changed"],
      [`${personId}-r2-3`, "do_not_contact_changed"],
    ]);
    expect(changes[0].data).toMatchObject({ changedFields: ["fullName", "phoneE164", "email"], from: null, to: null, field: null, actorUid: "u-owner" });
    expect(changes[1].data).toMatchObject({ field: "followUpOwnerUid", from: null, to: "u-owner" });
    expect(changes[2].data).toMatchObject({ field: "doNotContact", from: false, to: true });
    // El registro de cambios nunca guarda valores de perfil.
    const log = JSON.stringify(store.all("membersPersonChanges"));
    for (const value of ["Nombre Nuevo", "Ficticia", "+5699999", "+56912345678", "despues@", "antes@", "Rosa"]) expect(log).not.toContain(value);
  });

  it("sin cambios reales → no escribe ni sube la revisión", async () => {
    const { service, store } = setup();
    const { personId } = await createPerson(service);
    const commits = store.commits.length;
    const res = await service.personUpdate("u-coord", { personId, expectedRevision: 1, fullName: "Persona Ficticia Uno", phone: "912345678", doNotContact: false });
    expect(res).toEqual({ personId, revision: 1, changed: [] });
    expect(store.commits.length).toBe(commits);
  });

  it("conflicto: expectedRevision desactualizada → members/conflict", async () => {
    const { service, store } = setup();
    const { personId } = await createPerson(service);
    await service.personUpdate("u-coord", { personId, expectedRevision: 1, invitedBy: "Alguien" });
    expect(await rejection(service.personUpdate("u-coord", { personId, expectedRevision: 1, invitedBy: "Otro" }))).toMatchObject({ code: "aborted", message: E.conflict });
    expect(store.doc("membersPeople", personId)!.invitedBy).toBe("Alguien");
  });

  it("persona inexistente → members/not-found", async () => {
    const { service } = setup();
    expect(await rejection(service.personUpdate("u-coord", { personId: "nada", expectedRevision: 1, invitedBy: "x" }))).toMatchObject({ code: "not-found", message: E.notFound });
  });

  it("(39) quitar responsable (null) se permite; asignar uno inválido no", async () => {
    const { service, store } = setup();
    const { personId } = await createPerson(service, { followUpOwnerUid: "u-owner" });
    expect(await rejection(service.personUpdate("u-coord", { personId, expectedRevision: 1, followUpOwnerUid: "u-coord-inactive" }))).toMatchObject({ message: E.invalidOwner });
    expect(await rejection(service.personUpdate("u-coord", { personId, expectedRevision: 1, followUpOwnerUid: "u-apoyo" }))).toMatchObject({ message: E.invalidOwner });
    const res = await service.personUpdate("u-coord", { personId, expectedRevision: 1, followUpOwnerUid: null });
    expect(res).toEqual({ personId, revision: 2, changed: ["followUpOwnerUid"] });
    expect(store.doc("membersPeople", personId)!.followUpOwnerUid).toBeNull();
    expect(changesOf(store, personId).at(-1)!.data).toMatchObject({ action: "owner_changed", from: "u-owner", to: null });
  });

  it("borrar correo opcional con null es un cambio de perfil", async () => {
    const { service, store } = setup();
    const { personId } = await createPerson(service, { email: "x@example.test" });
    const res = await service.personUpdate("u-coord", { personId, expectedRevision: 1, email: null });
    expect(res.changed).toEqual(["email"]);
    expect(store.doc("membersPeople", personId)!.email).toBeNull();
  });

  it("payload sin campos a cambiar → invalid-argument", async () => {
    const { service } = setup();
    const { personId } = await createPerson(service);
    expect(await rejection(service.personUpdate("u-coord", { personId, expectedRevision: 1 }))).toMatchObject({ code: "invalid-argument" });
  });
});

describe("membersStatusChange (pipeline §6)", () => {
  async function person(extra: Doc = {}) {
    const ctx = setup();
    const { personId } = await createPerson(ctx.service, extra);
    let revision = 1;
    const change = async (status: string, more: Doc = {}) => {
      const res = await ctx.service.statusChange("u-coord", { personId, expectedRevision: revision, status, ...more });
      revision = res.revision;
      return res;
    };
    return { ...ctx, personId, change, rev: () => revision };
  }

  it("(30)(31) por_contactar → en_seguimiento → integrandose, con auditoría", async () => {
    const { store, personId, change } = await person();
    expect(await change("en_seguimiento")).toEqual({ personId, revision: 2 });
    expect(await change("integrandose")).toEqual({ personId, revision: 3 });
    const p = store.doc("membersPeople", personId)!;
    expect(p).toMatchObject({ consolidationStatus: "integrandose", lifecycleStage: "en_consolidacion", closedReason: null, revision: 3 });
    const statusChanges = changesOf(store, personId).filter((c) => c.data.action === "status_changed");
    expect(statusChanges.map((c) => [c.id, c.data.from, c.data.to])).toEqual([
      [`${personId}-r2-1`, "por_contactar", "en_seguimiento"],
      [`${personId}-r3-1`, "en_seguimiento", "integrandose"],
    ]);
    expect(statusChanges[0].data).toMatchObject({ field: "consolidationStatus", actorUid: "u-coord", reason: null, reasonNote: null });
  });

  it("(32)(33) integrado exige confirmación y cambia la etapa a integrante en el MISMO documento", async () => {
    const { service, store, personId, change, rev } = await person();
    expect(await rejection(service.statusChange("u-coord", { personId, expectedRevision: rev(), status: "integrado" }))).toMatchObject({
      code: "invalid-argument",
      details: { fields: { confirmIntegrated: "confirm_required" } },
    });
    expect(await rejection(service.statusChange("u-coord", { personId, expectedRevision: rev(), status: "integrado", confirmIntegrated: false }))).toMatchObject({
      details: { fields: { confirmIntegrated: "confirm_required" } },
    });
    await change("integrado", { confirmIntegrated: true });
    expect(peopleOf(store)).toHaveLength(1);
    expect(store.doc("membersPeople", personId)).toMatchObject({ consolidationStatus: "integrado", lifecycleStage: "integrante", revision: 2 });
    const r2 = changesOf(store, personId).filter((c) => c.data.revision === 2);
    expect(r2.map((c) => [c.data.action, c.data.from, c.data.to])).toEqual([
      ["status_changed", "por_contactar", "integrado"],
      ["stage_changed", "en_consolidacion", "integrante"],
    ]);
    // Integrado no se reabre en V1.
    expect(await rejection(service.statusChange("u-coord", { personId, expectedRevision: rev(), status: "en_seguimiento" }))).toMatchObject({
      code: "failed-precondition",
      message: E.invalidTransition,
    });
  });

  it("(34) sin_continuidad exige motivo (y texto si es otro); el motivo queda en la persona y la nota solo en el cambio", async () => {
    const { service, store, personId, change, rev } = await person();
    expect(await rejection(service.statusChange("u-coord", { personId, expectedRevision: rev(), status: "sin_continuidad" }))).toMatchObject({
      details: { fields: { closedReason: "required" } },
    });
    expect(await rejection(service.statusChange("u-coord", { personId, expectedRevision: rev(), status: "sin_continuidad", closedReason: "otro" }))).toMatchObject({
      details: { fields: { reasonNote: "required" } },
    });
    await change("sin_continuidad", { closedReason: "otro", reasonNote: "Viaja por trabajo largo tiempo" });
    const p = store.doc("membersPeople", personId)!;
    expect(p).toMatchObject({ consolidationStatus: "sin_continuidad", closedReason: "otro" });
    expect(JSON.stringify(p)).not.toContain("Viaja");
    expect(changesOf(store, personId).at(-1)!.data).toMatchObject({ action: "status_changed", reason: "otro", reasonNote: "Viaja por trabajo largo tiempo" });
  });

  it("(35) reabrir conserva el historial: los cambios crecen y nada se borra", async () => {
    const { store, personId, change } = await person();
    await change("sin_continuidad", { closedReason: "no_responde" });
    const before = changesOf(store, personId).map((c) => c.id);
    await change("en_seguimiento");
    const after = changesOf(store, personId);
    expect(after.map((c) => c.id).slice(0, before.length)).toEqual(before);
    expect(after.length).toBe(before.length + 1);
    expect(store.doc("membersPeople", personId)).toMatchObject({ consolidationStatus: "en_seguimiento", closedReason: null, lifecycleStage: "en_consolidacion" });
    expect(visitsOf(store, personId)).toHaveLength(1);
    // Desde sin_continuidad solo se reabre a en_seguimiento.
    await change("sin_continuidad", { closedReason: "se_mudo" });
    expect(await rejection(change("integrandose"))).toMatchObject({ message: E.invalidTransition });
  });

  it("mismo estado o motivo con estado activo → rechazado", async () => {
    const { service, personId, rev } = await person();
    expect(await rejection(service.statusChange("u-coord", { personId, expectedRevision: rev(), status: "por_contactar" }))).toMatchObject({ message: E.invalidTransition });
    expect(await rejection(service.statusChange("u-coord", { personId, expectedRevision: rev(), status: "en_seguimiento", closedReason: "otro" }))).toMatchObject({
      details: { fields: { closedReason: "invalid" } },
    });
  });

  it("conflicto con expectedRevision desactualizada", async () => {
    const { service, personId, change } = await person();
    await change("en_seguimiento");
    expect(await rejection(service.statusChange("u-coord", { personId, expectedRevision: 1, status: "integrandose" }))).toMatchObject({ code: "aborted", message: E.conflict });
  });
});

describe("membersVisitCreate", () => {
  it("(19)(20)(21) agrega visita, no toca la anterior, proyección correcta y auditoría", async () => {
    const { service, store, clock } = setup();
    const { personId } = await createPerson(service, { firstVisitDate: "2026-09-20" });
    const first = structuredClone(visitsOf(store, personId)[0]);
    clock.advance(3_600_000);
    const res = await service.visitCreate("u-owner", { requestId: rid(), personId, date: "2026-10-04", note: "Vino al culto." });
    expect(res).toEqual({ visitId: expect.stringMatching(/^[0-9a-f]{24}$/), personId, revision: 2, replay: false, suggestReopen: false });
    const visits = visitsOf(store, personId);
    expect(visits).toHaveLength(2);
    expect(visits.find((v) => v.id === first.id)).toEqual(first);
    expect(store.doc("membersVisits", res.visitId)).toEqual({
      personId,
      date: "2026-10-04",
      calendarEventId: null,
      note: "Vino al culto.",
      firstVisit: false,
      createdAt: new Date(clock.now()),
      createdBy: "u-owner",
    });
    // Una visita anterior en el tiempo no mueve lastVisitDate.
    await service.visitCreate("u-coord", { requestId: rid(), personId, date: "2026-09-27" });
    const p = store.doc("membersPeople", personId)!;
    expect(p).toMatchObject({ visitCount: 3, firstVisitDate: "2026-09-20", lastVisitDate: "2026-10-04", firstVisitAt: "2026-09-20", revision: 3, consolidationStatus: "por_contactar" });
    expect(changesOf(store, personId).at(-1)!.data).toMatchObject({ action: "visit_recorded", revision: 3, actorUid: "u-coord", refId: expect.any(String) });
  });

  it("(17) doble envío de visita → replay sin duplicar", async () => {
    const { service, store } = setup();
    const { personId } = await createPerson(service);
    const payload = { requestId: rid(), personId, date: TODAY };
    const a = await service.visitCreate("u-coord", payload);
    const b = await service.visitCreate("u-coord", payload);
    expect(b).toEqual({ ...a, replay: true });
    expect(visitsOf(store, personId)).toHaveLength(2);
    expect(store.doc("membersPeople", personId)!.visitCount).toBe(2);
    // Mismo requestId para otra persona → request-reused.
    const other = await createPerson(service, { phone: "+56900000099" });
    expect(await rejection(service.visitCreate("u-coord", { ...payload, personId: other.personId }))).toMatchObject({ code: "already-exists", message: E.requestReused });
  });

  it("sugiere reabrir al registrar visita de una persona sin continuidad; nunca cambia el estado", async () => {
    const { service, store } = setup();
    const { personId } = await createPerson(service);
    await service.statusChange("u-coord", { personId, expectedRevision: 1, status: "sin_continuidad", closedReason: "no_responde" });
    const res = await service.visitCreate("u-coord", { requestId: rid(), personId, date: TODAY });
    expect(res.suggestReopen).toBe(true);
    expect(store.doc("membersPeople", personId)!.consolidationStatus).toBe("sin_continuidad");
  });

  it("(22) actividad del calendario en la visita: con calendar.read sí; sin él, archivada o inexistente no", async () => {
    const { service, store } = setup();
    const { personId } = await createPerson(service);
    const ok = await service.visitCreate("u-coord", { requestId: rid(), personId, date: TODAY, calendarEventId: "ev-culto" });
    expect(store.doc("membersVisits", ok.visitId)!.calendarEventId).toBe("ev-culto");
    expect(await rejection(service.visitCreate("u-coord-nocal", { requestId: rid(), personId, date: TODAY, calendarEventId: "ev-culto" }))).toMatchObject({ message: E.calendarForbidden });
    expect(await rejection(service.visitCreate("u-coord", { requestId: rid(), personId, date: TODAY, calendarEventId: "ev-archivado" }))).toMatchObject({ message: E.calendarNotFound });
    expect(await rejection(service.visitCreate("u-coord", { requestId: rid(), personId, date: TODAY, calendarEventId: "ev-x" }))).toMatchObject({ message: E.calendarNotFound });
  });

  it("persona inexistente → not-found; fecha futura → future_date", async () => {
    const { service } = setup();
    expect(await rejection(service.visitCreate("u-coord", { requestId: rid(), personId: "nadie", date: TODAY }))).toMatchObject({ message: E.notFound });
    const { personId } = await createPerson(service);
    expect(await rejection(service.visitCreate("u-coord", { requestId: rid(), personId, date: "2026-10-06" }))).toMatchObject({ details: { fields: { date: "future_date" } } });
  });
});

describe("membersFollowUpCreate", () => {
  async function withPerson(extra: Doc = {}) {
    const ctx = setup();
    const { personId } = await createPerson(ctx.service, extra);
    const follow = (more: Doc, uid = "u-coord") =>
      ctx.service.followUpCreate(uid, { requestId: rid(), personId, contactDate: TODAY, type: "whatsapp", result: "sin_respuesta", ...more });
    return { ...ctx, personId, follow };
  }

  it("(24)(27) crea seguimiento, proyecta la próxima acción y audita", async () => {
    const { store, personId, follow } = await withPerson({ followUpOwnerUid: "u-owner" });
    const res = await follow({ note: "No contestó.", nextAction: "Volver a escribir", nextActionDate: "2026-10-08" });
    expect(res).toEqual({ followUpId: expect.stringMatching(/^[0-9a-f]{24}$/), personId, revision: 2, replay: false, applied: { status: null, doNotContact: false } });
    expect(store.doc("membersFollowUps", res.followUpId)).toEqual({
      personId,
      contactDate: TODAY,
      type: "whatsapp",
      result: "sin_respuesta",
      note: "No contestó.",
      nextAction: "Volver a escribir",
      nextActionDate: "2026-10-08",
      ownerUid: "u-owner",
      createdAt: new Date(T0),
      createdBy: "u-coord",
    });
    expect(store.doc("membersPeople", personId)).toMatchObject({
      followUpCount: 1,
      lastFollowUpDate: TODAY,
      firstContactDate: null,
      nextAction: "Volver a escribir",
      nextActionDate: "2026-10-08",
      nextActionOwnerUid: "u-owner",
      consolidationStatus: "por_contactar",
      revision: 2,
    });
    expect(changesOf(store, personId).at(-1)!.data).toMatchObject({ action: "follow_up_recorded", refId: res.followUpId, revision: 2, actorUid: "u-coord" });
  });

  it("(25) 'contactado' aplica en_seguimiento solo si viene confirmado y coincide", async () => {
    const { store, personId, follow } = await withPerson();
    const res = await follow({ result: "contactado", applyStatus: "en_seguimiento" });
    expect(res.applied).toEqual({ status: "en_seguimiento", doNotContact: false });
    expect(store.doc("membersPeople", personId)).toMatchObject({ consolidationStatus: "en_seguimiento", firstContactDate: TODAY, revision: 2 });
    const r2 = changesOf(store, personId).filter((c) => c.data.revision === 2);
    expect(r2.map((c) => [c.data.action, c.data.from, c.data.to])).toEqual([
      ["follow_up_recorded", null, null],
      ["status_changed", "por_contactar", "en_seguimiento"],
    ]);
  });

  it("(26) 'contactado' sin confirmación no cambia el estado", async () => {
    const { store, personId, follow } = await withPerson();
    const res = await follow({ result: "contactado" });
    expect(res.applied).toEqual({ status: null, doNotContact: false });
    expect(store.doc("membersPeople", personId)).toMatchObject({ consolidationStatus: "por_contactar", firstContactDate: TODAY });
    // Un segundo "contactado" ya no sugiere nada: aplicar algo es un desajuste.
    expect(await rejection(follow({ result: "contactado", applyStatus: "en_seguimiento" }))).toMatchObject({ code: "failed-precondition", message: E.suggestionMismatch });
  });

  it("'no desea contacto' confirmado → No contactar + sin_continuidad (motivo no_desea_contacto)", async () => {
    const { store, personId, follow } = await withPerson();
    const res = await follow({ result: "no_desea_contacto", applyStatus: "sin_continuidad", applyDoNotContact: true });
    expect(res.applied).toEqual({ status: "sin_continuidad", doNotContact: true });
    expect(store.doc("membersPeople", personId)).toMatchObject({ consolidationStatus: "sin_continuidad", closedReason: "no_desea_contacto", doNotContact: true });
    const r2 = changesOf(store, personId).filter((c) => c.data.revision === 2);
    expect(r2.map((c) => [c.data.action, c.data.reason ?? null, c.data.to])).toEqual([
      ["follow_up_recorded", null, null],
      ["status_changed", "no_desea_contacto", "sin_continuidad"],
      ["do_not_contact_changed", null, true],
    ]);
  });

  it("sugerencias que no coinciden → members/suggestion-mismatch, sin escribir", async () => {
    const { store, personId, follow } = await withPerson();
    const commits = store.commits.length;
    expect(await rejection(follow({ result: "sin_respuesta", applyStatus: "en_seguimiento" }))).toMatchObject({ message: E.suggestionMismatch });
    expect(await rejection(follow({ result: "contactado", applyStatus: "integrado" }))).toMatchObject({ message: E.suggestionMismatch });
    expect(await rejection(follow({ result: "contactado", applyDoNotContact: true }))).toMatchObject({ message: E.suggestionMismatch });
    expect(store.commits.length).toBe(commits);
    expect(followUpsOf(store, personId)).toHaveLength(0);
  });

  it("(28) un seguimiento vencido se mantiene derivable: nextActionDate pasada queda guardada", async () => {
    const { store, clock, personId, follow } = await withPerson();
    await follow({ contactDate: "2026-09-20", nextAction: "Llamar", nextActionDate: "2026-09-25" });
    clock.set("2026-10-10T15:00:00.000Z");
    const p = store.doc("membersPeople", personId)!;
    expect(p.nextActionDate).toBe("2026-09-25");
    expect((p.nextActionDate as string) < "2026-10-10").toBe(true);
  });

  it("la próxima acción vigente es la del último seguimiento registrado (sin acción → se limpia)", async () => {
    const { store, personId, follow } = await withPerson();
    await follow({ nextAction: "Llamar", nextActionDate: "2026-10-07" });
    await follow({ result: "contactado" });
    expect(store.doc("membersPeople", personId)).toMatchObject({ followUpCount: 2, nextAction: null, nextActionDate: null, nextActionOwnerUid: null });
  });

  it("responsable explícito validado; por defecto el de la persona", async () => {
    const { store, personId, follow } = await withPerson({ followUpOwnerUid: "u-owner" });
    const a = await follow({ nextAction: "Visitar", nextActionDate: "2026-10-09", ownerUid: "u-coord" });
    expect(store.doc("membersFollowUps", a.followUpId)!.ownerUid).toBe("u-coord");
    expect(store.doc("membersPeople", personId)!.nextActionOwnerUid).toBe("u-coord");
    expect(await rejection(follow({ ownerUid: "u-coord-inactive" }))).toMatchObject({ message: E.invalidOwner });
    expect(await rejection(follow({ ownerUid: "u-apoyo" }))).toMatchObject({ message: E.invalidOwner });
  });

  it("próxima acción sin fecha (o al revés) → pair_required; fecha anterior al contacto → before_contact", async () => {
    const { follow } = await withPerson();
    expect(await rejection(follow({ nextAction: "Llamar" }))).toMatchObject({ details: { fields: { nextActionDate: "pair_required" } } });
    expect(await rejection(follow({ nextAction: "Llamar", nextActionDate: "2026-10-01" }))).toMatchObject({ details: { fields: { nextActionDate: "before_contact" } } });
  });

  it("(17) doble envío de seguimiento → replay sin duplicar ni reaplicar", async () => {
    const { service, store, personId } = await withPerson();
    const payload = { requestId: rid(), personId, contactDate: TODAY, type: "llamada", result: "contactado", applyStatus: "en_seguimiento" };
    const a = await service.followUpCreate("u-coord", payload);
    const b = await service.followUpCreate("u-coord", payload);
    expect(b).toEqual({ ...a, replay: true });
    expect(followUpsOf(store, personId)).toHaveLength(1);
    expect(store.doc("membersPeople", personId)!.revision).toBe(2);
  });
});

describe("auditoría completa", () => {
  it("cada acción deja actor, fecha, acción y revisión coherentes; ids secuenciales por revisión", async () => {
    const { service, store } = setup();
    const { personId } = await createPerson(service, { followUpOwnerUid: "u-owner" });
    await service.visitCreate("u-coord", { requestId: rid(), personId, date: TODAY });
    await service.followUpCreate("u-owner", { requestId: rid(), personId, contactDate: TODAY, type: "presencial", result: "contactado", applyStatus: "en_seguimiento" });
    await service.personUpdate("u-coord", { personId, expectedRevision: 3, doNotContact: true });
    await service.statusChange("u-admin", { personId, expectedRevision: 4, status: "integrandose" });
    const changes = changesOf(store, personId);
    expect(changes.map((c) => [c.id.slice(25), c.data.action, c.data.actorUid])).toEqual([
      ["r1-1", "person_created", "u-coord"],
      ["r1-2", "owner_changed", "u-coord"],
      ["r2-1", "visit_recorded", "u-coord"],
      ["r3-1", "follow_up_recorded", "u-owner"],
      ["r3-2", "status_changed", "u-owner"],
      ["r4-1", "do_not_contact_changed", "u-coord"],
      ["r5-1", "status_changed", "u-admin"],
    ]);
    for (const c of changes) {
      expect(Object.keys(c.data).sort()).toEqual(CHANGE_KEYS);
      expect(c.data.at).toBeInstanceOf(Date);
      expect(c.data.personId).toBe(personId);
    }
    expect(store.doc("membersPeople", personId)!.revision).toBe(5);
  });
});

describe("membersOwnerOptions", () => {
  it("activos con manage (incluye admins), nombres seguros, ordenados, sin correos", async () => {
    const { service } = setup();
    const { owners } = await service.ownerOptions("u-apoyo");
    expect(owners).toEqual([
      { uid: "u-admin", displayName: "Administración" },
      { uid: "u-owner", displayName: "Ana Pérez" },
      { uid: "u-coord-nocal", displayName: "Bruno Sin Calendario" },
      { uid: "u-coord", displayName: "Coordinadora Prueba" },
      { uid: "u-noname", displayName: UNNAMED_USER },
      { uid: "u-admin-v1", displayName: "Zoe Admin" },
    ]);
    expect(JSON.stringify(owners)).not.toContain("@");
    for (const excluded of ["u-apoyo", "u-coord-inactive", "u-pastor", "u-leader-cal", "u-finance"]) {
      expect(owners.some((o: { uid: string }) => o.uid === excluded)).toBe(false);
    }
  });
});
