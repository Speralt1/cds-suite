import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TablesView from "@/components/outreach/live/tables-view";
import * as api from "@/lib/outreach/client";
import { EDITION } from "./live-helpers";

vi.mock("@/lib/outreach/client", async (orig) => (await import("./live-helpers")).clientMock(orig as never));
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const T1 = { number: 1, leaderUid: null, leaderName: null, hasLink: false, linkRevoked: false, linkIssuedAt: null };
const TOKEN = "A".repeat(43);

beforeEach(() => {
  vi.resetAllMocks();
  m.tablesList.mockResolvedValue([T1, { ...T1, number: 2, leaderUid: "u2", leaderName: "Elena", hasLink: true }]);
  m.teamCandidates.mockResolvedValue([{ uid: "u1", displayName: "Ana (ficticia)" }, { uid: "u2", displayName: "Elena (ficticia)" }]);
});

describe("Mesas y enlaces", () => {
  it("asigna encargados de teamCandidates y guarda toda la lista de mesas", async () => {
    const user = userEvent.setup();
    m.tablesSet.mockResolvedValue({ count: 2 });
    render(<TablesView edition={EDITION} />);
    await user.selectOptions(await screen.findByLabelText("Encargado de la mesa 1"), "u1");
    await user.click(screen.getByRole("button", { name: "Guardar mesas" }));
    expect(m.tablesSet).toHaveBeenCalledWith("vplt-2026", [{ number: 1, leaderUid: "u1" }, { number: 2, leaderUid: "u2" }]);
    expect(await screen.findByText("Mesas guardadas.")).toBeInTheDocument();
  });

  it("el enlace completo se muestra una vez, con copiar y advertencia, y desaparece al cerrarlo", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    m.tableLinkIssue.mockResolvedValue({ token: TOKEN, window: null });
    render(<TablesView edition={EDITION} />);
    await user.click(await screen.findByRole("button", { name: "Crear enlace de la mesa 1" }));
    const url = `${window.location.origin}/mesa#vplt-2026.1.${TOKEN}`;
    expect(m.tableLinkIssue).toHaveBeenCalledWith("vplt-2026", 1);
    expect(screen.getByLabelText("Enlace de la mesa")).toHaveValue(url);
    expect(screen.getByRole("note")).toHaveTextContent("una sola vez");
    await user.click(screen.getByRole("button", { name: /Copiar enlace/ }));
    expect(writeText).toHaveBeenCalledWith(url);
    await user.click(screen.getByRole("button", { name: /ya lo guardé/ }));
    expect(screen.queryByLabelText("Enlace de la mesa")).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("revocar pide confirmación y llama a tableLinkRevoke", async () => {
    const user = userEvent.setup();
    m.tableLinkRevoke.mockResolvedValue({ revoked: true });
    render(<TablesView edition={EDITION} />);
    await user.click(await screen.findByRole("button", { name: "Revocar enlace de la mesa 2" }));
    expect(m.tableLinkRevoke).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar: revocar mesa 2" }));
    expect(m.tableLinkRevoke).toHaveBeenCalledWith("vplt-2026", 2);
  });
});
