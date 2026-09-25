import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, type Firestore } from "firebase/firestore";
import { saveTransaction, voidTransaction } from "../../lib/finance/transactions";
import type { FinanceTransaction, TransactionInput } from "../../lib/finance/types";

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

  // Slice 3a (2026-09-25): sumupPayouts y sumupDailySettlement son de solo
  // backend, igual que sumupIntegrations/sumupSyncRuns — el cliente puede
  // leer (para mostrar comisión/depósito) pero nunca escribir, y
  // financeTransactions/sumup_fee_* queda cubierto por G3
  // (providerOwnedFinanceTransaction matchea '^sumup_.*').
  it("sumupPayouts y sumupDailySettlement son legibles por finanzas pero de solo lectura", async () => {
    const publicDb = env.unauthenticatedContext().firestore();
    const finance = env.authenticatedContext("finance-user").firestore();

    await assertFails(getDoc(doc(publicDb, "sumupPayouts", "offerings_PAYOUT_row-1_COD-1")));
    await assertSucceeds(getDoc(doc(finance, "sumupPayouts", "offerings_PAYOUT_row-1_COD-1")));
    await assertFails(
      setDoc(doc(finance, "sumupPayouts", "offerings_PAYOUT_row-1_COD-1"), { account: "offerings", amount: 9660 }),
    );
    await assertSucceeds(
      getDoc(doc(finance, "sumupPayouts", "offerings_PAYOUT_row-1_COD-1", "versions", "v1")),
    );
    await assertFails(
      setDoc(doc(finance, "sumupPayouts", "offerings_PAYOUT_row-1_COD-1", "versions", "v1"), { replacedAt: serverTimestamp() }),
    );

    await assertFails(getDoc(doc(publicDb, "sumupDailySettlement", "offerings_2026-09-10")));
    await assertSucceeds(getDoc(doc(finance, "sumupDailySettlement", "offerings_2026-09-10")));
    await assertFails(
      setDoc(doc(finance, "sumupDailySettlement", "offerings_2026-09-10"), { bruto: 1000000 }),
    );
  });

  it("sumup_fee_* (financeTransactions) es de solo lectura para el cliente, igual que el resto de G3", async () => {
    const publicDb = env.unauthenticatedContext().firestore();
    const finance = env.authenticatedContext("finance-user").firestore();
    await assertFails(getDoc(doc(publicDb, "financeTransactions", "sumup_fee_offerings_2026-09-10")));
    await assertFails(
      setDoc(doc(finance, "financeTransactions", "sumup_fee_offerings_2026-09-10"), {
        type: "expense",
        amount: 34083,
        date: Timestamp.fromDate(new Date("2026-09-10T15:00:00.000Z")),
        period: "2026-09",
        day: "10",
        category: "Comisión SumUp · Ofrendas",
        paymentMethod: "card",
        description: "Comisión SumUp",
        note: "",
        source: "general",
        status: "active",
        revision: 1,
        createdBy: "finance-user",
        createdAt: serverTimestamp(),
        updatedBy: "finance-user",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  // G3 cerrado 2026-09-23: los movimientos importados por SumUp son
  // propiedad del backend. Un cliente puede leerlos, pero no crearlos,
  // editarlos ni anularlos. Cloud Functions/Admin SDK sigue pudiendo escribir.
  describe("G3: sumup_* es de solo lectura para clientes", () => {
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

    async function seedSystemSumUp(id: string) {
      await env.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        const stamp = Timestamp.fromDate(new Date("2026-09-15T15:00:00.000Z"));
        await setDoc(doc(adminDb, "financeTransactions", id), {
          type: "income",
          amount: 10000,
          date: stamp,
          period: "2026-09",
          day: "15",
          category: "Ofrendas",
          paymentMethod: "card",
          description: "Ofrenda tarjeta física · SumUp",
          note: "SumUp COD-1",
          source: "general",
          status: "active",
          revision: 1,
          createdBy: "system:sumup",
          createdAt: stamp,
          updatedBy: "system:sumup",
          updatedAt: stamp,
        });
        await setDoc(doc(adminDb, "financeMonthlySummaries", "2026-09"), {
          incomeTotal: 10000,
          expenseTotal: 0,
          result: 10000,
          titheTotal: 0,
          transactionCount: 1,
          incomeByCategory: { Ofrendas: 10000 },
          expenseByCategory: {},
          dailyIncome: { "15": 10000 },
          dailyExpense: {},
          updatedAt: stamp,
          lastTransactionId: id,
        });
      });
    }

    it("rechaza crear sumup_* desde un cliente financiero", async () => {
      await assertFails(saveTransaction(db, "finance-user", "sumup_offerings_fake", input));
    });

    it("rechaza editar y anular un sumup_* creado por el sistema", async () => {
      const id = "sumup_offerings_tx-1";
      await seedSystemSumUp(id);

      const snapshot = await getDoc(doc(db, "financeTransactions", id));
      const before = { id, ...snapshot.data() } as FinanceTransaction;

      await expect(
        saveTransaction(
          db,
          "finance-user",
          id,
          { ...input, amount: 7777 },
          { existing: before },
        ),
      ).rejects.toThrow();

      await expect(
        voidTransaction(db, "finance-user", before, "No permitido"),
      ).rejects.toThrow();

      const after = await getDoc(doc(db, "financeTransactions", id));
      expect(after.data()?.amount).toBe(10000);
      expect(after.data()?.status).toBe("active");
    });
  });
});
