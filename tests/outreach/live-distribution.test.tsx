import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AbsencesView from "@/components/outreach/live/absences-view";
import DistributionView from "@/components/outreach/live/distribution-view";
import * as api from "@/lib/outreach/client";
import { toRegistration } from "@/lib/outreach/client";
import { EDITION } from "./live-helpers";

vi.mock("@/lib/outreach/client", async (orig) => (await import("./live-helpers")).clientMock(orig as never));
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.resetAllMocks();
  m.newRequestId = vi.fn(() => "req-1");
  m.teamCandidates.mockResolvedValue([{ uid: "u1", displayName: "Ana (ficticia)" }]);
});

describe("Confirmar ausencias", () => {
  it("solo cuenta activas sin confirmar y envía el conteo esperado", async () => {
    const user = userEvent.setup();
    const reg = (id: string, over = {}) => toRegistration(id, { editionId: "vplt-2026", fullName: `Persona ${id}`, status: "activa", attendance: "sin_confirmar", ...over });
    m.fetchEditionRegistrations.mockResolvedValue([reg("a"), reg("b"), reg("c", { attendance: "asistio" }), reg("d", { status: "cancelada" })]);
    m.confirmAbsences.mockResolvedValue({ confirmed: 2, unchanged: 0, skipped: [] });
    render(<AbsencesView edition={EDITION} />);
    await user.click(await screen.findByRole("button", { name: "Confirmar que 2 no asistieron" }));
    expect(m.confirmAbsences).toHaveBeenCalledWith("vplt-2026", ["a", "b"], 2);
    expect(await screen.findByText("2 ausencias confirmadas.")).toBeInTheDocument();
  });
});

describe("Distribución", () => {
  const proposal = { batchId: "batch-123456789", assignments: [], unassigned: [], summary: { assignments: 12, unassigned: 1, excluded: { no_asistio: 5 }, loads: { u1: 12 }, caps: { u1: 20 } } };

  it("propuesta → vista previa sin guardar → confirmar; muestra conflictos", async () => {
    const user = userEvent.setup();
    m.distributionPropose.mockResolvedValue(proposal);
    m.distributionConfirm.mockResolvedValue({ batchId: "batch-123456789", applied: 10, alreadyApplied: 0, conflicts: [{ registrationId: "x", reason: "revision" }, { registrationId: "y", reason: "ya_asignada" }] });
    render(<DistributionView edition={EDITION} />);
    await user.click(screen.getByRole("button", { name: /Generar propuesta/ }));
    expect(m.distributionPropose).toHaveBeenCalledWith("vplt-2026", "req-1");
    expect(await screen.findByRole("heading", { name: "Propuesta · 12 personas" })).toBeInTheDocument();
    expect(screen.getByText("12/20")).toBeInTheDocument();
    expect(screen.getByText("No asistieron")).toBeInTheDocument();
    expect(m.distributionConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar distribución" }));
    expect(m.distributionConfirm).toHaveBeenCalledWith("vplt-2026", "batch-123456789");
    expect(await screen.findByRole("status")).toHaveTextContent("10 asignaciones nuevas, 2 con conflicto");
    expect(screen.getByLabelText("Conflictos")).toHaveTextContent("1 persona: cambió desde la propuesta");
  });

  it("descartar vuelve al inicio sin confirmar", async () => {
    const user = userEvent.setup();
    m.distributionPropose.mockResolvedValue(proposal);
    render(<DistributionView edition={EDITION} />);
    await user.click(screen.getByRole("button", { name: /Generar propuesta/ }));
    await user.click(await screen.findByRole("button", { name: /Descartar/ }));
    expect(screen.getByRole("button", { name: /Generar propuesta/ })).toBeInTheDocument();
    expect(m.distributionConfirm).not.toHaveBeenCalled();
  });
});

describe("Distribución · excedente sobre el tope", () => {
  it("etiqueta «tope» y reenvía el lote con notas de justificación", async () => {
    const user = userEvent.setup();
    m.distributionPropose.mockResolvedValue({ batchId: "batch-123456789", assignments: [], unassigned: [], summary: { assignments: 2, unassigned: 0, excluded: {}, loads: { u1: 21 }, caps: { u1: 20 } } });
    m.distributionConfirm
      .mockResolvedValueOnce({ batchId: "batch-123456789", applied: 1, alreadyApplied: 0, conflicts: [{ registrationId: "r1", reason: "tope" }] })
      .mockResolvedValueOnce({ batchId: "batch-123456789", applied: 1, alreadyApplied: 1, conflicts: [] });
    render(<DistributionView edition={EDITION} />);
    await user.click(screen.getByRole("button", { name: /Generar propuesta/ }));
    await user.click(await screen.findByRole("button", { name: "Confirmar distribución" }));
    expect(await screen.findByLabelText("Conflictos")).toHaveTextContent("Superaría el tope de 20");
    const send = screen.getByRole("button", { name: "Confirmar con justificación" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText(/motivo/), "Es su familiar");
    await user.click(send);
    expect(m.distributionConfirm).toHaveBeenLastCalledWith("vplt-2026", "batch-123456789", [{ registrationId: "r1", note: "Es su familiar" }]);
  });
});
