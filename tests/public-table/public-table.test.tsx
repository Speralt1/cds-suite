import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/outreach/table-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/outreach/table-client")>();
  return { ...actual, tableSearch: vi.fn(), tableMark: vi.fn(), tableUnmark: vi.fn(), tableSeat: vi.fn(), tableAddWalkIn: vi.fn(), tableListMine: vi.fn() };
});

import * as client from "@/lib/outreach/table-client";
import { PublicTable } from "@/components/public-table/public-table";
import { PUBLIC_PATH_PATTERN } from "@/lib/ui/prepaint";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
const HASH = `#ed-2026.12.${TOKEN}`;
const api = vi.mocked(client);
const ROW = { id: "reg1", fullName: "Marta Rojas", tableNumber: 12, mark: null } as const;
const OTHER = { id: "reg2", fullName: "Luis Pérez", tableNumber: 7, mark: null } as const;

function open(hash = HASH) {
  window.history.replaceState(null, "", `/mesa${hash}`);
  return render(<PublicTable />);
}
async function search(text: string) {
  fireEvent.change(await screen.findByLabelText("Buscar persona"), { target: { value: text } });
}

beforeEach(() => {
  window.sessionStorage.clear();
  api.tableSearch.mockResolvedValue([ROW]);
  const store: { id: string; fullName: string; mark: "acepto_a_cristo" | "desea_conversar" | null }[] = [];
  api.tableListMine.mockImplementation(async () => ({ items: [...store], window: null }));
  api.tableMark.mockImplementation(async (_l, i) => {
    store.push({ id: i.registrationId, fullName: i.registrationId === "reg1" ? "Marta Rojas" : "Luis Pérez", mark: i.mark });
  });
  api.tableSeat.mockImplementation(async (_l, i) => {
    store.push({ id: i.registrationId, fullName: i.registrationId === "reg1" ? "Marta Rojas" : "Luis Pérez", mark: null });
  });
  api.tableUnmark.mockImplementation(async (_l, i) => {
    const k = store.findIndex((s) => s.id === i.registrationId);
    if (k >= 0) store[k].mark = null;
  });
  api.tableAddWalkIn.mockResolvedValue({ row: { id: "new1", fullName: "Ana Soto", tableNumber: 12, mark: null } });
});
afterEach(() => vi.clearAllMocks());

describe("parseTableLink", () => {
  it("lee edición, mesa y token del fragmento", () => {
    expect(client.parseTableLink(HASH)).toEqual({ editionId: "ed-2026", table: 12, token: TOKEN });
  });
  it("rechaza token corto, mesa fuera de rango y formas raras", () => {
    for (const bad of ["", "#", "#ed.12.corto", `#ed.0.${TOKEN}`, `#ed.100.${TOKEN}`, `#ed.x.${TOKEN}`, `#${TOKEN}`, `#a.b.12.${TOKEN}`, "#%E0%A4%A"]) {
      expect(client.parseTableLink(bad), bad).toBeNull();
    }
  });
  it("el token nunca va en la URL ni en la query: solo en el cuerpo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ result: { rows: [] } }) });
    const actual = await vi.importActual<typeof import("@/lib/outreach/table-client")>("@/lib/outreach/table-client");
    await actual.tableSearch({ editionId: "ed-2026", table: 12, token: TOKEN }, "mar", { fetch: fetchMock, env: {} });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/mesa");
    expect(url).not.toContain(TOKEN);
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(init.body).data.payload).toMatchObject({ editionId: "ed-2026", table: 12, token: TOKEN, q: "mar" });
  });
  it("mapea errores del servidor a tipos", async () => {
    const actual = await vi.importActual<typeof import("@/lib/outreach/table-client")>("@/lib/outreach/table-client");
    const link = { editionId: "e", table: 1, token: TOKEN };
    const mk = (status: number, message: string, details?: unknown) => vi.fn().mockResolvedValue({ status, ok: false, json: async () => ({ error: { message, details } }) });
    const kind = async (f: ReturnType<typeof mk>) => actual.tableSearch(link, "abc", { fetch: f, env: {} }).catch((e) => e.kind);
    expect(await kind(mk(403, "outreach/link-revoked"))).toBe("revoked");
    expect(await kind(mk(403, "outreach/link-out-of-window"))).toBe("outside-window");
    expect(await kind(mk(403, "outreach/link-unavailable"))).toBe("unavailable");
    expect(await kind(mk(429, "outreach/rate-limited"))).toBe("rate-limited");
    expect(await kind(mk(500, "outreach/internal"))).toBe("server");
    expect(await kind(vi.fn().mockRejectedValue(new Error("offline")))).toBe("network");
  });
});

describe("PublicTable", () => {
  it("quita el fragmento del historial y no guarda el token en localStorage", async () => {
    open();
    await screen.findByText(/Mesa 12 · Ve por los tuyos/);
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(TOKEN);
  });

  it("enlace inválido: sin datos ni llamadas", async () => {
    open("#ed.12.malo");
    expect(await screen.findByRole("alert")).toHaveTextContent("no está disponible");
    expect(screen.queryByLabelText("Buscar persona")).toBeNull();
    expect(api.tableSearch).not.toHaveBeenCalled();
  });

  it("busca con debounce (≥3 letras) y muestra solo nombre, mesa y marca", async () => {
    api.tableSearch.mockResolvedValue([{ ...ROW, mark: "desea_conversar" }, OTHER]);
    const { container } = open();
    await search("ma");
    await new Promise((r) => setTimeout(r, 400));
    expect(api.tableSearch).not.toHaveBeenCalled();
    await search("mar");
    await screen.findByText("Marta Rojas");
    expect(api.tableSearch).toHaveBeenCalledTimes(1);
    expect(api.tableSearch.mock.calls[0][1]).toBe("mar");
    expect(screen.getByText(/Mesa 12 · Quiere conversar/)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/@|\+56|phone|tel:/i);
  });

  it("los botones de marca exigen el checkbox «Dijo que sí»", async () => {
    open();
    await search("marta");
    fireEvent.click(await screen.findByRole("button", { name: "Elegir" }));
    const accept = screen.getByRole("button", { name: "Aceptó a Cristo" });
    const talk = screen.getByRole("button", { name: "Quiere conversar" });
    expect(accept).toBeDisabled();
    expect(talk).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(accept).toBeEnabled();
    fireEvent.click(accept);
    await waitFor(() => expect(api.tableMark).toHaveBeenCalledTimes(1));
    expect(api.tableMark.mock.calls[0][1]).toMatchObject({ registrationId: "reg1", mark: "acepto_a_cristo", personAgreed: true, moveHere: false });
    expect(await screen.findByText("Aceptó a Cristo")).toBeInTheDocument();
  });

  it("«Está en mi mesa» no exige el checkbox, no marca y deja a la persona en «En esta mesa N»", async () => {
    open();
    await search("marta");
    fireEvent.click(await screen.findByRole("button", { name: "Elegir" }));
    const box = screen.getByRole("checkbox", { name: "¿Te podemos anotar para acompañarte? · Dijo que sí" });
    expect(box).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Está en mi mesa (sin decisión)" }));
    await waitFor(() => expect(api.tableSeat).toHaveBeenCalledTimes(1));
    expect(api.tableSeat.mock.calls[0][1]).toMatchObject({ registrationId: "reg1", moveHere: false });
    expect(api.tableMark).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: /En esta mesa 12/ })).toBeInTheDocument();
    expect(await screen.findByText("Sin marca")).toBeInTheDocument();
  });

  it("la búsqueda se anuncia solo por nombre", async () => {
    open();
    const input = await screen.findByLabelText("Buscar persona");
    expect(input).toHaveAttribute("placeholder", "Marta Ro…");
    expect(screen.getByText("Busca por nombre o apellido")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/código/i);
  });

  it("deshacer una marca deja a la persona en la lista como «Sin marca»", async () => {
    open();
    await search("marta");
    fireEvent.click(await screen.findByRole("button", { name: "Elegir" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Quiere conversar" }));
    fireEvent.click(await screen.findByRole("button", { name: /Deshacer marca de Marta/ }));
    await waitFor(() => expect(api.tableUnmark).toHaveBeenCalledTimes(1));
    expect(api.tableUnmark.mock.calls[0][1]).toMatchObject({ registrationId: "reg1" });
    expect(await screen.findByText("Sin marca")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deshacer marca/ })).toBeNull();
  });

  it("otra mesa: «Está en mi mesa» también pide confirmar y envía moveHere", async () => {
    api.tableSearch.mockResolvedValue([OTHER]);
    open();
    await search("luis");
    fireEvent.click(await screen.findByRole("button", { name: "Elegir" }));
    const seat = screen.getByRole("button", { name: "Está en mi mesa (sin decisión)" });
    expect(seat).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sí, está aquí" }));
    fireEvent.click(seat);
    await waitFor(() => expect(api.tableSeat).toHaveBeenCalled());
    expect(api.tableSeat.mock.calls[0][1]).toMatchObject({ registrationId: "reg2", moveHere: true });
  });

  it("otra mesa: pide confirmar y envía moveHere", async () => {
    api.tableSearch.mockResolvedValue([OTHER]);
    open();
    await search("luis");
    fireEvent.click(await screen.findByRole("button", { name: "Elegir" }));
    expect(screen.getByText(/Figura en la mesa 7; ¿está sentada aquí\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Aceptó a Cristo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sí, está aquí" }));
    fireEvent.click(screen.getByRole("button", { name: "Aceptó a Cristo" }));
    await waitFor(() => expect(api.tableMark).toHaveBeenCalled());
    expect(api.tableMark.mock.calls[0][1]).toMatchObject({ registrationId: "reg2", moveHere: true });
  });

  it("agregar sin inscripción envía nombre y teléfono y deja marcar a la persona", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Agregar a alguien sin inscripción" }));
    fireEvent.change(screen.getByLabelText("Nombre y apellido"), { target: { value: "Ana Soto" } });
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "912345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar a esta mesa" }));
    await waitFor(() => expect(api.tableAddWalkIn).toHaveBeenCalledTimes(1));
    expect(api.tableAddWalkIn.mock.calls[0][1]).toMatchObject({ fullName: "Ana Soto", phone: "912345678" });
    expect(await screen.findByRole("heading", { name: "Ana Soto" })).toBeInTheDocument();
  });

  it("sin conexión: conserva la acción y reintenta con el mismo requestId", async () => {
    api.tableMark.mockRejectedValueOnce(new client.TableOpError("network")).mockResolvedValueOnce(undefined);
    open();
    await search("marta");
    fireEvent.click(await screen.findByRole("button", { name: "Elegir" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Quiere conversar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(api.tableMark).toHaveBeenCalledTimes(2));
    const [a, b] = api.tableMark.mock.calls.map((c) => c[1]);
    expect(a.requestId).toBe(b.requestId);
    expect(a.requestId).toMatch(/^[A-Za-z0-9_-]{6,64}$/);
    await screen.findByText(/Aún no hay nadie anotado|Quiere conversar/);
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("límite de uso muestra aviso y permite reintentar", async () => {
    api.tableMark.mockRejectedValueOnce(new client.TableOpError("rate-limited"));
    open();
    await search("marta");
    fireEvent.click(await screen.findByRole("button", { name: "Elegir" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Aceptó a Cristo" }));
    expect(await screen.findByText(/Demasiadas acciones/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("enlace revocado: oculta todo y borra el enlace de sessionStorage", async () => {
    api.tableSearch.mockRejectedValue(new client.TableOpError("revoked"));
    open();
    expect(window.sessionStorage.length).toBe(1);
    await search("marta");
    expect(await screen.findByRole("alert")).toHaveTextContent("desactivado");
    expect(screen.queryByLabelText("Buscar persona")).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("fuera de horario: muestra la hora de apertura y las horas exactas del servidor", async () => {
    api.tableSearch.mockRejectedValue(new client.TableOpError("outside-window", undefined, "outreach/link-out-of-window", { opensAt: "2026-11-28T16:00", closesAt: "2026-11-29T02:00" }));
    open();
    await search("marta");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("16:00");
    expect(alert).toHaveTextContent("Abre 28-11-2026 a las 16:00 y vence 29-11-2026 a las 02:00.");
  });

  it("carga «En esta mesa» al abrir y la refresca tras marcar", async () => {
    api.tableListMine.mockResolvedValueOnce({ items: [{ id: "x1", fullName: "Rosa Díaz", mark: "desea_conversar" }], window: null });
    open();
    expect(await screen.findByText("Rosa Díaz")).toBeInTheDocument();
    api.tableListMine.mockResolvedValue({ items: [{ id: "x1", fullName: "Rosa Díaz", mark: "desea_conversar" }, { id: "reg1", fullName: "Marta Rojas", mark: "acepto_a_cristo" }], window: null });
    await search("marta");
    fireEvent.click(await screen.findByRole("button", { name: "Elegir" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Aceptó a Cristo" }));
    await waitFor(() => expect(api.tableListMine).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Aceptó a Cristo")).toBeInTheDocument();
  });

  it("tableListMine envía la operación listMine y descarta ítems mal formados", async () => {
    const actual = await vi.importActual<typeof import("@/lib/outreach/table-client")>("@/lib/outreach/table-client");
    const f = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ result: { items: [{ id: "a", fullName: "Ana", mark: "desea_conversar" }, { id: "b", fullName: "Beto", mark: null }, { id: "c", fullName: "Cata", mark: "xx" }, { id: 1 }], window: { opensAt: "a", closesAt: "b" } } }) });
    const out = await actual.tableListMine({ editionId: "e", table: 1, token: TOKEN }, { fetch: f, env: {} });
    expect(JSON.parse(f.mock.calls[0][1].body).data.op).toBe("listMine");
    expect(out.items).toEqual([{ id: "a", fullName: "Ana", mark: "desea_conversar" }, { id: "b", fullName: "Beto", mark: null }]);
    expect(out.window).toEqual({ opensAt: "a", closesAt: "b" });
  });
});

describe("aislamiento de la ruta pública", () => {
  const root = path.resolve(__dirname, "../..");
  it("/mesa está clasificada como pública y es noindex / no-referrer", () => {
    expect(PUBLIC_PATH_PATTERN.test("/mesa")).toBe(true);
    const page = fs.readFileSync(path.join(root, "app/mesa/page.tsx"), "utf8");
    expect(page).toMatch(/referrer: "no-referrer"/);
    expect(page).toMatch(/index: false/);
    const fb = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
    const rule = fb.hosting.headers.find((h: { source: string }) => h.source === "/mesa");
    expect(rule.headers).toEqual(expect.arrayContaining([{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }]));
    expect(fb.hosting.rewrites).toEqual(expect.arrayContaining([expect.objectContaining({ source: "/api/mesa", function: expect.objectContaining({ functionId: "outreachTableOp" }) })]));
  });
  it("no importa el shell privado, las preferencias ni localStorage", () => {
    const files = ["app/mesa/page.tsx", "components/public-table/public-table.tsx", "lib/outreach/table-client.ts"];
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect(src, f).not.toMatch(/@\/lib\/ui\b|lib\/ui\/|components\/layout\/(app-shell|nav-drawer|text-size-control)|\bAccessProvider\b\s*[,}]/);
      expect(src, f).not.toMatch(/localStorage/);
    }
  });
});
