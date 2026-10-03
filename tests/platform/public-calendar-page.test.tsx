import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPublicModel } from "@/components/public-calendar/model";
import {
  PUBLIC_ERROR_TEXT,
  PUBLIC_TZ_NOTE,
  PUBLIC_UNAVAILABLE_TITLE,
  PublicCalendarView,
} from "@/components/public-calendar/public-calendar";
import { PublicCalendarRoute } from "@/app/calendario-publico/public-calendar-route";
import { buildPublicCalendar } from "@/lib/shared/public-calendar";
import { AREAS, CANARIES, EVENTS, NOW, TODAY } from "./public-calendar-fixtures";

const CAL = buildPublicCalendar({ events: EVENTS, areas: AREAS, today: TODAY, now: NOW });
const MODEL = buildPublicModel(CAL, TODAY);
const VALID = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
const PRIVATE_HREF = /\/calendario\/(mis-actividades|compartir\/?$)|\/configuracion|\/finanzas|\/reportes|\/login|\/inicio/;

function expectNoCanaries(html: string) {
  for (const c of Object.values(CANARIES)) expect(html, c).not.toContain(c);
  expect(html).not.toContain("@cds.test");
}

function expectNoPrivateLinks(container: HTMLElement) {
  for (const a of Array.from(container.querySelectorAll("a"))) {
    expect(a.getAttribute("href") ?? "", a.outerHTML).not.toMatch(PRIVATE_HREF);
  }
  expect(container.innerHTML).not.toMatch(/href="\/(calendario|configuracion|finanzas|reportes)/);
}

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("vista pública con la proyección sanitizada", () => {
  it("agenda por defecto, sin canarios ni enlaces privados, con pie de zona horaria", () => {
    const { container } = render(<PublicCalendarView status="ready" model={MODEL} />);
    expect(screen.getByRole("button", { name: "Agenda" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Octubre 2026" })).toBeInTheDocument();
    expect(screen.getAllByText("Culto dominical").length).toBeGreaterThan(0);
    expect(screen.getByText(PUBLIC_TZ_NOTE)).toBeInTheDocument();
    expectNoCanaries(container.innerHTML);
    expectNoPrivateLinks(container);
    expect(container.innerHTML).not.toMatch(/Vista previa|Demo|DEMO|demostraci/);
  });

  it("detalle público: 'Organiza:', cancelada sin motivo", () => {
    const { container } = render(<PublicCalendarView status="ready" model={MODEL} />);
    fireEvent.click(screen.getByRole("button", { name: /^Evangelismo en la plaza/ }));
    const dialog = container.querySelector("dialog")!;
    expect(within(dialog).getByText(/Organiza: Jóvenes/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Esta actividad no se realizará\./)).toBeInTheDocument();
    expectNoCanaries(container.innerHTML);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    expect(container.querySelector("dialog")!.textContent).toBe("");
  });

  it("vista Mes y filtro por área tampoco filtran datos internos", () => {
    const { container } = render(<PublicCalendarView status="ready" model={MODEL} />);
    fireEvent.click(screen.getByRole("button", { name: "Mes" }));
    expect(screen.getByRole("table", { name: "Octubre 2026" })).toBeInTheDocument();
    expectNoCanaries(container.innerHTML);
    fireEvent.click(screen.getByRole("button", { name: /Áreas/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Intercesión" }));
    expect(screen.getByRole("button", { name: /Áreas \(1\)/ })).toBeInTheDocument();
    expectNoCanaries(container.innerHTML);
    expectNoPrivateLinks(container);
  });

  it("mes vacío: mensaje y salto al mes siguiente", () => {
    const empty = buildPublicModel({ ...CAL, events: [] }, TODAY);
    render(<PublicCalendarView status="ready" model={empty} />);
    expect(screen.getByText("No hay actividades publicadas en octubre.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver noviembre/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Noviembre 2026" })).toBeInTheDocument();
  });

  it("cargando: skeleton sin datos; error de red con Reintentar", () => {
    const onRetry = vi.fn();
    const { rerender, container } = render(<PublicCalendarView status="loading" model={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando el calendario");
    expect(container.querySelectorAll(".pub-skel")).toHaveLength(6);
    rerender(<PublicCalendarView status="error" model={null} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent(PUBLIC_ERROR_TEXT);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("ruta pública /calendario-publico", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T15:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  async function renderAt(url: string) {
    window.history.replaceState({}, "", url);
    const view = render(<PublicCalendarRoute />);
    await act(async () => {});
    return view;
  }

  it("el HTML prerenderizado es solo el skeleton (sin datos)", () => {
    const html = renderToString(<PublicCalendarRoute />);
    expect(html).toContain("Cargando el calendario");
    expect(html).not.toContain("Culto dominical");
    expect(html).not.toContain(PUBLIC_UNAVAILABLE_TITLE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("'no disponible' es idéntico para enlace mal formado (sin red) y 404", async () => {
    const malformed = await renderAt("/calendario/compartir/no-es-un-enlace");
    await screen.findByRole("heading", { name: PUBLIC_UNAVAILABLE_TITLE });
    expect(fetchMock).not.toHaveBeenCalled();
    const malformedHtml = malformed.container.innerHTML;
    malformed.unmount();

    const missingQuery = await renderAt("/calendario-publico");
    await screen.findByRole("heading", { name: PUBLIC_UNAVAILABLE_TITLE });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(missingQuery.container.innerHTML).toBe(malformedHtml);
    missingQuery.unmount();

    fetchMock.mockImplementation(() => json(404, { ok: false, error: "unavailable" }));
    const notFound = await renderAt(`/calendario/compartir/${VALID}`);
    await screen.findByRole("heading", { name: PUBLIC_UNAVAILABLE_TITLE });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/calendario-publico?t=${VALID}`);
    expect(notFound.container.innerHTML).toBe(malformedHtml);
    notFound.unmount();

    const notFoundQuery = await renderAt(`/calendario-publico?t=${VALID}`);
    await screen.findByRole("heading", { name: PUBLIC_UNAVAILABLE_TITLE });
    expect(notFoundQuery.container.innerHTML).toBe(malformedHtml);
    expect(malformedHtml).toContain("Es posible que el enlace haya cambiado. Pide el enlace actualizado a la iglesia.");
  });

  it("error de red → Reintentar vuelve a pedir y muestra el calendario", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")));
    fetchMock.mockImplementationOnce(() => json(200, { ok: true, calendar: CAL }));
    const { container } = await renderAt(`/calendario/compartir/${VALID}`);
    await screen.findByText(PUBLIC_ERROR_TEXT);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getAllByText("Culto dominical").length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { level: 2, name: "Octubre 2026" })).toBeInTheDocument();
    expectNoCanaries(container.innerHTML);
    expectNoPrivateLinks(container);
  });
});
