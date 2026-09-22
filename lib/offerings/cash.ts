import type { Firestore } from "firebase/firestore";
import { saveTransaction } from "@/lib/finance/transactions";
import type { FinanceTransaction } from "@/lib/finance/types";

export type CashArea = "offerings" | "cafeteria";

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
