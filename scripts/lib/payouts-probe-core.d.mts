// Type declarations for the thin re-export in payouts-probe-core.mjs (see
// that file for why: it forwards to functions/sumup/payouts-core.js via
// createRequire so probe + ingestion share one implementation).
// Loosely typed on purpose — this module is exercised directly by
// tests/sumup-payouts-probe.test.ts with plain object literals; the real
// shapes live in functions/sumup/payouts-core.js's JSDoc.

export const PAYOUT_TYPE: string;
export const AMOUNT_TOLERANCE: number;
export const MIN_VOTES_FOR_BASIS: number;

export function maskApiKey(key: string): string;

export function detectBasisVote(input: {
  payoutAmount: number;
  payoutFee: number;
  gross: number;
  refunded: number;
}): { vote: "net" | "gross" | "ambiguous" | "mismatch"; detail: Record<string, number> };

export function aggregateBasisVotes(votes: string[]): {
  basis: "net" | "gross" | "indeterminada";
  reason: string | null;
  tally: { net: number; gross: number; ambiguous: number; mismatch: number };
};

export function buildTransactionIndex(
  transactionsByAccount: Record<string, Array<Record<string, unknown>>>,
): Map<string, { account: string; tx: Record<string, unknown> }>;

export function linkPayoutRow(
  row: Record<string, unknown>,
  currentAccount: string,
  index: Map<string, { account: string; tx: Record<string, unknown> }>,
): { status: string; transactionCode?: string; account?: string; tx?: Record<string, unknown> };

export function computeIdUniqueness(rows: Array<Record<string, unknown>>): {
  totalRows: number;
  uniqueIds: number;
  duplicateIds: number;
  uniquePairs: number;
  duplicatePairs: number;
};

export function tallyByField(rows: Array<Record<string, unknown>>, field: string): Record<string, number>;

export interface DayAggregate {
  day: string;
  n: number;
  bruto: number;
  reembolsado: number;
  comision: number;
  liquido: number;
  pagadoSegunBase: number | null;
  linked: number;
  pendientes: number;
  payoutRefs: Array<{ date: string | null; reference: string | null }>;
}

export function aggregateByDay(
  transactions: Array<Record<string, unknown>>,
  linkedRowsByCode: Map<string, Array<Record<string, unknown>>>,
  basis: string,
): DayAggregate[];

export interface PayoutGroup {
  reference: string | null;
  date: string | null;
  montoPagado: number;
  comision: number;
  nTransacciones: number;
  typeTally: Record<string, number>;
  rowCount: number;
}

export function aggregateByPayout(rows: Array<Record<string, unknown>>): {
  payouts: PayoutGroup[];
  rowsInReview: Array<{ row: Record<string, unknown>; reason: string }>;
};

export function computeAccountTotals(dayAggregates: Array<Record<string, number>>): {
  bruto: number;
  reembolsado: number;
  comision: number;
  liquido: number;
  pctComisionEfectiva: number | null;
};

export function buildDepositsList(
  payoutGroups: Array<{ date: string | null; reference: string | null; montoPagado: number }>,
): Array<{ date: string | null; reference: string | null; montoNeto: number }>;
