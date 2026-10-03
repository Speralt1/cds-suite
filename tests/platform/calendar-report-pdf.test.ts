// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calendarReportRows, type CalendarReportRow } from "@/lib/calendar/report";
import {
  buildCalendarPdf,
  calendarPdfFileName,
  calendarPdfLayout,
  generatedLine,
  PDF_COLUMN_WIDTHS,
  PDF_EXCLUSION_NOTE,
  PDF_PAGE,
  pdfStatusText,
  type CalendarReportMeta,
} from "@/lib/calendar/report-pdf";
import { AREAS, CANARIES, EVENTS, NOW } from "./public-calendar-fixtures";

const ROOT = join(__dirname, "..", "..");
const FORBIDDEN = /vista previa|demo/i;

const META: CalendarReportMeta = {
  periodLabel: "Octubre 2026",
  filtersLabel: "Áreas: todas · Estados: todos · Visibilidad: todas",
  generatedBy: "Ana Pérez",
  generatedAt: "2026-10-02T14:05",
  summaryLabel: "3 actividades · 1 realizada · 1 programada · 1 cancelada",
  byAreaLabel: "Jóvenes 2 · Alabanza 1",
};

const realRows = () =>
  calendarReportRows({ events: EVENTS, areas: AREAS, now: NOW, filters: { from: "2026-10-01", to: "2026-10-31" } });

function syntheticRows(n: number): CalendarReportRow[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `ev${i}@2026-10-10`,
    date: "2026-10-10",
    dateLabel: "sáb 10-10-2026",
    time: "19:00–21:00",
    title: i % 3 === 0 ? `Actividad con un título bastante largo para ocupar varias líneas número ${i}` : `Actividad ${i}`,
    responsibleAreaId: "jovenes",
    responsible: "Jóvenes",
    responsibleColor: "azul",
    participants: i % 4 === 0 ? "Alabanza, Intercesión, Matrimonios" : "",
    location: "Templo central",
    status: "scheduled",
    statusLabel: "Programada",
    visibility: "public",
    publicDescription: i % 5 === 0 ? "Una descripción pública larga que se reparte en varias líneas dentro de su celda." : "",
  }));
}

const headerText = (meta = META, rows: CalendarReportRow[] = []) =>
  calendarPdfLayout(rows, meta)
    .header.flatMap((h) => (Array.isArray(h.text) ? h.text : [h.text]))
    .join("\n");

describe("encabezado", () => {
  it("iglesia, período, filtros aplicados y generado por (hora de Chile)", () => {
    const text = headerText();
    expect(text).toContain("Casa de Salvación");
    expect(text).toContain("Reporte de actividades · Octubre 2026");
    expect(text).toContain("Filtros aplicados: Áreas: todas · Estados: todos · Visibilidad: todas");
    expect(text).toContain("Generado por Ana Pérez el 02-10-2026 a las 14:05 (hora de Chile)");
    expect(text).toContain("Resumen: 3 actividades");
    expect(text).toContain("Por área: Jóvenes 2");
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("la línea de filtros está siempre, aunque sea larga (se ajusta en varias líneas)", () => {
    const long = { ...META, filtersLabel: `Áreas: ${Array.from({ length: 30 }, (_, i) => `Área número ${i}`).join(", ")}` };
    const layout = calendarPdfLayout([], long);
    const filters = layout.header.find((h) => (Array.isArray(h.text) ? h.text[0] : h.text).startsWith("Filtros aplicados:"));
    expect(filters).toBeTruthy();
    expect(Array.isArray(filters!.text)).toBe(true);
    expect(layout.startY).toBeGreaterThan(calendarPdfLayout([], META).startY);
  });

  it("generatedLine usa un nombre por defecto si viene vacío", () => {
    expect(generatedLine("  ", "2026-10-02T09:30")).toBe("Generado por Usuario de CDS el 02-10-2026 a las 09:30 (hora de Chile)");
  });
});

describe("layout y paginación (sin jspdf)", () => {
  it("anchos de columna = ancho útil A4 horizontal con márgenes de 15 mm", () => {
    expect(PDF_COLUMN_WIDTHS).toHaveLength(8);
    expect(PDF_COLUMN_WIDTHS.reduce((a, b) => a + b, 0)).toBeCloseTo(PDF_PAGE.width - 30, 5);
  });

  it("sin filas: una página, con pie y nota final", () => {
    const layout = calendarPdfLayout([], META);
    expect(layout.pageCount).toBe(1);
    expect(layout.footers).toEqual(["Página 1 de 1"]);
    expect(layout.lastPageNote).toBe(PDF_EXCLUSION_NOTE);
  });

  it("muchas filas: varias páginas, todas las filas una sola vez y en orden, sin desbordar", () => {
    const rows = syntheticRows(90);
    const layout = calendarPdfLayout(rows, META);
    expect(layout.pageCount).toBeGreaterThan(2);
    expect(layout.pages.flat()).toEqual(rows.map((_, i) => i));
    layout.pages.forEach((page, p) => {
      const top = p === 0 ? layout.startY : 15;
      const used = layout.head.height + page.reduce((h, i) => h + layout.rows[i].height, 0);
      expect(top + used).toBeLessThanOrEqual(PDF_PAGE.height - 15 + 1e-6);
    });
    expect(layout.footers[layout.footers.length - 1]).toBe(`Página ${layout.pageCount} de ${layout.pageCount}`);
  });

  it("las filas reales no llevan notas internas ni motivos", () => {
    const layout = calendarPdfLayout(realRows(), META);
    const json = JSON.stringify(layout);
    for (const c of [CANARIES.internalNotes, CANARIES.cancelReason, CANARIES.exceptionReason, CANARIES.seriesReason, CANARIES.uid])
      expect(json).not.toContain(c);
    expect(json).not.toMatch(FORBIDDEN);
  });
});

describe("nombre de archivo", () => {
  it("mes completo o rango, sin rótulos de demostración", () => {
    expect(calendarPdfFileName("2026-10-01", "2026-10-31")).toBe("reporte-calendario-2026-10.pdf");
    expect(calendarPdfFileName("2026-10-01", "2026-10-15")).toBe("reporte-calendario-2026-10-01_2026-10-15.pdf");
    expect(calendarPdfFileName("2026-02-01", "2026-02-28")).toBe("reporte-calendario-2026-02.pdf");
    expect(calendarPdfFileName("2026-10-01", "2026-10-31")).not.toMatch(FORBIDDEN);
  });
});

describe("PDF real (jspdf en node)", () => {
  it("misma paginación que el layout; filtros, pie y nota presentes; sin rótulos de demostración", async () => {
    const rows = syntheticRows(70);
    const layout = calendarPdfLayout(rows, META);
    const pdf = await buildCalendarPdf(rows, META, { swatchHex: () => "#2f6fb0" });
    expect(pdf.pageCount).toBe(layout.pageCount);
    expect(pdf.rowsPerPage).toEqual(layout.pages.map((p) => p.length));
    const raw = Buffer.from(pdf.output()).toString("latin1");
    expect(raw).toContain("Filtros aplicados:");
    // "Página" va codificada en WinAnsi: basta con el resto del texto.
    expect(raw).toContain(`gina ${pdf.pageCount} de ${pdf.pageCount}`);
    expect(raw).toContain("No incluye notas internas");
    expect(raw).not.toMatch(/vista previa|demostraci|DEMO/i);
  });

  it("PDF vacío también lleva encabezado y mensaje", async () => {
    const pdf = await buildCalendarPdf([], META);
    expect(pdf.pageCount).toBe(1);
    const raw = Buffer.from(pdf.output()).toString("latin1");
    expect(raw).toContain("No hay actividades con estos filtros.");
  });
});

describe("jspdf solo por import dinámico (escaneo estático)", () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
  const STATIC_JSPDF = /^\s*import\s+[^;]*?from\s+["']jspdf(-autotable)?["']/m;
  const SIDE_EFFECT_JSPDF = /^\s*import\s+["']jspdf(-autotable)?["']/m;
  const REQUIRE_JSPDF = /require\(\s*["']jspdf/;

  it("lib/calendar/report-pdf.ts importa jspdf y jspdf-autotable solo con import()", () => {
    const src = read("lib/calendar/report-pdf.ts");
    expect(src).not.toMatch(STATIC_JSPDF);
    expect(src).not.toMatch(SIDE_EFFECT_JSPDF);
    expect(src).not.toMatch(REQUIRE_JSPDF);
    expect(src).toMatch(/import\(\s*["']jspdf["']\s*\)/);
    expect(src).toMatch(/import\(\s*["']jspdf-autotable["']\s*\)/);
    // Los import() están dentro de buildCalendarPdf, no en el nivel superior.
    const fn = src.slice(src.indexOf("export async function buildCalendarPdf"));
    expect(fn).toMatch(/import\(\s*["']jspdf["']\s*\)/);
    expect(src.slice(0, src.indexOf("export async function buildCalendarPdf"))).not.toMatch(/import\(\s*["']jspdf/);
  });

  it("ni el reporte ni sus componentes importan jspdf estáticamente", () => {
    for (const rel of ["lib/calendar/report.ts", "components/reports/calendar-report.tsx", "components/reports/reports-hub.tsx"]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(STATIC_JSPDF);
      expect(src, rel).not.toMatch(SIDE_EFFECT_JSPDF);
      expect(src, rel).not.toMatch(REQUIRE_JSPDF);
    }
  });

  it("sin rótulos de demostración en el código del reporte", () => {
    for (const rel of ["lib/calendar/report.ts", "lib/calendar/report-pdf.ts", "components/reports/calendar-report.tsx"]) {
      expect(read(rel), rel).not.toMatch(/Vista previa|\bDemo\b|DEMO/);
    }
  });
});

describe("visibilidad en texto en la celda Estado (8 columnas)", () => {
  const STATUS_COL = 6;

  it("pdfStatusText: estado · visibilidad", () => {
    expect(pdfStatusText({ statusLabel: "Programada", visibility: "public" })).toBe("Programada · Pública");
    expect(pdfStatusText({ statusLabel: "Cancelada", visibility: "internal" })).toBe("Cancelada · Solo equipo");
    expect(pdfStatusText({ statusLabel: "Realizada", visibility: "public" })).toBe("Realizada · Pública");
  });

  it("el layout lleva la visibilidad como segunda línea del Estado y mantiene 8 columnas", () => {
    const rows = syntheticRows(3);
    rows[1] = { ...rows[1], status: "cancelled", statusLabel: "Cancelada", visibility: "internal" };
    const layout = calendarPdfLayout(rows, META);
    expect(layout.head.lines).toHaveLength(8);
    expect(layout.head.lines[STATUS_COL]).toEqual(["Estado"]);
    layout.rows.forEach((r) => expect(r.lines).toHaveLength(8));
    expect(layout.rows[0].lines[STATUS_COL]).toEqual(["Programada ·", "Pública"]);
    expect(layout.rows[1].lines[STATUS_COL]).toEqual(["Cancelada ·", "Solo equipo"]);
  });

  it("filas reales: cada fila escribe su visibilidad", () => {
    const rows = realRows();
    expect(rows.some((r) => r.visibility === "internal")).toBe(true);
    const layout = calendarPdfLayout(rows, META);
    rows.forEach((r, i) => {
      const cell = layout.rows[i].lines[STATUS_COL].join(" ");
      expect(cell).toBe(`${r.statusLabel} · ${r.visibility === "public" ? "Pública" : "Solo equipo"}`);
    });
  });

  it("PDF real: misma paginación que el layout con la segunda línea y el texto «Solo equipo» presente", async () => {
    const rows = syntheticRows(70).map((r, i) => (i % 2 ? { ...r, visibility: "internal" as const } : r));
    const layout = calendarPdfLayout(rows, META);
    const pdf = await buildCalendarPdf(rows, META);
    expect(pdf.pageCount).toBe(layout.pageCount);
    expect(pdf.rowsPerPage).toEqual(layout.pages.map((p) => p.length));
    const raw = Buffer.from(pdf.output()).toString("latin1");
    expect(raw).toContain("Solo equipo");
    expect(raw).toContain("Programada ");
  });
});
