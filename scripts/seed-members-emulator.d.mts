// Tipos de scripts/seed-members-emulator.mjs (para los tests en TypeScript).
export interface MembersSeedDoc {
  id: string;
  data: Record<string, unknown>;
}
export interface MembersSeed {
  today: string;
  people: MembersSeedDoc[];
  visits: MembersSeedDoc[];
  followUps: MembersSeedDoc[];
  changes: MembersSeedDoc[];
  /** personId → qué caso de la revisión de UX cubre. */
  notes: Record<string, string>;
}
export declare const SEED_MEMBERS_ACTOR: string;
export declare const SEED_MEMBERS_STALE_OWNERS: readonly string[];
export declare const SEED_MEMBERS_EVENT_ID: string;
export declare function buildMembersSeed(opts: {
  nowMs: number;
  users: { uid: string; data: Record<string, unknown> }[];
  events: { id: string; data: Record<string, unknown> }[];
}): Promise<MembersSeed>;
export declare function seededPersonIds(): string[];
export declare function seedMembers(opts: {
  db: unknown;
  nowMs: number;
  users: { uid: string; data: Record<string, unknown> }[];
  events: { id: string; data: Record<string, unknown> }[];
}): Promise<{ people: number; visits: number; followUps: number; changes: number }>;
