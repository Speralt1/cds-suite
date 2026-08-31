import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import {
  applyImpact,
  emptySummary,
  combineSummaries,
  reviseSummaries,
  validateTransaction,
  variation,
  evolution,
} from "@/lib/finance/calculations";
import {
  clp,
  parseDate,
  dateLabel,
  previousPeriod,
  periodBounds,
} from "@/lib/finance/formatters";
import type { FinanceTransaction, TransactionInput } from "@/lib/finance/types";
export const fixture = (
  overrides: Partial<FinanceTransaction> = {},
): FinanceTransaction => ({
  id: "fixture",
  type: "income",
  amount: 1250000,
  date: parseDate("2026-08-03"),
  period: "2026-08",
  day: "3",
  category: "Ofrendas",
  description: "Culto",
  paymentMethod: "cash",
  source: "general",
  status: "active",
  revision: 1,
  note: "",
  createdBy: "test",
  updatedBy: "test",
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...overrides,
});
describe("cálculos con pesos enteros", () => {
  it("formatea CLP sin decimales y fechas válidas", () => {
    expect(clp(1250000)).toBe("$1.250.000");
    expect(clp(NaN)).toBe("$0");
    expect(dateLabel()).toBe("Sin registro");
    expect(() => parseDate("2026-02-30")).toThrow();
    expect(() => parseDate("invalid")).toThrow();
    expect(parseDate("2024-02-29").toDate().getUTCDate()).toBe(29);
    expect(periodBounds({ year: 2026, month: 12, view: "month" })).toEqual({
      start: "2026-12-01",
      end: "2027-01-01",
    });
    expect(previousPeriod({ year: 2026, month: 1, view: "month" }).year).toBe(
      2025,
    );
  });
  it.each([0, -1, 0.1, Infinity, Number.MAX_SAFE_INTEGER])(
    "rechaza monto inválido %s",
    (amount) => {
      expect(() =>
        validateTransaction({
          ...fixture(),
          amount,
          date: "2026-08-03",
        } as TransactionInput),
      ).toThrow();
    },
  );
  it("entrada, salida, edición entre meses y anulación conservan balances", () => {
    const income = fixture();
    const expense = fixture({
      id: "expense",
      type: "expense",
      category: "Mantención",
      amount: 250000,
    });
    let s = applyImpact(
      applyImpact(emptySummary("2026-08"), income, 1),
      expense,
      1,
    );
    expect(s.result).toBe(1000000);
    expect(s.transactionCount).toBe(2);
    const moved = { ...income, amount: 900000, period: "2026-09", day: "2" };
    const changes = reviseSummaries({ "2026-08": s }, income, moved);
    expect(changes[0].incomeTotal).toBe(0);
    expect(changes[1].incomeTotal).toBe(900000);
    s = reviseSummaries({ "2026-09": changes[1] }, moved, {
      ...moved,
      status: "voided",
    })[0];
    expect(s.incomeTotal).toBe(0);
    expect(s.transactionCount).toBe(0);
    expect(s.incomeByCategory.Ofrendas).toBe(0);
  });
  it("diezmo suma ingreso y total específico una sola vez", () => {
    const t = fixture({ source: "tithe", category: "Diezmos" });
    const s = applyImpact(emptySummary(t.period), t, 1);
    expect(s.titheTotal).toBe(t.amount);
    expect(s.incomeTotal).toBe(t.amount);
    expect(combineSummaries([s]).result).toBe(t.amount);
  });
  it("no inventa variaciones y muestra los doce meses vacíos", () => {
    expect(variation(50, 0)).toBeNull();
    expect(variation(110, 100)).toBe(10);
    expect(combineSummaries([]).result).toBe(0);
    expect(evolution([], { year: 2026, month: 1, view: "year" })).toHaveLength(
      12,
    );
    expect(evolution([], { year: 2026, month: 2, view: "month" })).toHaveLength(
      28,
    );
  });
});

it("rechaza un total que comprometería precisión al combinar los doce meses", () => {
  const maxMonthly = Math.floor(Number.MAX_SAFE_INTEGER / 12);
  const s = {
    ...emptySummary("2026-08"),
    incomeTotal: maxMonthly,
    result: maxMonthly,
    incomeByCategory: { Ofrendas: maxMonthly },
    dailyIncome: { "3": maxMonthly },
    transactionCount: 1,
  };
  expect(() => applyImpact(s, fixture({ amount: 1 }), 1)).toThrow(
    "límite seguro",
  );
});
