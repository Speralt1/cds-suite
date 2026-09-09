import type { Firestore } from "firebase/firestore";
import { saveTransaction } from "@/lib/finance/transactions";
import type { FinanceTransaction } from "@/lib/finance/types";

export type CashArea = "offerings" | "cafeteria";

export function cashCategory(area: CashArea) {
  return area === "offerings" ? "Ofrendas" : "Cafetería";
}

export function cashTransactionId(area: CashArea, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Fecha de caja inválida.");
  }
  return `cash_${area}_${date}`;
}

export async function saveDailyCash(
  db: Firestore,
  uid: string,
  area: CashArea,
  date: string,
  amount: number,
  note: string,
  existing?: FinanceTransaction,
) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Ingresa un monto de efectivo mayor a $0.");
  }

  const category = cashCategory(area);

  return saveTransaction(
    db,
    uid,
    cashTransactionId(area, date),
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
