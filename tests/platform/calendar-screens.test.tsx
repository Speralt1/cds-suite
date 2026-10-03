import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, CalendarEvent, UserAccessDoc } from "@/lib/shared/types";

const h = vi.hoisted(() => ({
  user: null as unknown,
  events: [] as unknown[],
  toast: vi.fn(),
  cancelEvent: vi.fn(),
  archiveEvent: vi.fn(),
  setVisibility: vi.fn(),
  createEvent: vi.fn(),
  manageShareLink: vi.fn(),
}));

const AREAS: Area[] = [
  { id: "jovenes", name: "Jóvenes", color: "azul", active: true },
  { id: "alabanza", name: "Alabanza", color: "verde", active: true },
  { id: "matrimonios", name: "Matrimonios", color: "frambuesa", active: true },
  { id: "varones", name: "Varones", color: "cafe", active: false },
];

vi.mock("@/lib/access/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access/model")>();
  return { ...actual, useAccessModel: () => actual.accessModel(h.user as UserAccessDoc) };
});
vi.mock("@/lib/calendar/areas-client", () => ({ useAreas: () => ({ areas: AREAS, loading: false, error: "" }) }));
vi.mock("@/lib/calendar/events-client", () => ({
  useCalendarEvents: () => ({ events: h.events, loading: false, error: "" }),
  createEvent: h.createEvent,
  updateEvent: vi.fn(),
  updateSeries: vi.fn(),
  cancelEvent: h.cancelEvent,
  cancelOccurrence: vi.fn(),
  cancelSeriesFrom: vi.fn(),
  archiveEvent: h.archiveEvent,
  setVisibility: h.setVisibility,
}));
vi.mock("@/lib/calendar/share-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendar/share-client")>();
  return { ...actual, manageShareLink: h.manageShareLink };
});
vi.mock("@/lib/calendar/use-now", () => ({ useSantiagoNow: () => ({ today: "2026-10-10", now: "2026-10-10T12:00" }) }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { uid: "u-lider" } }) }));
vi.mock("@/components/layout/notice", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { CalendarScreen } from "@/components/calendar/calendar-screen";
import { MyActivitiesScreen } from "@/components/calendar/my-activities";
import { ShareAdminScreen } from "@/components/calendar/share-admin";

const LEADER: UserAccessDoc = {
  accessSchemaVersion: 1,
  active: true,
  baseRole: "standard",
  role: "leader",
  permissions: ["finance.summary.read", "calendar.read", "calendar.events.manage_assigned"],
  areaIds: ["jovenes", "alabanza"],
};
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

const FORBIDDEN = /Simulación|Vista previa|Demo|Propuesta|token|UID|Firestore/;

function openChip(title: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${title},`) }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  h.user = LEADER;
  h.events = [];
  h.toast.mockReset();
  h.cancelEvent.mockReset().mockResolvedValue(undefined);
  h.archiveEvent.mockReset().mockResolvedValue(undefined);
  h.setVisibility.mockReset().mockResolvedValue(undefined);
  h.createEvent.mockReset().mockResolvedValue("nuevo");
  h.manageShareLink.mockReset();
  window.history.replaceState(null, "", "/calendario");
});

describe("Calendario › formulario", () => {
  it("el líder solo puede elegir sus áreas activas como responsable", () => {
    render(<CalendarScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: /Crear actividad/ })[0]);
    const dialog = screen.getByRole("dialog", { name: "Nueva actividad" });
    const select = within(dialog).getByLabelText(/Área responsable/) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Alabanza", "Jóvenes"]);
  });

  it("sin permiso de publicar, «Pública» queda aria-disabled con la explicación visible", () => {
    render(<CalendarScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: /Crear actividad/ })[0]);
    const dialog = screen.getByRole("dialog", { name: "Nueva actividad" });
    const pub = within(dialog).getByRole("radio", { name: /Pública/ });
    expect(pub).toHaveAttribute("aria-disabled", "true");
    expect(pub).not.toBeChecked();
    const help = document.getElementById(pub.getAttribute("aria-describedby") ?? "");
    expect(help?.textContent).toMatch(/Publicar actividades de sus áreas/);
    fireEvent.click(pub);
    expect(pub).not.toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Solo equipo CDS/ })).toBeChecked();
  });

  it("con permiso de publicar, «Pública» se puede elegir", () => {
    h.user = { ...LEADER, permissions: [...(LEADER.permissions as string[]), "calendar.events.publish_assigned"] };
    render(<CalendarScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: /Crear actividad/ })[0]);
    const pub = within(screen.getByRole("dialog")).getByRole("radio", { name: /Pública/ });
    expect(pub).not.toHaveAttribute("aria-disabled");
    fireEvent.click(pub);
    expect(pub).toBeChecked();
  });
});

describe("Calendario › detalle", () => {
  it("actividad de un área ajena: acciones aria-disabled con explicación", () => {
    h.events = [ev({ id: "m1", title: "Retiro de matrimonios", responsibleAreaId: "matrimonios" })];
    render(<CalendarScreen />);
    const dialog = openChip("Retiro de matrimonios");
    for (const name of [/Editar/, /Cancelar actividad/, /Eliminar/]) {
      expect(within(dialog).getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    }
    expect(dialog.textContent).toMatch(/Solo el área responsable \(Matrimonios\), Pastor o Administración pueden modificar esta actividad\./);
    expect(within(dialog).queryByRole("button", { name: /Publicar/ })).toBeNull();
  });

  it("área participante: se explica que la organiza otra área", () => {
    h.events = [ev({ id: "p1", title: "Concierto", responsibleAreaId: "matrimonios", participantAreaIds: ["jovenes"] })];
    render(<CalendarScreen />);
    const dialog = openChip("Concierto");
    expect(dialog.textContent).toMatch(/Tu área participa en esta actividad, pero la organiza Matrimonios/);
  });

  it("actividad pasada de su área: solo lectura con explicación", () => {
    h.events = [ev({ id: "x", title: "Ensayo", startDate: "2026-10-03", endDate: "2026-10-03", lastDate: "2026-10-03" })];
    render(<CalendarScreen />);
    const dialog = openChip("Ensayo");
    expect(within(dialog).getByRole("button", { name: /Editar/ })).toHaveAttribute("aria-disabled", "true");
    expect(dialog.textContent).toMatch(/Las actividades pasadas solo las corrige Pastor o Administración\./);
  });

  it("serie ya iniciada: una línea explica que día y hora no cambian", () => {
    h.events = [
      ev({ id: "s1", title: "Oración", startDate: "2026-10-06", endDate: "2026-10-06", recurrence: { freq: "weekly", until: "2026-12-29" }, lastDate: "2026-12-29" }),
    ];
    render(<CalendarScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Oración,.*martes 13 de octubre/ })[0]);
    expect(screen.getByRole("dialog").textContent).toMatch(/Esta serie ya empezó: no se puede cambiar el día, la hora ni la frecuencia/);
  });

  it("propia Solo equipo sin permiso de publicar: «Para publicarla, pide a Pastor o Administración.»", () => {
    h.events = [ev()];
    render(<CalendarScreen />);
    const dialog = openChip("Reunión de jóvenes");
    expect(dialog.textContent).toMatch(/Para publicarla, pide a Pastor o Administración\./);
    expect(within(dialog).queryByRole("button", { name: /^Publicar$/ })).toBeNull();
  });

  it("Admin publica con confirmación y toast", async () => {
    h.user = ADMIN;
    h.events = [ev()];
    render(<CalendarScreen />);
    fireEvent.click(within(openChip("Reunión de jóvenes")).getByRole("button", { name: "Publicar" }));
    const confirm = screen.getByRole("dialog", { name: /¿Publicar «Reunión de jóvenes»\?/ });
    fireEvent.click(within(confirm).getByRole("button", { name: "Publicar" }));
    await waitFor(() => expect(h.setVisibility).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }), "public"));
    expect(h.toast).toHaveBeenCalledWith("Actividad publicada.");
  });

  it("cancelar exige motivo", async () => {
    h.events = [ev()];
    render(<CalendarScreen />);
    fireEvent.click(within(openChip("Reunión de jóvenes")).getByRole("button", { name: /Cancelar actividad/ }));
    const dialog = screen.getByRole("dialog", { name: /Cancelar «Reunión de jóvenes»/ });
    const submit = within(dialog).getByRole("button", { name: "Cancelar actividad" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submit);
    expect(await within(dialog).findByText(/Escribe un motivo/)).toBeInTheDocument();
    expect(h.cancelEvent).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: "Lluvia fuerte" } });
    fireEvent.click(submit);
    await waitFor(() => expect(h.cancelEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }), "Lluvia fuerte"));
    expect(h.toast).toHaveBeenCalledWith("Actividad cancelada.");
  });

  it("eliminar (archivar) exige motivo", async () => {
    h.events = [ev()];
    render(<CalendarScreen />);
    fireEvent.click(within(openChip("Reunión de jóvenes")).getByRole("button", { name: /Eliminar/ }));
    const dialog = screen.getByRole("dialog", { name: /Eliminar «Reunión de jóvenes»/ });
    const submit = within(dialog).getByRole("button", { name: "Eliminar" });
    fireEvent.click(submit);
    expect(await within(dialog).findByText("Elige el motivo.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: "Otro" } });
    fireEvent.click(submit);
    expect(await within(dialog).findByText(/mínimo 3 caracteres/)).toBeInTheDocument();
    expect(h.archiveEvent).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: "Duplicada" } });
    fireEvent.click(submit);
    await waitFor(() => expect(h.archiveEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }), "Duplicada"));
    expect(h.toast).toHaveBeenCalledWith("Actividad eliminada.");
  });

  it("un error de guardado se muestra en español, sin códigos", async () => {
    h.events = [ev()];
    h.cancelEvent.mockRejectedValue(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
    render(<CalendarScreen />);
    fireEvent.click(within(openChip("Reunión de jóvenes")).getByRole("button", { name: /Cancelar actividad/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: "Lluvia fuerte" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar actividad" }));
    expect(await within(dialog).findByText(/No tienes permiso para guardar esta actividad/)).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/permission-denied|insufficient/);
  });
});

describe("Mis actividades", () => {
  it("Responsable editable y Participa solo lectura", () => {
    h.events = [ev(), ev({ id: "p1", title: "Concierto", responsibleAreaId: "matrimonios", participantAreaIds: ["jovenes"] })];
    render(<MyActivitiesScreen />);
    expect(screen.getByRole("button", { name: /Responsable · 1/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Acciones de Reunión de jóvenes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Participa · 1/ }));
    expect(screen.getByText(/Solo puedes verlas/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Acciones de Concierto/ })).toBeNull();
  });

  it("sin áreas: explica que pida un área al administrador", () => {
    h.user = { ...LEADER, areaIds: [] };
    render(<MyActivitiesScreen />);
    expect(screen.getByText("Aún no tienes áreas asignadas")).toBeInTheDocument();
  });
});

describe("Compartir calendario", () => {
  const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
  const status = (over: Partial<Record<string, unknown>> = {}) => ({
    exists: true,
    active: true,
    createdAt: "2026-10-01T15:00:00.000Z",
    regeneratedAt: null,
    disabledAt: null,
    ...over,
  });

  it("A → B (enlace una sola vez) → C sin enlace", async () => {
    h.user = ADMIN;
    h.manageShareLink.mockImplementation(async (action: string) =>
      action === "status" ? { status: status({ exists: false, active: false, createdAt: null }) } : { status: status(), token: TOKEN },
    );
    render(<ShareAdminScreen />);
    // A
    expect(await screen.findByText("Aún no hay un enlace para compartir")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    fireEvent.click(screen.getByRole("button", { name: "Crear enlace" }));
        // B
    const field = (await screen.findByLabelText("Enlace del calendario compartido")) as HTMLInputElement;
    expect(h.manageShareLink).toHaveBeenCalledWith("create");
    expect(field.value).toBe(`${window.location.origin}/calendario/compartir/${TOKEN}`);
    expect(screen.getByText(/Cópialo ahora: por seguridad no lo volveremos a mostrar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copiar enlace/ })).toBeInTheDocument();
    const open = screen.getByRole("link", { name: /Abrir vista pública/ });
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noreferrer");
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    // Listo sin copiar → confirmación → C
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: /¿Terminar sin copiar el enlace\?/ })).getByRole("button", { name: "Terminar" }));
    expect(screen.queryByLabelText("Enlace del calendario compartido")).toBeNull();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(screen.getByText(/Enlace activo · creado el 01-10-2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generar enlace nuevo/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Desactivar enlace/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copiar/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
  });

  it("C: copiar no existe; generar enlace nuevo advierte y vuelve a mostrarlo una vez", async () => {
    h.user = ADMIN;
    h.manageShareLink.mockImplementation(async (action: string) =>
      action === "regenerate" ? { status: status({ regeneratedAt: "2026-10-02T15:00:00.000Z" }), token: TOKEN } : { status: status() },
    );
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<ShareAdminScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Generar enlace nuevo/ }));
    const confirm = screen.getByRole("dialog", { name: "¿Generar un enlace nuevo?" });
    expect(confirm.textContent).toMatch(/dejará de funcionar de inmediato/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Generar enlace nuevo" }));
    await screen.findByLabelText("Enlace del calendario compartido");
    expect(h.manageShareLink).toHaveBeenCalledWith("regenerate");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copiar enlace/ }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/calendario/compartir/${TOKEN}`);
    expect(h.toast).toHaveBeenCalledWith("Enlace copiado.");
    expect(screen.getByRole("button", { name: /Copiado/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(screen.getByText(/Enlace activo · generado el 02-10-2026/)).toBeInTheDocument();
  });

  it("D: «Activar» rehabilita el MISMO enlace (sin mostrarlo) y ofrece generar uno nuevo", async () => {
    h.user = ADMIN;
    h.manageShareLink.mockImplementation(async (action: string) =>
      action === "activate" ? { status: status() } : { status: status({ active: false, disabledAt: "2026-10-05T15:00:00.000Z" }) },
    );
    render(<ShareAdminScreen />);
    expect(await screen.findByText(/Desactivado el 05-10-2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generar enlace nuevo/ })).toBeInTheDocument();
    expect(screen.getByText(/vuelve a funcionar el mismo enlace/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Activar$/ }));
    await screen.findByText(/Enlace activo/);
    expect(h.manageShareLink).toHaveBeenCalledWith("activate");
    expect(h.manageShareLink).not.toHaveBeenCalledWith("regenerate");
    expect(screen.queryByLabelText("Enlace del calendario compartido")).toBeNull();
    expect(h.toast).toHaveBeenCalledWith("Enlace activado.");
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
  });

  it("errores del enlace en español (nunca la clave share/*)", async () => {
    h.user = ADMIN;
    h.manageShareLink.mockRejectedValue(Object.assign(new Error("share/forbidden"), { code: "functions/permission-denied" }));
    render(<ShareAdminScreen />);
    expect(await screen.findByText(/No tienes permiso para administrar el enlace compartido/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/share\/|permission-denied/);
  });

  it("sin manage_all no se llama a la Function", () => {
    render(<ShareAdminScreen />);
    expect(screen.getByText("No tienes acceso a esta sección")).toBeInTheDocument();
    expect(h.manageShareLink).not.toHaveBeenCalled();
  });
});

describe("Copy de producción", () => {
  it("sin «Simulación», «Vista previa», «Demo» ni «Propuesta» en el Calendario", () => {
    h.user = ADMIN;
    h.events = [ev(), ev({ id: "s", title: "Culto", recurrence: { freq: "weekly", until: "2026-12-27" }, lastDate: "2026-12-27" })];
    render(<CalendarScreen />);
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    fireEvent.click(screen.getAllByRole("button", { name: /Crear actividad/ })[0]);
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    const dir = path.join(process.cwd(), "components/calendar");
    for (const file of fs.readdirSync(dir).filter((f) => /\.(tsx?|css)$/.test(f))) {
      const src = fs.readFileSync(path.join(dir, file), "utf8");
      expect(src, file).not.toMatch(/Simulación|Vista previa|\bDemo\b|Propuesta|fixtures|suite-preview|fx-|sx-/);
    }
  });
});
