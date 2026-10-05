// Flujos de escritura de Consolidación V1 con la persona cambiando EN VIVO
// (revisión 24b: F1, F2, F3, F4, F6, F9, F10). La suscripción de personas es
// controlable: `emit()` simula un snapshot nuevo mientras un diálogo está abierto.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Person } from "@/lib/members/types";
import type { UserAccessDoc } from "@/lib/shared/types";
import { TODAY, person, visit } from "./fixtures";

const h = vi.hoisted(() => ({
  user: null as unknown,
  persons: [] as unknown[],
  emit: null as null | ((p: unknown[]) => void),
  history: { visits: [] as unknown[], followUps: [] as unknown[], changes: [] as unknown[], loading: false, error: null as null | string },
  events: [] as unknown[],
  toast: vi.fn(),
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
      h.emit = onNext;
      onNext(h.persons);
      return () => {
        h.emit = null;
      };
    },
    usePersonHistory: () => h.history,
    useCalendarTitles: () => ({}),
    fetchPerson: h.fetchPerson,
  };
});
vi.mock("@/lib/members/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/members/api")>();
  return {
    ...actual,
    updatePerson: h.updatePerson,
    changeStatus: h.changeStatus,
    createVisit: h.createVisit,
    createFollowUp: h.createFollowUp,
    fetchOwnerOptions: h.fetchOwnerOptions,
  };
});
vi.mock("@/lib/calendar/events-client", () => ({
  useCalendarEvents: () => ({ events: h.events, loading: false, error: "" }),
}));
vi.mock("@/lib/calendar/use-now", () => ({ useSantiagoNow: () => ({ today: "2026-10-05", now: "2026-10-05T12:00" }) }));
vi.mock("@/lib/browser/online", () => ({ useOnlineStatus: () => true }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { uid: "u-owner" } }) }));
vi.mock("@/components/layout/notice", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => window.location.pathname,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { MEMBERS_CONFLICT_TEXT, MEMBERS_NETWORK_TEXT, MembersApiError } from "@/lib/members/api";
import { PEOPLE_LIMIT } from "@/lib/members/client";
import { MembersProvider } from "@/lib/members/use-members";
import { ConsolidationDashboardScreen } from "@/components/members/dashboard";
import { PeopleScreen } from "@/components/members/people";
import { PersonScreen } from "@/components/members/person";

const MANAGER: UserAccessDoc = {
  accessSchemaVersion: 1,
  active: true,
  baseRole: "standard",
  role: "leader",
  permissions: ["members.consolidation.manage"],
  areaIds: [],
};
const MANAGER_CAL: UserAccessDoc = { ...MANAGER, permissions: ["members.consolidation.manage", "calendar.read"] };

const LOCK_HELP = "Para cambiar esta opción, cierra y vuelve a abrir el formulario.";
const ANA = { id: "p1", fullName: "Ana Torres", phoneE164: "+56955550101", email: null, revision: 3 } as const;

function people(over: Partial<Omit<Person, "projection">> & { projection?: Partial<Person["projection"]> } = {}): Person[] {
  return [
    person({ ...ANA, ...over }),
    person({ id: "p2", fullName: "Pablo Muñoz", phoneE164: "+56955550102" }),
  ];
}

/** Snapshot nuevo de la suscripción (otra persona escribió). */
function emit(list: Person[]) {
  act(() => h.emit!(list));
}

async function openPerson(id: string, name: string) {
  window.history.replaceState(null, "", `/integrantes/consolidacion/persona?id=${id}`);
  render(
    <MembersProvider>
      <PersonScreen />
    </MembersProvider>,
  );
  await screen.findByRole("heading", { level: 2, name });
}

async function openFollowUp() {
  await openPerson("p1", "Ana Torres");
  // Responsables cargados (el select se habilita).
  await waitFor(() => expect(screen.getByRole("button", { name: /Cambiar responsable de Ana/ })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /Registrar seguimiento de Ana Torres/ }));
  return screen.getByRole("dialog", { name: /Registrar seguimiento/ });
}

beforeEach(() => {
  h.user = MANAGER;
  h.persons = people();
  h.emit = null;
  h.history = { visits: [], followUps: [], changes: [], loading: false, error: null };
  h.events = [];
  h.toast.mockReset();
  h.updatePerson.mockReset();
  h.changeStatus.mockReset();
  h.createVisit.mockReset();
  h.createFollowUp.mockReset();
  h.fetchPerson.mockReset().mockResolvedValue(null);
  h.fetchOwnerOptions.mockReset().mockResolvedValue([
    { uid: "u-owner", displayName: "Carolina Vidal" },
    { uid: "u-two", displayName: "Diego Soto" },
  ]);
  window.history.replaceState(null, "", "/integrantes/consolidacion");
});

describe("F1 · sugerencias del seguimiento", () => {
  it("error de red: las casillas desmarcadas se conservan, quedan fijas y el reintento las respeta; replay → toast neutro", async () => {
    h.createFollowUp
      .mockRejectedValueOnce(new MembersApiError("", "network", MEMBERS_NETWORK_TEXT))
      .mockResolvedValueOnce({ followUpId: "f", replay: true, revision: 4, applied: { status: "sin_continuidad", doNotContact: false } });
    const dialog = await openFollowUp();
    fireEvent.click(within(dialog).getByRole("radio", { name: "No desea contacto" }));
    const dnc = within(dialog).getByRole("checkbox", { name: /Marcar No contactar/ });
    const close = within(dialog).getByRole("checkbox", { name: /Cerrar como Sin continuidad/ });
    expect(dnc).toBeChecked();
    expect(close).toBeChecked();
    fireEvent.click(dnc);
    expect(dnc).not.toBeChecked();
    expect(within(dialog).queryByText(LOCK_HELP)).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar seguimiento" }));
    expect(await within(dialog).findByText(MEMBERS_NETWORK_TEXT)).toBeInTheDocument();
    // Tras el intento: tal como estaban y bloqueadas (el reintento reutiliza el requestId).
    expect(dnc).not.toBeChecked();
    expect(close).toBeChecked();
    expect(dnc).toBeDisabled();
    expect(close).toBeDisabled();
    expect(within(dialog).getByText(LOCK_HELP)).toBeInTheDocument();
    expect(dnc).toHaveAttribute("aria-describedby", "mem-fu-suggest-lock");
    // N1: todo el formulario queda fijo (resultado, fecha, notas), no solo las casillas.
    expect(within(dialog).getByRole("radio", { name: "Contactado" })).toBeDisabled();
    expect(within(dialog).getByLabelText("Fecha del contacto")).toBeDisabled();
    expect(within(dialog).getByText(/Los datos quedaron fijos para reintentar/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar seguimiento" }));
    await waitFor(() => expect(h.createFollowUp).toHaveBeenCalledTimes(2));
    const [first, retry] = h.createFollowUp.mock.calls.map((c) => c[0]);
    expect(first).not.toHaveProperty("applyDoNotContact");
    expect(retry).not.toHaveProperty("applyDoNotContact");
    expect(retry).toMatchObject({ applyStatus: "sin_continuidad", result: "no_desea_contacto" });
    expect(retry.requestId).toBe(first.requestId);
    // replay: no se afirma ningún cambio de estado ni de No contactar.
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("Este seguimiento ya estaba guardado. Revisa el historial."));
  });

  it("suggestion-mismatch: vuelve a marcar, desbloquea y usa un requestId nuevo; el toast refleja `applied`", async () => {
    h.createFollowUp
      .mockRejectedValueOnce(
        new MembersApiError("members/suggestion-mismatch", "suggestion_mismatch", "La situación de esta persona cambió. Revisa la sugerencia y vuelve a guardar."),
      )
      .mockResolvedValueOnce({ followUpId: "f", replay: false, revision: 5, applied: { status: "sin_continuidad", doNotContact: true } });
    const dialog = await openFollowUp();
    fireEvent.click(within(dialog).getByRole("radio", { name: "No desea contacto" }));
    const dnc = within(dialog).getByRole("checkbox", { name: /Marcar No contactar/ });
    fireEvent.click(dnc);
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar seguimiento" }));
    expect(await within(dialog).findByText(/La situación de esta persona cambió/)).toBeInTheDocument();
    expect(dnc).toBeChecked();
    expect(dnc).toBeEnabled();
    expect(within(dialog).queryByText(LOCK_HELP)).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar seguimiento" }));
    await waitFor(() => expect(h.createFollowUp).toHaveBeenCalledTimes(2));
    const [first, second] = h.createFollowUp.mock.calls.map((c) => c[0]);
    expect(second.requestId).not.toBe(first.requestId);
    expect(second).toMatchObject({ applyDoNotContact: true, applyStatus: "sin_continuidad" });
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("Seguimiento registrado · estado: Sin continuidad · No contactar"));
  });

  it("otros errores (campos) no vuelven a marcar las casillas", async () => {
    h.createFollowUp.mockRejectedValueOnce(
      new MembersApiError("members/invalid-argument", "fields", "Revisa los datos marcados.", { nextActionDate: "Revisa la fecha." }),
    );
    const dialog = await openFollowUp();
    fireEvent.click(within(dialog).getByRole("radio", { name: "No desea contacto" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Cerrar como Sin continuidad/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar seguimiento" }));
    expect(await within(dialog).findByText("Revisa los datos marcados.")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /Cerrar como Sin continuidad/ })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Marcar No contactar/ })).toBeChecked();
  });

  it("sin `applied` en la respuesta, el toast no afirma un cambio de estado", async () => {
    h.createFollowUp.mockResolvedValueOnce({ followUpId: "f", replay: false, revision: 4, applied: null });
    const dialog = await openFollowUp();
    fireEvent.click(within(dialog).getByRole("radio", { name: "No desea contacto" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar seguimiento" }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("Seguimiento registrado"));
    expect(h.createFollowUp.mock.calls[0][0]).toMatchObject({ applyStatus: "sin_continuidad", applyDoNotContact: true });
  });
});

describe("F2 · Editar datos contra una base congelada", () => {
  async function openEdit() {
    await openPerson("p1", "Ana Torres");
    fireEvent.click(screen.getByRole("button", { name: /Editar datos/ }));
    return screen.getByRole("dialog", { name: /Editar datos/ });
  }

  it("si otra persona cambió el teléfono mientras se editaba el correo: conflicto y no se llama al callable", async () => {
    const dialog = await openEdit();
    fireEvent.change(within(dialog).getByLabelText("Correo"), { target: { value: "ana@example.com" } });
    emit(people({ phoneE164: "+56955559999", revision: 4 }));
    expect(within(dialog).getByText(MEMBERS_CONFLICT_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Recargar/ })).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Guardar cambios" });
    expect(save).toBeDisabled();
    // Ni siquiera un submit directo envía.
    fireEvent.submit(dialog.querySelector("form")!);
    await act(async () => {});
    expect(h.updatePerson).not.toHaveBeenCalled();
    // El formulario conserva lo que se escribió (base congelada), no el valor vivo.
    expect(within(dialog).getByLabelText("Teléfono *")).toHaveValue("+56 9 5555 0101");
  });

  it("una visita (solo sube la revisión) no es conflicto: envía solo el correo con la revisión vigente", async () => {
    h.updatePerson.mockResolvedValue({ replay: false, revision: 6 });
    const dialog = await openEdit();
    fireEvent.change(within(dialog).getByLabelText("Correo"), { target: { value: "ana@example.com" } });
    emit(people({ revision: 5, projection: { visitCount: 2, lastVisitDate: TODAY } }));
    expect(within(dialog).queryByText(MEMBERS_CONFLICT_TEXT)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(h.updatePerson).toHaveBeenCalledTimes(1));
    expect(h.updatePerson.mock.calls[0][0]).toEqual({ personId: "p1", expectedRevision: 5, email: "ana@example.com" });
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("Datos actualizados"));
  });
});

describe("F3 · intención congelada en No contactar / Asignar / Estado", () => {
  it("No contactar marcado en vivo por otra persona: conflicto, sin invertir la acción y sin llamada", async () => {
    await openPerson("p1", "Ana Torres");
    fireEvent.click(screen.getByRole("button", { name: /Marcar No contactar: Ana/ }));
    const dialog = screen.getByRole("dialog", { name: /Marcar No contactar/ });
    emit(people({ doNotContact: true, revision: 4 }));
    // El diálogo sigue diciendo «Marcar» (no pasa a «Quitar»).
    expect(screen.getByRole("dialog", { name: /Marcar No contactar · Ana Torres/ })).toBe(dialog);
    expect(within(dialog).queryByText(/Quitar No contactar/)).toBeNull();
    expect(within(dialog).getByText(MEMBERS_CONFLICT_TEXT)).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Marcar No contactar" });
    expect(submit).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    await act(async () => {});
    expect(h.updatePerson).not.toHaveBeenCalled();
  });

  it("Asignar: si el responsable cambia en vivo, conflicto y sin llamada", async () => {
    await openPerson("p1", "Ana Torres");
    await waitFor(() => expect(screen.getByRole("button", { name: /Cambiar responsable de Ana/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Cambiar responsable de Ana/ }));
    const dialog = screen.getByRole("dialog", { name: /Asignar responsable/ });
    fireEvent.change(within(dialog).getByLabelText("Responsable de seguimiento"), { target: { value: "u-two" } });
    emit(people({ followUpOwnerUid: "u-two", revision: 4 }));
    expect(within(dialog).getByText(MEMBERS_CONFLICT_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Guardar responsable" })).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    await act(async () => {});
    expect(h.updatePerson).not.toHaveBeenCalled();
  });

  it("Cambiar estado: si el estado cambia en vivo, conflicto y sin llamada", async () => {
    await openPerson("p1", "Ana Torres");
    fireEvent.click(screen.getByRole("button", { name: /Cambiar estado/ }));
    const dialog = screen.getByRole("dialog", { name: /Cambiar estado/ });
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Integrándose/ }));
    emit(people({ consolidationStatus: "integrandose", revision: 4 }));
    expect(within(dialog).getByText(MEMBERS_CONFLICT_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Guardar cambio" })).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    await act(async () => {});
    expect(h.changeStatus).not.toHaveBeenCalled();
  });

  it("sin cambios en vivo (solo sube la revisión), No contactar envía la revisión vigente", async () => {
    h.updatePerson.mockResolvedValue({ replay: false, revision: 5 });
    await openPerson("p1", "Ana Torres");
    fireEvent.click(screen.getByRole("button", { name: /Marcar No contactar: Ana/ }));
    const dialog = screen.getByRole("dialog", { name: /Marcar No contactar/ });
    emit(people({ revision: 4 }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Marcar No contactar" }));
    await waitFor(() => expect(h.updatePerson).toHaveBeenCalledWith({ personId: "p1", expectedRevision: 4, doNotContact: true }));
  });
});

describe("F4 · límites de lectura", () => {
  it("ficha fuera de la lista cargada: se lee el documento por id y se puede actuar", async () => {
    h.fetchPerson.mockResolvedValue(person({ id: "p99", fullName: "Lucía Fuera", phoneE164: "+56955550199" }));
    await openPerson("p99", "Lucía Fuera");
    expect(h.fetchPerson).toHaveBeenCalledWith("p99");
    expect(screen.queryByText("No encontramos esta persona.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Registrar visita a Lucía Fuera/ }));
    expect(screen.getByRole("dialog", { name: /Registrar visita · Lucía Fuera/ })).toBeInTheDocument();
  });

  it("si la lectura puntual falla: error con reintento (no «No encontramos»)", async () => {
    h.fetchPerson.mockRejectedValueOnce("network").mockResolvedValueOnce(person({ id: "p99", fullName: "Lucía Fuera" }));
    window.history.replaceState(null, "", "/integrantes/consolidacion/persona?id=p99");
    render(
      <MembersProvider>
        <PersonScreen />
      </MembersProvider>,
    );
    expect(await screen.findByText("No pudimos cargar esta persona")).toBeInTheDocument();
    expect(screen.queryByText("No encontramos esta persona.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Lucía Fuera" })).toBeInTheDocument();
  });

  function many(n: number): Person[] {
    return Array.from({ length: n }, (_, i) =>
      person({ id: `x${i}`, fullName: `Persona ${i}`, phoneE164: `+569555${String(i).padStart(5, "0")}`, entryDate: "2026-09-01" }),
    );
  }

  it(`con exactamente ${PEOPLE_LIMIT} personas: aviso en Personas y en Inicio`, async () => {
    h.persons = many(PEOPLE_LIMIT);
    // Un filtro sin resultados evita renderizar mil filas.
    window.history.replaceState(null, "", "/integrantes/consolidacion/personas?alerta=vencido");
    const { unmount } = render(
      <MembersProvider>
        <PeopleScreen />
      </MembersProvider>,
    );
    expect(await screen.findByText("Mostrando las 1.000 personas más recientes.")).toBeInTheDocument();
    unmount();
    render(
      <MembersProvider>
        <ConsolidationDashboardScreen />
      </MembersProvider>,
    );
    expect(await screen.findByText("Mostrando las 1.000 personas más recientes.")).toBeInTheDocument();
  });

  it("bajo el límite no hay aviso", async () => {
    h.persons = many(PEOPLE_LIMIT - 1);
    window.history.replaceState(null, "", "/integrantes/consolidacion/personas?alerta=vencido");
    render(
      <MembersProvider>
        <PeopleScreen />
      </MembersProvider>,
    );
    await screen.findByText("Ninguna persona coincide con estos filtros.");
    expect(screen.queryByText("Mostrando las 1.000 personas más recientes.")).toBeNull();
  });

  it("historial con 200 registros en una colección: aviso de registros más recientes", async () => {
    h.history = {
      ...h.history,
      visits: Array.from({ length: 200 }, (_, i) => visit({ id: `v${i}`, createdAt: `2026-09-01T10:00` })),
    };
    await openPerson("p1", "Ana Torres");
    expect(screen.getByText("Mostrando los 200 registros más recientes.")).toBeInTheDocument();
  });

  it("historial bajo el límite: sin aviso", async () => {
    h.history = { ...h.history, visits: [visit({ id: "v1" })] };
    await openPerson("p1", "Ana Torres");
    expect(screen.queryByText(/registros más recientes/)).toBeNull();
  });
});

describe("F6 · actividad que deja de estar disponible", () => {
  const EVENT = {
    id: "ev1",
    title: "Culto dominical",
    startDate: TODAY,
    endDate: TODAY,
    allDay: false,
    startTime: "11:00",
    endTime: "13:00",
    status: "scheduled",
    recurrence: { freq: "none" },
    exceptions: [],
  };

  it("con «Sin actividad» a la vista no se envía calendarEventId", async () => {
    h.user = MANAGER_CAL;
    h.events = [EVENT];
    h.createVisit.mockResolvedValue({ visitId: "v", replay: false, suggestReopen: false, revision: 4 });
    await openPerson("p1", "Ana Torres");
    fireEvent.click(screen.getByRole("button", { name: /Registrar visita a Ana/ }));
    const dialog = screen.getByRole("dialog", { name: /Registrar visita/ });
    const select = within(dialog).getByLabelText("Actividad o servicio (opcional)");
    fireEvent.change(select, { target: { value: "ev1" } });
    expect(select).toHaveValue("ev1");
    // La actividad se cancela/desaparece con el formulario abierto.
    h.events = [];
    fireEvent.change(within(dialog).getByLabelText("Observación (opcional)"), { target: { value: "Vino con su hermana" } });
    await waitFor(() => expect(select).toHaveValue(""));
    // Si la actividad vuelve a aparecer, no queda elegida sola.
    h.events = [EVENT];
    fireEvent.change(within(dialog).getByLabelText("Observación (opcional)"), { target: { value: "Vino con su hermana." } });
    expect(select).toHaveValue("");
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar visita" }));
    await waitFor(() => expect(h.createVisit).toHaveBeenCalledTimes(1));
    expect(h.createVisit.mock.calls[0][0]).not.toHaveProperty("calendarEventId");
  });
});

describe("F9 / F10 · responsable y próxima acción del seguimiento", () => {
  it("sin opción «Sin responsable»; el responsable actual viene elegido y se envía", async () => {
    h.createFollowUp.mockResolvedValue({ followUpId: "f", replay: false, revision: 4, applied: null });
    const dialog = await openFollowUp();
    const owner = within(dialog).getByLabelText("Responsable de la próxima acción");
    expect(owner).toHaveValue("u-owner");
    expect(within(owner).queryByRole("option", { name: "Sin responsable" })).toBeNull();
    expect(within(owner).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["u-owner", "u-two"]);
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sin respuesta" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar seguimiento" }));
    await waitFor(() => expect(h.createFollowUp.mock.calls[0][0]).toMatchObject({ ownerUid: "u-owner" }));
  });

  it("persona sin responsable: «Elige un responsable» y, si no se elige, no se envía ownerUid (nunca null)", async () => {
    h.persons = people({ followUpOwnerUid: null });
    h.createFollowUp.mockResolvedValue({ followUpId: "f", replay: false, revision: 4, applied: null });
    await openPerson("p1", "Ana Torres");
    await waitFor(() => expect(screen.getByRole("button", { name: /Asignar responsable de Ana/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Registrar seguimiento de Ana Torres/ }));
    const dialog = screen.getByRole("dialog", { name: /Registrar seguimiento/ });
    const owner = within(dialog).getByLabelText("Responsable de la próxima acción");
    expect(within(owner).getByRole("option", { name: "Elige un responsable" })).toBeInTheDocument();
    expect(within(owner).queryByRole("option", { name: "Sin responsable" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sin respuesta" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar seguimiento" }));
    await waitFor(() => expect(h.createFollowUp).toHaveBeenCalledTimes(1));
    expect(h.createFollowUp.mock.calls[0][0]).not.toHaveProperty("ownerUid");
  });

  it("si la lista de responsables no cargó, no se envía ownerUid", async () => {
    h.fetchOwnerOptions.mockReset().mockRejectedValue(new Error("unavailable"));
    h.createFollowUp.mockResolvedValue({ followUpId: "f", replay: false, revision: 4, applied: null });
    await openPerson("p1", "Ana Torres");
    fireEvent.click(screen.getByRole("button", { name: /Registrar seguimiento de Ana Torres/ }));
    const dialog = screen.getByRole("dialog", { name: /Registrar seguimiento/ });
    await waitFor(() => expect(within(dialog).getByText(/No pudimos cargar los responsables/)).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sin respuesta" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar seguimiento" }));
    await waitFor(() => expect(h.createFollowUp).toHaveBeenCalledTimes(1));
    expect(h.createFollowUp.mock.calls[0][0]).not.toHaveProperty("ownerUid");
  });

  it("«Próxima acción» muestra un contador n/120", async () => {
    const dialog = await openFollowUp();
    const input = within(dialog).getByLabelText("Próxima acción");
    expect(input).toHaveAttribute("maxLength", "120");
    expect(within(dialog).getByText("0/120")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Llamar de nuevo" }));
    expect(within(dialog).getByText("15/120")).toBeInTheDocument();
  });
});
