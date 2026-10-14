// Tipos de scripts/ops/finance-monitor/lib/util.mjs (para los tests en TypeScript).
export declare function normalizeName(raw: unknown): string;
export declare function identityKey(raw: unknown): string;
export declare function nameSimilarity(a: unknown, b: unknown): number;
export declare function localDate(iso: string, timeZone?: string): string;
export declare function businessDaysBetween(from: string, to: string, holidays?: string[]): number;
export declare function daysBetween(a: string, b: string): number;
export declare function clp(n: number): string;
export declare function shortId(id: string): string;
export declare function aggregateLedger(rows: ReadonlyArray<Record<string, unknown>>): {
  incomeTotal: number;
  expenseTotal: number;
  result: number;
  titheTotal: number;
  transactionCount: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  dailyIncome: Record<string, number>;
  dailyExpense: Record<string, number>;
};
