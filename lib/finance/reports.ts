import {
  combineSummaries,
  emptySummary,
  applyImpact,
  evolution,
  variation,
} from "./calculations";
import { clp, dateLabel, periodId, periodLabel, previousPeriod } from "./formatters";
import { MAX_PERIOD_RECORDS, PAYMENT_METHODS, MONTHS } from "./constants";
import {
  SPLIT,
  buildMonthCalendar,
  incomeByMethod,
  isSumUpTransaction,
  reviewDays,
  type IncomeByMethodResult,
} from "./insights";
import type {
  FinanceTransaction,
  MonthlySummary,
  PeriodSelection,
} from "./types";

const SPLIT_MONTH = SPLIT.slice(0, 7);
const LEGACY_CATEGORY = "SumUp histórico sin separar";
const AREA_CATEGORIES = ["Ofrendas", "Cafetería"] as const;

export interface ReportRow {
  date: string;
  type: string;
  category: string;
  description: string;
  method: string;
  amount: number;
  status: string;
}

export interface SourceRow {
  category: string;
  sumUp: number;
  cash: number;
  transfer: number;
  other: number;
  total: number;
  previousTotal: number | null;
  notComparable: boolean;
}

export interface WorshipDayRow {
  date: string;
  label: string;
  isWorshipDay: boolean;
  offeringsSumUp: number;
  offeringsCash: number;
  cafeSumUp: number;
  cafeCash: number;
  tithe: number;
  total: number;
  statusLabel: string;
}

export interface TopCategoryRow {
  category: string;
  amount: number;
  percent: number;
}

export interface AlertItem {
  code: "A1" | "A2" | "A3" | "A4" | "A5";
  tone: "revisar" | "info";
  text: string;
  pdfText: string;
}

export interface ReportComparison {
  available: boolean;
  previousIncomeTotal: number;
  variationPercent: number | null;
  monthsWithoutExpenses?: string[];
}

export interface MonthlyMethodRow {
  label: string;
  income: number;
  cash: number;
  sumUp: number;
  transfer: number;
  expense: number;
  alertCount: number;
}

// La comisión SumUp no se conoce hasta que se conectan los payouts del
// proveedor: nunca se inventa un monto ni un "$0". "pending" solo se emite
// cuando el período tiene SumUp activo; "none" cuando no hay SumUp en el
// período. "estimated" y "recorded" quedan preparados para cuando Atlas
// conecte una tarifa real o los payouts.
export type SumUpFee =
  | { status: "none" }
  | { status: "pending" }
  | { status: "estimated"; ratePercent: number; estimatedAmount: number }
  | { status: "recorded"; amount: number; byAccount: { offerings: number; cafeteria: number } };

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
  byMethod: IncomeByMethodResult;
  bySource: SourceRow[];
  worshipDays: WorshipDayRow[];
  topIncome: TopCategoryRow[];
  topExpense: TopCategoryRow[];
  alerts: { revisar: AlertItem[]; info: AlertItem[] };
  narrative: string;
  comparison: ReportComparison;
  monthlyByMethod: MonthlyMethodRow[];
  sumUpFee: SumUpFee;
}

function shortDate(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${Number(day)} ${MONTHS[month - 1].slice(0, 3).toLowerCase()}`;
}

function topCategories(byCategory: Record<string, number>): TopCategoryRow[] {
  const total = Object.values(byCategory).reduce((s, v) => s + v, 0);
  return Object.entries(byCategory)
    .filter(([, amount]) => amount > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([category, amount]) => ({
      category,
      amount,
      percent: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
    }));
}

function sourceRowFor(
  category: string,
  active: FinanceTransaction[],
  previousActiveIncome: FinanceTransaction[] | undefined,
  previousPeriodNotComparable: boolean,
  hasPreviousPeriodData: boolean,
): SourceRow {
  const items = active.filter((t) => t.category === category);
  const sumUp = items
    .filter((t) => t.paymentMethod === "card" && isSumUpTransaction(t.id, t.createdBy))
    .reduce((s, t) => s + t.amount, 0);
  const cash = items
    .filter((t) => t.paymentMethod === "cash")
    .reduce((s, t) => s + t.amount, 0);
  const transfer = items
    .filter((t) => t.paymentMethod === "transfer")
    .reduce((s, t) => s + t.amount, 0);
  const other = items
    .filter(
      (t) =>
        t.paymentMethod === "other" ||
        (t.paymentMethod === "card" && !isSumUpTransaction(t.id, t.createdBy)),
    )
    .reduce((s, t) => s + t.amount, 0);
  const total = sumUp + cash + transfer + other;

  const isAreaCategory = (AREA_CATEGORIES as readonly string[]).includes(category);
  const notComparable = isAreaCategory && previousPeriodNotComparable;
  const previousTotal =
    notComparable || !hasPreviousPeriodData
      ? null
      : (previousActiveIncome || [])
          .filter((t) => t.category === category)
          .reduce((s, t) => s + t.amount, 0);

  return { category, sumUp, cash, transfer, other, total, previousTotal, notComparable };
}

function buildWorshipDays(
  transactions: FinanceTransaction[],
  year: number,
  month: number,
  todayStr: string,
): WorshipDayRow[] {
  const calendar = buildMonthCalendar(transactions, year, month, todayStr);
  return calendar.days
    .map((d) => {
      const period = d.date.slice(0, 7);
      const day = String(Number(d.date.slice(8, 10)));
      const dayTx = transactions.filter(
        (t) => t.status === "active" && t.period === period && t.day === day,
      );
      const sumOf = (category: string, method: "cash" | "card", sumUpOnly = false) =>
        dayTx
          .filter(
            (t) =>
              t.type === "income" &&
              t.category === category &&
              t.paymentMethod === method &&
              (!sumUpOnly || isSumUpTransaction(t.id, t.createdBy)),
          )
          .reduce((s, t) => s + t.amount, 0);
      const tithe = dayTx
        .filter((t) => t.type === "income" && t.source === "tithe")
        .reduce((s, t) => s + t.amount, 0);
      const offeringsSumUp = sumOf("Ofrendas", "card", true);
      const offeringsCash = sumOf("Ofrendas", "cash");
      const cafeSumUp = sumOf("Cafetería", "card", true);
      const cafeCash = sumOf("Cafetería", "cash");
      const areaIncome = offeringsSumUp + offeringsCash + cafeSumUp + cafeCash;
      const row: WorshipDayRow = {
        date: d.date,
        label: shortDate(d.date),
        isWorshipDay: d.isWorshipDay,
        offeringsSumUp,
        offeringsCash,
        cafeSumUp,
        cafeCash,
        tithe,
        total: d.totalIncome,
        statusLabel: d.missingCashAreas.length
          ? d.missingCashAreas.length === 2
            ? "Falta efectivo · 2 áreas"
            : `Falta efectivo · ${d.missingCashAreas[0]}`
          : d.noRecords
            ? "Sin registros"
            : d.date < SPLIT
              ? "—"
              : "Con ingresos",
      };
      return { row, isWorshipDay: d.isWorshipDay, date: d.date, areaIncome };
    })
    .filter((d) => (d.isWorshipDay && d.date <= todayStr) || d.areaIncome > 0)
    .map((d) => d.row);
}

function ddmm(date: string) {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}

function legacyDateRange(legacyIncome: FinanceTransaction[]): string {
  if (!legacyIncome.length) return "";
  const dates = legacyIncome
    .map((t) => `${t.period}-${t.day.padStart(2, "0")}`)
    .sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? ddmm(first) : `${ddmm(first)}–${ddmm(last)}`;
}

function buildAlerts(
  transactions: FinanceTransaction[],
  year: number,
  month: number,
  todayStr: string,
  incomeTotal: number,
  expenseTotal: number,
  sumUpAmount: number,
  legacyAmount: number,
  legacyRange: string,
): { revisar: AlertItem[]; info: AlertItem[] } {
  const review = reviewDays(transactions, year, month, todayStr);
  const revisar: AlertItem[] = review.map((item) => {
    if (item.kind === "missing-cash") {
      const period = item.date.slice(0, 7);
      const day = String(Number(item.date.slice(8, 10)));
      const sumUpAmountForDay = transactions
        .filter(
          (t) =>
            t.status === "active" &&
            t.type === "income" &&
            t.period === period &&
            t.day === day &&
            t.category === item.area &&
            t.paymentMethod === "card" &&
            isSumUpTransaction(t.id, t.createdBy),
        )
        .reduce((s, t) => s + t.amount, 0);
      const text = `Falta efectivo · ${item.area} — ${shortDate(item.date)}: SumUp ${clp(sumUpAmountForDay)} en bruto, sin efectivo registrado.`;
      return { code: "A1", tone: "revisar", text, pdfText: `[Revisar] ${text}` };
    }
    const text = `Sin registros — ${shortDate(item.date)} (día de culto).`;
    return { code: "A2", tone: "revisar", text, pdfText: `[Revisar] ${text}` };
  });

  if (expenseTotal === 0 && incomeTotal > 0) {
    const text = `No se registraron gastos en el mes — verificar si faltan egresos.`;
    revisar.push({ code: "A3", tone: "revisar", text, pdfText: `[Revisar] ${text}` });
  }

  const info: AlertItem[] = [];
  if (sumUpAmount > 0) {
    const text =
      "Los montos SumUp están en bruto: la comisión aún no está disponible, por lo que lo depositado será menor.";
    info.push({ code: "A4", tone: "info", text, pdfText: `[Info] ${text}` });
  }
  if (legacyAmount > 0) {
    const text = `SumUp histórico sin separar (${legacyRange}): ${clp(legacyAmount)}. No se atribuye a Ofrendas ni Cafetería.`;
    info.push({ code: "A5", tone: "info", text, pdfText: `[Info] ${text}` });
  }

  return { revisar, info };
}

function joinList(items: string[]): string {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} y ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function buildNarrative(
  periodLbl: string,
  incomeTotal: number,
  transactionCount: number,
  incomeByCategory: Record<string, number>,
  byMethod: IncomeByMethodResult,
  expenseTotal: number,
  comparison: ReportComparison,
  revisarCount: number,
  previousLabel: string,
): string {
  const sentences: string[] = [];

  if (incomeTotal > 0) {
    sentences.push(
      `En ${periodLbl.toLowerCase()} ingresaron ${clp(incomeTotal)} en ${transactionCount} movimientos.`,
    );
  }

  const sources = Object.entries(incomeByCategory)
    .filter(([, amount]) => amount > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([category, amount]) => ({
      category,
      amount,
      percent:
        incomeTotal > 0 ? Math.round((amount / incomeTotal) * 1000) / 10 : 0,
    }));
  if (sources.length) {
    const fmt = (s: (typeof sources)[number]) =>
      `${s.category} (${clp(s.amount)} · ${s.percent.toLocaleString("es-CL", { maximumFractionDigits: 1 })} %)`;
    let sourceSentence = `La mayor fuente fue ${fmt(sources[0])}`;
    if (sources.length > 1) {
      const rest = sources.slice(1).map(fmt);
      sourceSentence += `, seguida de ${joinList(rest)}`;
    }
    sentences.push(`${sourceSentence}.`);
  }

  const methodParts: string[] = [];
  const cashRow = byMethod.rows.find((r) => r.key === "cash");
  const sumUpRow = byMethod.rows.find((r) => r.key === "sumup");
  const transferRow = byMethod.rows.find((r) => r.key === "transfer");
  if (sumUpRow && sumUpRow.amount > 0)
    methodParts.push(`tarjeta SumUp ${clp(sumUpRow.amount)} (bruto)`);
  if (cashRow && cashRow.amount > 0) methodParts.push(`efectivo ${clp(cashRow.amount)}`);
  if (transferRow && transferRow.amount > 0)
    methodParts.push(`transferencia ${clp(transferRow.amount)}`);
  if (methodParts.length)
    sentences.push(`Por tipo de dinero: ${joinList(methodParts)}.`);

  if (comparison.available) {
    if (comparison.variationPercent === null) {
      sentences.push("No hay datos del mes anterior para comparar.");
    } else {
      const direction = comparison.variationPercent >= 0 ? "subieron" : "bajaron";
      sentences.push(
        `Frente a ${previousLabel}, los ingresos ${direction} un ${Math.abs(comparison.variationPercent).toLocaleString("es-CL", { maximumFractionDigits: 1 })} %.`,
      );
    }
  } else {
    sentences.push("No hay datos del mes anterior para comparar.");
  }

  if (expenseTotal === 0 && incomeTotal > 0) sentences.push("No se registraron gastos.");

  if (revisarCount > 0) sentences.push(`Hay ${revisarCount} alertas para revisar.`);

  return sentences.join(" ");
}

export function buildReport(
  period: PeriodSelection,
  summaries: MonthlySummary[],
  transactions: FinanceTransaction[],
  generatedBy: string,
  generatedAt = new Date(),
  options: {
    previousTransactions?: FinanceTransaction[];
    previousSummaries?: MonthlySummary[];
    today?: string;
    // Slice 3a — comisión real de SumUp para el período (suma de
    // sumupDailySettlement por cuenta), cuando el caller ya la cargó.
    // Ausente => sumUpFee sigue en 'pending' (nunca inventa un monto).
    sumUpSettlement?: { total: number; byAccount: { offerings: number; cafeteria: number } };
  } = {},
): FinanceReport {
  if (transactions.length >= MAX_PERIOD_RECORDS)
    throw new Error(
      "El período alcanzó el límite de 10.000 movimientos. Esta versión no genera informes potencialmente parciales; selecciona un período con menos registros.",
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

  const activeIncome = selected.filter(
    (t) => t.status === "active" && t.type === "income",
  );
  const label = periodLabel(period);
  const todayStr = options.today || new Date().toISOString().slice(0, 10);
  const byMethod = incomeByMethod(selected);
  const legacyIncome = activeIncome.filter((t) => t.category === LEGACY_CATEGORY);
  const legacyAmount = legacyIncome.reduce((s, t) => s + t.amount, 0);
  const legacyRange = legacyDateRange(legacyIncome);

  const previousActiveIncome = (options.previousTransactions || []).filter(
    (t) => t.status === "active" && t.type === "income",
  );
  const previousIncomeTotal = options.previousSummaries
    ? combineSummaries(options.previousSummaries).incomeTotal
    : previousActiveIncome.reduce((s, t) => s + t.amount, 0);
  const hasPreviousData =
    period.view === "month" &&
    ((options.previousSummaries?.length || 0) > 0 ||
      previousActiveIncome.length > 0);
  const comparison: ReportComparison = {
    available: period.view === "month",
    previousIncomeTotal,
    variationPercent: hasPreviousData
      ? variation(summary.incomeTotal, previousIncomeTotal)
      : null,
  };

  // M1 fix: "no comparable" depends on the PREVIOUS month (SumUp only started
  // separating Ofrendas/Cafetería on 09/09/2026; the 1st-8th of that same
  // month still lack separation, hence the "<=").
  const previousPeriodSelection = previousPeriod(period);
  const previousPeriodNotComparable =
    period.view === "month" &&
    periodId(previousPeriodSelection.year, previousPeriodSelection.month) <=
      SPLIT_MONTH;
  const bySource =
    period.view === "month"
      ? Object.keys(summary.incomeByCategory)
          .filter((category) => summary.incomeByCategory[category] > 0)
          .sort((a, b) => summary.incomeByCategory[b] - summary.incomeByCategory[a])
          .map((category) =>
            sourceRowFor(
              category,
              activeIncome,
              previousActiveIncome,
              previousPeriodNotComparable,
              hasPreviousData,
            ),
          )
      : [];

  const worshipDays =
    period.view === "month"
      ? buildWorshipDays(selected, period.year, period.month, todayStr)
      : [];

  const alerts =
    period.view === "month"
      ? buildAlerts(
          selected,
          period.year,
          period.month,
          todayStr,
          summary.incomeTotal,
          summary.expenseTotal,
          byMethod.sumUpAmount,
          legacyAmount,
          legacyRange,
        )
      : (() => {
          const monthsWithoutExpenses = monthly
            .filter((s) => s.expenseTotal === 0 && s.incomeTotal > 0)
            .map((s) => MONTHS[Number(s.id.slice(5)) - 1]);
          const revisar: AlertItem[] = [];
          if (monthsWithoutExpenses.length) {
            const text = `Meses sin gastos registrados: ${monthsWithoutExpenses.join(", ")}.`;
            revisar.push({ code: "A3", tone: "revisar", text, pdfText: `[Revisar] ${text}` });
          }
          const info: AlertItem[] = [];
          if (byMethod.sumUpAmount > 0) {
            const text =
              "Los montos SumUp están en bruto: la comisión aún no está disponible, por lo que lo depositado será menor.";
            info.push({ code: "A4", tone: "info", text, pdfText: `[Info] ${text}` });
          }
          if (legacyAmount > 0) {
            const text = `SumUp histórico sin separar (${legacyRange}): ${clp(legacyAmount)}. No se atribuye a Ofrendas ni Cafetería.`;
            info.push({ code: "A5", tone: "info", text, pdfText: `[Info] ${text}` });
          }
          return { revisar, info };
        })();

  const narrative =
    period.view === "month"
      ? buildNarrative(
          label,
          summary.incomeTotal,
          summary.transactionCount,
          summary.incomeByCategory,
          byMethod,
          summary.expenseTotal,
          comparison,
          alerts.revisar.length,
          periodLabel(previousPeriod(period)).toLowerCase(),
        )
      : "";

  const monthlyByMethod: MonthlyMethodRow[] =
    period.view === "year"
      ? monthly.map((s, i) => {
          const monthTx = selected.filter((t) => t.period === s.id);
          const method = incomeByMethod(monthTx);
          const monthReview = reviewDays(monthTx, period.year, i + 1, todayStr);
          const alertCount =
            monthReview.length +
            (s.expenseTotal === 0 && s.incomeTotal > 0 ? 1 : 0);
          return {
            label: MONTHS[i],
            income: s.incomeTotal,
            cash: method.rows.find((r) => r.key === "cash")?.amount || 0,
            sumUp: method.rows.find((r) => r.key === "sumup")?.amount || 0,
            transfer: method.rows.find((r) => r.key === "transfer")?.amount || 0,
            expense: s.expenseTotal,
            alertCount,
          };
        })
      : [];

  return {
    period,
    label,
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
    byMethod,
    bySource,
    worshipDays,
    topIncome: topCategories(summary.incomeByCategory),
    topExpense: topCategories(summary.expenseByCategory),
    alerts,
    narrative,
    comparison,
    monthlyByMethod,
    sumUpFee:
      byMethod.sumUpAmount <= 0
        ? { status: "none" }
        : options.sumUpSettlement && options.sumUpSettlement.total > 0
          ? { status: "recorded", amount: options.sumUpSettlement.total, byAccount: options.sumUpSettlement.byAccount }
          : { status: "pending" },
  };
}
export function reportCategoryRows(values: Record<string, number>) {
  return Object.entries(values)
    .filter(([, value]) => value > 0)
    .map(([label, value]) => [label, clp(value)]);
}
