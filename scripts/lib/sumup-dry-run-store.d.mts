// Types for scripts/lib/sumup-dry-run-store.mjs (used by tests).
export interface DryRunReader {
  getIntegration(account: string): Promise<Record<string, unknown> | null>;
  getFinance(financeId: string): Promise<Record<string, unknown> | null>;
  getRaw(account: string, rawId: string): Promise<Record<string, unknown> | null>;
  getSummary(period: string): Promise<Record<string, unknown> | null>;
}
export function createDryRunStore(reader: DryRunReader): {
  store: {
    runLedgerTransaction<T>(
      ids: { account: string; rawId: string; financeId: string },
      workFn: (tx: never) => Promise<T>,
    ): Promise<T>;
    [key: string]: unknown;
  };
  log: {
    financeWrites: Array<{ account: string; financeId: string; before: Record<string, unknown> | null; after: Record<string, unknown> }>;
    rawWrites: Array<{ account: string; rawId: string; review: boolean; reviewReason: string | null }>;
    summaryWrites: Array<{ period: string }>;
    versions: Array<{ account: string; rawId: string; action: string; reason: string }>;
    adjustments: unknown[];
    runs: unknown[];
  };
  summaryChanges(): Array<{ period: string; before: Record<string, unknown> | null; after: Record<string, unknown> }>;
};
export function summaryFieldDelta(before: unknown, after: unknown): Record<string, unknown>;
