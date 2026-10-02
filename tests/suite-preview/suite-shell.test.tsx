import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/preview/finanzas-2026", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

import { FinancialShell } from "@/components/finance-preview/shell";
import { AccessGate } from "@/components/suite-preview/access-gate";
import { PreviewLogin } from "@/components/suite-preview/login";
import { SuiteProvider, useSuite } from "@/components/suite-preview/provider";
import { SuiteShell } from "@/components/suite-preview/shell";
import { MODULE_LABEL, visibleModules } from "@/lib/suite-preview/access";
import { USERS } from "@/lib/suite-preview/fixtures";

function at(path: string) {
  const [pathname] = path.split("?");
  nav.pathname = pathname;
  window.history.replaceState(null, "", path);
}

beforeEach(() => {
  nav.replace.mockClear();
});

const shell = (ui: React.ReactNode = <p>contenido</p>) =>
  render(
    <SuiteProvider>
      <SuiteShell>{ui}</SuiteShell>
    </SuiteProvider>,
  );

describe("SuiteShell por perfil", () => {
  it.each(USERS.filter((u) => visibleModules(u).length).map((u) => [u.uid]))("%s: la nav Módulos muestra solo sus módulos", (uid) => {
    at(`/preview/calendario?perfil=${uid}`);
    shell();
    const modules = screen.getByRole("navigation", { name: "Módulos" });
    const labels = visibleModules(USERS.find((u) => u.uid === uid)!).map((m) => MODULE_LABEL[m]);
    const links = within(modules)
      .getAllByRole("link")
      .filter((a) => a.classList.contains("sx-module-link"))
      .map((a) => a.querySelector(".fx-nav-text")?.textContent);
    expect(links).toEqual(labels);
  });

  it("Líder: Finanzas es una hoja 'Resumen', sin detalle ni Registrar", () => {
    at("/preview/finanzas-2026/resumen?perfil=lider");
    shell();
    expect(screen.queryByRole("navigation", { name: "Finanzas" })).toBeNull();
    const finance = within(screen.getByRole("navigation", { name: "Módulos" })).getByRole("link", { name: "Finanzas" });
    expect(finance.getAttribute("href")).toMatch(/^\/preview\/finanzas-2026\/resumen\?perfil=lider/);
    expect(finance).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('a[href*="/movimientos"]')).toBeNull();
    const bottom = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(within(bottom).queryByText("Registrar")).toBeNull();
    expect(within(bottom).getByRole("link", { name: "Ir a Calendario" })).toBeInTheDocument();
    expect(screen.getAllByRole("note")[0]).toHaveTextContent(/Vista previa · datos de demostración/);
    expect(screen.getAllByRole("button", { name: /Ver como: Líder · Matías Contreras/ }).length).toBeGreaterThan(0);
  });

  it("FinancialShell dentro de SuiteProvider: una sola nav Finanzas con los links de PR #3 y una sola región status", () => {
    at("/preview/finanzas-2026?perfil=admin");
    render(
      <SuiteProvider>
        <FinancialShell>
          <p>contenido</p>
        </FinancialShell>
      </SuiteProvider>,
    );
    expect(screen.getAllByRole("navigation", { name: "Finanzas" })).toHaveLength(1);
    const fin = screen.getByRole("navigation", { name: "Finanzas" });
    for (const label of ["Hoy", "Movimientos", "Caja", "Conciliación", "Ofrendas", "Diezmos", "Cafetería", "Campañas", "Reportes", "Configuración"])
      expect(within(fin).getByRole("link", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    expect(within(fin).getByRole("link", { name: /^Atención, \d+ pendientes$/ })).toBeInTheDocument();
    expect(within(fin).getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
    expect(within(fin).getByRole("link", { name: "Reportes financieros" }).getAttribute("href")).toMatch(/^\/preview\/reportes\/finanzas/);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(document.querySelector('[data-suite-preview="SX_PREVIEW_SENTINEL_V1_c41e"]')).not.toBeNull();
    expect(document.querySelector('[data-preview="FX_PREVIEW_SENTINEL_V2_7f3a"]')).not.toBeNull();
  });

  it("Finanzas sin settings.manage no ve el atajo de Configuración financiera", () => {
    at("/preview/finanzas-2026?perfil=finanzas");
    shell();
    const fin = screen.getByRole("navigation", { name: "Finanzas" });
    expect(within(fin).queryByRole("link", { name: /^Configuración/ })).toBeNull();
    expect(within(fin).getByRole("link", { name: /^Reportes/ })).toBeInTheDocument();
  });

  it("perfil sin Integrantes: ni navegación, ni rutas, ni conteos de personas", () => {
    at("/preview/calendario?perfil=finanzas");
    const { container } = shell();
    expect(screen.queryByRole("link", { name: /Integrantes/ })).toBeNull();
    expect(container.querySelector('a[href*="/preview/integrantes"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Consolidación/);
    expect(screen.queryByRole("link", { name: /pendientes/ })).toBeNull();
  });

  it("Consolidación ve la Atención de Integrantes con su conteo", () => {
    at("/preview/integrantes/consolidacion?perfil=consolidacion");
    shell();
    const members = screen.getByRole("navigation", { name: "Integrantes" });
    expect(within(members).getByRole("link", { name: /^Atención, \d+ pendientes$/ })).toBeInTheDocument();
    expect(within(members).getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
  });
});

describe("provider, guardia e ingreso", () => {
  it("dispatch aplica la acción y muestra 'Simulación: no se guardó nada.'", () => {
    at("/preview/integrantes/consolidacion?perfil=consolidacion");
    function Probe() {
      const { dispatch, state } = useSuite();
      return (
        <>
          <span data-testid="visits">{state.visits.length}</span>
          <button type="button" onClick={() => dispatch({ type: "visit/register", input: { personId: "p-01", date: "2026-10-04" } }, "Visita registrada")}>
            registrar
          </button>
        </>
      );
    }
    render(
      <SuiteProvider>
        <Probe />
      </SuiteProvider>,
    );
    const before = Number(screen.getByTestId("visits").textContent);
    fireEvent.click(screen.getByRole("button", { name: "registrar" }));
    expect(Number(screen.getByTestId("visits").textContent)).toBe(before + 1);
    expect(screen.getByRole("status")).toHaveTextContent("Visita registrada. Simulación: no se guardó nada.");
  });

  it("deep link no permitido: redirige una sola vez, con aviso, sin renderizar la ruta", () => {
    at("/preview/integrantes/consolidacion?perfil=lider");
    render(
      <SuiteProvider>
        <AccessGate>
          <p>datos de integrantes</p>
        </AccessGate>
      </SuiteProvider>,
    );
    expect(screen.queryByText("datos de integrantes")).toBeNull();
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/preview/calendario?perfil=lider");
  });

  it("perfil sin permisos: pantalla 'sin módulos', sin redirecciones", () => {
    at("/preview/calendario?perfil=sin-permisos");
    render(
      <SuiteProvider>
        <AccessGate>
          <p>calendario</p>
        </AccessGate>
      </SuiteProvider>,
    );
    expect(screen.getByRole("heading", { name: "Aún no tienes módulos asignados" })).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("perfil desconocido vuelve al ingreso", () => {
    at("/preview/calendario?perfil=intruso");
    render(
      <SuiteProvider>
        <AccessGate>
          <p>calendario</p>
        </AccessGate>
      </SuiteProvider>,
    );
    expect(nav.replace).toHaveBeenCalledWith("/preview");
  });

  it("el ingreso lista los 8 perfiles con 'Entra a …' y navega directo al módulo", () => {
    at("/preview");
    render(
      <SuiteProvider>
        <AccessGate>
          <PreviewLogin />
        </AccessGate>
      </SuiteProvider>,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(8);
    expect(screen.getByText("Entra a Consolidación")).toBeInTheDocument();
    expect(screen.getByText("Sin módulos asignados")).toBeInTheDocument();
    expect(screen.getByText("Entra a Calendario*")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /Carolina Vidal/ }));
    expect(nav.replace).toHaveBeenCalledWith("/preview/integrantes/consolidacion?perfil=consolidacion");
    expect(screen.getByRole("status")).toHaveTextContent("Ahora ves CDS como Consolidación · Carolina Vidal. Entraste a Consolidación.");
  });
});

describe("shell: correcciones ciclo 1 (S)", () => {
  it("el host de toasts no usa una clase raíz que lo meta al flujo (sx-toast-host)", () => {
    at("/preview/calendario?perfil=admin");
    shell();
    const host = screen.getByRole("status").parentElement!;
    expect(host).toHaveClass("fx", "sx-toast-host");
    expect(host).not.toHaveClass("fx-toast-host");
  });

  it("pie de la sidebar: si el cargo es el nombre de su única área, muestra solo el cargo", () => {
    at("/preview/integrantes/consolidacion?perfil=consolidacion");
    shell();
    const org = document.querySelector(".sx-sidebar .fx-side-org")!;
    expect(org.textContent).toBe("Consolidación");
  });

  it("Finanzas en el rail: los atajos ↗ siguen en el DOM, marcados para ocultarse solo por CSS", () => {
    at("/preview/finanzas-2026?perfil=admin");
    shell();
    const fin = screen.getByRole("navigation", { name: "Finanzas" });
    for (const label of ["Reportes financieros", "Configuración financiera"]) {
      const link = within(fin).getByRole("link", { name: label });
      expect(link.closest("li")).toHaveClass("sx-section-shortcut");
      expect(link.closest(".sx-section-group")).toHaveClass("is-shortcuts");
      expect(link).toHaveAttribute("title");
    }
    expect(within(fin).getByRole("link", { name: /^Movimientos/ }).closest(".sx-section-group")).not.toHaveClass("is-shortcuts");
  });

  it("Ver como: nombre accesible completo (aunque el móvil muestre solo el cargo) y nota del asterisco", () => {
    at("/preview/calendario?perfil=lider");
    shell();
    const triggers = screen.getAllByRole("button", { name: "Ver como: Líder · Matías Contreras" });
    expect(triggers).toHaveLength(2);
    expect(document.querySelector(".sx-banner-mobile .sx-sim-who-short")?.textContent).toBe("Líder");
    const desktop = triggers.find((b) => b.closest(".sx-banner"))!;
    fireEvent.click(desktop);
    const pop = screen.getByRole("dialog", { name: "Ver como (vista previa)" });
    expect(within(pop).getAllByText(/\*$/).length).toBeGreaterThan(0);
    expect(within(pop).getByText("* Su módulo inicial (Finanzas) ya no está permitido.")).toBeInTheDocument();
  });
});

describe("shell: correcciones ciclo 2 (S)", () => {
  it.each([
    ["admin", "Ver como: Administración (demo)", "Admin"],
    ["consolidacion", "Ver como: Consolidación · Carolina Vidal", "Consolid."],
    ["sin-permisos", "Ver como: Usuario sin permisos", "Sin acceso"],
    ["lider", "Ver como: Líder · Matías Contreras", "Líder"],
  ])("Ver como (%s): etiqueta corta móvil nunca vacía y nombre accesible completo", (uid, name, short) => {
    at(`/preview/calendario?perfil=${uid}`);
    shell();
    expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
    const el = document.querySelector(".sx-banner-mobile .sx-sim-who-short");
    expect(el?.textContent).toBe(short);
  });

  it("Nueva persona es una tarea enfocada: sin barra inferior; Personas sí la tiene", () => {
    at("/preview/integrantes/consolidacion/nueva?perfil=consolidacion");
    const { unmount } = shell();
    expect(screen.queryByRole("navigation", { name: "Navegación principal" })).toBeNull();
    expect(document.querySelector(".fx-shell")).toHaveClass("sx-focused");
    unmount();
    at("/preview/integrantes/consolidacion/personas?perfil=consolidacion");
    shell();
    expect(screen.getByRole("navigation", { name: "Navegación principal" })).toBeInTheDocument();
    expect(document.querySelector(".fx-shell")).not.toHaveClass("sx-focused");
  });

  it("Reportes usa íconos de reporte (no los de los módulos Finanzas/Calendario)", () => {
    at("/preview/reportes/calendario?perfil=admin");
    shell();
    const bottom = screen.getByRole("navigation", { name: "Navegación principal" });
    const cal = within(bottom).getByRole("link", { name: "Calendario" });
    const fin = within(bottom).getByRole("link", { name: "Finanzas" });
    expect(cal.querySelector("svg")?.getAttribute("class")).toMatch(/file-chart/);
    expect(fin.querySelector("svg")?.getAttribute("class")).toMatch(/file-chart/);
    const reportes = screen.getByRole("navigation", { name: "Reportes" });
    for (const a of within(reportes).getAllByRole("link")) expect(a.querySelector("svg")?.getAttribute("class")).toMatch(/file-chart/);
  });

  it("Configuración: la sección se llama «Ajustes de finanzas»; el atajo financiero conserva su nombre", () => {
    at("/preview/configuracion/areas?perfil=admin");
    const { unmount } = shell();
    const cfg = screen.getByRole("navigation", { name: "Configuración" });
    expect(within(cfg).getByRole("link", { name: "Ajustes de finanzas" })).toHaveAttribute("href", expect.stringMatching(/^\/preview\/configuracion\/finanzas/));
    expect(within(cfg).queryByText("Finanzas e integraciones")).toBeNull();
    unmount();
    at("/preview/finanzas-2026?perfil=admin");
    shell();
    const fin = screen.getByRole("navigation", { name: "Finanzas" });
    expect(within(fin).getByRole("link", { name: "Configuración financiera" })).toBeInTheDocument();
  });
});

describe("PreviewProvider.sync (ciclo 2, S3)", () => {
  it("un QUERY_EVENT sin cambios de período ni de estado no re-renderiza a los consumidores", async () => {
    const { act } = await import("@testing-library/react");
    const { PreviewProvider, usePreview } = await import("@/components/finance-preview/context");
    const { QUERY_EVENT } = await import("@/components/suite-preview/use-query");
    const renders = { n: 0 };
    function Consumer() {
      const { period, demoState } = usePreview();
      renders.n += 1;
      return <p data-testid="q">{`${period.year}-${demoState}`}</p>;
    }
    at("/preview/finanzas-2026?periodo=2026-09&perfil=admin");
    render(
      <PreviewProvider>
        <Consumer />
      </PreviewProvider>,
    );
    const settled = renders.n;
    act(() => {
      window.history.replaceState(null, "", "/preview/finanzas-2026?periodo=2026-09&perfil=admin&vista=lista");
      window.dispatchEvent(new Event(QUERY_EVENT));
    });
    expect(renders.n).toBe(settled);
    act(() => {
      window.history.replaceState(null, "", "/preview/finanzas-2026?periodo=2026-08&perfil=admin&estado=error");
      window.dispatchEvent(new Event(QUERY_EVENT));
    });
    expect(renders.n).toBeGreaterThan(settled);
    expect(screen.getByTestId("q")).toHaveTextContent("error");
  });
});
