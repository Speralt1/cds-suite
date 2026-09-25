/**
 * scripts/lib/payouts-probe-core.mjs
 *
 * Pure logic for the G9 SumUp payouts probe (read-only investigation).
 * No network, no firebase-admin, no filesystem, no Date.now() side effects —
 * every function here is deterministic given its inputs so it can be unit
 * tested with mock data (see tests/sumup-payouts-probe.test.ts).
 *
 * This module does NOT decide any accounting rule for the ledger. It only
 * helps a human (Salvador) read what SumUp's payouts endpoint actually
 * returns, so G9 can answer "is `amount` net or gross?" and "does a payout
 * row map 1:1 to an imported transaction?" before any write-path work
 * (Slice 3a) is authorized.
 */

const PAYOUT_TYPE = "PAYOUT";
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
 *
 * @param {{payoutAmount:number, payoutFee:number, gross:number, refunded:number}} input
 * @returns {{vote: "net"|"gross"|"ambiguous"|"mismatch", detail: object}}
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
 *
 * @param {Array<"net"|"gross"|"ambiguous"|"mismatch">} votes
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
 *
 * @param {Record<string, Array<{transactionCode:string}>>} transactionsByAccount
 * @returns {Map<string, {account:string, tx:object}>}
 */
function buildTransactionIndex(transactionsByAccount) {
  const index = new Map();
  for (const [account, txs] of Object.entries(transactionsByAccount || {})) {
    for (const tx of txs || []) {
      const code = String(tx?.transactionCode || "");
      if (!code) continue;
      // First writer wins; a code repeated across accounts would itself be
      // worth a review, but that is outside the scope of this probe.
      if (!index.has(code)) index.set(code, { account, tx });
    }
  }
  return index;
}

/**
 * linkPayoutRow — classifies one payout row against the transaction index
 * for the account currently being probed.
 *
 * @param {{transaction_code?: string}} row
 * @param {string} currentAccount
 * @param {Map<string, {account:string, tx:object}>} index
 */
function linkPayoutRow(row, currentAccount, index) {
  const code = String(row?.transaction_code || "");
  if (!code) return { status: "no_code" };
  const hit = index.get(code);
  if (!hit) return { status: "not_found", transactionCode: code };
  if (hit.account !== currentAccount) {
    return { status: "other_account", transactionCode: code, account: hit.account };
  }
  return { status: "linked", transactionCode: code, tx: hit.tx };
}

/**
 * computeIdUniqueness — id uniqueness is unconfirmed per the spec; measure
 * it instead of assuming it.
 *
 * @param {Array<{id?: string, transaction_code?: string}>} rows
 */
function computeIdUniqueness(rows) {
  const ids = new Set();
  const pairs = new Set();
  let duplicateIds = 0;
  let duplicatePairs = 0;
  for (const row of rows || []) {
    const id = String(row?.id ?? "");
    const pairKey = `${id}::${String(row?.transaction_code ?? "")}`;
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

/**
 * tallyByField — small helper: counts rows by an arbitrary field (type or
 * status), used for the "n filas por type/status" table.
 */
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
 * (`tx.localDate`, already computed upstream in Chile time) and attaches
 * whatever PAYOUT-type rows were linked to each transaction's code.
 *
 * Ledger identity kept explicit: liquido = bruto - reembolsado - comision.
 * "pagadoSegunBase" is a cross-check computed independently from the
 * detected basis, not used to derive liquido.
 *
 * @param {Array<{transactionCode:string, grossAmount:number, refundedAmount:number, localDate:string}>} transactions
 * @param {Map<string, Array<object>>} linkedRowsByCode  PAYOUT-type rows for THIS account, indexed by transaction_code
 * @param {"net"|"gross"|"indeterminada"} basis
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
        payoutRefs: new Map(), // key: date::reference
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
 *
 * @param {Array<{id, type, amount, fee, date, reference, transaction_code}>} rows
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
    // Keep the earliest date seen for the group as its representative date.
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

/**
 * computeAccountTotals — sums the day-level aggregates into one row per
 * account for the "totales de septiembre" table.
 *
 * @param {Array<{bruto:number, reembolsado:number, comision:number, liquido:number}>} dayAggregates
 */
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

/**
 * buildDepositsList — the "para validar contra el banco" list: only groups
 * that actually paid something out (montoPagado > 0), sorted by date, so
 * Salvador can tick them off against his bank statement one by one.
 *
 * @param {Array<{reference, date, montoPagado}>} payoutGroups
 */
function buildDepositsList(payoutGroups) {
  return (payoutGroups || [])
    .filter((g) => g.montoPagado > 0)
    .map((g) => ({ date: g.date, reference: g.reference, montoNeto: g.montoPagado }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export {
  PAYOUT_TYPE,
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
};
