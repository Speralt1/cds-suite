// @vitest-environment node
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { MemoryStore, makeClock } from "./sumup-memory-store";

const require = createRequire(import.meta.url);
const engine = require("../../functions/sumup/engine.js");
const core = require("../../functions/sumup/core.js");

const CONFIG = { apiKey: "key", merchantCode: "MC-OFFERINGS" };

function txItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    transaction_id: "tx-1",
    amount: 10000,
    refunded_amount: 0,
    currency: "CLP",
    timestamp: "2026-09-15T15:00:00Z",
    status: "SUCCESSFUL",
    payment_type: "POS",
    type: "PAYMENT",
    merchant_code: "MC-OFFERINGS",
    ...overrides,
  };
}

describe("B1 — summary doc siempre tiene los 9 campos y no deja claves en cero por merge anidado", () => {
  it("el primer movimiento en un mes vacío produce un doc con los 9 campos", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: async () => ({ items: [txItem()], nextCursor: null }),
      store,
      clock,
    });
    const summary = store.summaries.get("2026-09") as Record<string, unknown>;
    expect(Object.keys(summary).sort()).toEqual(
      [
        "dailyExpense",
        "dailyIncome",
        "expenseByCategory",
        "expenseTotal",
        "incomeByCategory",
        "incomeTotal",
        "lastTransactionId",
        "result",
        "titheTotal",
        "transactionCount",
      ].sort(),
    );
  });

  it("un reembolso total de la única venta del día elimina esa clave de dailyIncome (no queda en 0 por un merge anidado)", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: async () => ({ items: [txItem()], nextCursor: null }),
      store,
      clock,
    });

    clock.advance(1000);
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: async () => ({ items: [txItem({ status: "REFUNDED", refunded_amount: 10000 })], nextCursor: null }),
      store,
      clock,
    });

    const summary = store.summaries.get("2026-09") as { dailyIncome: Record<string, number>; incomeByCategory: Record<string, number> };
    expect(summary.dailyIncome).toEqual({});
    expect(summary.incomeByCategory).toEqual({});
  });
});

describe("M4 — el libro solo cambia por amount/category/day; un cambio de hash solo refresca el raw", () => {
  it("metadata nueva (mismo amount/category/day) produce rawRefresh, no update, y no agrega versión", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: async () => ({ items: [txItem()], nextCursor: null }),
      store,
      clock,
    });
    const financeBefore = { ...(store.finance.get("sumup_offerings_tx-1") as Record<string, unknown>) };

    clock.advance(1000);
    const result = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      // Same amount/status/category, but new payout metadata -> different snapshotHash.
      fetchPage: async () => ({ items: [txItem({ payout_date: "2026-09-20" })], nextCursor: null }),
      store,
      clock,
    });

    expect(result.counts.rawRefreshed).toBe(1);
    expect(result.counts.updated).toBe(0);
    expect(store.finance.get("sumup_offerings_tx-1")).toEqual(financeBefore);
    expect(store.versions.get("offerings/tx-1")).toBeUndefined();
    expect((store.raw.get("offerings/tx-1") as Record<string, unknown>).providerSnapshot).toMatchObject({ payoutDate: "2026-09-20" });
  });

  it("un reembolso parcial real sí cuenta como update con reason refund_partial", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: async () => ({ items: [txItem()], nextCursor: null }),
      store,
      clock,
    });

    clock.advance(1000);
    const result = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: async () => ({ items: [txItem({ status: "REFUNDED", refunded_amount: 4000 })], nextCursor: null }),
      store,
      clock,
    });
    expect(result.counts.updated).toBe(1);
    const versions = store.versions.get("offerings/tx-1") as Array<{ reason: string }>;
    expect(versions[0].reason).toBe("refund_partial");
  });
});

describe("M8 — compatibilidad con la UI de offerings-page.tsx", () => {
  it("una corrida exitosa deja lastSyncAt/lastSyncStatus/configured/label/merchantCode en sumupIntegrations/{account}", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: async () => ({ items: [], nextCursor: null }),
      store,
      clock,
    });
    const integration = store.integrations.get("offerings") as Record<string, unknown>;
    expect(integration).toMatchObject({
      configured: true,
      label: "Ofrendas",
      merchantCode: "MC-OFFERINGS",
      lastSyncStatus: "ok",
      lastError: "",
    });
    expect(integration.lastSyncAt).toBe(clock.now());
  });

  it("una corrida fallida deja lastSyncStatus 'error' y lastError sin HTML", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    const result = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: async () => {
        const err = new Error("SumUp 503: <html><body>down</body></html>");
        (err as { status?: number }).status = 503;
        throw err;
      },
      store,
      clock,
    });
    expect(result.status).toBe("failed");
    const integration = store.integrations.get("offerings") as Record<string, unknown>;
    expect(integration.lastSyncStatus).toBe("error");
    expect(String(integration.lastError)).not.toMatch(/[<>]/);
  });
});

describe("M3 — el sweep también ignora ítems anteriores al 2026-09-09", () => {
  it("un ítem pre-split se ignora igual en modo sweep que en modo main", () => {
    const normalized = core.normalizeItem(txItem({ timestamp: "2026-01-01T15:00:00Z" }), "offerings");
    const decision = core.classifyItem(normalized, { financeDoc: null, rawSnapshotHash: null }, { mode: "sweep" });
    expect(decision).toMatchObject({ action: "ignored", reason: "preSplit" });
  });
});
