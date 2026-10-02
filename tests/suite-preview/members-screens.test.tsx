import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/preview/integrantes/consolidacion", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

import { AccessGate } from "@/components/suite-preview/access-gate";
import { AttentionScreen } from "@/components/suite-preview/members/attention";
import { ConsolidationDashboardScreen } from "@/components/suite-preview/members/dashboard";
import { PeopleScreen } from "@/components/suite-preview/members/people";
import { PersonScreen } from "@/components/suite-preview/members/person";
import { NewPersonScreen } from "@/components/suite-preview/members/person-form";
import { MembersSettingsScreen } from "@/components/suite-preview/members/settings";
import { arrivalOccurrences } from "@/components/suite-preview/members/model";
import { SuiteProvider, useSuite } from "@/components/suite-preview/provider";
import { SuiteShell } from "@/components/suite-preview/shell";
import { visibleModules } from "@/lib/suite-preview/access";
import { DEMO_NOW } from "@/lib/suite-preview/clock";
import { attentionQueue, computeAlerts } from "@/lib/suite-preview/consolidation";
import { USERS } from "@/lib/suite-preview/fixtures";
import { guardRoute } from "@/lib/suite-preview/routes";
import { initialSuiteState } from "@/lib/suite-preview/store";
import type { AccessProfile } from "@/lib/suite-preview/types";

const C = "/preview/integrantes/consolidacion";

function at(path: string) {
  const [pathname] = path.split("?");
  nav.pathname = pathname;
  window.history.replaceState(null, "", path);
}

const inSuite = (ui: React.ReactNode) => render(<SuiteProvider>{ui}</SuiteProvider>);

const table = () => document.querySelector(".sx-people-table") as HTMLElement;
const row = (id: string) => table().querySelector(`tr[data-person="${id}"]`) as HTMLElement;
const visitCount = (id: string) => within(row(id)).getByTestId("visit-count").textContent;

// jsdom no implementa showModal/close: polyfill mínimo solo para estos tests.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
  if (typeof proto.showModal !== "function")
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  if (typeof proto.close !== "function")
    proto.close = function (this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
});

beforeEach(() => {
  nav.replace.mockClear();
});

describe("Inicio de Consolidación", () => {
  it("tiene exactamente 3 indicadores con link a la lista filtrada", () => {
    at(`${C}?perfil=consolidacion`);
    inSuite(<ConsolidationDashboardScreen />);
    const tiles = document.querySelectorAll("[data-indicator]");
    expect(tiles).toHaveLength(3);
    expect([...tiles].map((t) => t.querySelector(".sx-tile-label")?.textContent)).toEqual([
      "Nuevos del mes",
      "Sin primer contacto",
      "Seguimientos vencidos",
    ]);
    expect(tiles[1].getAttribute("href")).toMatch(/\/personas\?alerta=sin_primer_contacto/);
    expect(tiles[2].getAttribute("href")).toMatch(/\/personas\?alerta=vencido/);
  });

  it("'Necesitan atención': una fila por persona, en el orden de prioridad, con CTA con verbo", () => {
    at(`${C}?perfil=consolidacion`);
    inSuite(<ConsolidationDashboardScreen />);
    const s = initialSuiteState();
    const expected = attentionQueue(computeAlerts(s, DEMO_NOW, s.settings)).map((r) => r.personId);
    const panel = screen.getByRole("region", { name: /Necesitan atención/ });
    const rows = [...panel.querySelectorAll(".sx-att-row")].map((r) => (r as HTMLElement).dataset.person);
    expect(rows).toEqual(expected.slice(0, 5));
    expect(new Set(rows).size).toBe(rows.length);
    const first = panel.querySelector(".sx-att-row") as HTMLElement;
    expect(within(first).getByRole("button", { name: /^Asignar/ })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /^Contactar/ })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /^Registrar seguimiento/ })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /^Agradecer/ })).toBeInTheDocument();
  });

  it("cumpleaños próximos muestra el caso 29-02", () => {
    at(`${C}?perfil=consolidacion`);
    inSuite(<ConsolidationDashboardScreen />);
    const bday = screen.getByRole("region", { name: /Cumpleaños próximos/ });
    expect(bday).toHaveTextContent("Isidora Paredes nació un 29 de febrero");
    expect(bday).toHaveTextContent("28 feb (nació el 29)");
  });

  it("Atención: grupos por tipo con conteo", () => {
    at(`${C}/atencion?perfil=consolidacion`);
    inSuite(<AttentionScreen />);
    expect(screen.getByRole("heading", { name: /Sin responsable \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Posibles duplicados \(\d+\)/ })).toBeInTheDocument();
  });
});

describe("visitas y seguimientos", () => {
  it("registrar una visita actualiza cantidad y última visita en lista y ficha, y conserva las visitas anteriores", () => {
    at(`${C}/persona?id=p-04&perfil=consolidacion`);
    inSuite(
      <>
        <PeopleScreen />
        <PersonScreen />
      </>,
    );
    expect(visitCount("p-04")).toBe("3");
    const visitsBefore = document.querySelectorAll('.sx-tl-item[data-kind="visit"]').length;
    expect(visitsBefore).toBe(3);

    // Desde el menú de fila de la tabla.
    fireEvent.click(within(row("p-04")).getByRole("button", { name: "Acciones para Javier Rojas" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Registrar visita" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar visita" }));

    expect(visitCount("p-04")).toBe("4");
    expect(within(row("p-04")).getByText("hoy")).toBeInTheDocument();
    expect(screen.getByText(/Ingresó el dom 13 sep 2026 · 4 visitas/)).toBeInTheDocument();
    const visits = document.querySelectorAll('.sx-tl-item[data-kind="visit"]');
    expect(visits).toHaveLength(4);
    expect(visits[0].className).toMatch(/sx-flash/);
    expect(document.querySelector(".sx-tl-item.is-first")).toHaveTextContent("Primera visita");
    expect(screen.getByText("Visita registrada. Simulación: no se guardó nada.")).toBeInTheDocument();
  });

  it("el seguimiento propone 'Cambiar a En seguimiento' ya marcado; si se desmarca, el estado no cambia", () => {
    at(`${C}/persona?id=p-02&perfil=consolidacion`);
    inSuite(<PersonScreen />);
    const header = document.querySelector(".sx-ph") as HTMLElement;
    expect(within(header).getByText("Por contactar")).toBeInTheDocument();
    fireEvent.click(within(header).getByRole("button", { name: /Registrar seguimiento/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Contactado" }));
    const suggestion = screen.getByRole("checkbox", { name: /Cambiar estado a En seguimiento/ });
    expect(suggestion).toBeChecked();
    fireEvent.click(suggestion);
    expect(suggestion).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Guardar seguimiento" }));
    expect(within(header).getByText("Por contactar")).toBeInTheDocument();
    expect(screen.getByText("Seguimiento registrado. Simulación: no se guardó nada.")).toBeInTheDocument();
  });

  it("'No desea contacto' propone No contactar y Sin continuidad, ambos marcados", () => {
    at(`${C}/persona?id=p-02&perfil=consolidacion`);
    inSuite(<PersonScreen />);
    fireEvent.click(within(document.querySelector(".sx-ph") as HTMLElement).getByRole("button", { name: /Registrar seguimiento/ }));
    fireEvent.click(screen.getByRole("radio", { name: "No desea contacto" }));
    expect(screen.getByRole("checkbox", { name: /Marcar No contactar/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Cerrar como Sin continuidad/ })).toBeChecked();
  });
});

describe("Nueva persona", () => {
  it("tri-estado por defecto 'Sin información' y aviso de duplicado con 3 opciones que no bloquea", () => {
    at(`${C}/nueva?perfil=consolidacion`);
    inSuite(<NewPersonScreen />);
    const unknown = screen.getAllByRole("radio", { name: "Sin información" });
    expect(unknown).toHaveLength(2);
    for (const r of unknown) expect(r).toBeChecked();
    expect(screen.getByText(/Fecha de ingreso:/).parentElement).toHaveTextContent("domingo 4 de octubre de 2026");

    fireEvent.change(screen.getByLabelText("Nombre completo *"), { target: { value: "Lucía Fuentes" } });
    const phone = screen.getByLabelText("Teléfono *");
    fireEvent.change(phone, { target: { value: "9 5555 0110" } });
    expect(screen.getByText("Se guardará como +56 9 5555 0110")).toBeInTheDocument();
    fireEvent.blur(phone);

    const notice = screen.getByTestId("duplicate-notice");
    expect(within(notice).getAllByRole("link", { name: "Ver ficha existente" }).length).toBeGreaterThan(0);
    expect(within(notice).getByRole("button", { name: "Registrar visita a Carmen" })).toBeInTheDocument();
    expect(within(notice).getByRole("button", { name: "Es otra persona, continuar" })).toBeInTheDocument();

    const save = screen.getByRole("button", { name: "Guardar persona" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(screen.getByText("Persona registrada. Simulación: no se guardó nada.")).toBeInTheDocument();
  });

  it("teléfono inválido muestra ayuda al salir del campo", () => {
    at(`${C}/nueva?perfil=consolidacion`);
    inSuite(<NewPersonScreen />);
    const phone = screen.getByLabelText("Teléfono *");
    fireEvent.change(phone, { target: { value: "12345" } });
    fireEvent.blur(phone);
    expect(screen.getByRole("alert")).toHaveTextContent("Revisa el número");
  });
});

describe("WhatsApp y No contactar", () => {
  it("ninguna pantalla enlaza a wa.me; el botón simula y muestra el número", () => {
    const screens: [string, React.ReactNode][] = [
      [C, <ConsolidationDashboardScreen key="d" />],
      [`${C}/atencion`, <AttentionScreen key="a" />],
      [`${C}/personas`, <PeopleScreen key="p" />],
      [`${C}/persona?id=p-04`, <PersonScreen key="f" />],
      [`${C}/nueva`, <NewPersonScreen key="n" />],
      [`${C}/ajustes`, <MembersSettingsScreen key="s" />],
    ];
    for (const [path, ui] of screens) {
      at(`${path}${path.includes("?") ? "&" : "?"}perfil=consolidacion`);
      const { container, unmount } = inSuite(ui);
      expect(container.querySelector('a[href^="https://wa.me"]'), path).toBeNull();
      expect(document.querySelector('a[href*="wa.me"]'), path).toBeNull();
      unmount();
    }
    at(`${C}/persona?id=p-04&perfil=consolidacion`);
    inSuite(<PersonScreen />);
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
    expect(screen.getByText("Simulación: se abriría WhatsApp con +56 9 5555 0104.")).toBeInTheDocument();
  });

  it("con No contactar no hay WhatsApp ni en la ficha ni en las acciones de la lista", () => {
    at(`${C}/persona?id=p-15&perfil=consolidacion`);
    const { unmount } = inSuite(<PersonScreen />);
    expect(screen.getByText(/Pidió no recibir contacto/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /WhatsApp/ })).toBeNull();
    unmount();

    at(`${C}/personas?perfil=consolidacion&etapa=todas`);
    inSuite(<PeopleScreen />);
    fireEvent.click(within(row("p-15")).getByRole("button", { name: "Acciones para Andrés Gutiérrez" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /WhatsApp/ })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Ver ficha" })).toBeInTheDocument();
    const mobile = document.querySelector('.sx-plist [data-person="p-15"]') as HTMLElement;
    fireEvent.click(within(mobile).getByRole("button", { name: "Acciones para Andrés Gutiérrez" }));
    const sheet = screen.getByRole("heading", { name: "Acciones para Andrés Gutiérrez" }).closest("dialog") as HTMLElement;
    expect(within(sheet).queryByRole("button", { name: /WhatsApp/ })).toBeNull();
  });
});

describe("Ficha", () => {
  it("edad '—' sin fecha, tri-estado 'Sin información' visible e id desconocido con salida", () => {
    at(`${C}/persona?id=p-16&perfil=consolidacion`);
    const { unmount } = inSuite(<PersonScreen />);
    expect(screen.getByText(/Edad desconocida/, { selector: ".sx-dl *" })).toBeInTheDocument();
    expect(screen.getAllByText("Sin información").length).toBeGreaterThanOrEqual(2);
    unmount();
    at(`${C}/persona?id=nadie&perfil=consolidacion`);
    inSuite(<PersonScreen />);
    expect(screen.getByText("No encontramos esta persona.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Personas" })).toHaveAttribute("href", expect.stringContaining("/personas"));
  });

  it("Integrado: franja de solo lectura sin visita ni seguimiento", () => {
    at(`${C}/persona?id=p-14&perfil=consolidacion`);
    inSuite(<PersonScreen />);
    expect(screen.getByText(/es integrante desde el 20-09-2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registrar visita/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cambiar estado/ })).toBeNull();
  });

  it("Sin continuidad: el diálogo de estado exige motivo", () => {
    at(`${C}/persona?id=p-03&perfil=consolidacion`);
    inSuite(<PersonScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Cambiar estado/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Sin continuidad/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambio" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Elige el motivo de Sin continuidad.");
  });
});

describe("privacidad: solo calendar.read no ve Integrantes", () => {
  it("la guardia redirige y no hay navegación de Integrantes", () => {
    const onlyCalendar: AccessProfile = { ...USERS.find((u) => u.uid === "finanzas")!, permissions: ["calendar.read"] };
    expect(visibleModules(onlyCalendar)).not.toContain("integrantes");
    const decision = guardRoute(onlyCalendar, `${C}/personas`);
    expect(decision.type).toBe("redirect");
    if (decision.type === "redirect") expect(decision.to).not.toMatch(/integrantes/);

    at(`${C}/personas?perfil=finanzas`);
    render(
      <SuiteProvider>
        <AccessGate>
          <SuiteShell>
            <PeopleScreen />
          </SuiteShell>
        </AccessGate>
      </SuiteProvider>,
    );
    expect(document.querySelector(".sx-people-table")).toBeNull();
    expect(screen.queryByText("Javier Rojas")).toBeNull();
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace.mock.calls[0][0]).not.toMatch(/integrantes/);
  });
});

// ---------- Ciclo 1 de correcciones (M1–M7) ----------

/** Nombre accesible aproximado: aria-label o texto visible para lectores (sin aria-hidden). */
function accessibleText(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
    if (n instanceof Element && n.getAttribute("aria-hidden") === "true") return "";
    return [...n.childNodes].map(walk).join("");
  };
  return walk(el).trim();
}

describe("accesibilidad: botones con nombre aunque el texto largo se oculte en móvil (M1)", () => {
  it("Visita/Seguimiento de la ficha y filtros del historial tienen nombre completo", () => {
    at(`${C}/persona?id=p-04&perfil=consolidacion`);
    inSuite(<PersonScreen />);
    const header = document.querySelector(".sx-ph") as HTMLElement;
    expect(within(header).getByRole("button", { name: "Registrar visita a Javier Rojas" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Registrar seguimiento de Javier Rojas" })).toBeInTheDocument();
    const filters = screen.getByRole("group", { name: "Filtrar historial" });
    expect(within(filters).getAllByRole("button").map((b) => accessibleText(b))).toEqual(["Todo", "Visitas", "Seguimientos", "Cambios"]);
    expect(within(filters).getByRole("button", { name: "Seguimientos" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Cambiar responsable de Javier Rojas" })).toBeInTheDocument();
  });

  it("ningún botón ni link de Consolidación queda sin nombre accesible", () => {
    const screens: [string, React.ReactNode][] = [
      [C, <ConsolidationDashboardScreen key="d" />],
      [`${C}/atencion`, <AttentionScreen key="a" />],
      [`${C}/personas`, <PeopleScreen key="p" />],
      [`${C}/persona?id=p-04`, <PersonScreen key="f" />],
      [`${C}/nueva`, <NewPersonScreen key="n" />],
      [`${C}/ajustes`, <MembersSettingsScreen key="s" />],
    ];
    for (const [path, ui] of screens) {
      at(`${path}${path.includes("?") ? "&" : "?"}perfil=consolidacion`);
      const { container, unmount } = inSuite(ui);
      const unnamed = [...container.querySelectorAll("button, a[href]")].filter((el) => !accessibleText(el));
      expect(unnamed.map((el) => el.outerHTML.slice(0, 120)), path).toEqual([]);
      unmount();
    }
  });
});

describe("Personas: alertas con texto y responsable sin acceso explícito (M2)", () => {
  it("la línea 2 muestra la alerta principal con texto y +n; la columna dice «Responsable sin acceso»", () => {
    at(`${C}/personas?perfil=consolidacion`);
    inSuite(<PeopleScreen />);
    const sofia = row("p-01");
    expect(within(sofia).getByText("Sin responsable", { selector: ".sx-alert-sum-text" })).toBeInTheDocument();
    const fernanda = row("p-07");
    expect(fernanda.querySelector(".sx-alert-sum")).toHaveTextContent(/Sin responsable\s*\+1/);
    expect(within(fernanda).getByText(/Además:/)).toBeInTheDocument();
    expect(fernanda.querySelector(".c-owner")).toHaveTextContent("Responsable sin acceso");
    const valentina = row("p-05");
    expect(valentina.querySelector(".sx-alert-sum-text")?.textContent).toMatch(/^\d+ días sin volver$/);
  });
});

describe("fechas legibles en formularios de Consolidación (M4)", () => {
  it("visita y seguimiento: input con lang es-CL y eco legible debajo", () => {
    at(`${C}/persona?id=p-04&perfil=consolidacion`);
    inSuite(<PersonScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar visita a Javier Rojas" }));
    const visitDate = screen.getByLabelText("Fecha", { selector: "#sx-visit-date" });
    expect(visitDate).toHaveAttribute("lang", "es-CL");
    expect(visitDate).toHaveAccessibleDescription("domingo 4 de octubre de 2026");
    fireEvent.change(visitDate, { target: { value: "2026-10-03" } });
    expect(visitDate).toHaveAccessibleDescription("sábado 3 de octubre de 2026");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("button", { name: "Registrar seguimiento de Javier Rojas" }));
    const fuDate = screen.getByLabelText("Fecha", { selector: "#sx-fu-date" });
    expect(fuDate).toHaveAttribute("lang", "es-CL");
    expect(fuDate).toHaveAccessibleDescription("domingo 4 de octubre de 2026");
    const next = screen.getByLabelText("Fecha de la próxima acción");
    expect(next).toHaveAttribute("lang", "es-CL");
    fireEvent.change(next, { target: { value: "2026-10-11" } });
    expect(next).toHaveAccessibleDescription("domingo 11 de octubre de 2026");
  });

  it("nueva persona: el nacimiento muestra la fecha legible junto a la edad", () => {
    at(`${C}/nueva?perfil=consolidacion`);
    inSuite(<NewPersonScreen />);
    const birth = screen.getByLabelText("Fecha de nacimiento");
    expect(birth).toHaveAttribute("lang", "es-CL");
    fireEvent.change(birth, { target: { value: "1992-01-15" } });
    expect(birth).toHaveAccessibleDescription("15 de enero de 1992 · tiene 34 años");
  });
});

describe("privacidad: «Llegó a» sin calendar.read solo ofrece actividades públicas (M7)", () => {
  it("helper: las actividades solo para el equipo se omiten sin calendar.read", () => {
    const s = initialSuiteState();
    const all = arrivalOccurrences(s.events, "2026-10-03", DEMO_NOW, true).map((o) => o.event.title);
    const pub = arrivalOccurrences(s.events, "2026-10-03", DEMO_NOW, false).map((o) => o.event.title);
    expect(all).toContain("Ensayo de alabanza");
    expect(pub).not.toContain("Ensayo de alabanza");
    expect(pub).toContain("Ayuno congregacional");
    for (const o of arrivalOccurrences(s.events, "2026-10-04", DEMO_NOW, false)) expect(o.event.visibility).toBe("public");
  });

  function RevokeCalendar() {
    const suite = useSuite();
    return (
      <button
        type="button"
        onClick={() => {
          const u = suite.state.users.find((x) => x.uid === "consolidacion")!;
          suite.dispatch({ type: "user/update", profile: { ...u, permissions: ["members.consolidation.manage"] } });
          suite.switchProfile("consolidacion");
        }}
      >
        Quitar calendario a Consolidación
      </button>
    );
  }

  const visitOptions = () =>
    [...(screen.getByLabelText("Actividad o servicio") as HTMLSelectElement).options].map((o) => o.textContent ?? "");

  it("pantalla: con calendar.read se ve la actividad de equipo; sin él, no", () => {
    at(`${C}/persona?id=p-04&perfil=consolidacion`);
    const { unmount } = inSuite(<PersonScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar visita a Javier Rojas" }));
    fireEvent.change(screen.getByLabelText("Fecha", { selector: "#sx-visit-date" }), { target: { value: "2026-10-03" } });
    expect(visitOptions().some((t) => t.startsWith("Ensayo de alabanza"))).toBe(true);
    unmount();

    at(`${C}/persona?id=p-04&perfil=admin`);
    inSuite(
      <>
        <RevokeCalendar />
        <PersonScreen />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Quitar calendario a Consolidación" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar visita a Javier Rojas" }));
    fireEvent.change(screen.getByLabelText("Fecha", { selector: "#sx-visit-date" }), { target: { value: "2026-10-03" } });
    const opts = visitOptions();
    expect(opts.some((t) => t.startsWith("Ayuno congregacional"))).toBe(true);
    expect(opts.some((t) => t.startsWith("Ensayo de alabanza"))).toBe(false);
  });
});
