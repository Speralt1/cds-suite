import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area } from "@/lib/shared/types";
import type { ManagedUser } from "@/lib/settings/users";

const state = vi.hoisted(() => ({
  areas: { areas: [] as Area[], loading: false, error: "" },
  users: { data: [] as unknown[], loading: false, error: "" },
}));

const areasClient = vi.hoisted(() => ({
  createArea: vi.fn(async () => "nueva"),
  updateArea: vi.fn(async () => undefined),
  setAreaActive: vi.fn(async () => undefined),
}));

const usersClient = vi.hoisted(() => ({
  createManagedUser: vi.fn(async () => ({ uid: "new-uid", resetEmailSent: true, resetEmailError: "" })),
  resendPasswordSetup: vi.fn(async () => undefined),
  setManagedUserActive: vi.fn(async () => undefined),
  updateManagedUserAccess: vi.fn(async () => undefined),
}));

vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: { kind: "db" }, auth: { kind: "auth" } }) }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { uid: "me" } }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/configuracion/areas" }));
vi.mock("@/lib/calendar/areas-client", () => ({
  useAreas: () => state.areas,
  AreaValidationError: class AreaValidationError extends Error {
    errors = {};
  },
  ...areasClient,
}));
vi.mock("@/lib/settings/users-client", () => ({
  useManagedUsers: () => state.users,
  ...usersClient,
}));

import { AreasPanel } from "@/components/settings/areas-panel";
import { SettingsNav } from "@/components/settings/settings-nav";
import { UsersPermissionsPanel } from "@/components/settings/users-permissions-panel";
import { SettingsSectionProvider } from "@/components/settings/settings-ui";

beforeAll(() => {
  // jsdom no implementa <dialog>.showModal().
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

const area = (id: string, name: string, color: Area["color"], active = true): Area => ({
  id,
  name,
  color,
  active,
  slug: id,
  description: "",
});

const user = (id: string, extra: Record<string, unknown>): ManagedUser =>
  ({ id, displayName: `Nombre ${id}`, email: `${id}@cds.cl`, active: true, createdAt: "C", ...extra }) as unknown as ManagedUser;

beforeEach(() => {
  state.areas = {
    areas: [area("alabanza", "Alabanza", "verde"), area("jovenes", "Jóvenes", "azul"), area("matrimonios", "Matrimonios", "carmin", false)],
    loading: false,
    error: "",
  };
  state.users = {
    data: [
      user("me", { role: "admin" }),
      user("leader", { role: "leader", displayName: "Luis Líder" }),
      user("cal", {
        role: "leader",
        displayName: "Carla Calendario",
        accessSchemaVersion: 1,
        baseRole: "standard",
        position: "Coordinación",
        permissions: ["calendar.read"],
        areaIds: [],
        homeModule: "finance",
      }),
    ],
    loading: false,
    error: "",
  };
  Object.values(areasClient).forEach((fn) => fn.mockClear());
  Object.values(usersClient).forEach((fn) => fn.mockClear());
});

function openDialog(name: RegExp | string) {
  return screen.getByRole("dialog", { name });
}

describe("Configuración › Áreas", () => {
  it("lista áreas con estado y abre el editor con SOLO los colores libres", () => {
    render(<AreasPanel />);
    expect(screen.getByRole("heading", { level: 1, name: "Áreas" })).toBeVisible();
    expect(screen.getByText("2 activas · 1 inactiva")).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: /Nueva área/ })[0]);
    const dialog = openDialog("Nueva área");
    const radios = within(dialog).getAllByRole("radio");
    const labels = radios.map((r) => r.closest("label")?.textContent);
    expect(radios).toHaveLength(8);
    expect(labels).not.toContain("Azul");
    expect(labels).not.toContain("Verde");
    expect(labels).toContain("Carmín");
    expect(within(dialog).getByText("Los demás colores están en uso por otras áreas activas.")).toBeVisible();
    expect(within(dialog).getByText("Carmín: libre (lo usaba Matrimonios, inactiva).")).toBeVisible();
    expect(within(dialog).getByText("Así se verá:")).toBeVisible();
  });

  it("valida nombre repetido entre activas y crea con el color elegido", async () => {
    render(<AreasPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: /Nueva área/ })[0]);
    const dialog = openDialog("Nueva área");
    const name = within(dialog).getByLabelText("Nombre");
    fireEvent.change(name, { target: { value: "jóvenes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear área" }));
    expect(await within(dialog).findByText("Ya existe un área con ese nombre.")).toBeVisible();
    expect(areasClient.createArea).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: "Niños" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Ámbar" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear área" }));
    await waitFor(() => expect(areasClient.createArea).toHaveBeenCalledTimes(1));
    expect(areasClient.createArea).toHaveBeenCalledWith(
      { kind: "db" },
      "me",
      { name: "Niños", description: "", color: "ambar" },
      state.areas.areas,
    );
    expect(await screen.findByText("Área «Niños» creada.")).toBeVisible();
  });

  it("sin colores libres explica y deshabilita Guardar", () => {
    const colors = ["azul", "indigo", "naranjo", "ambar", "frambuesa", "cafe", "teal", "pizarra", "verde", "carmin"] as const;
    state.areas = { areas: colors.map((c, i) => area(`a${i}`, `Área ${i}`, c)), loading: false, error: "" };
    render(<AreasPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: /Nueva área/ })[0]);
    const dialog = openDialog("Nueva área");
    expect(within(dialog).queryAllByRole("radio")).toHaveLength(0);
    expect(within(dialog).getByText("Todos los colores están en uso. Desactiva un área para liberar el suyo.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Crear área" })).toBeDisabled();
  });

  it("desactivar pide confirmación con la consecuencia y uso real", async () => {
    render(<AreasPanel usage={new Map([["jovenes", { responsible: 3, participant: 1 }]])} />);
    expect(screen.getAllByText("3 actividades · participa en 1").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("switch", { name: "Jóvenes: área activa" })[0]);
    const dialog = openDialog("¿Desactivar Jóvenes?");
    expect(
      within(dialog).getByText(
        "No se podrá elegir en actividades nuevas. Sus 3 actividades conservan su nombre y color. Los líderes de esta área ya no podrán editarlas.",
      ),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Desactivar" }));
    await waitFor(() => expect(areasClient.setAreaActive).toHaveBeenCalledTimes(1));
    expect(areasClient.setAreaActive).toHaveBeenCalledWith(
      { kind: "db" },
      "me",
      state.areas.areas[1],
      false,
      state.areas.areas,
    );
  });

  it("activar un área cuyo color está libre lo hace directo", async () => {
    render(<AreasPanel />);
    fireEvent.click(screen.getAllByRole("switch", { name: "Matrimonios: área activa" })[0]);
    await waitFor(() => expect(areasClient.setAreaActive).toHaveBeenCalledWith({ kind: "db" }, "me", state.areas.areas[2], true, state.areas.areas));
  });

  it("estados vacío y error con datos reales", () => {
    state.areas = { areas: [], loading: false, error: "" };
    const { unmount } = render(<AreasPanel />);
    expect(screen.getByText("Aún no hay áreas")).toBeVisible();
    expect(screen.getByText("Crea la primera para organizar el calendario.")).toBeVisible();
    unmount();
    state.areas = { areas: [], loading: false, error: "No pudimos cargar las áreas. Revisa tu conexión e inténtalo de nuevo." };
    render(<AreasPanel />);
    expect(screen.getByText("No pudimos cargar las áreas.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeVisible();
  });
});

describe("Configuración › Usuarios y permisos", () => {
  it("lista compacta de solo lectura con avisos visibles", () => {
    render(<UsersPermissionsPanel />);
    expect(screen.getByRole("heading", { level: 1, name: "Usuarios y permisos" })).toBeVisible();
    expect(screen.getByText("3 usuarios · 2 con avisos")).toBeVisible();
    expect(screen.getAllByText("Sin áreas asignadas").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Módulo inicial no permitido").length).toBeGreaterThan(0);
    expect(screen.getByText("Cuentas de acceso")).toBeVisible();
    // Solo lectura: no hay campos editables en la lista.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("editor: implicados marcados y deshabilitados, configuración bloqueada, áreas activas", () => {
    render(<UsersPermissionsPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar Luis Líder" })[0]);
    const dialog = openDialog("Luis Líder");
    const read = within(dialog).getByRole("checkbox", { name: /Ver calendario/ });
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
    expect(within(dialog).getByText("Incluido por «Gestionar actividades de sus áreas».")).toBeVisible();
    const summary = within(dialog).getByRole("checkbox", { name: /Ver resumen financiero/ });
    expect(summary).toBeChecked();
    expect(summary).toBeEnabled();
    const settings = within(dialog).getByRole("checkbox", { name: /Administrar configuración/ });
    expect(settings).toBeDisabled();
    expect(settings).not.toBeChecked();
    expect(within(dialog).getByText("Solo administradores (rol base).")).toBeVisible();
    expect(
      within(dialog).getByText(
        "Gestiona actividades de sus áreas, pero no tiene áreas asignadas. No podrá crear actividades hasta que le asignes una.",
      ),
    ).toBeVisible();
    // Áreas: solo activas (Matrimonios está inactiva).
    expect(within(dialog).getByRole("checkbox", { name: /Jóvenes/ })).toBeVisible();
    expect(within(dialog).queryByRole("checkbox", { name: /Matrimonios/ })).toBeNull();
    expect(within(dialog).getByText(/formato anterior de permisos/)).toBeVisible();
    // Crear/reenviar/quitar siguen disponibles.
    expect(within(dialog).getByRole("button", { name: /Reenviar acceso/ })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /Quitar acceso/ })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  });

  it("módulo inicial limitado a lo permitido, con aviso y aterrizaje en vivo", () => {
    render(<UsersPermissionsPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar Carla Calendario" })[0]);
    const dialog = openDialog("Carla Calendario");
    const home = within(dialog).getByLabelText("Módulo inicial");
    const options = within(home).getAllByRole("option").filter((o) => !(o as HTMLOptionElement).disabled);
    expect(options.map((o) => o.textContent)).toEqual(["Calendario"]);
    expect(
      within(dialog).getByText("El módulo inicial (Finanzas) ya no está permitido; al ingresar se abrirá Calendario."),
    ).toBeVisible();
    expect(within(home.parentElement as HTMLElement).getByText(/Al ingresar abrirá/)).toHaveTextContent(
      "Al ingresar abrirá: Calendario",
    );
    // Al dar finanzas, el módulo inicial ofrece ambos.
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Ver resumen financiero/ }));
    expect(within(home).getAllByRole("option").map((o) => o.textContent)).toEqual(["Finanzas", "Calendario"]);
  });

  it("cargo propone permisos solo con confirmación explícita y guarda el payload", async () => {
    render(<UsersPermissionsPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar Luis Líder" })[0]);
    const dialog = openDialog("Luis Líder");
    fireEvent.change(within(dialog).getByLabelText("Cargo"), { target: { value: "Pastor" } });
    const group = within(dialog).getByRole("group", { name: "Permisos sugeridos para Pastor" });
    // Nada cambia todavía.
    expect(within(dialog).getByRole("checkbox", { name: /Seguimiento pastoral/ })).not.toBeChecked();
    fireEvent.click(within(group).getByRole("button", { name: "Aplicar sugeridos" }));
    expect(within(dialog).getByRole("checkbox", { name: /Seguimiento pastoral/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(usersClient.updateManagedUserAccess).toHaveBeenCalledTimes(1));
    expect(usersClient.updateManagedUserAccess).toHaveBeenCalledWith(
      { kind: "db" },
      "me",
      "leader",
      expect.objectContaining({
        position: "Pastor",
        baseRole: "standard",
        homeModule: "finance",
        permissions: expect.arrayContaining(["finance.pastoral.manage", "calendar.events.manage_all"]),
      }),
      state.users.data,
    );
  });

  it("«Otro cargo…» nunca escribe el valor interno de la opción en el cargo", async () => {
    render(<UsersPermissionsPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar Luis Líder" })[0]);
    const dialog = openDialog("Luis Líder");
    fireEvent.change(within(dialog).getByLabelText("Cargo"), { target: { value: "__otro" } });
    // Ni propuesta de permisos ni el valor interno en el campo de texto.
    expect(within(dialog).queryByRole("group", { name: /Permisos sugeridos/ })).toBeNull();
    const name = within(dialog).getByRole("textbox", { name: "Nombre del cargo" });
    expect(name).toHaveValue("");
    fireEvent.change(name, { target: { value: "Coordinación de jóvenes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(usersClient.updateManagedUserAccess).toHaveBeenCalledTimes(1));
    const payload = (usersClient.updateManagedUserAccess.mock.calls[0] as unknown[])[3] as { position: string };
    expect(payload.position).toBe("Coordinación de jóvenes");
    expect(JSON.stringify(usersClient.updateManagedUserAccess.mock.calls)).not.toContain("__otro");
  });

  it("«Otro cargo…» sin nombre guarda el cargo vacío, nunca el valor interno", async () => {
    render(<UsersPermissionsPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar Luis Líder" })[0]);
    const dialog = openDialog("Luis Líder");
    fireEvent.change(within(dialog).getByLabelText("Cargo"), { target: { value: "__otro" } });
    expect(within(dialog).getByRole("textbox", { name: "Nombre del cargo" })).toHaveValue("");
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(usersClient.updateManagedUserAccess).toHaveBeenCalledTimes(1));
    const payload = (usersClient.updateManagedUserAccess.mock.calls[0] as unknown[])[3] as { position: string };
    expect(payload.position).toBe("");
    expect(JSON.stringify(usersClient.updateManagedUserAccess.mock.calls)).not.toContain("__otro");
  });

  it("mantener los actuales no cambia permisos", () => {
    render(<UsersPermissionsPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar Luis Líder" })[0]);
    const dialog = openDialog("Luis Líder");
    fireEvent.change(within(dialog).getByLabelText("Cargo"), { target: { value: "Finanzas" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mantener los actuales" }));
    expect(within(dialog).getByRole("checkbox", { name: /Registrar y editar movimientos/ })).not.toBeChecked();
    expect(within(dialog).queryByRole("group", { name: /Permisos sugeridos/ })).toBeNull();
  });

  it("cuenta propia: rol base y cuenta activa bloqueados; sin reenviar ni quitar", () => {
    render(<UsersPermissionsPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar Nombre me" })[0]);
    const dialog = openDialog("Nombre me");
    expect(within(dialog).getByRole("switch", { name: "Administrador (rol base)" })).toBeDisabled();
    expect(within(dialog).getByRole("switch", { name: "Cuenta activa" })).toBeDisabled();
    expect(within(dialog).getByText("Administración tiene todos los permisos, incluida la configuración.")).toBeVisible();
    expect(within(dialog).getByRole("checkbox", { name: /Administrar configuración/ })).toBeChecked();
    expect(within(dialog).getByText(/no puedes quitarte el rol administrador ni desactivar tu propia cuenta/)).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: /Reenviar acceso/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Quitar acceso/ })).toBeNull();
  });

  it("reenviar acceso y quitar acceso (con diálogo, sin window.confirm)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<UsersPermissionsPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar Luis Líder" })[0]);
    const dialog = openDialog("Luis Líder");
    fireEvent.click(within(dialog).getByRole("button", { name: /Reenviar acceso/ }));
    await waitFor(() => expect(usersClient.resendPasswordSetup).toHaveBeenCalledWith({ kind: "auth" }, "leader@cds.cl"));
    expect(await within(dialog).findByText("Correo para definir/restablecer contraseña enviado.")).toBeVisible();

    fireEvent.click(within(dialog).getByRole("button", { name: /Quitar acceso/ }));
    const confirm = openDialog("¿Quitar el acceso de Luis Líder?");
    expect(
      within(confirm).getByText(
        "Ya no podrá entrar a CDS Suite, pero se conservará su historial. Puedes devolverle el acceso después.",
      ),
    ).toBeVisible();
    fireEvent.click(within(confirm).getByRole("button", { name: /Quitar acceso/ }));
    await waitFor(() => expect(usersClient.setManagedUserActive).toHaveBeenCalledTimes(1));
    expect(usersClient.setManagedUserActive).toHaveBeenCalledWith(
      { kind: "db" },
      "me",
      state.users.data[1],
      false,
      state.users.data,
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByText("Acceso eliminado correctamente.")).toBeVisible();
  });

  it("crear usuario conserva «Acceso seguro» y escribe cargo, permisos y áreas", async () => {
    render(<UsersPermissionsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Agregar usuario/ }));
    const dialog = openDialog("Agregar usuario");
    expect(within(dialog).getByText("Acceso seguro")).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Ana" } });
    fireEvent.change(within(dialog).getByLabelText("Correo electrónico"), { target: { value: "ana@cds.cl" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Jóvenes/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear usuario" }));
    await waitFor(() => expect(usersClient.createManagedUser).toHaveBeenCalledTimes(1));
    expect(usersClient.createManagedUser).toHaveBeenCalledWith(
      { kind: "db" },
      { kind: "auth" },
      {
        displayName: "Ana",
        email: "ana@cds.cl",
        role: "leader",
        access: {
          baseRole: "standard",
          position: "Líder",
          permissions: ["finance.summary.read", "calendar.read", "calendar.events.manage_assigned"],
          areaIds: ["jovenes"],
          homeModule: "calendar",
        },
      },
    );
    expect(await screen.findByText(/Usuario creado correctamente/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Revisar permisos" })).toBeVisible();
  });
});

describe("Configuración › subnav", () => {
  it("muestra Áreas, Usuarios y permisos, Finanzas e integraciones y General (en ese orden)", () => {
    render(<SettingsNav />);
    const nav = screen.getByRole("navigation", { name: "Secciones de Configuración" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Áreas", "/configuracion/areas"],
      ["Usuarios y permisos", "/configuracion/usuarios"],
      ["Finanzas e integraciones", "/configuracion/finanzas"],
      ["General", "/configuracion"],
    ]);
    expect(within(nav).getByRole("link", { name: "Áreas" })).toHaveAttribute("aria-current", "page");
    expect(links.filter((l) => l.getAttribute("aria-current") === "page")).toHaveLength(1);
  });
});

describe("Configuración · ciclo 1 (C2–C4)", () => {
  it("dentro del módulo, cada sección se titula con h2 (el h1 es «Configuración» del layout)", () => {
    const { unmount } = render(
      <SettingsSectionProvider>
        <AreasPanel />
      </SettingsSectionProvider>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Áreas" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    unmount();
    render(
      <SettingsSectionProvider>
        <UsersPermissionsPanel />
      </SettingsSectionProvider>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Usuarios y permisos" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Agregar usuario/ })).toBeVisible();
  });

  it("estados inactivos con ícono «prohibido»; el check solo para activo", () => {
    const { container, unmount } = render(<AreasPanel />);
    const inactive = within(container.querySelector("table") as HTMLElement).getByText("Inactiva");
    expect(inactive.querySelector("svg.lucide-ban")).not.toBeNull();
    expect(inactive.querySelector("svg.lucide-circle-check")).toBeNull();
    const active = within(container.querySelector("table") as HTMLElement).getAllByText("Activa")[0];
    expect(active.querySelector("svg.lucide-circle-check")).not.toBeNull();
    expect(active.querySelector("svg.lucide-ban")).toBeNull();
    unmount();
    state.users = {
      ...state.users,
      data: [...state.users.data, user("off", { role: "finance", active: false, displayName: "Olga Off" })],
    };
    render(<UsersPermissionsPanel />);
    const off = screen.getAllByText("Sin acceso");
    expect(off.length).toBeGreaterThan(0);
    for (const el of off) {
      expect(el.querySelector("svg.lucide-ban")).not.toBeNull();
      expect(el.querySelector("svg.lucide-circle-check")).toBeNull();
    }
  });

  it("el editor de usuario usa la variante ancha del Modal productivo", () => {
    render(<UsersPermissionsPanel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar Luis Líder" })[0]);
    const dialog = openDialog("Luis Líder");
    expect(dialog.className).toContain("finance-modal");
    expect(dialog.className).toContain("720px");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: /Agregar usuario/ }));
    expect(openDialog("Agregar usuario").className).toBe("finance-modal");
  });
});
