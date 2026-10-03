// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  calendarReportRows,
  calendarReportSummary,
  REPORT_COLUMNS,
  reportFiltersLabel,
  reportPeriodLabel,
  reportSummaryLabel,
  type CalendarReportFilters,
} from "@/lib/calendar/report";
import { compareDayOrder } from "@/lib/shared/calendar-core";
import type { OccurrenceStatus } from "@/lib/shared/types";
import { AREAS, CANARIES, EVENTS, NOW, event } from "./public-calendar-fixtures";

const OCT = { from: "2026-10-01", to: "2026-10-31" };
const rowsFor = (filters: Partial<CalendarReportFilters> = {}, events = EVENTS) =>
  calendarReportRows({ events, areas: AREAS, now: NOW, filters: { ...OCT, ...filters } });

const INTERNAL_ONLY_CANARIES = [
  CANARIES.internalNotes,
  CANARIES.cancelReason,
  CANARIES.archiveReason,
  CANARIES.exceptionReason,
  CANARIES.seriesReason,
  CANARIES.uid,
  CANARIES.extra,
  CANARIES.email,
  CANARIES.archivedTitle,
];

describe("columnas", () => {
  it("son exactamente las 8 de la misión, en orden", () => {
    expect(REPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Fecha",
      "Hora",
      "Actividad",
      "Área responsable",
      "Participantes",
      "Lugar",
      "Estado",
      "Descripción pública",
    ]);
  });

  it("cada fila tiene solo campos de lista blanca (sin notas, motivos ni uids)", () => {
    const rows = rowsFor();
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        [
          "key",
          "date",
          "dateLabel",
          "time",
          "title",
          "responsibleAreaId",
          "responsible",
          "responsibleColor",
          "participants",
          "location",
          "status",
          "statusLabel",
          "visibility",
          "publicDescription",
        ].sort(),
      );
      for (const col of REPORT_COLUMNS) expect(typeof r[col.key]).toBe("string");
    }
  });

  it("formatos de fecha, hora, participantes y estado", () => {
    const culto = rowsFor().find((r) => r.title === "Culto dominical" && r.date === "2026-10-11")!;
    expect(culto.dateLabel).toBe("dom 11-10-2026");
    expect(culto.time).toBe("11:00–13:00");
    expect(culto.responsible).toBe("Alabanza");
    expect(culto.responsibleColor).toBe("verde");
    // Las áreas inexistentes no aparecen; las inactivas sí (nombre histórico).
    expect(culto.participants).toBe("Jóvenes, Área antigua");
    expect(culto.statusLabel).toBe("Programada");
    const allDay = rowsFor({}, [event({ id: "x", allDay: true, startTime: null, endTime: null })])[0];
    expect(allDay.time).toBe("Todo el día");
  });
});

describe("sanitización", () => {
  it("nunca incluye notas internas, motivos, uids, correos ni archivadas", () => {
    const json = JSON.stringify(rowsFor({ statuses: ["scheduled", "realized", "cancelled"], visibility: "all" }));
    for (const c of INTERNAL_ONLY_CANARIES) expect(json, c).not.toContain(c);
    expect(json).not.toContain("@cds.test");
    expect(json).not.toContain("settings.manage");
  });

  it("las archivadas nunca aparecen, aunque el filtro pida todo", () => {
    const rows = rowsFor({}, [
      ...EVENTS,
      event({ id: "arch2", title: "Archivada", status: "archived", startDate: "2026-10-05", endDate: "2026-10-05" }),
    ]);
    expect(rows.some((r) => r.title === "Archivada" || r.title === CANARIES.archivedTitle)).toBe(false);
  });

  it("descarta actividades con fechas rotas", () => {
    expect(rowsFor().some((r) => r.title === "Fecha rota")).toBe(false);
  });
});

describe("orden", () => {
  it("usa el comparador único del calendario", () => {
    const rows = rowsFor();
    const areaName = (id: string) => AREAS.find((a) => a.id === id)?.name ?? "";
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      const key = (r: typeof a) => ({
        date: r.date,
        allDay: r.time === "Todo el día",
        startTime: r.time === "Todo el día" ? null : r.time.slice(0, 5),
        areaName: areaName(r.responsibleAreaId),
        title: r.title,
      });
      expect(compareDayOrder(key(a), key(b))).toBeLessThanOrEqual(0);
    }
    expect(rows[0].date >= OCT.from).toBe(true);
    expect(rows[rows.length - 1].date <= OCT.to).toBe(true);
  });
});

describe("filtros", () => {
  it("período: solo ocurrencias dentro del rango", () => {
    const rows = rowsFor({ from: "2026-10-05", to: "2026-10-12" });
    expect(rows.every((r) => r.date >= "2026-10-05" && r.date <= "2026-10-12")).toBe(true);
    expect(rows.map((r) => r.title)).toContain("Culto dominical");
    expect(rowsFor({ from: "2026-10-12", to: "2026-10-05" })).toEqual([]);
  });

  it("estado: programada, realizada y cancelada", () => {
    const by = (s: OccurrenceStatus) => rowsFor({ statuses: [s] });
    expect(by("realized").every((r) => r.status === "realized" && r.date <= "2026-10-04")).toBe(true);
    expect(by("realized").length).toBeGreaterThan(0);
    expect(by("scheduled").every((r) => r.status === "scheduled")).toBe(true);
    const cancelled = by("cancelled");
    expect(cancelled.every((r) => r.status === "cancelled" && r.statusLabel === "Cancelada")).toBe(true);
    expect(cancelled.map((r) => `${r.title}@${r.date}`)).toEqual(
      expect.arrayContaining([
        "Culto dominical@2026-10-18",
        "Evangelismo en la plaza@2026-10-24",
        "Oración de los martes@2026-10-13",
      ]),
    );
    expect(rowsFor({ statuses: [] })).toEqual([]);
  });

  it("visibilidad: todas, pública y solo equipo", () => {
    const all = rowsFor({ visibility: "all" });
    const pub = rowsFor({ visibility: "public" });
    const internal = rowsFor({ visibility: "internal" });
    expect(pub.every((r) => r.visibility === "public")).toBe(true);
    expect(internal.map((r) => r.title)).toEqual([CANARIES.internalTitle]);
    expect(pub.length + internal.length).toBe(all.length);
  });

  it("área: responsable o participante; 'solo como responsable' excluye participaciones", () => {
    const any = rowsFor({ areaIds: ["jovenes"] });
    expect(any.some((r) => r.title === "Culto dominical")).toBe(true); // participante
    expect(any.some((r) => r.title === "Evangelismo en la plaza")).toBe(true); // responsable
    expect(any.some((r) => r.responsibleAreaId === "intercesion")).toBe(false);
    const only = rowsFor({ areaIds: ["jovenes"], onlyResponsible: true });
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((r) => r.responsibleAreaId === "jovenes")).toBe(true);
    expect(only.some((r) => r.title === "Culto dominical")).toBe(false);
  });
});

describe("resumen y etiquetas", () => {
  it("cuenta por estado y por área responsable", () => {
    const rows = rowsFor();
    const s = calendarReportSummary(rows);
    expect(s.total).toBe(rows.length);
    expect(s.byStatus.scheduled + s.byStatus.realized + s.byStatus.cancelled).toBe(rows.length);
    expect(s.byArea.reduce((n, a) => n + a.count, 0)).toBe(rows.length);
    expect(reportSummaryLabel(s)).toMatch(/^\d+ actividades · \d+ realizadas? · \d+ programadas? · \d+ canceladas?$/);
  });

  it("línea de filtros siempre explícita", () => {
    expect(reportFiltersLabel({}, AREAS)).toBe("Áreas: todas · Estados: todos · Visibilidad: todas");
    expect(
      reportFiltersLabel(
        { areaIds: ["jovenes", "alabanza"], onlyResponsible: true, statuses: ["realized", "scheduled"], visibility: "public" },
        AREAS,
      ),
    ).toBe("Áreas: Jóvenes, Alabanza (solo como responsable) · Estados: Programada, Realizada · Visibilidad: Pública");
    expect(reportFiltersLabel({ visibility: "internal", statuses: [] }, AREAS)).toBe(
      "Áreas: todas · Estados: ninguno · Visibilidad: Solo equipo",
    );
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ areaIds: ["jovenes"], statuses: ["cancelled"], visibility: "public" })).toBe(3);
  });

  it("período legible", () => {
    expect(reportPeriodLabel("2026-10-01", "2026-10-31")).toBe("Octubre 2026");
    expect(reportPeriodLabel("2026-10-01", "2026-10-15")).toBe("1 al 15 de octubre de 2026");
    expect(reportPeriodLabel("2026-10-15", "2026-11-10")).toBe("15 de octubre al 10 de noviembre de 2026");
    expect(reportPeriodLabel("2026-12-15", "2027-01-10")).toBe("15 de diciembre de 2026 al 10 de enero de 2027");
    expect(reportPeriodLabel("2026-10-04", "2026-10-04")).toBe("4 de octubre de 2026");
  });
});

describe("hub de Reportes", () => {
  it("Calendario con calendar.read; 'Reportes financieros' → /finanzas/reportes solo con finance.details.read", async () => {
    const { reportHubCards } = await import("@/components/reports/reports-hub");
    const { reportsNavItems } = await import("@/components/reports/reports-nav");
    const cards = (perms: string[]) => reportHubCards((p) => perms.includes(p)).map((c) => [c.title, c.href]);
    expect(cards(["calendar.read"])).toEqual([["Calendario", "/reportes/calendario"]]);
    expect(cards(["finance.details.read"])).toEqual([["Reportes financieros", "/finanzas/reportes"]]);
    expect(cards(["calendar.read", "finance.details.read"])).toEqual([
      ["Calendario", "/reportes/calendario"],
      ["Reportes financieros", "/finanzas/reportes"],
    ]);
    expect(cards([])).toEqual([]);
    expect(reportsNavItems(false).map((i) => i.href)).toEqual(["/reportes"]);
    expect(reportsNavItems(true).map((i) => i.href)).toEqual(["/reportes", "/reportes/calendario"]);
  });
});
