import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LiveWorkspace from "@/components/outreach/live/live-workspace";
import MyList from "@/components/outreach/live/my-list";
import * as api from "@/lib/outreach/client";
import { toRegistration } from "@/lib/outreach/client";
import { COORD, DECIDE, EDITION, FOLLOW } from "./live-helpers";

let perms: string[] = [];
vi.mock("@/lib/outreach/client", async (orig) => (await import("./live-helpers")).clientMock(orig as never));
vi.mock("@/lib/access/model", () => ({ useAccessModel: () => ({ can: (p: string) => perms.includes(p), canAny: () => true }) }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { uid: "u-resp" } }) }));
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const reg = (id: string, over = {}) =>
  toRegistration(id, { editionId: "vplt-2026", fullName: `Persona ${id}`, phoneE164: "+56900000001", status: "activa", attendance: "asistio", assigneeUid: "u-resp", ownerUid: "u-resp", createdAt: "2026-11-28T20:00", consents: [{ purpose: "seguimiento_evento", grantedAt: "2026-11-01T10:00", source: "formulario_web", textVersion: "web-1" }], ...over });

beforeEach(() => {
  vi.resetAllMocks();
  perms = [FOLLOW];
  m.newRequestId = vi.fn(() => "req-9");
  m.fetchEditions.mockResolvedValue([EDITION]);
  m.fetchMyRegistrations.mockResolvedValue([reg("a"), reg("b")]);
});

describe("Mi lista", () => {
  it("consulta con el contrato (uid + edición) y no pide nada de coordinación", async () => {
    render(<LiveWorkspace />);
    expect(await screen.findByText("Persona a")).toBeInTheDocument();
    expect(m.fetchMyRegistrations).toHaveBeenCalledWith("u-resp", "vplt-2026");
    expect(m.fetchEditionRegistrations).not.toHaveBeenCalled();
    expect(m.stats).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Panorama|Distribución/ })).toBeNull();
  });

  it("registra un contacto con requestId y recarga la lista", async () => {
    const user = userEvent.setup();
    m.contactRecord.mockResolvedValue({ contactId: "c1" });
    render(<MyList edition={EDITION} uid="u-resp" />);
    await user.click((await screen.findAllByRole("button", { name: "Registrar contacto" }))[0]);
    await user.type(screen.getByLabelText("Próxima acción"), "Invitar a la reunión");
    await user.type(screen.getByLabelText("Fecha"), "2099-12-06");
    await user.click(screen.getByRole("button", { name: "Guardar contacto" }));
    expect(m.contactRecord).toHaveBeenCalledWith(expect.objectContaining({ editionId: "vplt-2026", registrationId: "a", requestId: "req-9", channel: "llamada", result: "contactado", nextAction: "Invitar a la reunión", nextActionDate: "2099-12-06" }));
    expect(await screen.findByText("Contacto guardado.")).toBeInTheDocument();
    expect(m.fetchMyRegistrations).toHaveBeenCalledTimes(2);
  });

  it("baja: «pidió no contacto» no envía próxima acción y «Pidió no ser contactada» usa doNotContactSet", async () => {
    const user = userEvent.setup();
    m.contactRecord.mockResolvedValue({ optedOut: true });
    m.doNotContactSet.mockResolvedValue({});
    render(<MyList edition={EDITION} uid="u-resp" />);
    await user.click((await screen.findAllByRole("button", { name: "Registrar contacto" }))[0]);
    await user.click(screen.getByLabelText("Pidió no ser contactado"));
    await user.click(screen.getByRole("button", { name: "Guardar contacto" }));
    expect(m.contactRecord.mock.calls[0][0]).not.toHaveProperty("nextAction");
    expect(await screen.findByText(/salió de tu lista/)).toBeInTheDocument();
    await user.click((await screen.findAllByRole("button", { name: "Registrar contacto" }))[0]);
    await user.click(screen.getByRole("button", { name: /Pidió no ser contactada/ }));
    expect(m.doNotContactSet).toHaveBeenCalledWith(expect.objectContaining({ registrationId: expect.any(String), value: true }));
  });

  it("error al guardar: mensaje en español dentro de la ficha", async () => {
    const user = userEvent.setup();
    m.contactRecord.mockRejectedValue({ code: "functions/permission-denied", message: "outreach/not-assigned" });
    render(<MyList edition={EDITION} uid="u-resp" />);
    await user.click((await screen.findAllByRole("button", { name: "Registrar contacto" }))[0]);
    await user.click(screen.getByRole("button", { name: "Guardar contacto" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("ya no está asignada a ti");
  });
});

describe("Decisiones del líder", () => {
  it("con permiso pastoral lee solo las de sus personas por el contrato de consulta", async () => {
    perms = [DECIDE];
    m.fetchMyDecisions.mockResolvedValue([{ registrationId: "a", fullName: null, value: "desea_conversar", tableNumber: 3, recordedAt: null }]);
    render(<LiveWorkspace />);
    expect(await screen.findByText("Desea conversar · Mesa 3")).toBeInTheDocument();
    expect(m.fetchMyDecisions).toHaveBeenCalledWith("u-resp", "vplt-2026");
    expect(screen.getByText("Persona a")).toBeInTheDocument();
    void COORD;
  });
});
