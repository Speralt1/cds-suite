// Smoke real del callable sumupPayoutsReconciliation a través del emulador de
// Functions (doc 29). En el emulador la Function NUNCA sale a la red
// (emulator_offline) y los secrets no existen (config_error): aquí se prueba el
// cableado real (región, onCall, auth, validación) y que no escribe nada.
// Solo `npm run test:emulator`.
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, setDoc, Timestamp, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED_FUNCTIONS_ORIGIN, SEED_PROJECT, SEED_REGION } from "../../scripts/seed-platform-calendar-emulator.mjs";
import { seed, signIn } from "./helpers";

const URL_ = `${SEED_FUNCTIONS_ORIGIN}/${SEED_PROJECT}/${SEED_REGION}/sumupPayoutsReconciliation`;
const WATCHED = ["financeTransactions", "financeMonthlySummaries", "sumupSyncRuns", "sumupIntegrations", "sumupIntegrations/offerings/transactions"];

async function callPayouts(idToken: string | null, data: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(URL_, { method: "POST", headers, body: JSON.stringify({ data }) });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as { result?: Record<string, unknown>; error?: { status?: string; message?: string } } };
}

describe("sumupPayoutsReconciliation vía emulador de Functions", () => {
  let rules: RulesTestEnvironment;
  let admin = "";
  let finance = "";
  let leader = "";

  async function snapshot(): Promise<string> {
    let out = "";
    await rules.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      const parts: string[] = [];
      for (const path of WATCHED) {
        const snap = await getDocs(collection(db, path));
        parts.push(`${path}:${JSON.stringify(snap.docs.map((d) => [d.id, d.data()]).sort())}`);
      }
      out = parts.join("\n");
    });
    return out;
  }

  beforeAll(async () => {
    await seed();
    rules = await initializeTestEnvironment({ projectId: SEED_PROJECT, firestore: { host: "127.0.0.1", port: 8080 } });
    // Venta ficticia importada (fixture del test; la Function solo la lee).
    await rules.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "sumupIntegrations/offerings/transactions/FICT-E2E-1"), {
        account: "offerings",
        transactionCode: "FICTE2E1",
        grossAmount: 5000,
        refundedAmount: 0,
        amountAfterRefunds: 5000,
        status: "SUCCESSFUL",
        paymentType: "POS",
        currency: "CLP",
        timestamp: Timestamp.fromDate(new Date("2026-10-11T15:00:00.000Z")),
      });
    });
    admin = await signIn("admin@cds.test");
    finance = await signIn("finanzas@cds.test");
    leader = await signIn("lider.jovenes@cds.test");
  });

  afterAll(async () => {
    await rules?.cleanup();
  });

  it("sin sesión → UNAUTHENTICATED", async () => {
    const res = await callPayouts(null, { startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(res.status).toBe(401);
    expect(res.json.error).toMatchObject({ status: "UNAUTHENTICATED", message: "sumup-payouts/unauthenticated" });
  });

  it("líder (sin finance.details.read) → PERMISSION_DENIED", async () => {
    const res = await callPayouts(leader, { startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(res.status).toBe(403);
    expect(res.json.error).toMatchObject({ status: "PERMISSION_DENIED", message: "sumup-payouts/forbidden" });
  });

  it("> 35 días → INVALID_ARGUMENT", async () => {
    const res = await callPayouts(admin, { startDate: "2026-09-01", endDate: "2026-10-31" });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatchObject({ status: "INVALID_ARGUMENT", message: "sumup-payouts/window-too-long" });
  });

  it("finanzas/admin → 200 solo lectura; sin red en el emulador y sin escribir nada", async () => {
    const before = await snapshot();
    for (const token of [admin, finance]) {
      const res = await callPayouts(token, { account: "both", startDate: "2026-10-01", endDate: "2026-10-31" });
      expect(res.status).toBe(200);
      const result = res.json.result as { readOnly: boolean; accounts: { ok: boolean; account: string; errorClass: string }[]; period: unknown };
      expect(result.readOnly).toBe(true);
      expect(result.period).toEqual({ startDate: "2026-10-01", endDate: "2026-10-31" });
      expect(result.accounts.map((a) => a.account)).toEqual(["offerings", "cafeteria"]);
      for (const a of result.accounts) {
        expect(a.ok).toBe(false);
        expect(["emulator_offline", "config_error"]).toContain(a.errorClass);
      }
      expect(res.text).not.toMatch(/apiKey|merchantCode|sup_sk_/);
    }
    expect(await snapshot()).toBe(before);
  });
});
