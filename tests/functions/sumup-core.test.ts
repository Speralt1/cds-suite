// @vitest-environment node
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const core = require("../../functions/sumup/core.js");

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    transaction_id: "tx-1",
    transaction_code: "ABC123",
    amount: 10000,
    refunded_amount: 0,
    currency: "CLP",
    timestamp: "2026-09-15T15:00:00Z",
    status: "SUCCESSFUL",
    payment_type: "POS",
    type: "PAYMENT",
    merchant_code: "MC1",
    ...overrides,
  };
}

describe("ledgerAmount", () => {
  it("es bruto menos reembolso, nunca negativo", () => {
    expect(core.ledgerAmount(10000, 0)).toBe(10000);
    expect(core.ledgerAmount(10000, 4000)).toBe(6000);
    expect(core.ledgerAmount(10000, 15000)).toBe(0);
    expect(core.ledgerAmount(10000.6, 0)).toBe(10001);
  });
});

describe("datePartsChile — cambio de mes", () => {
  it("2026-09-30T23:30-03:00 cae en period 2026-09 día 30", () => {
    const parts = core.datePartsChile("2026-10-01T02:30:00Z");
    expect(parts.period).toBe("2026-09");
    expect(parts.dayKey).toBe("30");
    expect(parts.localDate).toBe("2026-09-30");
  });

  it("2026-10-01T02:00:00Z cae en period 2026-09 (aún 23:00 del 30 en Chile)", () => {
    const parts = core.datePartsChile("2026-10-01T02:00:00Z");
    expect(parts.period).toBe("2026-09");
    expect(parts.localDate).toBe("2026-09-30");
  });

  it("2026-10-01T04:00:00Z ya cae en period 2026-10", () => {
    const parts = core.datePartsChile("2026-10-01T04:00:00Z");
    expect(parts.period).toBe("2026-10");
    expect(parts.localDate).toBe("2026-10-01");
  });
});

describe("normalizeItem + classifyItem", () => {
  it("crea cuando no existe y está SUCCESSFUL", () => {
    const normalized = core.normalizeItem(item(), "offerings");
    const decision = core.classifyItem(normalized, { financeDoc: null, rawSnapshotHash: null }, { mode: "main" });
    expect(decision.action).toBe("create");
    expect(normalized.amount).toBe(10000);
    expect(normalized.feeAmount).toBeNull();
    expect(normalized.feeStatus).toBe("unknown");
  });

  it("comisión: si fee_amount llega, se guarda pero el libro no cambia", () => {
    const normalized = core.normalizeItem(item({ fee_amount: 300 }), "offerings");
    expect(normalized.feeAmount).toBe(300);
    expect(normalized.feeStatus).toBe("provider");
    expect(normalized.amount).toBe(10000); // ledger unaffected by fee
  });

  it("no-POS / no-CLP / no-PAYMENT / PENDING / preSplit se ignoran con razón", () => {
    const nonPos = core.normalizeItem(item({ payment_type: "ECOM" }), "offerings");
    expect(core.classifyItem(nonPos, { financeDoc: null, rawSnapshotHash: null }, { mode: "main" })).toMatchObject({
      action: "ignored",
      reason: "nonPOS",
    });

    const nonClp = core.normalizeItem(item({ currency: "USD" }), "offerings");
    expect(core.classifyItem(nonClp, { financeDoc: null, rawSnapshotHash: null }, { mode: "main" })).toMatchObject({
      action: "ignored",
      reason: "nonCLP",
    });

    const nonPayment = core.normalizeItem(item({ type: "REFUND" }), "offerings");
    expect(core.classifyItem(nonPayment, { financeDoc: null, rawSnapshotHash: null }, { mode: "main" })).toMatchObject(
      { action: "ignored", reason: "nonPayment" },
    );

    const pending = core.normalizeItem(item({ status: "PENDING" }), "offerings");
    expect(core.classifyItem(pending, { financeDoc: null, rawSnapshotHash: null }, { mode: "main" })).toMatchObject({
      action: "ignored",
      reason: "pending",
    });

    const preSplit = core.normalizeItem(item({ timestamp: "2026-01-01T15:00:00Z" }), "offerings");
    expect(core.classifyItem(preSplit, { financeDoc: null, rawSnapshotHash: null }, { mode: "main" })).toMatchObject({
      action: "ignored",
      reason: "preSplit",
    });
  });

  it("CHARGE_BACK -> review con reason chargeback, nunca toca el libro directamente", () => {
    const normalized = core.normalizeItem(item({ type: "CHARGE_BACK" }), "offerings");
    const decision = core.classifyItem(normalized, { financeDoc: null, rawSnapshotHash: null }, { mode: "main" });
    expect(decision).toMatchObject({ action: "review", reason: "chargeback" });
  });

  it("SUCCESSFUL activo que pasa a CANCELLED/FAILED -> review, no ignored", () => {
    const normalized = core.normalizeItem(item({ status: "CANCELLED" }), "offerings");
    const existing = { financeDoc: { status: "active", amount: 10000, category: "Ofrendas", day: "15", updatedBy: "system:sumup" }, rawSnapshotHash: "x" };
    const decision = core.classifyItem(normalized, existing, { mode: "main" });
    expect(decision).toMatchObject({ action: "review", reason: "status_downgraded" });
  });

  it("CANCELLED sin doc existente se ignora (nunca existió)", () => {
    const normalized = core.normalizeItem(item({ status: "FAILED" }), "offerings");
    const decision = core.classifyItem(normalized, { financeDoc: null, rawSnapshotHash: null }, { mode: "main" });
    expect(decision).toMatchObject({ action: "ignored", reason: "other" });
  });

  it("reembolso total -> void; reembolso parcial -> update", () => {
    const existing = { financeDoc: { status: "active", amount: 10000, category: "Ofrendas", day: "15", updatedBy: "system:sumup" }, rawSnapshotHash: "different" };

    const totalRefund = core.normalizeItem(item({ status: "REFUNDED", refunded_amount: 10000 }), "offerings");
    expect(core.classifyItem(totalRefund, existing, { mode: "main" })).toMatchObject({ action: "void" });

    const partialRefund = core.normalizeItem(item({ status: "REFUNDED", refunded_amount: 4000 }), "offerings");
    expect(core.classifyItem(partialRefund, existing, { mode: "main" })).toMatchObject({ action: "update" });
  });

  it("anulado por el sistema que revive -> reactivate; anulado por humano -> review", () => {
    const voidedBySystem = { financeDoc: { status: "voided", amount: 0, category: "Ofrendas", day: "15", voidedBy: "system:sumup", updatedBy: "system:sumup" }, rawSnapshotHash: null };
    const revived = core.normalizeItem(item({ status: "SUCCESSFUL", refunded_amount: 0 }), "offerings");
    expect(core.classifyItem(revived, voidedBySystem, { mode: "main" })).toMatchObject({ action: "reactivate" });

    const voidedByHuman = { financeDoc: { status: "voided", amount: 0, category: "Ofrendas", day: "15", voidedBy: "uid-123", updatedBy: "uid-123" }, rawSnapshotHash: null };
    expect(core.classifyItem(revived, voidedByHuman, { mode: "main" })).toMatchObject({ action: "review", reason: "human_voided" });
  });

  it("editado por humano (updatedBy distinto de system:sumup) -> review, no se sobrescribe", () => {
    const editedByHuman = { financeDoc: { status: "active", amount: 8000, category: "Ofrendas", day: "15", updatedBy: "uid-editor" }, rawSnapshotHash: "abc" };
    const changed = core.normalizeItem(item({ status: "REFUNDED", refunded_amount: 4000 }), "offerings");
    expect(core.classifyItem(changed, editedByHuman, { mode: "main" })).toMatchObject({ action: "review", reason: "human_edited" });
  });

  it("sin cambios (mismo hash, categoría y día) -> unchanged", () => {
    const normalized = core.normalizeItem(item(), "offerings");
    const existing = {
      financeDoc: { status: "active", amount: normalized.amount, category: normalized.category, day: normalized.dayKey, updatedBy: "system:sumup" },
      rawSnapshotHash: normalized.snapshotHash,
    };
    expect(core.classifyItem(normalized, existing, { mode: "main" })).toMatchObject({ action: "unchanged" });
  });
});

describe("summaryDelta / applySummaryDelta", () => {
  it("crear desde cero suma al total, categoría y día", () => {
    const delta = core.summaryDelta(
      { active: false, amount: 0, category: null, day: null },
      { active: true, amount: 10000, category: "Ofrendas", day: "15" },
    );
    expect(delta.incomeTotalDelta).toBe(10000);
    expect(delta.countDelta).toBe(1);
    expect(delta.categoryDeltas).toEqual({ Ofrendas: 10000 });
    expect(delta.dayDeltas).toEqual({ "15": 10000 });

    const next = core.applySummaryDelta({}, delta);
    expect(next.incomeTotal).toBe(10000);
    expect(next.incomeByCategory).toEqual({ Ofrendas: 10000 });
  });

  it("anular resta del total y elimina claves en cero", () => {
    const summary = { incomeTotal: 10000, transactionCount: 1, incomeByCategory: { Ofrendas: 10000 }, dailyIncome: { "15": 10000 } };
    const delta = core.summaryDelta(
      { active: true, amount: 10000, category: "Ofrendas", day: "15" },
      { active: false, amount: 0, category: "Ofrendas", day: "15" },
    );
    const next = core.applySummaryDelta(summary, delta);
    expect(next.incomeTotal).toBe(0);
    expect(next.incomeByCategory).toEqual({});
    expect(next.dailyIncome).toEqual({});
  });
});

describe("classifyHttpError", () => {
  it("clasifica 401/403 -> auth_error, 429 -> rate_limited, 5xx -> provider_unavailable, 4xx -> provider_client_error", () => {
    expect(core.classifyHttpError({ status: 401 })).toBe("auth_error");
    expect(core.classifyHttpError({ status: 403 })).toBe("auth_error");
    expect(core.classifyHttpError({ status: 429 })).toBe("rate_limited");
    expect(core.classifyHttpError({ status: 503 })).toBe("provider_unavailable");
    expect(core.classifyHttpError({ status: 400 })).toBe("provider_client_error");
  });

  it("clasifica un abort/timeout como provider_unavailable", () => {
    expect(core.classifyHttpError({ name: "AbortError" })).toBe("provider_unavailable");
    expect(core.classifyHttpError({ message: "The operation timed out" })).toBe("provider_unavailable");
  });
});

describe("no-regresión financiera", () => {
  // Oráculo: copia literal de la fórmula vieja (functions/index.js antes del
  // slice, líneas 194-198) para comprobar que el monto del libro no cambia.
  function oldLiquid(amount: number, refundedAmount: number, feeAmount = 0) {
    const gross = Math.max(0, Math.round(Number(amount || 0)));
    const refunded = Math.max(0, Math.round(Number(refundedAmount || 0)));
    const amountAfterRefunds = Math.max(0, gross - refunded);
    const fee = Math.max(0, Math.round(Number(feeAmount || 0)));
    return Math.max(0, amountAfterRefunds - fee);
  }

  it("coincide para una variedad de montos porque fee_amount siempre llega ausente hoy", () => {
    const cases: Array<[number, number]> = [
      [10000, 0],
      [10000, 4000],
      [10000, 10000],
      [1, 0],
      [999999, 500000],
    ];
    for (const [amount, refunded] of cases) {
      expect(core.ledgerAmount(amount, refunded)).toBe(oldLiquid(amount, refunded, 0));
    }
  });
});
