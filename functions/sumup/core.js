"use strict";

/**
 * functions/sumup/core.js
 *
 * Pure logic for SumUp sync (Slice 1 — reliability).
 * No firebase-admin, no network, no Date.now() side effects beyond what is
 * passed in explicitly. Every function here must be deterministic given its
 * inputs so it can be unit tested without emulators or mocks of Firestore.
 *
 * IMPORTANT — financial invariant approved in G1 on 2026-09-23:
 *   ledgerAmount = max(0, gross - refunded)
 * The SumUp sale stays gross (net of refunds) in the ledger. Provider fees are
 * not subtracted from the sale. When payout/detail ingestion is implemented,
 * the real commission will be recorded as a linked expense so the system can
 * reconstruct gross - refunds - fees = expected net deposit.
 * `fee_amount` is preserved on the raw document whenever the provider supplies
 * it, but it does not mutate the sale amount.
 *
 * SumUp CASH Intake V1 (docs/mission-2026/22-sumup-cash-2026-10-04-audit.md):
 * from SUMUP_CASH_START_DATE on, cash recorded in the SumUp app
 * (`payment_type === "CASH"`) is a legitimate SumUp income booked with
 * `paymentMethod: "cash"`. CASH dated before that day never reaches the
 * ledger in any mode (main, sweep or legacy) — it is ignored as
 * `preCashStart`, because before 2026-10-04 that cash was (or should have
 * been) registered manually. POS keeps its exact previous behavior.
 */

const crypto = require("node:crypto");

const SUMUP_SPLIT_START_DATE = "2026-09-09";
// First local (America/Santiago) day on which SumUp CASH becomes a ledger source.
const SUMUP_CASH_START_DATE = "2026-10-04";
const SUMUP_LEGACY_CATEGORY = "SumUp histórico sin separar";
const SUMUP_LIQUID_SCHEMA_VERSION = 2;
const SUMUP_AMOUNT_BASIS = "gross_minus_refunds";

// `nonPOS` keeps its historical key (counters, runs, UI) but now means
// "payment type not supported": anything that is neither POS nor CASH.
const IGNORE_REASONS = ["nonPOS", "nonCLP", "nonPayment", "pending", "preSplit", "preCashStart", "other"];

// provider payment_type -> ledger paymentMethod. Only these two ever reach the ledger.
const LEDGER_PAYMENT_METHOD = { POS: "card", CASH: "cash" };

function ledgerPaymentMethodFor(paymentType) {
  return LEDGER_PAYMENT_METHOD[paymentType] || null;
}

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

function descriptionFor(account, isLegacy, paymentMethod = "card") {
  if (isLegacy) return "Ingreso SumUp histórico · sin separación";
  if (paymentMethod === "cash") {
    return account === "offerings" ? "Ofrenda efectivo · SumUp" : "Venta Cafetería efectivo · SumUp";
  }
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
  const simplePaymentType = item?.simple_payment_type ? String(item.simple_payment_type) : "";
  const paymentMethod = ledgerPaymentMethodFor(paymentType);
  const currency = String(item?.currency || "");

  const isChargeback = type === "CHARGE_BACK";
  const isPayment = type === "PAYMENT";
  const isPOS = paymentType === "POS";
  const isCash = paymentType === "CASH";
  const isSupportedPaymentType = paymentMethod !== null;
  const isCLP = currency === "CLP";
  const isPending = status === "PENDING";

  const isLegacy = timeParts ? timeParts.localDate < SUMUP_SPLIT_START_DATE : false;
  const category = categoryFor(account, isLegacy);
  const description = descriptionFor(account, isLegacy, paymentMethod || "card");

  const providerSnapshot = {
    transactionId: id,
    transactionCode: item?.transaction_code || "",
    merchantCode: item?.merchant_code || "",
    status,
    type,
    paymentType,
    simplePaymentType,
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
    // The payment type is ledger-relevant truth (POS -> card, CASH -> cash),
    // so a provider POS <-> CASH change must never be invisible to the hash.
    // It is only included when it is not POS: every hash already stored for a
    // POS item stays byte-identical (no mass rawRefresh on deploy), while any
    // move away from POS — or back to it — changes the hash.
    ...(paymentType !== "POS" ? { paymentType, simplePaymentType } : {}),
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
    simplePaymentType,
    paymentMethod,
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
    isCash,
    isSupportedPaymentType,
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
 * @param {{mode: 'main'|'sweep'|'legacy', splitStartDate?: string, cashStartDate?: string}} context
 * @returns {{action: string, reason?: string, ledgerEffect: boolean}}
 */
function classifyItem(normalized, existing, context) {
  const ctx = context || {};
  const mode = ctx.mode || "main";
  const splitStartDate = ctx.splitStartDate || SUMUP_SPLIT_START_DATE;
  const cashStartDate = ctx.cashStartDate || SUMUP_CASH_START_DATE;
  const financeDoc = existing?.financeDoc || null;

  if (!normalized.hasId || !normalized.hasTimestamp) {
    return { action: "ignored", reason: "other", ledgerEffect: false };
  }

  if (normalized.isChargeback) {
    return { action: "review", reason: "chargeback", ledgerEffect: false };
  }

  if (!normalized.isSupportedPaymentType) return { action: "ignored", reason: "nonPOS", ledgerEffect: false };
  if (!normalized.isCLP) return { action: "ignored", reason: "nonCLP", ledgerEffect: false };
  if (!normalized.isPayment) return { action: "ignored", reason: "nonPayment", ledgerEffect: false };
  if (normalized.isPending) return { action: "ignored", reason: "pending", ledgerEffect: false };
  // BLOCKER guard (CASH Intake V1): CASH before the operational start date
  // never has a ledger effect, in ANY mode — incremental, 45-day sweep or
  // legacy backfill. If a ledger doc somehow already exists for it (it can
  // only have been booked as card), a human decides: never auto-convert.
  if (normalized.isCash && normalized.localDate < cashStartDate) {
    if (financeDoc && financeDoc.status === "active") {
      return { action: "review", reason: "payment_method_changed", ledgerEffect: false };
    }
    return { action: "ignored", reason: "preCashStart", ledgerEffect: false };
  }
  if ((mode === "main" || mode === "sweep") && normalized.localDate < splitStartDate) {
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
    return { action: "void", reason: "refund_total", ledgerEffect: true };
  }

  if (!wasActive && willBeActive) {
    return { action: "reactivate", reason: "reactivate", ledgerEffect: true };
  }

  if (wasActive && willBeActive) {
    // Ledger changes are decided ONLY by what the book actually shows
    // (amount/category/day/paymentMethod). A snapshotHash difference caused
    // by metadata that never reaches the ledger (payout_*, card_type, etc.)
    // must not bump revision or write a version — it only refreshes the raw doc.
    const sameAmount = Number(financeDoc.amount || 0) === normalized.amount;
    const sameCategory = financeDoc.category === normalized.category;
    const sameDay = financeDoc.day === normalized.dayKey;
    // Every SumUp ledger doc written before CASH Intake V1 is card.
    const samePaymentMethod = (financeDoc.paymentMethod || "card") === normalized.paymentMethod;
    const sameHash = existing?.rawSnapshotHash === normalized.snapshotHash;

    if (sameAmount && sameCategory && sameDay && samePaymentMethod) {
      if (sameHash) return { action: "unchanged", reason: null, ledgerEffect: false };
      return { action: "rawRefresh", reason: null, ledgerEffect: false };
    }

    // A payment-method-only change (POS <-> CASH) is applied and versioned
    // with its own reason; its summary delta is monetarily zero because the
    // monthly summary does not split income by payment method.
    const reason = !sameAmount ? "refund_partial" : !sameCategory || !sameDay ? "reclassify" : "payment_method_changed";
    return { action: "update", reason, ledgerEffect: true };
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

/** The 9 fields a financeMonthlySummaries doc always has (see firestore.rules validSummary). */
function emptySummary() {
  return {
    incomeTotal: 0,
    expenseTotal: 0,
    result: 0,
    titheTotal: 0,
    transactionCount: 0,
    incomeByCategory: {},
    expenseByCategory: {},
    dailyIncome: {},
    dailyExpense: {},
  };
}

/**
 * Applies summaryDelta output onto a summary doc and returns the FULL 9-field
 * document. Callers MUST write this with a plain (non-merge) set — Firestore's
 * merge:true recursively merges nested maps, so a category/day key we delete
 * locally (because its total hit zero) would silently survive in Firestore
 * under merge:true, since merge never deletes a key just because our payload
 * omits it (BLOCKER B1 / M1 in the Slice 1 review).
 */
function applySummaryDelta(summary, delta) {
  const base = { ...emptySummary(), ...(summary || {}) };
  const next = {
    ...base,
    incomeTotal: Number(base.incomeTotal || 0) + delta.incomeTotalDelta,
    transactionCount: Number(base.transactionCount || 0) + delta.countDelta,
    incomeByCategory: { ...(base.incomeByCategory || {}) },
    dailyIncome: { ...(base.dailyIncome || {}) },
  };
  next.result = next.incomeTotal - Number(next.expenseTotal || 0);

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
  SUMUP_CASH_START_DATE,
  LEDGER_PAYMENT_METHOD,
  ledgerPaymentMethodFor,
  SUMUP_LEGACY_CATEGORY,
  SUMUP_LIQUID_SCHEMA_VERSION,
  SUMUP_AMOUNT_BASIS,
  IGNORE_REASONS,
  emptySummary,
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
