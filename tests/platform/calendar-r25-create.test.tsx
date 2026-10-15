// R2.5 · Calendario: "Nueva actividad" (barra, flotante móvil, desde un día) y
// guía cuando la iglesia aún no tiene áreas activas. No amplía permisos: sin
// áreas creables nunca se abre el formulario.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, UserAccessDoc } from "@/lib/shared/types";

const h = vi.hoisted(() => ({
  user: null as unknown,
  areas: [] as unknown[],
  online: true,
}));

const AREAS: Area[] = [
  { id: "jovenes", name: "Jóvenes", color: "azul", active: true },
  { id: "alabanza", name: "Alabanza", color: "verde", active: true },
];
const ONLY_INACTIVE: Area[] = [{ id: "varones", name: "Varones", color: "cafe", active: false }];

vi.mock("@/lib/access/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access/model")>();
  return { ...actual, useAccessModel: () => actual.accessModel(h.user as UserAccessDoc) };
});
vi.mock("@/lib/calendar/areas-client", () => ({ useAreas: () => ({ areas: h.areas, loading: false, error: "" }) }));
vi.mock("@/lib/calendar/events-client", () => ({
  useCalendarEvents: () => ({ events: [], loading: false, error: "" }),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  updateSeries: vi.fn(),
  cancelEvent: vi.fn(),
  cancelOccurrence: vi.fn(),
  cancelSeriesFrom: vi.fn(),
  archiveEvent: vi.fn(),
  setVisibility: vi.fn(),
}));
vi.mock("@/lib/browser/online", () => ({ useOnlineStatus: () => h.online }));
vi.mock("@/lib/calendar/use-now", () => ({ useSantiagoNow: () => ({ today: "2026-10-10", now: "2026-10-10T12:00" }) }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { uid: "u-1" } }) }));
vi.mock("@/components/layout/notice", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { CalendarScreen } from "@/components/calendar/calendar-screen";
import { canCreateEvents } from "@/lib/calendar/calendar";
import { accessModel } from "@/lib/access/model";

const ADMIN: UserAccessDoc = { role: "admin", active: true };
const PASTOR: UserAccessDoc = { role: "pastor", active: true };
const FINANCE: UserAccessDoc = { role: "finance", active: true };
const LEADER: UserAccessDoc = {
  accessSchemaVersion: 1,
  active: true,
  baseRole: "standard",
  role: "leader",
  permissions: ["finance.summary.read", "calendar.read", "calendar.events.manage_assigned"],
  areaIds: ["jovenes"],
};
const LEADER_OTHER: UserAccessDoc = { ...LEADER, areaIds: ["otra"] };

const GUIDE = "Antes de crear actividades";
const ADMIN_GUIDE = "Cada actividad necesita un área responsable. Configura las áreas de la iglesia para comenzar.";
const PASTOR_GUIDE = "Cada actividad necesita un área responsable. Pide a Administración que configure las áreas de la iglesia.";
const EMPTY_TITLE = "Aún no hay actividades programadas.";
const ADMIN_EMPTY = "Configura las áreas de la iglesia para comenzar a organizar el calendario.";
const PASTOR_EMPTY = "Cuando Administración configure las áreas de la iglesia, podrás crear actividades aquí.";
const READ_EMPTY = "Cuando se publiquen actividades, aparecerán aquí.";

function mockMedia(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: mobile ? query === "(max-width: 767px)" : query !== "(max-width: 767px)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

const toolbarCreate = () => screen.queryByRole("button", { name: "Nueva actividad" });
const openDay = (label: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label},`) }));
const dateInput = (dialog: HTMLElement) => within(dialog).getByLabelText(/^Fecha/) as HTMLInputElement;

beforeEach(() => {
  h.user = ADMIN;
  h.areas = [];
  h.online = true;
  window.history.replaceState(null, "", "/calendario");
});

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("R2.5 · sin áreas activas", () => {
  it("Administración: «Nueva actividad» visible y habilitado abre la guía con «Configurar áreas»", () => {
    render(<CalendarScreen />);
    const btn = toolbarCreate();
    expect(btn).not.toBeNull();
    expect(btn).not.toHaveAttribute("aria-disabled");
    btn?.focus();
    fireEvent.click(btn as HTMLElement);
    const dialog = screen.getByRole("dialog", { name: GUIDE });
    expect(screen.queryByRole("dialog", { name: "Nueva actividad" })).toBeNull();
    expect(dialog).toHaveTextContent(ADMIN_GUIDE);
    expect(within(dialog).getByRole("link", { name: "Configurar áreas" })).toHaveAttribute("href", "/configuracion/areas");
    expect(within(dialog).getByRole("heading", { name: GUIDE })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: GUIDE })).toBeNull();
    expect(btn).toHaveFocus();
  });

  it("la guía se cierra con Esc y el foco vuelve a quien la abrió", () => {
    render(<CalendarScreen />);
    const btn = toolbarCreate() as HTMLElement;
    btn.focus();
    fireEvent.click(btn);
    fireEvent(screen.getByRole("dialog", { name: GUIDE }), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog", { name: GUIDE })).toBeNull();
    expect(btn).toHaveFocus();
  });

  it("Administración: estado vacío con su texto y enlace a Configurar áreas (también con solo áreas inactivas)", () => {
    h.areas = ONLY_INACTIVE;
    render(<CalendarScreen />);
    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(ADMIN_EMPTY)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configurar áreas" })).toHaveAttribute("href", "/configuracion/areas");
    expect(screen.queryByText(/No hay actividades en/)).toBeNull();
  });

  it("Pastor: guía «Pide a Administración…» con «Entendido» y sin «Configurar áreas»", () => {
    h.user = PASTOR;
    render(<CalendarScreen />);
    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(PASTOR_EMPTY)).toBeInTheDocument();
    fireEvent.click(toolbarCreate() as HTMLElement);
    const dialog = screen.getByRole("dialog", { name: GUIDE });
    expect(dialog).toHaveTextContent(PASTOR_GUIDE);
    expect(screen.queryByRole("link", { name: "Configurar áreas" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Entendido" }));
    expect(screen.queryByRole("dialog", { name: GUIDE })).toBeNull();
  });

  it("solo lectura (Finanzas legacy) y líder sin áreas: sin acciones de crear ni botón flotante", () => {
    for (const user of [FINANCE, LEADER]) {
      h.user = user;
      mockMedia(false);
      const { unmount } = render(<CalendarScreen />);
      expect(toolbarCreate()).toBeNull();
      expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
      expect(screen.getByText(READ_EMPTY)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Configurar áreas" })).toBeNull();
      openDay("sábado 24 de octubre");
      expect(screen.queryByRole("button", { name: /Nueva actividad el/ })).toBeNull();
      unmount();
      mockMedia(true);
      const m = render(<CalendarScreen />);
      expect(document.querySelector(".cal-fab")).toBeNull();
      expect(screen.queryByRole("button", { name: /Nueva actividad/ })).toBeNull();
      m.unmount();
    }
  });

  it("?crear=1 abre la guía para Administración y Pastor (no se ignora)", () => {
    for (const user of [ADMIN, PASTOR]) {
      h.user = user;
      window.history.replaceState(null, "", "/calendario?crear=1");
      const { unmount } = render(<CalendarScreen />);
      const dialog = screen.getByRole("dialog", { name: GUIDE });
      expect(screen.queryByRole("dialog", { name: "Nueva actividad" })).toBeNull();
      fireEvent.click(within(dialog).getByRole("button", { name: user === ADMIN ? "Cancelar" : "Entendido" }));
      expect(screen.queryByRole("dialog", { name: GUIDE })).toBeNull();
      expect(window.location.search).not.toContain("crear");
      unmount();
    }
  });

  it("?crear=1 para solo lectura no abre nada", () => {
    h.user = FINANCE;
    window.history.replaceState(null, "", "/calendario?crear=1");
    render(<CalendarScreen />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.search).not.toContain("crear");
  });

  it("«Nueva actividad este día» lleva a la guía, nunca al formulario", () => {
    render(<CalendarScreen />);
    openDay("sábado 24 de octubre");
    fireEvent.click(screen.getByRole("button", { name: "Nueva actividad el sábado 24 de octubre" }));
    expect(screen.getByRole("dialog", { name: GUIDE })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Nueva actividad" })).toBeNull();
  });

  it("sin conexión el botón queda aria-disabled con la razón y no abre la guía", () => {
    h.online = false;
    render(<CalendarScreen />);
    const btn = toolbarCreate() as HTMLElement;
    expect(btn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(btn);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("no amplía permisos: sin áreas activas nadie tiene áreas creables", () => {
    for (const user of [ADMIN, PASTOR, LEADER]) {
      expect(canCreateEvents(accessModel(user), [])).toBe(false);
      expect(canCreateEvents(accessModel(user), ONLY_INACTIVE)).toBe(false);
    }
  });
});

describe("R2.5 · con áreas", () => {
  beforeEach(() => {
    h.areas = AREAS;
  });

  it("Administración: «Nueva actividad» abre el formulario; estado vacío conserva su botón renombrado", () => {
    render(<CalendarScreen />);
    expect(screen.getByText("No hay actividades en octubre")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    const buttons = screen.getAllByRole("button", { name: "Nueva actividad" });
    expect(buttons).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Crear actividad" })).toBeNull();
    fireEvent.click(buttons[0]);
    const dialog = screen.getByRole("dialog", { name: "Nueva actividad" });
    expect(dateInput(dialog).value).toBe("2026-10-10");
    expect(screen.queryByRole("dialog", { name: GUIDE })).toBeNull();
  });

  it("«Nueva actividad este día» abre el formulario con esa fecha (también días pasados)", () => {
    render(<CalendarScreen />);
    openDay("sábado 3 de octubre");
    const day = screen.getByRole("dialog", { name: "sábado 3 de octubre" });
    const btn = within(day).getByRole("button", { name: "Nueva actividad el sábado 3 de octubre" });
    expect(btn).toHaveTextContent("Nueva actividad este día");
    expect(btn).toHaveClass("button-secondary");
    fireEvent.click(btn);
    expect(screen.queryByRole("dialog", { name: "sábado 3 de octubre" })).toBeNull();
    const form = screen.getByRole("dialog", { name: "Nueva actividad" });
    expect(dateInput(form).value).toBe("2026-10-03");
  });

  it("el líder con áreas también crea desde un día; la fecha queda editable", () => {
    h.user = LEADER;
    render(<CalendarScreen />);
    openDay("sábado 24 de octubre");
    fireEvent.click(screen.getByRole("button", { name: "Nueva actividad el sábado 24 de octubre" }));
    const input = dateInput(screen.getByRole("dialog", { name: "Nueva actividad" }));
    expect(input.value).toBe("2026-10-24");
    fireEvent.change(input, { target: { value: "2026-10-25" } });
    expect(input.value).toBe("2026-10-25");
  });

  it("móvil (<768): botón flotante «Nueva» y sin botón de la barra", () => {
    mockMedia(true);
    render(<CalendarScreen />);
    const fab = document.querySelector<HTMLButtonElement>(".cal-fab");
    expect(fab).toHaveAccessibleName("Nueva actividad");
    expect(fab?.textContent?.trim()).toBe("Nueva");
    expect(document.querySelector(".cal-create")).toBeNull();
    // Solo el flotante y el del estado vacío; nada en la barra superior.
    expect(screen.getByRole("toolbar").querySelector("button.button-primary")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Nueva actividad" })).toHaveLength(2);
  });

  it("móvil, vista Mes: «Nueva actividad este día» bajo el encabezado del día abre el formulario con esa fecha", () => {
    mockMedia(true);
    window.history.replaceState(null, "", "/calendario?vista=mes");
    render(<CalendarScreen />);
    fireEvent.click(screen.getByRole("button", { name: /^miércoles 14 de octubre,/ }));
    const section = document.querySelector<HTMLElement>("section.cal-day-list") as HTMLElement;
    const btn = within(section).getByRole("button", { name: "Nueva actividad el miércoles 14 de octubre" });
    expect(btn).toHaveClass("is-block");
    expect(section.querySelector("h3")?.compareDocumentPosition(btn)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    fireEvent.click(btn);
    expect(dateInput(screen.getByRole("dialog", { name: "Nueva actividad" })).value).toBe("2026-10-14");
  });

  it("quien no puede crear nunca ve acciones de crear (escritorio, día y móvil)", () => {
    for (const user of [FINANCE, LEADER_OTHER]) {
      h.user = user;
      mockMedia(false);
      const { unmount } = render(<CalendarScreen />);
      expect(screen.queryByRole("button", { name: /Nueva actividad/ })).toBeNull();
      openDay("sábado 24 de octubre");
      expect(screen.queryByRole("button", { name: /Nueva actividad/ })).toBeNull();
      expect(screen.queryByRole("dialog", { name: GUIDE })).toBeNull();
      unmount();
      mockMedia(true);
      window.history.replaceState(null, "", "/calendario?vista=mes");
      const m = render(<CalendarScreen />);
      expect(document.querySelector(".cal-fab")).toBeNull();
      expect(screen.queryByRole("button", { name: /Nueva actividad/ })).toBeNull();
      m.unmount();
      window.history.replaceState(null, "", "/calendario");
    }
  });
});
