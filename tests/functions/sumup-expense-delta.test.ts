// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../../functions/sumup/core.js");

describe("expenseSummaryDelta / applyExpenseSummaryDelta (Slice 3a fee ledger)", () => {
  it("crea el gasto por primera vez", () => {
    const delta = core.expenseSummaryDelta(null, { active: true, amount: 34083, category: "Comisión SumUp · Ofrendas", day: "10" });
    expect(delta.expenseTotalDelta).toBe(34083);
    const next = core.applyExpenseSummaryDelta({}, delta);
    expect(next.expenseTotal).toBe(34083);
    expect(next.expenseByCategory["Comisión SumUp · Ofrendas"]).toBe(34083);
    expect(next.dailyExpense["10"]).toBe(34083);
    expect(next.result).toBe(-34083);
  });

  it("recalcula al alza cuando la comisión sube", () => {
    const before = { active: true, amount: 34083, category: "Comisión SumUp · Ofrendas", day: "10" };
    const after = { active: true, amount: 40000, category: "Comisión SumUp · Ofrendas", day: "10" };
    const delta = core.expenseSummaryDelta(before, after);
    expect(delta.expenseTotalDelta).toBe(40000 - 34083);
    const summary = { expenseTotal: 34083, expenseByCategory: { "Comisión SumUp · Ofrendas": 34083 }, dailyExpense: { "10": 34083 } };
    const next = core.applyExpenseSummaryDelta(summary, delta);
    expect(next.expenseTotal).toBe(40000);
    expect(next.expenseByCategory["Comisión SumUp · Ofrendas"]).toBe(40000);
  });

  it("anulación a $0 elimina la categoría y el día del resumen (patrón B1, sin merge)", () => {
    const before = { active: true, amount: 34083, category: "Comisión SumUp · Ofrendas", day: "10" };
    const after = { active: false, amount: 0, category: "Comisión SumUp · Ofrendas", day: "10" };
    const delta = core.expenseSummaryDelta(before, after);
    const summary = { expenseTotal: 34083, expenseByCategory: { "Comisión SumUp · Ofrendas": 34083 }, dailyExpense: { "10": 34083 } };
    const next = core.applyExpenseSummaryDelta(summary, delta);
    expect(next.expenseTotal).toBe(0);
    expect(next.expenseByCategory["Comisión SumUp · Ofrendas"]).toBeUndefined();
    expect(next.dailyExpense["10"]).toBeUndefined();
  });

  it("result siempre es incomeTotal - expenseTotal tras aplicar el delta", () => {
    const delta = core.expenseSummaryDelta(null, { active: true, amount: 1000, category: "Comisión SumUp · Cafetería", day: "5" });
    const next = core.applyExpenseSummaryDelta({ incomeTotal: 5000 }, delta);
    expect(next.result).toBe(4000);
  });

  it("no toca incomeByCategory/dailyIncome existentes", () => {
    const delta = core.expenseSummaryDelta(null, { active: true, amount: 1000, category: "Comisión SumUp · Cafetería", day: "5" });
    const summary = { incomeTotal: 5000, incomeByCategory: { Cafetería: 5000 }, dailyIncome: { "5": 5000 } };
    const next = core.applyExpenseSummaryDelta(summary, delta);
    expect(next.incomeByCategory).toEqual({ Cafetería: 5000 });
    expect(next.dailyIncome).toEqual({ "5": 5000 });
  });
});
