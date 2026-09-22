"use strict";

/**
 * functions/sumup/core.js
 *
 * Pure logic for SumUp sync (Slice 1 — reliability).
 * No firebase-admin, no network, no Date.now() side effects beyond what is
 * passed in explicitly. Every function here must be deterministic given its
 * inputs so it can be unit tested without emulators or mocks of Firestore.
 *
 * IMPORTANT (financial invariant, do not change without a Navigator/Atlas
 * decision — see docs/mission-2026/02-atlas-sumup-audit.md §7):
 *   ledgerAmount = max(0, gross - refunded)
 * `fee_amount` never arrives on /transactions/history today, so it is not
 * subtracted from the ledger amount. If it ever arrives, it is stored on the
 * raw doc as informational data (feeStatus:'provider') but the ledger amount
 * is NOT changed in this slice.
 */

const crypto = require("node:crypto");

const SUMUP_SPLIT_START_DATE = "2026-09-09";
const SUMUP_LEGACY_CATEGORY = "SumUp histórico sin separar";
const SUMUP_LIQUID_SCHEMA_VERSION = 2;
const SUMUP_AMOUNT_BASIS = "gross_minus_refunds";

const IGNORE_REASONS = ["nonPOS", "nonCLP", "nonPayment", "pending", "preSplit", "other"];

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
}

function datePartsChile(iso) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    date,
    dayKey: String(Number(day)),
    period: `${year}-${month}`,
    localDate: `${year}-${month}-${day}`,
  };
}

function ledgerAmount(gross, refunded) {
  const g = Math.max(0, Math.round(Number(gross || 0)));
  const r = Math.max(0, Math.round(Number(refunded || 0)));
  return Math.max(0, g - r);
}

function categoryFor(account, isLegacy) {
  if (isLegacy) return SUMUP_LEGACY_CATEGORY;
  return account === "offerings" ? "Ofrendas" : "Cafetería";
}

function descriptionFor(account, isLegacy) {
  if (isLegacy) return "Ingreso SumUp histórico · sin separación";
  return account === "offerings" ? "Ofrenda tarjeta física · SumUp" : "Venta Cafetería · SumUp";
}

/** Stable JSON stringify (sorted keys) so hashing does not depend on key order. */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function snapshotHash(fields) {
  return crypto.createHash("sha1").update(stableStringify(fields)).digest("hex");
}

/**
 * Turns a raw SumUp `/transactions/history` item into a normalized shape
 * with every field classifyItem needs, independent of account/context.
 */
function normalizeItem(item, account) {
  const id = String(item?.transaction_id || item?.id || "");
  const hasId = id.length > 0;
  const hasTimestamp = !!item?.timestamp;
  const timeParts = hasTimestamp ? datePartsChile(item.timestamp) : null;

  const gross = Math.max(0, Math.round(Number(item?.amount || 0)));
  const refunded = Math.max(0, Math.round(Number(item?.refunded_amount || 0)));
  const amount = ledgerAmount(gross, refunded);

  const feeProvided = item?.fee_amount !== undefined && item?.fee_amount !== null;
  const feeAmount = feeProvided ? Math.max(0, Math.round(Number(item.fee_amount || 0))) : null;
  const feeStatus = feeProvided ? "provider" : "unknown";

  const status = String(item?.status || "");
  const type = String(item?.type || "");
  const paymentType = String(item?.payment_type || "");
  const currency = String(item?.currency || "");

  const isChargeback = type === "CHARGE_BACK";
  const isPayment = type === "PAYMENT";
  const isPOS = paymentType === "POS";
  const isCLP = currency === "CLP";
  const isPending = status === "PENDING";

  const isLegacy = timeParts ? timeParts.localDate < SUMUP_SPLIT_START_DATE : false;
  const category = categoryFor(account, isLegacy);
  const description = descriptionFor(account, isLegacy);

  const providerSnapshot = {
    transactionId: id,
    transactionCode: item?.transaction_code || "",
    merchantCode: item?.merchant_code || "",
    status,
    type,
    paymentType,
    currency,
    grossAmount: gross,
    refundedAmount: refunded,
    amountAfterRefunds: amount,
    cardType: item?.card_type || "",
    entryMode: item?.entry_mode || "",
    user: item?.user || item?.username || "",
    productSummary: item?.product_summary || "",
    payoutDate: item?.payout_date || null,
    payoutType: item?.payout_type || null,
    payoutsTotal: item?.payouts_total ?? null,
    payoutsReceived: item?.payouts_received ?? null,
    payoutPlan: item?.payout_plan || null,
  };

  const hash = snapshotHash({
    status,
    amount,
    category,
    feeAmount,
    feeStatus,
    merchantCode: providerSnapshot.merchantCode,
    payoutDate: providerSnapshot.payoutDate,
    payoutType: providerSnapshot.payoutType,
    payoutsTotal: providerSnapshot.payoutsTotal,
    payoutsReceived: providerSnapshot.payoutsReceived,
    cardType: providerSnapshot.cardType,
    entryMode: providerSnapshot.entryMode,
    productSummary: providerSnapshot.productSummary,
    transactionCode: providerSnapshot.transactionCode,
  });

  return {
    id,
    hasId,
    hasTimestamp,
    timestamp: item?.timestamp || null,
    date: timeParts ? timeParts.date : null,
    dayKey: timeParts ? timeParts.dayKey : null,
    period: timeParts ? timeParts.period : null,
    localDate: timeParts ? timeParts.localDate : null,
    isLegacy,
    account,
    status,
    type,
    paymentType,
    currency,
    grossAmount: gross,
    refundedAmount: refunded,
    amount,
    feeAmount,
    feeStatus,
    category,
    description,
    isChargeback,
    isPayment,
    isPOS,
    isCLP,
    isPending,
    providerSnapshot,
    snapshotHash: hash,
  };
}

/**
 * classifyItem — the single source of truth for "what should happen to this
 * item", evaluated BEFORE any filtering (fixes R4/R5 from the audit: a
 * CANCELLED/FAILED or CHARGE_BACK item is inspected against the existing
 * ledger doc instead of being silently dropped).
 *
 * @param {object} normalized  output of normalizeItem
 * @param {{financeDoc: object|null, rawSnapshotHash: string|null}} existing
 * @param {{mode: 'main'|'sweep'|'legacy', splitStartDate?: string}} context
 * @returns {{action: string, reason?: string, ledgerEffect: boolean}}
 */
function classifyItem(normalized, existing, context) {
  const ctx = context || {};
  const mode = ctx.mode || "main";
  const splitStartDate = ctx.splitStartDate || SUMUP_SPLIT_START_DATE;
  const financeDoc = existing?.financeDoc || null;

  if (!normalized.hasId || !normalized.hasTimestamp) {
    return { action: "ignored", reason: "other", ledgerEffect: false };
  }

  if (normalized.isChargeback) {
    return { action: "review", reason: "chargeback", ledgerEffect: false };
  }

  if (!normalized.isPOS) return { action: "ignored", reason: "nonPOS", ledgerEffect: false };
  if (!normalized.isCLP) return { action: "ignored", reason: "nonCLP", ledgerEffect: false };
  if (!normalized.isPayment) return { action: "ignored", reason: "nonPayment", ledgerEffect: false };
  if (normalized.isPending) return { action: "ignored", reason: "pending", ledgerEffect: false };
  if (mode === "main" && normalized.localDate < splitStartDate) {
    return { action: "ignored", reason: "preSplit", ledgerEffect: false };
  }
  if (mode === "legacy" && normalized.localDate >= splitStartDate) {
    return { action: "ignored", reason: "other", ledgerEffect: false };
  }

  const isDegraded = normalized.status === "CANCELLED" || normalized.status === "FAILED";
  const isSettleable = normalized.status === "SUCCESSFUL" || normalized.status === "REFUNDED";

  if (isDegraded) {
    if (financeDoc && financeDoc.status === "active") {
      return { action: "review", reason: "status_downgraded", ledgerEffect: false };
    }
    return { action: "ignored", reason: "other", ledgerEffect: false };
  }

  if (!isSettleable) {
    return { action: "ignored", reason: "other", ledgerEffect: false };
  }

  const willBeActive = normalized.amount > 0;

  if (!financeDoc) {
    if (willBeActive) return { action: "create", reason: null, ledgerEffect: true };
    return { action: "ignored", reason: "other", ledgerEffect: false };
  }

  const editedByHuman = !!financeDoc.updatedBy && financeDoc.updatedBy !== "system:sumup";
  const voidedByHuman =
    financeDoc.status === "voided" && !!financeDoc.voidedBy && financeDoc.voidedBy !== "system:sumup";

  if (editedByHuman || voidedByHuman) {
    return {
      action: "review",
      reason: voidedByHuman ? "human_voided" : "human_edited",
      ledgerEffect: false,
    };
  }

  const wasActive = financeDoc.status === "active";

  if (wasActive && !willBeActive) {
    return { action: "void", reason: "refunded", ledgerEffect: true };
  }

  if (!wasActive && willBeActive) {
    return { action: "reactivate", reason: "system_reactivation", ledgerEffect: true };
  }

  if (wasActive && willBeActive) {
    const sameCategory = financeDoc.category === normalized.category;
    const sameDay = financeDoc.day === normalized.dayKey;
    const sameHash = existing?.rawSnapshotHash === normalized.snapshotHash;
    if (sameCategory && sameDay && sameHash) {
      return { action: "unchanged", reason: null, ledgerEffect: false };
    }
    return { action: "update", reason: "refunded_partial", ledgerEffect: true };
  }

  // !wasActive && !willBeActive: still voided/zero, nothing to do.
  return { action: "unchanged", reason: null, ledgerEffect: false };
}

/**
 * summaryDelta — pure equivalent of the delta math currently inlined in
 * functions/index.js (upsertSumUpTransaction, lines ~241-310). Given the
 * ledger state before and after, returns exactly the deltas to apply to a
 * financeMonthlySummaries doc.
 */
function summaryDelta(before, after) {
  const beforeActive = before?.active ? Number(before.amount || 0) : 0;
  const afterActive = after?.active ? Number(after.amount || 0) : 0;
  const countDelta = (after?.active ? 1 : 0) - (before?.active ? 1 : 0);
  const incomeTotalDelta = afterActive - beforeActive;

  const categoryDeltas = {};
  const dayDeltas = {};

  if (beforeActive > 0 && before?.category) {
    categoryDeltas[before.category] = (categoryDeltas[before.category] || 0) - beforeActive;
    dayDeltas[before.day] = (dayDeltas[before.day] || 0) - beforeActive;
  }
  if (afterActive > 0 && after?.category) {
    categoryDeltas[after.category] = (categoryDeltas[after.category] || 0) + afterActive;
    dayDeltas[after.day] = (dayDeltas[after.day] || 0) + afterActive;
  }

  return { incomeTotalDelta, countDelta, categoryDeltas, dayDeltas };
}

/** Applies summaryDelta output onto a (mutable-copy) summary map, matching current merge semantics. */
function applySummaryDelta(summary, delta) {
  const next = {
    incomeTotal: Number(summary?.incomeTotal || 0) + delta.incomeTotalDelta,
    expenseTotal: Number(summary?.expenseTotal || 0),
    transactionCount: Number(summary?.transactionCount || 0) + delta.countDelta,
    incomeByCategory: { ...(summary?.incomeByCategory || {}) },
    dailyIncome: { ...(summary?.dailyIncome || {}) },
  };
  next.result = next.incomeTotal - next.expenseTotal;

  for (const [key, value] of Object.entries(delta.categoryDeltas)) {
    next.incomeByCategory[key] = Number(next.incomeByCategory[key] || 0) + value;
  }
  for (const [key, value] of Object.entries(delta.dayDeltas)) {
    next.dailyIncome[key] = Number(next.dailyIncome[key] || 0) + value;
  }
  for (const key of Object.keys(next.incomeByCategory)) {
    if (next.incomeByCategory[key] === 0) delete next.incomeByCategory[key];
  }
  for (const key of Object.keys(next.dailyIncome)) {
    if (next.dailyIncome[key] === 0) delete next.dailyIncome[key];
  }
  return next;
}

/**
 * classifyHttpError — maps an HTTP status / thrown error into one of the
 * error classes the sync must react to.
 * @param {{status?: number, name?: string, code?: string, message?: string}} error
 */
function classifyHttpError(error) {
  const status = Number(error?.status || 0);
  const name = String(error?.name || "");
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  if (name === "AbortError" || code === "ABORT_ERR" || /aborted|timeout/i.test(message)) {
    return "provider_unavailable";
  }
  if (status === 401 || status === 403) return "auth_error";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status >= 400) return "provider_client_error";
  return "provider_unavailable";
}

module.exports = {
  SUMUP_SPLIT_START_DATE,
  SUMUP_LEGACY_CATEGORY,
  SUMUP_LIQUID_SCHEMA_VERSION,
  SUMUP_AMOUNT_BASIS,
  IGNORE_REASONS,
  safeId,
  datePartsChile,
  ledgerAmount,
  categoryFor,
  descriptionFor,
  snapshotHash,
  stableStringify,
  normalizeItem,
  classifyItem,
  summaryDelta,
  applySummaryDelta,
  classifyHttpError,
};
