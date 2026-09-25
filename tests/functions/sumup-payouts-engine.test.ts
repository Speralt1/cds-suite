// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { MemoryStore, makeClock } from "./sumup-memory-store";

const require = createRequire(import.meta.url);
const engine = require("../../functions/sumup/engine.js");

// Loose shapes for the store's dynamic docs in these tests — just the
// fields each assertion actually reads, typed for real instead of `any`.
interface RawTxDoc {
  grossAmount: number;
  settlement?: { feeAmount: number; netPaid: number; feeSource: string };
  timestamp?: Date;
  transactionCode?: string;
  status?: string;
}
interface DailySettlementDoc {
  bruto: number;
  comisionSumUp: number;
  liquidoEsperado: number;
  linkStatus: string;
}
interface FeeFinanceDoc {
  amount: number;
  status: string;
  category: string;
  revision: number;
  createdBy?: string;
}
interface SummaryDoc {
  expenseTotal: number;
  expenseByCategory: Record<string, number>;
}
interface PayoutDoc {
  type: string;
  fee: number;
  review: boolean;
  reviewReason: string | null;
}

function seedTx(store: MemoryStore, account: string, rawId: string, opts: { code: string; gross: number; refunded?: number; date: string; status?: string }) {
  store.raw.set(`${account}/${rawId}`, {
    transactionCode: opts.code,
    grossAmount: opts.gross,
    refundedAmount: opts.refunded || 0,
    status: opts.status || "SUCCESSFUL",
    timestamp: new Date(`${opts.date}T15:00:00Z`),
  });
}

function payoutRow({ id, code, amount, fee, date = "2026-09-11", reference = "M2M PID1", type = "PAYOUT", status = "SUCCESSFUL" }: {
  id: string; code?: string; amount: number; fee: number; date?: string; reference?: string; type?: string; status?: string;
}) {
  return { id, type, status, date, reference, transaction_code: code, currency: "CLP", amount, fee };
}

const config = { apiKey: "key", merchantCode: "MC1" };
const clock = makeClock(1_000_000);

describe("engine.runPayoutsSync", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
    seedTx(store, "offerings", "tx-1", { code: "COD-1", gross: 10000, date: "2026-09-10" });
    seedTx(store, "offerings", "tx-2", { code: "COD-2", gross: 20000, date: "2026-09-10" });
    seedTx(store, "offerings", "tx-3", { code: "COD-3", gross: 5000, date: "2026-09-10" });
  });

  it("camino feliz: net basis aceptada, settlement, sumupDailySettlement y libro de comisión", async () => {
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
    ];
    const result = await engine.runPayoutsSync({
      account: "offerings",
      config,
      trigger: "manual",
      dryRun: false,
      ledgerEnabled: true,
      start: "2026-09-01",
      end: "2026-09-30",
      fetchPayouts: async () => rows,
      store,
      clock,
    });

    expect(result.status).toBe("completed");
    expect(result.basis).toBe("net");
    expect(result.counts.rowsCreated).toBe(3);
    expect(store.payouts.size).toBe(3);

    // Settlement written on each transaction, gross untouched.
    const tx1 = store.raw.get("offerings/tx-1") as unknown as RawTxDoc;
    expect(tx1.grossAmount).toBe(10000); // G1: never edited.
    expect(tx1.settlement!.feeAmount).toBe(340);
    expect(tx1.settlement!.netPaid).toBe(9660);
    expect(tx1.settlement!.feeSource).toBe("payouts");

    // Daily settlement summary.
    const daily = store.dailySettlements.get("offerings_2026-09-10") as unknown as DailySettlementDoc;
    expect(daily.bruto).toBe(35000);
    expect(daily.comisionSumUp).toBe(1190);
    expect(daily.liquidoEsperado).toBe(33810);
    expect(daily.linkStatus).toBe("complete");

    // Fee ledger movement + summary delta.
    const fee = store.feeFinance.get("sumup_fee_offerings_2026-09-10") as unknown as FeeFinanceDoc;
    expect(fee.amount).toBe(1190);
    expect(fee.status).toBe("active");
    expect(fee.category).toBe("Comisión SumUp · Ofrendas");
    const summary = store.summaries.get("2026-09") as unknown as SummaryDoc;
    expect(summary.expenseTotal).toBe(1190);
    expect(summary.expenseByCategory["Comisión SumUp · Ofrendas"]).toBe(1190);
  });

  it("dryRun (default) no escribe nada, solo informa", async () => {
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
    ];
    const result = await engine.runPayoutsSync({
      account: "offerings",
      config,
      trigger: "manual",
      // dryRun omitted -> defaults true
      ledgerEnabled: true,
      start: "2026-09-01",
      end: "2026-09-30",
      fetchPayouts: async () => rows,
      store,
      clock,
    });

    expect(result.status).toBe("completed");
    expect(store.payouts.size).toBe(0);
    expect(store.dailySettlements.size).toBe(0);
    expect(store.feeFinance.size).toBe(0);
    expect(result.counts.rowsCreated).toBe(3); // reported, even though not persisted
  });

  it("ejecutar dos veces con las mismas filas no vuelve a crear ni actualizar (idempotencia)", async () => {
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
    ];
    const runOnce = () =>
      engine.runPayoutsSync({
        account: "offerings",
        config,
        trigger: "manual",
        dryRun: false,
        ledgerEnabled: false,
        start: "2026-09-01",
        end: "2026-09-30",
        fetchPayouts: async () => rows,
        store,
        clock,
      });

    const first = await runOnce();
    expect(first.counts.rowsCreated).toBe(3);

    const second = await runOnce();
    expect(second.counts.rowsCreated).toBe(0);
    expect(second.counts.rowsUpdated).toBe(0);
    expect(second.counts.rowsUnchanged).toBe(3);
    expect(store.payoutVersions.size).toBe(0);
  });

  it("si una fila cambia (ej. status), se actualiza y se agrega una versión — nunca se sobrescribe silenciosamente", async () => {
    const rowsV1 = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340, status: "SUCCESSFUL" }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
    ];
    await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: false,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rowsV1, store, clock,
    });

    const rowsV2 = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9500, fee: 500, status: "SUCCESSFUL" }), // fee corrected
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
    ];
    const second = await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: false,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rowsV2, store, clock,
    });

    expect(second.counts.rowsUpdated).toBe(1);
    expect(second.counts.rowsUnchanged).toBe(2);
    const docId = "offerings_PAYOUT_r1_COD-1";
    expect(store.payoutVersions.get(docId)?.length).toBe(1);
    const updated = store.payouts.get(docId) as unknown as { fee: number };
    expect(updated.fee).toBe(500);
  });

  it("menos de 3 votos contables deja la ejecución en needs_review: escribe filas crudas pero no settlement ni el libro", async () => {
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      // Only 2 countable votes (COD-3 has no matching row) -> insufficient evidence.
    ];
    const result = await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: true,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows, store, clock,
    });

    expect(result.status).toBe("needs_review");
    expect(store.payouts.size).toBe(2); // raw rows still written
    expect(store.dailySettlements.size).toBe(0);
    expect(store.feeFinance.size).toBe(0);
    const tx1 = store.raw.get("offerings/tx-1") as unknown as RawTxDoc;
    expect(tx1.settlement).toBeUndefined();
  });

  it("votos en desacuerdo (mezcla net/gross) también deja needs_review", async () => {
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }), // net
      payoutRow({ id: "r2", code: "COD-2", amount: 20000, fee: 680 }), // gross
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }), // net
    ];
    const result = await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: false,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows, store, clock,
    });
    expect(result.status).toBe("needs_review");
  });

  it("deducciones (BALANCE_DEDUCTION) quedan en revisión, no crean settlement ni cuentan como voto", async () => {
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
      { id: "d1", type: "BALANCE_DEDUCTION", status: "SUCCESSFUL", date: "2026-09-12", reference: null, transaction_code: null, currency: "CLP", amount: -1000, fee: 0 },
    ];
    const result = await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: false,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows, store, clock,
    });
    expect(result.status).toBe("completed"); // 3 clean PAYOUT votes still accepted
    expect(result.counts.rowsReview).toBe(1);
    const deductionDoc = [...store.payouts.values()].find((p) => (p as unknown as PayoutDoc).type === "BALANCE_DEDUCTION") as unknown as PayoutDoc;
    expect(deductionDoc.review).toBe(true);
    expect(deductionDoc.reviewReason).toBe("deduction_balance_deduction");
  });

  it("una fila PAYOUT con transaction_code inexistente en la ventana queda en revisión (not_found) y no vota", async () => {
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
      payoutRow({ id: "r4", code: "COD-DESCONOCIDO", amount: 1000, fee: 40 }),
    ];
    const result = await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: false,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows, store, clock,
    });
    expect(result.status).toBe("completed");
    const orphan = store.payouts.get("offerings_PAYOUT_r4_COD-DESCONOCIDO") as unknown as PayoutDoc;
    expect(orphan.review).toBe(true);
    expect(orphan.reviewReason).toBe("not_found");
  });

  it("regresión: el sync horario (rawRefresh) nunca pisa settlement escrito por el sync de payouts", async () => {
    const core = require("../../functions/sumup/core.js");
    // Simulate the hourly sync already having created the transaction (as
    // runAccountSync would), then payouts writes settlement on top.
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
    ];
    await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: false,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows, store, clock,
    });
    expect((store.raw.get("offerings/tx-1") as unknown as RawTxDoc).settlement!.feeAmount).toBe(340);

    // Now the hourly sync re-processes the SAME unchanged provider item —
    // classifyItem returns "rawRefresh" (sameAmount/sameCategory/sameDay,
    // but a metadata-only hash bump), which calls buildRawDoc + setRaw
    // (merge:true). buildRawDoc never mentions `settlement`, so it must
    // survive.
    const normalized = core.normalizeItem(
      {
        transaction_id: "tx-1",
        timestamp: "2026-09-10T15:00:00Z",
        amount: 10000,
        refunded_amount: 0,
        payment_type: "POS",
        currency: "CLP",
        type: "PAYMENT",
        status: "SUCCESSFUL",
        transaction_code: "COD-1",
        card_type: "changed-metadata-only",
      },
      "offerings",
    );
    await store.runLedgerTransaction({ account: "offerings", rawId: "tx-1", financeId: "sumup_offerings_tx-1" }, async (tx) => {
      const previousRaw = await tx.getRaw();
      tx.setRaw({
        account: normalized.account,
        transactionId: normalized.id,
        transactionCode: normalized.providerSnapshot.transactionCode,
        grossAmount: normalized.grossAmount,
        refundedAmount: normalized.refundedAmount,
        status: normalized.status,
        review: false,
        reviewReason: null,
        syncedAt: Date.now(),
        ...previousRaw ? {} : {},
      });
    });

    const after = store.raw.get("offerings/tx-1") as unknown as RawTxDoc;
    expect(after.settlement!.feeAmount).toBe(340); // survived the hourly rawRefresh
    expect(after.grossAmount).toBe(10000);
  });

  it("lease/aislamiento: offerings y cafeteria tienen locks independientes", async () => {
    const leaseA = await store.acquireLease("offerings__payouts", { ttlMs: 60_000, runId: "run-a", trigger: "manual", now: clock.now() });
    const leaseB = await store.acquireLease("cafeteria__payouts", { ttlMs: 60_000, runId: "run-b", trigger: "manual", now: clock.now() });
    expect(leaseA.acquired).toBe(true);
    expect(leaseB.acquired).toBe(true);
  });

  it("recálculo de comisión: sube, y anulación en $0 cuando baja a 0", async () => {
    const rows1 = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
    ];
    await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: true,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows1, store, clock,
    });
    const fee1 = store.feeFinance.get("sumup_fee_offerings_2026-09-10") as unknown as FeeFinanceDoc;
    expect(fee1.amount).toBe(1190);
    expect(fee1.revision).toBe(1);

    // Commission corrected upward on a second ingestion.
    const rows2 = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9500, fee: 500 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
    ];
    await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: true,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows2, store, clock,
    });
    const fee2 = store.feeFinance.get("sumup_fee_offerings_2026-09-10") as unknown as FeeFinanceDoc;
    expect(fee2.amount).toBe(1350);
    expect(fee2.revision).toBe(2);
    expect(store.feeVersions.get("sumup_fee_offerings_2026-09-10")?.length).toBe(1);
    const summary = store.summaries.get("2026-09") as unknown as SummaryDoc;
    expect(summary.expenseTotal).toBe(1350);
  });

  it("M5: re-ejecutar la misma ventana con el mismo monto no reescribe el libro de comisión", async () => {
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
    ];
    await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: true,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows, store, clock,
    });
    const fee1 = store.feeFinance.get("sumup_fee_offerings_2026-09-10") as unknown as FeeFinanceDoc;
    expect(fee1.revision).toBe(1);

    // Same rows, same amounts -> no revision bump, no version entry, no
    // change to the monthly summary (Atlas review M5 "no-op").
    await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: true,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows, store, clock,
    });
    const fee2 = store.feeFinance.get("sumup_fee_offerings_2026-09-10") as unknown as FeeFinanceDoc;
    expect(fee2.revision).toBe(1);
    expect(store.feeVersions.get("sumup_fee_offerings_2026-09-10")).toBeUndefined();
    const summary = store.summaries.get("2026-09") as unknown as SummaryDoc;
    expect(summary.expenseTotal).toBe(1190);
  });

  it("M2: la ventana de transacciones (start-10d) es evidencia de vinculación, nunca escribe settlement fuera de [start,end]", async () => {
    // tx-old vive antes de `start` pero dentro del padding de -10d — solo
    // debe servir para vincular/votar la base, jamás recibir settlement ni
    // aparecer en sumupDailySettlement (eso queda acotado a [start,end]).
    seedTx(store, "offerings", "tx-old", { code: "COD-OLD", gross: 8000, date: "2026-08-25" });
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
      payoutRow({ id: "r-old", code: "COD-OLD", amount: 7728, fee: 272, date: "2026-09-05" }),
    ];
    const result = await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: true,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows, store, clock,
    });

    expect(result.status).toBe("completed");
    expect(result.basis).toBe("net");
    // Linked for basis-voting purposes (docId exists, action counted)...
    expect(store.payouts.has("offerings_PAYOUT_r-old_COD-OLD")).toBe(true);
    // ...but never settled: tx-old's date is before `start`.
    const txOld = store.raw.get("offerings/tx-old") as unknown as RawTxDoc;
    expect(txOld.settlement).toBeUndefined();
    expect(store.dailySettlements.has("offerings_2026-08-25")).toBe(false);
    // The in-window days still settle normally.
    expect(store.dailySettlements.has("offerings_2026-09-10")).toBe(true);
  });

  it("M2: re-vincula cuando cambia linkStatus aunque el rawHash de la fila no cambie", async () => {
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
      payoutRow({ id: "r4", code: "COD-4", amount: 3864, fee: 136, date: "2026-09-12" }),
    ];
    // First run: tx-4 doesn't exist yet -> r4 links "not_found" (review).
    const result1 = await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: true,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows, store, clock,
    });
    expect(result1.status).toBe("completed");
    const docId = "offerings_PAYOUT_r4_COD-4";
    expect((store.payouts.get(docId) as unknown as PayoutDoc).reviewReason).toBe("not_found");

    // tx-4 shows up later; SAME raw rows (identical rawHash for r4), only
    // the transaction universe changed -> must still re-link, not skip.
    seedTx(store, "offerings", "tx-4", { code: "COD-4", gross: 4000, date: "2026-09-12" });
    const result2 = await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: true,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows, store, clock,
    });

    expect(result2.status).toBe("completed");
    expect(result2.counts.rowsUpdated).toBeGreaterThanOrEqual(1);
    const updated = store.payouts.get(docId) as unknown as PayoutDoc;
    expect(updated.review).toBe(false);
    expect(updated.reviewReason).toBeNull();
  });

  it("M4: una transacción CANCELLED no suma al bruto ni queda 'pendiente' para siempre, pero se cuenta como excluida", async () => {
    // tx-4 nunca llegó a completarse -> no es settleable (SUCCESSFUL/REFUNDED
    // only). No debe sumar a `bruto` del día ni contarse como txPending, y sí
    // debe reflejarse en txExcluded (spec "NO SILENT MONEY LOSS": nunca
    // desaparece silenciosamente).
    seedTx(store, "offerings", "tx-4", { code: "COD-4", gross: 4000, date: "2026-09-10", status: "CANCELLED" });
    const rows = [
      payoutRow({ id: "r1", code: "COD-1", amount: 9660, fee: 340 }),
      payoutRow({ id: "r2", code: "COD-2", amount: 19320, fee: 680 }),
      payoutRow({ id: "r3", code: "COD-3", amount: 4830, fee: 170 }),
    ];
    const result = await engine.runPayoutsSync({
      account: "offerings", config, trigger: "manual", dryRun: false, ledgerEnabled: true,
      start: "2026-09-01", end: "2026-09-30", fetchPayouts: async () => rows, store, clock,
    });

    expect(result.status).toBe("completed");
    expect(result.counts.txExcluded).toBe(1);
    const daily = store.dailySettlements.get("offerings_2026-09-10") as unknown as DailySettlementDoc & {
      txExcluded: number;
      txCount: number;
      txPending: number;
    };
    // Bruto is still exactly the 3 SUCCESSFUL transactions (35000), the
    // CANCELLED one never joins the sum.
    expect(daily.bruto).toBe(35000);
    expect(daily.txCount).toBe(3);
    expect(daily.txPending).toBe(0);
    expect(daily.txExcluded).toBe(1);
    // The CANCELLED transaction's own raw doc is never touched.
    const txCancelled = store.raw.get("offerings/tx-4") as unknown as RawTxDoc;
    expect(txCancelled.settlement).toBeUndefined();
  });
});
