// @vitest-environment node
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { MemoryStore, makeClock } from "./sumup-memory-store";

const require = createRequire(import.meta.url);
const engine = require("../../functions/sumup/engine.js");

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

describe("M5 — deadline absoluto y chequeo dentro del loop de ítems", () => {
  it("no inicia una página nueva si queda menos de 20s (15s fetch + 5s margen)", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    const deadlineAt = clock.now() + 30_000;
    let calls = 0;

    const result = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      deadlineAt,
      fetchPage: async () => {
        calls += 1;
        clock.advance(12_000); // leaves 18s, below the 20s margin
        return { items: [txItem()], nextCursor: "cursor-2" };
      },
      store,
      clock,
    });

    expect(calls).toBe(1);
    expect(result.status).toBe("partial");
    expect(store.integrations.get("offerings")?.pendingCursor).toBe("cursor-2");
  });

  it("un deadline agotado a mitad de página detiene el loop de ítems y persiste el cursor de esa MISMA página (idempotente)", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    const deadlineAt = clock.now() + 100_000;

    // getFinanceBatch is called once per page, right before the item loop
    // starts; advancing the clock past the deadline there simulates "ran out
    // of time midway through this page" without needing a slow fetchPage.
    const originalGetFinanceBatch = store.getFinanceBatch.bind(store);
    let batchCalls = 0;
    store.getFinanceBatch = async (account: string, ids: string[]) => {
      batchCalls += 1;
      if (batchCalls === 1) clock.set(deadlineAt + 1);
      return originalGetFinanceBatch(account, ids);
    };

    const result = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "scheduled",
      requestedBy: "system",
      deadlineAt,
      fetchPage: async () => ({
        items: [txItem({ id: "mid-1", transaction_id: "mid-1" }), txItem({ id: "mid-2", transaction_id: "mid-2" })],
        nextCursor: "should-never-be-persisted",
      }),
      store,
      clock,
    });

    expect(result.status).toBe("partial");
    expect(store.finance.has("sumup_offerings_mid-1")).toBe(false);
    expect(store.finance.has("sumup_offerings_mid-2")).toBe(false);
    // Only the page's own (null, i.e. "start over") cursor is persisted —
    // never the nextCursor of a page we bailed out of midway.
    expect(store.integrations.get("offerings")?.pendingCursor).toBe("");
  });
});

describe("M6 — el sweep tiene su propio cursor y no comparte pendingCursor", () => {
  it("un sweep parcial escribe sweepCursor, no pendingCursor", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await store.setIntegration("offerings", { pendingCursor: "incremental-cursor" });

    const result = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "sweep",
      requestedBy: "system:sweep",
      sweep: true,
      budgetMs: 1, // exhausted immediately -> partial on the very first page-start check
      fetchPage: async () => ({ items: [], nextCursor: null }),
      store,
      clock,
    });

    expect(result.status).toBe("partial");
    const integration = store.integrations.get("offerings") as Record<string, unknown>;
    expect(integration.sweepCursor).toBe("");
    expect(integration.pendingCursor).toBe("incremental-cursor"); // untouched
  });
});

describe("M7 — reintento único desde el watermark ante provider_client_error con cursor", () => {
  it("limpia el cursor y reintenta una vez cuando el fetch con pendingCursor da 4xx", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await store.setIntegration("offerings", { pendingCursor: "stale-cursor" });

    let call = 0;
    const seenCursors: Array<string | null> = [];
    const result = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: async ({ cursor }: { cursor: string | null }) => {
        call += 1;
        seenCursors.push(cursor);
        if (call === 1) {
          const err = new Error("SumUp 400: cursor invalid");
          (err as { status?: number }).status = 400;
          throw err;
        }
        return { items: [txItem()], nextCursor: null };
      },
      store,
      clock,
    });

    expect(seenCursors).toEqual(["stale-cursor", null]);
    expect(result.status).toBe("completed");
    expect(result.counts.created).toBe(1);
  });

  it("no reintenta dos veces: un segundo provider_client_error sin cursor falla", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await store.setIntegration("offerings", { pendingCursor: "stale-cursor" });

    let call = 0;
    const result = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: async () => {
        call += 1;
        const err = new Error("SumUp 400: still invalid");
        (err as { status?: number }).status = 400;
        throw err;
      },
      store,
      clock,
    });

    expect(call).toBe(2); // one retry from watermark, then it gives up
    expect(result.status).toBe("failed");
    expect(result.errorClass).toBe("provider_client_error");
  });
});
