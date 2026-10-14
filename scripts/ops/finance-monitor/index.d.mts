// Tipos de scripts/ops/finance-monitor/index.mjs (para los tests en TypeScript).
export type Level = "INFORMATIVO" | "REVISAR" | "STOP";
export type Verdict = "OK" | "REVISAR" | "STOP";
export declare const LEVELS: { readonly INFO: "INFORMATIVO"; readonly REVIEW: "REVISAR"; readonly STOP: "STOP" };

export interface LedgerRow {
  id: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  paymentMethod: string;
  period: string;
  day: string | number;
  source: "general" | "tithe";
  status: "active" | "voided";
  revision?: number;
  createdBy?: string;
  updatedBy?: string;
  createTime?: string;
  updateTime?: string;
  voidedAt?: string;
}
export interface Attribution { id: string; transactionId: string; profileId: string; amount?: number; status?: string }
export interface Profile { id: string; displayName: string; active?: boolean; createTime?: string }
export interface MonthSummary {
  incomeTotal?: number;
  expenseTotal?: number;
  result?: number;
  titheTotal?: number;
  transactionCount?: number;
  incomeByCategory?: Record<string, number>;
  expenseByCategory?: Record<string, number>;
  dailyIncome?: Record<string, number>;
  dailyExpense?: Record<string, number>;
}
export interface Baseline { takenAt: string; months: Record<string, MonthSummary>; year?: MonthSummary; ledger?: LedgerRow[] }
export interface PreviousSnapshot { takenAt: string; ledger: LedgerRow[] }
export interface SumupSale { transactionCode: string; account?: string; date: string; gross: number; refunded?: number; paymentType?: "POS" | "CASH"; status?: string }
export interface PayoutRow { id: string; account?: string; type?: string; transactionCode?: string; amount: number; fee?: number; deduction?: number; date?: string; status?: string; reference?: string }
export interface FeeExpense { id: string; payoutRowId: string; amount: number; status?: string }
export interface FeeProposal { id: string; payoutRowId: string; amount: number }
export interface SumupData { payoutAmountBasis?: string; sales?: SumupSale[]; payouts?: PayoutRow[]; feeExpenses?: FeeExpense[]; feeProposals?: FeeProposal[] }
export interface Snapshot {
  takenAt?: string;
  ledger: LedgerRow[];
  attributions?: Attribution[];
  profiles?: Profile[];
  summaries?: Record<string, MonthSummary>;
  baseline?: Baseline | null;
  previous?: PreviousSnapshot | null;
  sumup?: SumupData | null;
}
export interface Acknowledgement { code?: string; ids: string[]; note?: string }
export interface MonitorOptions {
  today?: string;
  since?: string;
  now?: string;
  timeZone?: string;
  backdate?: { maxLagDays?: number };
  payouts?: { pendingBusinessDays?: number; holidays?: string[] };
  profileSimilarityThreshold?: number;
  acknowledged?: Acknowledgement[];
}
export interface Finding {
  code: string;
  level: Level;
  message: string;
  evidence: Record<string, unknown>;
  refs: string[];
  detector?: string;
  acknowledged?: boolean;
}
export interface MonitorResult {
  findings: Finding[];
  verdict: Verdict;
  exitCode: 0 | 1 | 2;
  context: { today: string; since: string | null; takenAt: string | null } | null;
}
export declare const DETECTORS: ReadonlyArray<readonly [string, (ctx: unknown) => Finding[]]>;
export declare function runMonitor(snapshot: Snapshot | unknown, opts?: MonitorOptions): MonitorResult;
export declare function applyAcknowledgements(findings: Finding[], acknowledged?: Acknowledgement[]): Finding[];
export declare function verdictOf(findings: Finding[]): Verdict;
export declare function exitCodeOf(verdict: Verdict): 0 | 1 | 2;
export declare function publicFindings(findings: Finding[]): Omit<Finding, "refs">[];
export declare function formatReport(result: MonitorResult, meta?: { inputs?: string; timeZone?: string }): string;
