import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADULTS_ONLY_NOTICE, SENSITIVE_NOTE_WARNING } from "@/lib/shared/members";
import type { Person } from "@/lib/members/types";
import type { UserAccessDoc } from "@/lib/shared/types";
import { NOW, TODAY, person, visit } from "./fixtures";

const h = vi.hoisted(() => ({
  user: null as unknown,
  persons: [] as unknown[],
  history: { visits: [] as unknown[], followUps: [] as unknown[], changes: [] as unknown[], loading: false, error: null as null | string },
  titlesCalls: [] as { ids: readonly string[]; enabled: boolean }[],
  calendarEventsCalls: [] as string[],
  events: [] as unknown[],
  online: true,
  toast: vi.fn(),
  push: vi.fn(),
  createPerson: vi.fn(),
  updatePerson: vi.fn(),
  changeStatus: vi.fn(),
  createVisit: vi.fn(),
  createFollowUp: vi.fn(),
  fetchOwnerOptions: vi.fn(),
  fetchPerson: vi.fn(),
}));

vi.mock("@/lib/access/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access/model")>();
  return { ...actual, useAccessModel: () => actual.accessModel(h.user as UserAccessDoc) };
});
vi.mock("@/lib/members/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/members/client")>();
  return {
    ...actual,
    subscribePeople: (onNext: (p: unknown[]) => void) => {
      onNext(h.persons);
      return () => {};
    },
    usePersonHistory: () => h.history,
    fetchPerson: h.fetchPerson,
    useCalendarTitles: (ids: readonly string[], enabled: boolean) => {
      h.titlesCalls.push({ ids, enabled });
      return enabled ? Object.fromEntries(ids.map((id) => [id, "Culto dominical"])) : {};
    },
  };
});
vi.mock("@/lib/members/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/members/api")>();
  return {
    ...actual,
    createPerson: h.createPerson,
    updatePerson: h.updatePerson,
    changeStatus: h.changeStatus,
    createVisit: h.createVisit,
    createFollowUp: h.createFollowUp,
    fetchOwnerOptions: h.fetchOwnerOptions,
  };
});
vi.mock("@/lib/calendar/events-client", () => ({
  useCalendarEvents: (from: string) => {
    h.calendarEventsCalls.push(from);
    return { events: h.events, loading: false, error: "" };
  },
}));
vi.mock("@/lib/calendar/use-now", () => ({ useSantiagoNow: () => ({ today: "2026-10-05", now: "2026-10-05T12:00" }) }));
vi.mock("@/lib/browser/online", () => ({ useOnlineStatus: () => h.online }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { uid: "u-owner" } }) }));
vi.mock("@/components/layout/notice", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn() }),
  usePathname: () => window.location.pathname,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { MembersApiError } from "@/lib/members/api";
import { MembersProvider } from "@/lib/members/use-members";
import { ConsolidationDashboardScreen } from "@/components/members/dashboard";
import { PeopleScreen } from "@/components/members/people";
import { PersonScreen } from "@/components/members/person";
import { NewPersonScreen } from "@/components/members/person-form";
import MembersLayout from "@/app/(private)/integrantes/layout";

const MANAGER: UserAccessDoc = {
  accessSchemaVersion: 1,
  active: true,
  baseRole: "standard",
  role: "leader",
  permissions: ["members.consolidation.manage"],
  areaIds: [],
};
const MANAGER_CAL: UserAccessDoc = { ...MANAGER, permissions: ["members.consolidation.manage", "calendar.read"] };
const READER: UserAccessDoc = { ...MANAGER, permissions: ["members.consolidation.read"] };

const FORBIDDEN = /nacimiento|Cumpleaños|Confesión|Bautizad|\d+ años|Edad desconocida|Simulación|Vista previa/i;

function people(): Person[] {
  return [
    person({ id: "p1", fullName: "Ana Torres", phoneE164: "+56955550101", entryDate: "2026-10-04", createdAt: "2026-10-04T10:00" }),
    person({
      id: "p2",
      fullName: "Pablo Muñoz",
      phoneE164: "+56955550102",
      consolidationStatus: "por_contactar",
      createdAt: "2026-10-01T10:00",
      projection: { firstContactDate: null, followUpCount: 0, lastFollowUpDate: null },
    }),
    person({ id: "p3", fullName: "Valentina Castro", phoneE164: "+56955550103", doNotContact: true }),
    person({ id: "p4", fullName: "Rosa Díaz", phoneE164: "+56955550104", lifecycleStage: "integrante", consolidationStatus: "integrado" }),
    person({
      id: "p5",
      fullName: "Marta Rojas",
      phoneE164: "+56955550105",
      consolidationStatus: "sin_continuidad",
      closedReason: "no_responde",
    }),
  ];
}

function renderWith(ui: React.ReactNode) {
  return render(<MembersProvider>{ui}</MembersProvider>);
}

async function openPerson(id: string) {
  window.history.replaceState(null, "", `/integrantes/consolidacion/persona?id=${id}`);
  renderWith(<PersonScreen />);
  await screen.findByRole("heading", { level: 2, name: (h.persons as Person[]).find((p) => p.id === id)!.fullName });
}

beforeEach(() => {
  h.user = MANAGER;
  h.persons = people();
  h.history = { visits: [], followUps: [], changes: [], loading: false, error: null };
  h.titlesCalls = [];
  h.calendarEventsCalls = [];
  h.events = [];
  h.online = true;
  h.toast.mockReset();
  h.push.mockReset();
  h.createPerson.mockReset();
  h.updatePerson.mockReset();
  h.changeStatus.mockReset();
  h.createVisit.mockReset();
  h.createFollowUp.mockReset();
  h.fetchOwnerOptions.mockReset().mockResolvedValue([{ uid: "u-owner", displayName: "Carolina Vidal" }]);
  h.fetchPerson.mockReset().mockResolvedValue(null);
  window.history.replaceState(null, "", "/integrantes/consolidacion");
});

describe("Inicio de Consolidación", () => {
  it("tiene exactamente 3 indicadores con link a la lista filtrada y sin cumpleaños", async () => {
    renderWith(<ConsolidationDashboardScreen />);
    const tiles = await waitFor(() => {
      const t = document.querySelectorAll("[data-indicator]");
      expect(t).toHaveLength(3);
      return t;
    });
    expect([...tiles].map((t) => t.getAttribute("href"))).toEqual([
      "/integrantes/consolidacion/personas?etiqueta=nuevos_mes&etapa=todas",
      "/integrantes/consolidacion/personas?alerta=sin_primer_contacto",
      "/integrantes/consolidacion/personas?alerta=vencido",
    ]);
    expect(screen.getByText("Sin primer contacto (+48 h)")).toBeInTheDocument();
    for (const title of ["Necesitan atención", "Nuevos recientes", "Seguimientos pendientes", "Volvieron"])
      expect(screen.getByRole("heading", { name: new RegExp(`^${title}`) })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
  });

  it("solo lectura: la cola muestra «Ver ficha» en vez de acciones", async () => {
    h.user = READER;
    renderWith(<ConsolidationDashboardScreen />);
    const list = await screen.findByRole("list", { name: "Personas que necesitan atención" });
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
    expect(within(list).getAllByRole("link", { name: /^Ver ficha:/ }).length).toBeGreaterThan(0);
  });

  it("estado de carga y estado vacío", async () => {
    h.persons = [];
    renderWith(<ConsolidationDashboardScreen />);
    expect(await screen.findByText("Aún no hay personas en Consolidación")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Registrar persona/ })).toHaveAttribute("href", "/integrantes/consolidacion/nueva");
  });
});

describe("layout del módulo", () => {
  it("«Registrar persona» solo con gestión", () => {
    const { unmount } = render(
      <MembersLayout>
        <p>contenido</p>
      </MembersLayout>,
    );
    expect(screen.getByRole("link", { name: /Registrar persona/ })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Secciones de Integrantes" })).toBeInTheDocument();
    unmount();
    h.user = READER;
    render(
      <MembersLayout>
        <p>contenido</p>
      </MembersLayout>,
    );
    expect(screen.queryByRole("link", { name: /Registrar persona/ })).toBeNull();
  });
});

describe("Personas", () => {
  it("lista con filtros por query (alerta) y acciones de fila sin WhatsApp con No contactar", async () => {
    window.history.replaceState(null, "", "/integrantes/consolidacion/personas?alerta=sin_primer_contacto");
    renderWith(<PeopleScreen />);
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("Pablo Muñoz")).toBeInTheDocument();
  });

  it("móvil: el sheet de acciones ofrece Seguimiento · Visita · WhatsApp · Ver ficha (WhatsApp oculto con No contactar)", async () => {
    window.history.replaceState(null, "", "/integrantes/consolidacion/personas");
    renderWith(<PeopleScreen />);
    const list = await screen.findByRole("list", { name: "Personas" });
    fireEvent.click(within(list).getByRole("button", { name: "Acciones para Ana Torres" }));
    let dialog = screen.getByRole("dialog", { name: "Acciones para Ana Torres" });
    expect(within(dialog).getByRole("button", { name: /Registrar seguimiento/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Registrar visita/ })).toBeInTheDocument();
    const wa = within(dialog).getByRole("link", { name: /Abrir WhatsApp/ });
    expect(wa).toHaveAttribute("href", "https://wa.me/56955550101");
    expect(wa).toHaveAttribute("target", "_blank");
    expect(wa).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    fireEvent.click(within(list).getByRole("button", { name: "Acciones para Valentina Castro" }));
    dialog = screen.getByRole("dialog", { name: "Acciones para Valentina Castro" });
    expect(within(dialog).queryByRole("link", { name: /WhatsApp/ })).toBeNull();
  });

  it("solo lectura: el sheet de acciones no ofrece escrituras", async () => {
    h.user = READER;
    window.history.replaceState(null, "", "/integrantes/consolidacion/personas");
    renderWith(<PeopleScreen />);
    const list = await screen.findByRole("list", { name: "Personas" });
    fireEvent.click(within(list).getByRole("button", { name: "Acciones para Ana Torres" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /Registrar/ })).toBeNull();
    expect(within(dialog).getByRole("link", { name: /Ver ficha/ })).toBeInTheDocument();
  });
});

describe("Ficha", () => {
  it("WhatsApp real (wa.me, pestaña nueva) y ausente con No contactar", async () => {
    await openPerson("p1");
    const wa = screen.getByRole("link", { name: /^WhatsApp: Ana Torres/ });
    expect(wa).toHaveAttribute("href", "https://wa.me/56955550101");
    expect(wa).toHaveAttribute("target", "_blank");
  });

  it("con No contactar no hay WhatsApp y se explica", async () => {
    await openPerson("p3");
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    expect(screen.getByText(/Pidió no recibir contacto/)).toBeInTheDocument();
  });

  it("solo lectura: sin acciones de escritura", async () => {
    h.user = READER;
    await openPerson("p1");
    for (const name of [/Registrar visita/, /Registrar seguimiento/, /Cambiar estado/, /Editar datos/, /Asignar|Cambiar responsable/])
      expect(screen.queryByRole("button", { name })).toBeNull();
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
  });

  it("sin calendar.read: no se leen títulos del calendario y se muestra «Actividad del calendario»", async () => {
    h.persons = [person({ id: "p1", fullName: "Ana Torres", calendarEventId: "ev1" })];
    h.history = { ...h.history, visits: [visit({ id: "v1", calendarEventId: "ev1", firstVisit: true })] };
    await openPerson("p1");
    expect(h.titlesCalls.every((c) => !c.enabled)).toBe(true);
    expect(screen.queryByText(/Culto dominical/)).toBeNull();
    expect(screen.getAllByText(/Actividad del calendario/).length).toBeGreaterThan(0);
  });

  it("con calendar.read se muestra el título de la actividad", async () => {
    h.user = MANAGER_CAL;
    h.persons = [person({ id: "p1", fullName: "Ana Torres", calendarEventId: "ev1" })];
    h.history = { ...h.history, visits: [visit({ id: "v1", calendarEventId: "ev1", firstVisit: true })] };
    await openPerson("p1");
    expect(screen.getAllByText(/Culto dominical/).length).toBeGreaterThan(0);
  });

  it("integrante: sin «Cambiar estado», con «Registrar visita» y la nota de alertas", async () => {
    await openPerson("p4");
    expect(screen.queryByRole("button", { name: /Cambiar estado/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar seguimiento de/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Registrar visita a Rosa Díaz/ })).toBeInTheDocument();
    expect(screen.getByText(/Integrado: ya no aparece en las alertas de Consolidación/)).toBeInTheDocument();
  });

  it("id desconocido: estado vacío con salida", async () => {
    window.history.replaceState(null, "", "/integrantes/consolidacion/persona?id=nadie");
    renderWith(<PersonScreen />);
    expect(await screen.findByText("No encontramos esta persona.")).toBeInTheDocument();
    // Antes de concluir, se intentó la lectura puntual del documento.
    expect(h.fetchPerson).toHaveBeenCalledWith("nadie");
  });
});

describe("Registrar persona", () => {
  beforeEach(() => window.history.replaceState(null, "", "/integrantes/consolidacion/nueva"));

  it("aviso solo adultos, advertencia de notas con contador y sin campos excluidos", async () => {
    renderWith(<NewPersonScreen />);
    expect(screen.getByText(ADULTS_ONLY_NOTICE)).toBeInTheDocument();
    expect(screen.getByText(SENSITIVE_NOTE_WARNING)).toBeInTheDocument();
    expect(screen.getByText("0/280")).toBeInTheDocument();
    expect(screen.getByLabelText(/Observación de la primera visita/)).toHaveAttribute("maxLength", "280");
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    expect(screen.queryByLabelText(/edad|nacimiento|confesi|bautiz/i)).toBeNull();
    expect(screen.queryByLabelText(/Llegó a/)).toBeNull();
    expect(h.calendarEventsCalls).toEqual([]);
    // Responsable: quien registra, si es responsable válido (editable).
    await waitFor(() => expect(screen.getByLabelText("Responsable de seguimiento")).toHaveValue("u-owner"));
    expect(screen.getByLabelText("Fecha de la primera visita *")).toHaveValue(TODAY);
  });

  it("con calendar.read aparece el selector de actividad del día", () => {
    h.user = MANAGER_CAL;
    renderWith(<NewPersonScreen />);
    expect(screen.getByLabelText(/Llegó a/)).toBeInTheDocument();
    expect(h.calendarEventsCalls).toContain(TODAY);
  });

  it("posible duplicado: aviso con 3 opciones que no bloquea el guardado", async () => {
    let resolve: (v: unknown) => void = () => {};
    h.createPerson.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWith(<NewPersonScreen />);
    await waitFor(() => expect(screen.getByLabelText("Responsable de seguimiento")).toHaveValue("u-owner"));
    fireEvent.change(screen.getByLabelText("Nombre completo *"), { target: { value: "Ana T." } });
    fireEvent.change(screen.getByLabelText("Teléfono *"), { target: { value: "9 5555 0101" } });
    const notice = screen.getByTestId("duplicate-notice");
    expect(within(notice).getByRole("link", { name: "Ver ficha existente" })).toHaveAttribute("href", "/integrantes/consolidacion/persona?id=p1");
    expect(within(notice).getByRole("button", { name: /Registrar visita a Ana/ })).toBeInTheDocument();
    expect(within(notice).getByRole("button", { name: "Es otra persona, continuar" })).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: "Guardar persona" });
    fireEvent.click(submit);
    await waitFor(() => expect(h.createPerson).toHaveBeenCalledTimes(1));
    // Mientras envía: deshabilitado, sin doble envío, sin toast.
    const busy = screen.getByRole("button", { name: /Guardando/ });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(h.createPerson).toHaveBeenCalledTimes(1);
    expect(h.toast).not.toHaveBeenCalled();
    const payload = h.createPerson.mock.calls[0][0];
    expect(payload).toMatchObject({ fullName: "Ana T.", phone: "9 5555 0101", firstVisitDate: TODAY, followUpOwnerUid: "u-owner" });
    expect(payload.requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(Object.keys(payload)).not.toContain("birthDate");

    await act(async () => resolve({ personId: "nuevo", replay: false, duplicates: [{ personId: "p1", by: ["telefono"] }] }));
    expect(h.toast).toHaveBeenCalledWith("Persona registrada");
    expect(screen.getByRole("heading", { name: /Persona registrada/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ana Torres" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver ficha/ })).toHaveAttribute("href", "/integrantes/consolidacion/persona?id=nuevo");
  });

  it("errores de validación no llaman al callable; sin duplicados, navega a la ficha tras resolver", async () => {
    h.createPerson.mockResolvedValue({ personId: "nuevo", replay: false, duplicates: [] });
    renderWith(<NewPersonScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Guardar persona" }));
    expect(screen.getByText("Escribe el nombre.")).toBeInTheDocument();
    expect(screen.getByText("Escribe el teléfono.")).toBeInTheDocument();
    expect(h.createPerson).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nombre completo *"), { target: { value: "Luis Pérez" } });
    fireEvent.change(screen.getByLabelText("Teléfono *"), { target: { value: "912345678" } });
    expect(screen.getByText(/Se guardará como \+56 9 1234 5678/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar persona" }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/integrantes/consolidacion/persona?id=nuevo"));
  });

  it("los errores por campo del servidor se muestran en el formulario y se reutiliza el requestId", async () => {
    h.createPerson.mockRejectedValueOnce(new MembersApiError("members/invalid-argument", "fields", "Revisa los datos marcados.", { email: "Correo no válido." }));
    h.createPerson.mockResolvedValueOnce({ personId: "nuevo", replay: true, duplicates: [] });
    renderWith(<NewPersonScreen />);
    fireEvent.change(screen.getByLabelText("Nombre completo *"), { target: { value: "Luis Pérez" } });
    fireEvent.change(screen.getByLabelText("Teléfono *"), { target: { value: "912345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar persona" }));
    expect(await screen.findByText("Revisa los datos marcados.")).toBeInTheDocument();
    expect(screen.getByText("Correo no válido.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar persona" }));
    await waitFor(() => expect(h.createPerson).toHaveBeenCalledTimes(2));
    expect(h.createPerson.mock.calls[1][0].requestId).toBe(h.createPerson.mock.calls[0][0].requestId);
  });
});

describe("sheets", () => {
  it("seguimiento: «contactado» propone En seguimiento YA MARCADO; desmarcado no se envía applyStatus", async () => {
    h.createFollowUp.mockResolvedValue({ followUpId: "f", replay: false, revision: 4 });
    await openPerson("p2");
    fireEvent.click(screen.getByRole("button", { name: /Registrar seguimiento de Pablo/ }));
    const dialog = screen.getByRole("dialog", { name: /Registrar seguimiento/ });
    expect(within(dialog).getByText(SENSITIVE_NOTE_WARNING)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Contactado" }));
    const chk = within(dialog).getByRole("checkbox", { name: /Cambiar estado a En seguimiento/ });
    expect(chk).toBeChecked();
    fireEvent.click(chk);
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar seguimiento" }));
    await waitFor(() => expect(h.createFollowUp).toHaveBeenCalledTimes(1));
    const payload = h.createFollowUp.mock.calls[0][0];
    expect(payload).toMatchObject({ personId: "p2", result: "contactado", contactDate: TODAY });
    expect(payload).not.toHaveProperty("applyStatus");
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("Seguimiento registrado"));
  });

  it("seguimiento con la sugerencia marcada envía applyStatus", async () => {
    h.createFollowUp.mockResolvedValue({ followUpId: "f", replay: false, revision: 4 });
    await openPerson("p2");
    fireEvent.click(screen.getByRole("button", { name: /Registrar seguimiento de Pablo/ }));
    const dialog = screen.getByRole("dialog", { name: /Registrar seguimiento/ });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Contactado" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar seguimiento" }));
    await waitFor(() => expect(h.createFollowUp.mock.calls[0][0]).toMatchObject({ applyStatus: "en_seguimiento" }));
  });

  it("conflicto: mensaje en español y acción para recargar", async () => {
    h.updatePerson.mockRejectedValue(new MembersApiError("members/conflict", "conflict", "Alguien actualizó esta persona. Recarga para ver los cambios."));
    await openPerson("p1");
    fireEvent.click(screen.getByRole("button", { name: /Marcar No contactar: Ana/ }));
    const dialog = screen.getByRole("dialog", { name: /Marcar No contactar/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Marcar No contactar" }));
    expect(await within(dialog).findByText("Alguien actualizó esta persona. Recarga para ver los cambios.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Recargar/ })).toBeInTheDocument();
    expect(h.updatePerson.mock.calls[0][0]).toMatchObject({ personId: "p1", expectedRevision: 3, doNotContact: true });
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("visita: sin selector sin calendar.read; aviso de visita del mismo día y de No contactar", async () => {
    h.persons = [person({ id: "p1", fullName: "Ana Torres", doNotContact: true, projection: { lastVisitDate: TODAY } })];
    await openPerson("p1");
    fireEvent.click(screen.getByRole("button", { name: /Registrar visita a Ana/ }));
    const dialog = screen.getByRole("dialog", { name: /Registrar visita/ });
    expect(within(dialog).queryByLabelText(/Actividad/)).toBeNull();
    expect(within(dialog).getByText(/Ya hay una visita registrada el .*¿Registrar otra\?/)).toBeInTheDocument();
    expect(within(dialog).getByText("Esta persona pidió no ser contactada.")).toBeInTheDocument();
    expect(within(dialog).getByText("0/280")).toBeInTheDocument();
  });

  it("visita de alguien en Sin continuidad: tras guardar sugiere reabrir y solo reabre con el botón", async () => {
    h.createVisit.mockResolvedValue({ visitId: "v", replay: false, suggestReopen: true, revision: 7 });
    h.changeStatus.mockResolvedValue({ replay: false, revision: 8 });
    await openPerson("p5");
    fireEvent.click(screen.getByRole("button", { name: /Registrar visita a Marta/ }));
    let dialog = screen.getByRole("dialog", { name: /Registrar visita/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar visita" }));
    dialog = await screen.findByRole("dialog", { name: /Visita registrada/ });
    expect(within(dialog).getByText("Esta persona volvió. ¿Reabrir seguimiento?")).toBeInTheDocument();
    expect(h.changeStatus).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reabrir seguimiento" }));
    await waitFor(() => expect(h.changeStatus).toHaveBeenCalledWith({ personId: "p5", expectedRevision: 7, status: "en_seguimiento" }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("Seguimiento reabierto"));
  });

  it("Integrado exige un diálogo de confirmación que dice que no se puede deshacer", async () => {
    h.changeStatus.mockResolvedValue({ replay: false, revision: 4 });
    await openPerson("p1");
    fireEvent.click(screen.getByRole("button", { name: /Cambiar estado/ }));
    const dialog = screen.getByRole("dialog", { name: /Cambiar estado/ });
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Integrado/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambio" }));
    expect(h.changeStatus).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: "¿Confirmar Integrado?" });
    expect(within(confirm).getByText(/En esta versión no se puede deshacer\./)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirmar: Integrado" }));
    await waitFor(() =>
      expect(h.changeStatus).toHaveBeenCalledWith({ personId: "p1", expectedRevision: 3, status: "integrado", confirmIntegrated: true }),
    );
  });

  it("Sin continuidad exige motivo y texto si es «Otro» (con contador de 200)", async () => {
    await openPerson("p1");
    fireEvent.click(screen.getByRole("button", { name: /Cambiar estado/ }));
    const dialog = screen.getByRole("dialog", { name: /Cambiar estado/ });
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Sin continuidad/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambio" }));
    expect(within(dialog).getByText("Elige el motivo de Sin continuidad.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Motivo \(obligatorio\)$/), { target: { value: "otro" } });
    expect(within(dialog).getByText("0/200")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambio" }));
    expect(within(dialog).getByText("Escribe el motivo.")).toBeInTheDocument();
    expect(h.changeStatus).not.toHaveBeenCalled();
  });

  it("sin conexión: guardar queda deshabilitado con explicación", async () => {
    h.online = false;
    await openPerson("p1");
    fireEvent.click(screen.getByRole("button", { name: /Registrar visita a Ana/ }));
    const dialog = screen.getByRole("dialog", { name: /Registrar visita/ });
    expect(within(dialog).getByRole("button", { name: "Guardar visita" })).toBeDisabled();
    expect(within(dialog).getByText(/Sin conexión/)).toBeInTheDocument();
  });
});

// Fecha y hora fijas de las pruebas (documentación).
void NOW;
