/**
 * scripts/lib/sumup-dry-run-store.mjs
 *
 * A store adapter for functions/sumup/engine.js that READS through to a
 * `reader` (production Firestore, read-only) and keeps every WRITE in an
 * in-memory overlay that is never flushed anywhere. Later reads in the same
 * run see the overlay, so the simulation behaves exactly like one real engine
 * run (idempotency, summary accumulation) without touching production.
 *
 * This is what lets the CASH backfill dry-run reuse the production engine
 * itself instead of a second, parallel accounting implementation.
 *
 * reader: {
 *   getIntegration(account) -> object|null
 *   getFinance(financeId)   -> object|null
 *   getRaw(account, rawId)  -> object|null
 *   getSummary(period)      -> object|null
 * }
 */

export function createDryRunStore(reader) {
  const overlay = {
    integrations: new Map(),
    finance: new Map(),
    raw: new Map(),
    summaries: new Map(),
  };
  const baseline = { finance: new Map(), summaries: new Map() };
  const log = { financeWrites: [], rawWrites: [], summaryWrites: [], versions: [], adjustments: [], runs: [] };
  let runSeq = 0;

  async function readFinance(financeId) {
    if (overlay.finance.has(financeId)) return overlay.finance.get(financeId);
    if (!baseline.finance.has(financeId)) baseline.finance.set(financeId, (await reader.getFinance(financeId)) || null);
    return baseline.finance.get(financeId);
  }
  async function readRaw(account, rawId) {
    const key = `${account}/${rawId}`;
    if (overlay.raw.has(key)) return overlay.raw.get(key);
    return (await reader.getRaw(account, rawId)) || null;
  }
  async function readSummary(period) {
    if (overlay.summaries.has(period)) return overlay.summaries.get(period);
    if (!baseline.summaries.has(period)) baseline.summaries.set(period, (await reader.getSummary(period)) || null);
    return baseline.summaries.get(period);
  }

  const store = {
    async getIntegration(account) {
      if (overlay.integrations.has(account)) return overlay.integrations.get(account);
      return (await reader.getIntegration(account)) || null;
    },
    async setIntegration(account, patch) {
      const current = (await store.getIntegration(account)) || {};
      overlay.integrations.set(account, { ...current, ...patch });
    },
    async getFinanceBatch(account, ids) {
      const map = new Map();
      for (const id of ids) {
        const doc = await readFinance(`sumup_${account}_${id}`);
        if (doc) map.set(id, doc);
      }
      return map;
    },
    async getRawBatch(account, ids) {
      const map = new Map();
      for (const id of ids) {
        const doc = await readRaw(account, id);
        if (doc) map.set(id, doc);
      }
      return map;
    },
    // Leases and runs are simulated: the dry-run never contends with, nor
    // blocks, the real scheduler.
    async acquireLease() {
      return { acquired: true };
    },
    async releaseLease() {},
    async createRun(data) {
      runSeq += 1;
      const id = `dryrun_${runSeq}`;
      log.runs.push({ id, ...data });
      return id;
    },
    async updateRun(runId, patch) {
      const run = log.runs.find((r) => r.id === runId);
      if (run) Object.assign(run, patch);
    },
    async runLedgerTransaction({ account, rawId, financeId }, workFn) {
      const rawKey = `${account}/${rawId}`;
      const tx = {
        getFinance: () => readFinance(financeId),
        getRaw: () => readRaw(account, rawId),
        getSummary: (period) => readSummary(period),
        async getAdjustment() {
          return null;
        },
        setFinance(data) {
          const before = overlay.finance.has(financeId) ? overlay.finance.get(financeId) : baseline.finance.get(financeId) || null;
          const after = { ...(before || {}), ...data };
          overlay.finance.set(financeId, after);
          log.financeWrites.push({ account, financeId, before, after });
        },
        setRaw(data) {
          overlay.raw.set(rawKey, { ...(overlay.raw.get(rawKey) || {}), ...data });
          log.rawWrites.push({ account, rawId, review: !!data.review, reviewReason: data.reviewReason || null });
        },
        setSummary(period, data) {
          overlay.summaries.set(period, data);
          log.summaryWrites.push({ period });
        },
        setAdjustment(data) {
          log.adjustments.push({ account, rawId, type: data.type });
        },
        addVersion(data) {
          log.versions.push({ account, rawId, action: data.action, reason: data.reason });
        },
      };
      return workFn(tx);
    },
  };

  return {
    store,
    log,
    /** Summary per period before (production) and after (simulated). */
    summaryChanges() {
      return [...overlay.summaries.keys()].sort().map((period) => ({
        period,
        before: baseline.summaries.get(period) || null,
        after: overlay.summaries.get(period),
      }));
    },
  };
}

const SUMMARY_SCALARS = ["incomeTotal", "expenseTotal", "result", "titheTotal", "transactionCount"];
const SUMMARY_MAPS = ["incomeByCategory", "expenseByCategory", "dailyIncome", "dailyExpense"];

/** Field-by-field delta between two 9-field monthly summaries (only non-zero entries). */
export function summaryFieldDelta(before, after) {
  const b = before || {};
  const a = after || {};
  const out = {};
  for (const key of SUMMARY_SCALARS) {
    const d = Number(a[key] || 0) - Number(b[key] || 0);
    if (d !== 0) out[key] = d;
  }
  for (const key of SUMMARY_MAPS) {
    const keys = new Set([...Object.keys(b[key] || {}), ...Object.keys(a[key] || {})]);
    const m = {};
    for (const k of keys) {
      const d = Number((a[key] || {})[k] || 0) - Number((b[key] || {})[k] || 0);
      if (d !== 0) m[k] = d;
    }
    if (Object.keys(m).length) out[key] = m;
  }
  return out;
}
