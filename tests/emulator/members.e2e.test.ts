// Smoke real de Integrantes › Consolidación V1 (doc 23 §4–5): los 6 callables
// a través del emulador de Functions (con Auth y Firestore emulados) y las
// reglas de lectura/escritura de las 4 colecciones members*.
// Solo `npm run test:emulator` (proyecto demo-cds-suite).
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localToday } from "@/lib/shared/dates";
import { MEMBERS_CALLABLES, MEMBERS_COLLECTIONS, MEMBERS_ERROR_KEYS } from "@/lib/shared/members";
import { SEED_FUNCTIONS_ORIGIN, SEED_PROJECT, SEED_REGION } from "../../scripts/seed-platform-calendar-emulator.mjs";
import { seededPersonIds } from "../../scripts/seed-members-emulator.mjs";
import { seed, signIn } from "./helpers";

type Callable = keyof typeof MEMBERS_CALLABLES;

interface CallResult {
  status: number;
  result?: Record<string, unknown>;
  error?: { status?: string; message?: string; details?: { fields?: Record<string, string> } };
}

/** Protocolo callable HTTP: POST {data} → {result} | {error}. */
async function call(idToken: string | null, method: Callable, data: unknown): Promise<CallResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const url = `${SEED_FUNCTIONS_ORIGIN}/${SEED_PROJECT}/${SEED_REGION}/${MEMBERS_CALLABLES[method]}`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ data }) });
  const json = (await res.json()) as Omit<CallResult, "status">;
  return { status: res.status, ...json };
}

const RUN = Date.now().toString(36);
let n = 0;
const requestId = () => `e2e-${RUN}-${++n}`;

describe("Consolidación V1 vía emulador de Functions", () => {
  let rules: RulesTestEnvironment;
  let today = "";
  let coord = "";
  let apoyo = "";
  let leader = "";
  let personId = "";
  const db = (uid: string) => rules.authenticatedContext(uid).firestore() as unknown as Firestore;

  async function adminRead(path: string) {
    let data: Record<string, unknown> | undefined;
    await rules.withSecurityRulesDisabled(async (ctx) => {
      data = (await getDoc(doc(ctx.firestore() as unknown as Firestore, path))).data();
    });
    return data;
  }

  async function adminQuery(name: string, field: string, value: string) {
    let rows: Record<string, unknown>[] = [];
    await rules.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDocs(query(collection(ctx.firestore() as unknown as Firestore, name), where(field, "==", value)));
      rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });
    return rows;
  }

  beforeAll(async () => {
    await seed();
    today = localToday(Date.now());
    rules = await initializeTestEnvironment({
      projectId: "demo-cds-suite",
      firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") },
    });
    [coord, apoyo, leader] = await Promise.all([signIn("consolidacion@cds.test"), signIn("apoyo.consolidacion@cds.test"), signIn("lider.jovenes@cds.test")]);
  });

  afterAll(async () => {
    await rules?.cleanup();
  });

  it("el seed dejó las 14 personas ficticias en el emulador", async () => {
    for (const id of seededPersonIds()) expect(await adminRead(`${MEMBERS_COLLECTIONS.people}/${id}`), id).toBeDefined();
  });

  it("sin sesión → UNAUTHENTICATED members/unauthenticated", async () => {
    const res = await call(null, "ownerOptions", {});
    expect(res.status).toBe(401);
    expect(res.error).toMatchObject({ status: "UNAUTHENTICATED", message: MEMBERS_ERROR_KEYS.unauthenticated });
  });

  it("ownerOptions con solo lectura: activos con manage, sin correos", async () => {
    const res = await call(apoyo, "ownerOptions", {});
    expect(res.status).toBe(200);
    const owners = res.result!.owners as { uid: string; displayName: string }[];
    const uids = owners.map((o) => o.uid);
    expect(uids).toEqual(expect.arrayContaining(["seed-coord-consolidacion", "seed-admin"]));
    for (const excluded of ["seed-apoyo-consolidacion", "seed-lider-jovenes", "seed-inactivo", "seed-pastor"]) expect(uids).not.toContain(excluded);
    expect(JSON.stringify(owners)).not.toContain("@");
  });

  it("crear → visita → seguimiento → estado (manage), con replay y auditoría", async () => {
    const createPayload = {
      requestId: requestId(),
      fullName: "Persona E2E Ficticia",
      phone: "9 0000 0001", // mismo teléfono que una persona sembrada → advertencia, no bloqueo
      email: "E2E.Ficticia@Example.TEST",
      firstVisitDate: today,
      calendarEventId: "seed-culto-dominical",
      followUpOwnerUid: "seed-coord-consolidacion",
    };
    const created = await call(coord, "personCreate", createPayload);
    expect(created.status).toBe(200);
    expect(created.result).toMatchObject({ revision: 1, replay: false });
    personId = created.result!.personId as string;
    expect(personId).toMatch(/^[0-9a-f]{24}$/);
    expect((created.result!.duplicates as { by: string[] }[]).some((d) => d.by.includes("telefono"))).toBe(true);

    const replay = await call(coord, "personCreate", createPayload);
    expect(replay.result).toMatchObject({ personId, replay: true, revision: 1 });

    const person = await adminRead(`${MEMBERS_COLLECTIONS.people}/${personId}`);
    expect(person).toMatchObject({
      fullName: "Persona E2E Ficticia",
      phoneE164: "+56900000001",
      email: "e2e.ficticia@example.test",
      entryDate: today,
      consolidationStatus: "por_contactar",
      lifecycleStage: "en_consolidacion",
      calendarEventId: "seed-culto-dominical",
      followUpOwnerUid: "seed-coord-consolidacion",
      createdBy: "seed-coord-consolidacion",
      visitCount: 1,
      revision: 1,
    });
    expect(person!.createdAt).toBeTruthy();

    const visit = await call(coord, "visitCreate", { requestId: requestId(), personId, date: today, note: "Volvió el domingo." });
    expect(visit.status).toBe(200);
    expect(visit.result).toMatchObject({ personId, revision: 2, replay: false, suggestReopen: false });

    const follow = await call(coord, "followUpCreate", {
      requestId: requestId(),
      personId,
      contactDate: today,
      type: "whatsapp",
      result: "contactado",
      nextAction: "Invitar a la reunión",
      nextActionDate: today,
      applyStatus: "en_seguimiento",
    });
    expect(follow.status).toBe(200);
    expect(follow.result).toMatchObject({ personId, revision: 3, applied: { status: "en_seguimiento", doNotContact: false } });

    const status = await call(coord, "statusChange", { personId, expectedRevision: 3, status: "integrandose" });
    expect(status.result).toEqual({ personId, revision: 4 });

    const stale = await call(coord, "statusChange", { personId, expectedRevision: 3, status: "en_seguimiento" });
    expect(stale.error).toMatchObject({ status: "ABORTED", message: MEMBERS_ERROR_KEYS.conflict });

    const after = await adminRead(`${MEMBERS_COLLECTIONS.people}/${personId}`);
    expect(after).toMatchObject({ consolidationStatus: "integrandose", visitCount: 2, followUpCount: 1, firstContactDate: today, nextAction: "Invitar a la reunión", revision: 4 });
    const visits = await adminQuery(MEMBERS_COLLECTIONS.visits, "personId", personId);
    expect(visits).toHaveLength(2);
    const changes = await adminQuery(MEMBERS_COLLECTIONS.changes, "personId", personId);
    expect(changes.map((c) => c.action).sort()).toEqual(
      ["follow_up_recorded", "owner_changed", "person_created", "status_changed", "status_changed", "visit_recorded"].sort(),
    );
    for (const c of changes) expect(c.actorUid).toBe("seed-coord-consolidacion");
    // El calendario no se tocó (ni el título se copió).
    expect(JSON.stringify(after)).not.toContain("Culto dominical");
  });

  it("argumentos inválidos → INVALID_ARGUMENT con códigos por campo (sin eco de valores)", async () => {
    const res = await call(coord, "personCreate", { requestId: requestId(), fullName: "X", phone: "12", firstVisitDate: today, religion: "x" });
    expect(res.error).toMatchObject({ status: "INVALID_ARGUMENT", message: MEMBERS_ERROR_KEYS.invalidArgument, details: { fields: { phone: "invalid", religion: "unknown_field" } } });
  });

  it("solo lectura y líder de calendario → PERMISSION_DENIED members/forbidden", async () => {
    for (const token of [apoyo, leader]) {
      const res = await call(token, "personCreate", { requestId: requestId(), fullName: "No Debe Existir", phone: "+56900000077", firstVisitDate: today });
      expect(res.status).toBe(403);
      expect(res.error).toMatchObject({ status: "PERMISSION_DENIED", message: MEMBERS_ERROR_KEYS.forbidden });
    }
    expect(await adminQuery(MEMBERS_COLLECTIONS.people, "phoneE164", "+56900000077")).toHaveLength(0);
    const leaderOwners = await call(leader, "ownerOptions", {});
    expect(leaderOwners.error).toMatchObject({ status: "PERMISSION_DENIED", message: MEMBERS_ERROR_KEYS.forbidden });
  });

  // ---- Reglas (doc 23 §4): escritura del cliente denegada; lectura solo con members.consolidation.* o admin ----

  it("reglas: el cliente nunca escribe en las colecciones members*, ni con manage", async () => {
    const coordDb = db("seed-coord-consolidacion");
    await expect(setDoc(doc(coordDb, MEMBERS_COLLECTIONS.people, "cliente-directo"), { fullName: "Directo" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(updateDoc(doc(coordDb, MEMBERS_COLLECTIONS.people, personId), { doNotContact: true })).rejects.toMatchObject({ code: "permission-denied" });
    for (const name of [MEMBERS_COLLECTIONS.visits, MEMBERS_COLLECTIONS.followUps, MEMBERS_COLLECTIONS.changes]) {
      await expect(setDoc(doc(coordDb, name, "cliente-directo"), { personId })).rejects.toMatchObject({ code: "permission-denied" });
    }
    await expect(setDoc(doc(db("seed-admin"), MEMBERS_COLLECTIONS.people, "cliente-admin"), { fullName: "Admin" })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("reglas: members.consolidation.read lee personas e historial (get y list)", async () => {
    const apoyoDb = db("seed-apoyo-consolidacion");
    expect((await getDoc(doc(apoyoDb, MEMBERS_COLLECTIONS.people, personId))).exists()).toBe(true);
    const list = await getDocs(query(collection(apoyoDb, MEMBERS_COLLECTIONS.people), orderBy("entryDate", "desc"), limit(50)));
    expect(list.size).toBeGreaterThan(0);
    for (const name of [MEMBERS_COLLECTIONS.visits, MEMBERS_COLLECTIONS.followUps]) {
      const snap = await getDocs(query(collection(apoyoDb, name), where("personId", "==", personId), orderBy("createdAt", "desc")));
      expect(snap.size, name).toBeGreaterThan(0);
    }
    const changes = await getDocs(query(collection(apoyoDb, MEMBERS_COLLECTIONS.changes), where("personId", "==", personId), orderBy("at", "desc")));
    expect(changes.size).toBeGreaterThan(0);
    // Admin legacy también lee.
    expect((await getDoc(doc(db("seed-admin"), MEMBERS_COLLECTIONS.people, personId))).exists()).toBe(true);
  });

  it("reglas: líder solo calendario, pastor legacy, sin módulos e inactivo NO leen membersPeople (get ni list)", async () => {
    for (const uid of ["seed-lider-jovenes", "seed-pastor", "seed-sin-modulos", "seed-inactivo"]) {
      const userDb = db(uid);
      await expect(getDoc(doc(userDb, MEMBERS_COLLECTIONS.people, personId)), uid).rejects.toMatchObject({ code: "permission-denied" });
      await expect(getDocs(collection(userDb, MEMBERS_COLLECTIONS.people)), uid).rejects.toMatchObject({ code: "permission-denied" });
      await expect(getDocs(query(collection(userDb, MEMBERS_COLLECTIONS.changes), where("personId", "==", personId))), uid).rejects.toMatchObject({
        code: "permission-denied",
      });
    }
  });
});
