// Consultas del saldo bancario estimado (doc 30), sin React: las usa
// useBankBalance y los tests contra el emulador.
import { limit, orderBy, where, type QueryConstraint } from "firebase/firestore";
import { parseDate } from "./formatters";
import type { Ymd } from "./bank-model";

export const BANK_LEDGER_LIMIT = 5000;
export const BANK_TREASURY_LIMIT = 1000;

/**
 * Consultas acotadas desde la fecha de corte (exportadas para probarlas contra
 * el emulador). La 1 y la 2 usan el índice financeTransactions
 * (type, paymentMethod, date); tesorería usa el índice simple de `date`.
 */
export function bankBalanceQueries(openingDate: Ymd) {
  // Mediodía UTC del día de corte: todo instante de un día local posterior es mayor.
  // El filtro exacto por fecha local (period + day) lo hace computeBankBalance.
  const from = parseDate(openingDate);
  return {
    cashTransfer: [
      where("type", "in", ["income", "expense"]),
      where("paymentMethod", "in", ["cash", "transfer", "other"]),
      where("date", ">=", from),
      orderBy("date"),
      limit(BANK_LEDGER_LIMIT),
    ] as QueryConstraint[],
    cardExpense: [
      where("type", "==", "expense"),
      where("paymentMethod", "==", "card"),
      where("date", ">=", from),
      orderBy("date"),
      limit(BANK_LEDGER_LIMIT),
    ] as QueryConstraint[],
    treasury: [where("date", ">", openingDate), orderBy("date"), limit(BANK_TREASURY_LIMIT)] as QueryConstraint[],
  };
}

