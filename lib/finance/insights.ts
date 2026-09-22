import { WORSHIP_WEEKDAYS } from "./constants";
import { clpShort } from "./formatters";
import type { FinanceTransaction } from "./types";

// Date SumUp started separating Ofrendas y Cafetería into different
// merchants. Before this date every SumUp charge lands in the shared
// "SumUp histórico sin separar" category and never counts toward the
// "Falta efectivo" check for either area.
export const SPLIT = "2026-09-09";

export const CASH_AREAS = ["Ofrendas", "Cafetería"] as const;
export type CashAreaLabel = (typeof CASH_AREAS)[number];

export function isSumUpTransaction(id: string, createdBy: string) {
  return id.startsWith("sumup_") || createdBy === "system:sumup";
}

function dayKey(date: string) {
  return { period: date.slice(0, 7), day: String(Number(date.slice(8, 10))) };
}

function activeIncome(transactions: FinanceTransaction[], date: string) {
  const { period, day } = dayKey(date);
  return transactions.filter(
    (t) =>
      t.status === "active" &&
      t.type === "income" &&
      t.period === period &&
      t.day === day,
  );
}

function sumWhere(
  items: FinanceTransaction[],
  predicate: (t: FinanceTransaction) => boolean,
) {
  return items.reduce((sum, t) => (predicate(t) ? sum + t.amount : sum), 0);
}

export interface IncomeMethodRow {
  key: "cash" | "sumup" | "otherCard" | "transfer" | "other";
  label: string;
  amount: number;
  count: number;
  percent: number;
}

export interface IncomeByMethodResult {
  rows: IncomeMethodRow[];
  total: number;
  count: number;
  sumUpAmount: number;
  sumUpByCategory: Record<string, number>;
}

// Rows for "Ingresos por tipo de dinero" (§C1.2). Only active `income`
// transactions from `transactions` are considered; the caller decides the
// period. Percentages are 1-decimal shares of the computed total, which
// must equal the sum of the rows (F5).
export function incomeByMethod(
  transactions: FinanceTransaction[],
): IncomeByMethodResult {
  const active = transactions.filter(
    (t) => t.status === "active" && t.type === "income",
  );

  let cashAmount = 0,
    cashCount = 0;
  let sumUpAmount = 0,
    sumUpCount = 0;
  let otherCardAmount = 0,
    otherCardCount = 0;
  let transferAmount = 0,
    transferCount = 0;
  let otherAmount = 0,
    otherCount = 0;
  const sumUpByCategory: Record<string, number> = {};

  for (const t of active) {
    if (t.paymentMethod === "cash") {
      cashAmount += t.amount;
      cashCount++;
    } else if (t.paymentMethod === "card") {
      if (isSumUpTransaction(t.id, t.createdBy)) {
        sumUpAmount += t.amount;
        sumUpCount++;
        const key = t.category || "Sin categoría";
        sumUpByCategory[key] = (sumUpByCategory[key] || 0) + t.amount;
      } else {
        otherCardAmount += t.amount;
        otherCardCount++;
      }
    } else if (t.paymentMethod === "transfer") {
      transferAmount += t.amount;
      transferCount++;
    } else {
      otherAmount += t.amount;
      otherCount++;
    }
  }

  const total =
    cashAmount + sumUpAmount + otherCardAmount + transferAmount + otherAmount;
  const percent = (amount: number) =>
    total > 0 ? Math.round((amount / total) * 1000) / 10 : 0;

  const rows: IncomeMethodRow[] = [
    {
      key: "cash",
      label: "Efectivo",
      amount: cashAmount,
      count: cashCount,
      percent: percent(cashAmount),
    },
    {
      key: "sumup",
      label: "Tarjeta SumUp · bruto",
      amount: sumUpAmount,
      count: sumUpCount,
      percent: percent(sumUpAmount),
    },
  ];
  if (otherCardAmount > 0)
    rows.push({
      key: "otherCard",
      label: "Tarjeta · otra",
      amount: otherCardAmount,
      count: otherCardCount,
      percent: percent(otherCardAmount),
    });
  rows.push({
    key: "transfer",
    label: "Transferencia",
    amount: transferAmount,
    count: transferCount,
    percent: percent(transferAmount),
  });
  if (otherAmount > 0)
    rows.push({
      key: "other",
      label: "Otro",
      amount: otherAmount,
      count: otherCount,
      percent: percent(otherAmount),
    });

  return {
    rows,
    total,
    count: active.length,
    sumUpAmount,
    sumUpByCategory,
  };
}

export interface DayStatus {
  date: string;
  weekday: number;
  isWorshipDay: boolean;
  isToday: boolean;
  isFuture: boolean;
  missingCashAreas: CashAreaLabel[];
  noRecords: boolean;
  totalIncome: number;
  statusLabel: string;
}

// Evaluates every state for a single day D (§D). The caller (calendar cell)
// shows only `statusLabel` (highest priority); the day panel shows the
// underlying figures.
export function dayStatus(
  date: string,
  transactions: FinanceTransaction[],
  todayStr: string,
  worshipWeekdays: readonly number[] = WORSHIP_WEEKDAYS,
): DayStatus {
  const d = new Date(`${date}T12:00:00.000Z`);
  const weekday = d.getUTCDay();
  const isWorshipDay = worshipWeekdays.includes(weekday);
  const isToday = date === todayStr;
  const isFuture = date > todayStr;

  const dayIncome = activeIncome(transactions, date);

  const missingCashAreas: CashAreaLabel[] = [];
  if (date >= SPLIT && date <= todayStr) {
    for (const area of CASH_AREAS) {
      const sumUp = sumWhere(
        dayIncome,
        (t) =>
          t.category === area &&
          t.paymentMethod === "card" &&
          isSumUpTransaction(t.id, t.createdBy),
      );
      const cash = sumWhere(
        dayIncome,
        (t) => t.category === area && t.paymentMethod === "cash",
      );
      if (sumUp > 0 && cash === 0) missingCashAreas.push(area);
    }
  }

  const hasAnyActiveTransaction = transactions.some((t) => {
    const { period, day } = dayKey(date);
    return t.status === "active" && t.period === period && t.day === day;
  });
  const noRecords =
    !isFuture && isWorshipDay && date < todayStr && !hasAnyActiveTransaction;

  const totalIncome = dayIncome.reduce((sum, t) => sum + t.amount, 0);

  let statusLabel = "";
  if (missingCashAreas.length === 2) statusLabel = "Falta efectivo · 2 áreas";
  else if (missingCashAreas.length === 1)
    statusLabel = `Falta efectivo · ${missingCashAreas[0]}`;
  else if (noRecords) statusLabel = "Sin registros";
  else if (!isFuture && totalIncome > 0) statusLabel = clpShort(totalIncome);

  return {
    date,
    weekday,
    isWorshipDay,
    isToday,
    isFuture,
    missingCashAreas,
    noRecords,
    totalIncome,
    statusLabel,
  };
}

export interface MonthCalendar {
  days: DayStatus[];
  weeks: (DayStatus | null)[][];
}

// Builds the days of `month`/`year` with their status, plus a Monday-first
// week grid (nulls padding the leading/trailing blanks) for the calendar
// table (§D "Interacción").
export function buildMonthCalendar(
  transactions: FinanceTransaction[],
  year: number,
  month: number,
  todayStr: string,
  worshipWeekdays: readonly number[] = WORSHIP_WEEKDAYS,
): MonthCalendar {
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: DayStatus[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    days.push(dayStatus(date, transactions, todayStr, worshipWeekdays));
  }

  const firstWeekday = days[0]?.weekday ?? 1;
  const leadingBlanks = (firstWeekday + 6) % 7; // Monday-first offset
  const weeks: (DayStatus | null)[][] = [];
  let week: (DayStatus | null)[] = new Array(leadingBlanks).fill(null);
  for (const d of days) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return { days, weeks };
}

export interface ReviewItem {
  date: string;
  kind: "missing-cash" | "no-records";
  area?: CashAreaLabel;
  label: string;
}

// "Días por revisar" (§C1.4) and report alerts A1/A2 (§D), sorted
// chronologically.
export function reviewDays(
  transactions: FinanceTransaction[],
  year: number,
  month: number,
  todayStr: string,
  worshipWeekdays: readonly number[] = WORSHIP_WEEKDAYS,
): ReviewItem[] {
  const { days } = buildMonthCalendar(
    transactions,
    year,
    month,
    todayStr,
    worshipWeekdays,
  );
  const items: ReviewItem[] = [];
  for (const d of days) {
    for (const area of d.missingCashAreas)
      items.push({
        date: d.date,
        kind: "missing-cash",
        area,
        label: `Falta efectivo · ${area}`,
      });
    if (d.noRecords)
      items.push({ date: d.date, kind: "no-records", label: "Sin registros" });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// Default selected day for the calendar/panel (§D "Selección por defecto"):
// the first review day, else today (if in month), else the last day with
// income.
export function defaultSelectedDay(
  calendar: MonthCalendar,
  review: ReviewItem[],
  todayStr: string,
): string | undefined {
  if (review.length) return review[0].date;
  const todayInMonth = calendar.days.find((d) => d.date === todayStr);
  if (todayInMonth) return todayInMonth.date;
  const withIncome = [...calendar.days]
    .reverse()
    .find((d) => d.totalIncome > 0);
  return withIncome?.date;
}
