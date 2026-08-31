import {
  combineSummaries,
  emptySummary,
  applyImpact,
  evolution,
} from "./calculations";
import { clp, dateLabel, periodId, periodLabel } from "./formatters";
import { MAX_PERIOD_RECORDS, PAYMENT_METHODS, MONTHS } from "./constants";
import type {
  FinanceTransaction,
  MonthlySummary,
  PeriodSelection,
} from "./types";
export interface ReportRow {
  date: string;
  type: string;
  category: string;
  description: string;
  method: string;
  amount: number;
  status: string;
}
export interface FinanceReport {
  period: PeriodSelection;
  label: string;
  filename: string;
  generatedAt: Date;
  generatedBy: string;
  summary: MonthlySummary;
  monthly: {
    label: string;
    income: number;
    expense: number;
    result: number;
    tithe: number;
    count: number;
  }[];
  evolution: {
    label: string;
    income: number;
    expense: number;
    result: number;
  }[];
  rows: ReportRow[];
  voided: ReportRow[];
}
export function buildReport(
  period: PeriodSelection,
  summaries: MonthlySummary[],
  transactions: FinanceTransaction[],
  generatedBy: string,
  generatedAt = new Date(),
): FinanceReport {
  if (transactions.length > MAX_PERIOD_RECORDS)
    throw new Error(
      "El período supera 10.000 movimientos. Esta versión no genera informes parciales; selecciona un mes con menos registros.",
    );
  const ids =
    period.view === "year"
      ? Array.from({ length: 12 }, (_, i) => periodId(period.year, i + 1))
      : [periodId(period.year, period.month)];
  const selected = transactions.filter((t) => ids.includes(t.period));
  const monthly = ids.map((id) =>
    selected
      .filter((t) => t.period === id)
      .reduce((s, t) => applyImpact(s, t, 1), emptySummary(id)),
  );
  const summary = combineSummaries(monthly);
  const expected = combineSummaries(
    summaries.filter((s) => ids.includes(s.id)),
  );
  for (const key of [
    "incomeTotal",
    "expenseTotal",
    "result",
    "titheTotal",
    "transactionCount",
  ] as const)
    if (summary[key] !== expected[key])
      throw new Error(
        "Los datos aún se están sincronizando. Espera unos segundos antes de generar el reporte.",
      );
  // Explicit allowlist: never copies profile IDs, personal/private notes or audit IDs.
  const safeRow = (t: FinanceTransaction): ReportRow => ({
    date: dateLabel(t.date),
    type: t.type === "income" ? "Entrada" : "Salida",
    category: t.category,
    description: t.source === "tithe" ? "Diezmo" : t.description,
    method: PAYMENT_METHODS[t.paymentMethod],
    amount: t.amount,
    status: t.status === "active" ? "Activo" : "Anulado",
  });
  return {
    period,
    label: periodLabel(period),
    filename: `CDS_Finanzas_${period.view === "year" ? period.year : periodId(period.year, period.month)}.pdf`,
    generatedAt,
    generatedBy: generatedBy.slice(0, 120),
    summary,
    monthly: monthly.map((s) => ({
      label: MONTHS[Number(s.id.slice(5)) - 1],
      income: s.incomeTotal,
      expense: s.expenseTotal,
      result: s.result,
      tithe: s.titheTotal,
      count: s.transactionCount,
    })),
    evolution: evolution(monthly, period),
    rows: selected
      .filter((t) => t.status === "active")
      .sort(
        (a, b) =>
          b.date.toMillis() - a.date.toMillis() || a.id.localeCompare(b.id),
      )
      .map(safeRow),
    voided: selected.filter((t) => t.status === "voided").map(safeRow),
  };
}
export function reportCategoryRows(values: Record<string, number>) {
  return Object.entries(values)
    .filter(([, value]) => value > 0)
    .map(([label, value]) => [label, clp(value)]);
}
