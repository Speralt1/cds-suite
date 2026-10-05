// Types for scripts/lib/sumup-cash-rollback-core.mjs (used by tests).
export const ROLLBACK_ACTOR: string;
export const ROLLBACK_REASON: string;
export const ROLLBACK_VOID_REASON: string;
export class RollbackAbort extends Error {}
export interface RollbackExpect {
  financeId: string;
  account: string;
  localDate: string;
  amount: number;
}
export function checkTarget(finance: Record<string, unknown> | null, expect: RollbackExpect): "rollback" | "already";
export function checkSummary(summary: Record<string, unknown> | null, finance: Record<string, unknown>): void;
export function rollbackWork(args: {
  core: unknown;
  expect: RollbackExpect;
  now: number;
}): (tx: unknown) => Promise<{ outcome: "rolledBack" | "already"; summaryBefore?: unknown; summaryAfter?: unknown }>;
