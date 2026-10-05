// @vitest-environment node
//
// SumUp CASH Intake V1 — test matrix C3 (docs/mission-2026/22-sumup-cash-2026-10-04-audit.md).
// Numbers in the test names refer to the mission's mandatory matrix.
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { MemoryStore, makeClock } from "./sumup-memory-store";

const require = createRequire(import.meta.url);
const engine = require("../../functions/sumup/engine.js");
const core = require("../../functions/sumup/core.js");

const CONFIG = {
  offerings: { apiKey: "key-offerings", merchantCode: "MC-OFFERINGS" },
  cafeteria: { apiKey: "key-cafeteria", merchantCode: "MC-CAFETERIA" },
} as const;
type Account = keyof typeof CONFIG;

// 2026-10-04 16:34 America/Santiago (UTC-3) — same shape as the real Sunday CASH.
const SUNDAY = "2026-10-04T19:34:36.463Z";
// 2026-09-27 — a real pre-start CASH day in the Cafetería account.
const BEFORE_START = "2026-09-27T18:00:00Z";
// 2026-10-04 00:30 local = 2026-10-04T03:30Z; 2026-10-03 23:30 local = 2026-10-04T02:30Z.
const START_LOCAL_EDGE = "2026-10-04T03:30:00Z";
const DAY_BEFORE_LOCAL_EDGE = "2026-10-04T02:30:00Z";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    transaction_id: "tx-1",
    transaction_code: "COD-1",
    amount: 10000,
    refunded_amount: 0,
    currency: "CLP",
    timestamp: SUNDAY,
    status: "SUCCESSFUL",
    payment_type: "POS",
    type: "PAYMENT",
    ...overrides,
  };
}

function cash(overrides: Record<string, unknown> = {}) {
  return item({
    id: "cash-1",
    transaction_id: "cash-1",
    transaction_code: "CASH-1",
    amount: 163500,
    payment_type: "CASH",
    entry_mode: "none",
    ...overrides,
  });
}

function sync(store: MemoryStore, clock: ReturnType<typeof makeClock>, items: unknown[], opts: { account?: Account; sweep?: boolean } = {}) {
  const account = opts.account || "cafeteria";
  return engine.runAccountSync({
    account,
    config: CONFIG[account],
    trigger: opts.sweep ? "sweep" : "scheduled",
    requestedBy: "system:test",
    fetchPage: async () => ({ items, nextCursor: null }),
    store,
    clock,
    sweep: !!opts.sweep,
  });
}

function summary(store: MemoryStore, period = "2026-10") {
  return store.summaries.get(period) as SummaryDoc | undefined;
}

type SummaryDoc = {
  incomeTotal: number;
  result: number;
  transactionCount: number;
  incomeByCategory: Record<string, number>;
  dailyIncome: Record<string, number>;
  [key: string]: unknown;
};

const NINE_FIELDS = [
  "dailyExpense",
  "dailyIncome",
  "expenseByCategory",
  "expenseTotal",
  "incomeByCategory",
  "incomeTotal",
  "result",
  "titheTotal",
  "transactionCount",
];

describe("CASH Intake V1 — core", () => {
  it("SUMUP_CASH_START_DATE es 2026-10-04 y preCashStart es una razón de ignore explícita", () => {
    expect(core.SUMUP_CASH_START_DATE).toBe("2026-10-04");
    expect(core.IGNORE_REASONS).toContain("preCashStart");
    expect(engine.emptyCounts().ignored.preCashStart).toBe(0);
  });

  it("mapea POS -> card y CASH -> cash; cualquier otro payment_type no tiene método de ledger", () => {
    expect(core.ledgerPaymentMethodFor("POS")).toBe("card");
    expect(core.ledgerPaymentMethodFor("CASH")).toBe("cash");
    for (const other of ["ECOM", "RECURRING", "BALANCE", "MOTO", "BOLETO", ""]) {
      expect(core.ledgerPaymentMethodFor(other)).toBeNull();
    }
  });

  it("descripciones distinguen inequívocamente tarjeta y efectivo en ambas cuentas", () => {
    expect(core.normalizeItem(item(), "offerings").description).toBe("Ofrenda tarjeta física · SumUp");
    expect(core.normalizeItem(cash(), "offerings").description).toBe("Ofrenda efectivo · SumUp");
    expect(core.normalizeItem(item(), "cafeteria").description).toBe("Venta Cafetería · SumUp");
    expect(core.normalizeItem(cash(), "cafeteria").description).toBe("Venta Cafetería efectivo · SumUp");
  });

  it("15. el snapshotHash de un POS es byte-idéntico al de la fórmula previa (sin rawRefresh masivo al desplegar)", () => {
    const raw = item({ card_type: "VISA", entry_mode: "contactless", payout_plan: "SINGLE_PAYMENT" });
    const n = core.normalizeItem(raw, "offerings");
    // Exact field set hashed by the production code before CASH Intake V1.
    const previous = core.snapshotHash({
      status: n.status,
      amount: n.amount,
      category: n.category,
      feeAmount: n.feeAmount,
      feeStatus: n.feeStatus,
      merchantCode: n.providerSnapshot.merchantCode,
      payoutDate: n.providerSnapshot.payoutDate,
      payoutType: n.providerSnapshot.payoutType,
      payoutsTotal: n.providerSnapshot.payoutsTotal,
      payoutsReceived: n.providerSnapshot.payoutsReceived,
      cardType: n.providerSnapshot.cardType,
      entryMode: n.providerSnapshot.entryMode,
      productSummary: n.providerSnapshot.productSummary,
      transactionCode: n.providerSnapshot.transactionCode,
    });
    expect(n.snapshotHash).toBe(previous);
  });

  it("11. un cambio POS <-> CASH nunca es invisible para el snapshotHash", () => {
    const shared = { id: "x", transaction_id: "x", transaction_code: "C", entry_mode: "none" };
    const asPos = core.normalizeItem(item({ ...shared, payment_type: "POS" }), "cafeteria");
    const asCash = core.normalizeItem(item({ ...shared, payment_type: "CASH" }), "cafeteria");
    expect(asPos.snapshotHash).not.toBe(asCash.snapshotHash);
  });

  it("C1.3 preserva payment_type, simple_payment_type y la ausencia de fee_amount del proveedor", () => {
    const n = core.normalizeItem(cash({ simple_payment_type: "CASH" }), "cafeteria");
    expect(n.providerSnapshot.paymentType).toBe("CASH");
    expect(n.providerSnapshot.simplePaymentType).toBe("CASH");
    expect(n.feeAmount).toBeNull();
    expect(n.feeStatus).toBe("unknown");
    expect(n.paymentMethod).toBe("cash");
  });

  it("3. el corte usa la fecha LOCAL de Santiago, no la fecha UTC", () => {
    const fresh = { financeDoc: null, rawSnapshotHash: null };
    const lateSaturday = core.normalizeItem(cash({ timestamp: DAY_BEFORE_LOCAL_EDGE }), "cafeteria");
    const earlySunday = core.normalizeItem(cash({ timestamp: START_LOCAL_EDGE }), "cafeteria");
    expect(lateSaturday.localDate).toBe("2026-10-03");
    expect(earlySunday.localDate).toBe("2026-10-04");
    expect(core.classifyItem(lateSaturday, fresh, { mode: "main" })).toMatchObject({ action: "ignored", reason: "preCashStart" });
    expect(core.classifyItem(earlySunday, fresh, { mode: "main" })).toMatchObject({ action: "create" });
  });

  it("CASH anterior al inicio con un doc activo existente va a revisión humana, nunca a conversión automática", () => {
    const n = core.normalizeItem(cash({ timestamp: BEFORE_START }), "cafeteria");
    const decision = core.classifyItem(
      n,
      { financeDoc: { status: "active", amount: 163500, category: "Cafetería", day: "27", paymentMethod: "card", updatedBy: "system:sumup" }, rawSnapshotHash: null },
      { mode: "sweep" },
    );
    expect(decision).toEqual({ action: "review", reason: "payment_method_changed", ledgerEffect: false });
  });

  it("CHARGE_BACK sobre CASH conserva el guard existente: revisión sin efecto contable", () => {
    const n = core.normalizeItem(cash({ type: "CHARGE_BACK" }), "cafeteria");
    expect(core.classifyItem(n, { financeDoc: null, rawSnapshotHash: null }, { mode: "main" })).toEqual({
      action: "review",
      reason: "chargeback",
      ledgerEffect: false,
    });
  });
});

describe("CASH Intake V1 — engine", () => {
  it("1/15. POS successful CLP sigue creando card con la descripción de siempre", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    const run = await sync(store, clock, [item()], { account: "offerings" });
    expect(run.counts.created).toBe(1);
    const doc = store.finance.get("sumup_offerings_tx-1")!;
    expect(doc).toMatchObject({
      paymentMethod: "card",
      description: "Ofrenda tarjeta física · SumUp",
      category: "Ofrendas",
      amount: 10000,
      createdBy: "system:sumup",
      source: "general",
      status: "active",
      revision: 1,
    });
  });

  it("2/6/16. CASH successful CLP desde 04/10 crea un ingreso cash y suma exactamente una vez en el resumen (9 campos)", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    const run = await sync(store, clock, [cash()]);
    expect(run.counts.created).toBe(1);
    const doc = store.finance.get("sumup_cafeteria_cash-1")!;
    expect(doc).toMatchObject({
      type: "income",
      paymentMethod: "cash",
      description: "Venta Cafetería efectivo · SumUp",
      category: "Cafetería",
      amount: 163500,
      period: "2026-10",
      day: "4",
      status: "active",
      createdBy: "system:sumup",
      updatedBy: "system:sumup",
    });
    const s = summary(store)!;
    expect(s.incomeTotal).toBe(163500);
    expect(s.result).toBe(163500);
    expect(s.transactionCount).toBe(1);
    expect(s.incomeByCategory).toEqual({ "Cafetería": 163500 });
    expect(s.dailyIncome).toEqual({ "4": 163500 });
    expect(Object.keys(s).filter((k) => k !== "lastTransactionId").sort()).toEqual(NINE_FIELDS);

    const raw = store.raw.get("cafeteria/cash-1")!;
    expect(raw).toMatchObject({ paymentType: "CASH", paymentMethod: "cash", feeAmount: null, feeStatus: "unknown", grossAmount: 163500 });
  });

  it("3/12. CASH anterior a 04/10 se ignora como preCashStart; ECOM/RECURRING/BALANCE/MOTO siguen ignorados como nonPOS", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    const run = await sync(store, clock, [
      cash({ id: "old", transaction_id: "old", timestamp: BEFORE_START }),
      cash({ id: "edge", transaction_id: "edge", timestamp: DAY_BEFORE_LOCAL_EDGE }),
      item({ id: "e", transaction_id: "e", payment_type: "ECOM" }),
      item({ id: "r", transaction_id: "r", payment_type: "RECURRING" }),
      item({ id: "b", transaction_id: "b", payment_type: "BALANCE" }),
      item({ id: "m", transaction_id: "m", payment_type: "MOTO" }),
    ]);
    expect(run.counts.ignored.preCashStart).toBe(2);
    expect(run.counts.ignored.nonPOS).toBe(4);
    expect(run.counts.created).toBe(0);
    expect(store.finance.size).toBe(0);
    expect(store.raw.size).toBe(0);
    expect(store.summaries.size).toBe(0);
  });

  it("4/5/17. CASH repetido (misma página y corridas sucesivas) es idempotente: un doc, un conteo, montos estables", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    // Same item twice in ONE page: the finance batch is prefetched per page, so
    // the second copy re-enters the create path. Pre-existing engine behavior
    // (POS included): still one doc and a zero summary delta, but revision is
    // bumped once — documented as a MINOR in doc 22, not changed in this slice.
    await sync(store, clock, [cash(), cash()]);
    const afterFirst = JSON.parse(JSON.stringify(summary(store)));
    const revisionAfterFirst = store.finance.get("sumup_cafeteria_cash-1")!.revision;
    clock.advance(3_600_000);
    const run2 = await sync(store, clock, [cash()]);
    clock.advance(3_600_000);
    const run3 = await sync(store, clock, [cash()], { sweep: true });

    expect([...store.finance.keys()].filter((k) => k.includes("cash-1"))).toHaveLength(1);
    expect(run2.counts).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(run3.counts).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(summary(store)).toEqual(afterFirst);
    expect(afterFirst.incomeTotal).toBe(163500);
    expect(afterFirst.transactionCount).toBe(1);
    // Successive runs never touch the doc again.
    expect(store.finance.get("sumup_cafeteria_cash-1")!.revision).toBe(revisionAfterFirst);
    expect(store.finance.get("sumup_cafeteria_cash-1")!.amount).toBe(163500);
  });

  it("4b. CASH releído en corridas sucesivas (sin duplicado intra-página) queda en revision 1 y sin versiones", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    for (let i = 0; i < 3; i++) {
      await sync(store, clock, [cash()], { sweep: i === 2 });
      clock.advance(3_600_000);
    }
    expect(store.finance.get("sumup_cafeteria_cash-1")!.revision).toBe(1);
    expect(store.versions.get("cafeteria/cash-1")).toBeUndefined();
    expect(summary(store)!.transactionCount).toBe(1);
  });

  it("7. reembolso parcial de CASH actualiza monto, versiona y ajusta el resumen", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    await sync(store, clock, [cash()]);
    clock.advance(1000);
    const run = await sync(store, clock, [cash({ refunded_amount: 3500, status: "SUCCESSFUL" })]);
    expect(run.counts.updated).toBe(1);
    const doc = store.finance.get("sumup_cafeteria_cash-1")!;
    expect(doc).toMatchObject({ amount: 160000, paymentMethod: "cash", status: "active", revision: 2 });
    expect(summary(store)!.incomeTotal).toBe(160000);
    expect(summary(store)!.transactionCount).toBe(1);
    const versions = store.versions.get("cafeteria/cash-1") as Array<Record<string, unknown>>;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ action: "update", reason: "refund_partial", afterAmount: 160000, afterPaymentMethod: "cash" });
  });

  it("8. reembolso total de CASH anula el doc y lo resta del resumen", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    await sync(store, clock, [cash()]);
    clock.advance(1000);
    const run = await sync(store, clock, [cash({ refunded_amount: 163500, status: "REFUNDED" })]);
    expect(run.counts.voided).toBe(1);
    expect(store.finance.get("sumup_cafeteria_cash-1")).toMatchObject({
      status: "voided",
      paymentMethod: "cash",
      voidedBy: "system:sumup",
      voidReason: "Pago reembolsado en SumUp",
    });
    const s = summary(store)!;
    expect(s.incomeTotal).toBe(0);
    expect(s.transactionCount).toBe(0);
    expect(s.incomeByCategory).toEqual({});
    expect(s.dailyIncome).toEqual({});
  });

  it("9. CASH PENDING no entra al ledger", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    const run = await sync(store, clock, [cash({ status: "PENDING" })]);
    expect(run.counts.ignored.pending).toBe(1);
    expect(store.finance.size).toBe(0);
  });

  it("10. CASH FAILED/CANCELLED: sin doc se ignora; con doc activo va a revisión sin tocar el ledger", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    const fresh = await sync(store, clock, [
      cash({ id: "f", transaction_id: "f", status: "FAILED" }),
      cash({ id: "c", transaction_id: "c", status: "CANCELLED" }),
    ]);
    expect(fresh.counts.ignored.other).toBe(2);
    expect(store.finance.size).toBe(0);

    await sync(store, clock, [cash()]);
    const before = JSON.parse(JSON.stringify(summary(store)));
    clock.advance(1000);
    const downgraded = await sync(store, clock, [cash({ status: "CANCELLED" })]);
    expect(downgraded.counts.review).toBe(1);
    expect(store.finance.get("sumup_cafeteria_cash-1")).toMatchObject({ status: "active", amount: 163500 });
    expect(store.raw.get("cafeteria/cash-1")).toMatchObject({ review: true, reviewReason: "status_downgraded" });
    expect(summary(store)).toEqual(before);
  });

  it("11. cambio de método POS -> CASH del proveedor: update trazable, sin delta monetario ni reescritura del resumen", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    const shared = { id: "pm", transaction_id: "pm", transaction_code: "PM", amount: 5000 };
    await sync(store, clock, [item(shared)]);
    const summaryBefore = store.summaries.get("2026-10");
    clock.advance(1000);
    const run = await sync(store, clock, [item({ ...shared, payment_type: "CASH" })]);
    expect(run.counts.updated).toBe(1);
    const doc = store.finance.get("sumup_cafeteria_pm")!;
    expect(doc).toMatchObject({ paymentMethod: "cash", description: "Venta Cafetería efectivo · SumUp", amount: 5000, revision: 2 });
    // Same object reference: the summary was not even rewritten.
    expect(store.summaries.get("2026-10")).toBe(summaryBefore);
    const versions = store.versions.get("cafeteria/pm") as Array<{ before: { paymentMethod: string } } & Record<string, unknown>>;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ action: "update", reason: "payment_method_changed", afterPaymentMethod: "cash" });
    expect(versions[0].before.paymentMethod).toBe("card");

    clock.advance(1000);
    const back = await sync(store, clock, [item(shared)]);
    expect(back.counts.updated).toBe(1);
    expect(store.finance.get("sumup_cafeteria_pm")).toMatchObject({ paymentMethod: "card", description: "Venta Cafetería · SumUp", revision: 3 });
    expect(summary(store)!.incomeTotal).toBe(5000);
    expect(summary(store)!.transactionCount).toBe(1);
  });

  it("11b. un doc SumUp editado por un humano nunca se sobrescribe por un cambio de método", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    await sync(store, clock, [item({ id: "h", transaction_id: "h" })]);
    store.finance.set("sumup_cafeteria_h", { ...store.finance.get("sumup_cafeteria_h")!, updatedBy: "uid-human" });
    clock.advance(1000);
    const run = await sync(store, clock, [item({ id: "h", transaction_id: "h", payment_type: "CASH" })]);
    expect(run.counts.review).toBe(1);
    expect(store.finance.get("sumup_cafeteria_h")).toMatchObject({ paymentMethod: "card" });
  });

  it("13. el sweep de 45 días encuentra CASH desde 04/10 y bloquea el CASH anterior dentro de la ventana", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    const run = await sync(
      store,
      clock,
      [cash({ id: "old", transaction_id: "old", timestamp: BEFORE_START }), cash()],
      { sweep: true },
    );
    expect(run.status).toBe("completed");
    expect(run.counts.created).toBe(1);
    expect(run.counts.ignored.preCashStart).toBe(1);
    expect(store.finance.has("sumup_cafeteria_cash-1")).toBe(true);
    expect(store.finance.has("sumup_cafeteria_old")).toBe(false);
  });

  it("14. el legacy backfill nunca importa CASH histórico (ni el POS histórico deja de importarse)", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    const result = await engine.runLegacyPage({
      account: "offerings",
      config: CONFIG.offerings,
      requestedBy: "system",
      fetchPage: async () => ({
        items: [
          cash({ id: "c2025", transaction_id: "c2025", amount: 9_000_000, timestamp: "2025-06-08T15:00:00Z" }),
          item({ id: "p2026", transaction_id: "p2026", amount: 5000, timestamp: "2026-01-05T15:00:00Z" }),
        ],
        nextCursor: null,
      }),
      store,
      clock,
    });
    expect(result.counts.ignored.preCashStart).toBe(1);
    expect(store.finance.has("sumup_offerings_c2025")).toBe(false);
    expect(store.finance.get("sumup_offerings_p2026")).toMatchObject({ paymentMethod: "card", category: "SumUp histórico sin separar" });
    expect((store.summaries.get("2026-01") as Record<string, number>).incomeTotal).toBe(5000);
    expect(store.summaries.has("2025-06")).toBe(false);
  });

  it("18. fee_amount en CASH (si el proveedor lo enviara) no descuenta el ledger; un cambio de fee solo refresca el raw", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    await sync(store, clock, [cash({ fee_amount: 1200 })]);
    expect(store.finance.get("sumup_cafeteria_cash-1")!.amount).toBe(163500);
    expect(store.raw.get("cafeteria/cash-1")).toMatchObject({ feeAmount: 1200, feeStatus: "provider" });
    clock.advance(1000);
    const run = await sync(store, clock, [cash({ fee_amount: 1300 })]);
    expect(run.counts.rawRefreshed).toBe(1);
    expect(run.counts.updated).toBe(0);
    expect(store.finance.get("sumup_cafeteria_cash-1")).toMatchObject({ amount: 163500, revision: 1 });
    expect(summary(store)!.incomeTotal).toBe(163500);
  });

  it("19. ambas cuentas: CASH de Ofrendas y Cafetería con categoría, id y descripción propios; POS y CASH conviven", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    await sync(store, clock, [cash({ amount: 40000 }), item({ id: "p-o", transaction_id: "p-o", amount: 65000 })], { account: "offerings" });
    await sync(store, clock, [cash({ amount: 163500 }), item({ id: "p-c", transaction_id: "p-c", amount: 740360 })], { account: "cafeteria" });
    expect(store.finance.get("sumup_offerings_cash-1")).toMatchObject({ category: "Ofrendas", paymentMethod: "cash", description: "Ofrenda efectivo · SumUp" });
    expect(store.finance.get("sumup_cafeteria_cash-1")).toMatchObject({ category: "Cafetería", paymentMethod: "cash" });
    expect(store.finance.get("sumup_offerings_p-o")).toMatchObject({ paymentMethod: "card" });
    expect(store.finance.get("sumup_cafeteria_p-c")).toMatchObject({ paymentMethod: "card" });
    const s = summary(store)!;
    expect(s.incomeTotal).toBe(40000 + 65000 + 163500 + 740360);
    expect(s.transactionCount).toBe(4);
    expect(s.incomeByCategory).toEqual({ Ofrendas: 105000, "Cafetería": 903860 });
  });

  it("Replay sintético del domingo 04/10: el CASH faltante suma +163.500 y +1 al estado actual", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
    // Current production engine state: only POS was imported.
    const pos = Array.from({ length: 89 }, (_, i) => item({ id: `p${i}`, transaction_id: `p${i}`, amount: i === 0 ? 740360 - 88 * 8000 : 8000 }));
    const failed = Array.from({ length: 7 }, (_, i) => item({ id: `f${i}`, transaction_id: `f${i}`, status: "FAILED" }));
    await sync(store, clock, [...pos, ...failed]);
    expect(summary(store)!.incomeTotal).toBe(740360);
    expect(summary(store)!.transactionCount).toBe(89);
    clock.advance(3_600_000);
    // After deploy the same provider page (now including the CASH) is re-read.
    const run = await sync(store, clock, [...pos, ...failed, cash()]);
    expect(run.counts).toMatchObject({ created: 1, updated: 0, unchanged: 89 });
    expect(summary(store)!.incomeTotal).toBe(903860);
    expect(summary(store)!.transactionCount).toBe(90);
    expect(summary(store)!.dailyIncome).toEqual({ "4": 903860 });
  });
});
