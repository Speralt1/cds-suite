// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import { buildReport } from "@/lib/finance/reports";
import { createFinancePdf } from "@/lib/finance/report-pdf";
import { emptySummary, applyImpact } from "@/lib/finance/calculations";
import { parseDate, periodId } from "@/lib/finance/formatters";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/finance/constants";
import type { FinanceTransaction, PeriodSelection } from "@/lib/finance/types";
const monthly: PeriodSelection = { year: 2026, month: 8, view: "month" };
const stamp = Timestamp.fromDate(new Date("2026-08-31T12:00:00Z"));
const tithe: FinanceTransaction = {
  id: "private-id",
  type: "income",
  amount: 55000,
  date: parseDate("2026-08-10"),
  period: "2026-08",
  day: "10",
  category: "Diezmos",
  paymentMethod: "transfer",
  description: "Nombre confidencial",
  note: "Nota pastoral confidencial",
  source: "tithe",
  status: "active",
  revision: 1,
  createdBy: "private-uid",
  createdAt: stamp,
  updatedBy: "private-uid",
  updatedAt: stamp,
};
it("reporte usa lista segura de campos, sin identidad o notas del diezmo", () => {
  const s = applyImpact(emptySummary("2026-08"), tithe, 1);
  const r = buildReport(monthly, [s], [tithe], "Tesorería", stamp.toDate());
  expect(r.rows[0].description).toBe("Diezmo");
  const json = JSON.stringify(r);
  for (const word of [
    "confidencial",
    "private-id",
    "private-uid",
    "profileId",
    "note",
    "createdBy",
  ])
    expect(json).not.toContain(word);
  expect(r.filename).toBe("CDS_Finanzas_2026-08.pdf");
});
it("bloquea informe parcial o aún desincronizado", () => {
  expect(() => buildReport(monthly, [], [tithe], "Admin")).toThrow(
    "sincronizando",
  );
  expect(() =>
    buildReport(
      monthly,
      [],
      Array.from({ length: 10000 }, () => tithe),
      "Admin",
    ),
  ).toThrow("10.000");
});
it("genera PDF A4 con datos reales de prueba, anual y vacío", () => {
  const fixtures: FinanceTransaction[] = Array.from({ length: 180 }, (_, i) => {
    const month = (i % 12) + 1,
      day = (i % 28) + 1;
    const income = i % 3 !== 0;
    const source = i % 7 === 0 ? "tithe" : "general";
    const category =
      source === "tithe"
        ? "Diezmos"
        : income
          ? INCOME_CATEGORIES[i % 5]
          : EXPENSE_CATEGORIES[i % 11];
    return {
      ...tithe,
      id: `fixture-${i}`,
      source,
      type: source === "tithe" || income ? "income" : "expense",
      category,
      description:
        source === "tithe"
          ? "PERSONA PRIVADA"
          : `Registro de prueba ${i + 1} - actividad comunitaria, revisión de materiales y servicios del período.`,
      amount: 12500 + i * 3500,
      status: i % 19 === 0 ? "voided" : "active",
      period: periodId(2026, month),
      day: String(day),
      date: parseDate(
        `${periodId(2026, month)}-${String(day).padStart(2, "0")}`,
      ),
    };
  });
  const summaries = Array.from({ length: 12 }, (_, i) =>
    fixtures
      .filter((t) => t.period === periodId(2026, i + 1))
      .reduce(
        (s, t) => applyImpact(s, t, 1),
        emptySummary(periodId(2026, i + 1)),
      ),
  );
  const inputs = [
    buildReport(
      monthly,
      summaries,
      fixtures.filter((t) => t.period === "2026-08"),
      "Tesorería de prueba",
      stamp.toDate(),
    ),
    buildReport(
      { ...monthly, view: "year" },
      summaries,
      fixtures,
      "Administración de prueba",
      stamp.toDate(),
    ),
    buildReport({ ...monthly, year: 2025 }, [], [], "Admin", stamp.toDate()),
  ];
  for (const report of inputs) {
    const pdf = createFinancePdf(report);
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(4);
    const content = pdf.output("arraybuffer");
    expect(content.byteLength).toBeGreaterThan(3000);
    if (process.env.PDF_QA_DIR) {
      mkdirSync(process.env.PDF_QA_DIR, { recursive: true });
      writeFileSync(
        `${process.env.PDF_QA_DIR}/${report.filename}`,
        new Uint8Array(content),
      );
    }
  }
});

// September 2026 fixture matching the spec's worked example dates
// (SPLIT = 2026-09-09, 13/16/20 sep). No expenses, so A3 always fires.
function sept(day: string): FinanceTransaction["date"] {
  return parseDate(`2026-09-${day}`);
}
function septTx(
  overrides: Partial<FinanceTransaction> & { day: string; amount: number },
): FinanceTransaction {
  const { day, ...rest } = overrides;
  return {
    ...tithe,
    id: `tx_${Math.random()}`,
    ...rest,
    period: "2026-09",
    date: sept(day.padStart(2, "0")),
    day: String(Number(day)),
  };
}
function clpText(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

const septemberFixture: FinanceTransaction[] = [
  septTx({
    id: "tithe_1",
    day: "5",
    amount: 200000,
    category: "Diezmos",
    paymentMethod: "transfer",
    source: "tithe",
    type: "income",
    description: "Diezmo",
  }),
  septTx({
    id: "sumup_off_16",
    day: "16",
    amount: 45000,
    category: "Ofrendas",
    paymentMethod: "card",
    source: "general",
    type: "income",
    createdBy: "system:sumup",
    description: "SumUp Ofrendas",
  }),
  septTx({
    id: "sumup_cafe_16",
    day: "16",
    amount: 210000,
    category: "Cafetería",
    paymentMethod: "card",
    source: "general",
    type: "income",
    createdBy: "system:sumup",
    description: "SumUp Cafetería",
  }),
  septTx({
    id: "cafe_cash_13",
    day: "13",
    amount: 30000,
    category: "Cafetería",
    paymentMethod: "cash",
    source: "general",
    type: "income",
    description: "Cafetería efectivo",
  }),
  septTx({
    id: "sumup_legacy_3",
    day: "3",
    amount: 80000,
    category: "SumUp histórico sin separar",
    paymentMethod: "card",
    source: "general",
    type: "income",
    createdBy: "system:sumup",
    description: "SumUp histórico",
  }),
  septTx({
    id: "off_cash_20",
    day: "20",
    amount: 20000,
    category: "Ofrendas",
    paymentMethod: "cash",
    source: "general",
    type: "income",
    description: "Ofrendas efectivo",
  }),
];
const septemberPeriod: PeriodSelection = { year: 2026, month: 9, view: "month" };
const septemberSummary = septemberFixture.reduce(
  (s, t) => applyImpact(s, t, 1),
  emptySummary("2026-09"),
);
const TODAY = "2026-09-22";

it("septiembre 2026: narrative incluye cifras, sin gastos, y sin comparación cuando no hay mes anterior", () => {
  const r = buildReport(
    septemberPeriod,
    [septemberSummary],
    septemberFixture,
    "Tesorería",
    new Date("2026-09-22T12:00:00Z"),
    { today: TODAY },
  );
  expect(r.narrative).toContain(clpText(r.summary.incomeTotal));
  expect(r.narrative).toContain("No se registraron gastos.");
  expect(r.narrative).toContain("No hay datos del mes anterior para comparar.");
  expect(r.narrative).toContain(`Hay ${r.alerts.revisar.length} alertas para revisar`);
});

it("septiembre 2026: comparación con mes anterior dice subieron o bajaron", () => {
  const lowerPrevious = septemberSummary.incomeTotal / 2;
  const previousSummary = { ...emptySummary("2026-08"), incomeTotal: lowerPrevious };
  const r = buildReport(
    septemberPeriod,
    [septemberSummary],
    septemberFixture,
    "Tesorería",
    new Date("2026-09-22T12:00:00Z"),
    { today: TODAY, previousSummaries: [previousSummary] },
  );
  expect(r.comparison.available).toBe(true);
  expect(r.comparison.variationPercent).toBeGreaterThan(0);
  expect(r.narrative).toMatch(/subieron un [\d,.]+ %/);
});

it("septiembre 2026: byMethod suma igual al total y al incomeTotal", () => {
  const r = buildReport(
    septemberPeriod,
    [septemberSummary],
    septemberFixture,
    "Tesorería",
    new Date("2026-09-22T12:00:00Z"),
    { today: TODAY },
  );
  const sum = r.byMethod.rows.reduce((s, row) => s + row.amount, 0);
  expect(sum).toBe(r.byMethod.total);
  expect(r.byMethod.total).toBe(r.summary.incomeTotal);
});

it("septiembre 2026: alertas A1/A2/A3/A4/A5 con textos exactos y orden correcto", () => {
  const r = buildReport(
    septemberPeriod,
    [septemberSummary],
    septemberFixture,
    "Tesorería",
    new Date("2026-09-22T12:00:00Z"),
    { today: TODAY },
  );
  const revisarTexts = r.alerts.revisar.map((a) => a.text);
  expect(revisarTexts).toContain("Sin registros — 9 sep (día de culto).");
  expect(revisarTexts).toContain(
    "Falta efectivo · Ofrendas — 16 sep: SumUp $45.000 en bruto, sin efectivo registrado.",
  );
  expect(revisarTexts).toContain(
    "Falta efectivo · Cafetería — 16 sep: SumUp $210.000 en bruto, sin efectivo registrado.",
  );
  expect(revisarTexts[revisarTexts.length - 1]).toBe(
    "No se registraron gastos en el mes — verificar si faltan egresos.",
  );
  // Chronological before the period-level A3.
  expect(revisarTexts.indexOf("Sin registros — 9 sep (día de culto).")).toBeLessThan(
    revisarTexts.indexOf(
      "Falta efectivo · Ofrendas — 16 sep: SumUp $45.000 en bruto, sin efectivo registrado.",
    ),
  );

  const infoTexts = r.alerts.info.map((a) => a.text);
  expect(infoTexts[0]).toBe(
    "Los montos SumUp están en bruto: la comisión aún no está disponible, por lo que lo depositado será menor.",
  );
  expect(infoTexts[1]).toBe(
    "SumUp histórico sin separar (03/09): $80.000. No se atribuye a Ofrendas ni Cafetería.",
  );
});

it("sin alertas de revisión: usa el texto de reemplazo (mes limpio, con gastos)", () => {
  const cleanFixture: FinanceTransaction[] = [
    septTx({
      id: "clean_income",
      day: "1",
      amount: 10000,
      category: "Ofrendas",
      paymentMethod: "transfer",
      source: "general",
      type: "income",
      description: "Transferencia",
    }),
    septTx({
      id: "clean_expense",
      day: "1",
      amount: 5000,
      category: "Administración",
      paymentMethod: "transfer",
      source: "general",
      type: "expense",
      description: "Gasto de prueba",
    }),
  ];
  const cleanSummary = cleanFixture.reduce(
    (s, t) => applyImpact(s, t, 1),
    emptySummary("2026-09"),
  );
  const r = buildReport(
    septemberPeriod,
    [cleanSummary],
    cleanFixture,
    "Tesorería",
    new Date("2026-09-01T12:00:00Z"),
    { today: "2026-09-01" },
  );
  expect(r.alerts.revisar).toHaveLength(0);
});

// M1 (Atlas): "No comparable" depends on the PREVIOUS month, not the current
// one. SumUp only started separating areas on 09/09/2026, so any previous
// month up to and including September 2026 (even 1-8 sept) is not
// comparable; from October onward as the previous month it is comparable.
function areaTx(period: string, day: string, amount: number): FinanceTransaction {
  return {
    ...tithe,
    id: `area_${period}_${day}_${Math.random()}`,
    period,
    day,
    date: parseDate(`${period}-${day.padStart(2, "0")}`),
    category: "Ofrendas",
    paymentMethod: "transfer",
    source: "general",
    type: "income",
    amount,
    description: "Ofrendas",
  };
}
function summaryFor(period: string, items: FinanceTransaction[]) {
  return items
    .filter((t) => t.period === period)
    .reduce((s, t) => applyImpact(s, t, 1), emptySummary(period));
}

it("M1: mes anterior septiembre u octubre 2026 -> Ofrendas/Cafetería no comparable", () => {
  // Report for October 2026; previous month is September 2026 (<= "2026-09").
  const octTx = [areaTx("2026-10", "5", 100000)];
  const sepTx = [areaTx("2026-09", "5", 90000)];
  const r = buildReport(
    { year: 2026, month: 10, view: "month" },
    [summaryFor("2026-10", octTx)],
    octTx,
    "Tesorería",
    new Date("2026-10-15T12:00:00Z"),
    {
      today: "2026-10-15",
      previousTransactions: sepTx,
      previousSummaries: [summaryFor("2026-09", sepTx)],
    },
  );
  const ofrendas = r.bySource.find((row) => row.category === "Ofrendas");
  expect(ofrendas?.notComparable).toBe(true);
  expect(ofrendas?.previousTotal).toBeNull();

  // Report for September 2026; previous month is August 2026 (<= "2026-09").
  const rSept = buildReport(
    septemberPeriod,
    [septemberSummary],
    septemberFixture,
    "Tesorería",
    new Date("2026-09-22T12:00:00Z"),
    {
      today: TODAY,
      previousTransactions: [areaTx("2026-08", "5", 50000)],
      previousSummaries: [summaryFor("2026-08", [areaTx("2026-08", "5", 50000)])],
    },
  );
  const ofrendasSept = rSept.bySource.find((row) => row.category === "Ofrendas");
  expect(ofrendasSept?.notComparable).toBe(true);
});

it("M1: mes anterior noviembre en adelante -> Ofrendas/Cafetería comparable", () => {
  // Report for November 2026; previous month is October 2026 ("2026-10" > "2026-09").
  const novTx = [areaTx("2026-11", "5", 120000)];
  const octTx = [areaTx("2026-10", "5", 100000)];
  const r = buildReport(
    { year: 2026, month: 11, view: "month" },
    [summaryFor("2026-11", novTx)],
    novTx,
    "Tesorería",
    new Date("2026-11-15T12:00:00Z"),
    {
      today: "2026-11-15",
      previousTransactions: octTx,
      previousSummaries: [summaryFor("2026-10", octTx)],
    },
  );
  const ofrendas = r.bySource.find((row) => row.category === "Ofrendas");
  expect(ofrendas?.notComparable).toBe(false);
  expect(ofrendas?.previousTotal).toBe(100000);
});

it("días de culto: estado 'Con ingresos'/'—' (sin lenguaje de cuadre) y solo incluye días fuera de culto con ingresos de área", () => {
  const r = buildReport(
    septemberPeriod,
    [septemberSummary],
    septemberFixture,
    "Tesorería",
    new Date("2026-09-22T12:00:00Z"),
    { today: TODAY },
  );
  const statusLabels = r.worshipDays.map((d) => d.statusLabel);
  expect(statusLabels).not.toContain("OK");
  // Day 20 (sunday, >= split) has cash income and no missing-cash issue.
  const day20 = r.worshipDays.find((d) => d.date === "2026-09-20");
  expect(day20?.statusLabel).toBe("Con ingresos");
  // Every worship day up to today must be present even without income.
  expect(r.worshipDays.some((d) => d.date === "2026-09-09")).toBe(true);
  // Day 5 (friday, not a worship day) only appears because of the tithe,
  // which is not Ofrendas/Cafetería area income, so it must be excluded.
  expect(r.worshipDays.some((d) => d.date === "2026-09-05")).toBe(false);
  // Day 3 (thursday, not worship) has legacy SumUp but not area income either.
  expect(r.worshipDays.some((d) => d.date === "2026-09-03")).toBe(false);
});

it("por fuente: 'mes anterior' es null (se muestra como '—') cuando no hay datos del mes anterior, no $0", () => {
  const r = buildReport(
    septemberPeriod,
    [septemberSummary],
    septemberFixture,
    "Tesorería",
    new Date("2026-09-22T12:00:00Z"),
    { today: TODAY }, // no previousTransactions/previousSummaries at all
  );
  for (const row of r.bySource) expect(row.previousTotal).toBeNull();
});

it("vista anual: lista los meses sin gastos registrados", () => {
  const yearFixture: FinanceTransaction[] = [
    { ...tithe, id: "y1", period: "2026-01", day: "5", date: parseDate("2026-01-05"), amount: 50000, category: "Diezmos", paymentMethod: "transfer", source: "tithe", type: "income" },
    { ...tithe, id: "y2", period: "2026-02", day: "5", date: parseDate("2026-02-05"), amount: 40000, category: "Diezmos", paymentMethod: "transfer", source: "tithe", type: "income" },
    { ...tithe, id: "y2e", period: "2026-02", day: "6", date: parseDate("2026-02-06"), amount: 10000, category: "Administración", paymentMethod: "transfer", source: "general", type: "expense" },
  ];
  const yearSummaries = Array.from({ length: 12 }, (_, i) =>
    yearFixture
      .filter((t) => t.period === periodId(2026, i + 1))
      .reduce((s, t) => applyImpact(s, t, 1), emptySummary(periodId(2026, i + 1))),
  );
  const r = buildReport(
    { year: 2026, month: 1, view: "year" },
    yearSummaries,
    yearFixture,
    "Tesorería",
    new Date("2026-12-31T12:00:00Z"),
    { today: "2026-12-31" },
  );
  expect(r.comparison.available).toBe(false);
  expect(r.bySource).toEqual([]);
  const monthsAlert = r.alerts.revisar.find((a) => a.code === "A3");
  expect(monthsAlert?.text).toContain("Enero");
  expect(monthsAlert?.text).not.toContain("Febrero");
  expect(r.monthlyByMethod).toHaveLength(12);
});
