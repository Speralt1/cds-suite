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
