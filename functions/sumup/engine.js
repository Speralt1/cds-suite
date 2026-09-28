"use strict";

/**
 * functions/sumup/engine.js
 *
 * Orchestration for a single account's SumUp sync run. Every dependency is
 * injected (fetchPage, store, clock) so this file can run against an
 * in-memory store in tests and against Firestore in production
 * (functions/sumup/firestore-store.js).
 *
 * See docs/mission-2026/02-atlas-sumup-audit.md §7 (S1.1-S1.13) for the spec
 * this implements, plus two rounds of Atlas review (B1, M1-M8, MINOR).
 */

const core = require("./core");

const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const DEFAULT_PAGE_LIMIT_MAIN = 100;
const DEFAULT_PAGE_LIMIT_LEGACY = 100;
// M5 — never start a page fetch unless there's at least a 15s fetch timeout
// plus a 5s safety margin left before the deadline.
const PAGE_START_MARGIN_MS = 15_000 + 5_000;

function emptyCounts() {
  return {
    fetched: 0,
    created: 0,
    updated: 0,
    voided: 0,
    reactivated: 0,
    unchanged: 0,
    review: 0,
    chargebacks: 0,
    rawRefreshed: 0,
    ignored: { nonPOS: 0, nonCLP: 0, nonPayment: 0, pending: 0, preSplit: 0, other: 0 },
  };
}

/** Strips characters that could ever render as markup, so lastError is always plain text (never HTML) in the UI. */
function sanitizeErrorMessage(message) {
  return String(message || "").replace(/[<>]/g, "").slice(0, 500);
}

/** M8 — fields components/finance/offerings/offerings-page.tsx and lib/offerings/client.ts read for the account status pill. */
function uiCompatPatch({ account, config, status, errorMessage, now }) {
  return {
    account,
    label: account === "offerings" ? "Ofrendas" : "Cafetería",
    configured: !!(config?.apiKey && config?.merchantCode),
    merchantCode: config?.merchantCode || null,
    lastSyncAt: now,
    lastSyncStatus: status === "failed" ? "error" : status === "partial" ? "partial" : "ok",
    lastError: status === "failed" ? sanitizeErrorMessage(errorMessage) : "",
  };
}

function pushSample(run, id) {
  if (!run.sampleIds) run.sampleIds = [];
  if (run.sampleIds.length < 20 && id) run.sampleIds.push(id);
}

function buildRawDoc(normalized, previousRaw, extra) {
  return {
    account: normalized.account,
    transactionId: normalized.id,
    transactionCode: normalized.providerSnapshot.transactionCode,
    grossAmount: normalized.grossAmount,
    refundedAmount: normalized.refundedAmount,
    amountAfterRefunds: normalized.amount,
    feeAmount: normalized.feeAmount,
    feeStatus: normalized.feeStatus,
    amountBasis: core.SUMUP_AMOUNT_BASIS,
    // Kept for backward compatibility with existing UI reads.
    liquidAmount: normalized.amount,
    netAmount: normalized.amount,
    currency: normalized.currency,
    timestamp: normalized.date,
    status: normalized.status,
    paymentType: normalized.paymentType,
    cardType: normalized.providerSnapshot.cardType,
    entryMode: normalized.providerSnapshot.entryMode,
    user: normalized.providerSnapshot.user,
    productSummary: normalized.providerSnapshot.productSummary,
    providerSnapshot: normalized.providerSnapshot,
    snapshotHash: normalized.snapshotHash,
    financeTransactionId: `sumup_${normalized.account}_${core.safeId(normalized.id)}`,
    review: false,
    reviewReason: null,
    ...extra,
  };
}

function mapCountKey(action) {
  if (action === "create") return "created";
  if (action === "update") return "updated";
  if (action === "void") return "voided";
  if (action === "reactivate") return "reactivated";
  return null;
}

/**
 * Applies one classifyItem decision. Counters are incremented AFTER the
 * transaction resolves (never inside the callback), because Firestore
 * retries a transaction callback on contention — counting inside it would
 * double-count on a retry (Slice 1 review, MINOR).
 */
async function applyLedgerDecision({ account, normalized, decision, store, runId, now, counts }) {
  const rawId = core.safeId(normalized.id);
  const financeId = `sumup_${account}_${rawId}`;

  if (decision.action === "ignored") {
    counts.ignored[decision.reason] = (counts.ignored[decision.reason] || 0) + 1;
    return;
  }
  if (decision.action === "unchanged") {
    counts.unchanged += 1;
    return;
  }

  if (decision.action === "rawRefresh") {
    await store.runLedgerTransaction({ account, rawId, financeId }, async (tx) => {
      const previousRaw = await tx.getRaw();
      tx.setRaw(buildRawDoc(normalized, previousRaw, { review: false, reviewReason: null, runId, syncedAt: now }));
    });
    counts.rawRefreshed = (counts.rawRefreshed || 0) + 1;
    return;
  }

  if (decision.action === "review") {
    await store.runLedgerTransaction({ account, rawId, financeId }, async (tx) => {
      const previousRaw = await tx.getRaw();
      const existingAdjustment = decision.reason === "chargeback" ? await tx.getAdjustment() : null;
      tx.setRaw(
        buildRawDoc(normalized, previousRaw, {
          review: true,
          reviewReason: decision.reason,
          runId,
          syncedAt: now,
        }),
      );
      if (decision.reason === "chargeback") {
        tx.setAdjustment({
          type: "chargeback",
          account,
          transactionId: normalized.id,
          amount: normalized.grossAmount,
          currency: normalized.currency,
          status: normalized.status,
          reviewRequired: true,
          runId,
          detectedAt: now,
          firstDetectedAt: existingAdjustment?.firstDetectedAt || now,
        });
      }
    });
    counts.review += 1;
    if (decision.reason === "chargeback") counts.chargebacks += 1;
    return;
  }

  // create | update | void | reactivate
  const countKey = mapCountKey(decision.action);
  const outcome = await store.runLedgerTransaction({ account, rawId, financeId }, async (tx) => {
    const freshFinance = await tx.getFinance();
    const previousRaw = await tx.getRaw();

    // Re-validate the human-edit guard inside the transaction for race safety.
    const editedByHuman = !!freshFinance?.updatedBy && freshFinance.updatedBy !== "system:sumup";
    const voidedByHuman =
      freshFinance?.status === "voided" && !!freshFinance?.voidedBy && freshFinance.voidedBy !== "system:sumup";
    if (editedByHuman || voidedByHuman) {
      tx.setRaw(
        buildRawDoc(normalized, previousRaw, {
          review: true,
          reviewReason: voidedByHuman ? "human_voided" : "human_edited",
          runId,
          syncedAt: now,
        }),
      );
      return { outcome: "review" };
    }

    const willBeActive = decision.action !== "void";
    const before = freshFinance
      ? {
          active: freshFinance.status === "active",
          amount: Number(freshFinance.amount || 0),
          category: freshFinance.category || normalized.category,
          day: freshFinance.day || normalized.dayKey,
        }
      : { active: false, amount: 0, category: normalized.category, day: normalized.dayKey };
    const after = willBeActive
      ? { active: true, amount: normalized.amount, category: normalized.category, day: normalized.dayKey }
      : { active: false, amount: 0, category: before.category, day: before.day };

    const delta = core.summaryDelta(before, after);
    const hasDelta =
      delta.incomeTotalDelta !== 0 ||
      delta.countDelta !== 0 ||
      Object.keys(delta.categoryDeltas).length > 0 ||
      Object.keys(delta.dayDeltas).length > 0;

    if (hasDelta) {
      const summary = await tx.getSummary(normalized.period);
      tx.setSummary(normalized.period, core.applySummaryDelta(summary, delta), financeId);
    }

    if (willBeActive) {
      tx.setFinance({
        type: "income",
        amount: normalized.amount,
        date: normalized.date,
        period: normalized.period,
        day: normalized.dayKey,
        category: normalized.category,
        paymentMethod: "card",
        description: normalized.description,
        note: `SumUp ${normalized.providerSnapshot.transactionCode || normalized.id}`,
        source: "general",
        status: "active",
        revision: Number(freshFinance?.revision || 0) + 1,
        createdBy: freshFinance?.createdBy || "system:sumup",
        createdAt: freshFinance?.createdAt || now,
        updatedBy: "system:sumup",
        updatedAt: now,
        // void* is cleared on reactivation.
        voidReason: null,
        voidedBy: null,
        voidedAt: null,
      });
    } else if (freshFinance) {
      tx.setFinance({
        ...freshFinance,
        status: "voided",
        revision: Number(freshFinance.revision || 0) + 1,
        updatedBy: "system:sumup",
        updatedAt: now,
        voidReason: "Pago reembolsado en SumUp",
        voidedBy: "system:sumup",
        voidedAt: now,
      });
    }

    tx.setRaw(buildRawDoc(normalized, previousRaw, { review: false, reviewReason: null, runId, syncedAt: now }));

    if (decision.action !== "create") {
      tx.addVersion({
        action: decision.action,
        reason: decision.reason,
        before: freshFinance || null,
        afterAmount: normalized.amount,
        afterCategory: normalized.category,
        runId,
        at: now,
      });
    }

    return { outcome: "applied" };
  });

  if (outcome?.outcome === "review") counts.review += 1;
  else counts[countKey] += 1;
}

/**
 * Runs one account's SumUp sync (incremental, or a full 45-day sweep).
 *
 * @param {object} opts
 * @param {string} opts.account            'offerings' | 'cafeteria'
 * @param {{apiKey?: string, merchantCode?: string}} opts.config
 * @param {string} [opts.otherMerchantCode] the sibling account's merchantCode, for the collision guard
 * @param {'manual'|'scheduled'|'sweep'} opts.trigger
 * @param {string} opts.requestedBy
 * @param {number} [opts.deadlineAt]       absolute clock.now() deadline (M5). Takes priority over budgetMs.
 * @param {number} [opts.budgetMs]         wall-clock budget for this run, relative to start (used when deadlineAt is not given)
 * @param {number} [opts.leaseTtlMs]
 * @param {(params: {config, changesSince, order, limit, cursor}) => Promise<{items: any[], nextCursor: string|null}>} opts.fetchPage
 * @param {object} opts.store              see functions/sumup/firestore-store.js for the shape
 * @param {{now: () => number}} opts.clock
 * @param {boolean} [opts.sweep]           full 45-day sweep: its own cursor field (sweepCursor) and preSplit filtering apply (M6)
 * @param {string} [opts.splitStartDate]
 */
async function runAccountSync(opts) {
  const {
    account,
    config,
    otherMerchantCode,
    trigger,
    requestedBy,
    deadlineAt,
    budgetMs = Infinity,
    leaseTtlMs = trigger === "manual" ? 60_000 : 9 * 60_000,
    fetchPage,
    store,
    clock,
    sweep = false,
    splitStartDate = core.SUMUP_SPLIT_START_DATE,
    pageLimit = sweep ? DEFAULT_PAGE_LIMIT_LEGACY : DEFAULT_PAGE_LIMIT_MAIN,
  } = opts;

  const startedAt = clock.now();
  const deadline = Number.isFinite(deadlineAt) ? deadlineAt : Number.isFinite(budgetMs) ? startedAt + budgetMs : Infinity;
  // M6 — the sweep never shares its resumption cursor with the incremental sync.
  const cursorField = sweep ? "sweepCursor" : "pendingCursor";

  let runId;
  let lease;
  try {
    runId = await store.createRun({
      account,
      provider: "sumup",
      merchantCode: config?.merchantCode || null,
      trigger,
      requestedBy: requestedBy || "system",
      status: "running",
      startedAt,
    });
    lease = await store.acquireLease(account, { ttlMs: leaseTtlMs, runId, trigger, now: startedAt });
  } catch (error) {
    // createRun/acquireLease itself failed (e.g. Firestore outage) — nothing
    // was leased, so there is nothing to release; just report it.
    const errorClass = error.errorClass || core.classifyHttpError(error);
    return {
      account,
      runId: runId || null,
      status: "failed",
      counts: emptyCounts(),
      errorClass,
      errorMessage: String(error.message || error),
    };
  }

  if (!lease.acquired) {
    const status = trigger === "manual" ? "already_running" : "skipped_locked";
    await store.updateRun(runId, { status, finishedAt: startedAt, durationMs: 0 });
    return { account, runId: lease.existingRunId || runId, status, counts: emptyCounts(), errorClass: null };
  }

  const counts = emptyCounts();
  const runMeta = { sampleIds: [] };

  try {
    if (!config?.apiKey || !config?.merchantCode) {
      const err = new Error("Configuración SumUp incompleta.");
      err.errorClass = "config_error";
      throw err;
    }
    if (otherMerchantCode && config.merchantCode === otherMerchantCode) {
      const err = new Error("Mismo merchant configurado en ambas cuentas de SumUp.");
      err.errorClass = "config_error";
      throw err;
    }

    const integration = (await store.getIntegration(account)) || {};
    const now = startedAt;
    const watermarkMs = integration.watermark ? new Date(integration.watermark).getTime() : now - FORTY_FIVE_DAYS_MS;

    function changesSinceFromWatermark() {
      return sweep
        ? new Date(now - FORTY_FIVE_DAYS_MS).toISOString()
        : new Date(watermarkMs - FIFTEEN_MINUTES_MS).toISOString();
    }

    let changesSince = changesSinceFromWatermark();
    let cursor =
      typeof integration[cursorField] === "string" && integration[cursorField] ? integration[cursorField] : null;

    let latestTimestampMs = watermarkMs;
    let pages = 0;
    let partial = false;
    let retriedFromWatermark = false;
    const cursorIn = cursor;

    pageLoop: while (true) {
      // M5 — never start a page unless there's enough budget left for a
      // 15s fetch plus a 5s safety margin.
      if (deadline - clock.now() < PAGE_START_MARGIN_MS) {
        partial = true;
        break;
      }

      let page;
      try {
        page = await fetchPage({ config, changesSince, order: "ascending", limit: pageLimit, cursor });
      } catch (err) {
        const errorClass = err.errorClass || core.classifyHttpError(err);

        // M7 — a client error against a RESUMED cursor likely means the
        // cursor itself is stale/invalid. Reset it and retry once from the
        // watermark (or from now-45d for a sweep) before giving up.
        if (errorClass === "provider_client_error" && cursor && !retriedFromWatermark) {
          retriedFromWatermark = true;
          cursor = null;
          changesSince = changesSinceFromWatermark();
          continue pageLoop;
        }

        const errorMessage = String(err.message || err);
        await store.setIntegration(account, {
          lastErrorClass: errorClass,
          // A cursor that already failed once (M7 retry path) must not be retried forever.
          ...(retriedFromWatermark ? { [cursorField]: "" } : {}),
          ...uiCompatPatch({ account, config, status: "failed", errorMessage, now: clock.now() }),
        });
        await store.updateRun(runId, {
          status: "failed",
          finishedAt: clock.now(),
          durationMs: clock.now() - startedAt,
          counts,
          errorClass,
          errorMessage,
          httpStatus: err.status || null,
          sampleIds: runMeta.sampleIds,
          window: { changesSince, cursorIn, cursorOut: cursor },
          pages,
        });
        await store.releaseLease(account, runId);
        return { account, runId, status: "failed", counts, errorClass, errorMessage };
      }

      pages += 1;
      const items = Array.isArray(page.items) ? page.items : [];
      counts.fetched += items.length;

      const normalizedItems = items.map((item) => core.normalizeItem(item, account));
      const ids = normalizedItems.filter((n) => n.hasId).map((n) => core.safeId(n.id));
      const financeMap = await store.getFinanceBatch(account, ids);
      const rawMap = await store.getRawBatch(account, ids);

      for (const normalized of normalizedItems) {
        // M5 — also check the deadline mid-page. `cursor` still holds the
        // value used to fetch the CURRENT page, so breaking here and
        // persisting it makes the next run reprocess this same page
        // (idempotent) instead of skipping whatever we didn't reach yet.
        if (clock.now() >= deadline) {
          partial = true;
          break pageLoop;
        }

        if (normalized.hasTimestamp) {
          const ts = new Date(normalized.timestamp).getTime();
          if (!Number.isNaN(ts) && ts > latestTimestampMs) latestTimestampMs = ts;
        }

        const rawId = normalized.hasId ? core.safeId(normalized.id) : null;
        const providerMerchant = normalized.providerSnapshot.merchantCode;
        if (rawId && providerMerchant && config.merchantCode && providerMerchant !== config.merchantCode) {
          counts.ignored.other += 1;
          pushSample(runMeta, normalized.id);
          continue;
        }

        const existing = {
          financeDoc: rawId ? financeMap.get(rawId) || null : null,
          rawSnapshotHash: rawId ? rawMap.get(rawId)?.snapshotHash || null : null,
        };
        const decision = core.classifyItem(normalized, existing, {
          mode: sweep ? "sweep" : "main",
          splitStartDate,
        });

        if (decision.action === "ignored" || decision.action === "review") {
          pushSample(runMeta, normalized.id);
        }

        // eslint-disable-next-line no-await-in-loop
        await applyLedgerDecision({ account, normalized, decision, store, runId, now, counts });
      }

      cursor = page.nextCursor || null;
      if (!cursor) break;
    }

    let status;
    if (partial) {
      status = "partial";
      await store.setIntegration(account, {
        [cursorField]: cursor || "",
        ...uiCompatPatch({ account, config, status: "partial", now: clock.now() }),
      });
    } else {
      status = "completed";
      const patch = {
        lastErrorClass: null,
        lastSuccessfulSyncAt: clock.now(),
        lastRunId: runId,
        [cursorField]: "",
        ...uiCompatPatch({ account, config, status: "completed", now: clock.now() }),
      };
      if (!sweep) {
        patch.watermark = new Date(latestTimestampMs).toISOString();
      } else {
        patch.lastSweepAt = clock.now();
      }
      await store.setIntegration(account, patch);
    }

    await store.updateRun(runId, {
      status,
      finishedAt: clock.now(),
      durationMs: clock.now() - startedAt,
      counts,
      errorClass: null,
      sampleIds: runMeta.sampleIds,
      window: { changesSince, cursorIn, cursorOut: cursor || "" },
      pages,
    });
    await store.releaseLease(account, runId);

    return { account, runId, status, counts, errorClass: null };
  } catch (error) {
    const errorClass = error.errorClass || "provider_unavailable";
    const errorMessage = String(error.message || error);
    await store.setIntegration(account, {
      lastErrorClass: errorClass,
      ...uiCompatPatch({ account, config, status: "failed", errorMessage, now: clock.now() }),
    });
    await store.updateRun(runId, {
      status: "failed",
      finishedAt: clock.now(),
      durationMs: clock.now() - startedAt,
      counts,
      errorClass,
      errorMessage,
      sampleIds: runMeta.sampleIds,
      window: { cursorOut: "" },
      pages: 0,
    });
    return { account, runId, status: "failed", counts, errorClass, errorMessage };
  } finally {
    // MINOR — always release, whatever path was taken above (the two
    // explicit releaseLease calls in the try body are kept so the lease is
    // freed as early as possible; this is the safety net for anything else).
    if (runId) {
      await store.releaseLease(account, runId);
    }
  }
}

/**
 * runLegacyPage — the pre-Slice-1 backfill for `offerings`' history before
 * 2026-09-09. Reuses core.js for classification/ledger math and gains a run
 * record, a lease and the human-edited guard, but keeps the EXACT field
 * names and two-phase (backfill / liquid-recalculation) state machine the
 * original functions/index.js `syncLegacyPage` used, so it resumes correctly
 * from whatever `sumupIntegrations/offerings` already holds in production
 * (Slice 1 review M2).
 */
async function runLegacyPage({ account, config, requestedBy, fetchPage, store, clock, leaseTtlMs = 9 * 60_000 }) {
  const startedAt = clock.now();

  // Cheap short-circuit BEFORE creating a run or taking a lease: once fully
  // backfilled and on the current liquid schema, there is nothing to do and
  // no run doc should be created every hour for it (Slice 1 review MINOR).
  const preCheckIntegration = (await store.getIntegration(account)) || {};
  const preCheckLiquidVersion = Number(preCheckIntegration.liquidSchemaVersion || 1);
  if (preCheckIntegration.historyBackfilledAt && preCheckLiquidVersion >= core.SUMUP_LIQUID_SCHEMA_VERSION) {
    return { account, runId: null, status: "completed", counts: emptyCounts(), errorClass: null };
  }

  let runId;
  let lease;
  const leaseKey = `${account}__legacy`;
  try {
    runId = await store.createRun({
      account,
      provider: "sumup",
      merchantCode: config?.merchantCode || null,
      trigger: "legacy",
      requestedBy: requestedBy || "system",
      status: "running",
      startedAt,
    });
    lease = await store.acquireLease(leaseKey, { ttlMs: leaseTtlMs, runId, trigger: "legacy", now: startedAt });
  } catch (error) {
    return {
      account,
      runId: runId || null,
      status: "failed",
      counts: emptyCounts(),
      errorClass: error.errorClass || core.classifyHttpError(error),
      errorMessage: String(error.message || error),
    };
  }

  if (!lease.acquired) {
    await store.updateRun(runId, { status: "skipped_locked", finishedAt: startedAt, durationMs: 0 });
    return { account, runId, status: "skipped_locked", counts: emptyCounts(), errorClass: null };
  }

  const counts = emptyCounts();
  const runMeta = { sampleIds: [] };

  try {
    const integration = (await store.getIntegration(account)) || {};
    const liquidSchemaVersion = Number(integration.liquidSchemaVersion || 1);
    const recalculatingLiquid = liquidSchemaVersion < core.SUMUP_LIQUID_SCHEMA_VERSION;
    const cursorField = recalculatingLiquid ? "liquidMigrationCursor" : "historyCursor";
    const cursorIn = typeof integration[cursorField] === "string" && integration[cursorField] ? integration[cursorField] : null;

    let page;
    try {
      page = await fetchPage({ config, changesSince: null, order: "descending", limit: 100, cursor: cursorIn });
    } catch (err) {
      const errorClass = err.errorClass || core.classifyHttpError(err);
      await store.updateRun(runId, {
        status: "failed",
        finishedAt: clock.now(),
        durationMs: clock.now() - startedAt,
        counts,
        errorClass,
        errorMessage: String(err.message || err),
      });
      return { account, runId, status: "failed", counts, errorClass, errorMessage: String(err.message || err) };
    }

    const items = Array.isArray(page.items) ? page.items : [];
    counts.fetched += items.length;

    const normalizedItems = items.map((item) => core.normalizeItem(item, account));
    const ids = normalizedItems.filter((n) => n.hasId).map((n) => core.safeId(n.id));
    const financeMap = await store.getFinanceBatch(account, ids);
    const rawMap = await store.getRawBatch(account, ids);

    let reviewed = 0;
    for (const normalized of normalizedItems) {
      const rawId = normalized.hasId ? core.safeId(normalized.id) : null;
      const existing = {
        financeDoc: rawId ? financeMap.get(rawId) || null : null,
        rawSnapshotHash: rawId ? rawMap.get(rawId)?.snapshotHash || null : null,
      };
      const decision = core.classifyItem(normalized, existing, { mode: "legacy" });
      if (decision.action !== "ignored") reviewed += 1;
      if (decision.action === "ignored" || decision.action === "review") pushSample(runMeta, normalized.id);
      // eslint-disable-next-line no-await-in-loop
      await applyLedgerDecision({ account, normalized, decision, store, runId, now: startedAt, counts });
    }

    const nextUrl = page.nextCursor || null;
    const status = nextUrl ? "partial" : "completed";

    if (recalculatingLiquid) {
      const processed = Number(integration.liquidMigrationProcessed || 0) + reviewed;
      if (!nextUrl) {
        await store.setIntegration(account, {
          liquidMigrationCursor: "",
          liquidMigrationStatus: "completed",
          liquidMigrationProcessed: processed,
          liquidMigrationCompletedAt: clock.now(),
          liquidSchemaVersion: core.SUMUP_LIQUID_SCHEMA_VERSION,
          historyBackfilledAt: integration.historyBackfilledAt || clock.now(),
          historyBackfillStatus: "completed",
        });
      } else {
        await store.setIntegration(account, {
          liquidMigrationCursor: nextUrl,
          liquidMigrationStatus: "processing",
          liquidMigrationProcessed: processed,
          liquidMigrationStartedAt: integration.liquidMigrationStartedAt || clock.now(),
        });
      }
    } else {
      const totalProcessed = Number(integration.historyBackfillProcessed || 0) + reviewed;
      if (!nextUrl) {
        await store.setIntegration(account, {
          historyCursor: "",
          historyBackfillStatus: "completed",
          historyBackfillProcessed: totalProcessed,
          historyBackfilledAt: clock.now(),
          liquidSchemaVersion: core.SUMUP_LIQUID_SCHEMA_VERSION,
        });
      } else {
        await store.setIntegration(account, {
          historyCursor: nextUrl,
          historyBackfillStatus: "processing",
          historyBackfillProcessed: totalProcessed,
          historyBackfillStartedAt: integration.historyBackfillStartedAt || clock.now(),
        });
      }
    }

    await store.updateRun(runId, {
      status,
      finishedAt: clock.now(),
      durationMs: clock.now() - startedAt,
      counts,
      errorClass: null,
      sampleIds: runMeta.sampleIds,
      window: { cursorIn: cursorIn || "", cursorOut: nextUrl || "" },
      pages: 1,
    });

    return { account, runId, status, counts, errorClass: null };
  } catch (error) {
    const errorClass = error.errorClass || "provider_unavailable";
    await store.updateRun(runId, {
      status: "failed",
      finishedAt: clock.now(),
      durationMs: clock.now() - startedAt,
      counts,
      errorClass,
      errorMessage: String(error.message || error),
      window: { cursorOut: "" },
      pages: 0,
    });
    return { account, runId, status: "failed", counts, errorClass, errorMessage: String(error.message || error) };
  } finally {
    if (runId) {
      await store.releaseLease(leaseKey, runId);
    }
  }
}

module.exports = {
  runAccountSync,
  runLegacyPage,
  applyLedgerDecision,
  emptyCounts,
};
