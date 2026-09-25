// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const payoutsCore = require("../../functions/sumup/payouts-core.js");

const {
  detectBasisVote,
  aggregateBasisVotes,
  buildTransactionIndex,
  linkPayoutRow,
  buildPayoutDocId,
  classifyPayoutRowReview,
  normalizePayoutRow,
  decidePayoutRowAction,
  computeTransactionSettlements,
  buildDailySettlementAggregates,
  computeDeductionsByPayoutDate,
  dailyLinkStatus,
  computeAccountTotals,
} = payoutsCore;

describe("basis detection (G9 rule)", () => {
  it("vota net cuando amount+fee coincide con el bruto", () => {
    const { vote } = detectBasisVote({ payoutAmount: 9660, payoutFee: 340, gross: 10000, refunded: 0 });
    expect(vote).toBe("net");
  });

  it("vota gross cuando amount coincide con el bruto", () => {
    const { vote } = detectBasisVote({ payoutAmount: 10000, payoutFee: 340, gross: 10000, refunded: 0 });
    expect(vote).toBe("gross");
  });

  it("votos mezclados (net y gross) producen basis indeterminada", () => {
    const result = aggregateBasisVotes(["net", "net", "net", "gross"]);
    expect(result.basis).toBe("indeterminada");
    expect(result.reason).toBe("votos_en_desacuerdo");
  });

  it("menos de 3 votos contables produce basis indeterminada", () => {
    const result = aggregateBasisVotes(["net", "net"]);
    expect(result.basis).toBe("indeterminada");
    expect(result.reason).toBe("evidencia_insuficiente");
  });

  it("cualquier mismatch invalida toda la base", () => {
    const result = aggregateBasisVotes(["net", "net", "net", "mismatch"]);
    expect(result.basis).toBe("indeterminada");
    expect(result.reason).toBe("mismatch_presente");
  });

  it("acepta net con exactamente 3 votos y ambiguos no cuentan", () => {
    const result = aggregateBasisVotes(["net", "net", "net", "ambiguous", "ambiguous"]);
    expect(result.basis).toBe("net");
  });
});

describe("linking payout rows to transactions", () => {
  const index = buildTransactionIndex({
    offerings: [{ transactionCode: "COD-1" }],
    cafeteria: [{ transactionCode: "COD-2" }],
  });

  it("vincula por transaction_code dentro de la misma cuenta", () => {
    const link = linkPayoutRow({ transaction_code: "COD-1" }, "offerings", index);
    expect(link.status).toBe("linked");
  });

  it("detecta un código que pertenece a la otra cuenta", () => {
    const link = linkPayoutRow({ transaction_code: "COD-2" }, "offerings", index);
    expect(link.status).toBe("other_account");
    expect(link.account).toBe("cafeteria");
  });

  it("filas de otra cuenta nunca aparecen como not_found en la propia", () => {
    const link = linkPayoutRow({ transaction_code: "COD-999" }, "offerings", index);
    expect(link.status).toBe("not_found");
  });
});

describe("deducciones y filas sin código quedan en revisión", () => {
  it("marca review:true en las 4 variantes de deducción", () => {
    for (const type of ["REFUND_DEDUCTION", "CHARGE_BACK_DEDUCTION", "DD_RETURN_DEDUCTION", "BALANCE_DEDUCTION"]) {
      const { review, reviewReason } = classifyPayoutRowReview({ type, transaction_code: "COD-1" });
      expect(review).toBe(true);
      expect(reviewReason).toBe(`deduction_${type.toLowerCase()}`);
    }
  });

  it("marca review:true una fila PAYOUT sin transaction_code", () => {
    const { review, reviewReason } = classifyPayoutRowReview({ type: "PAYOUT" });
    expect(review).toBe(true);
    expect(reviewReason).toBe("no_transaction_code");
  });

  it("una fila PAYOUT normal con código no entra en revisión", () => {
    const { review } = classifyPayoutRowReview({ type: "PAYOUT", transaction_code: "COD-1" });
    expect(review).toBe(false);
  });

  it("BALANCE_DEDUCTION sin código sigue siendo la razón de deducción, no no_transaction_code", () => {
    const { reviewReason } = classifyPayoutRowReview({ type: "BALANCE_DEDUCTION" });
    expect(reviewReason).toBe("deduction_balance_deduction");
  });
});

describe("normalizePayoutRow + idempotencia", () => {
  const raw = {
    id: "row-1",
    type: "PAYOUT",
    status: "SUCCESSFUL",
    date: "2026-09-10",
    reference: "M2M PID123",
    transaction_code: "COD-1",
    currency: "CLP",
    amount: 9660,
    fee: 340,
  };

  it("docId es estable e incluye cuenta, tipo, id y código", () => {
    const docId = buildPayoutDocId({ account: "offerings", type: "PAYOUT", id: "row-1", transactionCode: "COD-1" });
    expect(docId).toBe("offerings_PAYOUT_row-1_COD-1");
  });

  it("ejecutar dos veces con la misma fila no escribe nada (rawHash igual)", () => {
    const normalized = normalizePayoutRow(raw, { account: "offerings", merchantCode: "MC1" });
    const existing = { rawHash: normalized.rawHash };
    const decision = decidePayoutRowAction(existing, normalized);
    expect(decision.action).toBe("unchanged");
  });

  it("si cambia una fila (ej. status) se detecta un update (para crear versión)", () => {
    const normalized = normalizePayoutRow(raw, { account: "offerings", merchantCode: "MC1" });
    const existing = { rawHash: "distinto" };
    const decision = decidePayoutRowAction(existing, normalized);
    expect(decision.action).toBe("update");
  });

  it("una fila nunca vista antes es 'create'", () => {
    const normalized = normalizePayoutRow(raw, { account: "offerings", merchantCode: "MC1" });
    const decision = decidePayoutRowAction(null, normalized);
    expect(decision.action).toBe("create");
  });

  it("filas de otra cuenta no se cuelan: normalizePayoutRow respeta el account dado", () => {
    const normalized = normalizePayoutRow(raw, { account: "cafeteria", merchantCode: "MC2" });
    expect(normalized.account).toBe("cafeteria");
    expect(normalized.docId).toBe("cafeteria_PAYOUT_row-1_COD-1");
  });
});

describe("computeTransactionSettlements", () => {
  it("calcula netPaid con base net (amount ya es el neto)", () => {
    const rows = normalizePayoutRow(
      { id: "r1", type: "PAYOUT", status: "SUCCESSFUL", date: "2026-09-10", reference: "REF1", transaction_code: "COD-1", amount: 9660, fee: 340 },
      { account: "offerings", merchantCode: "MC1" },
    );
    const linkedRowsByCode = new Map([["COD-1", [rows]]]);
    const out = computeTransactionSettlements([{ id: "tx-1", transactionCode: "COD-1" }], linkedRowsByCode, "net");
    const settlement = out.get("tx-1");
    expect(settlement.feeAmount).toBe(340);
    expect(settlement.netPaid).toBe(9660);
    expect(settlement.feeStatus).toBe("provider");
    expect(settlement.feeSource).toBe("payouts");
  });

  it("calcula netPaid con base gross (amount - fee)", () => {
    const rows = normalizePayoutRow(
      { id: "r1", type: "PAYOUT", status: "SUCCESSFUL", date: "2026-09-10", reference: "REF1", transaction_code: "COD-1", amount: 10000, fee: 340 },
      { account: "offerings", merchantCode: "MC1" },
    );
    const linkedRowsByCode = new Map([["COD-1", [rows]]]);
    const out = computeTransactionSettlements([{ id: "tx-1", transactionCode: "COD-1" }], linkedRowsByCode, "gross");
    const settlement = out.get("tx-1");
    expect(settlement.feeAmount).toBe(340);
    expect(settlement.netPaid).toBe(9660);
  });

  it("una transacción sin fila vinculada no aparece (pendiente, nunca $0)", () => {
    const out = computeTransactionSettlements([{ id: "tx-1", transactionCode: "COD-NOPE" }], new Map(), "net");
    expect(out.has("tx-1")).toBe(false);
  });

  it("suma múltiples filas vinculadas a la misma transacción (split payout)", () => {
    const r1 = normalizePayoutRow(
      { id: "r1", type: "PAYOUT", status: "SUCCESSFUL", date: "2026-09-10", reference: "REF1", transaction_code: "COD-1", amount: 5000, fee: 170 },
      { account: "offerings", merchantCode: "MC1" },
    );
    const r2 = normalizePayoutRow(
      { id: "r2", type: "PAYOUT", status: "SUCCESSFUL", date: "2026-09-11", reference: "REF2", transaction_code: "COD-1", amount: 4660, fee: 170 },
      { account: "offerings", merchantCode: "MC1" },
    );
    const linkedRowsByCode = new Map([["COD-1", [r1, r2]]]);
    const out = computeTransactionSettlements([{ id: "tx-1", transactionCode: "COD-1" }], linkedRowsByCode, "net");
    const settlement = out.get("tx-1");
    expect(settlement.feeAmount).toBe(340);
    expect(settlement.netPaid).toBe(9660);
    expect(settlement.payoutRowIds.length).toBe(2);
  });
});

describe("buildDailySettlementAggregates + linkStatus", () => {
  it("evidencia G9 de septiembre: Ofrendas 1.022.600 - 34.083 = 988.517", () => {
    const transactions = [
      { id: "tx-1", transactionCode: "COD-1", grossAmount: 1022600, refundedAmount: 0, localDate: "2026-09-10" },
    ];
    const row = normalizePayoutRow(
      {
        id: "row-1",
        type: "PAYOUT",
        status: "SUCCESSFUL",
        date: "2026-09-11",
        reference: "M2M PID1",
        transaction_code: "COD-1",
        amount: 988517,
        fee: 34083,
      },
      { account: "offerings", merchantCode: "MC1" },
    );
    const linkedRowsByCode = new Map([["COD-1", [row]]]);
    const days = buildDailySettlementAggregates("offerings", transactions, linkedRowsByCode, "net");
    expect(days).toHaveLength(1);
    expect(days[0].bruto).toBe(1022600);
    expect(days[0].comisionSumUp).toBe(34083);
    expect(days[0].liquidoEsperado).toBe(988517);
    expect(days[0].depositado).toBe(988517);
    expect(days[0].linkStatus).toBe("complete");
  });

  it("evidencia G9 de septiembre: Cafetería 2.011.700 - 69.560 = 1.942.140", () => {
    const transactions = [
      { id: "tx-1", transactionCode: "COD-2", grossAmount: 2011700, refundedAmount: 0, localDate: "2026-09-10" },
    ];
    const row = normalizePayoutRow(
      {
        id: "row-2",
        type: "PAYOUT",
        status: "SUCCESSFUL",
        date: "2026-09-11",
        reference: "MFA PID2",
        transaction_code: "COD-2",
        amount: 1942140,
        fee: 69560,
      },
      { account: "cafeteria", merchantCode: "MC2" },
    );
    const linkedRowsByCode = new Map([["COD-2", [row]]]);
    const days = buildDailySettlementAggregates("cafeteria", transactions, linkedRowsByCode, "net");
    expect(days[0].liquidoEsperado).toBe(1942140);
    expect(days[0].depositado).toBe(1942140);
  });

  it("pendiente cuando no hay payout todavía (nunca liquidoEsperado=0 confundido con $0 real)", () => {
    const transactions = [{ id: "tx-1", transactionCode: "COD-3", grossAmount: 5000, refundedAmount: 0, localDate: "2026-09-12" }];
    const days = buildDailySettlementAggregates("offerings", transactions, new Map(), "net");
    expect(days[0].linkStatus).toBe("pending");
    expect(days[0].depositado).toBeNull();
    expect(days[0].comisionSumUp).toBe(0);
  });

  it("cobertura parcial: algunas ventas del día tienen payout y otras no", () => {
    const transactions = [
      { id: "tx-1", transactionCode: "COD-4", grossAmount: 1000, refundedAmount: 0, localDate: "2026-09-13" },
      { id: "tx-2", transactionCode: "COD-5", grossAmount: 2000, refundedAmount: 0, localDate: "2026-09-13" },
    ];
    const row = normalizePayoutRow(
      { id: "row-4", type: "PAYOUT", status: "SUCCESSFUL", date: "2026-09-14", reference: "REF4", transaction_code: "COD-4", amount: 966, fee: 34 },
      { account: "offerings", merchantCode: "MC1" },
    );
    const linkedRowsByCode = new Map([["COD-4", [row]]]);
    const days = buildDailySettlementAggregates("offerings", transactions, linkedRowsByCode, "net");
    expect(days[0].linkStatus).toBe("partial");
    expect(days[0].txLinked).toBe(1);
    expect(days[0].txPending).toBe(1);
  });

  it("dailyLinkStatus: 0 de n es pending, k de n (0<k<n) es partial, n de n es complete", () => {
    expect(dailyLinkStatus({ n: 3, linked: 0 })).toBe("pending");
    expect(dailyLinkStatus({ n: 3, linked: 2 })).toBe("partial");
    expect(dailyLinkStatus({ n: 3, linked: 3 })).toBe("complete");
  });

  it("M4: transacciones excluidas (no SUCCESSFUL/REFUNDED) no suman al bruto pero sí se reportan en txExcluded", () => {
    // Solo COD-4 llega aquí como transacción "settleable" — la CANCELLED
    // nunca entra a este array (la excluye getTransactionsInWindow antes),
    // y su conteo llega por separado vía extras.excludedByDate.
    const transactions = [{ id: "tx-1", transactionCode: "COD-4", grossAmount: 1000, refundedAmount: 0, localDate: "2026-09-13" }];
    const row = normalizePayoutRow(
      { id: "row-4", type: "PAYOUT", status: "SUCCESSFUL", date: "2026-09-14", reference: "REF4", transaction_code: "COD-4", amount: 966, fee: 34 },
      { account: "offerings", merchantCode: "MC1" },
    );
    const linkedRowsByCode = new Map([["COD-4", [row]]]);
    const days = buildDailySettlementAggregates("offerings", transactions, linkedRowsByCode, "net", {
      excludedByDate: { "2026-09-13": 2 },
    });
    expect(days[0].bruto).toBe(1000); // la excluida nunca suma al bruto
    expect(days[0].txCount).toBe(1);
    expect(days[0].txExcluded).toBe(2);
  });

  it("M4: un día sin ninguna transacción settleable, solo excluidas, sigue apareciendo (nunca desaparece silenciosamente)", () => {
    const days = buildDailySettlementAggregates("offerings", [], new Map(), "net", {
      excludedByDate: { "2026-09-20": 3 },
    });
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-09-20");
    expect(days[0].bruto).toBe(0);
    expect(days[0].txExcluded).toBe(3);
  });
});

describe("reembolso antes/después del payout y contracargo", () => {
  it("un reembolso ANTES del payout ya reduce el gross usado para votar (G')", () => {
    // La transacción ya refleja el reembolso (grossAmount se mantiene como el
    // bruto original en providerSnapshot; refundedAmount es lo devuelto).
    const { vote } = detectBasisVote({ payoutAmount: 4660, payoutFee: 340, gross: 10000, refunded: 5000 });
    // amount+fee = 5000 = G' (10000-5000), no coincide con G (10000).
    expect(vote).toBe("net");
  });

  it("una fila CHARGE_BACK_DEDUCTION con comisión queda en revisión y no se computa como settlement de una venta", () => {
    const row = normalizePayoutRow(
      { id: "cb-1", type: "CHARGE_BACK_DEDUCTION", status: "SUCCESSFUL", date: "2026-09-15", reference: "REF-CB", amount: -5000, fee: 200 },
      { account: "offerings", merchantCode: "MC1" },
    );
    expect(row.review).toBe(true);
    // Deduction rows are excluded from linkedRowsByCode by the caller (they
    // are never type PAYOUT), so they never reach computeTransactionSettlements.
  });
});

describe("computeDeductionsByPayoutDate", () => {
  it("agrupa deducciones por la fecha del payout, no por día de venta", () => {
    const rows = [
      normalizePayoutRow(
        { id: "d1", type: "BALANCE_DEDUCTION", status: "SUCCESSFUL", date: "2026-09-20", amount: -1000, fee: 0 },
        { account: "offerings", merchantCode: "MC1" },
      ),
      normalizePayoutRow(
        { id: "d2", type: "REFUND_DEDUCTION", status: "SUCCESSFUL", date: "2026-09-20", reference: "R", amount: -500, fee: 20 },
        { account: "offerings", merchantCode: "MC1" },
      ),
    ];
    const map = computeDeductionsByPayoutDate(rows);
    expect(map.get("2026-09-20").count).toBe(2);
    expect(map.get("2026-09-20").totalAmount).toBe(-1500);
    expect(map.get("2026-09-20").totalFee).toBe(20);
  });

  it("no incluye filas que no están en revisión", () => {
    const row = normalizePayoutRow(
      { id: "p1", type: "PAYOUT", status: "SUCCESSFUL", date: "2026-09-20", reference: "R", transaction_code: "COD-1", amount: 1000, fee: 40 },
      { account: "offerings", merchantCode: "MC1" },
    );
    const map = computeDeductionsByPayoutDate([row]);
    expect(map.size).toBe(0);
  });
});

describe("computeAccountTotals (compatibilidad con la sonda G9)", () => {
  it("sigue calculando % de comisión efectiva", () => {
    const totals = computeAccountTotals([
      { bruto: 1000, reembolsado: 0, comision: 34, liquido: 966 },
      { bruto: 1000, reembolsado: 0, comision: 34, liquido: 966 },
    ]);
    expect(totals.bruto).toBe(2000);
    expect(totals.comision).toBe(68);
    expect(totals.pctComisionEfectiva).toBeCloseTo(3.4, 1);
  });
});
