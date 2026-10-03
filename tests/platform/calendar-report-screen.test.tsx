import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AREAS, CANARIES, EVENTS, NOW, TODAY } from "./public-calendar-fixtures";

const save = vi.fn();
type BuildPdf = (...args: unknown[]) => Promise<{ save: typeof save; pageCount: number; rowsPerPage: number[]; output: () => ArrayBuffer }>;
const buildPdf = vi.fn<BuildPdf>(async () => ({ save, pageCount: 1, rowsPerPage: [1], output: () => new ArrayBuffer(0) }));
const state = { events: EVENTS, loading: false, error: "" };

vi.mock("@/lib/calendar/events-client", () => ({ useCalendarEvents: () => state }));
vi.mock("@/lib/calendar/areas-client", () => ({ useAreas: () => ({ areas: AREAS, loading: false, error: "" }) }));
vi.mock("@/lib/calendar/use-now", () => ({ useSantiagoNow: () => ({ today: TODAY, now: NOW }) }));
vi.mock("@/lib/auth/access-provider", () => ({
  useOptionalAccess: () => ({ displayName: "Ana Pérez", email: "ana@cds.test", role: "admin", active: true }),
}));
vi.mock("@/lib/calendar/report-pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/calendar/report-pdf")>()),
  buildCalendarPdf: (...args: unknown[]) => buildPdf(...args),
}));

const { CalendarReport, PDF_EMPTY_HELP } = await import("@/components/reports/calendar-report");

describe("Reportes › Calendario", () => {
  beforeEach(() => {
    save.mockReset();
    buildPdf.mockClear();
    state.events = EVENTS;
    state.loading = false;
    state.error = "";
  });

  it("muestra filas del mes con las 8 columnas y sin datos internos", () => {
    const { container } = render(<CalendarReport />);
    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).toEqual(["Fecha", "Hora", "Actividad", "Área responsable", "Participantes", "Lugar", "Estado", "Descripción pública"]);
    expect(within(table).getAllByText("Culto dominical").length).toBeGreaterThan(0);
    expect(screen.getByText(/Filtros aplicados: Áreas: todas · Estados: todos · Visibilidad: todas/)).toBeInTheDocument();
    for (const c of [CANARIES.internalNotes, CANARIES.cancelReason, CANARIES.exceptionReason, CANARIES.seriesReason, CANARIES.archiveReason, CANARIES.archivedTitle, CANARIES.uid])
      expect(container.innerHTML, c).not.toContain(c);
    expect(container.innerHTML).not.toMatch(/Vista previa|Demo|DEMO/);
  });

  it("filtros: visibilidad Solo equipo y vacío con Limpiar filtros; PDF deshabilitado con explicación", () => {
    render(<CalendarReport />);
    fireEvent.click(screen.getByRole("button", { name: "Solo equipo" }));
    expect(screen.getAllByText(CANARIES.internalTitle).length).toBeGreaterThan(0);
    expect(screen.queryByText("Culto dominical")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Programada" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Realizada" }));
    expect(screen.getByText("No hay actividades con estos filtros.")).toBeInTheDocument();
    const download = screen.getByRole("button", { name: /Descargar PDF/ });
    expect(download).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(PDF_EMPTY_HELP)).toBeInTheDocument();
    fireEvent.click(download);
    expect(buildPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]);
    expect(screen.getAllByText("Culto dominical").length).toBeGreaterThan(0);
  });

  it("Descargar PDF: encabezado con filtros y autor, nombre de archivo del mes", async () => {
    render(<CalendarReport />);
    fireEvent.change(screen.getByLabelText("Área"), { target: { value: "jovenes" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Solo como responsable" }));
    fireEvent.click(screen.getByRole("button", { name: /Descargar PDF/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("reporte-calendario-2026-10.pdf"));
    const [rows, meta] = buildPdf.mock.calls[0] as [Array<{ responsibleAreaId: string }>, Record<string, string>];
    expect(rows.every((r) => r.responsibleAreaId === "jovenes")).toBe(true);
    expect(meta.periodLabel).toBe("Octubre 2026");
    expect(meta.filtersLabel).toBe("Áreas: Jóvenes (solo como responsable) · Estados: todos · Visibilidad: todas");
    expect(meta.generatedBy).toBe("Ana Pérez");
  });

  it("rango personalizado: valida fechas y usa el nombre de archivo del rango", async () => {
    render(<CalendarReport />);
    fireEvent.click(screen.getByRole("button", { name: "Rango" }));
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-09-01" } });
    expect(screen.getByText("La fecha de término debe ser igual o posterior a la de inicio.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-15" } });
    fireEvent.click(screen.getByRole("button", { name: /Descargar PDF/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("reporte-calendario-2026-10-01_2026-10-15.pdf"));
    expect((buildPdf.mock.calls[0][1] as { periodLabel: string }).periodLabel).toBe("1 al 15 de octubre de 2026");
  });

  it("error de carga: mensaje y Reintentar", () => {
    state.error = "No pudimos cargar el calendario. Revisa tu conexión e inténtalo de nuevo.";
    render(<CalendarReport />);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar el reporte");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
