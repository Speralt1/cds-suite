"use strict";

/**
 * functions/sumup/payouts-core.js
 *
 * Pure logic for SumUp payouts ingestion (Slice 3a — comisión y depósito).
 * No firebase-admin, no network, no Date.now() side effects beyond what is
 * passed in explicitly. Every function here is deterministic given its
 * inputs so it can be unit tested without emulators.
 *
 * This module is the CommonJS home of the logic G9's read-only probe
 * (scripts/sumup-payouts-probe.mjs) proved against real SumUp data before
 * this slice was authorized (docs/mission-2026/15-slice3a-sumup-fees-deposits-spec.md).
 * The probe script now imports the shared functions from here (via
 * createRequire) instead of duplicating them in scripts/lib/payouts-probe-core.mjs,
 * so there is exactly one implementation of the basis/linking/aggregation
 * rules Atlas approved.
 *
 * IMPORTANT — G1/G9 decisions (2026-09-23 / 2026-09-25):
 *   - The gross sale (ledgerAmount in core.js) is NEVER edited by this module.
 *   - The commission is recorded as a SEPARATE linked expense
 *     (financeTransactions/sumup_fee_{account}_{date}), computed here but
 *     written by functions/sumup/engine.js.
 *   - Comisión aún no conocida => "pendiente", nunca $0.
 */

const crypto = require("node:crypto");
const core = require("./core");

const PAYOUT_TYPE = "PAYOUT";
const DEDUCTION_TYPES = [
  "REFUND_DEDUCTION",
  "CHARGE_BACK_DEDUCTION",
  "DD_RETURN_DEDUCTION",
  "BALANCE_DEDUCTION",
];
const AMOUNT_TOLERANCE = 1; // CLP has no cents; SumUp/Firestore rounding can be off by 1.
const MIN_VOTES_FOR_BASIS = 3;

/**
 * maskApiKey — never let a real SumUp API key reach a log line or a report
 * file. Keeps only enough to eyeball "same key as before" without exposing
 * the secret.
 */
function maskApiKey(key) {
  const value = String(key || "");
  if (value.length === 0) return "(vacío)";
  if (value.length <= 6) return "*".repeat(value.length);
  const head = value.slice(0, 3);
  const tail = value.slice(-2);
  return `${head}${"*".repeat(Math.max(3, value.length - 5))}${tail} (len:${value.length})`;
}

/**
 * detectBasisVote — Atlas's rule for one PAYOUT-type row linked to exactly
 * one Firestore transaction.
 *
 *   G  = grossAmount (as imported)
 *   G' = grossAmount - refundedAmount (net of that transaction's own refunds)
 *
 * Votes:
 *   - "net"       if amount + fee ≈ G or ≈ G'
 *   - "gross"     if amount ≈ G or ≈ G' (and not already a net match)
 *   - "ambiguous" if fee === 0 (net and gross formulas coincide, no signal)
 *   - "mismatch"  if none of the above match within tolerance
 */
function detectBasisVote({ payoutAmount, payoutFee, gross, refunded }) {
  const amount = Number(payoutAmount || 0);
  const fee = Number(payoutFee || 0);
  const g = Number(gross || 0);
  const gPrime = Math.max(0, g - Number(refunded || 0));

  const detail = { amount, fee, gross: g, netOfRefunds: gPrime };

  if (fee === 0) {
    return { vote: "ambiguous", detail };
  }

  const netMatchesG = Math.abs(amount + fee - g) <= AMOUNT_TOLERANCE;
  const netMatchesGPrime = Math.abs(amount + fee - gPrime) <= AMOUNT_TOLERANCE;
  if (netMatchesG || netMatchesGPrime) {
    return { vote: "net", detail };
  }

  const grossMatchesG = Math.abs(amount - g) <= AMOUNT_TOLERANCE;
  const grossMatchesGPrime = Math.abs(amount - gPrime) <= AMOUNT_TOLERANCE;
  if (grossMatchesG || grossMatchesGPrime) {
    return { vote: "gross", detail };
  }

  return { vote: "mismatch", detail };
}

/**
 * aggregateBasisVotes — decide the account-wide basis only when the
 * evidence is unambiguous: at least MIN_VOTES_FOR_BASIS countable votes
 * (ambiguous votes don't count), no mismatch present, and no disagreement
 * between "net" and "gross" votes.
 */
function aggregateBasisVotes(votes) {
  const tally = { net: 0, gross: 0, ambiguous: 0, mismatch: 0 };
  for (const v of votes) {
    if (tally[v] === undefined) continue;
    tally[v] += 1;
  }
  const countable = tally.net + tally.gross + tally.mismatch;

  if (tally.mismatch > 0) {
    return { basis: "indeterminada", reason: "mismatch_presente", tally };
  }
  if (countable < MIN_VOTES_FOR_BASIS) {
    return { basis: "indeterminada", reason: "evidencia_insuficiente", tally };
  }
  if (tally.net > 0 && tally.gross > 0) {
    return { basis: "indeterminada", reason: "votos_en_desacuerdo", tally };
  }
  if (tally.net > 0) return { basis: "net", reason: null, tally };
  if (tally.gross > 0) return { basis: "gross", reason: null, tally };
  return { basis: "indeterminada", reason: "evidencia_insuficiente", tally };
}

/**
 * buildTransactionIndex — index every imported transaction by its
 * transaction_code, across ALL probed accounts, so a payout row that
 * references another account's transaction is detected as such instead of
 * silently reported as "not found".
 */
function buildTransactionIndex(transactionsByAccount) {
  const index = new Map();
  for (const [account, txs] of Object.entries(transactionsByAccount || {})) {
    for (const tx of txs || []) {
      const code = String(tx?.transactionCode || "");
      if (!code) continue;
      if (!index.has(code)) index.set(code, { account, tx });
    }
  }
  return index;
}

/**
 * linkPayoutRow — classifies one payout row against the transaction index
 * for the account currently being probed/ingested.
 */
function linkPayoutRow(row, currentAccount, index) {
  const code = String(row?.transaction_code || row?.transactionCode || "");
  if (!code) return { status: "no_code" };
  const hit = index.get(code);
  if (!hit) return { status: "not_found", transactionCode: code };
  if (hit.account !== currentAccount) {
    return { status: "other_account", transactionCode: code, account: hit.account };
  }
  return { status: "linked", transactionCode: code, tx: hit.tx };
}

/** computeIdUniqueness — id uniqueness is measured, never assumed. */
function computeIdUniqueness(rows) {
  const ids = new Set();
  const pairs = new Set();
  let duplicateIds = 0;
  let duplicatePairs = 0;
  for (const row of rows || []) {
    const id = String(row?.id ?? "");
    const pairKey = `${id}::${String(row?.transaction_code ?? row?.transactionCode ?? "")}`;
    if (ids.has(id)) duplicateIds += 1;
    ids.add(id);
    if (pairs.has(pairKey)) duplicatePairs += 1;
    pairs.add(pairKey);
  }
  return {
    totalRows: (rows || []).length,
    uniqueIds: ids.size,
    duplicateIds,
    uniquePairs: pairs.size,
    duplicatePairs,
  };
}

/** tallyByField — counts rows by an arbitrary field (type or status). */
function tallyByField(rows, field) {
  const out = {};
  for (const row of rows || []) {
    const key = String(row?.[field] ?? "(vacío)");
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/**
 * aggregateByDay — groups imported transactions by their day of sale
 * (`tx.localDate`, Chile time) and attaches whatever PAYOUT-type rows were
 * linked to each transaction's code.
 *
 * Ledger identity kept explicit: liquido = bruto - reembolsado - comision.
 */
function aggregateByDay(transactions, linkedRowsByCode, basis) {
  const days = new Map();

  for (const tx of transactions || []) {
    const day = String(tx?.localDate || "(sin fecha)");
    if (!days.has(day)) {
      days.set(day, {
        day,
        n: 0,
        bruto: 0,
        reembolsado: 0,
        comision: 0,
        pagadoSegunBase: 0,
        pagadoSegunBaseAplicable: basis === "net" || basis === "gross",
        linked: 0,
        pendientes: 0,
        payoutRefs: new Map(),
      });
    }
    const bucket = days.get(day);
    bucket.n += 1;
    bucket.bruto += Number(tx?.grossAmount || 0);
    bucket.reembolsado += Number(tx?.refundedAmount || 0);

    const rows = linkedRowsByCode.get(String(tx?.transactionCode || "")) || [];
    if (rows.length > 0) {
      bucket.linked += 1;
      for (const row of rows) {
        const fee = Number(row?.fee || 0);
        const amount = Number(row?.amount || 0);
        bucket.comision += fee;
        if (basis === "net") bucket.pagadoSegunBase += amount;
        else if (basis === "gross") bucket.pagadoSegunBase += amount - fee;
        const refKey = `${row?.date || ""}::${row?.reference || ""}`;
        bucket.payoutRefs.set(refKey, { date: row?.date || null, reference: row?.reference || null });
      }
    } else {
      bucket.pendientes += 1;
    }
  }

  return [...days.values()]
    .map((bucket) => ({
      day: bucket.day,
      n: bucket.n,
      bruto: bucket.bruto,
      reembolsado: bucket.reembolsado,
      comision: bucket.comision,
      liquido: bucket.bruto - bucket.reembolsado - bucket.comision,
      pagadoSegunBase: bucket.pagadoSegunBaseAplicable ? bucket.pagadoSegunBase : null,
      linked: bucket.linked,
      pendientes: bucket.pendientes,
      payoutRefs: [...bucket.payoutRefs.values()],
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * aggregateByPayout — groups ALL rows (PAYOUT + deduction types) by
 * reference when present, else by id, so a payout and the deductions that
 * shrank it stay together in the report.
 */
function aggregateByPayout(rows) {
  const groups = new Map();
  const rowsInReview = [];

  for (const row of rows || []) {
    const key = row?.reference ? `ref:${row.reference}` : `id:${row?.id ?? ""}`;
    if (!row?.reference) rowsInReview.push({ row, reason: "sin_reference" });
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        reference: row?.reference || null,
        date: row?.date || null,
        rows: [],
        montoPagado: 0,
        comision: 0,
        transactionCodes: new Set(),
        typeTally: {},
      });
    }
    const group = groups.get(key);
    group.rows.push(row);
    group.typeTally[row?.type] = (group.typeTally[row?.type] || 0) + 1;
    if (row?.type === PAYOUT_TYPE) group.montoPagado += Number(row?.amount || 0);
    group.comision += Number(row?.fee || 0);
    if (row?.transaction_code) group.transactionCodes.add(row.transaction_code);
    if (row?.date && (!group.date || row.date < group.date)) group.date = row.date;
  }

  const payouts = [...groups.values()]
    .map((g) => ({
      reference: g.reference,
      date: g.date,
      montoPagado: g.montoPagado,
      comision: g.comision,
      nTransacciones: g.transactionCodes.size,
      typeTally: g.typeTally,
      rowCount: g.rows.length,
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return { payouts, rowsInReview };
}

/** computeAccountTotals — sums the day-level aggregates into one row. */
function computeAccountTotals(dayAggregates) {
  const totals = (dayAggregates || []).reduce(
    (acc, d) => ({
      bruto: acc.bruto + d.bruto,
      reembolsado: acc.reembolsado + d.reembolsado,
      comision: acc.comision + d.comision,
      liquido: acc.liquido + d.liquido,
    }),
    { bruto: 0, reembolsado: 0, comision: 0, liquido: 0 },
  );
  const pctComisionEfectiva = totals.bruto > 0 ? (totals.comision / totals.bruto) * 100 : null;
  return { ...totals, pctComisionEfectiva };
}

/** buildDepositsList — groups that actually paid something out, sorted by date. */
function buildDepositsList(payoutGroups) {
  return (payoutGroups || [])
    .filter((g) => g.montoPagado > 0)
    .map((g) => ({ date: g.date, reference: g.reference, montoNeto: g.montoPagado }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// ---------------------------------------------------------------------------
// New for Slice 3a — write-path logic (raw row identity, review flags,
// per-transaction settlement, daily settlement aggregation).
// ---------------------------------------------------------------------------

/** buildPayoutDocId — stable identity for sumupPayouts/{docId} (see spec §Modelo de datos). */
function buildPayoutDocId({ account, type, id, transactionCode }) {
  return core.safeId(`${account}_${type}_${id}_${transactionCode || "none"}`);
}

/** isDeductionType — the four deduction row types that never create movements. */
function isDeductionType(type) {
  return DEDUCTION_TYPES.includes(String(type || ""));
}

/**
 * classifyPayoutRowReview — deduction rows and rows without a
 * transaction_code are flagged review:true (spec §Deducciones); they never
 * create financeTransactions movements, and they subtract from the deposit
 * reconciliation instead.
 */
function classifyPayoutRowReview(row) {
  const type = String(row?.type || "");
  const hasCode = !!String(row?.transaction_code || row?.transactionCode || "");
  if (isDeductionType(type)) {
    return { review: true, reviewReason: `deduction_${type.toLowerCase()}` };
  }
  if (!hasCode) {
    return { review: true, reviewReason: "no_transaction_code" };
  }
  return { review: false, reviewReason: null };
}

/** rawHashForRow — stable hash of the fields that matter for change detection. */
function rawHashForRow(normalized) {
  return core.snapshotHash({
    status: normalized.status,
    amount: normalized.amount,
    fee: normalized.fee,
    reference: normalized.reference,
    date: normalized.date,
    transactionCode: normalized.transactionCode,
  });
}

/**
 * normalizePayoutRow — turns one raw SumUp `/payouts` row into the shape
 * `sumupPayouts/{docId}` stores (spec §Modelo de datos). Deterministic and
 * side-effect free; firstSeenAt/lastSeenAt/runId are added by the caller
 * (functions/sumup/engine.js), which knows "now" and the current runId.
 */
function normalizePayoutRow(rawRow, { account, merchantCode }) {
  const type = String(rawRow?.type || "");
  const status = String(rawRow?.status || "");
  const id = String(rawRow?.id ?? "");
  const transactionCode = String(rawRow?.transaction_code || rawRow?.transactionCode || "");
  const amount = Math.round(Number(rawRow?.amount || 0));
  const fee = Math.round(Number(rawRow?.fee || 0));
  const review = classifyPayoutRowReview(rawRow);

  const normalized = {
    account,
    merchantCode: merchantCode || null,
    rowId: id,
    type,
    status,
    date: rawRow?.date || null,
    reference: rawRow?.reference || null,
    transactionCode,
    currency: String(rawRow?.currency || "CLP"),
    amountRaw: Number(rawRow?.amount || 0),
    feeRaw: Number(rawRow?.fee || 0),
    amount,
    fee,
    // "basis" is applied per-account once aggregateBasisVotes accepts one;
    // netPaid here is what THIS row actually paid (amount), independent of
    // basis — basis only changes how {amount, fee} combine into a
    // transaction's settlement (see computeTransactionSettlements).
    netPaid: amount,
    basis: null,
    review: review.review,
    reviewReason: review.reviewReason,
    raw: rawRow,
  };
  normalized.docId = buildPayoutDocId({ account, type, id, transactionCode });
  normalized.rawHash = rawHashForRow(normalized);
  return normalized;
}

/**
 * decidePayoutRowAction — idempotency rule for sumupPayouts/{docId}:
 * running the same window twice must not write anything the second time
 * (spec §Tests "Ejecutar dos veces no escribe nada"); if a row's rawHash
 * changed since it was first seen, a versions/ entry is added, never a
 * silent overwrite of history.
 */
function decidePayoutRowAction(existing, normalized) {
  if (!existing) return { action: "create" };
  if (existing.rawHash === normalized.rawHash) return { action: "unchanged" };
  return { action: "update" };
}

/**
 * computeTransactionSettlements — for every imported transaction, combines
 * whatever linked PAYOUT-type rows exist into the `settlement` map spec'd
 * for `sumupIntegrations/{a}/transactions/{txId}` (§Modelo de datos). Basis
 * must already be accepted ("net" | "gross") — callers must not invoke this
 * with "indeterminada" (the whole run stays needs_review instead, per spec
 * §Regla de base).
 *
 * @param {Array<{transactionCode, id}>} transactions
 * @param {Map<string, Array<object>>} linkedRowsByCode  normalized PAYOUT rows for this account, indexed by transaction_code
 * @param {"net"|"gross"} basis
 * @returns {Map<string, object>} transactionId -> settlement fields (only for linked transactions)
 */
function computeTransactionSettlements(transactions, linkedRowsByCode, basis) {
  const out = new Map();
  for (const tx of transactions || []) {
    const rows = linkedRowsByCode.get(String(tx?.transactionCode || "")) || [];
    if (rows.length === 0) continue;

    let feeAmount = 0;
    let netPaid = 0;
    const payoutRowIds = [];
    let payoutDate = null;
    let payoutReference = null;
    let payoutStatus = null;
    for (const row of rows) {
      feeAmount += Number(row.fee || 0);
      netPaid += basis === "net" ? Number(row.amount || 0) : Number(row.amount || 0) - Number(row.fee || 0);
      payoutRowIds.push(row.docId || row.rowId);
      if (!payoutDate || String(row.date || "") < payoutDate) payoutDate = row.date || null;
      if (!payoutReference) payoutReference = row.reference || null;
      payoutStatus = row.status || payoutStatus;
    }

    out.set(tx.id, {
      feeAmount,
      feeStatus: "provider",
      feeSource: "payouts",
      payoutRowIds,
      payoutDate,
      payoutReference,
      payoutStatus,
      netPaid,
      deductions: 0,
    });
  }
  return out;
}

/**
 * dailyLinkStatus — the day-level reconciliation state the UI shows (spec
 * §UI "Estados"): 'pending' (nothing linked yet), 'partial' (some but not
 * all of the day's sales have a payout), 'complete' (every sale of that day
 * is linked). "Con diferencia" / "Requiere revisión" are decided by the
 * caller against the actual bank deposit and review rows — this function
 * only reports linkage, not money differences.
 */
function dailyLinkStatus({ n, linked }) {
  if (linked <= 0) return "pending";
  if (linked >= n) return "complete";
  return "partial";
}

/**
 * buildDailySettlementAggregates — per day-of-sale × account rollup for
 * `sumupDailySettlement/{account}_{date}` (spec §Lectura desde el cliente,
 * "Recomendado"). Reuses aggregateByDay for the money math and adds the
 * fields the UI needs (linkStatus, references, feeCoverage).
 *
 * @param {Array} transactions   normalized local transactions for the account (this window)
 * @param {Map<string, Array>} linkedRowsByCode  normalized PAYOUT rows, indexed by transaction_code
 * @param {"net"|"gross"} basis
 */
function buildDailySettlementAggregates(account, transactions, linkedRowsByCode, basis) {
  const days = aggregateByDay(transactions, linkedRowsByCode, basis);
  return days.map((d) => ({
    account,
    date: d.day,
    bruto: d.bruto,
    reembolsado: d.reembolsado,
    comisionSumUp: d.comision,
    liquidoEsperado: d.liquido,
    // No payout linked yet for this day => "por depositar" (spec §UI): never
    // report $0 as if it were a confirmed deposit.
    depositado: d.linked > 0 ? d.pagadoSegunBase : null,
    references: d.payoutRefs,
    txCount: d.n,
    txLinked: d.linked,
    txPending: d.pendientes,
    linkStatus: dailyLinkStatus({ n: d.n, linked: d.linked }),
  }));
}

/**
 * computeDeductionsByPayoutDate — deduction-type rows (and orphan rows
 * without a transaction_code) don't map to a single sale, so they are
 * rolled up by the date SumUp posted them (their own `date`, not a sale
 * day) instead of being silently dropped (spec §Deducciones: "Restan en la
 * conciliación del depósito").
 */
function computeDeductionsByPayoutDate(rows) {
  const out = new Map();
  for (const row of rows || []) {
    if (!row?.review) continue;
    const date = String(row?.date || "(sin fecha)");
    if (!out.has(date)) out.set(date, { date, count: 0, totalAmount: 0, totalFee: 0, rowIds: [] });
    const bucket = out.get(date);
    bucket.count += 1;
    bucket.totalAmount += Number(row.amount || 0);
    bucket.totalFee += Number(row.fee || 0);
    bucket.rowIds.push(row.docId || row.rowId);
  }
  return out;
}

module.exports = {
  PAYOUT_TYPE,
  DEDUCTION_TYPES,
  AMOUNT_TOLERANCE,
  MIN_VOTES_FOR_BASIS,
  maskApiKey,
  detectBasisVote,
  aggregateBasisVotes,
  buildTransactionIndex,
  linkPayoutRow,
  computeIdUniqueness,
  tallyByField,
  aggregateByDay,
  aggregateByPayout,
  computeAccountTotals,
  buildDepositsList,
  buildPayoutDocId,
  isDeductionType,
  classifyPayoutRowReview,
  rawHashForRow,
  normalizePayoutRow,
  decidePayoutRowAction,
  computeTransactionSettlements,
  dailyLinkStatus,
  buildDailySettlementAggregates,
  computeDeductionsByPayoutDate,
};
