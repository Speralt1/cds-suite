// Smoke real del seed local (ciclo 1): movimientos financieros escritos por
// reglas reales, usuario sin módulos y nombres visibles en el estado del enlace.
// Solo `npm run test:emulator` (proyecto demo-cds-suite).
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED_USERS, buildFinanceSeed } from "../../scripts/seed-platform-calendar-emulator.mjs";
import { callShareLink, seed, signIn } from "./helpers";

describe("seed local contra los emuladores", () => {
  let rules: RulesTestEnvironment;
  let today = "";
  const db = (uid: string) => rules.authenticatedContext(uid).firestore() as unknown as Firestore;

  beforeAll(async () => {
    const first = await seed();
    today = first.today;
    // segunda corrida: idempotente para finanzas (no duplica ni reescribe)
    const second = await seed();
    expect(second.finance.created).toBe(0);
    expect(second.finance.skipped).toBe(buildFinanceSeed(second.today).length);
    rules = await initializeTestEnvironment({
      projectId: "demo-cds-suite",
      firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") },
    });
  });

  afterAll(async () => {
    await rules?.cleanup();
  });

  it("finanzas: los movimientos ficticios existen, con resumen mensual coherente, legibles por finanzas", async () => {
    const items = buildFinanceSeed(today);
    const snap = await getDocs(collection(db("seed-finanzas"), "financeTransactions"));
    const byId = new Map(snap.docs.map((d) => [d.id, d.data()]));
    for (const item of items) {
      const t = byId.get(item.id);
      expect(t, item.id).toBeDefined();
      expect(t).toMatchObject({ type: item.input.type, amount: item.input.amount, category: item.input.category, status: "active", source: "general", createdBy: "seed-finanzas" });
    }
    const period = today.slice(0, 7);
    const summary = (await getDoc(doc(db("seed-finanzas"), "financeMonthlySummaries", period))).data();
    if (items.some((i) => i.input.date.startsWith(period))) {
      const income = items.filter((i) => i.input.date.startsWith(period) && i.input.type === "income").reduce((a, i) => a + i.input.amount, 0);
      expect(summary, period).toBeDefined();
      expect(summary!.incomeTotal as number).toBeGreaterThanOrEqual(income);
    }
  });

  it("sinmodulos@cds.test inicia sesión, su perfil es v1 activo sin permisos y no lee finanzas ni calendario", async () => {
    const u = SEED_USERS.find((x) => x.email === "sinmodulos@cds.test")!;
    expect(await signIn(u.email)).toBeTruthy();
    const me = (await getDoc(doc(db(u.uid), "users", u.uid))).data();
    expect(me).toMatchObject({ accessSchemaVersion: 1, active: true, permissions: [], areaIds: [] });
    await expect(getDocs(collection(db(u.uid), "financeTransactions"))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(getDocs(collection(db(u.uid), "calendarEvents"))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("estado del enlace vía callable: createdByName es el nombre visible, sin correos ni uids", async () => {
    const res = await callShareLink(await signIn("pastor@cds.test"), "status");
    expect(res.status).toBe(200);
    const pastor = SEED_USERS.find((x) => x.uid === "seed-pastor")!;
    expect(res.result?.status).toMatchObject({ exists: true, active: true, createdByName: pastor.displayName, regeneratedByName: null, disabledByName: null });
    const json = JSON.stringify(res.result);
    expect(json).not.toMatch(/@|seed-pastor|[0-9a-f]{64}/);
  });

  it("pausar como admin registra disabledByName; reactivar lo limpia", async () => {
    const adminToken = await signIn("admin@cds.test");
    const admin = SEED_USERS.find((x) => x.uid === "seed-admin")!;
    const off = await callShareLink(adminToken, "deactivate");
    expect(off.result?.status).toMatchObject({ active: false, disabledByName: admin.displayName });
    const on = await callShareLink(adminToken, "activate");
    expect(on.result?.status).toMatchObject({ active: true, disabledByName: null });
  });
});
