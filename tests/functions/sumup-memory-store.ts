// In-memory store adapter that satisfies the interface functions/sumup/engine.js
// expects (see functions/sumup/firestore-store.js for the real Firestore one).
// Not a Firestore emulator: transactions here are just synchronous function
// calls against plain Maps, which is enough because JS is single-threaded and
// none of these tests need cross-process atomicity — only the same
// read-before-write sequencing the engine relies on.

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
      setFinance: (data: FinanceDoc) => void;
      setRaw: (data: RawDoc) => void;
      setSummary: (period: string, data: Record<string, unknown>, lastTransactionId: string) => void;
      setAdjustment: (data: Record<string, unknown>) => void;
      addVersion: (data: Record<string, unknown>) => void;
    }) => Promise<void>,
  ) {
    const rawKey = `${account}/${rawId}`;
    const tx = {
      getFinance: async () => this.finance.get(financeId) || null,
      getRaw: async () => this.raw.get(rawKey) || null,
      getSummary: async (period: string) => this.summaries.get(period) || null,
      setFinance: (data: FinanceDoc) => this.finance.set(financeId, data),
      setRaw: (data: RawDoc) => this.raw.set(rawKey, data),
      setSummary: (period: string, data: Record<string, unknown>, lastTransactionId: string) =>
        this.summaries.set(period, { ...data, lastTransactionId }),
      setAdjustment: (data: Record<string, unknown>) => this.adjustments.set(rawKey, data),
      addVersion: (data: Record<string, unknown>) => {
        const list = this.versions.get(rawKey) || [];
        list.push(data);
        this.versions.set(rawKey, list);
      },
    };
    return workFn(tx);
  }
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
