import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LiveWorkspace from "@/components/outreach/live/live-workspace";
import * as api from "@/lib/outreach/client";
import { COORD, DECIDE, EDITION, FOLLOW } from "./live-helpers";

let perms: string[] = [];
vi.mock("@/lib/outreach/client", async (orig) => (await import("./live-helpers")).clientMock(orig as never));
vi.mock("@/lib/access/model", () => ({ useAccessModel: () => ({ can: (p: string) => perms.includes(p), canAny: (l: string[]) => l.some((p) => perms.includes(p)) }) }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { uid: "u-resp" } }) }));

const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.resetAllMocks();
  perms = [COORD];
  m.fetchEditions.mockResolvedValue([EDITION]);
  m.stats.mockResolvedValue({
    edition: EDITION,
    metrics: { registered: 300, attended: 240, attendancePending: 20, unassignedContactable: 200 },
    tables: [],
    review: { total: 3, byIssue: {} },
    decisions: null,
  });
});

describe("«Ve por los tuyos» en vivo · carcasa y panorama", () => {
  it("coordinación ve el panorama con cifras y la edición vigente", async () => {
    render(<LiveWorkspace />);
    expect(await screen.findByText("Asistieron")).toBeInTheDocument();
    expect(screen.getByText("Asistieron").nextSibling).toHaveTextContent("240");
    expect(screen.getByText("3 casos esperan revisión.")).toBeInTheDocument();
    expect(m.stats).toHaveBeenCalledWith("vplt-2026");
  });

  it("transición de etapa: pide confirmación y envía la revisión esperada", async () => {
    const user = userEvent.setup();
    m.editionTransition.mockResolvedValue({});
    render(<LiveWorkspace />);
    await user.click(await screen.findByRole("button", { name: /Pasar a Cerrada/ }));
    expect(m.editionTransition).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Sí, pasar a Cerrada/ }));
    expect(m.editionTransition).toHaveBeenCalledWith("vplt-2026", "cerrada", 4);
  });

  it("sin permisos de vista no se muestra nada de coordinación ni se consulta stats", async () => {
    perms = [];
    render(<LiveWorkspace />);
    expect(await screen.findByText(/Tu perfil no tiene una vista/)).toBeInTheDocument();
    expect(m.stats).not.toHaveBeenCalled();
    void FOLLOW;
    void DECIDE;
  });

  it("error de carga en español con reintento", async () => {
    m.fetchEditions.mockRejectedValueOnce({ code: "functions/unavailable", message: "x" });
    const user = userEvent.setup();
    render(<LiveWorkspace />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/conexión/);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Asistieron")).toBeInTheDocument();
  });
});
