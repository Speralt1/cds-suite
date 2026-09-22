// @vitest-environment node
import { createRequire } from "node:module";
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore, makeClock } from "./sumup-memory-store";

const require = createRequire(import.meta.url);
const engine = require("../../functions/sumup/engine.js");

const CONFIG_OFFERINGS = { apiKey: "key-offerings", merchantCode: "MC-OFFERINGS" };
const CONFIG_CAFETERIA = { apiKey: "key-cafeteria", merchantCode: "MC-CAFETERIA" };

function txItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    transaction_id: "tx-1",
    transaction_code: "COD-1",
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

/** Builds a fetchPage mock that serves a fixed list of pages once each, in order. */
function pagedFetch(pages: Array<{ items: unknown[]; nextCursor?: string | null }>) {
  let callIndex = 0;
  return async () => {
    if (callIndex >= pages.length) return { items: [], nextCursor: null };
    const page = pages[callIndex];
    callIndex += 1;
    return { items: page.items, nextCursor: page.nextCursor ?? null };
  };
}

describe("runAccountSync — duplicado", () => {
  it("correr el mismo sync dos veces produce un solo doc y delta neto 0 en la segunda pasada", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));

    const run1 = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem()] }]),
      store,
      clock,
    });
    expect(run1.status).toBe("completed");
    expect(run1.counts.created).toBe(1);
    expect(store.finance.size).toBe(1);
    const summaryAfterFirst = JSON.parse(JSON.stringify(store.summaries.get("2026-09")));

    clock.advance(1000);
    const run2 = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem()] }]),
      store,
      clock,
    });
    expect(run2.status).toBe("completed");
    expect(run2.counts.created).toBe(0);
    expect(run2.counts.unchanged).toBe(1);
    expect(store.finance.size).toBe(1);
    expect(store.summaries.get("2026-09")).toEqual(summaryAfterFirst);
  });
});

describe("runAccountSync — resultado desconocido / timeout", () => {
  it("un timeout tras un commit parcial, seguido de un reintento, converge al mismo estado final", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));

    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("SumUp timeout (15s)");
        (err as { errorClass?: string }).errorClass = "provider_unavailable";
        throw err;
      }
      return { items: [txItem()], nextCursor: null };
    };

    const run1 = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: flaky,
      store,
      clock,
    });
    expect(run1.status).toBe("failed");
    expect(run1.errorClass).toBe("provider_unavailable");
    expect(store.finance.size).toBe(0);

    clock.advance(1000);
    const run2 = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: flaky,
      store,
      clock,
    });
    expect(run2.status).toBe("completed");
    expect(run2.counts.created).toBe(1);
    expect(store.finance.size).toBe(1);
  });
});

describe("runAccountSync — reembolsos", () => {
  it("reembolso total anula el doc y resta del mes original", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem()] }]),
      store,
      clock,
    });
    expect((store.summaries.get("2026-09") as { incomeTotal: number }).incomeTotal).toBe(10000);

    clock.advance(1000);
    const run2 = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem({ status: "REFUNDED", refunded_amount: 10000 })] }]),
      store,
      clock,
    });
    expect(run2.counts.voided).toBe(1);
    expect(store.finance.get("sumup_offerings_tx-1")?.status).toBe("voided");
    expect((store.summaries.get("2026-09") as { incomeTotal: number }).incomeTotal).toBe(0);
  });

  it("reembolso parcial reduce el monto y agrega una versión", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem()] }]),
      store,
      clock,
    });

    clock.advance(1000);
    const run2 = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem({ status: "REFUNDED", refunded_amount: 4000 })] }]),
      store,
      clock,
    });
    expect(run2.counts.updated).toBe(1);
    expect(store.finance.get("sumup_offerings_tx-1")?.amount).toBe(6000);
    expect((store.summaries.get("2026-09") as { incomeTotal: number }).incomeTotal).toBe(6000);
    expect(store.versions.get("offerings/tx-1")?.length).toBe(1);
  });
});

describe("runAccountSync — contracargo", () => {
  it("un CHARGE_BACK va a adjustments con reviewRequired y no toca el libro", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem()] }]),
      store,
      clock,
    });
    const before = { ...(store.finance.get("sumup_offerings_tx-1") as Record<string, unknown>) };

    clock.advance(1000);
    const run2 = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem({ id: "cb-1", transaction_id: "cb-1", type: "CHARGE_BACK" })] }]),
      store,
      clock,
    });
    expect(run2.counts.chargebacks).toBe(1);
    expect(run2.counts.review).toBe(1);
    expect(store.adjustments.get("offerings/cb-1")).toMatchObject({ type: "chargeback", reviewRequired: true });
    expect(store.finance.get("sumup_offerings_tx-1")).toEqual(before);
  });
});

describe("runAccountSync — estado degradado", () => {
  it("SUCCESSFUL -> CANCELLED sobre un doc activo genera review sin tocar el libro", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem()] }]),
      store,
      clock,
    });
    const before = { ...(store.finance.get("sumup_offerings_tx-1") as Record<string, unknown>) };

    clock.advance(1000);
    const run2 = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem({ status: "CANCELLED" })] }]),
      store,
      clock,
    });
    expect(run2.counts.review).toBe(1);
    expect(store.finance.get("sumup_offerings_tx-1")).toEqual(before);
    expect(store.raw.get("offerings/tx-1")).toMatchObject({ review: true, reviewReason: "status_downgraded" });
  });
});

describe("runAccountSync — comisión ausente", () => {
  it("sin fee_amount el libro registra bruto-reembolso y feeStatus unknown", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    const result = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem()] }]),
      store,
      clock,
    });
    expect(result.counts.created).toBe(1);
    expect(store.finance.get("sumup_offerings_tx-1")?.amount).toBe(10000);
    expect(store.raw.get("offerings/tx-1")).toMatchObject({ feeAmount: null, feeStatus: "unknown", amountBasis: "gross_minus_refunds" });
  });
});

describe("runAccountSync — separación de cuentas", () => {
  it("dos cuentas nunca se mezclan y detectan el mismo merchant configurado dos veces", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));

    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      otherMerchantCode: CONFIG_CAFETERIA.merchantCode,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem({ merchant_code: "MC-OFFERINGS" })] }]),
      store,
      clock,
    });
    await engine.runAccountSync({
      account: "cafeteria",
      config: CONFIG_CAFETERIA,
      otherMerchantCode: CONFIG_OFFERINGS.merchantCode,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem({ id: "tx-2", transaction_id: "tx-2", merchant_code: "MC-CAFETERIA" })] }]),
      store,
      clock,
    });
    expect(store.finance.has("sumup_offerings_tx-1")).toBe(true);
    expect(store.finance.has("sumup_cafeteria_tx-2")).toBe(true);
    expect(store.finance.has("sumup_offerings_tx-2")).toBe(false);
    expect(store.finance.has("sumup_cafeteria_tx-1")).toBe(false);

    const collision = await engine.runAccountSync({
      account: "cafeteria",
      config: { apiKey: "key", merchantCode: "MC-OFFERINGS" },
      otherMerchantCode: "MC-OFFERINGS",
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [] }]),
      store,
      clock,
    });
    expect(collision.status).toBe("failed");
    expect(collision.errorClass).toBe("config_error");
  });
});

describe("runAccountSync — aislamiento", () => {
  it("si offerings falla, cafeteria de todas formas termina completed", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));

    const failing = async () => {
      const err = new Error("SumUp 503: down");
      (err as { status?: number }).status = 503;
      throw err;
    };

    const [offerings, cafeteria] = await Promise.all([
      engine.runAccountSync({
        account: "offerings",
        config: CONFIG_OFFERINGS,
        trigger: "scheduled",
        requestedBy: "system",
        fetchPage: failing,
        store,
        clock,
      }),
      engine.runAccountSync({
        account: "cafeteria",
        config: CONFIG_CAFETERIA,
        trigger: "scheduled",
        requestedBy: "system",
        fetchPage: pagedFetch([{ items: [txItem({ id: "tx-9", transaction_id: "tx-9", merchant_code: "MC-CAFETERIA" })] }]),
        store,
        clock,
      }),
    ]);

    expect(offerings.status).toBe("failed");
    expect(offerings.errorClass).toBe("provider_unavailable");
    expect(cafeteria.status).toBe("completed");
    expect(store.finance.has("sumup_cafeteria_tx-9")).toBe(true);
  });
});

describe("runAccountSync — scheduler y manual simultáneos (lease)", () => {
  it("un manual mientras el scheduler corre para la misma cuenta responde already_running", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));

    let releaseScheduled: (() => void) | undefined;
    const blockingFetch = () =>
      new Promise((resolve) => {
        releaseScheduled = () => resolve({ items: [txItem()], nextCursor: null });
      });

    const scheduledPromise = engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "scheduled",
      requestedBy: "system",
      leaseTtlMs: 9 * 60_000,
      fetchPage: blockingFetch,
      store,
      clock,
    });

    // Give the scheduled run a tick to acquire the lease before the manual one starts.
    await Promise.resolve();
    await Promise.resolve();

    const manualResult = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      leaseTtlMs: 60_000,
      fetchPage: pagedFetch([{ items: [] }]),
      store,
      clock,
    });
    expect(manualResult.status).toBe("already_running");

    releaseScheduled?.();
    const scheduledResult = await scheduledPromise;
    expect(scheduledResult.status).toBe("completed");
  });

  it("una vez vencida la lease (TTL), el siguiente run la puede tomar (abandoned)", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await store.acquireLease("offerings", { ttlMs: 1000, runId: "stale-run", trigger: "scheduled", now: clock.now() });
    store.runs.set("stale-run", { status: "running" });

    clock.advance(5000);
    const result = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [] }]),
      store,
      clock,
    });
    expect(result.status).toBe("completed");
    expect(store.runs.get("stale-run")).toMatchObject({ status: "abandoned" });
  });
});

describe("runAccountSync — cambio de mes", () => {
  it("una transacción de las 23:30 (Chile) del 30/09 queda en period 2026-09 día 30", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-10-01T12:00:00Z"));
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem({ timestamp: "2026-10-01T02:30:00Z" })] }]),
      store,
      clock,
    });
    const doc = store.finance.get("sumup_offerings_tx-1") as Record<string, unknown>;
    expect(doc.period).toBe("2026-09");
    expect(doc.day).toBe("30");
  });
});

describe("runAccountSync — paginación y watermark", () => {
  it("3 páginas con más de 100 ítems se importan al 100%", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    const page1 = Array.from({ length: 50 }, (_, i) => txItem({ id: `p1-${i}`, transaction_id: `p1-${i}` }));
    const page2 = Array.from({ length: 50 }, (_, i) => txItem({ id: `p2-${i}`, transaction_id: `p2-${i}` }));
    const page3 = Array.from({ length: 10 }, (_, i) => txItem({ id: `p3-${i}`, transaction_id: `p3-${i}` }));

    const result = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "scheduled",
      requestedBy: "system",
      fetchPage: pagedFetch([
        { items: page1, nextCursor: "cursor-2" },
        { items: page2, nextCursor: "cursor-3" },
        { items: page3, nextCursor: null },
      ]),
      store,
      clock,
    });

    expect(result.status).toBe("completed");
    expect(result.counts.fetched).toBe(110);
    expect(result.counts.created).toBe(110);
    expect(store.finance.size).toBe(110);
  });

  it("presupuesto agotado -> partial sin avanzar watermark; la siguiente corrida completa sin duplicados", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    const page1 = [txItem({ id: "budget-1", transaction_id: "budget-1" })];
    const page2 = [txItem({ id: "budget-2", transaction_id: "budget-2" })];

    let call = 0;
    const fetchPage = async () => {
      call += 1;
      if (call === 1) {
        // Leaves 15s of the 40s budget — under the 20s (15s fetch + 5s
        // margin) M5 requires before starting another page, but not enough
        // to trip the mid-item deadline check while processing this page.
        clock.advance(25_000);
        return { items: page1, nextCursor: "cursor-2" };
      }
      return { items: page2, nextCursor: null };
    };

    const run1 = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      budgetMs: 40_000,
      fetchPage,
      store,
      clock,
    });
    expect(run1.status).toBe("partial");
    expect(store.finance.has("sumup_offerings_budget-1")).toBe(true);
    expect(store.finance.has("sumup_offerings_budget-2")).toBe(false);
    expect(store.integrations.get("offerings")?.watermark).toBeUndefined();
    expect(store.integrations.get("offerings")?.pendingCursor).toBe("cursor-2");

    clock.advance(1000);
    const run2 = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      budgetMs: 40_000,
      fetchPage,
      store,
      clock,
    });
    expect(run2.status).toBe("completed");
    expect(store.finance.has("sumup_offerings_budget-2")).toBe(true);
    expect(store.finance.size).toBe(2);
  });
});

describe("runAccountSync — humano editó, no se sobrescribe", () => {
  it("un doc con updatedBy distinto de system:sumup se marca review y no cambia", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem()] }]),
      store,
      clock,
    });
    const humanEdited = { ...(store.finance.get("sumup_offerings_tx-1") as Record<string, unknown>), amount: 7777, updatedBy: "uid-editor" };
    store.finance.set("sumup_offerings_tx-1", humanEdited);

    clock.advance(1000);
    const run2 = await engine.runAccountSync({
      account: "offerings",
      config: CONFIG_OFFERINGS,
      trigger: "manual",
      requestedBy: "uid-1",
      fetchPage: pagedFetch([{ items: [txItem({ status: "REFUNDED", refunded_amount: 4000 })] }]),
      store,
      clock,
    });
    expect(run2.counts.review).toBe(1);
    expect(store.finance.get("sumup_offerings_tx-1")).toEqual(humanEdited);
  });
});

describe("beforeEach reset sanity", () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore();
  });
  it("un store nuevo empieza vacío", () => {
    expect(store.finance.size).toBe(0);
  });
});
