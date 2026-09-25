// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
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
} from "../scripts/lib/payouts-probe-core.mjs";

describe("maskApiKey", () => {
  it("nunca expone la clave completa", () => {
    const masked = maskApiKey("sup_sk_1234567890abcdef");
    expect(masked).not.toContain("1234567890abcdef");
    expect(masked.startsWith("sup")).toBe(true);
  });

  it("maneja claves vacías o muy cortas sin lanzar", () => {
    expect(maskApiKey("")).toBe("(vacío)");
    expect(maskApiKey("ab")).toBe("**");
  });
});

describe("detectBasisVote", () => {
  it("vota 'net' cuando amount+fee ≈ bruto", () => {
    const { vote } = detectBasisVote({ payoutAmount: 9700, payoutFee: 300, gross: 10000, refunded: 0 });
    expect(vote).toBe("net");
  });

  it("vota 'gross' cuando amount ≈ bruto (fee ya restado aparte)", () => {
    const { vote } = detectBasisVote({ payoutAmount: 10000, payoutFee: 300, gross: 10000, refunded: 0 });
    expect(vote).toBe("gross");
  });

  it("vota 'ambiguous' cuando fee es 0 (neto y bruto coinciden)", () => {
    const { vote } = detectBasisVote({ payoutAmount: 10000, payoutFee: 0, gross: 10000, refunded: 0 });
    expect(vote).toBe("ambiguous");
  });

  it("vota 'mismatch' cuando ninguna fórmula cuadra", () => {
    const { vote } = detectBasisVote({ payoutAmount: 5000, payoutFee: 300, gross: 10000, refunded: 0 });
    expect(vote).toBe("mismatch");
  });

  it("usa G' (bruto - reembolso) cuando la transacción tuvo reembolso parcial", () => {
    // gross 10000, refunded 2000 -> G' = 8000; payout net of that.
    const { vote } = detectBasisVote({ payoutAmount: 7700, payoutFee: 300, gross: 10000, refunded: 2000 });
    expect(vote).toBe("net");
  });
});

describe("aggregateBasisVotes", () => {
  it("acepta 'net' con >=3 votos net y ningún mismatch/gross", () => {
    const result = aggregateBasisVotes(["net", "net", "net", "ambiguous"]);
    expect(result.basis).toBe("net");
  });

  it("es indeterminada con menos de 3 votos contables", () => {
    const result = aggregateBasisVotes(["net", "net", "ambiguous"]);
    expect(result.basis).toBe("indeterminada");
    expect(result.reason).toBe("evidencia_insuficiente");
  });

  it("es indeterminada si hay al menos un mismatch", () => {
    const result = aggregateBasisVotes(["net", "net", "net", "mismatch"]);
    expect(result.basis).toBe("indeterminada");
    expect(result.reason).toBe("mismatch_presente");
  });

  it("es indeterminada si net y gross empatan votos en desacuerdo", () => {
    const result = aggregateBasisVotes(["net", "net", "gross", "gross"]);
    expect(result.basis).toBe("indeterminada");
    expect(result.reason).toBe("votos_en_desacuerdo");
  });
});

describe("buildTransactionIndex + linkPayoutRow", () => {
  const index = buildTransactionIndex({
    offerings: [{ transactionCode: "OFF-1" }, { transactionCode: "OFF-2" }],
    cafeteria: [{ transactionCode: "CAF-1" }],
  });

  it("vincula una fila cuyo transaction_code existe en la cuenta correcta", () => {
    const result = linkPayoutRow({ transaction_code: "OFF-1" }, "offerings", index);
    expect(result.status).toBe("linked");
  });

  it("marca 'other_account' cuando el código pertenece a otra cuenta (mezcla ofrendas/cafetería)", () => {
    const result = linkPayoutRow({ transaction_code: "CAF-1" }, "offerings", index);
    expect(result.status).toBe("other_account");
    expect(result.account).toBe("cafeteria");
  });

  it("marca 'not_found' cuando el código no existe en ninguna cuenta importada", () => {
    const result = linkPayoutRow({ transaction_code: "GHOST-1" }, "offerings", index);
    expect(result.status).toBe("not_found");
  });

  it("marca 'no_code' cuando la fila no trae transaction_code (p.ej. deducción global)", () => {
    const result = linkPayoutRow({ transaction_code: "" }, "offerings", index);
    expect(result.status).toBe("no_code");
  });
});

describe("computeIdUniqueness", () => {
  it("detecta ids duplicados sin asumir unicidad", () => {
    const rows = [
      { id: "p1", transaction_code: "A" },
      { id: "p1", transaction_code: "B" },
      { id: "p2", transaction_code: "C" },
    ];
    const result = computeIdUniqueness(rows);
    expect(result.totalRows).toBe(3);
    expect(result.uniqueIds).toBe(2);
    expect(result.duplicateIds).toBe(1);
    expect(result.duplicatePairs).toBe(0);
  });
});

describe("tallyByField", () => {
  it("cuenta filas por type y por status", () => {
    const rows = [
      { type: "PAYOUT", status: "SUCCESSFUL" },
      { type: "PAYOUT", status: "SUCCESSFUL" },
      { type: "REFUND_DEDUCTION", status: "SUCCESSFUL" },
    ];
    expect(tallyByField(rows, "type")).toEqual({ PAYOUT: 2, REFUND_DEDUCTION: 1 });
    expect(tallyByField(rows, "status")).toEqual({ SUCCESSFUL: 3 });
  });
});

describe("aggregateByDay", () => {
  it("agrega bruto/comisión/líquido por día de venta y marca pendientes sin payout vinculado", () => {
    const transactions = [
      { transactionCode: "A", grossAmount: 10000, refundedAmount: 0, localDate: "2026-09-01" },
      { transactionCode: "B", grossAmount: 5000, refundedAmount: 0, localDate: "2026-09-01" },
      { transactionCode: "C", grossAmount: 3000, refundedAmount: 0, localDate: "2026-09-02" },
    ];
    const linkedRowsByCode = new Map([
      ["A", [{ amount: 9700, fee: 300, date: "2026-09-03", reference: "PO-1" }]],
      ["B", [{ amount: 4850, fee: 150, date: "2026-09-03", reference: "PO-1" }]],
      // C has no linked payout row yet -> pending.
    ]);

    const days = aggregateByDay(transactions, linkedRowsByCode, "net");

    const day1 = days.find((d) => d.day === "2026-09-01");
    expect(day1.n).toBe(2);
    expect(day1.bruto).toBe(15000);
    expect(day1.comision).toBe(450);
    expect(day1.liquido).toBe(14550);
    expect(day1.pagadoSegunBase).toBe(9700 + 4850);
    expect(day1.pendientes).toBe(0);
    expect(day1.payoutRefs).toEqual([{ date: "2026-09-03", reference: "PO-1" }]);

    const day2 = days.find((d) => d.day === "2026-09-02");
    expect(day2.n).toBe(1);
    expect(day2.pendientes).toBe(1);
    expect(day2.comision).toBe(0);
    expect(day2.liquido).toBe(3000);
  });

  it("resta reembolsos del líquido y no aplica pagadoSegunBase cuando la base es indeterminada", () => {
    const transactions = [
      { transactionCode: "A", grossAmount: 10000, refundedAmount: 2000, localDate: "2026-09-05" },
    ];
    const linkedRowsByCode = new Map([
      ["A", [{ amount: 7700, fee: 300, date: "2026-09-06", reference: "PO-2" }]],
    ]);
    const days = aggregateByDay(transactions, linkedRowsByCode, "indeterminada");
    expect(days[0].liquido).toBe(10000 - 2000 - 300);
    expect(days[0].pagadoSegunBase).toBeNull();
  });
});

describe("aggregateByPayout", () => {
  it("agrupa por reference, suma monto/comisión y cuenta transacciones únicas, incluyendo deducciones", () => {
    const rows = [
      { id: "1", type: "PAYOUT", amount: 100000, fee: 3000, date: "2026-09-10", reference: "PO-A", transaction_code: "A" },
      { id: "2", type: "PAYOUT", amount: 100000, fee: 3000, date: "2026-09-10", reference: "PO-A", transaction_code: "B" },
      { id: "3", type: "REFUND_DEDUCTION", amount: -5000, fee: 0, date: "2026-09-10", reference: "PO-A", transaction_code: "C" },
      { id: "4", type: "PAYOUT", amount: 20000, fee: 500, date: "2026-09-15", reference: null, transaction_code: "D" },
    ];

    const { payouts, rowsInReview } = aggregateByPayout(rows);

    const poA = payouts.find((p) => p.reference === "PO-A");
    expect(poA.montoPagado).toBe(200000);
    expect(poA.comision).toBe(6000);
    expect(poA.nTransacciones).toBe(3);
    expect(poA.typeTally).toEqual({ PAYOUT: 2, REFUND_DEDUCTION: 1 });

    expect(rowsInReview).toHaveLength(1);
    expect(rowsInReview[0].reason).toBe("sin_reference");
  });
});

describe("computeAccountTotals", () => {
  it("suma bruto/comisión/líquido y calcula % comisión efectiva", () => {
    const dayAggregates = [
      { bruto: 10000, reembolsado: 0, comision: 300, liquido: 9700 },
      { bruto: 5000, reembolsado: 1000, comision: 150, liquido: 3850 },
    ];
    const totals = computeAccountTotals(dayAggregates);
    expect(totals.bruto).toBe(15000);
    expect(totals.comision).toBe(450);
    expect(totals.liquido).toBe(13550);
    expect(totals.pctComisionEfectiva).toBeCloseTo((450 / 15000) * 100, 5);
  });

  it("devuelve % comisión null cuando bruto es 0 (evita división por cero)", () => {
    const totals = computeAccountTotals([]);
    expect(totals.pctComisionEfectiva).toBeNull();
  });
});

describe("buildDepositsList", () => {
  it("solo incluye grupos que efectivamente pagaron algo, ordenados por fecha", () => {
    const groups = [
      { reference: "PO-B", date: "2026-09-15", montoPagado: 20000 },
      { reference: "PO-A", date: "2026-09-10", montoPagado: 195000 },
      { reference: "PO-C", date: "2026-09-20", montoPagado: 0 },
    ];
    const deposits = buildDepositsList(groups);
    expect(deposits.map((d) => d.reference)).toEqual(["PO-A", "PO-B"]);
    expect(deposits[0].montoNeto).toBe(195000);
  });
});
