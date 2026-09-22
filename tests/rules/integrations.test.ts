import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { saveTransaction } from "../../lib/finance/transactions";
import type { TransactionInput } from "../../lib/finance/types";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-cds-suite",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});

afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "finance-user"), {
      displayName: "Finanzas",
      email: "finance@example.com",
      role: "finance",
      active: true,
      createdAt: new Date(),
    });
    await setDoc(doc(db, "sumupIntegrations", "offerings"), {
      account: "offerings",
      configured: true,
    });
  });
});

describe("Ofrendas públicas e integración SumUp", () => {
  it("permite leer configuración pública pero no modificarla anónimamente", async () => {
    const finance = env.authenticatedContext("finance-user").firestore();
    await assertSucceeds(setDoc(doc(finance, "publicGivingSettings", "current"), {
      title: "Ofrendar",
      intro: "",
      transferEnabled: true,
      transferInstructions: "",
      onlineEnabled: false,
      onlineLabel: "Pagar online",
      onlineUrl: "",
      updatedAt: serverTimestamp(),
    }));
    const publicDb = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(publicDb, "publicGivingSettings", "current")));
    await assertFails(setDoc(doc(publicDb, "publicGivingSettings", "current"), {
      title: "Manipulado",
      intro: "",
      transferEnabled: true,
      transferInstructions: "",
      onlineEnabled: false,
      onlineLabel: "",
      onlineUrl: "",
      updatedAt: serverTimestamp(),
    }));
  });

  it("SumUp es privado y de solo lectura para el cliente", async () => {
    const publicDb = env.unauthenticatedContext().firestore();
    const finance = env.authenticatedContext("finance-user").firestore();
    await assertFails(getDoc(doc(publicDb, "sumupIntegrations", "offerings")));
    await assertSucceeds(getDoc(doc(finance, "sumupIntegrations", "offerings")));
    await assertFails(setDoc(doc(finance, "sumupIntegrations", "offerings"), { account: "offerings", configured: false }));
  });

  it("sumupSyncRuns, versions y adjustments son legibles por finanzas pero de solo lectura (S1.2/S1.8)", async () => {
    const publicDb = env.unauthenticatedContext().firestore();
    const finance = env.authenticatedContext("finance-user").firestore();

    await assertSucceeds(getDoc(doc(finance, "sumupSyncRuns", "run-1")));
    await assertFails(getDoc(doc(publicDb, "sumupSyncRuns", "run-1")));
    await assertFails(setDoc(doc(finance, "sumupSyncRuns", "run-1"), { status: "completed" }));

    await assertSucceeds(getDoc(doc(finance, "sumupIntegrations", "offerings", "transactions", "tx-1", "versions", "v1")));
    await assertFails(
      setDoc(doc(finance, "sumupIntegrations", "offerings", "transactions", "tx-1", "versions", "v1"), { at: serverTimestamp() }),
    );

    await assertSucceeds(getDoc(doc(finance, "sumupIntegrations", "offerings", "adjustments", "cb-1")));
    await assertFails(setDoc(doc(finance, "sumupIntegrations", "offerings", "adjustments", "cb-1"), { reviewRequired: true }));
  });

  // S1.12 — documenta el estado ACTUAL de firestore.rules: financeTransactions
  // no distingue el prefijo `sumup_*`, así que un usuario de finanzas puede
  // editar (o "anular") un documento creado por el sync sin que las reglas lo
  // impidan. Cerrar esto es el Gate G3 (Navigator/Atlas), fuera de este slice.
  describe("G3 (pendiente): el cliente puede editar sumup_* hoy", () => {
    let db: Firestore;
    const input: TransactionInput = {
      type: "income",
      amount: 10000,
      date: "2026-09-15",
      category: "Ofrendas",
      paymentMethod: "card",
      description: "Ofrenda tarjeta física · SumUp",
      note: "SumUp COD-1",
    };

    beforeEach(() => {
      db = env.authenticatedContext("finance-user").firestore() as unknown as Firestore;
    });

    it("un doc sumup_* creado por el sistema puede ser editado por un usuario de finanzas", async () => {
      const id = "sumup_offerings_tx-1";
      await saveTransaction(db, "finance-user", id, input);
      const before = { id, ...(await getDoc(doc(db, "financeTransactions", id))).data() } as never;

      // Documents today's gap: nothing in the rules distinguishes this id as
      // system-owned, so a normal finance-role edit succeeds.
      await expect(
        saveTransaction(db, "finance-user", id, { ...input, amount: 7777 }, { existing: before }),
      ).resolves.toBeDefined();

      const after = await getDoc(doc(db, "financeTransactions", id));
      expect(after.data()?.amount).toBe(7777);
    });
  });
});
