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
  /**
   * Los abonos SumUp aún cargan: hay cifras de banco/caja, pero el estado es
   * "partial" (nunca "complete") hasta que lleguen.
   */
  payoutsLoading?: boolean;
}

/** Insumo provisional mientras cargan los abonos: el estimado queda parcial. */
export const PAYOUTS_LOADING: SumupPayoutsInput = { status: "unavailable", reason: "cargando los abonos SumUp…" };

export function useBankAccount(accountId = DEFAULT_BANK_ACCOUNT_ID, enabled = true) {
  return useDocument<BankAccountDoc>("bankAccounts", accountId, enabled);
}

export interface BankSourceState<T> {
  data: T;
  loading: boolean;
  error: string;
}

/**
 * Combina las fuentes en el estado de la tarjeta (puro, probado). Falla
 * cerrado: si CUALQUIER fuente tiene error (consulta denegada, índice
 * faltante, sin conexión) no hay número — result = null y se muestra el error.
 * `payouts === null` = los abonos SumUp aún cargan.
 */
export function resolveBankBalanceState({
  account,
  ledger,
  treasury,
  payouts,
  asOf,
  accountId,
  enabled,
}: {
  account: BankSourceState<BankAccountDoc | null>;
  ledger: BankSourceState<FinanceTransaction[]>[];
  treasury: BankSourceState<TreasuryTransferDoc[]>;
  payouts: SumupPayoutsInput | null;
  asOf: Ymd;
  accountId: string;
  enabled: boolean;
}): BankBalanceState {
  if (!enabled) return { loading: false, error: "", account: null, result: null, limitReached: false };
  const ready = !!account.data && isYmd(account.data.openingDate);
  const sources = ready ? [...ledger, treasury] : [];
  const error = account.error || sources.map((x) => x.error).find(Boolean) || "";
  const ledgerTruncated = ledger.some((x) => x.data.length >= BANK_LEDGER_LIMIT);
  const treasuryTruncated = treasury.data.length >= BANK_TREASURY_LIMIT;
  const limitReached = ready && (ledgerTruncated || treasuryTruncated);
  if (error) return { loading: false, error, account: account.data, result: null, limitReached };
  const loading = account.loading || sources.some((x) => x.loading);
  if (loading) return { loading: true, error: "", account: account.data, result: null, limitReached: false };
  const payoutsLoading = ready && payouts === null;
  try {
    const result = computeBankBalance({
      account: account.data
        ? {
            openingBalance: account.data.openingBalance,
            openingDate: account.data.openingDate,
            openingCash: account.data.openingCash ?? null,
          }
        : null,
      ledger: ready ? ledger.flatMap((x) => x.data) : [],
      treasury: ready ? treasury.data : [],
      payouts: payouts ?? (payoutsLoading ? PAYOUTS_LOADING : PAYOUTS_NOT_CONNECTED),
      asOf,
      accountId,
      ledgerTruncated: ready && ledgerTruncated,
      treasuryTruncated: ready && treasuryTruncated,
    });
    return { loading: false, error: "", account: account.data, result, limitReached, payoutsLoading };
  } catch {
    return { loading: false, error: "No pudimos calcular el saldo estimado.", account: account.data, result: null, limitReached };
  }
}

export function useBankBalance({
  accountId = DEFAULT_BANK_ACCOUNT_ID,
  payouts = PAYOUTS_NOT_CONNECTED,
  asOf,
  enabled = true,
}: {
  accountId?: string;
  /** null = cargando; sin valor = no conectado (parcial). */
  payouts?: SumupPayoutsInput | null;
  asOf?: Ymd;
  enabled?: boolean;
} = {}): BankBalanceState {
  const account = useBankAccount(accountId, enabled);
  const openingDate = account.data && isYmd(account.data.openingDate) ? account.data.openingDate : null;
  const ready = enabled && !!openingDate;
  const queries = useMemo(() => (openingDate ? bankBalanceQueries(openingDate) : null), [openingDate]);
  const a = useCollection<FinanceTransaction>("financeTransactions", queries?.cashTransfer ?? EMPTY, ready);
  const b = useCollection<FinanceTransaction>("financeTransactions", queries?.cardExpense ?? EMPTY, ready);
  const t = useCollection<TreasuryTransferDoc>("treasuryTransfers", queries?.treasury ?? EMPTY, ready);
  const day = asOf ?? santiagoToday();
  return useMemo(
    () => resolveBankBalanceState({ account, ledger: [a, b], treasury: t, payouts, asOf: day, accountId, enabled }),
    [account, a, b, t, payouts, day, accountId, enabled],
  );
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
