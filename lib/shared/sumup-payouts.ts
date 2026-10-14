// Conciliación de abonos SumUp (payouts) — lógica PURA, solo lectura.
// Doc: docs/mission-2026/29-sumup-payouts-reconciliation.md
//
// Se compila a functions/shared/sumup-payouts.js (scripts/build-shared.mjs) y
// la usan el callable `sumupPayoutsReconciliation` y la UI. Sin I/O, sin
// Date.now(): todo depende de lo que entra.
//
// Invariantes (G1/G9 + Slice 1b):
//   - El ingreso bruto ya registrado en el libro NUNCA se modifica aquí.
//   - El abono neto (transferencia) NUNCA es un ingreso nuevo.
//   - La comisión sale SOLO del campo `fee` del proveedor. Una diferencia
//     bruto − neto se expone aparte como `difference`, nunca como "comisión".
//   - Comisión desconocida → "pendiente"/"sin confirmar", nunca $0.
//   - Este módulo NO escribe nada: las comisiones son PROPUESTAS
//     (`writesLedger: false`). Escribir en el libro requiere un GO separado.

import { addDays, daysBetween, isValidYmd, localNow, weekdayOf } from "./dates";
import type { Ymd } from "./types";

export type SumupAccount = "offerings" | "cafeteria";
export const SUMUP_ACCOUNTS: readonly SumupAccount[] = ["offerings", "cafeteria"];
export const SUMUP_ACCOUNT_LABEL: Readonly<Record<SumupAccount, string>> = { offerings: "Ofrendas", cafeteria: "Cafetería" };

export const PAYOUT_ROW_TYPE = "PAYOUT";
export const DEDUCTION_ROW_TYPES: readonly string[] = [
  "REFUND_DEDUCTION",
  "CHARGE_BACK_DEDUCTION",
  "DD_RETURN_DEDUCTION",
  "BALANCE_DEDUCTION",
];
export const SUCCESS_STATUSES: readonly string[] = ["SUCCESSFUL"];
export const IN_PROGRESS_STATUSES: readonly string[] = ["PENDING", "IN_PROGRESS", "SCHEDULED", "PROCESSING", "CREATED"];
export const FAILED_STATUSES: readonly string[] = ["FAILED", "CANCELLED", "CANCELED", "RETURNED", "REJECTED", "DECLINED", "REVERSED"];

/** CLP no tiene decimales; ±1 cubre redondeos de SumUp/Firestore (regla G9/Atlas). */
export const AMOUNT_TOLERANCE = 1;
export const MIN_VOTES_FOR_BASIS = 3;
export const FEE_CATEGORY = "Comisiones SumUp";
export const DEFAULT_DIFFERENCE_BUSINESS_DAYS = 5;
/** Ventana máxima (días de venta, inclusiva) que acepta el callable. */
export const MAX_WINDOW_DAYS = 35;
/** Días antes del inicio que se leen para vincular abonos que pagan ventas previas. */
export const SALES_LOOKBACK_DAYS = 10;
/** Días después del fin en los que se buscan abonos de las ventas de la ventana. */
export const PAYOUT_LOOKAHEAD_DAYS = 10;

export type AccountingDatePolicy = "payout_date" | "sale_date";
export const ACCOUNTING_DATE_POLICIES: readonly AccountingDatePolicy[] = ["payout_date", "sale_date"];

export type RowKind = "payout" | "deduction" | "unknown";
export type RowStatusClass = "successful" | "in_progress" | "failed" | "unknown";
export type RowIssue =
  | "currency_missing"
  | "currency_not_clp"
  | "amount_invalid"
  | "fee_missing"
  | "fee_invalid"
  | "date_invalid"
  | "id_missing"
  | "reference_missing"
  | "type_unknown"
  | "status_unknown"
  | "duplicate_conflict";

/** Fila cruda de GET /v1.0/merchants/{mc}/payouts (campos verificados en la sonda). */
export interface RawPayoutRow {
  amount?: unknown;
  currency?: unknown;
  date?: unknown;
  fee?: unknown;
  id?: unknown;
  reference?: unknown;
  status?: unknown;
  transaction_code?: unknown;
  type?: unknown;
}

export interface PayoutRow {
  account: SumupAccount;
  id: string;
  type: string;
  kind: RowKind;
  status: string;
  statusClass: RowStatusClass;
  date: Ymd | null;
  reference: string | null;
  transactionCode: string | null;
  currency: string | null;
  /** Monto informado, entero CLP (ver roundClp). Para deducciones, siempre ≤ 0. */
  amount: number;
  /** Comisión informada por el proveedor, entero CLP; null si no viene. */
  fee: number | null;
  /** true si amount o fee traían decimales y se redondearon. */
  rounded: boolean;
  issues: RowIssue[];
  /** Huella estable del contenido: detecta filas repetidas vs. corregidas. */
  fingerprint: string;
}

/** Venta importada (sumupIntegrations/{account}/transactions), ya con su día local de Chile. */
export interface SaleRecord {
  account: SumupAccount;
  transactionCode: string;
  saleDate: Ymd | null;
  grossAmount: number;
  refundedAmount: number;
  amountAfterRefunds: number;
  status: string;
  paymentType: string;
  currency: string;
}

export type BasisValue = "net" | "gross" | "indeterminate";
export interface BasisDecision {
  basis: BasisValue;
  reason: null | "mismatch_present" | "insufficient_evidence" | "votes_disagree";
  tally: { net: number; gross: number; ambiguous: number; mismatch: number };
}

export type SettlementStatus = "PENDIENTE" | "CONCILIADO" | "CON_DIFERENCIA" | "REQUIERE_REVISION";
export const SETTLEMENT_STATUS_LABEL: Readonly<Record<SettlementStatus, string>> = {
  PENDIENTE: "Pendiente",
  CONCILIADO: "Conciliado",
  CON_DIFERENCIA: "Con diferencia",
  REQUIERE_REVISION: "Requiere revisión",
};

export type SettlementReason =
  | "basis_indeterminate"
  | "basis_gross"
  | "deductions_present"
  | "unknown_row_type"
  | "rows_without_code"
  | "rows_not_found"
  | "rows_other_account"
  | "currency_issue"
  | "duplicate_conflict"
  | "sale_paid_twice"
  | "fee_missing"
  | "row_id_missing"
  | "reference_missing"
  | "date_invalid"
  | "amount_mismatch"
  | "payout_failed"
  | "payout_in_progress"
  | "status_unknown"
  | "difference_within_term"
  | "difference_after_term"
  | "refunds_before_payout"
  | "payout_retried"
  | "rounding";

export interface Settlement {
  id: string;
  account: SumupAccount;
  payoutDate: Ymd | null;
  reference: string | null;
  referenceShort: string;
  /** Id de la primera fila cuando el abono no tiene referencia (entra al id). */
  anchorRowId: string | null;
  statusClass: RowStatusClass;
  status: SettlementStatus;
  reasons: SettlementReason[];
  rowCount: number;
  payoutRowCount: number;
  deductionRowCount: number;
  unlinkedRowCount: number;
  linkedSalesCount: number;
  saleDays: Ymd[];
  /** Σ grossAmount de las ventas vinculadas por filas PAYOUT (bruto del libro). */
  grossSales: number;
  /** Σ fee del proveedor; null si alguna fila no lo trae. */
  fee: number | null;
  feeConfirmed: boolean;
  /** Devoluciones aplicadas antes del abono (fila = bruto − reembolso), ≥ 0. */
  refundsBeforePayout: number;
  /** Filas de deducción (devolución/contracargo/otras), ≤ 0. */
  deductions: number;
  /** AJUSTES / DEVOLUCIONES = deductions − refundsBeforePayout, ≤ 0. */
  adjustments: number;
  /** ABONO NETO = lo transferido por SumUp según las filas. */
  netPaid: number;
  /** bruto − neto. NO es la comisión. */
  difference: number;
  /** neto − (bruto − devoluciones previas − comisión + deducciones); 0 = cuadra. */
  residual: number;
  businessDaysSincePayout: number | null;
  /** El abono cae dentro de la ventana pedida (fecha de abono). */
  inWindow: boolean;
  /** Abono posterior a la ventana que paga ventas de la ventana. */
  afterWindow: boolean;
  /** Montos por día de venta (para la política "sale_date"). */
  byDay: { saleDate: Ymd | null; gross: number; fee: number | null; sales: number }[];
}

export interface PendingDay {
  account: SumupAccount;
  saleDate: Ymd;
  salesCount: number;
  amount: number;
  status: "PENDIENTE";
  inProgressCount: number;
  failedCount: number;
}

export type ProposalState = "propuesta" | "ya_registrada" | "revision" | "sin_confirmar" | "excluida";
export interface FeeProposal {
  id: string;
  account: SumupAccount;
  type: "expense";
  category: typeof FEE_CATEGORY;
  description: string;
  amount: number;
  accountingDate: Ymd | null;
  policy: AccountingDatePolicy;
  payoutDate: Ymd | null;
  saleDate: Ymd | null;
  saleDates: Ymd[];
  settlementId: string;
  referenceShort: string;
  state: ProposalState;
  reasons: SettlementReason[];
  previousAmount: number | null;
  /** Siempre false: este módulo nunca escribe en el libro. */
  writesLedger: false;
}

export interface AccountTotals {
  /** Abonos con fecha dentro del período (todos los estados). */
  settlements: number;
  /** De ellos, fallidos/en proceso/desconocidos: no suman montos. */
  notCountedSettlements: number;
  grossSales: number;
  fee: number;
  feeComplete: boolean;
  adjustments: number;
  netPaid: number;
  difference: number;
  pendingAmount: number;
  pendingSales: number;
  byStatus: Record<SettlementStatus, number>;
}

export interface AccountReconciliation {
  account: SumupAccount;
  basis: BasisDecision;
  settlements: Settlement[];
  pendingDays: PendingDay[];
  pendingAmount: number;
  pendingSales: number;
  proposals: FeeProposal[];
  totals: AccountTotals;
  rowStats: { fetched: number; used: number; duplicatesIgnored: number; duplicateConflicts: number; rounded: number };
}

export interface ReconcileOptions {
  differenceBusinessDays?: number;
  holidays?: readonly Ymd[];
  accountingDatePolicy?: AccountingDatePolicy;
  /** Comisiones ya registradas/propuestas antes (id → monto), p. ej. leídas del libro. */
  previousProposals?: Readonly<Record<string, { amount: number }>>;
}

export interface ReconcileInput {
  accounts: readonly SumupAccount[];
  rowsByAccount: Partial<Record<SumupAccount, readonly RawPayoutRow[]>>;
  /** Ventas de AMBAS cuentas (para detectar filas de la otra cuenta), con lookback. */
  salesByAccount: Partial<Record<SumupAccount, readonly SaleRecord[]>>;
  period: { startDate: Ymd; endDate: Ymd };
  asOfDate: Ymd;
  options?: ReconcileOptions;
}

export interface ReconcileResult {
  period: { startDate: Ymd; endDate: Ymd };
  asOfDate: Ymd;
  policy: AccountingDatePolicy;
  differenceBusinessDays: number;
  accounts: AccountReconciliation[];
  totals: AccountTotals;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Redondeo CLP documentado: al entero más cercano, mitades alejándose de cero
 * (2,5 → 3; −2,5 → −3). null si no es un número finito.
 */
export function roundClp(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const r = Math.sign(n) * Math.round(Math.abs(n));
  return r === 0 ? 0 : r;
}

/** Hash corto determinista (cyrb53), igual en cliente y Functions. 12 hex. */
export function shortHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0").slice(-12);
}

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Últimos 6 caracteres de la referencia (para mostrar), o "—". */
export function shortReference(reference: string | null): string {
  if (!reference) return "—";
  const compact = reference.replace(/\s+/g, "");
  return compact.length <= 6 ? compact : `…${compact.slice(-6)}`;
}

/** Día local (America/Santiago) de un instante. */
export function chileDate(instant: Date | number): Ymd {
  return localNow(instant).slice(0, 10);
}

/** Días hábiles (lun–vie, sin feriados) estrictamente después de `from` y hasta `to` inclusive. */
export function businessDaysBetween(from: Ymd, to: Ymd, holidays: readonly Ymd[] = []): number {
  if (daysBetween(from, to) <= 0) return 0;
  const skip = new Set(holidays);
  let count = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (wd !== 0 && wd !== 6 && !skip.has(d)) count += 1;
  }
  return count;
}

export interface WindowPlan {
  startDate: Ymd;
  endDate: Ymd;
  /** Abonos que se piden a SumUp (fecha de abono). null si la ventana es futura. */
  payoutFetch: { startDate: Ymd; endDate: Ymd } | null;
  /** Ventas que se leen para vincular (incluye lookback). */
  salesRead: { startDate: Ymd; endDate: Ymd };
}

export type WindowError = "invalid_dates" | "end_before_start" | "window_too_long";

/** Valida la ventana (≤ MAX_WINDOW_DAYS días, inclusiva) y calcula qué leer. */
export function planWindow(startDate: unknown, endDate: unknown, asOfDate: Ymd): { ok: true; plan: WindowPlan } | { ok: false; error: WindowError } {
  if (typeof startDate !== "string" || typeof endDate !== "string" || !isValidYmd(startDate) || !isValidYmd(endDate)) {
    return { ok: false, error: "invalid_dates" };
  }
  if (endDate < startDate) return { ok: false, error: "end_before_start" };
  if (daysBetween(startDate, endDate) + 1 > MAX_WINDOW_DAYS) return { ok: false, error: "window_too_long" };
  const lookahead = addDays(endDate, PAYOUT_LOOKAHEAD_DAYS);
  const fetchEnd = lookahead < asOfDate ? lookahead : asOfDate;
  const payoutFetch = fetchEnd >= startDate ? { startDate, endDate: fetchEnd } : null;
  // Las ventas se leen hasta el último día de abonos pedido: un abono posterior
  // al período (p. ej. 03-11 que paga 31-10 + 01-11) debe vincular TODAS sus
  // filas. Pendientes y totales siguen limitados al período.
  const salesEnd = payoutFetch && payoutFetch.endDate > endDate ? payoutFetch.endDate : endDate;
  return {
    ok: true,
    plan: {
      startDate,
      endDate,
      payoutFetch,
      salesRead: { startDate: addDays(startDate, -SALES_LOOKBACK_DAYS), endDate: salesEnd },
    },
  };
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

function classifyStatus(status: string): RowStatusClass {
  if (SUCCESS_STATUSES.includes(status)) return "successful";
  if (IN_PROGRESS_STATUSES.includes(status)) return "in_progress";
  if (FAILED_STATUSES.includes(status)) return "failed";
  return "unknown";
}

function classifyKind(type: string): RowKind {
  if (type === PAYOUT_ROW_TYPE) return "payout";
  if (DEDUCTION_ROW_TYPES.includes(type)) return "deduction";
  return "unknown";
}

function parseRowDate(value: unknown): Ymd | null {
  const s = str(value).slice(0, 10);
  return isValidYmd(s) ? s : null;
}

/**
 * Normaliza y valida una fila. Montos a entero CLP (roundClp). Moneda distinta
 * de CLP o ausente → issue (la fila queda en revisión, nunca se convierte).
 * Deducciones: el monto se fuerza a ≤ 0 (restan del abono sea cual sea el signo
 * que entregue el proveedor).
 */
export function parsePayoutRow(raw: RawPayoutRow, account: SumupAccount): PayoutRow {
  const issues: RowIssue[] = [];
  const id = str(raw?.id);
  const type = str(raw?.type).toUpperCase();
  const status = str(raw?.status).toUpperCase();
  const kind = classifyKind(type);
  const statusClass = classifyStatus(status);
  const date = parseRowDate(raw?.date);
  const reference = str(raw?.reference) || null;
  const transactionCode = str(raw?.transaction_code) || null;
  const currency = str(raw?.currency).toUpperCase() || null;

  if (!id) issues.push("id_missing");
  if (kind === "unknown") issues.push("type_unknown");
  if (statusClass === "unknown") issues.push("status_unknown");
  if (!date) issues.push("date_invalid");
  if (!reference) issues.push("reference_missing");
  if (!currency) issues.push("currency_missing");
  else if (currency !== "CLP") issues.push("currency_not_clp");

  const rawAmount = typeof raw?.amount === "number" ? raw.amount : Number(raw?.amount);
  let amount = roundClp(raw?.amount);
  if (amount === null) {
    issues.push("amount_invalid");
    amount = 0;
  }
  const fee = roundClp(raw?.fee);
  if (fee === null) issues.push("fee_missing");
  else if (fee < 0) issues.push("fee_invalid");
  const rawFee = typeof raw?.fee === "number" ? raw.fee : Number(raw?.fee);
  const rounded =
    (Number.isFinite(rawAmount) && !Number.isInteger(rawAmount)) || (fee !== null && Number.isFinite(rawFee) && !Number.isInteger(rawFee));

  if (kind === "deduction") amount = amount === 0 ? 0 : -Math.abs(amount);
  else if (kind === "payout" && amount < 0) issues.push("amount_invalid");

  const fingerprint = shortHash(
    JSON.stringify([type, status, date, reference, transactionCode, currency, str(raw?.amount), str(raw?.fee)]),
  );
  return { account, id, type, kind, status, statusClass, date, reference, transactionCode, currency, amount, fee, rounded, issues, fingerprint };
}

/**
 * Deduplica por id: la misma fila repetida (misma huella) se ignora; el mismo
 * id con contenido distinto queda marcado `duplicate_conflict` (se conserva la
 * primera, nunca se suman ambas).
 */
export function dedupeRows(rows: readonly PayoutRow[]): { rows: PayoutRow[]; duplicatesIgnored: number; duplicateConflicts: number } {
  const byId = new Map<string, PayoutRow>();
  const out: PayoutRow[] = [];
  let duplicatesIgnored = 0;
  let duplicateConflicts = 0;
  for (const row of rows) {
    if (!row.id) {
      out.push(row);
      continue;
    }
    const seen = byId.get(row.id);
    if (!seen) {
      const copy = { ...row, issues: [...row.issues] };
      byId.set(row.id, copy);
      out.push(copy);
      continue;
    }
    if (seen.fingerprint === row.fingerprint) duplicatesIgnored += 1;
    else {
      duplicateConflicts += 1;
      if (!seen.issues.includes("duplicate_conflict")) seen.issues.push("duplicate_conflict");
    }
  }
  return { rows: out, duplicatesIgnored, duplicateConflicts };
}

// ---------------------------------------------------------------------------
// Ventas y base
// ---------------------------------------------------------------------------

/** Venta con tarjeta (POS) en CLP: única que SumUp abona. El efectivo nunca. */
export function isCardSale(sale: SaleRecord): boolean {
  return sale.paymentType === "POS" && sale.currency === "CLP";
}

/** Venta que debería abonarse: tarjeta, SUCCESSFUL/REFUNDED con saldo > 0. */
export function isPayableSale(sale: SaleRecord): boolean {
  return isCardSale(sale) && (sale.status === "SUCCESSFUL" || sale.status === "REFUNDED") && sale.amountAfterRefunds > 0;
}

export type BasisVote = "net" | "gross" | "ambiguous" | "mismatch";

/** Regla de Atlas/G9 para una fila PAYOUT vinculada (G = bruto, G' = bruto − reembolsos). */
export function basisVote(row: Pick<PayoutRow, "amount" | "fee">, sale: Pick<SaleRecord, "grossAmount" | "refundedAmount">): BasisVote {
  const fee = row.fee ?? 0;
  if (fee === 0) return "ambiguous";
  const g = sale.grossAmount;
  const gp = Math.max(0, g - sale.refundedAmount);
  const near = (a: number, b: number) => Math.abs(a - b) <= AMOUNT_TOLERANCE;
  if (near(row.amount + fee, g) || near(row.amount + fee, gp)) return "net";
  if (near(row.amount, g) || near(row.amount, gp)) return "gross";
  return "mismatch";
}

/** Base aceptada solo con ≥ 3 votos contables, sin mismatch y sin desacuerdo. */
export function aggregateBasisVotes(votes: readonly BasisVote[]): BasisDecision {
  const tally = { net: 0, gross: 0, ambiguous: 0, mismatch: 0 };
  for (const v of votes) tally[v] += 1;
  const countable = tally.net + tally.gross + tally.mismatch;
  if (tally.mismatch > 0) return { basis: "indeterminate", reason: "mismatch_present", tally };
  if (countable < MIN_VOTES_FOR_BASIS) return { basis: "indeterminate", reason: "insufficient_evidence", tally };
  if (tally.net > 0 && tally.gross > 0) return { basis: "indeterminate", reason: "votes_disagree", tally };
  return { basis: tally.net > 0 ? "net" : "gross", reason: null, tally };
}

// ---------------------------------------------------------------------------
// Conciliación
// ---------------------------------------------------------------------------

type Link = { status: "linked"; sale: SaleRecord } | { status: "no_code" } | { status: "not_found" } | { status: "other_account" };

function linkRow(row: PayoutRow, index: Map<string, SaleRecord>): Link {
  if (!row.transactionCode) return { status: "no_code" };
  const sale = index.get(row.transactionCode);
  if (!sale) return { status: "not_found" };
  if (sale.account !== row.account) return { status: "other_account" };
  return { status: "linked", sale };
}

/** Sin referencia, cada fila es su propio abono: el id de la fila entra al hash (ids únicos). */
function settlementKeyHash(reference: string | null, statusClass: RowStatusClass, rowId: string | null = null): string {
  const ref = reference ?? `sin-referencia:${rowId ?? ""}`;
  return shortHash(`${ref}${statusClass === "successful" ? "" : `|${statusClass}`}`);
}

/**
 * Id determinista de la propuesta de comisión de un abono (idempotente entre reruns).
 * `rowId` solo se usa cuando el abono no tiene referencia.
 */
export function feeProposalId(
  account: SumupAccount,
  payoutDate: Ymd | null,
  reference: string | null,
  statusClass: RowStatusClass = "successful",
  rowId: string | null = null,
): string {
  return `sumup_fee_${account}_${payoutDate ?? "sin-fecha"}_${settlementKeyHash(reference, statusClass, reference ? null : rowId)}`;
}

function emptyByStatus(): Record<SettlementStatus, number> {
  return { PENDIENTE: 0, CONCILIADO: 0, CON_DIFERENCIA: 0, REQUIERE_REVISION: 0 };
}

function pushReason(list: SettlementReason[], reason: SettlementReason) {
  if (!list.includes(reason)) list.push(reason);
}

interface BuildCtx {
  account: SumupAccount;
  basis: BasisDecision;
  index: Map<string, SaleRecord>;
  paidCodeCount: Map<string, number>;
  period: { startDate: Ymd; endDate: Ymd };
  asOfDate: Ymd;
  differenceBusinessDays: number;
  holidays: readonly Ymd[];
}

function buildSettlement(rows: PayoutRow[], ctx: BuildCtx): Settlement {
  const first = rows[0];
  const reasons: SettlementReason[] = [];
  const payoutDate = first.date;
  const reference = first.reference;
  const statusClass = first.statusClass;
  const anchorRowId = reference ? null : first.id;
  let roundedRows = 0;
  const linkedCodes: string[] = [];

  let netPaid = 0;
  let fee: number | null = 0;
  let deductions = 0;
  let refundsBeforePayout = 0;
  let unlinked = 0;
  let payoutRowCount = 0;
  let deductionRowCount = 0;
  const linkedSales = new Map<string, SaleRecord>();
  const byDay = new Map<string, { saleDate: Ymd | null; gross: number; fee: number | null; sales: Set<string> }>();

  for (const row of rows) {
    if (row.rounded) roundedRows += 1;
    if (row.issues.includes("currency_missing") || row.issues.includes("currency_not_clp")) pushReason(reasons, "currency_issue");
    if (row.issues.includes("duplicate_conflict")) pushReason(reasons, "duplicate_conflict");
    if (row.issues.includes("id_missing")) pushReason(reasons, "row_id_missing");
    if (row.issues.includes("reference_missing")) pushReason(reasons, "reference_missing");
    if (row.issues.includes("date_invalid")) pushReason(reasons, "date_invalid");
    if (row.issues.includes("amount_invalid")) pushReason(reasons, "amount_mismatch");
    if (row.fee === null || row.issues.includes("fee_invalid")) pushReason(reasons, "fee_missing");

    const rowFee = row.fee;
    fee = fee === null || rowFee === null ? null : fee + rowFee;

    if (row.kind === "deduction") {
      deductionRowCount += 1;
      deductions += row.amount;
      netPaid += row.amount;
      continue;
    }
    if (row.kind === "unknown") {
      pushReason(reasons, "unknown_row_type");
      netPaid += row.amount;
      continue;
    }

    payoutRowCount += 1;
    netPaid += ctx.basis.basis === "gross" ? row.amount - (rowFee ?? 0) : row.amount;
    const link = linkRow(row, ctx.index);
    if (link.status !== "linked") {
      unlinked += 1;
      pushReason(reasons, link.status === "no_code" ? "rows_without_code" : link.status === "not_found" ? "rows_not_found" : "rows_other_account");
      const key = "sin-fecha";
      const bucket = byDay.get(key) ?? { saleDate: null, gross: 0, fee: 0, sales: new Set<string>() };
      bucket.fee = bucket.fee === null || rowFee === null ? null : bucket.fee + rowFee;
      byDay.set(key, bucket);
      continue;
    }
    const sale = link.sale;
    linkedCodes.push(sale.transactionCode);
    if ((ctx.paidCodeCount.get(sale.transactionCode) ?? 0) > 1) pushReason(reasons, "sale_paid_twice");
    if (!linkedSales.has(sale.transactionCode)) linkedSales.set(sale.transactionCode, sale);

    const expected = ctx.basis.basis === "gross" ? row.amount : row.amount + (rowFee ?? 0);
    const g = sale.grossAmount;
    const gp = Math.max(0, g - sale.refundedAmount);
    if (Math.abs(expected - g) <= AMOUNT_TOLERANCE) {
      // abono por el bruto original
    } else if (Math.abs(expected - gp) <= AMOUNT_TOLERANCE) {
      refundsBeforePayout += g - gp;
      pushReason(reasons, "refunds_before_payout");
    } else {
      pushReason(reasons, "amount_mismatch");
    }

    const key = sale.saleDate ?? "sin-fecha";
    const bucket = byDay.get(key) ?? { saleDate: sale.saleDate, gross: 0, fee: 0, sales: new Set<string>() };
    if (!bucket.sales.has(sale.transactionCode)) {
      bucket.sales.add(sale.transactionCode);
      bucket.gross += sale.grossAmount;
    }
    bucket.fee = bucket.fee === null || rowFee === null ? null : bucket.fee + rowFee;
    byDay.set(key, bucket);
  }

  const grossSales = [...linkedSales.values()].reduce((s, sale) => s + sale.grossAmount, 0);
  const feeKnown = fee ?? 0;
  const residual = netPaid - (grossSales - refundsBeforePayout - feeKnown + deductions);
  const difference = grossSales - netPaid;
  const saleDays = [...new Set([...linkedSales.values()].map((s) => s.saleDate).filter((d): d is Ymd => !!d))].sort();

  if (ctx.basis.basis === "indeterminate") pushReason(reasons, "basis_indeterminate");
  if (ctx.basis.basis === "gross") pushReason(reasons, "basis_gross");
  if (deductionRowCount > 0) pushReason(reasons, "deductions_present");

  const businessDaysSincePayout = payoutDate ? businessDaysBetween(payoutDate, ctx.asOfDate, ctx.holidays) : null;

  const blocking = reasons.filter((r) => r !== "refunds_before_payout");
  let status: SettlementStatus;
  if (statusClass === "failed") {
    pushReason(reasons, "payout_failed");
    // Informativo: todas sus ventas tienen otro abono exitoso (SumUp reintentó).
    if (linkedCodes.length > 0 && linkedCodes.every((c) => (ctx.paidCodeCount.get(c) ?? 0) > 0)) pushReason(reasons, "payout_retried");
    status = "REQUIERE_REVISION";
  } else if (statusClass === "unknown") {
    pushReason(reasons, "status_unknown");
    status = "REQUIERE_REVISION";
  } else if (blocking.length > 0) {
    status = "REQUIERE_REVISION";
    if (statusClass === "in_progress") pushReason(reasons, "payout_in_progress");
  } else if (statusClass === "in_progress") {
    pushReason(reasons, "payout_in_progress");
    status = "PENDIENTE";
  } else if (residual === 0) {
    status = "CONCILIADO";
  } else if (Math.abs(residual) <= roundedRows) {
    // Cada fila con decimales redondeados (monto y comisión por separado) puede
    // desviar a lo más $1: no es una diferencia real.
    pushReason(reasons, "rounding");
    status = "CONCILIADO";
  } else if ((businessDaysSincePayout ?? 0) >= ctx.differenceBusinessDays) {
    pushReason(reasons, "difference_after_term");
    status = "CON_DIFERENCIA";
  } else {
    pushReason(reasons, "difference_within_term");
    status = "PENDIENTE";
  }

  // Comisión confirmada: abono exitoso, base net aceptada, todas las filas con
  // fee del proveedor, todas vinculadas y nada que revisar.
  const feeConfirmed =
    statusClass === "successful" && ctx.basis.basis === "net" && fee !== null && unlinked === 0 && status !== "REQUIERE_REVISION";

  const inWindow = !!payoutDate && payoutDate >= ctx.period.startDate && payoutDate <= ctx.period.endDate;
  const afterWindow = !!payoutDate && payoutDate > ctx.period.endDate;

  return {
    id: `stl_${ctx.account}_${payoutDate ?? "sin-fecha"}_${settlementKeyHash(reference, statusClass, anchorRowId)}`,
    account: ctx.account,
    payoutDate,
    reference,
    referenceShort: shortReference(reference),
    anchorRowId,
    statusClass,
    status,
    reasons,
    rowCount: rows.length,
    payoutRowCount,
    deductionRowCount,
    unlinkedRowCount: unlinked,
    linkedSalesCount: linkedSales.size,
    saleDays,
    grossSales,
    fee,
    feeConfirmed,
    refundsBeforePayout,
    deductions,
    adjustments: deductions - refundsBeforePayout,
    netPaid,
    difference,
    residual,
    businessDaysSincePayout,
    inWindow,
    afterWindow,
    byDay: [...byDay.values()]
      .map((b) => ({ saleDate: b.saleDate, gross: b.gross, fee: b.fee, sales: b.sales.size }))
      .sort((a, b) => String(a.saleDate).localeCompare(String(b.saleDate))),
  };
}

function proposalState(settlement: Settlement, amount: number, previous: { amount: number } | undefined): ProposalState {
  if (settlement.statusClass === "failed") return "excluida";
  if (previous && previous.amount !== amount) return "revision";
  if (!(settlement.status === "CONCILIADO" && settlement.feeConfirmed)) return "sin_confirmar";
  if (previous) return "ya_registrada";
  return "propuesta";
}

/**
 * Propuestas de gasto "Comisiones SumUp" (NUNCA se escriben aquí).
 *  - payout_date (por defecto): una por abono, fecha contable = fecha del abono.
 *  - sale_date: una por día de venta dentro del abono, fecha contable = día de venta.
 * La política es una decisión humana (doc 29). Ids deterministas: el mismo
 * abono visto dos veces, en ventanas solapadas o en reruns da el mismo id y monto.
 */
export function buildFeeProposals(
  settlement: Settlement,
  policy: AccountingDatePolicy,
  previous: Readonly<Record<string, { amount: number }>> = {},
): FeeProposal[] {
  const baseId = feeProposalId(settlement.account, settlement.payoutDate, settlement.reference, settlement.statusClass, settlement.anchorRowId);
  const label = SUMUP_ACCOUNT_LABEL[settlement.account];
  const make = (id: string, amount: number, saleDate: Ymd | null, saleDates: Ymd[], accountingDate: Ymd | null): FeeProposal | null => {
    const prev = previous[id];
    if (amount === 0 && !prev && settlement.statusClass !== "failed") return null;
    const state = proposalState(settlement, amount, prev);
    return {
      id,
      account: settlement.account,
      type: "expense",
      category: FEE_CATEGORY,
      description: `Comisión SumUp · ${label} · abono ${settlement.payoutDate ?? "sin fecha"}${saleDate ? ` · venta ${saleDate}` : ""}`,
      amount: state === "excluida" ? 0 : amount,
      accountingDate,
      policy,
      payoutDate: settlement.payoutDate,
      saleDate,
      saleDates,
      settlementId: settlement.id,
      referenceShort: settlement.referenceShort,
      state,
      reasons: [...settlement.reasons],
      previousAmount: prev ? prev.amount : null,
      writesLedger: false,
    };
  };

  if (policy === "sale_date") {
    return settlement.byDay
      .map((day) => {
        const suffix = day.saleDate ? day.saleDate.replace(/-/g, "") : "sinfecha";
        return make(`${baseId}_s${suffix}`, day.fee ?? 0, day.saleDate, day.saleDate ? [day.saleDate] : [], day.saleDate);
      })
      .filter((p): p is FeeProposal => p !== null);
  }
  const single = make(baseId, settlement.fee ?? 0, null, settlement.saleDays, settlement.payoutDate);
  return single ? [single] : [];
}

/**
 * Totales del período. Los montos suman SOLO abonos exitosos: un abono fallido
 * o en proceso no llegó al banco y sus ventas siguen en "pendiente de abono"
 * (sumarlos contaría dos veces la misma venta). Se cuentan aparte en
 * `notCountedSettlements` y siguen en `byStatus`.
 */
function sumTotals(settlements: readonly Settlement[], pendingAmount: number, pendingSales: number): AccountTotals {
  const byStatus = emptyByStatus();
  let grossSales = 0;
  let fee = 0;
  let feeComplete = true;
  let adjustments = 0;
  let netPaid = 0;
  let notCountedSettlements = 0;
  for (const s of settlements) {
    byStatus[s.status] += 1;
    if (s.statusClass !== "successful") {
      notCountedSettlements += 1;
      continue;
    }
    grossSales += s.grossSales;
    if (s.fee === null || !s.feeConfirmed) feeComplete = false;
    fee += s.fee ?? 0;
    adjustments += s.adjustments;
    netPaid += s.netPaid;
  }
  return {
    settlements: settlements.length,
    notCountedSettlements,
    grossSales,
    fee,
    feeComplete,
    adjustments,
    netPaid,
    difference: grossSales - netPaid,
    pendingAmount,
    pendingSales,
    byStatus,
  };
}

/** Concilia una cuenta. Ver reconcile() para el contrato completo. */
export function reconcileAccount(
  account: SumupAccount,
  rawRows: readonly RawPayoutRow[],
  allSales: readonly SaleRecord[],
  period: { startDate: Ymd; endDate: Ymd },
  asOfDate: Ymd,
  options: ReconcileOptions = {},
): AccountReconciliation {
  const differenceBusinessDays = options.differenceBusinessDays ?? DEFAULT_DIFFERENCE_BUSINESS_DAYS;
  const holidays = options.holidays ?? [];
  const policy = options.accountingDatePolicy ?? "payout_date";

  const index = new Map<string, SaleRecord>();
  for (const sale of allSales) if (sale.transactionCode && !index.has(sale.transactionCode)) index.set(sale.transactionCode, sale);

  const parsed = rawRows.map((r) => parsePayoutRow(r, account));
  const { rows, duplicatesIgnored, duplicateConflicts } = dedupeRows(parsed);

  // Votos de base: filas PAYOUT exitosas vinculadas a una venta de esta cuenta.
  const votes: BasisVote[] = [];
  const paidCodeCount = new Map<string, number>();
  const rowsBySaleCode = new Map<string, PayoutRow[]>();
  for (const row of rows) {
    if (row.kind !== "payout") continue;
    const link = linkRow(row, index);
    if (link.status !== "linked") continue;
    const list = rowsBySaleCode.get(link.sale.transactionCode) ?? [];
    list.push(row);
    rowsBySaleCode.set(link.sale.transactionCode, list);
    if (row.statusClass === "successful") {
      paidCodeCount.set(link.sale.transactionCode, (paidCodeCount.get(link.sale.transactionCode) ?? 0) + 1);
      if (row.fee !== null) votes.push(basisVote(row, link.sale));
    }
  }
  const basis = aggregateBasisVotes(votes);

  // Agrupar en abonos: cuenta + fecha + referencia + clase de estado.
  const groups = new Map<string, PayoutRow[]>();
  for (const row of rows) {
    const key = `${row.date ?? "sin-fecha"}|${row.reference ?? `sin-referencia:${row.id}`}|${row.statusClass}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const ctx: BuildCtx = { account, basis, index, paidCodeCount, period, asOfDate, differenceBusinessDays, holidays };
  const inWindowSale = (sale: SaleRecord) => !!sale.saleDate && sale.saleDate >= period.startDate && sale.saleDate <= period.endDate;

  const settlements = [...groups.values()]
    .map((g) => buildSettlement(g, ctx))
    .filter((s) => {
      if (s.inWindow) return true;
      if (!s.afterWindow) return false;
      // Abono posterior: solo si paga alguna venta de la ventana.
      return s.saleDays.some((d) => d >= period.startDate && d <= period.endDate);
    })
    .sort((a, b) => String(a.payoutDate).localeCompare(String(b.payoutDate)) || a.id.localeCompare(b.id));

  // Ventas por abonar: tarjeta, con saldo, dentro de la ventana, sin fila PAYOUT exitosa.
  const pendingMap = new Map<Ymd, PendingDay>();
  let pendingAmount = 0;
  let pendingSales = 0;
  for (const sale of allSales) {
    if (sale.account !== account || !isPayableSale(sale) || !inWindowSale(sale)) continue;
    if ((paidCodeCount.get(sale.transactionCode) ?? 0) > 0) continue;
    const day = sale.saleDate as Ymd;
    const bucket = pendingMap.get(day) ?? { account, saleDate: day, salesCount: 0, amount: 0, status: "PENDIENTE", inProgressCount: 0, failedCount: 0 };
    bucket.salesCount += 1;
    bucket.amount += sale.amountAfterRefunds;
    const related = rowsBySaleCode.get(sale.transactionCode) ?? [];
    if (related.some((r) => r.statusClass === "in_progress")) bucket.inProgressCount += 1;
    if (related.some((r) => r.statusClass === "failed")) bucket.failedCount += 1;
    pendingMap.set(day, bucket);
    pendingAmount += sale.amountAfterRefunds;
    pendingSales += 1;
  }
  const pendingDays = [...pendingMap.values()].sort((a, b) => a.saleDate.localeCompare(b.saleDate));

  const proposalMap = new Map<string, FeeProposal>();
  for (const s of settlements) {
    for (const p of buildFeeProposals(s, policy, options.previousProposals)) if (!proposalMap.has(p.id)) proposalMap.set(p.id, p);
  }

  const totalsSource = settlements.filter((s) => s.inWindow);
  return {
    account,
    basis,
    settlements,
    pendingDays,
    pendingAmount,
    pendingSales,
    proposals: [...proposalMap.values()],
    totals: sumTotals(totalsSource, pendingAmount, pendingSales),
    rowStats: {
      fetched: rawRows.length,
      used: rows.length,
      duplicatesIgnored,
      duplicateConflicts,
      rounded: rows.filter((r) => r.rounded).length,
    },
  };
}

/**
 * Conciliación completa, cuentas aisladas (cada una con su base y sus abonos).
 * `totals` suma solo abonos EXITOSOS con fecha dentro del período (`inWindow`):
 * los abonos posteriores que pagan ventas del período se muestran pero no se
 * suman, para no contar dos veces entre meses; los fallidos/en proceso tampoco
 * (sus ventas siguen pendientes de abono).
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const options = input.options ?? {};
  const allSales: SaleRecord[] = [];
  for (const account of SUMUP_ACCOUNTS) for (const sale of input.salesByAccount[account] ?? []) allSales.push(sale);
  const accounts = input.accounts.map((account) =>
    reconcileAccount(account, input.rowsByAccount[account] ?? [], allSales, input.period, input.asOfDate, options),
  );
  return {
    period: input.period,
    asOfDate: input.asOfDate,
    policy: options.accountingDatePolicy ?? "payout_date",
    differenceBusinessDays: options.differenceBusinessDays ?? DEFAULT_DIFFERENCE_BUSINESS_DAYS,
    accounts,
    totals: combineTotals(accounts.map((a) => a.totals)),
  };
}

export function combineTotals(list: readonly AccountTotals[]): AccountTotals {
  const byStatus = emptyByStatus();
  const out: AccountTotals = { settlements: 0, notCountedSettlements: 0, grossSales: 0, fee: 0, feeComplete: true, adjustments: 0, netPaid: 0, difference: 0, pendingAmount: 0, pendingSales: 0, byStatus };
  for (const t of list) {
    out.settlements += t.settlements;
    out.notCountedSettlements += t.notCountedSettlements;
    out.grossSales += t.grossSales;
    out.fee += t.fee;
    out.feeComplete = out.feeComplete && t.feeComplete;
    out.adjustments += t.adjustments;
    out.netPaid += t.netPaid;
    out.difference += t.difference;
    out.pendingAmount += t.pendingAmount;
    out.pendingSales += t.pendingSales;
    for (const k of Object.keys(byStatus) as SettlementStatus[]) byStatus[k] += t.byStatus[k];
  }
  return out;
}

/** Ids de propuesta posibles de un conjunto de filas (para leer el libro antes de proponer). */
export function candidateProposalIds(account: SumupAccount, rawRows: readonly RawPayoutRow[], policy: AccountingDatePolicy, sales: readonly SaleRecord[] = []): string[] {
  const ids = new Set<string>();
  const index = new Map<string, SaleRecord>();
  for (const s of sales) if (s.transactionCode && !index.has(s.transactionCode)) index.set(s.transactionCode, s);
  for (const raw of rawRows) {
    const row = parsePayoutRow(raw, account);
    const base = feeProposalId(account, row.date, row.reference, row.statusClass, row.id || null);
    if (policy === "payout_date") ids.add(base);
    else {
      const sale = row.transactionCode ? index.get(row.transactionCode) : undefined;
      const d = sale && sale.account === account && sale.saleDate ? sale.saleDate.replace(/-/g, "") : "sinfecha";
      ids.add(`${base}_s${d}`);
    }
  }
  return [...ids];
}
