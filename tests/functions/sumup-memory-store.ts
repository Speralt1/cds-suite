// In-memory store adapter that satisfies the interface functions/sumup/engine.js
// expects (see functions/sumup/firestore-store.js for the real Firestore one).
// Not a Firestore emulator: transactions here are just synchronous function
// calls against plain Maps, which is enough because JS is single-threaded and
// none of these tests need cross-process atomicity — only the same
// read-before-write sequencing the engine relies on.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const core = require("../../functions/sumup/core.js");

export type FinanceDoc = Record<string, unknown> & {
  status?: string;
  amount?: number;
  category?: string;
  day?: string;
  revision?: number;
  updatedBy?: string;
  voidedBy?: string;
  createdBy?: string;
  createdAt?: unknown;
  period?: string;
};

export type RawDoc = Record<string, unknown> & { snapshotHash?: string };

export class MemoryStore {
  integrations = new Map<string, Record<string, unknown>>();
  finance = new Map<string, FinanceDoc>();
  raw = new Map<string, RawDoc>();
  summaries = new Map<string, Record<string, unknown>>();
  versions = new Map<string, unknown[]>();
  adjustments = new Map<string, unknown>();
  leases = new Map<string, { runId: string; expiresAtMs: number; trigger: string }>();
  runs = new Map<string, Record<string, unknown>>();
  payouts = new Map<string, Record<string, unknown>>();
  payoutVersions = new Map<string, unknown[]>();
  dailySettlements = new Map<string, Record<string, unknown>>();
  feeFinance = new Map<string, Record<string, unknown>>();
  feeVersions = new Map<string, unknown[]>();
  private runSeq = 0;

  async getIntegration(account: string) {
    return this.integrations.get(account) || null;
  }

  async setIntegration(account: string, patch: Record<string, unknown>) {
    const current = this.integrations.get(account) || {};
    this.integrations.set(account, { ...current, ...patch });
  }

  async getFinanceBatch(account: string, ids: string[]) {
    const map = new Map<string, FinanceDoc>();
    for (const id of ids) {
      const doc = this.finance.get(`sumup_${account}_${id}`);
      if (doc) map.set(id, doc);
    }
    return map;
  }

  async getRawBatch(account: string, ids: string[]) {
    const map = new Map<string, RawDoc>();
    for (const id of ids) {
      const doc = this.raw.get(`${account}/${id}`);
      if (doc) map.set(id, doc);
    }
    return map;
  }

  async acquireLease(account: string, { ttlMs, runId, now }: { ttlMs: number; runId: string; trigger: string; now: number }) {
    const current = this.leases.get(account);
    const expired = !current || current.expiresAtMs <= now;
    if (current && !expired) {
      return { acquired: false, existingRunId: current.runId };
    }
    if (current && expired) {
      const previousRun = this.runs.get(current.runId);
      if (previousRun && previousRun.status === "running") {
        this.runs.set(current.runId, { ...previousRun, status: "abandoned" });
      }
    }
    this.leases.set(account, { runId, expiresAtMs: now + ttlMs, trigger: "" });
    return { acquired: true };
  }

  async releaseLease(account: string, runId: string) {
    const current = this.leases.get(account);
    if (current && current.runId === runId) this.leases.delete(account);
  }

  async createRun(data: Record<string, unknown>) {
    this.runSeq += 1;
    const id = `run_${this.runSeq}`;
    this.runs.set(id, { id, ...data });
    return id;
  }

  async updateRun(runId: string, patch: Record<string, unknown>) {
    const current = this.runs.get(runId) || {};
    this.runs.set(runId, { ...current, ...patch });
  }

  async runLedgerTransaction(
    { account, rawId, financeId }: { account: string; rawId: string; financeId: string },
    workFn: (tx: {
      getFinance: () => Promise<FinanceDoc | null>;
      getRaw: () => Promise<RawDoc | null>;
      getSummary: (period: string) => Promise<Record<string, unknown> | null>;
      getAdjustment: () => Promise<Record<string, unknown> | null>;
      setFinance: (data: FinanceDoc) => void;
      setRaw: (data: RawDoc) => void;
      setSummary: (period: string, data: Record<string, unknown>, lastTransactionId: string) => void;
      setAdjustment: (data: Record<string, unknown>) => void;
      addVersion: (data: Record<string, unknown>) => void;
    }) => Promise<{ outcome: string } | void>,
  ) {
    const rawKey = `${account}/${rawId}`;
    const tx = {
      getFinance: async () => this.finance.get(financeId) || null,
      getRaw: async () => this.raw.get(rawKey) || null,
      getSummary: async (period: string) => this.summaries.get(period) || null,
      getAdjustment: async () => this.adjustments.get(rawKey) as Record<string, unknown> | null || null,
      // Firestore's set(..., {merge:true}) recursively merges nested map
      // fields instead of replacing them — a key our payload omits is left
      // untouched (not deleted). Emulating that here is what makes the B1
      // regression (a full-refund zeroing a category out of the JS object,
      // but the stale key surviving in Firestore) detectable by these tests.
      setFinance: (data: FinanceDoc) => this.finance.set(financeId, mergeDeep(this.finance.get(financeId) || {}, data)),
      setRaw: (data: RawDoc) => this.raw.set(rawKey, mergeDeep(this.raw.get(rawKey) || {}, data)),
      // setSummary is a deliberate FULL REPLACE (no merge) — see
      // functions/sumup/core.js applySummaryDelta and firestore-store.js.
      setSummary: (period: string, data: Record<string, unknown>, lastTransactionId: string) =>
        this.summaries.set(period, { ...data, lastTransactionId }),
      setAdjustment: (data: Record<string, unknown>) =>
        this.adjustments.set(rawKey, mergeDeep((this.adjustments.get(rawKey) as Record<string, unknown>) || {}, data)),
      addVersion: (data: Record<string, unknown>) => {
        const list = this.versions.get(rawKey) || [];
        list.push(data);
        this.versions.set(rawKey, list);
      },
    };
    return workFn(tx);
  }

  // -------------------------------------------------------------------
  // Slice 3a — payouts ingestion
  // -------------------------------------------------------------------

  /** Mirrors firestore-store.js getTransactionsInWindow: reads from the raw
   * transactions this store already holds (written by buildRawDoc via
   * runLedgerTransaction), computing localDate the same way core.js does. */
  async getTransactionsInWindow(account: string, { start, end }: { start: string; end: string }) {
    const out: Array<{ id: string; transactionCode: string; grossAmount: number; refundedAmount: number; status: string; localDate: string }> = [];
    for (const [key, doc] of this.raw.entries()) {
      if (!key.startsWith(`${account}/`)) continue;
      const rawId = key.slice(account.length + 1);
      const ts = doc.timestamp as Date | undefined;
      if (!ts) continue;
      const iso = ts instanceof Date ? ts.toISOString() : new Date(ts as unknown as string).toISOString();
      const parts = core.datePartsChile(iso);
      if (parts.localDate < start || parts.localDate > end) continue;
      out.push({
        id: rawId,
        transactionCode: String(doc.transactionCode || ""),
        grossAmount: Number(doc.grossAmount || 0),
        refundedAmount: Number(doc.refundedAmount || 0),
        status: String(doc.status || ""),
        localDate: parts.localDate,
      });
    }
    return out;
  }

  async getPayoutsBatch(docIds: string[]) {
    const map = new Map<string, Record<string, unknown>>();
    for (const id of docIds) {
      const doc = this.payouts.get(id);
      if (doc) map.set(id, doc);
    }
    return map;
  }

  async upsertPayoutRow({
    docId,
    normalized,
    existing,
    runId,
    now,
  }: {
    docId: string;
    normalized: Record<string, unknown>;
    existing: Record<string, unknown> | null;
    runId: string;
    now: number;
  }) {
    const patch: Record<string, unknown> = {
      account: normalized.account,
      merchantCode: normalized.merchantCode,
      rowId: normalized.rowId,
      type: normalized.type,
      status: normalized.status,
      date: normalized.date,
      reference: normalized.reference,
      transactionCode: normalized.transactionCode,
      currency: normalized.currency,
      amountRaw: normalized.amountRaw,
      feeRaw: normalized.feeRaw,
      amount: normalized.amount,
      fee: normalized.fee,
      netPaid: normalized.netPaid,
      basis: normalized.basis,
      raw: normalized.raw,
      rawHash: normalized.rawHash,
      lastSeenAt: now,
      runId,
      linkStatus: normalized.linkStatus || null,
      review: normalized.review,
      reviewReason: normalized.reviewReason,
    };
    if (!existing) {
      patch.firstSeenAt = now;
    } else {
      const list = this.payoutVersions.get(docId) || [];
      list.push({ previous: existing, rawHash: existing.rawHash || null, replacedAt: now, runId });
      this.payoutVersions.set(docId, list);
    }
    this.payouts.set(docId, mergeDeep(this.payouts.get(docId) || {}, patch));
  }

  async setSettlement(account: string, transactionId: string, settlement: Record<string, unknown>) {
    const rawKey = `${account}/${transactionId}`;
    const current = this.raw.get(rawKey) || {};
    this.raw.set(rawKey, mergeDeep(current, { settlement, settlementUpdatedAt: Date.now() }));
  }

  async setDailySettlement(account: string, date: string, data: Record<string, unknown>) {
    this.dailySettlements.set(`${account}_${date}`, { ...data, account, date, updatedAt: Date.now() });
  }

  async runFeeLedgerTransaction({
    account,
    date,
    period,
    day,
    amount,
    feeCoverage,
    now,
    runId,
  }: {
    account: string;
    date: string;
    period: string;
    day: string;
    amount: number;
    feeCoverage: Record<string, unknown> | null;
    now: number;
    runId: string;
  }) {
    const financeId = `sumup_fee_${account}_${date}`;
    const existing = this.feeFinance.get(financeId) || null;

    const category = date < core.SUMUP_SPLIT_START_DATE
      ? "Comisión SumUp · histórico sin separar"
      : account === "offerings"
        ? "Comisión SumUp · Ofrendas"
        : "Comisión SumUp · Cafetería";

    const before = existing
      ? { active: existing.status === "active", amount: Number(existing.amount || 0), category: existing.category, day: existing.day }
      : { active: false, amount: 0, category, day };
    const willBeActive = amount > 0;
    const after = willBeActive ? { active: true, amount, category, day } : { active: false, amount: 0, category: before.category, day: before.day };

    const delta = core.expenseSummaryDelta(before, after);
    const hasDelta = delta.expenseTotalDelta !== 0 || Object.keys(delta.categoryDeltas).length > 0 || Object.keys(delta.dayDeltas).length > 0;

    if (!existing && !willBeActive) return { outcome: "skipped" };

    if (hasDelta) {
      const summary = this.summaries.get(period) || null;
      this.summaries.set(period, { ...core.applyExpenseSummaryDelta(summary, delta), lastTransactionId: financeId });
    }

    const revision = Number(existing?.revision || 0) + 1;
    const financeDoc: Record<string, unknown> = {
      type: "expense",
      amount: willBeActive ? amount : 0,
      date,
      period,
      day,
      category,
      paymentMethod: "card",
      description: `Comisión SumUp · ${account === "offerings" ? "Ofrendas" : "Cafetería"}`,
      note: "",
      source: "general",
      status: willBeActive ? "active" : "voided",
      origin: "sumup_fee",
      area: account,
      feeCoverage: feeCoverage || null,
      revision,
      createdBy: (existing?.createdBy as string) || "system:sumup",
      createdAt: existing?.createdAt || now,
      updatedBy: "system:sumup",
      updatedAt: now,
      voidReason: willBeActive ? null : "Comisión recalculada a $0",
      voidedBy: willBeActive ? null : "system:sumup",
      voidedAt: willBeActive ? null : now,
    };
    this.feeFinance.set(financeId, financeDoc);

    if (existing && Number(existing.amount || 0) !== (willBeActive ? amount : 0)) {
      const list = this.feeVersions.get(financeId) || [];
      list.push({ action: willBeActive ? "recalculated" : "voided", before: existing, afterAmount: willBeActive ? amount : 0, runId, at: now });
      this.feeVersions.set(financeId, list);
    }

    return { outcome: existing ? "updated" : "created" };
  }
}

/** Emulates Firestore's recursive merge for set(..., {merge:true}): plain
 * nested objects are merged key by key; anything else (arrays, Dates,
 * primitives, `null`) replaces the previous value wholesale. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}
function mergeDeep<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergeDeep(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function makeClock(startMs: number) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
      return current;
    },
    set: (ms: number) => {
      current = ms;
    },
  };
}
