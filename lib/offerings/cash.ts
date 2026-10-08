import type { Firestore } from "firebase/firestore";
import { saveTransaction } from "@/lib/finance/transactions";
import type { FinanceTransaction } from "@/lib/finance/types";

export type CashArea = "offerings" | "cafeteria";

// Cash can be entered days after a service. Suggest the most recent service
// date without relying on the browser's local timezone.
export function previousCashServiceDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const selected = new Date(Date.UTC(year, month - 1, day));
  if (selected.toISOString().slice(0, 10) !== date) return null;
  const weekday = selected.getUTCDay();
  if (weekday === 0 || weekday === 3) return null;
  const daysSinceSunday = weekday;
  const daysSinceWednesday = (weekday - 3 + 7) % 7;
  selected.setUTCDate(selected.getUTCDate() - Math.min(daysSinceSunday, daysSinceWednesday));
  return selected.toISOString().slice(0, 10);
}

// The range the "Caja del día" date input accepts (min = SumUp split day).
export const CASH_DATE_MIN = "2026-09-09";
export const CASH_DATE_MAX = "2099-12-31";

// A real calendar day written as YYYY-MM-DD (the only shape the cash ids
// accept). Date inputs emit "" while cleared and may emit 5-digit years.
export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  // setUTCFullYear, not Date.UTC: Date.UTC maps years 0-99 to 1900-1999, and
  // date inputs emit "0002-…", "0020-…" while the year is being typed.
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

// Why a typed cash date can't be used yet, or null when it is a real
// YYYY-MM-DD inside the accepted range. A cleared <input type="date"> emits
// "", so the modal must never feed this value to the cash helpers below.
export function cashDateIssue(date: string): string | null {
  if (!date) return "Ingresa la fecha correspondiente para continuar.";
  if (!isCalendarDate(date)) {
    return "La fecha no es válida. Revisa día, mes y año.";
  }
  if (date < CASH_DATE_MIN) {
    return "Elige una fecha desde el 9 de septiembre de 2026.";
  }
  if (date > CASH_DATE_MAX) {
    return "Elige una fecha hasta el 31 de diciembre de 2099.";
  }
  return null;
}

export function cashCategory(area: CashArea) {
  return area === "offerings" ? "Ofrendas" : "Cafetería";
}

// Base, original id for a day's cash record. Kept stable for backwards
// compatibility: every record created before the F1 fix still uses this id.
export function cashTransactionId(area: CashArea, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Fecha de caja inválida.");
  }
  return `cash_${area}_${date}`;
}

function cashRevisionId(area: CashArea, date: string, revision: number) {
  return `${cashTransactionId(area, date)}_r${revision}`;
}

// F1 fix: Firestore rules forbid updating a voided document, and
// saveTransaction rejects creating a doc whose id already exists. So once
// `cash_{area}_{date}` is voided, that day would be permanently blocked for
// the area unless a fresh, never-used id is picked for the re-registration.
// `_r{n}` revision ids (n = 2, 3, ...) provide that escape hatch while the
// original id keeps meaning "the first record for this area/date".
export function cashDailyIdCandidates(
  area: CashArea,
  date: string,
  maxRevisions = 50,
) {
  const ids = [cashTransactionId(area, date)];
  for (let n = 2; n <= maxRevisions; n++) ids.push(cashRevisionId(area, date, n));
  return ids;
}

// The "Caja del día" reading must resolve to whichever record for this
// area/date is currently active, regardless of whether it's the original id
// or a later revision created after a void.
export function findActiveDailyCash(
  transactions: Pick<FinanceTransaction, "id" | "status">[],
  area: CashArea,
  date: string,
): FinanceTransaction | undefined {
  const ids = new Set(cashDailyIdCandidates(area, date));
  return transactions.find(
    (item) => ids.has(item.id) && item.status === "active",
  ) as FinanceTransaction | undefined;
}

// SumUp CASH Intake V1: cash already recorded in the SumUp app for this
// area/date (imported as `sumup_*` with paymentMethod "cash"). The manual
// "Caja del día" record is a separate, legitimate fallback, so this is only
// used to warn before registering the same cash twice — never to block or
// merge (two real amounts can coincide).
export function sumUpCashForDay(
  transactions: Pick<
    FinanceTransaction,
    "id" | "status" | "type" | "category" | "paymentMethod" | "period" | "day" | "amount" | "createdBy"
  >[],
  area: CashArea,
  date: string,
): { amount: number; count: number } {
  const category = cashCategory(area);
  const period = date.slice(0, 7);
  const day = String(Number(date.slice(8, 10)));
  let amount = 0;
  let count = 0;
  for (const item of transactions) {
    if (
      item.status === "active" &&
      item.type === "income" &&
      item.paymentMethod === "cash" &&
      item.category === category &&
      item.period === period &&
      item.day === day &&
      (item.id.startsWith("sumup_") || item.createdBy === "system:sumup")
    ) {
      amount += item.amount;
      count++;
    }
  }
  return { amount, count };
}

// The id to write to when there is no active record yet for this area/date:
// the base id if it has never been used, otherwise the next free revision id
// after the most recent void.
export function nextCashWriteId(
  transactions: Pick<FinanceTransaction, "id" | "status">[],
  area: CashArea,
  date: string,
): string {
  const base = cashTransactionId(area, date);
  const usedIds = new Set(transactions.map((item) => item.id));
  if (!usedIds.has(base)) return base;

  let revision = 2;
  while (usedIds.has(cashRevisionId(area, date, revision))) revision++;
  return cashRevisionId(area, date, revision);
}

export async function saveDailyCash(
  db: Firestore,
  uid: string,
  area: CashArea,
  date: string,
  amount: number,
  note: string,
  existing: FinanceTransaction | undefined,
  allTransactionsForDay: Pick<FinanceTransaction, "id" | "status">[] = existing
    ? [existing]
    : [],
) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Ingresa un monto de efectivo mayor a $0.");
  }

  const category = cashCategory(area);
  const id = existing
    ? existing.id
    : nextCashWriteId(allTransactionsForDay, area, date);

  return saveTransaction(
    db,
    uid,
    id,
    {
      type: "income",
      amount,
      date,
      category,
      paymentMethod: "cash",
      description:
        area === "offerings"
          ? "Ofrendas en efectivo"
          : "Cafetería en efectivo",
      note: note.trim(),
    },
    {
      existing,
      allowedCategories: [category],
    },
  );
}
