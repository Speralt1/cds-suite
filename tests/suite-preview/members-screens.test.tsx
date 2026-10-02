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
import { SuiteProvider } from "@/components/suite-preview/provider";
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
