// @vitest-environment node
// Lógica pura de la conciliación de abonos SumUp (lib/shared/sumup-payouts.ts, doc 29).
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as P from "@/lib/shared/sumup-payouts";
import type { ReconcileInput, SaleRecord } from "@/lib/shared/sumup-payouts";
import { OCT_WINDOW, cafeteriaCase, groupedOfferingsCase, row, sale } from "./sumup-payouts-fixtures";

const require = createRequire(import.meta.url);
const PJs = require("../../functions/shared/sumup-payouts.js") as typeof P;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

function input(over: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    accounts: ["offerings", "cafeteria"],
    rowsByAccount: {},
    salesByAccount: {},
    period: OCT_WINDOW,
    asOfDate: "2026-10-20",
    ...over,
  };
}

function account(result: P.ReconcileResult, a: P.SumupAccount) {
  const r = result.accounts.find((x) => x.account === a);
  if (!r) throw new Error(`sin cuenta ${a}`);
  return r;
}

/** Tres ventas normales de Ofrendas que fijan la base "net" en los casos chicos. */
function basisAnchors(date = "2026-10-05", payout = "2026-10-06", ref = "FICT ANCHOR") {
  const grosses = [10000, 20000, 30000];
  const fees = [345, 690, 1035];
  return {
    sales: grosses.map((g, i) => sale("offerings", `ANC${i}`, date, g)),
    rows: grosses.map((g, i) => row(`ANC${i}`, g - fees[i], fees[i], payout, ref, { id: `anc-${i}` })),
  };
}

describe("caso Cafetería: 88 ventas, $462.500 → abono $446.532 (comisión $15.968)", () => {
  const { sales, rows, fees } = cafeteriaCase();
  const result = P.reconcile(input({ accounts: ["cafeteria"], rowsByAccount: { cafeteria: rows }, salesByAccount: { cafeteria: sales } }));
  const caf = account(result, "cafeteria");

  it("fixture: 88 filas, Σ bruto/comisión exactos y amount + fee = bruto en el 100 %", () => {
    expect(rows).toHaveLength(88);
    expect(fees.reduce((a, b) => a + b, 0)).toBe(15_968);
    expect(sales.reduce((a, s) => a + s.grossAmount, 0)).toBe(462_500);
  });

  it("un solo abono CONCILIADO, base net con 88 votos", () => {
    expect(caf.basis).toEqual({ basis: "net", reason: null, tally: { net: 88, gross: 0, ambiguous: 0, mismatch: 0 } });
    expect(caf.settlements).toHaveLength(1);
    const s = caf.settlements[0];
    expect(s).toMatchObject({
      account: "cafeteria",
      payoutDate: "2026-10-13",
      status: "CONCILIADO",
      grossSales: 462_500,
      fee: 15_968,
      feeConfirmed: true,
      netPaid: 446_532,
      adjustments: 0,
      deductions: 0,
      refundsBeforePayout: 0,
      residual: 0,
      difference: 15_968,
      linkedSalesCount: 88,
      saleDays: ["2026-10-11"],
      inWindow: true,
      unlinkedRowCount: 0,
    });
    expect(s.reasons).toEqual([]);
    expect(s.referenceShort).toBe("…FE0001");
  });

  it("nada pendiente de abono", () => {
    expect(caf.pendingAmount).toBe(0);
    expect(caf.pendingDays).toEqual([]);
  });

  it("una propuesta de comisión, idempotente, sin escribir el libro", () => {
    expect(caf.proposals).toHaveLength(1);
    const p = caf.proposals[0];
    expect(p.id).toMatch(/^sumup_fee_cafeteria_2026-10-13_[0-9a-f]{12}$/);
    expect(p).toMatchObject({
      type: "expense",
      category: "Comisiones SumUp",
      amount: 15_968,
      accountingDate: "2026-10-13",
      policy: "payout_date",
      state: "propuesta",
      writesLedger: false,
      previousAmount: null,
      saleDates: ["2026-10-11"],
    });
    expect(p.id).toBe(P.feeProposalId("cafeteria", "2026-10-13", "FICT PID CAFE 0001"));
  });

  it("totales de la cuenta y generales", () => {
    expect(caf.totals).toMatchObject({ settlements: 1, grossSales: 462_500, fee: 15_968, feeComplete: true, netPaid: 446_532, difference: 15_968, pendingAmount: 0 });
    expect(result.totals.byStatus.CONCILIADO).toBe(1);
  });
});

describe("abono agrupado (dos días de venta en un depósito)", () => {
  const { sales, rows, day10, day11, fees } = groupedOfferingsCase();
  const base = input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: sales } });

  it("un abono que cubre 10-10 y 11-10: $100.522 − $3.352 = $97.170", () => {
    const s = account(P.reconcile(base), "offerings").settlements;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ grossSales: 100_522, fee: 3_352, netPaid: 97_170, status: "CONCILIADO", saleDays: ["2026-10-10", "2026-10-11"], linkedSalesCount: 23 });
    expect(s[0].byDay.map((d) => [d.saleDate, d.sales, d.gross])).toEqual([
      ["2026-10-10", 10, day10.reduce((a, b) => a + b, 0)],
      ["2026-10-11", 13, day11.reduce((a, b) => a + b, 0)],
    ]);
  });

  it("política sale_date: una propuesta por día de venta, suma = comisión del abono", () => {
    const r = account(P.reconcile({ ...base, options: { accountingDatePolicy: "sale_date" } }), "offerings");
    expect(r.proposals.map((p) => p.accountingDate)).toEqual(["2026-10-10", "2026-10-11"]);
    expect(r.proposals.reduce((a, p) => a + p.amount, 0)).toBe(3_352);
    expect(r.proposals[0].amount).toBe(fees.slice(0, 10).reduce((a, b) => a + b, 0));
    expect(new Set(r.proposals.map((p) => p.id)).size).toBe(2);
    for (const p of r.proposals) expect(p.id.startsWith(P.feeProposalId("offerings", "2026-10-13", "FICT PID OFR 0001"))).toBe(true);
  });

  it("política payout_date (por defecto): una sola propuesta con fecha del abono", () => {
    const r = account(P.reconcile(base), "offerings");
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ amount: 3_352, accountingDate: "2026-10-13", saleDates: ["2026-10-10", "2026-10-11"] });
  });
});

describe("pendientes y abonos parciales", () => {
  it("ventas sin fila de abono → PENDIENTE por día, monto = bruto (nunca $0 de comisión)", () => {
    const anchors = basisAnchors();
    const pending = [sale("offerings", "P1", "2026-10-18", 7000), sale("offerings", "P2", "2026-10-18", 3000), sale("offerings", "P3", "2026-10-19", 5000)];
    const r = account(
      P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: anchors.rows }, salesByAccount: { offerings: [...anchors.sales, ...pending] } })),
      "offerings",
    );
    expect(r.pendingAmount).toBe(15_000);
    expect(r.pendingSales).toBe(3);
    expect(r.pendingDays).toEqual([
      { account: "offerings", saleDate: "2026-10-18", salesCount: 2, amount: 10_000, status: "PENDIENTE", inProgressCount: 0, failedCount: 0 },
      { account: "offerings", saleDate: "2026-10-19", salesCount: 1, amount: 5_000, status: "PENDIENTE", inProgressCount: 0, failedCount: 0 },
    ]);
    expect(r.proposals.every((p) => p.saleDates.every((d) => d !== "2026-10-18"))).toBe(true);
  });

  it("abono parcial: 3 de 5 ventas del día pagadas → abono por 3 y 2 siguen pendientes", () => {
    const anchors = basisAnchors();
    const day = [4000, 5000, 6000, 7000, 8000].map((g, i) => sale("offerings", `D${i}`, "2026-10-12", g));
    const paid = day.slice(0, 3).map((s, i) => row(s.transactionCode, s.grossAmount - 100 - i, 100 + i, "2026-10-14", "FICT PART", { id: `p-${i}` }));
    const r = account(
      P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: [...anchors.rows, ...paid] }, salesByAccount: { offerings: [...anchors.sales, ...day] } })),
      "offerings",
    );
    const s = r.settlements.find((x) => x.reference === "FICT PART")!;
    expect(s).toMatchObject({ grossSales: 15_000, fee: 303, netPaid: 14_697, status: "CONCILIADO", saleDays: ["2026-10-12"] });
    expect(r.pendingDays).toEqual([expect.objectContaining({ saleDate: "2026-10-12", salesCount: 2, amount: 15_000 })]);
  });

  it("el efectivo registrado en SumUp nunca queda 'pendiente de abono'", () => {
    const r = account(
      P.reconcile(input({ accounts: ["offerings"], salesByAccount: { offerings: [sale("offerings", "C1", "2026-10-12", 9000, { paymentType: "CASH" })] } })),
      "offerings",
    );
    expect(r.pendingAmount).toBe(0);
  });

  it("ventas reembolsadas por completo no quedan pendientes; las parciales cuentan su saldo", () => {
    const sales = [
      sale("offerings", "R1", "2026-10-12", 9000, { refundedAmount: 9000, status: "REFUNDED" }),
      sale("offerings", "R2", "2026-10-12", 9000, { refundedAmount: 4000 }),
    ];
    const r = account(P.reconcile(input({ accounts: ["offerings"], salesByAccount: { offerings: sales } })), "offerings");
    expect(r.pendingAmount).toBe(5000);
  });

  it("ventas fuera de la ventana (lookback) no se cuentan como pendientes", () => {
    const r = account(P.reconcile(input({ accounts: ["offerings"], salesByAccount: { offerings: [sale("offerings", "OLD", "2026-09-28", 9000)] } })), "offerings");
    expect(r.pendingAmount).toBe(0);
  });
});

describe("devoluciones, contracargos y deducciones", () => {
  it("devolución ANTES del abono: la fila paga bruto − reembolso → ajuste visible y CONCILIADO", () => {
    const anchors = basisAnchors();
    const s = sale("offerings", "RB", "2026-10-12", 10_000, { refundedAmount: 4000 });
    const r = account(
      P.reconcile(
        input({
          accounts: ["offerings"],
          rowsByAccount: { offerings: [...anchors.rows, row("RB", 6000 - 207, 207, "2026-10-14", "FICT RB")] },
          salesByAccount: { offerings: [...anchors.sales, s] },
        }),
      ),
      "offerings",
    );
    const st = r.settlements.find((x) => x.reference === "FICT RB")!;
    expect(st).toMatchObject({ grossSales: 10_000, refundsBeforePayout: 4000, adjustments: -4000, fee: 207, netPaid: 5793, residual: 0, status: "CONCILIADO" });
    expect(st.reasons).toEqual(["refunds_before_payout"]);
  });

  it("devolución DESPUÉS del abono: fila REFUND_DEDUCTION en un abono posterior → deducción negativa, REQUIERE REVISIÓN", () => {
    const anchors = basisAnchors();
    const s = sale("offerings", "RA", "2026-10-12", 10_000, { refundedAmount: 4000 });
    const rows = [
      ...anchors.rows,
      row("RA", 10_000 - 345, 345, "2026-10-13", "FICT RA1"),
      row("RA", 4000, 0, "2026-10-16", "FICT RA2", { id: "ded-1", type: "REFUND_DEDUCTION" }),
    ];
    const r = account(P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: [...anchors.sales, s] } })), "offerings");
    const first = r.settlements.find((x) => x.reference === "FICT RA1")!;
    const ded = r.settlements.find((x) => x.reference === "FICT RA2")!;
    expect(first.status).toBe("CONCILIADO");
    expect(ded).toMatchObject({ status: "REQUIERE_REVISION", deductions: -4000, adjustments: -4000, netPaid: -4000, grossSales: 0, feeConfirmed: false });
    expect(ded.reasons).toContain("deductions_present");
    // El abono de la deducción no genera propuesta de comisión (fee 0, sin previa).
    expect(r.proposals.some((p) => p.settlementId === ded.id)).toBe(false);
  });

  it("contracargo (CHARGE_BACK_DEDUCTION, monto ya negativo) → deducción, revisión, sin propuesta confirmada", () => {
    const anchors = basisAnchors();
    const rows = [...anchors.rows, row("ANC0", -10_000, 150, "2026-10-15", "FICT CB", { id: "cb-1", type: "CHARGE_BACK_DEDUCTION" })];
    const r = account(P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: anchors.sales } })), "offerings");
    const cb = r.settlements.find((x) => x.reference === "FICT CB")!;
    expect(cb).toMatchObject({ status: "REQUIERE_REVISION", deductions: -10_000, fee: 150 });
    expect(r.proposals.find((p) => p.settlementId === cb.id)?.state).toBe("sin_confirmar");
  });

  it("deducción sin transaction_code (BALANCE_DEDUCTION) → revisión", () => {
    const anchors = basisAnchors();
    const rows = [...anchors.rows, row(null, 2000, 0, "2026-10-15", "FICT BAL", { id: "bal-1", type: "BALANCE_DEDUCTION" })];
    const r = account(P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: anchors.sales } })), "offerings");
    expect(r.settlements.find((x) => x.reference === "FICT BAL")).toMatchObject({ status: "REQUIERE_REVISION", deductions: -2000 });
  });
});

describe("comisiones corregidas, reruns e idempotencia", () => {
  const { sales, rows } = cafeteriaCase();
  const base = input({ accounts: ["cafeteria"], rowsByAccount: { cafeteria: rows }, salesByAccount: { cafeteria: sales } });
  const id = P.feeProposalId("cafeteria", "2026-10-13", "FICT PID CAFE 0001");

  it("rerun con la misma entrada → resultado idéntico (mismos ids y montos)", () => {
    expect(P.reconcile(base)).toEqual(P.reconcile(base));
  });

  it("orden de filas distinto y filas repetidas → misma propuesta y mismo monto", () => {
    const shuffled = [...rows].reverse();
    const repeated = [...rows, ...rows.slice(0, 20)];
    const a = account(P.reconcile(base), "cafeteria").proposals;
    const b = account(P.reconcile({ ...base, rowsByAccount: { cafeteria: shuffled } }), "cafeteria").proposals;
    const c = account(P.reconcile({ ...base, rowsByAccount: { cafeteria: repeated } }), "cafeteria");
    expect(b).toEqual(a);
    expect(c.proposals).toEqual(a);
    expect(c.rowStats).toMatchObject({ fetched: 108, used: 88, duplicatesIgnored: 20, duplicateConflicts: 0 });
    expect(c.settlements[0].status).toBe("CONCILIADO");
  });

  it("ventanas solapadas que ven el mismo abono → mismo id y monto", () => {
    const w1 = account(P.reconcile({ ...base, period: { startDate: "2026-10-01", endDate: "2026-10-20" } }), "cafeteria").proposals;
    const w2 = account(P.reconcile({ ...base, period: { startDate: "2026-10-10", endDate: "2026-10-31" } }), "cafeteria").proposals;
    expect(w1.map((p) => [p.id, p.amount])).toEqual([[id, 15_968]]);
    expect(w2.map((p) => [p.id, p.amount])).toEqual([[id, 15_968]]);
  });

  it("ya registrada con el mismo monto → 'ya_registrada' (no se duplica)", () => {
    const p = account(P.reconcile({ ...base, options: { previousProposals: { [id]: { amount: 15_968 } } } }), "cafeteria").proposals[0];
    expect(p).toMatchObject({ state: "ya_registrada", amount: 15_968, previousAmount: 15_968 });
  });

  it("comisión corregida por SumUp → 'revision' con monto anterior y nuevo", () => {
    const p = account(P.reconcile({ ...base, options: { previousProposals: { [id]: { amount: 15_900 } } } }), "cafeteria").proposals[0];
    expect(p).toMatchObject({ state: "revision", amount: 15_968, previousAmount: 15_900 });
  });

  it("misma fila (id) con contenido distinto en una corrida → conflicto, revisión, no se suma dos veces", () => {
    const changed = { ...rows[0], fee: Number(rows[0].fee) + 10, amount: Number(rows[0].amount) - 10 };
    const r = account(P.reconcile({ ...base, rowsByAccount: { cafeteria: [...rows, changed] } }), "cafeteria");
    expect(r.rowStats.duplicateConflicts).toBe(1);
    expect(r.settlements[0]).toMatchObject({ status: "REQUIERE_REVISION", fee: 15_968, feeConfirmed: false });
    expect(r.settlements[0].reasons).toContain("duplicate_conflict");
    expect(r.proposals[0].state).toBe("sin_confirmar");
  });

  it("la misma venta pagada por dos filas distintas → revisión (posible doble abono)", () => {
    const dup = { ...rows[0], id: "otro-id" };
    const r = account(P.reconcile({ ...base, rowsByAccount: { cafeteria: [...rows, dup] } }), "cafeteria");
    expect(r.settlements[0].status).toBe("REQUIERE_REVISION");
    expect(r.settlements[0].reasons).toContain("sale_paid_twice");
  });

  it("no muta la entrada (congelada)", () => {
    expect(() => P.reconcile(deepFreeze(structuredClone(base)))).not.toThrow();
  });
});

describe("abonos fallidos y en proceso", () => {
  it("FAILED → REQUIERE REVISIÓN, excluido de comisiones, la venta vuelve a 'pendiente de abono'", () => {
    const anchors = basisAnchors();
    const s = sale("offerings", "F1", "2026-10-12", 8000);
    const rows = [...anchors.rows, row("F1", 8000 - 276, 276, "2026-10-14", "FICT FAIL", { status: "FAILED" })];
    const r = account(P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: [...anchors.sales, s] } })), "offerings");
    const st = r.settlements.find((x) => x.reference === "FICT FAIL")!;
    expect(st).toMatchObject({ status: "REQUIERE_REVISION", statusClass: "failed", feeConfirmed: false });
    expect(st.reasons).toContain("payout_failed");
    const p = r.proposals.find((x) => x.settlementId === st.id)!;
    expect(p).toMatchObject({ state: "excluida", amount: 0 });
    expect(p.id).not.toBe(P.feeProposalId("offerings", "2026-10-14", "FICT FAIL"));
    expect(r.pendingDays).toEqual([expect.objectContaining({ saleDate: "2026-10-12", amount: 8000, failedCount: 1 })]);
  });

  it("PENDING (en proceso) → PENDIENTE, comisión sin confirmar, venta pendiente de abono", () => {
    const anchors = basisAnchors();
    const s = sale("offerings", "IP", "2026-10-12", 8000);
    const rows = [...anchors.rows, row("IP", 8000 - 276, 276, "2026-10-14", "FICT IP", { status: "PENDING" })];
    const r = account(P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: [...anchors.sales, s] } })), "offerings");
    const st = r.settlements.find((x) => x.reference === "FICT IP")!;
    expect(st.status).toBe("PENDIENTE");
    expect(st.reasons).toContain("payout_in_progress");
    expect(r.proposals.find((x) => x.settlementId === st.id)?.state).toBe("sin_confirmar");
    expect(r.pendingDays[0]).toMatchObject({ inProgressCount: 1, amount: 8000 });
  });

  it("estado desconocido → REQUIERE REVISIÓN", () => {
    const anchors = basisAnchors();
    const rows = [...anchors.rows.slice(0, 2), { ...anchors.rows[2], status: "WEIRD" }];
    const r = account(P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: anchors.sales } })), "offerings");
    expect(r.settlements.some((x) => x.status === "REQUIERE_REVISION" && x.reasons.includes("status_unknown"))).toBe(true);
  });
});

describe("cuentas múltiples aisladas", () => {
  it("cada cuenta con su base, sus abonos y sus propuestas", () => {
    const caf = cafeteriaCase();
    const ofr = groupedOfferingsCase();
    const r = P.reconcile(
      input({ rowsByAccount: { offerings: ofr.rows, cafeteria: caf.rows }, salesByAccount: { offerings: ofr.sales, cafeteria: caf.sales } }),
    );
    expect(account(r, "offerings").settlements.map((s) => [s.grossSales, s.fee, s.status])).toEqual([[100_522, 3_352, "CONCILIADO"]]);
    expect(account(r, "cafeteria").settlements.map((s) => [s.grossSales, s.fee, s.status])).toEqual([[462_500, 15_968, "CONCILIADO"]]);
    expect(r.totals).toMatchObject({ grossSales: 563_022, fee: 19_320, netPaid: 543_702, settlements: 2 });
    expect(account(r, "offerings").proposals[0].id).toMatch(/^sumup_fee_offerings_/);
    expect(account(r, "cafeteria").proposals[0].id).toMatch(/^sumup_fee_cafeteria_/);
  });

  it("fila de Ofrendas que apunta a una venta de Cafetería → revisión solo en Ofrendas", () => {
    const caf = cafeteriaCase();
    const anchors = basisAnchors();
    const stray = row(caf.sales[0].transactionCode, 1000, 30, "2026-10-14", "FICT STRAY", { id: "stray" });
    const r = P.reconcile(
      input({
        rowsByAccount: { offerings: [...anchors.rows, stray], cafeteria: caf.rows },
        salesByAccount: { offerings: anchors.sales, cafeteria: caf.sales },
      }),
    );
    const st = account(r, "offerings").settlements.find((s) => s.reference === "FICT STRAY")!;
    expect(st.status).toBe("REQUIERE_REVISION");
    expect(st.reasons).toContain("rows_other_account");
    expect(account(r, "cafeteria").settlements[0].status).toBe("CONCILIADO");
  });
});

describe("base, moneda, redondeo y filas sin vincular", () => {
  it("menos de 3 votos → base indeterminada → REQUIERE REVISIÓN y comisión sin confirmar", () => {
    const s = [sale("offerings", "A", "2026-10-12", 10_000), sale("offerings", "B", "2026-10-12", 20_000)];
    const rows = [row("A", 9655, 345, "2026-10-13", "FICT 2"), row("B", 19_310, 690, "2026-10-13", "FICT 2")];
    const r = account(P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: s } })), "offerings");
    expect(r.basis).toMatchObject({ basis: "indeterminate", reason: "insufficient_evidence" });
    expect(r.settlements[0]).toMatchObject({ status: "REQUIERE_REVISION", feeConfirmed: false, fee: 1035 });
    expect(r.settlements[0].reasons).toContain("basis_indeterminate");
    expect(r.proposals[0].state).toBe("sin_confirmar");
  });

  it("una fila que no cuadra ni neta ni bruta → mismatch → base indeterminada", () => {
    const anchors = basisAnchors();
    const bad = [sale("offerings", "X", "2026-10-12", 10_000)];
    const rows = [...anchors.rows, row("X", 5000, 100, "2026-10-13", "FICT X")];
    const r = account(P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: [...anchors.sales, ...bad] } })), "offerings");
    expect(r.basis.reason).toBe("mismatch_present");
    expect(r.settlements.every((s) => s.status === "REQUIERE_REVISION")).toBe(true);
  });

  it("votos net y gross en desacuerdo → indeterminada", () => {
    expect(P.aggregateBasisVotes(["net", "net", "gross", "net"]).reason).toBe("votes_disagree");
    expect(P.aggregateBasisVotes(["net", "net", "net", "ambiguous"]).basis).toBe("net");
    expect(P.aggregateBasisVotes(["ambiguous", "ambiguous", "ambiguous"]).reason).toBe("insufficient_evidence");
  });

  it("moneda distinta de CLP o ausente → revisión (nunca se convierte)", () => {
    const anchors = basisAnchors();
    const s = sale("offerings", "U", "2026-10-12", 10_000);
    for (const currency of ["USD", undefined]) {
      const rows = [...anchors.rows, row("U", 9655, 345, "2026-10-13", "FICT USD", { currency })];
      const r = account(P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: [...anchors.sales, s] } })), "offerings");
      const st = r.settlements.find((x) => x.reference === "FICT USD")!;
      expect(st.status).toBe("REQUIERE_REVISION");
      expect(st.reasons).toContain("currency_issue");
    }
  });

  it("redondeo documentado: entero más cercano, mitades lejos de cero", () => {
    expect(P.roundClp(100.5)).toBe(101);
    expect(P.roundClp(-2.5)).toBe(-3);
    expect(P.roundClp(99.4)).toBe(99);
    expect(P.roundClp("1500")).toBe(1500);
    expect(P.roundClp(null)).toBeNull();
    expect(P.roundClp("abc")).toBeNull();
    const parsed = P.parsePayoutRow({ id: "d", amount: 9654.6, fee: 345.4, currency: "CLP", date: "2026-10-13", reference: "R", status: "SUCCESSFUL", type: "PAYOUT", transaction_code: "A" }, "offerings");
    expect(parsed).toMatchObject({ amount: 9655, fee: 345, rounded: true, issues: [] });
  });

  it("filas sin transaction_code o con código desconocido → revisión", () => {
    const anchors = basisAnchors();
    const rows = [...anchors.rows, row(null, 1000, 30, "2026-10-14", "FICT NC", { id: "nc" }), row("ZZZ", 1000, 30, "2026-10-14", "FICT NF", { id: "nf" })];
    const r = account(P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: anchors.sales } })), "offerings");
    expect(r.settlements.find((s) => s.reference === "FICT NC")!.reasons).toContain("rows_without_code");
    expect(r.settlements.find((s) => s.reference === "FICT NF")!.reasons).toContain("rows_not_found");
  });

  it("fila sin comisión → comisión null ('sin confirmar'), nunca $0", () => {
    const anchors = basisAnchors();
    const s = sale("offerings", "NF", "2026-10-12", 10_000);
    const rows = [...anchors.rows, row("NF", 9655, null, "2026-10-14", "FICT NOFEE")];
    const r = account(P.reconcile(input({ accounts: ["offerings"], rowsByAccount: { offerings: rows }, salesByAccount: { offerings: [...anchors.sales, s] } })), "offerings");
    const st = r.settlements.find((x) => x.reference === "FICT NOFEE")!;
    expect(st.fee).toBeNull();
    expect(st.feeConfirmed).toBe(false);
    expect(st.status).toBe("REQUIERE_REVISION");
  });
});

describe("diferencia residual: plazo en días hábiles (parámetro N)", () => {
  // Cada fila paga 1 peso menos que bruto − comisión (dentro de la tolerancia de base).
  const grosses = [10_000, 20_000, 30_000];
  const sales = grosses.map((g, i) => sale("offerings", `Q${i}`, "2026-10-08", g));
  const rows = grosses.map((g, i) => row(`Q${i}`, g - 300 - 1, 300, "2026-10-09", "FICT DIFF", { id: `q${i}` }));
  const at = (asOfDate: string, differenceBusinessDays?: number, holidays?: string[]) =>
    account(
      P.reconcile(input({ accounts: ["offerings"], asOfDate, rowsByAccount: { offerings: rows }, salesByAccount: { offerings: sales }, options: { differenceBusinessDays, holidays } })),
      "offerings",
    ).settlements[0];

  it("dentro del plazo → PENDIENTE; después → CON DIFERENCIA", () => {
    expect(at("2026-10-14")).toMatchObject({ residual: -3, status: "PENDIENTE", businessDaysSincePayout: 3 });
    expect(at("2026-10-16")).toMatchObject({ status: "CON_DIFERENCIA", businessDaysSincePayout: 5 });
    expect(at("2026-10-14", 3).status).toBe("CON_DIFERENCIA");
  });

  it("feriados no cuentan como días hábiles", () => {
    expect(P.businessDaysBetween("2026-10-09", "2026-10-16")).toBe(5);
    expect(P.businessDaysBetween("2026-10-09", "2026-10-16", ["2026-10-12"])).toBe(4);
    expect(at("2026-10-16", 5, ["2026-10-12"]).status).toBe("PENDIENTE");
    expect(P.businessDaysBetween("2026-10-11", "2026-10-11")).toBe(0);
  });

  it("la diferencia nunca se etiqueta como comisión: fee viene solo de las filas", () => {
    const s = at("2026-10-20");
    expect(s.fee).toBe(900);
    expect(s.difference).toBe(903);
    expect(s.difference).not.toBe(s.fee);
  });
});

describe("invariantes del libro: solo propuestas de gasto, nunca ingreso", () => {
  const caf = cafeteriaCase();
  const ofr = groupedOfferingsCase();
  const result = P.reconcile(
    input({ rowsByAccount: { offerings: ofr.rows, cafeteria: caf.rows }, salesByAccount: { offerings: ofr.sales, cafeteria: caf.sales } }),
  );

  it("todas las propuestas son gasto 'Comisiones SumUp' con writesLedger false", () => {
    const all = result.accounts.flatMap((a) => a.proposals);
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) expect(p).toMatchObject({ type: "expense", category: "Comisiones SumUp", writesLedger: false });
  });

  it("Σ propuestas = Σ comisiones del proveedor; el abono neto no aparece como ingreso", () => {
    const all = result.accounts.flatMap((a) => a.proposals);
    expect(all.reduce((a, p) => a + p.amount, 0)).toBe(result.totals.fee);
    const json = JSON.stringify(result);
    expect(json).not.toContain('"income"');
    expect(all.some((p) => p.amount === result.totals.netPaid)).toBe(false);
  });

  it("el bruto de las ventas (ingreso del libro) no cambia", () => {
    const before = structuredClone(caf.sales);
    P.reconcile(input({ rowsByAccount: { cafeteria: caf.rows }, salesByAccount: { cafeteria: caf.sales } }));
    expect(caf.sales).toEqual(before);
  });
});

describe("planWindow", () => {
  it("valida fechas, orden y máximo 35 días", () => {
    expect(P.planWindow("2026-10-01", "2026-11-04", "2026-12-01")).toMatchObject({ ok: true });
    expect(P.planWindow("2026-10-01", "2026-11-05", "2026-12-01")).toEqual({ ok: false, error: "window_too_long" });
    expect(P.planWindow("2026-10-10", "2026-10-01", "2026-12-01")).toEqual({ ok: false, error: "end_before_start" });
    expect(P.planWindow("2026-02-30", "2026-03-01", "2026-12-01")).toEqual({ ok: false, error: "invalid_dates" });
    expect(P.planWindow(undefined, "2026-03-01", "2026-12-01")).toEqual({ ok: false, error: "invalid_dates" });
  });

  it("abonos con lookahead (tope hoy) y ventas con lookback", () => {
    const a = P.planWindow("2026-10-01", "2026-10-31", "2026-12-01");
    expect(a).toEqual({
      ok: true,
      plan: {
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        payoutFetch: { startDate: "2026-10-01", endDate: "2026-11-10" },
        salesRead: { startDate: "2026-09-21", endDate: "2026-10-31" },
      },
    });
    const b = P.planWindow("2026-10-01", "2026-10-31", "2026-10-13");
    expect(b.ok && b.plan.payoutFetch).toEqual({ startDate: "2026-10-01", endDate: "2026-10-13" });
    const future = P.planWindow("2026-11-01", "2026-11-30", "2026-10-13");
    expect(future.ok && future.plan.payoutFetch).toBeNull();
  });

  it("chileDate usa America/Santiago", () => {
    expect(P.chileDate(Date.parse("2026-10-12T02:30:00.000Z"))).toBe("2026-10-11");
    expect(P.chileDate(Date.parse("2026-10-12T03:30:00.000Z"))).toBe("2026-10-12");
  });
});

describe("abonos posteriores a la ventana", () => {
  it("se muestran si pagan ventas de la ventana, pero no suman en los totales", () => {
    const anchors = basisAnchors("2026-10-05", "2026-10-06");
    const late = sale("offerings", "L1", "2026-10-31", 10_000);
    const rows = [...anchors.rows, row("L1", 9655, 345, "2026-11-03", "FICT LATE")];
    const r = account(
      P.reconcile(input({ accounts: ["offerings"], asOfDate: "2026-11-10", rowsByAccount: { offerings: rows }, salesByAccount: { offerings: [...anchors.sales, late] } })),
      "offerings",
    );
    const st = r.settlements.find((s) => s.reference === "FICT LATE")!;
    expect(st).toMatchObject({ afterWindow: true, inWindow: false, status: "CONCILIADO" });
    expect(r.totals.grossSales).toBe(60_000);
    expect(r.pendingAmount).toBe(0);
  });

  it("abonos posteriores que solo pagan ventas fuera de la ventana no se incluyen", () => {
    const anchors = basisAnchors("2026-11-02", "2026-11-03");
    const r = account(
      P.reconcile(input({ accounts: ["offerings"], asOfDate: "2026-11-10", rowsByAccount: { offerings: anchors.rows }, salesByAccount: { offerings: anchors.sales } })),
      "offerings",
    );
    expect(r.settlements).toEqual([]);
  });
});

describe("paridad TS ↔ CJS (functions/shared/sumup-payouts.js)", () => {
  it("reconcile da exactamente lo mismo", () => {
    const caf = cafeteriaCase();
    const ofr = groupedOfferingsCase();
    const extra: SaleRecord[] = [sale("offerings", "P1", "2026-10-18", 7000)];
    const inp = input({
      rowsByAccount: { offerings: [...ofr.rows, row(null, 10, 0, "2026-10-15", "FICT B", { type: "BALANCE_DEDUCTION", id: "b" })], cafeteria: caf.rows },
      salesByAccount: { offerings: [...ofr.sales, ...extra], cafeteria: caf.sales },
      options: { accountingDatePolicy: "sale_date" },
    });
    expect(PJs.reconcile(inp)).toEqual(P.reconcile(inp));
    expect(PJs.shortHash("abc")).toBe(P.shortHash("abc"));
  });
});
