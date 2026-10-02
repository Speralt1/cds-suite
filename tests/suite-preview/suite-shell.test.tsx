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
