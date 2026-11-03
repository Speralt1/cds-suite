// @vitest-environment node
// H4 backend: tope por responsable con contador transaccional, lista de revisión,
// candidatos de equipo y listado de mesas (store en memoria).
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { simRegistrations, simTeam } from "@/lib/outreach/sim/fixtures";
import { OutreachMemoryStore, fixedClock, type Doc } from "./outreach-memory-store";

const require = createRequire(import.meta.url);
const { createOutreachService } = require("../../functions/outreach/service.js");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = Record<string, (...args: unknown[]) => Promise<any>>;

const v1 = (permissions: string[], extra: Doc = {}): Doc => ({ accessSchemaVersion: 1, role: "leader", active: true, baseRole: "standard", permissions, areaIds: [], homeModule: "calendar", ...extra });
const COORD = "members.outreach.coordinate";
const FOLLOW = "members.outreach.followup_assigned";
const ED = "vplt-2026";

async function fails(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    const err = e as { code?: string; message?: string; details?: unknown };
    return { code: err.code, message: err.message, details: err.details };
  }
  throw new Error("se esperaba un rechazo");
}

async function setup(maxPerOwner = 3) {
  const clock = fixedClock("2026-11-28T21:00:00-03:00");
  const store = new OutreachMemoryStore(clock);
  const team = simTeam(4);
  for (const m of team) store.put("users", m.uid, v1(m.roles.includes("responsable") ? [FOLLOW] : [COORD], { displayName: m.displayName }));
  store.put("users", "nobody", v1([], { displayName: "Sin permisos" }));
  store.put("users", "gone", v1([FOLLOW], { active: false, displayName: "Baja" }));
  const service = createOutreachService({ store, clock, logger: { error: vi.fn() } }) as Svc;
  await service.editionCreate("sim-coord", { year: 2026, eventDate: "2026-11-28", maxPerOwner });
  await service.teamSet("sim-coord", { editionId: ED, members: team.map((m) => ({ uid: m.uid, roles: m.roles, active: true })) });
  let rev = 1;
  for (const to of ["inscripcion", "evento"]) rev = (await service.editionTransition("sim-coord", { editionId: ED, to, expectedRevision: rev })).revision;
  const owners = team.filter((m) => m.roles.includes("responsable")).map((m) => m.uid);
  const regs = simRegistrations({ count: 12 });
  for (const r of regs) store.put("outreachRegistrations", r.id, { ...r, assigneeUid: null, editionActive: true, receptionOpen: true });
  const batch = (id: string, owner: string, ids: string[]) =>
    store.put("outreachAssignmentBatches", id, { editionId: ED, status: "propuesto", createdBy: "sim-coord", assignments: ids.map((rid) => ({ registrationId: rid, ownerUid: owner, baseRevision: 1 })), unassigned: [] });
  return { clock, store, service, owners, regs: regs.map((r) => r.id), batch };
}
const openCount = (store: OutreachMemoryStore, uid: string) => store.doc(`outreachEditions/${ED}/team`, uid)?.openCount;

describe("tope por responsable", () => {
  it("dos lotes distintos para el mismo responsable no superan el tope; el contador queda fijado", async () => {
    const { store, service, owners, regs, batch } = await setup(3);
    const [o] = owners;
    batch("bA", o, regs.slice(0, 2));
    batch("bB", o, regs.slice(2, 4));
    const a = await service.distributionConfirm("sim-coord", { editionId: ED, batchId: "bA" });
    const b = await service.distributionConfirm("sim-coord", { editionId: ED, batchId: "bB" });
    expect(a.applied).toBe(2);
    expect(b.applied).toBe(1);
    expect(b.conflicts).toEqual([{ registrationId: regs[3], reason: "tope" }]);
    expect(openCount(store, o)).toBe(3);
  });
  it("una nota de coordinación justifica el excedente", async () => {
    const { store, service, owners, regs, batch } = await setup(1);
    const [o] = owners;
    batch("bA", o, regs.slice(0, 2));
    const r = await service.distributionConfirm("sim-coord", { editionId: ED, batchId: "bA", notes: [{ registrationId: regs[1], note: "Es su familiar" }] });
    expect(r.applied).toBe(2);
    expect(openCount(store, o)).toBe(2);
    expect(store.doc(`outreachRegistrations/${regs[1]}/assignments`, "bA")?.note).toBe("Es su familiar");
  });
  it("reasignar respeta el tope (conflicto «tope») y mantiene ambos contadores; liberar y baja restan", async () => {
    const { store, service, owners, regs, batch } = await setup(2);
    const [a, b] = owners;
    batch("bA", a, regs.slice(0, 2));
    batch("bB", b, regs.slice(2, 4));
    await service.distributionConfirm("sim-coord", { editionId: ED, batchId: "bA" });
    await service.distributionConfirm("sim-coord", { editionId: ED, batchId: "bB" });
    const full = await fails(service.reassign("sim-coord", { editionId: ED, registrationId: regs[0], toUid: b, reason: "balance", expectedRevision: 2 }));
    expect(full).toMatchObject({ message: "outreach/conflict", details: { reason: "tope" } });
    await service.reassign("sim-coord", { editionId: ED, registrationId: regs[0], toUid: b, reason: "balance", expectedRevision: 2, note: "Caso especial" });
    expect([openCount(store, a), openCount(store, b)]).toEqual([1, 3]);
    await service.doNotContactSet("sim-coord", { editionId: ED, registrationId: regs[1], value: true });
    expect(openCount(store, a)).toBe(0);
    await service.releaseAssignee("sim-coord", { editionId: ED, uid: b, reason: "baja del responsable" });
    expect(openCount(store, b)).toBe(0);
  });
  it("opt-out en el contacto resta y teamSet conserva el contador", async () => {
    const { store, service, owners, regs, batch } = await setup(3);
    const [o] = owners;
    batch("bA", o, regs.slice(0, 2));
    await service.distributionConfirm("sim-coord", { editionId: ED, batchId: "bA" });
    await service.contactRecord(o, { editionId: ED, registrationId: regs[0], requestId: "req-aaaaaa", date: "2026-11-30", channel: "llamada", result: "pidio_no_contacto" });
    expect(openCount(store, o)).toBe(1);
    await service.teamSet("sim-coord", { editionId: ED, members: [{ uid: o, roles: ["responsable"], active: true }] });
    expect(openCount(store, o)).toBe(1);
  });
  it("sin contador previo parte del recuento real", async () => {
    const { store, service, owners, regs, batch } = await setup(2);
    const [o] = owners;
    batch("bA", o, regs.slice(0, 1));
    await service.distributionConfirm("sim-coord", { editionId: ED, batchId: "bA" });
    const team = store.doc(`outreachEditions/${ED}/team`, o)!;
    delete team.openCount;
    store.put(`outreachEditions/${ED}/team`, o, team);
    batch("bB", o, regs.slice(1, 4));
    const r = await service.distributionConfirm("sim-coord", { editionId: ED, batchId: "bB" });
    expect(r.applied).toBe(1);
    expect(openCount(store, o)).toBe(2);
  });
});

describe("lista de revisión", () => {
  const review = (store: OutreachMemoryStore, id: string, at: string, extra: Doc = {}) =>
    store.put("outreachInbox", id, { kind: "review", editionId: ED, externalId: `x-${id}`, sourceRevision: 1, issue: "posible_duplicado", registrationId: null, candidates: [], at: new Date(at), ...extra });

  it("lista solo abiertas, más antiguas primero, con la forma acordada", async () => {
    const { store, service, regs } = await setup();
    review(store, "r2", "2026-11-02T10:00:00Z", { registrationId: regs[0], candidates: [regs[1]] });
    review(store, "r1", "2026-11-01T10:00:00Z");
    review(store, "r3", "2026-11-03T10:00:00Z", { resolution: "dismiss" });
    store.put("outreachInbox", "seen1", { kind: "seen", editionId: ED, externalId: "z", sourceRevision: 1 });
    const out = await service.reviewList("sim-coord", { editionId: ED });
    expect(out.items.map((i: { id: string }) => i.id)).toEqual(["r1", "r2"]);
    expect(out.items[1]).toEqual({ id: "r2", issue: "posible_duplicado", externalId: "x-r2", registrationId: regs[0], candidates: [regs[1]], sourceRevision: 1, createdAt: "2026-11-02T10:00:00.000Z" });
    expect((await service.reviewList("sim-coord", { editionId: ED, limit: 1 })).items).toHaveLength(1);
    expect((await fails(service.reviewList("nobody", { editionId: ED }))).message).toBe("outreach/forbidden");
  });
  it("dismiss y keep_both cierran sin tocar inscripciones; idempotente", async () => {
    const { store, service, regs } = await setup();
    review(store, "r1", "2026-11-01T10:00:00Z", { registrationId: regs[0], candidates: [regs[1]] });
    review(store, "r2", "2026-11-01T11:00:00Z", { registrationId: regs[0], candidates: [regs[1]] });
    const before = JSON.stringify(store.doc("outreachRegistrations", regs[0]));
    expect(await service.reviewResolve("sim-coord", { editionId: ED, reviewId: "r1", resolution: "dismiss", requestId: "req-aaaaaa" })).toMatchObject({ replay: false });
    expect(await service.reviewResolve("sim-coord", { editionId: ED, reviewId: "r1", resolution: "dismiss", requestId: "req-aaaaab" })).toMatchObject({ replay: true });
    expect((await fails(service.reviewResolve("sim-coord", { editionId: ED, reviewId: "r1", resolution: "keep_both", requestId: "req-aaaaac" }))).message).toBe("outreach/conflict");
    await service.reviewResolve("sim-coord", { editionId: ED, reviewId: "r2", resolution: "keep_both", requestId: "req-aaaaad" });
    expect((await service.reviewList("sim-coord", { editionId: ED })).items).toEqual([]);
    expect(JSON.stringify(store.doc("outreachRegistrations", regs[0]))).toBe(before);
  });
  it("mark_duplicate marca la inscripción como duplicada sin borrar ni fusionar, con auditoría", async () => {
    const { store, service, owners, regs, batch } = await setup();
    batch("bA", owners[0], [regs[0]]);
    await service.distributionConfirm("sim-coord", { editionId: ED, batchId: "bA" });
    review(store, "r1", "2026-11-01T10:00:00Z", { registrationId: regs[0], candidates: [regs[1]] });
    const target = store.doc("outreachRegistrations", regs[1]);
    const p = { editionId: ED, reviewId: "r1", resolution: "mark_duplicate", targetRegistrationId: regs[1], note: "misma persona", requestId: "req-aaaaaa" };
    expect((await service.reviewResolve("sim-coord", p)).replay).toBe(false);
    expect((await service.reviewResolve("sim-coord", p)).replay).toBe(true);
    const reg = store.doc("outreachRegistrations", regs[0])!;
    expect(reg).toMatchObject({ status: "duplicada", duplicateOf: regs[1], revision: 3 });
    expect(store.doc("outreachRegistrations", regs[1])).toEqual(target);
    expect(store.all(`outreachRegistrations/${regs[0]}/changes`).map((c) => c.data.action)).toContain("duplicado");
    expect(openCount(store, owners[0])).toBe(0);
  });
  it("mark_duplicate valida destino y ediciones", async () => {
    const { store, service, regs } = await setup();
    review(store, "r1", "2026-11-01T10:00:00Z", { registrationId: regs[0] });
    const base = { editionId: ED, reviewId: "r1", resolution: "mark_duplicate", requestId: "req-aaaaaa" };
    expect((await fails(service.reviewResolve("sim-coord", base))).message).toBe("outreach/invalid-argument");
    expect((await fails(service.reviewResolve("sim-coord", { ...base, targetRegistrationId: regs[0] }))).message).toBe("outreach/invalid-transition");
    store.put("outreachRegistrations", "otra", { ...store.doc("outreachRegistrations", regs[2]), id: "otra", editionId: "vplt-2025" });
    expect((await fails(service.reviewResolve("sim-coord", { ...base, targetRegistrationId: "otra" }))).message).toBe("outreach/not-found");
    expect(store.doc("outreachRegistrations", regs[0])?.status).toBe("activa");
    expect((await fails(service.reviewResolve("sim-coord", { ...base, reviewId: "nada", resolution: "dismiss" }))).message).toBe("outreach/not-found");
  });
});

describe("candidatos y mesas", () => {
  it("teamCandidates devuelve solo uid y nombre de usuarios activos con seguimiento o coordinación", async () => {
    const { service } = await setup();
    const out = await service.teamCandidates("sim-coord", { editionId: ED });
    const uids = out.candidates.map((c: { uid: string }) => c.uid);
    expect(uids).toContain("sim-coord");
    expect(uids).toContain("sim-resp-01");
    expect(uids).not.toContain("nobody");
    expect(uids).not.toContain("gone");
    expect(out.candidates.every((c: Doc) => Object.keys(c).sort().join() === "displayName,uid")).toBe(true);
    expect((await fails(service.teamCandidates("nobody", { editionId: ED }))).message).toBe("outreach/forbidden");
  });
  it("tablesList expone enlace sin hash ni token", async () => {
    const { service, owners } = await setup();
    await service.tablesSet("sim-coord", { editionId: ED, tables: [{ number: 1, leaderUid: owners[0] }, { number: 2, leaderUid: owners[1] }, { number: 3 }] });
    const { token } = await service.tableLinkIssue("sim-coord", { editionId: ED, number: 1 });
    await service.tableLinkIssue("sim-coord", { editionId: ED, number: 2 });
    await service.tableLinkRevoke("sim-coord", { editionId: ED, number: 2 });
    const { tables } = await service.tablesList("sim-coord", { editionId: ED });
    expect(tables.map((t: Doc) => [t.number, t.hasLink, t.linkRevoked])).toEqual([[1, true, false], [2, true, true], [3, false, false]]);
    expect(tables[0]).toMatchObject({ leaderUid: owners[0] });
    expect(Object.keys(tables[0]).sort()).toEqual(["hasLink", "leaderName", "leaderUid", "linkIssuedAt", "linkRevoked", "number"]);
    expect(JSON.stringify(tables)).not.toContain(token);
  });
});

describe("listMine (mesa)", () => {
  async function tables() {
    const ctx = await setup();
    await ctx.service.tablesSet("sim-coord", { editionId: ED, tables: [{ number: 1, leaderUid: ctx.owners[0] }, { number: 2, leaderUid: ctx.owners[1] }] });
    const t1 = (await ctx.service.tableLinkIssue("sim-coord", { editionId: ED, number: 1 })).token as string;
    const t2 = (await ctx.service.tableLinkIssue("sim-coord", { editionId: ED, number: 2 })).token as string;
    const auth = (n: number) => ({ editionId: ED, table: n, token: n === 1 ? t1 : t2 });
    return { ...ctx, auth };
  }
  const mark = (service: Svc, a: Doc, id: string, value: string) => service.tableMark({ ...a, registrationId: id, mark: value, personAgreed: true, requestId: `req-${id}-${value}`.slice(0, 40) });

  it("cada mesa ve solo lo suyo, ordenado, sin teléfono ni correo", async () => {
    const { service, regs, auth } = await tables();
    await mark(service, auth(1), regs[1], "acepto_a_cristo");
    await mark(service, auth(1), regs[0], "desea_conversar");
    await mark(service, auth(2), regs[2], "acepto_a_cristo");
    const mine = await service.tableListMine(auth(1));
    expect(mine.items.map((i: { id: string }) => i.id).sort()).toEqual([regs[0], regs[1]].sort());
    expect(mine.items.every((i: Doc) => Object.keys(i).sort().join() === "fullName,id,mark")).toBe(true);
    expect(mine.window).toEqual({ opensAt: "2026-11-28T16:00", closesAt: "2026-11-29T02:00" });
    expect((await service.tableListMine(auth(2))).items.map((i: { id: string }) => i.id)).toEqual([regs[2]]);
    await service.tableUnmark({ ...auth(1), registrationId: regs[0], requestId: "req-unmark-0001" });
    expect((await service.tableListMine(auth(1))).items.map((i: { id: string }) => i.id)).toEqual([regs[1]]);
  });
  it("token incorrecto, revocado y fuera de ventana se niegan; fuera de ventana trae window", async () => {
    const { service, clock, auth } = await tables();
    expect((await fails(service.tableListMine({ ...auth(1), token: "A".repeat(43) }))).message).toBe("outreach/link-unavailable");
    expect((await fails(service.tableListMine({ ...auth(1), table: 2 }))).message).toBe("outreach/link-unavailable");
    clock.set("2026-11-28T15:00:00-03:00");
    const early = await fails(service.tableListMine(auth(1)));
    expect(early).toMatchObject({ message: "outreach/link-out-of-window", details: { window: { opensAt: "2026-11-28T16:00", closesAt: "2026-11-29T02:00" } } });
    clock.set("2026-11-28T21:00:00-03:00");
    await service.tableLinkRevoke("sim-coord", { editionId: ED, number: 1 });
    expect((await fails(service.tableListMine(auth(1)))).message).toBe("outreach/link-revoked");
  });
  it("cobra la misma cuota por mesa", async () => {
    const { service, auth } = await tables();
    for (let i = 0; i < 120; i += 1) await service.tableListMine(auth(1));
    expect((await fails(service.tableListMine(auth(1)))).message).toBe("outreach/rate-limited");
  });
});
