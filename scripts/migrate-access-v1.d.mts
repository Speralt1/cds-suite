// Tipos de scripts/migrate-access-v1.mjs (para los tests en TypeScript).
export declare const DEFAULT_EMULATOR_PROJECT: string;
export declare const DEFAULT_FIRESTORE_EMULATOR_HOST: string;
export declare const BATCH_LIMIT: number;
export declare const USAGE: string;
export declare class MigrationUsageError extends Error {}
export interface ParsedMigrationArgs {
  emulatorFlag: boolean;
  project: string | null;
  apply: boolean;
  confirm: string | null;
  pastorHome: string;
  only: string | null;
  json: string | null;
  summary: boolean;
  help: boolean;
  mode: "help" | "emulator" | "project";
  emulatorHost?: string | null;
  requiresTty?: boolean;
}
export interface MigrationRowLike {
  uid: string;
  displayName: string;
  emailMasked: string;
  oldRole: string | null;
  status: "migrate" | "skip_already_v1" | "skip_invalid_role";
  baseRole?: string;
  position?: string;
  permissions?: string[];
  effective?: string[];
  homeModule?: string;
  areaIds: string[];
  changes: Record<string, unknown>;
  warnings: string[];
}
export interface FieldDiff {
  field: string;
  before: string;
  after: string;
}
export declare function parseMigrationArgs(argv: string[], env?: Record<string, string | undefined>): ParsedMigrationArgs;
export declare function fieldDiff(row: MigrationRowLike, doc: Record<string, unknown>): FieldDiff[];
export declare function formatRow(row: MigrationRowLike, diff: FieldDiff[]): string;
export declare function summarize(rows: MigrationRowLike[]): {
  total: number;
  migrate: number;
  skip_already_v1: number;
  skip_invalid_role: number;
};
export interface AggregateReport {
  total: number;
  byStatus: { migrate: number; skip_already_v1: number; skip_invalid_role: number };
  byOldRole: Record<string, number>;
  active: number;
  inactive: number;
  byHomeModule: Record<string, number>;
  warnings: Record<string, number>;
  withoutModules: number;
  needsAreas: number;
  rollbackRisk: number;
  incoherent: number;
}
export declare function aggregateReport(entries: { row: MigrationRowLike; doc: Record<string, unknown> }[]): AggregateReport;
export declare function formatAggregate(report: AggregateReport): string;
export declare function runMigration(
  parsed: ParsedMigrationArgs,
  opts?: { log?: (line: string) => void },
): Promise<{
  rows: (MigrationRowLike & { diff: FieldDiff[] })[];
  summary: ReturnType<typeof summarize>;
  aggregate: AggregateReport;
  written: number;
  failed: { uid: string; reason: string }[];
}>;
