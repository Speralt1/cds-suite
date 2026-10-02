import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";

const nav = vi.hoisted(() => ({ pathname: "/preview/configuracion/areas", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

import { AccessGate } from "@/components/suite-preview/access-gate";
import { PreviewLogin } from "@/components/suite-preview/login";
import { SuiteProvider, useSuite } from "@/components/suite-preview/provider";
import { AreasScreen } from "@/components/suite-preview/settings/areas-screen";
import { UsersScreen } from "@/components/suite-preview/settings/users-screen";
import { resolveInitialModule, visibleModules } from "@/lib/suite-preview/access";
import { AREA_COLORS, areaById, eventColor } from "@/lib/suite-preview/areas";
import type { SuiteState } from "@/lib/suite-preview/store";

function at(path: string) {
  const [pathname] = path.split("?");
  nav.pathname = pathname;
  window.history.replaceState(null, "", path);
}

beforeEach(() => {
  nav.replace.mockClear();
});

/** Captura el estado vivo del provider para afirmar sobre el store. */
const live: { state: SuiteState | null } = { state: null };
function Probe() {
  const { state } = useSuite();
  useEffect(() => {
    live.state = state;
  }, [state]);
  return null;
}

const mount = (ui: React.ReactNode) =>
  render(
    <SuiteProvider>
      {ui}
      <Probe />
    </SuiteProvider>,
  );

describe("Configuración › Áreas", () => {
  it("el editor ofrece solo los colores libres, con su nombre", () => {
    at("/preview/configuracion/areas?perfil=admin");
    mount(<AreasScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Nueva área" }));
    const group = screen.getByRole("radiogroup");
    const radios = within(group).getAllByRole("radio");
    // 9 áreas activas usan 9 colores: solo queda el de Matrimonios (inactiva).
    expect(radios).toHaveLength(1);
    expect(within(group).getByLabelText("Carmín")).toBeChecked();
    expect(screen.getByText("Carmín: libre (lo usaba Matrimonios, inactiva).")).toBeInTheDocument();
    expect(screen.getByText("Así se verá:")).toBeInTheDocument();
  });

  it("al editar, el color actual del área también aparece", () => {
    at("/preview/configuracion/areas?perfil=admin");
    mount(<AreasScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Editar Jóvenes" }));
    const radios = within(screen.getByRole("radiogroup")).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value).sort()).toEqual(["carmin", "naranjo"]);
    expect(radios.find((r) => r.value === "naranjo")).toBeChecked();
    expect(radios.every((r) => (AREA_COLORS as readonly string[]).includes(r.value))).toBe(true);
  });

  it("desactivar explica la consecuencia y las actividades conservan nombre y color", () => {
    at("/preview/configuracion/areas?perfil=admin");
    mount(<AreasScreen />);
    const before = live.state!.events.filter((e) => e.responsibleAreaId === "jovenes");
    expect(before.length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("switch", { name: "Jóvenes activa" })[0]);
    expect(screen.getByRole("heading", { name: "¿Desactivar Jóvenes?" })).toBeInTheDocument();
    expect(
      screen.getByText("No se podrá elegir para actividades nuevas; las existentes conservan nombre y color."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));
    const s = live.state!;
    expect(areaById(s.areas, "jovenes")?.active).toBe(false);
    for (const e of s.events.filter((x) => x.responsibleAreaId === "jovenes")) {
      expect(eventColor(e, s.areas).color).toBe("naranjo");
      expect(areaById(s.areas, e.responsibleAreaId)?.name).toBe("Jóvenes");
    }
    expect(screen.getByRole("status")).toHaveTextContent("Área «Jóvenes» desactivada. Simulación: no se guardó nada.");
  });
});

describe("Configuración › Usuarios y permisos", () => {
  it("permisos implicados marcados y deshabilitados; Administrar configuración bloqueado", () => {
    at("/preview/configuracion/usuarios?perfil=admin&id=lider");
    mount(<UsersScreen />);
    const read = screen.getByRole("checkbox", { name: /^Ver calendario/ });
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
    expect(screen.getByText("Incluido por «Gestionar actividades de sus áreas».")).toBeInTheDocument();
    const assigned = screen.getByRole("checkbox", { name: /^Gestionar actividades de sus áreas/ });
    expect(assigned).toBeChecked();
    expect(assigned).toBeEnabled();
    const settings = screen.getByRole("checkbox", { name: /^Administrar configuración/ });
    expect(settings).not.toBeChecked();
    expect(settings).toBeDisabled();
    expect(screen.getByText("Solo administradores (rol base).")).toBeInTheDocument();
    // Nunca se muestran ids técnicos de permisos.
    expect(document.body.textContent).not.toMatch(/calendar\.read|settings\.manage|finance\.summary/);
  });

  it("el módulo inicial solo ofrece módulos permitidos y muestra adónde entrará", () => {
    at("/preview/configuracion/usuarios?perfil=admin&id=lider");
    mount(<UsersScreen />);
    const select = screen.getByLabelText("Módulo inicial");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Finanzas", "Calendario"]);
    expect(screen.getByText(/Al ingresar abrirá:/).textContent).toMatch(/Calendario/);
  });

  it("advierte al Líder sin áreas asignadas", () => {
    at("/preview/configuracion/usuarios?perfil=admin&id=lider");
    mount(<UsersScreen />);
    expect(screen.queryByText("Sin áreas asignadas: solo podrá ver el calendario.")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Jóvenes/ }));
    expect(screen.getByText("Sin áreas asignadas: solo podrá ver el calendario.")).toBeInTheDocument();
  });

  it("muestra el fallback del Líder con módulo inicial no permitido (lista y editor)", () => {
    at("/preview/configuracion/usuarios?perfil=admin&id=lider-fallback");
    mount(<UsersScreen />);
    expect(screen.getAllByText("Módulo inicial no permitido · abrirá Calendario").length).toBeGreaterThan(0);
    expect(screen.getByText("El módulo inicial (Finanzas) ya no está permitido; se abrirá Calendario.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  });

  it("no permite quitarse a uno mismo el rol de administrador", () => {
    at("/preview/configuracion/usuarios?perfil=admin&id=admin");
    mount(<UsersScreen />);
    const admin = screen.getByRole("switch", { name: "Administrador (rol base)" });
    expect(admin).toHaveAttribute("aria-checked", "true");
    expect(admin).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(admin);
    expect(admin).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("No puedes quitarte el acceso de administrador.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Cuenta activa" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Tiene acceso completo.")).toBeInTheDocument();
  });

  it("cambiar de cargo propone el preset y no sobrescribe sin confirmar", () => {
    at("/preview/configuracion/usuarios?perfil=admin&id=lider");
    mount(<UsersScreen />);
    fireEvent.change(screen.getByLabelText("Cargo"), { target: { value: "Pastor" } });
    expect(screen.getByText("¿Aplicar los permisos sugeridos para Pastor?")).toBeInTheDocument();
    const details = () => screen.getByRole("checkbox", { name: /^Ver finanzas completas/ });
    expect(details()).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar permisos del cargo" }));
    expect(details()).toBeChecked();
    expect(screen.queryByText("¿Aplicar los permisos sugeridos para Pastor?")).toBeNull();
  });

  it("guardar cambia los módulos visibles y el aterrizaje del perfil en la sesión", () => {
    at("/preview/configuracion/usuarios?perfil=admin&id=lider");
    mount(<UsersScreen />);
    const lider = () => live.state!.users.find((u) => u.uid === "lider")!;
    expect(visibleModules(lider())).toEqual(["finanzas", "calendario", "reportes"]);
    fireEvent.click(screen.getByRole("checkbox", { name: /^Gestionar actividades de sus áreas/ }));
    // Calendario dejó de estar permitido: hay que elegir otro módulo inicial.
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Módulo inicial"), { target: { value: "finanzas" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(visibleModules(lider())).toEqual(["finanzas"]);
    const landing = resolveInitialModule(lider());
    expect(landing.kind === "module" && landing.href).toBe("/preview/finanzas-2026/resumen");
    expect(screen.getByRole("status")).toHaveTextContent("Cambios de Matías Contreras guardados. Simulación: no se guardó nada.");
  });
});

describe("ingreso /preview", () => {
  it("lista los 8 perfiles con 'Entra a …' calculado", () => {
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
    const enters = (name: RegExp) => within(rows.find((r) => name.test(r.textContent ?? ""))!).getByText(/^(Entra a|Sin módulos)/).textContent;
    expect(enters(/Carolina Vidal/)).toBe("Entra a Consolidación");
    expect(enters(/Matías Contreras/)).toBe("Entra a Calendario");
    expect(enters(/Marcela Soto/)).toBe("Entra a Finanzas");
    expect(enters(/Usuario sin permisos/)).toBe("Sin módulos asignados");
    expect(enters(/Líder con módulo inicial/)).toBe("Entra a Calendario*");
  });
});
