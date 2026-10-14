"use client";
// Carga de datos del saldo bancario estimado (doc 30). Solo consulta desde la
// fecha de corte y solo los métodos que mueven banco o caja:
//   1) ingresos y gastos en efectivo / transferencia / otro
//   2) gastos con tarjeta
// Las ventas con tarjeta (SumUp) NO se leen: llegan al banco vía abonos.
// Índice compuesto requerido (firestore.indexes.json):
//   financeTransactions (type ASC, paymentMethod ASC, date ASC)
// Cada consulta está acotada; si se alcanza el tope se informa "límite alcanzado".
import { useMemo } from "react";
import { limit, orderBy, type QueryConstraint } from "firebase/firestore";
import { localToday } from "../shared/dates";
import { useCollection, useDocument } from "./hooks";
import { BANK_LEDGER_LIMIT, BANK_TREASURY_LIMIT, bankBalanceQueries } from "./bank-queries";
import { computeBankBalance, PAYOUTS_NOT_CONNECTED, type BankBalanceResult, type SumupPayoutsInput } from "./bank-balance";
import { DEFAULT_BANK_ACCOUNT_ID, isYmd, type Ymd } from "./bank-model";
import type {
  BankAccountDoc,
  BankAccountHistoryDoc,
  BankReconciliationDoc,
  TreasuryTransferDoc,
} from "./bank-accounts";
import type { FinanceTransaction } from "./types";

export { BANK_LEDGER_LIMIT, BANK_TREASURY_LIMIT, bankBalanceQueries };

export const BANK_LIST_LIMIT = 30;

/** Fecha local de hoy en America/Santiago. */
export function santiagoToday(now: Date = new Date()): Ymd {
  return localToday(now);
}

const EMPTY: QueryConstraint[] = [];

export interface BankBalanceState {
  loading: boolean;
  error: string;
  account: BankAccountDoc | null;
  result: BankBalanceResult | null;
  /** Se alcanzó el tope de alguna consulta. */
  limitReached: boolean;
}

export function useBankAccount(accountId = DEFAULT_BANK_ACCOUNT_ID, enabled = true) {
  return useDocument<BankAccountDoc>("bankAccounts", accountId, enabled);
}

export function useBankBalance({
  accountId = DEFAULT_BANK_ACCOUNT_ID,
  payouts = PAYOUTS_NOT_CONNECTED,
  asOf,
  enabled = true,
}: {
  accountId?: string;
  payouts?: SumupPayoutsInput;
  asOf?: Ymd;
  enabled?: boolean;
} = {}): BankBalanceState {
  const account = useBankAccount(accountId, enabled);
  const openingDate = account.data && isYmd(account.data.openingDate) ? account.data.openingDate : null;
  const ready = enabled && !!openingDate;
  const queries = useMemo(() => (openingDate ? bankBalanceQueries(openingDate) : null), [openingDate]);
  const cashTransfer = queries?.cashTransfer ?? EMPTY;
  const cardExpense = queries?.cardExpense ?? EMPTY;
  const treasuryQuery = queries?.treasury ?? EMPTY;
  const a = useCollection<FinanceTransaction>("financeTransactions", cashTransfer, ready);
  const b = useCollection<FinanceTransaction>("financeTransactions", cardExpense, ready);
  const t = useCollection<TreasuryTransferDoc>("treasuryTransfers", treasuryQuery, ready);
  const day = asOf ?? santiagoToday();

  const ledgerTruncated = a.data.length >= BANK_LEDGER_LIMIT || b.data.length >= BANK_LEDGER_LIMIT;
  const treasuryTruncated = t.data.length >= BANK_TREASURY_LIMIT;
  const loading = account.loading || (ready && (a.loading || b.loading || t.loading));
  const error = account.error || (ready ? a.error || b.error || t.error : "");
  const result = useMemo(() => {
    if (loading || !enabled) return null;
    try {
      return computeBankBalance({
        account: account.data
          ? {
              openingBalance: account.data.openingBalance,
              openingDate: account.data.openingDate,
              openingCash: account.data.openingCash ?? null,
            }
          : null,
        ledger: [...a.data, ...b.data],
        treasury: t.data,
        payouts,
        asOf: day,
        accountId,
        ledgerTruncated,
        treasuryTruncated,
      });
    } catch {
      return null;
    }
  }, [loading, enabled, account.data, a.data, b.data, t.data, payouts, day, accountId, ledgerTruncated, treasuryTruncated]);

  return {
    loading,
    error: error || (!loading && enabled && !result ? "No pudimos calcular el saldo estimado." : ""),
    account: account.data,
    result,
    limitReached: ledgerTruncated || treasuryTruncated,
  };
}

export function useBankHistory(accountId = DEFAULT_BANK_ACCOUNT_ID, enabled = true) {
  const q = useMemo(() => [orderBy("revision", "desc"), limit(BANK_LIST_LIMIT)], []);
  return useCollection<BankAccountHistoryDoc>(`bankAccounts/${accountId}/history`, q, enabled);
}

export function useRecentTreasury(enabled = true) {
  const q = useMemo(() => [orderBy("date", "desc"), limit(BANK_LIST_LIMIT)], []);
  return useCollection<TreasuryTransferDoc>("treasuryTransfers", q, enabled);
}

export function useRecentReconciliations(enabled = true) {
  const q = useMemo(() => [orderBy("date", "desc"), limit(BANK_LIST_LIMIT)], []);
  return useCollection<BankReconciliationDoc>("bankReconciliations", q, enabled);
}
