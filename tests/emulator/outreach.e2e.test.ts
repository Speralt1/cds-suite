// Smoke real de «Ve por los tuyos» (H3b) contra Firestore emulado (proyecto demo-cds-suite):
// el servicio corre en el proceso de prueba con el Admin SDK (transacciones reales de Firestore)
// y un reloj inyectado, porque el enlace de mesa solo vale de noche el día D. Además,
// lecturas con el SDK de cliente bajo las reglas y un smoke de los callables en el emulador.
// Solo `npm run test:emulator`.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, where, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { simRegistrations } from "@/lib/outreach/sim/fixtures";
import { registrationIdFor } from "@/lib/shared/outreach-sync";
import { SEED_FUNCTIONS_ORIGIN, SEED_PROJECT, SEED_REGION } from "../../scripts/seed-platform-calendar-emulator.mjs";
import { emulatorEnv } from "./helpers";

const require = createRequire(import.meta.url);
const nodeRequire = createRequire(path.resolve(__dirname, "../../functions/package.json"));
const { createOutreachService } = require("../../functions/outreach/service.js");
const { createOutreachStore } = require("../../functions/outreach/firestore-store.js");

type Svc = Record<string, (...args: unknown[]) => Promise<Record<string, any>>>; // eslint-disable-line @typescript-eslint/no-explicit-any

const BASE_YEAR = 2040 + (Date.now() % 50);
let yearSeq = 0;
const nextYear = () => BASE_YEAR + (yearSeq += 1);
let rseq = 0;
const RUN = Date.now().toString(36);
const rid = () => `e2e-${RUN}-${String((rseq += 1)).padStart(5, "0")}`;
const v1 = (permissions: string[], displayName: string) => ({ accessSchemaVersion: 1, role: "leader", active: true, baseRole: "standard", permissions, areaIds: [], homeModule: "calendar", displayName });

async function rejected(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return (e as { message?: string; code?: string }).message;
  }
  return null;
}

describe("Ve por los tuyos vía Firestore emulado", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let rules: RulesTestEnvironment;
  let clockMs = Date.now();
  let service: Svc;

  const setClock = (iso: string) => (clockMs = Date.parse(iso));

  beforeAll(async () => {
    const env = emulatorEnv();
    process.env.FIRESTORE_EMULATOR_HOST = env.FIRESTORE_EMULATOR_HOST;
    process.env.GCLOUD_PROJECT = SEED_PROJECT;
    const appMod = nodeRequire("firebase-admin/app");
    const fs = nodeRequire("firebase-admin/firestore");
    const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp({ projectId: SEED_PROJECT });
    db = fs.getFirestore(app);
    service = createOutreachService({ store: createOutreachStore({ db, FieldValue: fs.FieldValue, FieldPath: fs.FieldPath }), clock: { now: () => clockMs }, logger: { error: () => {} } }) as Svc;
    const users: Record<string, object> = {
      "e2e-c1": v1(["members.outreach.coordinate"], "Coordinación Uno"),
      "e2e-c2": v1(["members.outreach.coordinate"], "Coordinación Dos"),
      "e2e-lead-a": v1(["members.outreach.followup_assigned"], "Responsable A"),
      "e2e-lead-b": v1(["members.outreach.followup_assigned"], "Responsable B"),
      "e2e-pastor": v1(["members.outreach.decisions"], "Pastoral"),
    };
    for (const [uid, data] of Object.entries(users)) await db.collection("users").doc(uid).set(data);
    rules = await initializeTestEnvironment({ projectId: SEED_PROJECT, firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") } });
  });
  afterAll(async () => {
    // Otros smokes cuentan los perfiles de `users`: no dejar los nuestros.
    for (const uid of ["e2e-c1", "e2e-c2", "e2e-lead-a", "e2e-lead-b", "e2e-pastor"]) await db.collection("users").doc(uid).delete();
    await rules?.cleanup();
  });

  /** Edición con equipo (A, B), 2 mesas con enlace e inscripciones importadas, en el estado pedido. */
  async function fixture(rows: number) {
    const year = nextYear();
    const editionId = `vplt-${year}`;
    setClock(`${year}-11-28T21:00:00-03:00`);
    await service.editionCreate("e2e-c1", { year, eventDate: `${year}-11-28`, maxPerOwner: 20 });
    await service.teamSet("e2e-c1", {
      editionId,
      members: [
        { uid: "e2e-lead-a", roles: ["responsable"] },
        { uid: "e2e-lead-b", roles: ["responsable"] },
      ],
    });
    await service.tablesSet("e2e-c1", { editionId, tables: [{ number: 1, leaderUid: "e2e-lead-a" }, { number: 2, leaderUid: "e2e-lead-b" }] });
    const sim = simRegistrations({ count: rows, editionId });
    const data = sim.map((r) => ({
      externalId: r.externalRef!.id,
      sourceRevision: r.externalRef!.sourceRevision,
      editionYear: year,
      fullName: r.fullName,
      phone: r.phoneE164,
      email: null,
      invitedByName: null,
      adultConfirmed: true,
      consents: r.consents.map((c) => ({ purpose: c.purpose, textVersion: c.textVersion, grantedAt: c.grantedAt })),
      cancelled: false,
      attendedAt: "2026-11-28T19:40",
    }));
    let rev = (await service.editionTransition("e2e-c1", { editionId, to: "inscripcion", expectedRevision: 1 })).revision;
    const ids = data.map((r) => registrationIdFor(editionId, r.externalId));
    return { year, editionId, data, ids, rev, async toEvento() {
      rev = (await service.editionTransition("e2e-c1", { editionId, to: "evento", expectedRevision: rev })).revision;
    }, async toSeguimiento() {
      rev = (await service.editionTransition("e2e-c1", { editionId, to: "seguimiento", expectedRevision: rev })).revision;
    }, async tokens() {
      const a = (await service.tableLinkIssue("e2e-c1", { editionId, number: 1 })).token as string;
      const b = (await service.tableLinkIssue("e2e-c1", { editionId, number: 2 })).token as string;
      return { 1: a, 2: b } as Record<number, string>;
    } };
  }

  it("dos mesas marcan a la misma persona a la vez: una decisión, un rechazo, inscripción coherente", async () => {
    const f = await fixture(5);
    await service.importRegistrations("e2e-c1", { editionId: f.editionId, rows: f.data });
    await f.toEvento();
    const t = await f.tokens();
    const id = f.ids[0];
    const mark = (table: number, value: string) => service.tableMark({ editionId: f.editionId, table, token: t[table], registrationId: id, mark: value, personAgreed: true, requestId: rid() });
    const results = await Promise.allSettled([mark(1, "acepto_a_cristo"), mark(2, "desea_conversar")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(bad[0].reason.message).toBe("outreach/otra-mesa");
    const decision = (await db.collection("outreachDecisions").doc(id).get()).data()!;
    const reg = (await db.collection("outreachRegistrations").doc(id).get()).data()!;
    expect(reg.tableNumber).toBe(decision.tableNumber);
    expect(decision.value).toBe(decision.tableNumber === 1 ? "acepto_a_cristo" : "desea_conversar");
    expect((await db.collection(`outreachDecisions/${id}/history`).get()).size).toBe(1);
    // misma marca repetida (reintento del cliente) = replay, sin duplicar
    const table = decision.tableNumber as number;
    const again = await service.tableMark({ editionId: f.editionId, table, token: t[table], registrationId: id, mark: decision.value, personAgreed: true, requestId: rid() });
    expect(again.replay).toBe(true);
  });

  it("dos coordinaciones confirman el mismo lote en paralelo: sin doble asignación", async () => {
    const f = await fixture(40);
    await service.importRegistrations("e2e-c1", { editionId: f.editionId, rows: f.data });
    await f.toEvento();
    await f.toSeguimiento();
    const prop = await service.distributionPropose("e2e-c1", { editionId: f.editionId, requestId: rid() });
    expect(prop.summary.assignments).toBe(40);
    const [a, b] = await Promise.all([
      service.distributionConfirm("e2e-c1", { editionId: f.editionId, batchId: prop.batchId }),
      service.distributionConfirm("e2e-c2", { editionId: f.editionId, batchId: prop.batchId }),
    ]);
    expect(a.applied + b.applied).toBe(40);
    expect(a.conflicts.length + b.conflicts.length).toBe(0);
    const regs: Array<Record<string, any>> = (await db.collection("outreachRegistrations").where("editionId", "==", f.editionId).get()).docs.map((d: { data(): Record<string, unknown> }) => d.data()); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(regs.filter((r) => r.ownerUid)).toHaveLength(40);
    const loads: Record<string, number> = {};
    for (const r of regs) loads[r.ownerUid] = (loads[r.ownerUid] || 0) + 1;
    expect(Object.values(loads).every((n) => n <= 20)).toBe(true);
    for (const id of f.ids.slice(0, 5)) expect((await db.collection(`outreachRegistrations/${id}/assignments`).get()).size).toBe(1);
  });

  it("contacto registrado mientras se reasigna: el responsable se re-verifica dentro de la transacción", async () => {
    const f = await fixture(4);
    await service.importRegistrations("e2e-c1", { editionId: f.editionId, rows: f.data });
    await f.toEvento();
    await f.toSeguimiento();
    const prop = await service.distributionPropose("e2e-c1", { editionId: f.editionId, requestId: rid() });
    await service.distributionConfirm("e2e-c1", { editionId: f.editionId, batchId: prop.batchId });
    const id = f.ids[0];
    const before = (await db.collection("outreachRegistrations").doc(id).get()).data()!;
    const oldOwner = before.ownerUid as string;
    const newOwner = oldOwner === "e2e-lead-a" ? "e2e-lead-b" : "e2e-lead-a";
    const contact = { editionId: f.editionId, registrationId: id, requestId: rid(), date: "2026-11-30", channel: "llamada", result: "contactado" };
    const [c, r] = await Promise.allSettled([
      service.contactRecord(oldOwner, contact),
      service.reassign("e2e-c1", { editionId: f.editionId, registrationId: id, toUid: newOwner, reason: "equilibrio", expectedRevision: before.revision }),
    ]);
    const after = (await db.collection("outreachRegistrations").doc(id).get()).data()!;
    const contacts = (await db.collection(`outreachRegistrations/${id}/contacts`).get()).docs.map((d: { data(): Record<string, unknown> }) => d.data());
    expect(contacts.every((x: Record<string, unknown>) => x.byUid === oldOwner)).toBe(true);
    if (r.status === "fulfilled") {
      expect(after.ownerUid).toBe(newOwner);
      // el responsable anterior ya no puede registrar nada
      expect(await rejected(service.contactRecord(oldOwner, { ...contact, requestId: rid() }))).toBe("outreach/not-assigned");
      // si el contacto ganó la carrera, se registró ANTES de la reasignación (revisión coherente)
      if (c.status === "fulfilled") expect(contacts).toHaveLength(1);
      else expect(contacts).toHaveLength(0);
    } else {
      // la reasignación perdió por revisión: el responsable sigue siendo el mismo
      expect(r.reason.message).toBe("outreach/conflict");
      expect(after.ownerUid).toBe(oldOwner);
      expect(c.status).toBe("fulfilled");
    }
    // determinista: reasignar primero y luego contactar → no asignada
    const rev2 = (await db.collection("outreachRegistrations").doc(f.ids[1]).get()).data()!;
    const o2 = rev2.ownerUid as string;
    await service.reassign("e2e-c1", { editionId: f.editionId, registrationId: f.ids[1], toUid: o2 === "e2e-lead-a" ? "e2e-lead-b" : "e2e-lead-a", reason: "x", expectedRevision: rev2.revision });
    expect(await rejected(service.contactRecord(o2, { ...contact, registrationId: f.ids[1], requestId: rid() }))).toBe("outreach/not-assigned");
  });

  it("importación aplicada dos veces a la vez: 300 inscripciones", async () => {
    const f = await fixture(300);
    const run = () => service.importRegistrations("e2e-c1", { editionId: f.editionId, rows: f.data });
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.report.created + b.report.created).toBe(300);
    expect((await db.collection("outreachRegistrations").where("editionId", "==", f.editionId).get()).size).toBe(300);
    const third = await run();
    expect(third.report).toMatchObject({ created: 0, updated: 0, unchanged: 300 });
  });

  it("un responsable lee solo sus inscripciones y decisiones con los where() exigidos por las reglas", async () => {
    const f = await fixture(6);
    await service.importRegistrations("e2e-c1", { editionId: f.editionId, rows: f.data });
    await f.toEvento();
    const t = await f.tokens();
    for (const [i, id] of f.ids.entries()) {
      const table = i % 2 === 0 ? 1 : 2;
      await service.tableMark({ editionId: f.editionId, table, token: t[table], registrationId: id, mark: "desea_conversar", personAgreed: true, requestId: rid() });
    }
    await f.toSeguimiento();
    const prop = await service.distributionPropose("e2e-c1", { editionId: f.editionId, requestId: rid() });
    await service.distributionConfirm("e2e-c1", { editionId: f.editionId, batchId: prop.batchId });

    const client = (uid: string) => rules.authenticatedContext(uid).firestore() as unknown as Firestore;
    const mineRegs = (uid: string) => getDocs(query(collection(client(uid), "outreachRegistrations"), where("assigneeUid", "==", uid), where("editionActive", "==", true)));
    const mineDecs = (uid: string) => getDocs(query(collection(client(uid), "outreachDecisions"), where("assigneeUid", "==", uid), where("editionActive", "==", true)));
    const a = await mineRegs("e2e-lead-a");
    const aDec = await mineDecs("e2e-lead-a");
    expect(a.docs.filter((d) => d.data().editionId === f.editionId)).toHaveLength(3);
    expect(aDec.docs.filter((d) => d.data().editionId === f.editionId)).toHaveLength(3);
    expect(a.docs.every((d) => d.data().assigneeUid === "e2e-lead-a")).toBe(true);
    // sin filtros, o con el uid de otro, las reglas deniegan
    await expect(getDocs(collection(client("e2e-lead-a"), "outreachRegistrations"))).rejects.toThrow();
    await expect(getDocs(collection(client("e2e-lead-a"), "outreachDecisions"))).rejects.toThrow();
    await expect(getDocs(query(collection(client("e2e-lead-a"), "outreachDecisions"), where("assigneeUid", "==", "e2e-lead-b"), where("editionActive", "==", true)))).rejects.toThrow();
    await expect(getDoc(doc(client("e2e-lead-a"), "outreachDecisions", f.ids[1]))).rejects.toThrow(); // decisión de B
    // el hash del enlace no es legible por nadie
    await expect(getDoc(doc(client("e2e-c1"), `outreachEditions/${f.editionId}/tableSecrets/1`))).rejects.toThrow();
    // coordinación ve inscripciones pero no decisiones; pastoral ve decisiones
    expect((await getDocs(query(collection(client("e2e-c1"), "outreachRegistrations"), where("editionId", "==", f.editionId)))).size).toBe(6);
    await expect(getDocs(query(collection(client("e2e-c1"), "outreachDecisions"), where("editionId", "==", f.editionId)))).rejects.toThrow();
    expect((await getDocs(query(collection(client("e2e-pastor"), "outreachDecisions"), where("editionId", "==", f.editionId)))).size).toBe(6);
  });

  it("callables en el emulador: la mesa no pide sesión pero sí token; coordinación pide sesión", async () => {
    const call = async (name: string, data: unknown) => {
      const res = await fetch(`${SEED_FUNCTIONS_ORIGIN}/${SEED_PROJECT}/${SEED_REGION}/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
      return { status: res.status, ...((await res.json()) as { error?: { status?: string; message?: string } }) };
    };
    const table = await call("outreachTableOp", { op: "search", payload: { editionId: "vplt-2099", table: 1, token: "A".repeat(43), q: "Persona" } });
    expect(table.error).toMatchObject({ status: "PERMISSION_DENIED", message: "outreach/link-unavailable" });
    const coord = await call("outreachCoordinatorOp", { op: "stats", payload: { editionId: "vplt-2099" } });
    expect(coord.error).toMatchObject({ status: "UNAUTHENTICATED", message: "outreach/unauthenticated" });
    const bad = await call("outreachDecisionOp", { op: "nope", payload: {} });
    expect(bad.error).toMatchObject({ status: "INVALID_ARGUMENT" });
  });
});
