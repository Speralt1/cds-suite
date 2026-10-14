// GENERADO por scripts/build-shared.mjs desde lib/shared/sumup-payouts.ts — NO EDITAR.
"use strict";
// Conciliación de abonos SumUp (payouts) — lógica PURA, solo lectura.
// Doc: docs/mission-2026/29-sumup-payouts-reconciliation.md
//
// Se compila a functions/shared/sumup-payouts.js (scripts/build-shared.mjs) y
// la usan el callable `sumupPayoutsReconciliation` y la UI. Sin I/O, sin
// Date.now(): todo depende de lo que entra.
//
// Invariantes (G1/G9 + Slice 1b):
//   - El ingreso bruto ya registrado en el libro NUNCA se modifica aquí.
//   - El abono neto (transferencia) NUNCA es un ingreso nuevo.
//   - La comisión sale SOLO del campo `fee` del proveedor. Una diferencia
//     bruto − neto se expone aparte como `difference`, nunca como "comisión".
//   - Comisión desconocida → "pendiente"/"sin confirmar", nunca $0.
//   - Este módulo NO escribe nada: las comisiones son PROPUESTAS
//     (`writesLedger: false`). Escribir en el libro requiere un GO separado.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETTLEMENT_STATUS_LABEL = exports.ACCOUNTING_DATE_POLICIES = exports.PAYOUT_LOOKAHEAD_DAYS = exports.SALES_LOOKBACK_DAYS = exports.MAX_WINDOW_DAYS = exports.DEFAULT_DIFFERENCE_BUSINESS_DAYS = exports.FEE_CATEGORY = exports.MIN_VOTES_FOR_BASIS = exports.AMOUNT_TOLERANCE = exports.FAILED_STATUSES = exports.IN_PROGRESS_STATUSES = exports.SUCCESS_STATUSES = exports.DEDUCTION_ROW_TYPES = exports.PAYOUT_ROW_TYPE = exports.SUMUP_ACCOUNT_LABEL = exports.SUMUP_ACCOUNTS = void 0;
exports.roundClp = roundClp;
exports.shortHash = shortHash;
exports.shortReference = shortReference;
exports.chileDate = chileDate;
exports.businessDaysBetween = businessDaysBetween;
exports.planWindow = planWindow;
exports.parsePayoutRow = parsePayoutRow;
exports.dedupeRows = dedupeRows;
exports.isCardSale = isCardSale;
exports.isPayableSale = isPayableSale;
exports.basisVote = basisVote;
exports.aggregateBasisVotes = aggregateBasisVotes;
exports.feeProposalId = feeProposalId;
exports.buildFeeProposals = buildFeeProposals;
exports.reconcileAccount = reconcileAccount;
exports.reconcile = reconcile;
exports.combineTotals = combineTotals;
exports.candidateProposalIds = candidateProposalIds;
const dates_1 = require("./dates");
exports.SUMUP_ACCOUNTS = ["offerings", "cafeteria"];
exports.SUMUP_ACCOUNT_LABEL = { offerings: "Ofrendas", cafeteria: "Cafetería" };
exports.PAYOUT_ROW_TYPE = "PAYOUT";
exports.DEDUCTION_ROW_TYPES = [
    "REFUND_DEDUCTION",
    "CHARGE_BACK_DEDUCTION",
    "DD_RETURN_DEDUCTION",
    "BALANCE_DEDUCTION",
];
exports.SUCCESS_STATUSES = ["SUCCESSFUL"];
exports.IN_PROGRESS_STATUSES = ["PENDING", "IN_PROGRESS", "SCHEDULED", "PROCESSING", "CREATED"];
exports.FAILED_STATUSES = ["FAILED", "CANCELLED", "CANCELED", "RETURNED", "REJECTED", "DECLINED", "REVERSED"];
/** CLP no tiene decimales; ±1 cubre redondeos de SumUp/Firestore (regla G9/Atlas). */
exports.AMOUNT_TOLERANCE = 1;
exports.MIN_VOTES_FOR_BASIS = 3;
exports.FEE_CATEGORY = "Comisiones SumUp";
exports.DEFAULT_DIFFERENCE_BUSINESS_DAYS = 5;
/** Ventana máxima (días de venta, inclusiva) que acepta el callable. */
exports.MAX_WINDOW_DAYS = 35;
/** Días antes del inicio que se leen para vincular abonos que pagan ventas previas. */
exports.SALES_LOOKBACK_DAYS = 10;
/** Días después del fin en los que se buscan abonos de las ventas de la ventana. */
exports.PAYOUT_LOOKAHEAD_DAYS = 10;
exports.ACCOUNTING_DATE_POLICIES = ["payout_date", "sale_date"];
exports.SETTLEMENT_STATUS_LABEL = {
    PENDIENTE: "Pendiente",
    CONCILIADO: "Conciliado",
    CON_DIFERENCIA: "Con diferencia",
    REQUIERE_REVISION: "Requiere revisión",
};
// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
/**
 * Redondeo CLP documentado: al entero más cercano, mitades alejándose de cero
 * (2,5 → 3; −2,5 → −3). null si no es un número finito.
 */
function roundClp(value) {
    if (value === null || value === undefined || value === "")
        return null;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n))
        return null;
    const r = Math.sign(n) * Math.round(Math.abs(n));
    return r === 0 ? 0 : r;
}
/** Hash corto determinista (cyrb53), igual en cliente y Functions. 12 hex. */
function shortHash(input) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < input.length; i++) {
        const ch = input.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return n.toString(16).padStart(14, "0").slice(-12);
}
function str(value) {
    if (value === null || value === undefined)
        return "";
    return String(value).trim();
}
/** Últimos 6 caracteres de la referencia (para mostrar), o "—". */
function shortReference(reference) {
    if (!reference)
        return "—";
    const compact = reference.replace(/\s+/g, "");
    return compact.length <= 6 ? compact : `…${compact.slice(-6)}`;
}
/** Día local (America/Santiago) de un instante. */
function chileDate(instant) {
    return (0, dates_1.localNow)(instant).slice(0, 10);
}
/** Días hábiles (lun–vie, sin feriados) estrictamente después de `from` y hasta `to` inclusive. */
function businessDaysBetween(from, to, holidays = []) {
    if ((0, dates_1.daysBetween)(from, to) <= 0)
        return 0;
    const skip = new Set(holidays);
    let count = 0;
    for (let d = (0, dates_1.addDays)(from, 1); d <= to; d = (0, dates_1.addDays)(d, 1)) {
        const wd = (0, dates_1.weekdayOf)(d);
        if (wd !== 0 && wd !== 6 && !skip.has(d))
            count += 1;
    }
    return count;
}
/** Valida la ventana (≤ MAX_WINDOW_DAYS días, inclusiva) y calcula qué leer. */
function planWindow(startDate, endDate, asOfDate) {
    if (typeof startDate !== "string" || typeof endDate !== "string" || !(0, dates_1.isValidYmd)(startDate) || !(0, dates_1.isValidYmd)(endDate)) {
        return { ok: false, error: "invalid_dates" };
    }
    if (endDate < startDate)
        return { ok: false, error: "end_before_start" };
    if ((0, dates_1.daysBetween)(startDate, endDate) + 1 > exports.MAX_WINDOW_DAYS)
        return { ok: false, error: "window_too_long" };
    const lookahead = (0, dates_1.addDays)(endDate, exports.PAYOUT_LOOKAHEAD_DAYS);
    const fetchEnd = lookahead < asOfDate ? lookahead : asOfDate;
    const payoutFetch = fetchEnd >= startDate ? { startDate, endDate: fetchEnd } : null;
    // Las ventas se leen hasta el último día de abonos pedido: un abono posterior
    // al período (p. ej. 03-11 que paga 31-10 + 01-11) debe vincular TODAS sus
    // filas. Pendientes y totales siguen limitados al período.
    const salesEnd = payoutFetch && payoutFetch.endDate > endDate ? payoutFetch.endDate : endDate;
    return {
        ok: true,
        plan: {
            startDate,
            endDate,
            payoutFetch,
            salesRead: { startDate: (0, dates_1.addDays)(startDate, -exports.SALES_LOOKBACK_DAYS), endDate: salesEnd },
        },
    };
}
// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------
function classifyStatus(status) {
    if (exports.SUCCESS_STATUSES.includes(status))
        return "successful";
    if (exports.IN_PROGRESS_STATUSES.includes(status))
        return "in_progress";
    if (exports.FAILED_STATUSES.includes(status))
        return "failed";
    return "unknown";
}
function classifyKind(type) {
    if (type === exports.PAYOUT_ROW_TYPE)
        return "payout";
    if (exports.DEDUCTION_ROW_TYPES.includes(type))
        return "deduction";
    return "unknown";
}
function parseRowDate(value) {
    const s = str(value).slice(0, 10);
    return (0, dates_1.isValidYmd)(s) ? s : null;
}
/**
 * Normaliza y valida una fila. Montos a entero CLP (roundClp). Moneda distinta
 * de CLP o ausente → issue (la fila queda en revisión, nunca se convierte).
 * Deducciones: el monto se fuerza a ≤ 0 (restan del abono sea cual sea el signo
 * que entregue el proveedor).
 */
function parsePayoutRow(raw, account) {
    const issues = [];
    const id = str(raw?.id);
    const type = str(raw?.type).toUpperCase();
    const status = str(raw?.status).toUpperCase();
    const kind = classifyKind(type);
    const statusClass = classifyStatus(status);
    const date = parseRowDate(raw?.date);
    const reference = str(raw?.reference) || null;
    const transactionCode = str(raw?.transaction_code) || null;
    const currency = str(raw?.currency).toUpperCase() || null;
    if (!id)
        issues.push("id_missing");
    if (kind === "unknown")
        issues.push("type_unknown");
    if (statusClass === "unknown")
        issues.push("status_unknown");
    if (!date)
        issues.push("date_invalid");
    if (!reference)
        issues.push("reference_missing");
    if (!currency)
        issues.push("currency_missing");
    else if (currency !== "CLP")
        issues.push("currency_not_clp");
    const rawAmount = typeof raw?.amount === "number" ? raw.amount : Number(raw?.amount);
    let amount = roundClp(raw?.amount);
    if (amount === null) {
        issues.push("amount_invalid");
        amount = 0;
    }
    const fee = roundClp(raw?.fee);
    if (fee === null)
        issues.push("fee_missing");
    else if (fee < 0)
        issues.push("fee_invalid");
    const rawFee = typeof raw?.fee === "number" ? raw.fee : Number(raw?.fee);
    const rounded = (Number.isFinite(rawAmount) && !Number.isInteger(rawAmount)) || (fee !== null && Number.isFinite(rawFee) && !Number.isInteger(rawFee));
    if (kind === "deduction")
        amount = amount === 0 ? 0 : -Math.abs(amount);
    else if (kind === "payout" && amount < 0)
        issues.push("amount_invalid");
    const fingerprint = shortHash(JSON.stringify([type, status, date, reference, transactionCode, currency, str(raw?.amount), str(raw?.fee)]));
    return { account, id, type, kind, status, statusClass, date, reference, transactionCode, currency, amount, fee, rounded, issues, fingerprint };
}
/**
 * Deduplica por id: la misma fila repetida (misma huella) se ignora; el mismo
 * id con contenido distinto queda marcado `duplicate_conflict` (se conserva la
 * primera, nunca se suman ambas).
 */
function dedupeRows(rows) {
    const byId = new Map();
    const out = [];
    let duplicatesIgnored = 0;
    let duplicateConflicts = 0;
    for (const row of rows) {
        if (!row.id) {
            out.push(row);
            continue;
        }
        const seen = byId.get(row.id);
        if (!seen) {
            const copy = { ...row, issues: [...row.issues] };
            byId.set(row.id, copy);
            out.push(copy);
            continue;
        }
        if (seen.fingerprint === row.fingerprint)
            duplicatesIgnored += 1;
        else {
            duplicateConflicts += 1;
            if (!seen.issues.includes("duplicate_conflict"))
                seen.issues.push("duplicate_conflict");
        }
    }
    return { rows: out, duplicatesIgnored, duplicateConflicts };
}
// ---------------------------------------------------------------------------
// Ventas y base
// ---------------------------------------------------------------------------
/** Venta con tarjeta (POS) en CLP: única que SumUp abona. El efectivo nunca. */
function isCardSale(sale) {
    return sale.paymentType === "POS" && sale.currency === "CLP";
}
/** Venta que debería abonarse: tarjeta, SUCCESSFUL/REFUNDED con saldo > 0. */
function isPayableSale(sale) {
    return isCardSale(sale) && (sale.status === "SUCCESSFUL" || sale.status === "REFUNDED") && sale.amountAfterRefunds > 0;
}
/** Regla de Atlas/G9 para una fila PAYOUT vinculada (G = bruto, G' = bruto − reembolsos). */
function basisVote(row, sale) {
    const fee = row.fee ?? 0;
    if (fee === 0)
        return "ambiguous";
    const g = sale.grossAmount;
    const gp = Math.max(0, g - sale.refundedAmount);
    const near = (a, b) => Math.abs(a - b) <= exports.AMOUNT_TOLERANCE;
    if (near(row.amount + fee, g) || near(row.amount + fee, gp))
        return "net";
    if (near(row.amount, g) || near(row.amount, gp))
        return "gross";
    return "mismatch";
}
/** Base aceptada solo con ≥ 3 votos contables, sin mismatch y sin desacuerdo. */
function aggregateBasisVotes(votes) {
    const tally = { net: 0, gross: 0, ambiguous: 0, mismatch: 0 };
    for (const v of votes)
        tally[v] += 1;
    const countable = tally.net + tally.gross + tally.mismatch;
    if (tally.mismatch > 0)
        return { basis: "indeterminate", reason: "mismatch_present", tally };
    if (countable < exports.MIN_VOTES_FOR_BASIS)
        return { basis: "indeterminate", reason: "insufficient_evidence", tally };
    if (tally.net > 0 && tally.gross > 0)
        return { basis: "indeterminate", reason: "votes_disagree", tally };
    return { basis: tally.net > 0 ? "net" : "gross", reason: null, tally };
}
function linkRow(row, index) {
    if (!row.transactionCode)
        return { status: "no_code" };
    const sale = index.get(row.transactionCode);
    if (!sale)
        return { status: "not_found" };
    if (sale.account !== row.account)
        return { status: "other_account" };
    return { status: "linked", sale };
}
/** Sin referencia, cada fila es su propio abono: el id de la fila entra al hash (ids únicos). */
function settlementKeyHash(reference, statusClass, rowId = null) {
    const ref = reference ?? `sin-referencia:${rowId ?? ""}`;
    return shortHash(`${ref}${statusClass === "successful" ? "" : `|${statusClass}`}`);
}
/**
 * Id determinista de la propuesta de comisión de un abono (idempotente entre reruns).
 * `rowId` solo se usa cuando el abono no tiene referencia.
 */
function feeProposalId(account, payoutDate, reference, statusClass = "successful", rowId = null) {
    return `sumup_fee_${account}_${payoutDate ?? "sin-fecha"}_${settlementKeyHash(reference, statusClass, reference ? null : rowId)}`;
}
function emptyByStatus() {
    return { PENDIENTE: 0, CONCILIADO: 0, CON_DIFERENCIA: 0, REQUIERE_REVISION: 0 };
}
function pushReason(list, reason) {
    if (!list.includes(reason))
        list.push(reason);
}
function buildSettlement(rows, ctx) {
    const first = rows[0];
    const reasons = [];
    const payoutDate = first.date;
    const reference = first.reference;
    const statusClass = first.statusClass;
    const anchorRowId = reference ? null : first.id;
    let roundedRows = 0;
    const linkedCodes = [];
    let netPaid = 0;
    let fee = 0;
    let deductions = 0;
    let refundsBeforePayout = 0;
    let unlinked = 0;
    let payoutRowCount = 0;
    let deductionRowCount = 0;
    const linkedSales = new Map();
    const byDay = new Map();
    for (const row of rows) {
        if (row.rounded)
            roundedRows += 1;
        if (row.issues.includes("currency_missing") || row.issues.includes("currency_not_clp"))
            pushReason(reasons, "currency_issue");
        if (row.issues.includes("duplicate_conflict"))
            pushReason(reasons, "duplicate_conflict");
        if (row.issues.includes("id_missing"))
            pushReason(reasons, "row_id_missing");
        if (row.issues.includes("reference_missing"))
            pushReason(reasons, "reference_missing");
        if (row.issues.includes("date_invalid"))
            pushReason(reasons, "date_invalid");
        if (row.issues.includes("amount_invalid"))
            pushReason(reasons, "amount_mismatch");
        if (row.fee === null || row.issues.includes("fee_invalid"))
            pushReason(reasons, "fee_missing");
        const rowFee = row.fee;
        fee = fee === null || rowFee === null ? null : fee + rowFee;
        if (row.kind === "deduction") {
            deductionRowCount += 1;
            deductions += row.amount;
            netPaid += row.amount;
            continue;
        }
        if (row.kind === "unknown") {
            pushReason(reasons, "unknown_row_type");
            netPaid += row.amount;
            continue;
        }
        payoutRowCount += 1;
        netPaid += ctx.basis.basis === "gross" ? row.amount - (rowFee ?? 0) : row.amount;
        const link = linkRow(row, ctx.index);
        if (link.status !== "linked") {
            unlinked += 1;
            pushReason(reasons, link.status === "no_code" ? "rows_without_code" : link.status === "not_found" ? "rows_not_found" : "rows_other_account");
            const key = "sin-fecha";
            const bucket = byDay.get(key) ?? { saleDate: null, gross: 0, fee: 0, sales: new Set() };
            bucket.fee = bucket.fee === null || rowFee === null ? null : bucket.fee + rowFee;
            byDay.set(key, bucket);
            continue;
        }
        const sale = link.sale;
        linkedCodes.push(sale.transactionCode);
        if ((ctx.paidCodeCount.get(sale.transactionCode) ?? 0) > 1)
            pushReason(reasons, "sale_paid_twice");
        if (!linkedSales.has(sale.transactionCode))
            linkedSales.set(sale.transactionCode, sale);
        const expected = ctx.basis.basis === "gross" ? row.amount : row.amount + (rowFee ?? 0);
        const g = sale.grossAmount;
        const gp = Math.max(0, g - sale.refundedAmount);
        if (Math.abs(expected - g) <= exports.AMOUNT_TOLERANCE) {
            // abono por el bruto original
        }
        else if (Math.abs(expected - gp) <= exports.AMOUNT_TOLERANCE) {
            refundsBeforePayout += g - gp;
            pushReason(reasons, "refunds_before_payout");
        }
        else {
            pushReason(reasons, "amount_mismatch");
        }
        const key = sale.saleDate ?? "sin-fecha";
        const bucket = byDay.get(key) ?? { saleDate: sale.saleDate, gross: 0, fee: 0, sales: new Set() };
        if (!bucket.sales.has(sale.transactionCode)) {
            bucket.sales.add(sale.transactionCode);
            bucket.gross += sale.grossAmount;
        }
        bucket.fee = bucket.fee === null || rowFee === null ? null : bucket.fee + rowFee;
        byDay.set(key, bucket);
    }
    const grossSales = [...linkedSales.values()].reduce((s, sale) => s + sale.grossAmount, 0);
    const feeKnown = fee ?? 0;
    const residual = netPaid - (grossSales - refundsBeforePayout - feeKnown + deductions);
    const difference = grossSales - netPaid;
    const saleDays = [...new Set([...linkedSales.values()].map((s) => s.saleDate).filter((d) => !!d))].sort();
    if (ctx.basis.basis === "indeterminate")
        pushReason(reasons, "basis_indeterminate");
    if (ctx.basis.basis === "gross")
        pushReason(reasons, "basis_gross");
    if (deductionRowCount > 0)
        pushReason(reasons, "deductions_present");
    const businessDaysSincePayout = payoutDate ? businessDaysBetween(payoutDate, ctx.asOfDate, ctx.holidays) : null;
    const blocking = reasons.filter((r) => r !== "refunds_before_payout");
    let status;
    if (statusClass === "failed") {
        pushReason(reasons, "payout_failed");
        // Informativo: todas sus ventas tienen otro abono exitoso (SumUp reintentó).
        if (linkedCodes.length > 0 && linkedCodes.every((c) => (ctx.paidCodeCount.get(c) ?? 0) > 0))
            pushReason(reasons, "payout_retried");
        status = "REQUIERE_REVISION";
    }
    else if (statusClass === "unknown") {
        pushReason(reasons, "status_unknown");
        status = "REQUIERE_REVISION";
    }
    else if (blocking.length > 0) {
        status = "REQUIERE_REVISION";
        if (statusClass === "in_progress")
            pushReason(reasons, "payout_in_progress");
    }
    else if (statusClass === "in_progress") {
        pushReason(reasons, "payout_in_progress");
        status = "PENDIENTE";
    }
    else if (residual === 0) {
        status = "CONCILIADO";
    }
    else if (Math.abs(residual) <= roundedRows) {
        // Cada fila con decimales redondeados (monto y comisión por separado) puede
        // desviar a lo más $1: no es una diferencia real.
        pushReason(reasons, "rounding");
        status = "CONCILIADO";
    }
    else if ((businessDaysSincePayout ?? 0) >= ctx.differenceBusinessDays) {
        pushReason(reasons, "difference_after_term");
        status = "CON_DIFERENCIA";
    }
    else {
        pushReason(reasons, "difference_within_term");
        status = "PENDIENTE";
    }
    // Comisión confirmada: abono exitoso, base net aceptada, todas las filas con
    // fee del proveedor, todas vinculadas y nada que revisar.
    const feeConfirmed = statusClass === "successful" && ctx.basis.basis === "net" && fee !== null && unlinked === 0 && status !== "REQUIERE_REVISION";
    const inWindow = !!payoutDate && payoutDate >= ctx.period.startDate && payoutDate <= ctx.period.endDate;
    const afterWindow = !!payoutDate && payoutDate > ctx.period.endDate;
    return {
        id: `stl_${ctx.account}_${payoutDate ?? "sin-fecha"}_${settlementKeyHash(reference, statusClass, anchorRowId)}`,
        account: ctx.account,
        payoutDate,
        reference,
        referenceShort: shortReference(reference),
        anchorRowId,
        statusClass,
        status,
        reasons,
        rowCount: rows.length,
        payoutRowCount,
        deductionRowCount,
        unlinkedRowCount: unlinked,
        linkedSalesCount: linkedSales.size,
        saleDays,
        grossSales,
        fee,
        feeConfirmed,
        refundsBeforePayout,
        deductions,
        adjustments: deductions - refundsBeforePayout,
        netPaid,
        difference,
        residual,
        businessDaysSincePayout,
        inWindow,
        afterWindow,
        byDay: [...byDay.values()]
            .map((b) => ({ saleDate: b.saleDate, gross: b.gross, fee: b.fee, sales: b.sales.size }))
            .sort((a, b) => String(a.saleDate).localeCompare(String(b.saleDate))),
    };
}
function proposalState(settlement, amount, previous) {
    if (settlement.statusClass === "failed")
        return "excluida";
    if (previous && previous.amount !== amount)
        return "revision";
    if (!(settlement.status === "CONCILIADO" && settlement.feeConfirmed))
        return "sin_confirmar";
    if (previous)
        return "ya_registrada";
    return "propuesta";
}
/**
 * Propuestas de gasto "Comisiones SumUp" (NUNCA se escriben aquí).
 *  - payout_date (por defecto): una por abono, fecha contable = fecha del abono.
 *  - sale_date: una por día de venta dentro del abono, fecha contable = día de venta.
 * La política es una decisión humana (doc 29). Ids deterministas: el mismo
 * abono visto dos veces, en ventanas solapadas o en reruns da el mismo id y monto.
 */
function buildFeeProposals(settlement, policy, previous = {}) {
    const baseId = feeProposalId(settlement.account, settlement.payoutDate, settlement.reference, settlement.statusClass, settlement.anchorRowId);
    const label = exports.SUMUP_ACCOUNT_LABEL[settlement.account];
    const make = (id, amount, saleDate, saleDates, accountingDate) => {
        const prev = previous[id];
        if (amount === 0 && !prev && settlement.statusClass !== "failed")
            return null;
        const state = proposalState(settlement, amount, prev);
        return {
            id,
            account: settlement.account,
            type: "expense",
            category: exports.FEE_CATEGORY,
            description: `Comisión SumUp · ${label} · abono ${settlement.payoutDate ?? "sin fecha"}${saleDate ? ` · venta ${saleDate}` : ""}`,
            amount: state === "excluida" ? 0 : amount,
            accountingDate,
            policy,
            payoutDate: settlement.payoutDate,
            saleDate,
            saleDates,
            settlementId: settlement.id,
            referenceShort: settlement.referenceShort,
            state,
            reasons: [...settlement.reasons],
            previousAmount: prev ? prev.amount : null,
            writesLedger: false,
        };
    };
    if (policy === "sale_date") {
        return settlement.byDay
            .map((day) => {
            const suffix = day.saleDate ? day.saleDate.replace(/-/g, "") : "sinfecha";
            return make(`${baseId}_s${suffix}`, day.fee ?? 0, day.saleDate, day.saleDate ? [day.saleDate] : [], day.saleDate);
        })
            .filter((p) => p !== null);
    }
    const single = make(baseId, settlement.fee ?? 0, null, settlement.saleDays, settlement.payoutDate);
    return single ? [single] : [];
}
/**
 * Totales del período. Los montos suman SOLO abonos exitosos: un abono fallido
 * o en proceso no llegó al banco y sus ventas siguen en "pendiente de abono"
 * (sumarlos contaría dos veces la misma venta). Se cuentan aparte en
 * `notCountedSettlements` y siguen en `byStatus`.
 */
function sumTotals(settlements, pendingAmount, pendingSales) {
    const byStatus = emptyByStatus();
    let grossSales = 0;
    let fee = 0;
    let feeComplete = true;
    let adjustments = 0;
    let netPaid = 0;
    let notCountedSettlements = 0;
    for (const s of settlements) {
        byStatus[s.status] += 1;
        if (s.statusClass !== "successful") {
            notCountedSettlements += 1;
            continue;
        }
        grossSales += s.grossSales;
        if (s.fee === null || !s.feeConfirmed)
            feeComplete = false;
        fee += s.fee ?? 0;
        adjustments += s.adjustments;
        netPaid += s.netPaid;
    }
    return {
        settlements: settlements.length,
        notCountedSettlements,
        grossSales,
        fee,
        feeComplete,
        adjustments,
        netPaid,
        difference: grossSales - netPaid,
        pendingAmount,
        pendingSales,
        byStatus,
    };
}
/** Concilia una cuenta. Ver reconcile() para el contrato completo. */
function reconcileAccount(account, rawRows, allSales, period, asOfDate, options = {}) {
    const differenceBusinessDays = options.differenceBusinessDays ?? exports.DEFAULT_DIFFERENCE_BUSINESS_DAYS;
    const holidays = options.holidays ?? [];
    const policy = options.accountingDatePolicy ?? "payout_date";
    const index = new Map();
    for (const sale of allSales)
        if (sale.transactionCode && !index.has(sale.transactionCode))
            index.set(sale.transactionCode, sale);
    const parsed = rawRows.map((r) => parsePayoutRow(r, account));
    const { rows, duplicatesIgnored, duplicateConflicts } = dedupeRows(parsed);
    // Votos de base: filas PAYOUT exitosas vinculadas a una venta de esta cuenta.
    const votes = [];
    const paidCodeCount = new Map();
    const rowsBySaleCode = new Map();
    for (const row of rows) {
        if (row.kind !== "payout")
            continue;
        const link = linkRow(row, index);
        if (link.status !== "linked")
            continue;
        const list = rowsBySaleCode.get(link.sale.transactionCode) ?? [];
        list.push(row);
        rowsBySaleCode.set(link.sale.transactionCode, list);
        if (row.statusClass === "successful") {
            paidCodeCount.set(link.sale.transactionCode, (paidCodeCount.get(link.sale.transactionCode) ?? 0) + 1);
            if (row.fee !== null)
                votes.push(basisVote(row, link.sale));
        }
    }
    const basis = aggregateBasisVotes(votes);
    // Agrupar en abonos: cuenta + fecha + referencia + clase de estado.
    const groups = new Map();
    for (const row of rows) {
        const key = `${row.date ?? "sin-fecha"}|${row.reference ?? `sin-referencia:${row.id}`}|${row.statusClass}`;
        const list = groups.get(key) ?? [];
        list.push(row);
        groups.set(key, list);
    }
    const ctx = { account, basis, index, paidCodeCount, period, asOfDate, differenceBusinessDays, holidays };
    const inWindowSale = (sale) => !!sale.saleDate && sale.saleDate >= period.startDate && sale.saleDate <= period.endDate;
    const settlements = [...groups.values()]
        .map((g) => buildSettlement(g, ctx))
        .filter((s) => {
        if (s.inWindow)
            return true;
        if (!s.afterWindow)
            return false;
        // Abono posterior: solo si paga alguna venta de la ventana.
        return s.saleDays.some((d) => d >= period.startDate && d <= period.endDate);
    })
        .sort((a, b) => String(a.payoutDate).localeCompare(String(b.payoutDate)) || a.id.localeCompare(b.id));
    // Ventas por abonar: tarjeta, con saldo, dentro de la ventana, sin fila PAYOUT exitosa.
    const pendingMap = new Map();
    let pendingAmount = 0;
    let pendingSales = 0;
    for (const sale of allSales) {
        if (sale.account !== account || !isPayableSale(sale) || !inWindowSale(sale))
            continue;
        if ((paidCodeCount.get(sale.transactionCode) ?? 0) > 0)
            continue;
        const day = sale.saleDate;
        const bucket = pendingMap.get(day) ?? { account, saleDate: day, salesCount: 0, amount: 0, status: "PENDIENTE", inProgressCount: 0, failedCount: 0 };
        bucket.salesCount += 1;
        bucket.amount += sale.amountAfterRefunds;
        const related = rowsBySaleCode.get(sale.transactionCode) ?? [];
        if (related.some((r) => r.statusClass === "in_progress"))
            bucket.inProgressCount += 1;
        if (related.some((r) => r.statusClass === "failed"))
            bucket.failedCount += 1;
        pendingMap.set(day, bucket);
        pendingAmount += sale.amountAfterRefunds;
        pendingSales += 1;
    }
    const pendingDays = [...pendingMap.values()].sort((a, b) => a.saleDate.localeCompare(b.saleDate));
    const proposalMap = new Map();
    for (const s of settlements) {
        for (const p of buildFeeProposals(s, policy, options.previousProposals))
            if (!proposalMap.has(p.id))
                proposalMap.set(p.id, p);
    }
    const totalsSource = settlements.filter((s) => s.inWindow);
    return {
        account,
        basis,
        settlements,
        pendingDays,
        pendingAmount,
        pendingSales,
        proposals: [...proposalMap.values()],
        totals: sumTotals(totalsSource, pendingAmount, pendingSales),
        rowStats: {
            fetched: rawRows.length,
            used: rows.length,
            duplicatesIgnored,
            duplicateConflicts,
            rounded: rows.filter((r) => r.rounded).length,
        },
    };
}
/**
 * Conciliación completa, cuentas aisladas (cada una con su base y sus abonos).
 * `totals` suma solo abonos EXITOSOS con fecha dentro del período (`inWindow`):
 * los abonos posteriores que pagan ventas del período se muestran pero no se
 * suman, para no contar dos veces entre meses; los fallidos/en proceso tampoco
 * (sus ventas siguen pendientes de abono).
 */
function reconcile(input) {
    const options = input.options ?? {};
    const allSales = [];
    for (const account of exports.SUMUP_ACCOUNTS)
        for (const sale of input.salesByAccount[account] ?? [])
            allSales.push(sale);
    const accounts = input.accounts.map((account) => reconcileAccount(account, input.rowsByAccount[account] ?? [], allSales, input.period, input.asOfDate, options));
    return {
        period: input.period,
        asOfDate: input.asOfDate,
        policy: options.accountingDatePolicy ?? "payout_date",
        differenceBusinessDays: options.differenceBusinessDays ?? exports.DEFAULT_DIFFERENCE_BUSINESS_DAYS,
        accounts,
        totals: combineTotals(accounts.map((a) => a.totals)),
    };
}
function combineTotals(list) {
    const byStatus = emptyByStatus();
    const out = { settlements: 0, notCountedSettlements: 0, grossSales: 0, fee: 0, feeComplete: true, adjustments: 0, netPaid: 0, difference: 0, pendingAmount: 0, pendingSales: 0, byStatus };
    for (const t of list) {
        out.settlements += t.settlements;
        out.notCountedSettlements += t.notCountedSettlements;
        out.grossSales += t.grossSales;
        out.fee += t.fee;
        out.feeComplete = out.feeComplete && t.feeComplete;
        out.adjustments += t.adjustments;
        out.netPaid += t.netPaid;
        out.difference += t.difference;
        out.pendingAmount += t.pendingAmount;
        out.pendingSales += t.pendingSales;
        for (const k of Object.keys(byStatus))
            byStatus[k] += t.byStatus[k];
    }
    return out;
}
/** Ids de propuesta posibles de un conjunto de filas (para leer el libro antes de proponer). */
function candidateProposalIds(account, rawRows, policy, sales = []) {
    const ids = new Set();
    const index = new Map();
    for (const s of sales)
        if (s.transactionCode && !index.has(s.transactionCode))
            index.set(s.transactionCode, s);
    for (const raw of rawRows) {
        const row = parsePayoutRow(raw, account);
        const base = feeProposalId(account, row.date, row.reference, row.statusClass, row.id || null);
        if (policy === "payout_date")
            ids.add(base);
        else {
            const sale = row.transactionCode ? index.get(row.transactionCode) : undefined;
            const d = sale && sale.account === account && sale.saleDate ? sale.saleDate.replace(/-/g, "") : "sinfecha";
            ids.add(`${base}_s${d}`);
        }
    }
    return [...ids];
}
