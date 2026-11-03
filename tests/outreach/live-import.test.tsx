import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImportView from "@/components/outreach/live/import-view";
import ReviewView from "@/components/outreach/live/review-view";
import * as api from "@/lib/outreach/client";
import { EDITION } from "./live-helpers";

vi.mock("@/lib/outreach/client", async (orig) => (await import("./live-helpers")).clientMock(orig as never));
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const CSV = "id,nombre,menor,estado,usada\n1,Ana Prueba,no,aprobado,sí\n2,Beto Prueba,no,aprobado,no\n3,Niña Prueba,sí,aprobado,no\n";
const report = (over = {}) => ({ created: 2, updated: 0, cancelled: 0, unchanged: 0, stale: 0, toReview: 1, skippedMinors: 0, ...over });

beforeEach(() => vi.resetAllMocks());

describe("Importar inscripciones", () => {
  it("el informe sin aplicar va primero; aplicar envía las mismas filas con dryRun=false", async () => {
    const user = userEvent.setup();
    m.importRegistrations.mockImplementation(async (_e: string, _r: unknown[], dryRun: boolean) => ({ dryRun, rows: 2, report: report(), review: [{ issue: "posible_duplicado", externalId: "2" }], reviewTotal: 1 }));
    render(<ImportView edition={EDITION} />);
    expect(screen.queryByRole("button", { name: /Aplicar/ })).toBeNull();
    await user.upload(screen.getByLabelText("Archivo CSV"), new File([CSV], "asistentes.csv", { type: "text/csv" }));
    expect(await screen.findByText(/2 filas listas/)).toHaveTextContent("1 menores");
    // Sin informe previo no hay botón de aplicar.
    expect(screen.queryByRole("button", { name: /Aplicar/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Ver informe sin aplicar" }));
    expect(m.importRegistrations).toHaveBeenCalledTimes(1);
    expect(m.importRegistrations.mock.calls[0][2]).toBe(true);
    expect(await screen.findByText("Informe previo · aún no se guardó nada")).toBeInTheDocument();
    expect(screen.getByText("Posible duplicado: confirmar si es la misma persona")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Aplicar importación/ }));
    expect(m.importRegistrations).toHaveBeenCalledTimes(2);
    const [ed, rows, dry] = m.importRegistrations.mock.calls[1];
    expect([ed, dry]).toEqual(["vplt-2026", false]);
    expect((rows as { externalId: string; editionYear: number }[]).map((r) => [r.externalId, r.editionYear])).toEqual([["1", 2026], ["2", 2026]]);
    expect(await screen.findByText(/Importación aplicada: 2 nuevas/)).toBeInTheDocument();
  });

  it("consentimiento del sitio: sin casilla advierte; con casilla exige versión y viaja en cada fila", async () => {
    const user = userEvent.setup();
    m.importRegistrations.mockResolvedValue({ dryRun: true, rows: 2, report: report(), review: [], reviewTotal: 0 });
    render(<ImportView edition={EDITION} />);
    expect(screen.getByRole("note")).toHaveTextContent(/no podrán incluirse en la distribución/);
    await user.upload(screen.getByLabelText("Archivo CSV"), new File([CSV], "a.csv"));
    await user.click(await screen.findByRole("button", { name: "Ver informe sin aplicar" }));
    expect((m.importRegistrations.mock.calls[0][1] as { consents: unknown[] }[]).every((r) => r.consents.length === 0)).toBe(true);

    await user.click(screen.getByLabelText("Este texto autoriza el seguimiento posterior del evento"));
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByRole("button", { name: /informe sin aplicar/ })).toBeNull();
    await user.type(screen.getByLabelText("Versión del consentimiento del sitio"), "v2-2026-11");
    await user.click(screen.getByLabelText("Este texto autoriza mensajes de WhatsApp"));
    await user.click(await screen.findByRole("button", { name: "Ver informe sin aplicar" }));
    const rows = m.importRegistrations.mock.calls[1][1] as { consents: { purpose: string; textVersion: string }[] }[];
    expect(rows[0].consents.map((c) => [c.purpose, c.textVersion])).toEqual([["seguimiento_evento", "v2-2026-11"], ["mensajes_whatsapp", "v2-2026-11"]]);
  });

  it("archivo con errores: informa la fila sin datos personales y no ofrece enviar si no hay filas", async () => {
    const user = userEvent.setup();
    render(<ImportView edition={EDITION} />);
    await user.upload(screen.getByLabelText("Archivo CSV"), new File(["id,nombre,menor,estado\n,Ana Prueba,no,aprobado\n"], "x.csv"));
    expect(await screen.findByText("Fila 2: el identificador falta o no es válido.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /informe/ })).toBeNull();
    expect(screen.queryByText(/Ana Prueba/)).toBeNull();
  });

  it("edición cerrada: no permite importar", () => {
    render(<ImportView edition={{ ...EDITION, status: "cerrada" }} />);
    expect(screen.getByText(/La edición está cerrada/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Archivo CSV")).toBeNull();
  });

  it("error del servidor en español", async () => {
    const user = userEvent.setup();
    m.importRegistrations.mockRejectedValue({ code: "functions/aborted", message: "outreach/conflict" });
    render(<ImportView edition={EDITION} />);
    await user.upload(screen.getByLabelText("Archivo CSV"), new File([CSV], "a.csv"));
    await user.click(await screen.findByRole("button", { name: "Ver informe sin aplicar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Alguien cambió esto/);
  });
});

describe("Revisión", () => {
  it("lista casos y resuelve con requestId; marcar duplicado apunta al primer candidato", async () => {
    const user = userEvent.setup();
    m.newRequestId = vi.fn(() => "req-1");
    m.reviewList.mockResolvedValueOnce([{ id: "rv1", issue: "posible_duplicado", externalId: "9", registrationId: "r9", candidates: ["r1", "r2"], sourceRevision: 1, createdAt: null }]).mockResolvedValueOnce([]);
    m.reviewResolve.mockResolvedValue({});
    render(<ReviewView edition={EDITION} />);
    await user.click(await screen.findByRole("button", { name: "Es la misma persona" }));
    expect(m.reviewResolve).toHaveBeenCalledWith({ editionId: "vplt-2026", reviewId: "rv1", resolution: "mark_duplicate", targetRegistrationId: "r1", requestId: "req-1" });
    expect(await screen.findByText("No hay casos pendientes.")).toBeInTheDocument();
  });
});
