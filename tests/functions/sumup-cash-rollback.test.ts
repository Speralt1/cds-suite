// @vitest-environment node
//
// Administrative rollback of one SumUp CASH movement (PR #6 hardening §3):
// runs inside the store's runLedgerTransaction with core.summaryDelta, never
// deletes, is idempotent, aborts on unexpected state, and the engine never
// reactivates what it voided.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { MemoryStore, makeClock } from "./sumup-memory-store";
import {
  ROLLBACK_ACTOR,
  ROLLBACK_REASON,
  RollbackAbort,
  rollbackWork,
} from "../../scripts/lib/sumup-cash-rollback-core.mjs";
import { createDryRunStore } from "../../scripts/lib/sumup-dry-run-store.mjs";

const require = createRequire(import.meta.url);
const engine = require("../../functions/sumup/engine.js");
const core = require("../../functions/sumup/core.js");

const CONFIG = { apiKey: "k", merchantCode: "MC-CAFETERIA" };
const FINANCE_ID = "sumup_cafeteria_cash-1";
const EXPECT = { financeId: FINANCE_ID, account: "cafeteria", localDate: "2026-10-04", amount: 163500 };

function cash(overrides: Record<string, unknown> = {}) {
  return {
    id: "cash-1",
    transaction_id: "cash-1",
    transaction_code: "CASH-1",
    amount: 163500,
    refunded_amount: 0,
    currency: "CLP",
    timestamp: "2026-10-04T19:34:36.463Z",
    status: "SUCCESSFUL",
    payment_type: "CASH",
    type: "PAYMENT",
    entry_mode: "none",
    ...overrides,
  };
}
function pos(id: string, amount: number) {
  return { ...cash({ id, transaction_id: id, transaction_code: id, amount, payment_type: "POS", entry_mode: "contactless" }) };
}

function sync(store: MemoryStore, clock: ReturnType<typeof makeClock>, items: unknown[], sweep = false) {
  return engine.runAccountSync({
    account: "cafeteria",
    config: CONFIG,
    trigger: sweep ? "sweep" : "scheduled",
    requestedBy: "system:test",
    fetchPage: async () => ({ items, nextCursor: null }),
    store,
    clock,
    sweep,
  });
}

function rollback(store: MemoryStore, expectOverrides: Partial<typeof EXPECT> = {}, now = 1) {
  const expectArg = { ...EXPECT, ...expectOverrides };
  return store.runLedgerTransaction(
    { account: "cafeteria", rawId: expectArg.financeId.replace("sumup_cafeteria_", ""), financeId: expectArg.financeId },
    rollbackWork({ core, expect: expectArg, now }) as never,
  ) as Promise<{ outcome: string }>;
}

async function importedState() {
  const store = new MemoryStore();
  const clock = makeClock(Date.parse("2026-10-05T12:00:00Z"));
  await sync(store, clock, [pos("p1", 740360)]);
  const summaryWithoutCash = JSON.parse(JSON.stringify(store.summaries.get("2026-10")));
  await sync(store, clock, [pos("p1", 740360), cash()]);
  return { store, clock, summaryWithoutCash };
}

// lastTransactionId is bookkeeping metadata, not one of the 9 summary fields.
const summaryNoMeta = (s: unknown) => {
  const rest = { ...(s as Record<string, unknown>) };
  delete rest.lastTransactionId;
  return rest;
};

describe("rollback administrativo de un CASH SumUp", () => {
  it("anula sin borrar, versiona y devuelve el resumen exactamente al estado previo al import", async () => {
    const { store, summaryWithoutCash } = await importedState();
    expect((store.summaries.get("2026-10") as { incomeTotal: number }).incomeTotal).toBe(903860);

    const result = await rollback(store);
    expect(result.outcome).toBe("rolledBack");
    const doc = store.finance.get(FINANCE_ID)!;
    expect(doc).toMatchObject({
      status: "voided",
      revision: 2,
      amount: 163500,
      paymentMethod: "cash",
      createdBy: "system:sumup",
      updatedBy: ROLLBACK_ACTOR,
      voidedBy: ROLLBACK_ACTOR,
    });
    expect(store.finance.has(FINANCE_ID)).toBe(true);
    expect(summaryNoMeta(store.summaries.get("2026-10"))).toEqual(summaryNoMeta(summaryWithoutCash));
    const versions = store.versions.get("cafeteria/cash-1") as Array<Record<string, unknown>>;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ action: "void", reason: ROLLBACK_REASON, afterAmount: 0 });
    expect((versions[0].before as { status: string }).status).toBe("active");
  });

  it("es idempotente: una segunda ejecución no cambia nada", async () => {
    const { store } = await importedState();
    await rollback(store);
    const snapshot = JSON.parse(JSON.stringify({ f: store.finance.get(FINANCE_ID), s: store.summaries.get("2026-10") }));
    const again = await rollback(store, {}, 2);
    expect(again.outcome).toBe("already");
    expect(JSON.parse(JSON.stringify({ f: store.finance.get(FINANCE_ID), s: store.summaries.get("2026-10") }))).toEqual(snapshot);
    expect(store.versions.get("cafeteria/cash-1")).toHaveLength(1);
  });

  it("el engine nunca lo reactiva: syncs y sweeps posteriores quedan en revisión sin efecto contable", async () => {
    const { store, clock } = await importedState();
    await rollback(store);
    const summaryAfterRollback = JSON.parse(JSON.stringify(store.summaries.get("2026-10")));
    clock.advance(3_600_000);
    const run = await sync(store, clock, [pos("p1", 740360), cash()]);
    clock.advance(3_600_000);
    const sweep = await sync(store, clock, [pos("p1", 740360), cash()], true);
    clock.advance(3_600_000);
    // Even if SumUp later refunds it, nothing is subtracted twice.
    const refunded = await sync(store, clock, [pos("p1", 740360), cash({ status: "REFUNDED", refunded_amount: 163500 })]);
    for (const r of [run, sweep, refunded]) {
      expect(r.counts).toMatchObject({ created: 0, updated: 0, voided: 0, reactivated: 0, review: 1 });
    }
    expect(store.finance.get(FINANCE_ID)).toMatchObject({ status: "voided", voidedBy: ROLLBACK_ACTOR, revision: 2 });
    expect(store.raw.get("cafeteria/cash-1")).toMatchObject({ review: true, reviewReason: "human_voided" });
    expect(store.summaries.get("2026-10")).toEqual(summaryAfterRollback);
  });

  it.each([
    ["monto distinto", { amount: 163000 }],
    ["fecha distinta", { localDate: "2026-10-05" }],
    ["otra cuenta", { account: "offerings" }],
    ["id que no es SumUp", { financeId: "cash_cafeteria_2026-10-04" }],
    ["id inexistente", { financeId: "sumup_cafeteria_nope" }],
  ])("aborta sin escribir ante estado inesperado: %s", async (_label, overrides) => {
    const { store } = await importedState();
    const before = JSON.parse(JSON.stringify({ f: [...store.finance], s: [...store.summaries] }));
    await expect(rollback(store, overrides as Partial<typeof EXPECT>)).rejects.toBeInstanceOf(RollbackAbort);
    expect(JSON.parse(JSON.stringify({ f: [...store.finance], s: [...store.summaries] }))).toEqual(before);
    expect(store.versions.get("cafeteria/cash-1")).toBeUndefined();
  });

  it("aborta si el movimiento es tarjeta, fue editado por un humano o ya lo anuló SumUp", async () => {
    const { store, clock } = await importedState();
    const original = store.finance.get(FINANCE_ID)!;

    store.finance.set(FINANCE_ID, { ...original, paymentMethod: "card" });
    await expect(rollback(store)).rejects.toBeInstanceOf(RollbackAbort);

    store.finance.set(FINANCE_ID, { ...original, updatedBy: "uid-human" });
    await expect(rollback(store)).rejects.toThrow(/modificado fuera del sync/);

    store.finance.set(FINANCE_ID, original);
    clock.advance(1000);
    await sync(store, clock, [pos("p1", 740360), cash({ status: "REFUNDED", refunded_amount: 163500 })]);
    expect(store.finance.get(FINANCE_ID)).toMatchObject({ status: "voided", voidedBy: "system:sumup" });
    await expect(rollback(store)).rejects.toThrow(/ya está anulado por otro actor/);
  });

  it("en dry-run calcula el plan completo sin escribir nada en el origen (lector de solo lectura)", async () => {
    const { store, summaryWithoutCash } = await importedState();
    const frozen = JSON.stringify({ f: [...store.finance], s: [...store.summaries], v: [...store.versions] });
    const reader = {
      getIntegration: async () => null,
      getFinance: async (id: string) => store.finance.get(id) || null,
      getRaw: async (account: string, id: string) => store.raw.get(`${account}/${id}`) || null,
      getSummary: async (period: string) => store.summaries.get(period) || null,
    };
    const dry = createDryRunStore(reader);
    const result = await dry.store.runLedgerTransaction(
      { account: "cafeteria", rawId: "cash-1", financeId: FINANCE_ID },
      rollbackWork({ core, expect: EXPECT, now: 1 }),
    );
    expect(result.outcome).toBe("rolledBack");
    expect(dry.log.financeWrites[0].after).toMatchObject({ status: "voided", voidedBy: ROLLBACK_ACTOR });
    expect(summaryNoMeta(dry.summaryChanges()[0].after)).toEqual(summaryNoMeta(summaryWithoutCash));
    expect(dry.log.versions).toEqual([{ account: "cafeteria", rawId: "cash-1", action: "void", reason: ROLLBACK_REASON }]);
    expect(JSON.stringify({ f: [...store.finance], s: [...store.summaries], v: [...store.versions] })).toBe(frozen);
  });

  it("aborta si el resumen no contiene el monto (nunca deja montos negativos)", async () => {
    const { store } = await importedState();
    const s = store.summaries.get("2026-10") as Record<string, Record<string, number>>;
    store.summaries.set("2026-10", { ...s, dailyIncome: { "4": 1000 } });
    await expect(rollback(store)).rejects.toThrow(/dailyIncome/);
    expect(store.finance.get(FINANCE_ID)).toMatchObject({ status: "active" });
  });
});
