// Ciclo 1 de correcciones UX/seguridad del Calendario, Reportes y Compartir
// (B1–B8). Casos nuevos: no modifica tests existentes.
import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, CalendarEvent, UserAccessDoc } from "@/lib/shared/types";

const h = vi.hoisted(() => ({
  user: null as unknown,
  events: [] as unknown[],
  toast: vi.fn(),
  manageShareLink: vi.fn(),
  replace: vi.fn(),
  showAccessNotice: vi.fn(),
  pathname: "/calendario",
}));

const AREAS: Area[] = [
  { id: "jovenes", name: "Jóvenes", color: "azul", active: true },
  { id: "alabanza", name: "Alabanza", color: "verde", active: true },
];

vi.mock("@/lib/access/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access/model")>();
  return { ...actual, useAccessModel: () => actual.accessModel(h.user as UserAccessDoc) };
});
vi.mock("@/lib/calendar/areas-client", () => ({ useAreas: () => ({ areas: AREAS, loading: false, error: "" }) }));
vi.mock("@/lib/calendar/events-client", () => ({
  useCalendarEvents: () => ({ events: h.events, loading: false, error: "" }),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  updateSeries: vi.fn(),
  cancelEvent: vi.fn(),
  cancelOccurrence: vi.fn(),
  cancelSeriesFrom: vi.fn(),
  archiveEvent: vi.fn(),
  setVisibility: vi.fn(),
}));
vi.mock("@/lib/calendar/share-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendar/share-client")>();
  return { ...actual, manageShareLink: h.manageShareLink };
});
vi.mock("@/lib/calendar/use-now", () => ({ useSantiagoNow: () => ({ today: "2026-10-10", now: "2026-10-10T12:00" }) }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { uid: "u-lider" } }) }));
vi.mock("@/components/layout/notice", () => ({
  useToast: () => ({ toast: h.toast }),
  useAccessNoticeControl: () => ({ showAccessNotice: h.showAccessNotice, dismissAccessNotice: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
  usePathname: () => h.pathname,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import CalendarLayout from "@/app/(private)/calendario/layout";
import { CalendarScreen } from "@/components/calendar/calendar-screen";
import { MY_ACTIVITIES_REDIRECT_NOTICE, MyActivitiesGate } from "@/components/calendar/my-activities-gate";
import { activeStatusText, disabledStatusText, ShareAdminScreen } from "@/components/calendar/share-admin";
import { accessModel } from "@/lib/access/model";
import {
  actorFromUserDoc,
  myActivitiesRoute,
  PAST_START_EDIT_ERROR,
  showsMyActivities,
  validateEvent,
  type EventInput,
} from "@/lib/calendar/calendar";
import { shareActorName } from "@/lib/calendar/share-client";

const { VisibilityMark } = await import("@/components/reports/calendar-report");

const LEADER: UserAccessDoc = {
  accessSchemaVersion: 1,
  active: true,
  baseRole: "standard",
  role: "leader",
  permissions: ["finance.summary.read", "calendar.read", "calendar.events.manage_assigned"],
  areaIds: ["jovenes"],
};
const LEADER_NO_AREAS: UserAccessDoc = { ...LEADER, areaIds: [] };
const READER: UserAccessDoc = { ...LEADER, permissions: ["finance.summary.read", "calendar.read"], areaIds: [] };
const READER_WITH_AREAS: UserAccessDoc = { ...READER, areaIds: ["alabanza"] };
const ADMIN: UserAccessDoc = { role: "admin", active: true };

function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "e1",
    title: "Reunión de jóvenes",
    responsibleAreaId: "jovenes",
    participantAreaIds: [],
    startDate: "2026-10-20",
    endDate: "2026-10-20",
    allDay: false,
    startTime: "19:00",
    endTime: "21:00",
    location: "Templo",
    publicDescription: "",
    internalNotes: "",
    visibility: "internal",
    status: "scheduled",
    recurrence: { freq: "none" },
    exceptions: [],
    lastDate: "2026-10-20",
    revision: 1,
    lastChangeId: "r1",
    createdBy: "u-lider",
    createdAt: null,
    updatedBy: "u-lider",
    updatedAt: null,
    ...over,
  };
}

function input(e: CalendarEvent, over: Partial<EventInput> = {}): EventInput {
  return {
    title: e.title,
    responsibleAreaId: e.responsibleAreaId,
    participantAreaIds: [...e.participantAreaIds],
    startDate: e.startDate,
    endDate: e.endDate,
    allDay: e.allDay,
    startTime: e.startTime,
    endTime: e.endTime,
    location: e.location,
    publicDescription: e.publicDescription,
    internalNotes: e.internalNotes,
    visibility: e.visibility,
    recurrence: e.recurrence,
    ...over,
  };
}

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

const css = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
/** Cuerpo de la primera regla cuyo selector es exactamente `selector`. */
function rule(source: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

beforeEach(() => {
  h.user = LEADER;
  h.events = [];
  h.toast.mockReset();
  h.manageShareLink.mockReset();
  h.replace.mockReset();
  h.showAccessNotice.mockReset();
  h.pathname = "/calendario";
  window.history.replaceState(null, "", "/calendario");
});

afterEach(() => {
  // jsdom no trae matchMedia: se elimina para no afectar a otros casos.
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("B1 · Reporte: Fecha y Hora no se pegan", () => {
  const src = css("components/reports/reports.css");
  it("Fecha y Hora sin salto de línea, con ancho y aire suficientes; Actividad absorbe el resto", () => {
    const date = rule(src, ".cal-rep-table .c-date");
    const time = rule(src, ".cal-rep-table .c-time");
    expect(date).toMatch(/white-space:\s*nowrap/);
    expect(time).toMatch(/white-space:\s*nowrap/);
    expect(Number(date.match(/width:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(144);
    expect(date).toMatch(/padding-right:\s*16px/);
    expect(Number(time.match(/width:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(104);
    expect(rule(src, ".cal-rep-table .c-title")).not.toMatch(/width/);
  });

  it("los cortes por ancho dejan a Actividad con al menos 160 px", () => {
    const width = (sel: string) => Number(rule(src, `.cal-rep-table .${sel}`).match(/width:\s*(\d+)px/)?.[1] ?? 0);
    const fixed = width("c-date") + width("c-time") + width("c-resp") + width("c-status");
    const bp = (col: string) => {
      const re = new RegExp(`@container \\(max-width: (\\d+)px\\) \\{\\s*\\.cal-rep-table \\.${col} \\{\\s*display: none;`);
      return Number(src.match(re)?.[1]);
    };
    const tableBp = Number(src.match(/@container \(max-width: (\d+)px\) \{\s*\.cal-rep-table \{\s*display: none;/)?.[1]);
    // Justo sobre cada corte, con las columnas aún visibles.
    expect(bp("c-part") + 1 - (fixed + width("c-loc") + width("c-desc") + width("c-part"))).toBeGreaterThanOrEqual(160);
    expect(bp("c-part") - (fixed + width("c-loc") + width("c-desc"))).toBeGreaterThanOrEqual(160);
    expect(bp("c-desc") - (fixed + width("c-loc"))).toBeGreaterThanOrEqual(160);
    expect(bp("c-loc") - fixed).toBeGreaterThanOrEqual(160);
    expect(tableBp - fixed).toBeGreaterThanOrEqual(160);
  });
});

describe("B2 · «+ Crear» flotante en móvil", () => {
  it("en móvil, quien puede crear ve «Crear» (nombre accesible «Crear actividad») y abre el formulario", () => {
    mockMedia(true);
    render(<CalendarScreen />);
    const fab = document.querySelector<HTMLButtonElement>(".cal-fab");
    expect(fab).not.toBeNull();
    expect(fab).toHaveAccessibleName("Crear actividad");
    expect(fab?.textContent?.trim()).toBe("Crear");
    expect(fab?.closest(".cal-screen")).toHaveClass("has-fab");
    fireEvent.click(fab as HTMLButtonElement);
    expect(screen.getByRole("dialog", { name: "Nueva actividad" })).toBeInTheDocument();
  });

  it("sin permiso de crear no aparece; en escritorio tampoco", () => {
    mockMedia(true);
    h.user = READER;
    const { unmount } = render(<CalendarScreen />);
    expect(document.querySelector(".cal-fab")).toBeNull();
    unmount();
    mockMedia(false);
    h.user = LEADER;
    render(<CalendarScreen />);
    expect(document.querySelector(".cal-fab")).toBeNull();
  });

  it("queda fijo 16 px sobre la barra inferior, alto 48 y radio 12", () => {
    const src = css("components/calendar/calendar.css");
    const mobile = src.slice(src.lastIndexOf(".cds-calendar .cal-fab {"));
    expect(mobile).toMatch(/position:\s*fixed/);
    expect(mobile).toMatch(/bottom:\s*calc\(64px \+ env\(safe-area-inset-bottom\) \+ 16px\)/);
    expect(mobile).toMatch(/height:\s*48px/);
    expect(mobile).toMatch(/border-radius:\s*12px/);
    expect(src).toMatch(/\.cal-screen\.has-fab\s*\{\s*padding-bottom:/);
  });
});

describe("B3 · Mis actividades", () => {
  const actor = (doc: UserAccessDoc) => accessModel(doc);

  it("la pestaña se ofrece con áreas (aunque solo lea) o con gestión de sus áreas aunque no tenga ninguna", () => {
    expect(showsMyActivities(actor(LEADER))).toBe(true);
    expect(showsMyActivities(actor(LEADER_NO_AREAS))).toBe(true);
    expect(showsMyActivities(actor(READER_WITH_AREAS))).toBe(true);
    expect(showsMyActivities(actor(READER))).toBe(false);
    expect(showsMyActivities(actor(ADMIN))).toBe(false);
    expect(showsMyActivities(actorFromUserDoc({ role: "leader", active: true }))).toBe(true);
    expect(showsMyActivities(null)).toBe(false);
  });

  it("la ruta redirige solo a quien lee sin áreas; Administración entra por enlace directo", () => {
    expect(myActivitiesRoute(actor(READER))).toBe("redirect");
    expect(myActivitiesRoute(actor(LEADER_NO_AREAS))).toBe("show");
    expect(myActivitiesRoute(actor(READER_WITH_AREAS))).toBe("show");
    expect(myActivitiesRoute(actor(ADMIN))).toBe("show");
  });

  it("subnav: líder sin áreas ve «Mis actividades»; lectura sin áreas no", () => {
    h.user = LEADER_NO_AREAS;
    const { unmount } = render(
      <CalendarLayout>
        <p>contenido</p>
      </CalendarLayout>,
    );
    const nav = screen.getByRole("navigation", { name: "Secciones de Calendario" });
    expect(within(nav).getByRole("link", { name: "Mis actividades" })).toHaveAttribute("href", "/calendario/mis-actividades");
    unmount();
    h.user = READER;
    render(
      <CalendarLayout>
        <p>contenido</p>
      </CalendarLayout>,
    );
    expect(within(screen.getByRole("navigation", { name: "Secciones de Calendario" })).queryByRole("link", { name: "Mis actividades" })).toBeNull();
  });

  it("líder sin áreas llega al vacío «Aún no tienes áreas asignadas», sin redirect", () => {
    h.user = LEADER_NO_AREAS;
    render(<MyActivitiesGate />);
    expect(screen.getByText("Aún no tienes áreas asignadas")).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("lectura sin áreas: un único replace al Calendario con el aviso del shell", async () => {
    h.user = READER;
    render(<MyActivitiesGate />);
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/calendario"));
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(h.showAccessNotice).toHaveBeenCalledWith(MY_ACTIVITIES_REDIRECT_NOTICE, "/calendario");
    expect(MY_ACTIVITIES_REDIRECT_NOTICE).toBe("No tienes acceso a Mis actividades. Te llevamos a Calendario.");
    expect(screen.queryByText("Aún no tienes áreas asignadas")).toBeNull();
  });
});

describe("B4 · Agenda y Mis actividades alineadas a la izquierda", () => {
  it("la lista no se centra: max-width 880 y margen izquierdo 0", () => {
    const src = css("components/calendar/calendar.css");
    const wrap = rule(src, ".cds-calendar .cal-screen .cal-agenda-wrap");
    expect(wrap).toMatch(/max-width:\s*880px/);
    expect(wrap).toMatch(/margin-left:\s*0/);
    expect(wrap).not.toMatch(/margin:\s*0 auto/);
  });
});

describe("B5 · Objetivos táctiles de 44 px en móvil", () => {
  it("«Agregar áreas», stepper del reporte y segmented público", () => {
    const cal = css("components/calendar/calendar.css");
    const mobileCal = cal.slice(cal.lastIndexOf("@media (max-width: 767px)"));
    expect(rule(mobileCal, ".cds-calendar .cal-add-areas")).toMatch(/min-height:\s*44px/);
    const rep = rule(css("components/reports/reports.css"), ".cal-rep-stepper > button");
    expect(rep).toMatch(/width:\s*44px/);
    expect(rep).toMatch(/height:\s*44px/);
    const pub = css("components/public-calendar/public-calendar.css");
    expect(rule(pub.slice(pub.indexOf("@media (max-width: 767px)")), ".pub-segmented button")).toMatch(/min-height:\s*44px/);
  });
});

describe("B6 · Compartir: quién creó el enlace", () => {
  const status = (over: Partial<Record<string, unknown>> = {}) => ({
    exists: true,
    active: true,
    createdAt: "2026-10-01T15:00:00.000Z",
    regeneratedAt: null,
    disabledAt: null,
    ...over,
  });

  it("textos de estado con y sin nombre", () => {
    expect(activeStatusText("creado", "01-10-2026", "Daniel Herrera")).toBe("Enlace activo · creado el 01-10-2026 por Daniel Herrera");
    expect(activeStatusText("creado", "01-10-2026", null)).toBe("Enlace activo · creado el 01-10-2026");
    expect(activeStatusText("generado", "02-10-2026", "  ")).toBe("Enlace activo · generado el 02-10-2026");
    expect(activeStatusText("creado", "", "Daniel")).toBe("Enlace activo");
    expect(disabledStatusText("05-10-2026", "Ana Pérez")).toBe("Desactivado el 05-10-2026 por Ana Pérez");
    expect(disabledStatusText("05-10-2026", undefined)).toBe("Desactivado el 05-10-2026");
  });

  it("el nombre se recorta y nunca es un correo", () => {
    expect(shareActorName("  Daniel   Herrera ")).toBe("Daniel Herrera");
    expect(shareActorName("pastor@cds.test")).toBeNull();
    expect(shareActorName("")).toBeNull();
    expect(shareActorName(42)).toBeNull();
    expect(shareActorName(undefined)).toBeNull();
    expect(shareActorName("x".repeat(200))).toHaveLength(80);
  });

  it("estado C muestra «por {nombre}» con createdByName", async () => {
    h.user = ADMIN;
    h.manageShareLink.mockResolvedValue({ status: status({ createdByName: "Daniel Herrera" }) });
    render(<ShareAdminScreen />);
    expect(await screen.findByText("Enlace activo · creado el 01-10-2026 por Daniel Herrera")).toBeInTheDocument();
  });

  it("estado C sin nombre omite «por …»; generado usa regeneratedByName", async () => {
    h.user = ADMIN;
    h.manageShareLink.mockResolvedValue({ status: status({ createdByName: null }) });
    const { unmount } = render(<ShareAdminScreen />);
    expect(await screen.findByText("Enlace activo · creado el 01-10-2026")).toBeInTheDocument();
    unmount();
    h.manageShareLink.mockResolvedValue({
      status: status({ createdByName: "Ana", regeneratedAt: "2026-10-02T15:00:00.000Z", regeneratedByName: "Daniel Herrera" }),
    });
    render(<ShareAdminScreen />);
    expect(await screen.findByText("Enlace activo · generado el 02-10-2026 por Daniel Herrera")).toBeInTheDocument();
  });

  it("«Copiar enlace» no se parte: nowrap y min-width 168", async () => {
    h.user = ADMIN;
    h.manageShareLink.mockImplementation(async (action: string) =>
      action === "status" ? { status: status({ exists: false, active: false, createdAt: null }) } : { status: status(), token: "T".repeat(43) },
    );
    render(<ShareAdminScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Crear enlace" }));
    expect(await screen.findByRole("button", { name: /Copiar enlace/ })).toHaveClass("cal-share-copy");
    const copy = rule(css("components/calendar/calendar.css"), ".cds-calendar .cal-share-copy");
    expect(copy).toMatch(/white-space:\s*nowrap/);
    expect(copy).toMatch(/min-width:\s*168px/);
  });
});

describe("B7 · Reporte: ícono de visibilidad con nombre", () => {
  it("«Solo equipo» y «Pública» como aria-label y title", () => {
    render(
      <>
        <VisibilityMark row={{ visibility: "internal" }} />
        <VisibilityMark row={{ visibility: "public" }} />
      </>,
    );
    const internal = screen.getByRole("img", { name: "Solo equipo" });
    expect(internal).toHaveAttribute("title", "Solo equipo");
    expect(screen.getByRole("img", { name: "Pública" })).toHaveAttribute("title", "Pública");
  });
});

describe("B8 · Editar: sin manage_all la fecha no se mueve al pasado", () => {
  const e = ev({ startDate: "2026-10-20", endDate: "2026-10-20" });
  const ctx = (doc: UserAccessDoc) => ({ actor: actorFromUserDoc(doc), areas: AREAS, today: "2026-10-10", existing: e });

  it("líder (manage_assigned): mover al pasado es un error con mensaje", () => {
    const errors = validateEvent(input(e, { startDate: "2026-10-05", endDate: "2026-10-05" }), ctx(LEADER));
    expect(errors.startDate).toBe(PAST_START_EDIT_ERROR);
  });

  it("líder: hoy o futuro está bien; no cambiar la fecha tampoco es error", () => {
    expect(validateEvent(input(e, { startDate: "2026-10-10", endDate: "2026-10-10" }), ctx(LEADER)).startDate).toBeUndefined();
    expect(validateEvent(input(e), ctx(LEADER)).startDate).toBeUndefined();
  });

  it("Administración (manage_all) sí puede corregir hacia atrás", () => {
    expect(validateEvent(input(e, { startDate: "2026-10-05", endDate: "2026-10-05" }), ctx(ADMIN)).startDate).toBeUndefined();
  });

  it("el formulario muestra el error y limita la fecha mínima a hoy", async () => {
    h.events = [e];
    render(<CalendarScreen />);
    fireEvent.click(screen.getByRole("button", { name: /^Reunión de jóvenes,/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Editar/ }));
    const dialog = await screen.findByRole("dialog", { name: /Editar/ });
    const date = within(dialog).getByLabelText(/^Fecha/) as HTMLInputElement;
    expect(date).toHaveAttribute("min", "2026-10-10");
    fireEvent.change(date, { target: { value: "2026-10-05" } });
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    expect(await within(dialog).findByText(PAST_START_EDIT_ERROR)).toBeInTheDocument();
  });
});
