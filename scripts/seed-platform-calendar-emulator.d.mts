// Tipos de scripts/seed-platform-calendar-emulator.mjs (para los tests en TypeScript).
export interface SeedUser {
  uid: string;
  email: string;
  displayName: string;
  note: string;
  doc: {
    role: "admin" | "pastor" | "finance" | "leader";
    active: boolean;
    baseRole?: "admin" | "standard";
    position?: string;
    permissions?: string[];
    areaIds?: string[];
    homeModule?: "finance" | "calendar";
  };
}
export interface SeedArea {
  id: string;
  name: string;
  color: string;
  description: string;
  active: boolean;
}
export interface SeedDoc {
  id: string;
  data: Record<string, unknown>;
}
export interface SeedEvent extends SeedDoc {
  changes: SeedDoc[];
}
export interface SeedData {
  users: { uid: string; data: Record<string, unknown> }[];
  areas: SeedDoc[];
  events: SeedEvent[];
}
export interface SeedResult {
  today: string;
  token: string;
  publicUrl: string;
  feedUrl: string;
  counts: { users: number; areas: number; events: number };
  finance: { created: number; skipped: number };
}
export interface FinanceSeedItem {
  id: string;
  input: {
    type: "income" | "expense";
    amount: number;
    date: string;
    category: string;
    paymentMethod: "cash" | "transfer" | "card" | "other";
    description: string;
    note: string;
  };
}
export declare const SEED_PROJECT: string;
export declare const SEED_FIRESTORE_HOST: string;
export declare const SEED_AUTH_HOST: string;
export declare const SEED_PASSWORD: string;
export declare const SEED_FUNCTIONS_ORIGIN: string;
export declare const SEED_REGION: string;
export declare const SEED_CANARIES: Readonly<{
  internalNote: string;
  exceptionReason: string;
  cancelReason: string;
  archiveReason: string;
  seriesReason: string;
}>;
export declare const ARCHIVED_TITLE: string;
export declare const SEED_FINANCE_UID: string;
export declare function buildFinanceSeed(today: string): FinanceSeedItem[];
export declare const SEED_USERS: readonly SeedUser[];
export declare const SEED_AREAS: readonly SeedArea[];
/** Espejo de AUDIT_IGNORED_FIELDS / AUDIT_VALUE_FIELDS de lib/calendar/audit.ts (prueba de paridad). */
export declare const SEED_AUDIT_IGNORED_FIELDS: readonly string[];
export declare const SEED_AUDIT_VALUE_FIELDS: readonly string[];
export declare function assertSeedEnvironment(env?: Record<string, string | undefined>): string;
export declare function buildSeedData(today: string, nowMs: number): SeedData;
export declare function publicUrlFor(token: string): string;
export declare function feedUrlFor(token: string): string;
export declare function runSeed(opts?: { env?: Record<string, string | undefined>; now?: number }): Promise<SeedResult>;
