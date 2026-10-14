// Detectores SumUp: venta bruta vs payout neto, payouts pendientes y doble registro. Puros.
// Modelo (G9): cada fila de payout corresponde a UNA venta (transactionCode), su
// `amount` es NETO de comisión (`fee`) y las filas se agrupan en depósitos por
// `reference` (un depósito puede cubrir ventas de varios días).
//  - PAYOUT_ROW_DUPLICATE: la misma fila de payout aparece dos veces          → STOP
//  - PAYOUT_SALE_MULTIPLE: una venta con más de una fila PAYOUT distinta      → REVISAR
//  - PAYOUT_BASIS_NOT_NET: el monto del payout no es neto                     → REVISAR
//  - PAYOUT_UNLINKED: fila de payout sin venta en el snapshot                 → REVISAR
//  - SETTLEMENT_MISMATCH: Σ(neto + comisión + deducciones) ≠ Σ bruto ligado   → REVISAR
//  - PAYOUT_DEDUCTION_MISMATCH: deducción ≠ reembolso de la venta            → REVISAR
//  - PAYOUT_PENDING: venta POS sin payout tras N días hábiles                 → REVISAR
//  - FEE_EXPENSE_DUPLICATE / FEE_DOUBLE_BOOKED / FEE_PROPOSAL_ALREADY_BOOKED  → STOP
//  - FEE_AMOUNT_MISMATCH / FEE_WITHOUT_PAYOUT: comisión registrada ≠ proveedor → REVISAR
import { LEVELS, businessDaysBetween, clp, finding, shortId } from "../lib/util.mjs";

const n = (v) => Math.round(Number(v) || 0);
const rowKey = (r) => `${r.account || ""}|${r.id}`;
const saleKey = (account, code) => `${account || ""}|${code}`;
const isPayoutType = (r) => !r.type || r.type === "PAYOUT";
const FAILED = new Set(["FAILED", "CANCELLED", "REFUNDED"]);

export function detectSumup(ctx) {
  const s = ctx.snapshot.sumup;
  if (!s) return [];
  const findings = [];
  const sales = new Map((s.sales || []).map((x) => [saleKey(x.account, x.transactionCode), x]));

  // 1. Filas duplicadas (misma cuenta + id) → doble registro.
  const seen = new Map();
  for (const r of s.payouts || []) {
    const k = rowKey(r);
    seen.set(k, [...(seen.get(k) || []), r]);
  }
  const dupRows = [...seen.values()].filter((rs) => rs.length > 1);
  if (dupRows.length)
    findings.push(
      finding(
        "PAYOUT_ROW_DUPLICATE",
        LEVELS.STOP,
        `${dupRows.length} fila(s) de payout aparecen más de una vez (${dupRows.map((rs) => `${shortId(rs[0].id)} ×${rs.length}`).join(", ")}): riesgo de contar dos veces el mismo depósito o comisión.`,
        { count: dupRows.length, ids: dupRows.map((rs) => shortId(rs[0].id)), occurrences: dupRows.map((rs) => rs.length) },
        dupRows.map((rs) => rs[0].id),
      ),
    );
  const rows = [...seen.values()].map((rs) => rs[0]);

  // 2. Una venta con varias filas PAYOUT distintas.
  const bySale = new Map();
  for (const r of rows.filter(isPayoutType)) {
    if (!r.transactionCode) continue;
    const k = saleKey(r.account, r.transactionCode);
    bySale.set(k, [...(bySale.get(k) || []), r]);
  }
  for (const [k, rs] of bySale)
    if (rs.length > 1)
      findings.push(
        finding(
          "PAYOUT_SALE_MULTIPLE",
          LEVELS.REVIEW,
          `La venta ${shortId(k.split("|")[1])} tiene ${rs.length} filas de payout distintas (${rs.map((r) => shortId(r.id)).join(", ")}): posible pago duplicado.`,
          { sale: shortId(k.split("|")[1]), rows: rs.map((r) => shortId(r.id)), amounts: rs.map((r) => n(r.amount)) },
          rs.map((r) => r.id),
        ),
      );

  // 3. Base neta y conciliación por depósito (reference).
  if (s.payoutAmountBasis && s.payoutAmountBasis !== "net")
    findings.push(
      finding("PAYOUT_BASIS_NOT_NET", LEVELS.REVIEW, `El snapshot declara payouts en base "${s.payoutAmountBasis}"; el modelo exige montos netos de comisión.`, { declared: s.payoutAmountBasis }),
    );
  const settlements = new Map();
  for (const r of rows) {
    const k = `${r.account || ""}|${r.reference || r.id}`;
    settlements.set(k, [...(settlements.get(k) || []), r]);
  }
  for (const [k, rs] of settlements) {
    const ref = shortId(k.split("|")[1]);
    const payoutRows = rs.filter(isPayoutType);
    const unlinked = payoutRows.filter((r) => !sales.has(saleKey(r.account, r.transactionCode)));
    if (unlinked.length) {
      findings.push(
        finding(
          "PAYOUT_UNLINKED",
          LEVELS.REVIEW,
          `Depósito ${ref}: ${unlinked.length} fila(s) de payout sin venta en el snapshot (${clp(unlinked.reduce((a, r) => a + n(r.amount), 0))} neto). Ampliar la ventana de ventas o revisar el origen.`,
          { reference: ref, rows: unlinked.map((r) => shortId(r.id)) },
          unlinked.map((r) => r.id),
        ),
      );
    }
    const gross = [];
    for (const r of payoutRows) {
      const sale = sales.get(saleKey(r.account, r.transactionCode));
      if (!sale) continue;
      gross.push(sale);
      if (n(r.fee) > 0 && n(r.amount) === n(sale.gross))
        findings.push(
          finding(
            "PAYOUT_BASIS_NOT_NET",
            LEVELS.REVIEW,
            `Fila de payout ${shortId(r.id)}: monto ${clp(r.amount)} igual al bruto de la venta con comisión ${clp(r.fee)}; el payout debe ser neto.`,
            { row: shortId(r.id), amount: n(r.amount), fee: n(r.fee), gross: n(sale.gross) },
            [r.id],
          ),
        );
    }
    if (!unlinked.length && payoutRows.length) {
      const net = payoutRows.reduce((a, r) => a + n(r.amount), 0);
      const fee = payoutRows.reduce((a, r) => a + n(r.fee), 0);
      const ded = payoutRows.reduce((a, r) => a + n(r.deduction), 0);
      const g = gross.reduce((a, x) => a + n(x.gross), 0);
      const days = [...new Set(gross.map((x) => x.date))].sort();
      if (net + fee + ded !== g)
        findings.push(
          finding(
            "SETTLEMENT_MISMATCH",
            LEVELS.REVIEW,
            `Depósito ${ref}: neto ${clp(net)} + comisión ${clp(fee)} + deducciones ${clp(ded)} = ${clp(net + fee + ded)} ≠ bruto de las ${gross.length} venta(s) ligadas ${clp(g)} (diferencia ${clp(net + fee + ded - g)}).`,
            { reference: ref, net, fee, deductions: ded, gross: g, difference: net + fee + ded - g, saleDays: days, rows: payoutRows.length },
            payoutRows.map((r) => r.id),
          ),
        );
    }
    for (const r of rs.filter((x) => !isPayoutType(x))) {
      const sale = sales.get(saleKey(r.account, r.transactionCode));
      if (!sale || Math.abs(n(r.amount)) !== n(sale.refunded))
        findings.push(
          finding(
            "PAYOUT_DEDUCTION_MISMATCH",
            LEVELS.REVIEW,
            `Deducción ${shortId(r.id)} (${r.type}, ${clp(Math.abs(n(r.amount)))}) ${sale ? `no coincide con el reembolso de la venta (${clp(sale.refunded)})` : "sin venta ligada en el snapshot"}.`,
            { row: shortId(r.id), type: r.type, amount: n(r.amount), refunded: sale ? n(sale.refunded) : null },
            [r.id],
          ),
        );
    }
  }

  // 4. Ventas POS sin payout.
  const paid = new Set(rows.filter(isPayoutType).map((r) => saleKey(r.account, r.transactionCode)));
  const maxDays = ctx.options.payouts.pendingBusinessDays;
  const pending = { late: [], onTime: [] };
  for (const sale of s.sales || []) {
    if (sale.paymentType === "CASH" || FAILED.has(String(sale.status || "").toUpperCase())) continue;
    if (n(sale.gross) - n(sale.refunded) <= 0 || paid.has(saleKey(sale.account, sale.transactionCode))) continue;
    const age = businessDaysBetween(sale.date, ctx.today, ctx.options.payouts.holidays);
    (age > maxDays ? pending.late : pending.onTime).push({ sale, age });
  }
  for (const [kind, items] of Object.entries(pending)) {
    if (!items.length) continue;
    const late = kind === "late";
    const total = items.reduce((a, i) => a + n(i.sale.gross) - n(i.sale.refunded), 0);
    const oldest = items.map((i) => i.sale.date).sort()[0];
    findings.push(
      finding(
        late ? "PAYOUT_PENDING" : "PAYOUT_PENDING_WITHIN_TERM",
        late ? LEVELS.REVIEW : LEVELS.INFO,
        late
          ? `${items.length} venta(s) POS sin payout después de ${maxDays} día(s) hábiles (${clp(total)} bruto; la más antigua del ${oldest}). Revisar en SumUp si el depósito está retenido.`
          : `${items.length} venta(s) POS aún dentro del plazo de payout (${clp(total)} bruto, ≤ ${maxDays} día(s) hábiles).`,
        { count: items.length, total, oldest, maxBusinessDays: maxDays, sales: items.map((i) => shortId(i.sale.transactionCode)) },
        items.map((i) => i.sale.transactionCode),
      ),
    );
  }

  // 5. Comisiones registradas y propuestas.
  const rowById = new Map(rows.map((r) => [String(r.id), r]));
  const expenses = (s.feeExpenses || []).filter((e) => !e.status || e.status === "active");
  const expIds = new Map();
  for (const e of expenses) expIds.set(e.id, (expIds.get(e.id) || 0) + 1);
  const dupExp = [...expIds].filter(([, c]) => c > 1).map(([id]) => id);
  if (dupExp.length)
    findings.push(finding("FEE_EXPENSE_DUPLICATE", LEVELS.STOP, `${dupExp.length} egreso(s) de comisión con id repetido.`, { ids: dupExp.map(shortId) }, dupExp));
  const byRow = new Map();
  for (const e of expenses) byRow.set(String(e.payoutRowId), [...(byRow.get(String(e.payoutRowId)) || []), e]);
  for (const [rowId, es] of byRow) {
    const distinct = [...new Set(es.map((e) => e.id))];
    if (distinct.length > 1)
      findings.push(
        finding(
          "FEE_DOUBLE_BOOKED",
          LEVELS.STOP,
          `La comisión de la fila de payout ${shortId(rowId)} está registrada ${distinct.length} veces (${distinct.map(shortId).join(", ")}, ${clp(es.reduce((a, e) => a + n(e.amount), 0))}).`,
          { payoutRow: shortId(rowId), expenses: distinct.map(shortId) },
          distinct,
        ),
      );
    const row = rowById.get(rowId);
    if (!row)
      findings.push(
        finding("FEE_WITHOUT_PAYOUT", LEVELS.REVIEW, `Egreso de comisión ${shortId(es[0].id)} ligado a una fila de payout ${shortId(rowId)} que no está en el snapshot.`, { payoutRow: shortId(rowId), expense: shortId(es[0].id) }, [es[0].id]),
      );
    else if (n(es[0].amount) !== n(row.fee))
      findings.push(
        finding(
          "FEE_AMOUNT_MISMATCH",
          LEVELS.REVIEW,
          `Comisión registrada ${clp(es[0].amount)} ≠ comisión del proveedor ${clp(row.fee)} en la fila ${shortId(rowId)}.`,
          { payoutRow: shortId(rowId), booked: n(es[0].amount), provider: n(row.fee) },
          [es[0].id],
        ),
      );
  }
  for (const p of s.feeProposals || []) {
    const already = expIds.has(p.id) || byRow.has(String(p.payoutRowId));
    if (already)
      findings.push(
        finding(
          "FEE_PROPOSAL_ALREADY_BOOKED",
          LEVELS.STOP,
          `La propuesta de comisión ${shortId(p.id)} (fila ${shortId(p.payoutRowId)}, ${clp(p.amount)}) ya está registrada como egreso: aplicarla la contaría dos veces.`,
          { proposal: shortId(p.id), payoutRow: shortId(p.payoutRowId), amount: n(p.amount) },
          [p.id],
        ),
      );
    else {
      const row = rowById.get(String(p.payoutRowId));
      if (row && n(p.amount) !== n(row.fee))
        findings.push(
          finding(
            "FEE_AMOUNT_MISMATCH",
            LEVELS.REVIEW,
            `Propuesta de comisión ${shortId(p.id)} por ${clp(p.amount)} ≠ comisión del proveedor ${clp(row.fee)} (fila ${shortId(p.payoutRowId)}).`,
            { proposal: shortId(p.id), proposed: n(p.amount), provider: n(row.fee) },
            [p.id],
          ),
        );
    }
  }
  return findings;
}
