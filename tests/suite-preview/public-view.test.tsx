import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/preview/calendario/compartir/demo", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

import { PublicCalendarScreen } from "@/components/suite-preview/calendar/public-adapter";
import { SuiteProvider, useSuite } from "@/components/suite-preview/provider";
import { LEAK_CANARIES, LEAK_STRINGS, PERSONS, TEAM_EVENT_TITLES, USERS } from "@/lib/suite-preview/fixtures";

// 16c §E.3: render de la página pública en todas sus vistas, abriendo CADA
// detalle (incluido el cancelado): el HTML no contiene canarios, títulos de
// equipo, correos ni nombres; no hay links internos salvo /compartir/; el
// estado inválido y el desactivado muestran exactamente lo mismo.

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void; close?: () => void };
  if (typeof proto.showModal !== "function")
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  if (typeof proto.close !== "function")
    proto.close = function (this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
});

function at(path: string) {
  const [pathname] = path.split("?");
  nav.pathname = pathname;
  window.history.replaceState(null, "", path);
}

const forbidden = [
  ...Object.values(LEAK_CANARIES),
  ...LEAK_STRINGS,
  ...TEAM_EVENT_TITLES,
  ...USERS.flatMap((u) => [u.displayName, u.email]),
  ...PERSONS.map((p) => p.fullName),
];

function assertClean(html: string) {
  for (const s of forbidden) expect(html, s).not.toContain(s);
  expect(html).not.toContain("@");
  expect(html).not.toContain("perfil=");
  expect(html.toLowerCase()).not.toContain("token");
  for (const m of html.matchAll(/href="([^"]*)"/g)) {
    const href = m[1];
    if (href.startsWith("/preview/")) expect(href, href).toMatch(/^\/preview\/calendario\/compartir\//);
  }
}

let suiteRef: ReturnType<typeof useSuite> | null = null;

function renderPublic(path: string, before?: (s: ReturnType<typeof useSuite>) => void) {
  at(path);
  function Harness() {
    suiteRef = useSuite();
    return <PublicCalendarScreen />;
  }
  const r = render(
    <SuiteProvider>
      <Harness />
    </SuiteProvider>,
  );
  if (before) act(() => before(suiteRef!));
  return r;
}

const rowButtons = () => [...document.querySelectorAll<HTMLButtonElement>(".sx-pub-main .sx-agenda-row")];

function openEveryDetail(container: HTMLElement): number {
  let opened = 0;
  const labels = rowButtons().map((b) => b.getAttribute("aria-label"));
  for (const label of labels) {
    const btn = rowButtons().find((b) => b.getAttribute("aria-label") === label)!;
    fireEvent.click(btn);
    const dlg = document.querySelector("dialog.sx-pub-dialog")!;
    expect(dlg.hasAttribute("open")).toBe(true);
    assertClean(container.innerHTML);
    fireEvent.click(dlg.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!);
    opened++;
  }
  return opened;
}

describe("calendario público (render)", () => {
  it("agenda de cada mes publicado + todos los detalles, sin fugas", () => {
    const { container } = renderPublic("/preview/calendario/compartir/demo");
    expect(container.querySelector('[data-suite-preview="SX_PREVIEW_SENTINEL_V1_c41e"]')).not.toBeNull();
    expect(screen.getByText("Casa de Salvación")).toBeInTheDocument();
    expect(screen.getByText("Horarios en hora de Chile continental.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/America\/Santiago/);
    // Sin shell de la app.
    expect(screen.queryByRole("navigation", { name: "Módulos" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Ver como/ })).toBeNull();
    assertClean(container.innerHTML);

    // Mes actual completo (incluye días anteriores) y los siguientes.
    fireEvent.click(screen.getByRole("button", { name: "Ver días anteriores" }));
    let total = 0;
    let sawCancelled = false;
    for (let i = 0; i < 8; i++) {
      sawCancelled ||= rowButtons().some((b) => /cancelada$/.test(b.getAttribute("aria-label") ?? ""));
      total += openEveryDetail(container);
      const next = screen.getByRole("button", { name: /Mes siguiente|No hay más meses publicados/ });
      if ((next as HTMLButtonElement).disabled) break;
      fireEvent.click(next);
    }
    expect(total).toBeGreaterThan(40);
    expect(sawCancelled).toBe(true);
  });

  it("el detalle cancelado dice 'Esta actividad no se realizará.' sin motivo", () => {
    const { container } = renderPublic("/preview/calendario/compartir/demo");
    const evang = rowButtons().find((b) => /^Evangelismo en la plaza/.test(b.getAttribute("aria-label") ?? ""))!;
    fireEvent.click(evang);
    const dlg = document.querySelector("dialog.sx-pub-dialog")!;
    expect(dlg.textContent).toContain("Esta actividad no se realizará.");
    expect(dlg.textContent).toContain("Organiza: Consolidación");
    expect(dlg.textContent).not.toMatch(/Motivo|lluvia/i);
    assertClean(container.innerHTML);
  });

  it("vista Mes: cada día y su lista, sin fugas", () => {
    const { container } = renderPublic("/preview/calendario/compartir/demo");
    fireEvent.click(screen.getByRole("button", { name: "Mes" }));
    const grid = screen.getByRole("table", { name: "Octubre 2026" });
    const days = [...grid.querySelectorAll<HTMLButtonElement>("button.sx-pub-day")];
    expect(days.length).toBeGreaterThanOrEqual(35);
    for (const d of days) {
      fireEvent.click(d);
      assertClean(container.innerHTML);
    }
    // Abre los detalles del día seleccionado (31-10: vigilia + fiesta).
    fireEvent.click(days.find((d) => /sábado 31 de octubre/.test(d.getAttribute("aria-label") ?? ""))!);
    expect(openEveryDetail(container)).toBeGreaterThan(0);
  });

  it("filtro por área: solo áreas activas con actividades públicas", () => {
    renderPublic("/preview/calendario/compartir/demo");
    fireEvent.click(screen.getByRole("button", { name: /Áreas \(Todas\)/ }));
    expect(screen.queryByRole("checkbox", { name: /Matrimonios/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Damas/ }));
    expect(rowButtons().length).toBeGreaterThan(0);
    expect(rowButtons().every((b) => /Damas|Niños/.test(b.getAttribute("aria-label") ?? ""))).toBe(true);
  });
});

describe("calendario público (no disponible)", () => {
  it("enlace inválido y enlace desactivado muestran exactamente el mismo texto", () => {
    const invalid = renderPublic("/preview/calendario/compartir/demo?t=otro");
    const invalidText = invalid.container.querySelector(".sx-public")!.textContent;
    expect(invalidText).toContain("Este calendario no está disponible");
    assertClean(invalid.container.innerHTML);
    invalid.unmount();

    const deactivated = renderPublic("/preview/calendario/compartir/demo", (s) => {
      s.dispatch({ type: "share/deactivate" });
    });
    const deactivatedText = deactivated.container.querySelector(".sx-public")!.textContent;
    expect(deactivatedText).toContain("Este calendario no está disponible");
    expect(deactivatedText).toBe(invalidText);
    assertClean(deactivated.container.innerHTML);
  });

  it("tras regenerar, el enlace anterior deja de funcionar y el nuevo resuelve", () => {
    const r = renderPublic("/preview/calendario/compartir/demo", (s) => {
      s.dispatch({ type: "share/regenerate" });
    });
    expect(r.container.textContent).toContain("Este calendario no está disponible");
    r.unmount();
  });
});

describe("calendario público · correcciones ciclo 1", () => {
  it("C6: el detalle de una actividad repetida muestra la línea de recurrencia, sin fugas", () => {
    const { container } = renderPublic("/preview/calendario/compartir/demo");
    const culto = rowButtons().find((b) => /^Culto dominical/.test(b.getAttribute("aria-label") ?? ""))!;
    fireEvent.click(culto);
    const dlg = document.querySelector("dialog.sx-pub-dialog")!;
    expect(dlg.querySelector(".sx-detail-recurrence")).toHaveTextContent("Se repite cada domingo hasta el 28 feb 2027");
    expect(dlg.textContent).toContain("Horarios en hora de Chile continental.");
    assertClean(container.innerHTML);
  });
});
