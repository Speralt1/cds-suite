import { describe, expect, it } from "vitest";
import { AREAS, DEMO_NOW, EVENTS, LEAK_CANARIES } from "@/lib/suite-preview/fixtures";
import { REPORT_COLUMNS, calendarReportRows, calendarReportSummary } from "@/lib/suite-preview/report";
import { buildCalendarPdf } from "@/lib/suite-preview/report-pdf";

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
