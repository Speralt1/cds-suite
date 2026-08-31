import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  MAX_AMOUNT,
  MAX_MONTHLY_TOTAL,
  PAYMENT_METHODS,
} from "./constants";
import { parseDate, periodId } from "./formatters";
import type {
  FinanceTransaction,
  MonthlySummary,
  PeriodSelection,
  TransactionInput,
} from "./types";
export function validateTransaction(input: TransactionInput, tithe = false) {
  if (
    !Number.isSafeInteger(input.amount) ||
    input.amount <= 0 ||
    input.amount > MAX_AMOUNT
  )
    throw new Error(
      "Ingresa un monto entero entre $1 y $1.000.000.000.000, sin decimales.",
    );
  parseDate(input.date);
  if (!["income", "expense"].includes(input.type))
    throw new Error("Selecciona entrada o salida.");
  const categories: readonly string[] =
    input.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (
    tithe
      ? input.type !== "income" || input.category !== "Diezmos"
      : !categories.includes(input.category)
  )
    throw new Error("Selecciona una categoría válida.");
  if (!(input.paymentMethod in PAYMENT_METHODS))
    throw new Error("Selecciona un método de pago.");
  if (!input.description.trim() || input.description.trim().length > 200)
    throw new Error(
      "La descripción es obligatoria y admite hasta 200 caracteres.",
    );
  if ((input.note?.length || 0) > 1000)
    throw new Error("La nota admite hasta 1.000 caracteres.");
}
export function emptySummary(id: string): MonthlySummary {
  return {
    id,
    incomeTotal: 0,
    expenseTotal: 0,
    result: 0,
    titheTotal: 0,
    transactionCount: 0,
    incomeByCategory: {},
    expenseByCategory: {},
    dailyIncome: {},
    dailyExpense: {},
  };
}
export function applyImpact(
  summary: MonthlySummary,
  transaction: FinanceTransaction,
  direction: 1 | -1,
) {
  if (transaction.status !== "active" || transaction.period !== summary.id)
    return summary;
  const s = structuredClone(summary);
  const amount = transaction.amount * direction;
  const income = transaction.type === "income";
  s[income ? "incomeTotal" : "expenseTotal"] += amount;
  s.transactionCount += direction;
  if (transaction.source === "tithe") s.titheTotal += amount;
  const category = income ? s.incomeByCategory : s.expenseByCategory;
  category[transaction.category] =
    (category[transaction.category] || 0) + amount;
  const days = income ? s.dailyIncome : s.dailyExpense;
  days[transaction.day] = (days[transaction.day] || 0) + amount;
  s.result = s.incomeTotal - s.expenseTotal;
  if (s.incomeTotal > MAX_MONTHLY_TOTAL || s.expenseTotal > MAX_MONTHLY_TOTAL)
    throw new Error(
      "El total mensual supera el límite seguro de esta versión.",
    );
  for (const value of [
    s.incomeTotal,
    s.expenseTotal,
    s.titheTotal,
    s.transactionCount,
    s.result,
    ...Object.values(category),
    ...Object.values(days),
  ])
    if (!Number.isSafeInteger(value))
      throw new Error("El total supera el límite seguro de esta versión.");
  if (
    s.incomeTotal < 0 ||
    s.expenseTotal < 0 ||
    s.titheTotal < 0 ||
    s.transactionCount < 0
  )
    throw new Error(
      "Se detectó una inconsistencia en los totales. Contacta al administrador.",
    );
  return s;
}
export function reviseSummaries(
  summaries: Record<string, MonthlySummary>,
  before: FinanceTransaction | null,
  after: FinanceTransaction,
) {
  const periods = [
    ...new Set(
      [before?.period, after.period].filter((id): id is string => !!id),
    ),
  ];
  return periods.map((id) => {
    let summary = { ...(summaries[id] || emptySummary(id)) };
    if (before) summary = applyImpact(summary, before, -1);
    return applyImpact(summary, after, 1);
  });
}
export function combineSummaries(summaries: MonthlySummary[]) {
  const result = emptySummary("total");
  for (const s of summaries) {
    result.incomeTotal += s.incomeTotal;
    result.expenseTotal += s.expenseTotal;
    result.titheTotal += s.titheTotal;
    result.transactionCount += s.transactionCount;
    for (const key of ["incomeByCategory", "expenseByCategory"] as const)
      for (const [category, amount] of Object.entries(s[key]))
        result[key][category] = (result[key][category] || 0) + amount;
  }
  result.result = result.incomeTotal - result.expenseTotal;
  return result;
}
export function variation(current: number, previous: number) {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}
export function evolution(
  summaries: MonthlySummary[],
  period: PeriodSelection,
) {
  if (period.view === "year")
    return Array.from({ length: 12 }, (_, i) => {
      const s = summaries.find((s) => s.id === periodId(period.year, i + 1));
      return {
        label: String(i + 1).padStart(2, "0"),
        income: s?.incomeTotal || 0,
        expense: s?.expenseTotal || 0,
        result: s?.result || 0,
      };
    });
  const s = summaries[0];
  return Array.from(
    { length: new Date(period.year, period.month, 0).getDate() },
    (_, i) => ({
      label: String(i + 1),
      income: s?.dailyIncome[String(i + 1)] || 0,
      expense: s?.dailyExpense[String(i + 1)] || 0,
      result:
        (s?.dailyIncome[String(i + 1)] || 0) -
        (s?.dailyExpense[String(i + 1)] || 0),
    }),
  );
}
