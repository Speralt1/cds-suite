import { describe, expect, it } from "vitest";
import { dayStatus as prodDayStatus, incomeByMethod as prodIncomeByMethod } from "@/lib/finance/insights";
import type { FinanceTransaction } from "@/lib/finance/types";
import {
  CAMPAIGNS,
  CASH_SESSIONS,
  DEMO_TODAY,
  DEPOSITS,
  PAYOUTS,
  TRANSACTIONS,
} from "@/lib/finance-preview/fixtures";
import {
  AVAILABLE_MONTHS,
  attentionItems,
  canCloseWithDifference,
  dayStatus,
  datesOfMonth,
  filterMovements,
  groupMovements,
  headlineMetrics,
  incomeByMethod,
  incomeBySource,
  NO_FILTERS,
  parsePeriod,
  payoutNet,
  periodSummary,
  reconciliationState,
  reportNarrative,
  rowActions,
  sessionDifference,
  sessionToDeposit,
  shiftMonth,
  summarize,
  totalsStrip,
  transactionsIn,
  type Period,
} from "@/lib/finance-preview/selectors";
import { SOURCE, SPLIT_DATE, type DemoTransaction } from "@/lib/finance-preview/types";

const SEP: Period = { view: "month", year: 2026, month: 9 };
const OCT: Period = { view: "month", year: 2026, month: 10 };
const YEAR: Period = { view: "year", year: 2026 };

/** Adapta un movimiento del preview al tipo de producción (solo campos que leen las funciones puras). */
function toProd(t: DemoTransaction): FinanceTransaction {
  return {
    id: t.origin === "sumup" ? `sumup_${t.id}` : t.id,
    type: t.type,
    amount: t.amount,
    category: t.category,
    paymentMethod: t.method,
    description: t.description,
    source: t.source,
    status: t.status,
    revision: 1,
    createdBy: t.origin === "sumup" ? "system:sumup" : "user_demo",
    updatedBy: "user_demo",
    period: t.date.slice(0, 7),
    day: t.date.slice(8, 10),
    createdAt: undefined as never,
    updatedAt: undefined as never,
    date: undefined as never,
  };
}

describe("fixtures del preview", () => {
  it("son deterministas y suficientes para gráficos y tablas creíbles", () => {
    expect(TRANSACTIONS.length).toBeGreaterThan(500);
    expect(new Set(TRANSACTIONS.map((t) => t.id)).size).toBe(TRANSACTIONS.length);
    expect(TRANSACTIONS.every((t) => Number.isInteger(t.amount) && t.amount > 0)).toBe(true);
  });

  it("incluyen los casos borde pedidos", () => {
    expect(TRANSACTIONS.some((t) => t.status === "voided" && t.origin === "manual")).toBe(true);
    expect(TRANSACTIONS.some((t) => t.refund && t.status === "voided")).toBe(true);
    expect(TRANSACTIONS.some((t) => t.possibleDuplicateOf)).toBe(true);
    expect(TRANSACTIONS.some((t) => t.category === SOURCE.legacy)).toBe(true);
    expect(DEPOSITS.some((d) => !d.linkedTo)).toBe(true);
    expect(PAYOUTS.some((p) => p.fee === null)).toBe(true);
    expect(CASH_SESSIONS.some((s) => s.state === "reopened" && s.version === 2)).toBe(true);
  });

  it("el histórico sin separar existe solo antes del 09/09 y Ofrendas/Cafetería SumUp solo desde esa fecha", () => {
    for (const t of TRANSACTIONS.filter((x) => x.origin === "sumup")) {
      if (t.category === SOURCE.legacy) expect(t.date < SPLIT_DATE).toBe(true);
      else expect(t.date >= SPLIT_DATE).toBe(true);
    }
  });
});

describe("invariantes financieros", () => {
  it("I1 · Σ por método = total de ingresos (y coincide con la lógica de producción)", () => {
    for (const p of [SEP, OCT]) {
      const { rows, total } = incomeByMethod(p);
      expect(rows.reduce((a, r) => a + r.amount, 0)).toBe(total);
      const prod = prodIncomeByMethod(transactionsIn(p).map(toProd));
      expect(prod.total).toBe(total);
      expect(prod.sumUpAmount).toBe(rows.find((r) => r.key === "sumup")?.amount ?? 0);
    }
  });

  it("I2 · Σ por fuente = total de ingresos, en mes y en año", () => {
    for (const p of [SEP, OCT, YEAR, { view: "month", year: 2026, month: 3 } as Period]) {
      const { rows, total } = incomeBySource(p);
      expect(rows.reduce((a, r) => a + r.amount, 0)).toBe(total);
    }
  });

  it("I3 · Hoy, Movimientos y Reportes usan el mismo total", () => {
    const metric = headlineMetrics(SEP).find((m) => m.id === "income")!.value;
    const strip = totalsStrip(transactionsIn(SEP)).income;
    expect(metric).toBe(strip);
    expect(reportNarrative(SEP)).toContain(new Intl.NumberFormat("es-CL").format(metric));
  });

  it("I4 · lo anulado no suma pero sigue visible", () => {
    const items = transactionsIn(OCT);
    const voided = items.filter((t) => t.status === "voided");
    expect(voided.length).toBeGreaterThan(0);
    const withoutVoided = summarize(items.filter((t) => t.status === "active"));
    expect(summarize(items).expense).toBe(withoutVoided.expense);
    expect(filterMovements(items, { ...NO_FILTERS, status: "voided" })).toHaveLength(voided.length);
  });

  it("I5 · el reembolso SumUp queda como anulado propio, no restado del bruto en silencio", () => {
    const refund = TRANSACTIONS.find((t) => t.refund)!;
    const entries = groupMovements(transactionsIn(SEP));
    const g = entries.find((e) => e.kind === "group" && e.items.some((i) => i.id === refund.id));
    expect(g?.kind === "group" && g.status).toBe("voided");
    expect(g?.kind === "group" && g.label).toMatch(/reembolsados/);
  });

  it("I6 · no hay líquido sin comisión real", () => {
    for (const p of PAYOUTS) {
      if (p.fee === null) {
        expect(payoutNet(p)).toBeNull();
        expect(reconciliationState(p)).toBe("pending");
      } else expect(payoutNet(p)).toBe(p.gross - p.refunds - p.fee);
    }
  });

  it("I8 · Ofrendas y Cafetería nunca se suman: el desglose SumUp las lista por separado", () => {
    const sumup = incomeByMethod(SEP).rows.find((r) => r.key === "sumup")!;
    expect(sumup.label).toBe("Tarjeta SumUp · bruto");
    expect(sumup.hint).toMatch(/Ofrendas .* · Cafetería .* · Histórico sin separar/);
    const s = periodSummary(SEP);
    expect(s.sumUpByAccount.ofrendas + s.sumUpByAccount.cafeteria + s.sumUpByAccount.legacy).toBe(s.sumUpGross);
  });

  it("I9/I10 · Falta efectivo coincide con producción en días pasados y nunca antes del 09/09", () => {
    const prodItems = TRANSACTIONS.map(toProd);
    for (const date of [...datesOfMonth("2026-09"), ...datesOfMonth("2026-10")].filter((d) => d < DEMO_TODAY)) {
      const mine = dayStatus(date).missingCash.map((m) => (m.area === "ofrendas" ? "Ofrendas" : "Cafetería"));
      const prod = prodDayStatus(date, prodItems, DEMO_TODAY).missingCashAreas;
      expect(mine, date).toEqual(prod);
      if (date < SPLIT_DATE) expect(mine).toEqual([]);
    }
    expect(dayStatus("2026-09-30").missingCash.map((m) => m.area)).toEqual(["cafeteria"]);
    expect(dayStatus("2026-09-23").noRecords).toBe(true);
  });

  it("I10b · hoy no se marca Falta efectivo si la caja del área sigue abierta o en conteo", () => {
    expect(dayStatus(DEMO_TODAY).missingCash).toEqual([]);
  });

  it("I12 · Diezmos es parte de Ingresos, no una cuarta métrica paralela", () => {
    const metrics = headlineMetrics(SEP);
    expect(metrics.map((m) => m.id)).toEqual(["income", "expense", "result"]);
    expect(metrics[0].composition).toMatch(/^Incluye diezmos/);
    expect(periodSummary(SEP).incomeByCategory[SOURCE.diezmos]).toBe(periodSummary(SEP).tithes);
  });

  it("I13 · las campañas no entran al libro", () => {
    const campaignTotal = CAMPAIGNS.reduce((a, c) => a + c.verified, 0);
    expect(campaignTotal).toBeGreaterThan(0);
    expect(TRANSACTIONS.some((t) => /campaña|techo/i.test(t.category))).toBe(false);
  });

  it("I14 · Conciliado solo con depósito vinculado por el monto exacto", () => {
    for (const p of PAYOUTS) {
      const state = reconciliationState(p);
      if (state === "reconciled") {
        const linked = DEPOSITS.filter((d) => p.depositIds.includes(d.id));
        expect(linked.length).toBeGreaterThan(0);
        expect(linked.reduce((a, d) => a + d.amount, 0)).toBe(payoutNet(p));
      }
      expect(state).toBe(p.state); // los datos de ejemplo no contradicen la regla
    }
  });

  it("I15/I16 · caja: diferencia derivada, A depositar = contado − fondo, y toda diferencia exige motivo", () => {
    const ofr = CASH_SESSIONS.find((s) => s.id === "caja-ofr-0927")!;
    expect(sessionDifference(ofr)).toBe(-4_500);
    const caf = CASH_SESSIONS.find((s) => s.id === "caja-caf-0927")!;
    expect(sessionToDeposit(caf)).toBe(118_000);
    expect(caf.ledgerCash).toBe(sessionToDeposit(caf));
    expect(canCloseWithDifference(-4_500, "")).toBe(false);
    expect(canCloseWithDifference(-4_500, "  ")).toBe(false);
    expect(canCloseWithDifference(-4_500, "Billete contado dos veces")).toBe(true);
    expect(canCloseWithDifference(0, "")).toBe(true);
  });

  it("I17 · SumUp es solo lectura: nunca Editar ni Anular", () => {
    for (const t of TRANSACTIONS.filter((x) => x.origin === "sumup")) {
      const actions = rowActions(t);
      expect(actions).not.toContain("editar");
      expect(actions).not.toContain("anular");
    }
  });

  it("agrupar Movimientos conserva la suma y es determinista", () => {
    const items = transactionsIn(SEP);
    const entries = groupMovements(items);
    const sum = (xs: readonly DemoTransaction[]) => xs.reduce((a, t) => a + t.amount, 0);
    const entriesSum = entries.reduce((a, e) => a + (e.kind === "group" ? e.amount : e.tx.amount), 0);
    expect(entriesSum).toBe(sum(items));
    expect(groupMovements([...items].reverse()).map((e) => e.key)).toEqual(entries.map((e) => e.key));
    expect(entries.length).toBeLessThan(items.length / 5);
  });

  it("Resultado del período nunca se presenta como saldo y advierte la comisión pendiente", () => {
    const result = headlineMetrics(SEP).find((m) => m.id === "result")!;
    expect(result.label).not.toMatch(/saldo/i);
    expect(result.composition).toMatch(/No representa el saldo bancario/);
    expect(result.note).toMatch(/comisión SumUp/);
  });

  it("la comparación con agosto se marca como no homogénea (diezmos no registrados antes)", () => {
    expect(headlineMetrics(SEP)[0].comparabilityNote).toMatch(/No homogénea/);
    expect(reportNarrative(SEP)).toMatch(/no es homogénea/);
  });

  it("el mes en curso se compara contra el mismo rango de días del mes anterior, nunca contra el mes completo", () => {
    const [income] = headlineMetrics(OCT);
    expect(income.comparisonLabel).toBe("vs 1–4 sep");
    const sep1to4 = transactionsIn(SEP).filter((t) => t.status === "active" && t.type === "income" && t.date <= "2026-09-04");
    expect(income.previous).toBe(sep1to4.reduce((a, t) => a + t.amount, 0));
    expect(income.previous).not.toBe(periodSummary(SEP).income);
  });
});

describe("período y atención", () => {
  it("solo ofrece meses con datos", () => {
    expect(AVAILABLE_MONTHS[0]).toBe("2026-01");
    expect(AVAILABLE_MONTHS.at(-1)).toBe("2026-10");
    expect(shiftMonth(OCT, 1)).toBeNull();
    expect(parsePeriod("2031-01")).toEqual(OCT);
    expect(parsePeriod("2026")).toEqual(YEAR);
  });

  it("la cola de atención sigue el orden de grupos y marca lo que es propuesta", () => {
    const items = attentionItems();
    const groups = items.map((i) => i.group);
    expect(groups[0]).toBe("integration");
    expect(groups.indexOf("records")).toBeLessThan(groups.indexOf("duplicate"));
    expect(items.find((i) => i.group === "records")?.proposal).toBe(false);
    expect(items.filter((i) => ["link", "difference", "deposit", "duplicate"].includes(i.group)).every((i) => i.proposal)).toBe(true);
    // ningún hecho aparece dos veces
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});
