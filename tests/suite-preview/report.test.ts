import { describe, expect, it } from "vitest";
import { AREAS, DEMO_NOW, EVENTS, LEAK_CANARIES } from "@/lib/suite-preview/fixtures";
import { REPORT_COLUMNS, calendarReportRows, calendarReportSummary, type CalendarReportRow } from "@/lib/suite-preview/report";
import { buildCalendarPdf, calendarPdfLayout } from "@/lib/suite-preview/report-pdf";

const base = {
  events: EVENTS,
  areas: AREAS,
  from: "2026-10-01",
  to: "2026-10-31",
  onlyResponsible: false,
  statuses: ["programada", "realizada", "cancelada"] as ("programada" | "realizada" | "cancelada")[],
  visibility: "all" as const,
  now: DEMO_NOW,
};

describe("reporte de calendario", () => {
  it("respeta período, orden por fecha y hora, y nunca incluye archivadas", () => {
    const rows = calendarReportRows(base);
    expect(rows.every((r) => r.date >= "2026-10-01" && r.date <= "2026-10-31")).toBe(true);
    expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort());
    expect(rows.some((r) => r.title.includes(LEAK_CANARIES.archivedTitle))).toBe(false);
    const d17 = rows.filter((r) => r.date === "2026-10-17").map((r) => r.time);
    expect(d17[0]).toBe("Todo el día");
  });

  it("filtros de área (responsable o participante), estado derivado y visibilidad", () => {
    const jov = calendarReportRows({ ...base, areaId: "jovenes" });
    expect(new Set(jov.map((r) => r.title))).toEqual(new Set(["Reunión de jóvenes", "Campamento de jóvenes", "Evangelismo en la plaza"]));
    expect(calendarReportRows({ ...base, areaId: "jovenes", onlyResponsible: true }).some((r) => r.title === "Evangelismo en la plaza")).toBe(false);
    const done = calendarReportRows({ ...base, statuses: ["realizada"] });
    expect(done.length).toBeGreaterThan(0);
    expect(done.every((r) => r.date <= "2026-10-04")).toBe(true);
    expect(calendarReportRows({ ...base, visibility: "team" }).every((r) => r.visibility === "team")).toBe(true);
    expect(calendarReportRows({ ...base, statuses: ["cancelada"] }).map((r) => r.title).sort()).toEqual(
      ["Ensayo de alabanza", "Evangelismo en la plaza", "Reunión de jóvenes"].sort(),
    );
  });

  it("columnas exactas, sin notas internas ni motivos", () => {
    expect(REPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Fecha",
      "Hora",
      "Actividad",
      "Área responsable",
      "Participantes",
      "Lugar",
      "Estado",
      "Visibilidad",
      "Descripción pública",
    ]);
    const json = JSON.stringify(calendarReportRows(base));
    for (const c of Object.values(LEAK_CANARIES)) expect(json).not.toContain(c);
    expect(json).not.toContain("internalNotes");
    expect(calendarReportSummary(calendarReportRows(base)).total).toBeGreaterThan(20);
  });

  it("genera el PDF localmente (smoke)", async () => {
    const pdf = await buildCalendarPdf(calendarReportRows(base), {
      periodLabel: "Octubre 2026",
      filtersLabel: "Todas las áreas · Todos los estados",
      generatedBy: "Administración (demo)",
      generatedOn: "04-10-2026",
    });
    expect(pdf.pageCount).toBeGreaterThanOrEqual(1);
    expect(pdf.output().byteLength).toBeGreaterThan(1000);
  });
});

describe("PDF del reporte: paginación por alto disponible", () => {
  const meta = {
    periodLabel: "Octubre 2026",
    filtersLabel: "Áreas: todas · Estados: todos · Visibilidad: todas",
    generatedBy: "Administración (demo)",
    generatedOn: "04-10-2026 13:30",
    summaryLabel: "32 actividades · 5 realizadas · 24 programadas · 3 canceladas",
    byAreaLabel: "Pastoral 9 · Jóvenes 6 · Alabanza 5 · Niños 5 · Consolidación 2 · Damas 2 · Intercesión 2 · Varones 1",
  };
  const months = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"];
  const lastDay = (m: string) => `${m}-${m.endsWith("-09") || m.endsWith("-11") ? "30" : "31"}`;

  it("la vista previa (calendarPdfLayout) coincide con el PDF real: páginas y filas por página", async () => {
    const sets: CalendarReportRow[][] = [
      [],
      ...months.map((m) => calendarReportRows({ ...base, from: `${m}-01`, to: lastDay(m) })),
      calendarReportRows({ ...base, from: "2026-09-01", to: "2026-12-31" }),
      calendarReportRows({ ...base, areaId: "pastoral" }),
      // Descripciones largas: filas de varias líneas.
      calendarReportRows(base).map((r, i) => ({ ...r, publicDescription: `${r.publicDescription} `.repeat((i % 4) + 1).trim() })),
    ];
    for (const rows of sets) {
      const layout = calendarPdfLayout(rows, meta);
      const pdf = await buildCalendarPdf(rows, meta);
      expect(layout.pageCount).toBe(pdf.pageCount);
      expect(layout.pages.map((p) => p.length)).toEqual(pdf.rowsPerPage);
      // Mismo alto de fila (autoTable no volvió a cortar el texto ya ajustado).
      expect(pdf.rowHeights.map((h) => h.toFixed(4))).toEqual(layout.rows.map((r) => r.height.toFixed(4)));
    }
  });

  it("no corta por un número fijo de filas: la página 1 se llena según el alto de cada fila", () => {
    const rows = calendarReportRows({ ...base, from: "2026-09-01", to: "2026-12-31" });
    const short = rows.map((r) => ({ ...r, publicDescription: "", participants: "" }));
    const tall = rows.map((r) => ({ ...r, publicDescription: "Descripción pública larga que ocupa varias líneas dentro de la columna. ".repeat(3) }));
    const a = calendarPdfLayout(short, meta);
    const b = calendarPdfLayout(tall, meta);
    expect(a.pages[0].length).toBeGreaterThan(b.pages[0].length);
    expect(a.pages[0].length).toBeGreaterThan(14);
    // Ninguna página excede el alto útil.
    for (const l of [a, b]) {
      l.pages.forEach((p, i) => {
        const top = (i === 0 ? l.startY : 14) + l.head.height;
        const used = p.reduce((acc, idx) => acc + l.rows[idx].height, 0);
        expect(top + used).toBeLessThanOrEqual(210 - 14 + 1e-9);
      });
    }
  });
});
