import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/app-shell";
import { RouteGuard } from "@/components/layout/route-guard";
import { ModuleSubnav } from "@/components/layout/module-subnav";
import { NoticeProvider, NoticeRegion, useToast } from "@/components/layout/notice";
import { consumeLandingIntent, markLandingIntent, peekLandingIntent } from "@/lib/access/landing-intent";
import { PROFILES, profile, v1 } from "./profiles";

const state = vi.hoisted(() => ({
  path: "/finanzas",
  access: null as Record<string, unknown> | null,
  replace: vi.fn(),
  logout: vi.fn(),
  areas: [] as { id: string; name: string; color: string; active: boolean }[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "u1", email: "persona@cds.test" }, logout: state.logout }),
}));
vi.mock("@/lib/auth/access-provider", () => ({
  useOptionalAccess: () => state.access,
  useAccess: () => {
    if (!state.access) throw new Error("Acceso no autorizado");
    return state.access;
  },
}));
vi.mock("@/lib/calendar/areas-client", () => ({
  useAreas: () => ({ areas: state.areas, loading: false, error: "" }),
}));

const LABEL = { finance: "Finanzas", calendar: "Calendario", members: "Integrantes", reports: "Reportes", settings: "Configuración" };

beforeEach(() => {
  state.path = "/finanzas";
  state.access = null;
  state.areas = [];
  state.replace.mockClear();
  state.logout.mockReset();
  state.logout.mockResolvedValue(undefined);
  consumeLandingIntent();
});

/** Nombres accesibles de los links (los tooltips del rail son aria-hidden). */
function moduleNames(nav: HTMLElement) {
  return within(nav)
    .getAllByRole("link")
    .map((a) =>
      [...a.childNodes]
        .filter((n) => !(n instanceof Element && n.getAttribute("aria-hidden") === "true"))
        .map((n) => n.textContent)
        .join(""),
    );
}

function shell(children: React.ReactNode = <p>Contenido</p>) {
  return render(<AppShell>{children}</AppShell>);
}

describe("AppShell: módulos por perfil", () => {
  for (const p of PROFILES.filter((x) => x.home.startsWith("/"))) {
    it(`${p.name}: sidebar, rail y barra móvil muestran solo sus módulos`, () => {
      state.access = p.doc as Record<string, unknown>;
      shell();
      expect(moduleNames(screen.getByRole("navigation", { name: "Módulos" }))).toEqual(
        p.modules.map((m) => LABEL[m]),
      );
      const bar = screen.getByRole("navigation", { name: "Barra de módulos" });
      const items = [...within(bar).queryAllByRole("link"), ...within(bar).queryAllByRole("button")];
      // Ciclo 1 (C1): sin "Más"; la cuenta vive en el avatar de la top bar.
      expect(items.length).toBe(p.modules.length);
      // Admin con Integrantes llega a 5 (doc 23): sigue sin «Más».
      expect(items.length).toBeLessThanOrEqual(5);
      expect(within(bar).queryByRole("button", { name: "Más" })).toBeNull();
      // Integrantes solo para quien tiene el módulo (admin o permiso explícito).
      if (!p.modules.includes("members")) expect(screen.queryByText(/Integrantes/i)).toBeNull();
      expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(1);
      expect(screen.getByText("Contenido")).toBeVisible();
    });
  }

  it("sin AccessProvider: solo Finanzas, como antes", () => {
    shell();
    const nav = screen.getByRole("navigation", { name: "Módulos" });
    expect(moduleNames(nav)).toEqual(["Finanzas"]);
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
    expect(screen.getByText("persona@cds.test", { selector: "aside p" })).toBeInTheDocument();
  });

  it("marca el módulo activo con aria-current (Reportes financieros activa Finanzas)", () => {
    state.access = { role: "admin", active: true };
    state.path = "/finanzas/reportes";
    shell();
    const nav = screen.getByRole("navigation", { name: "Módulos" });
    expect(within(nav).getByRole("link", { name: "Finanzas" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Reportes" })).not.toHaveAttribute("aria-current");
    state.path = "/configuracion/usuarios";
    shell();
    expect(
      within(screen.getAllByRole("navigation", { name: "Módulos" })[1]).getByRole("link", { name: "Configuración" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("marca, skip link y main se conservan", () => {
    state.access = { role: "leader", active: true };
    shell();
    expect(screen.getByRole("link", { name: "Saltar al contenido" })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    const brand = screen.getAllByRole("link", { name: /Casa de Salvación · CDS Suite/ });
    expect(brand[0]).toHaveAttribute("href", "/inicio");
    expect(screen.queryByText(/V0\.2/)).toBeNull();
  });

  it("AccountFooter: nombre visible y cargo · áreas", () => {
    state.access = { ...v1({ position: "Líder", permissions: ["calendar.events.manage_assigned"], areaIds: ["jovenes"] }), displayName: "Ana Pérez" };
    state.areas = [{ id: "jovenes", name: "Jóvenes", color: "azul", active: true }];
    shell();
    const aside = screen.getByRole("complementary");
    expect(within(aside).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(aside).getByText("Líder · Jóvenes")).toBeInTheDocument();
  });

  it("sin nombre visible usa el correo; legacy muestra su cargo", () => {
    state.access = { role: "finance", active: true, displayName: "" };
    shell();
    const aside = screen.getByRole("complementary");
    expect(within(aside).getByText("persona@cds.test")).toBeInTheDocument();
    expect(within(aside).getByText("Finanzas", { selector: "p" })).toBeInTheDocument();
  });

  it("cuenta sin módulos: pantalla in situ, sin navegación ni contenido", () => {
    state.access = profile("v1 sin módulos").doc as Record<string, unknown>;
    shell();
    expect(screen.getByRole("heading", { name: "Aún no tienes módulos asignados" })).toBeVisible();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("Contenido")).toBeNull();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("el avatar 'Cuenta' abre la hoja de cuenta con Cerrar sesión; el error de logout es un único alert", async () => {
    const user = userEvent.setup();
    state.access = { role: "leader", active: true, displayName: "Ana" };
    state.logout.mockRejectedValueOnce({ code: "auth/network-request-failed" });
    shell();
    await user.click(screen.getByRole("button", { name: "Cuenta" }));
    const sheet = screen.getByRole("dialog", { name: "Cuenta" });
    expect(within(sheet).getByText("Ana")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Cerrar sesión" }));
    expect(state.logout).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(within(sheet).getByRole("alert")).toHaveTextContent("conexión");
    await user.click(within(sheet).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("botón Cuenta de la top bar móvil abre la misma hoja", async () => {
    const user = userEvent.setup();
    state.access = { role: "admin", active: true };
    shell();
    await user.click(screen.getByRole("button", { name: "Cuenta" }));
    expect(screen.getByRole("dialog", { name: "Cuenta" })).toBeInTheDocument();
  });
});

describe("AppShell · barra móvil sin «Más» (ciclo 1, C1)", () => {
  it("admin: 5 módulos con Integrantes, sin «Más»; Configuración conserva su nombre accesible completo", () => {
    state.access = { role: "admin", active: true };
    shell();
    const bar = screen.getByRole("navigation", { name: "Barra de módulos" });
    expect(within(bar).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Finanzas",
      "Calendario",
      "Integrantes",
      "Reportes",
      "Configuración",
    ]);
    expect(within(bar).queryAllByRole("button")).toHaveLength(0);
    expect(bar.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
    const settings = within(bar).getByRole("link", { name: "Configuración" });
    expect(settings).toHaveAttribute("href", "/configuracion");
    // Con 5 columnas la etiqueta visible es siempre la corta; el nombre accesible, el completo.
    expect(within(settings).getByText("Ajustes")).toBeInTheDocument();
    expect(within(settings).queryByText("Configuración")).toBeNull();
    expect(within(bar).getByRole("link", { name: "Integrantes" })).toHaveAttribute("href", "/integrantes");
    expect(screen.queryByText("Más")).toBeNull();
  });

  it("pastor (4 módulos): Configuración no está y la etiqueta de Reportes es completa", () => {
    state.access = { role: "pastor", active: true };
    shell();
    const bar = screen.getByRole("navigation", { name: "Barra de módulos" });
    expect(within(bar).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual(["Finanzas", "Calendario", "Reportes"]);
    expect(screen.queryByText(/Integrantes/i)).toBeNull();
  });

  it("sin AccessProvider: un único «Cerrar sesión», el avatar abre la hoja y hay un solo alert", async () => {
    const user = userEvent.setup();
    state.logout.mockRejectedValueOnce({ code: "auth/network-request-failed" });
    shell();
    expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cuenta" }));
    const sheet = screen.getByRole("dialog", { name: "Cuenta" });
    expect(within(sheet).getByRole("alert")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

describe("RouteGuard", () => {
  function guarded() {
    const child = vi.fn(() => <p>Ruta privada</p>);
    function Child() {
      return child();
    }
    const view = render(
      <NoticeProvider>
        <NoticeRegion />
        <RouteGuard>
          <Child />
        </RouteGuard>
      </NoticeProvider>,
    );
    return { child, view };
  }

  it("deep link prohibido: un solo replace, nunca monta la ruta y muestra el aviso en el destino", () => {
    state.access = { role: "leader", active: true };
    state.path = "/configuracion";
    const { child, view } = guarded();
    expect(child).not.toHaveBeenCalled();
    expect(screen.getByText("Verificando tu sesión…")).toBeInTheDocument();
    expect(state.replace).toHaveBeenCalledTimes(1);
    expect(state.replace).toHaveBeenCalledWith("/calendario");
    view.rerender(
      <NoticeProvider>
        <NoticeRegion />
        <RouteGuard>
          <p>Ruta privada</p>
        </RouteGuard>
      </NoticeProvider>,
    );
    expect(state.replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No tienes acceso a Configuración. Te llevamos a Calendario.")).toBeNull();
  });

  it("el aviso aparece al llegar al destino y se limpia en la siguiente navegación", () => {
    state.access = { role: "leader", active: true };
    state.path = "/configuracion";
    // Elementos nuevos en cada render: usePathname es un mock sin suscripción.
    const tree = () => (
      <NoticeProvider>
        <NoticeRegion />
        <RouteGuard>
          <p>Ruta privada</p>
        </RouteGuard>
      </NoticeProvider>
    );
    const view = render(tree());
    state.path = "/calendario";
    view.rerender(tree());
    const status = screen.getAllByRole("status").find((el) => el.textContent?.includes("No tienes acceso"));
    expect(status).toHaveTextContent("No tienes acceso a Configuración. Te llevamos a Calendario.");
    expect(screen.getByText("Ruta privada")).toBeVisible();
    state.path = "/reportes";
    view.rerender(tree());
    expect(screen.queryByText(/No tienes acceso/)).toBeNull();
  });

  it("ruta permitida: monta los hijos sin redirect", () => {
    state.access = { role: "admin", active: true };
    state.path = "/configuracion/usuarios";
    const { child } = guarded();
    expect(child).toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("Líder con intención en /finanzas → /calendario una vez; la intención se consume", () => {
    state.access = { role: "leader", active: true };
    markLandingIntent();
    const { child } = guarded();
    expect(child).not.toHaveBeenCalled();
    expect(state.replace).toHaveBeenCalledExactlyOnceWith("/calendario");
    expect(peekLandingIntent()).toBe(false);
  });

  it("Admin con intención se queda en /finanzas y consume la intención", () => {
    state.access = { role: "admin", active: true };
    markLandingIntent();
    const { child } = guarded();
    expect(child).toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
    expect(peekLandingIntent()).toBe(false);
  });

  it("sin módulos: pantalla in situ sin redirect", () => {
    state.access = profile("v1 sin módulos").doc as Record<string, unknown>;
    const { child } = guarded();
    expect(child).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Aún no tienes módulos asignados" })).toBeVisible();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("sin acceso confirmado no monta nada", () => {
    const { child } = guarded();
    expect(child).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
  });
});

describe("ModuleSubnav y toasts", () => {
  it("activa el ítem más específico y usa un aria-label propio del módulo", () => {
    state.path = "/calendario/mis-actividades";
    render(
      <ModuleSubnav
        label="Calendario"
        items={[
          { href: "/calendario", label: "Calendario" },
          { href: "/calendario/mis-actividades", label: "Mis actividades" },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Secciones de Calendario" });
    expect(within(nav).getByRole("link", { name: "Mis actividades" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Calendario" })).not.toHaveAttribute("aria-current");
  });

  it("useToast publica en la región role=status única del shell", async () => {
    const user = userEvent.setup();
    state.access = { role: "admin", active: true };
    function SaveButton() {
      const { toast } = useToast();
      return (
        <button type="button" onClick={() => toast("Cambios guardados.")}>
          Guardar
        </button>
      );
    }
    render(
      <NoticeProvider>
        <AppShell>
          <SaveButton />
        </AppShell>
      </NoticeProvider>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByRole("status")).toHaveTextContent("Cambios guardados.");
  });

  it("useToast fuera del provider no falla", async () => {
    function Lonely() {
      const { toast } = useToast();
      return (
        <button type="button" onClick={() => toast("x")}>
          Probar
        </button>
      );
    }
    render(<Lonely />);
    await act(async () => screen.getByRole("button", { name: "Probar" }).click());
    expect(screen.queryByRole("status")).toBeNull();
  });
});
