import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/preview/calendario", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

import { CalendarScreen } from "@/components/suite-preview/calendar/calendar-screen";
import { MyActivitiesScreen } from "@/components/suite-preview/calendar/my-activities";
import { ShareScreen } from "@/components/suite-preview/calendar/share-screen";
import { CalendarReport } from "@/components/suite-preview/reports/calendar-report";
import { SuiteProvider } from "@/components/suite-preview/provider";
import { LEAK_CANARIES } from "@/lib/suite-preview/fixtures";
import { FinanceReport } from "@/components/suite-preview/reports/finance-report";
import { PreviewProvider } from "@/components/finance-preview/context";
import { ReportesScreen } from "@/components/finance-preview/screens/analisis";
import { segmentsFor, WeekGrid } from "@/components/suite-preview/calendar/week-view";
import { areaOptions } from "@/components/suite-preview/calendar/calendar-screen";
import { AREAS, DEMO_NOW, EVENTS } from "@/lib/suite-preview/fixtures";
import { occurrencesInRange } from "@/lib/suite-preview/calendar";
import { expandRecurrence } from "@/lib/suite-preview/recurrence";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function at(path: string) {
  const [pathname] = path.split("?");
  nav.pathname = pathname;
  window.history.replaceState(null, "", path);
}

// jsdom no implementa showModal/close de <dialog>: polyfill mínimo con el evento "close".
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void; close?: () => void };
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

const renderCal = (query: string) => {
  at(`/preview/calendario?${query}`);
  return render(
    <SuiteProvider>
      <CalendarScreen />
    </SuiteProvider>,
  );
};

const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".sx-agenda .sx-agenda-row")];
const rowByLabel = (re: RegExp) => {
  const r = rows().find((b) => re.test(b.getAttribute("aria-label") ?? ""));
  if (!r) throw new Error(`No hay fila ${re}`);
  return r;
};
const openDialog = () => {
  const list = [...document.querySelectorAll<HTMLDialogElement>("dialog")].filter((d) => d.open || d.hasAttribute("open"));
  const d = list.find((x) => x.querySelector(".fx-sheet-head"));
  if (!d) throw new Error("No hay diálogo abierto");
  return d;
};

describe("Calendario › formulario", () => {
  it("Líder: el formulario ofrece solo su área activa y el color se hereda (no se elige)", () => {
    renderCal("perfil=lider&vista=agenda");
    fireEvent.click(screen.getByRole("button", { name: "Crear actividad" }));
    const form = document.getElementById("sx-event-form")!;
    expect(form).not.toBeNull();
    expect(within(form).getByText("Es tu única área asignada.")).toBeInTheDocument();
    expect(form.querySelector(".sx-fixed-area")?.textContent).toContain("Jóvenes");
    // Sin selector de color: la vista previa no es un control.
    expect(within(form).getByText("Lo define el área responsable.")).toBeInTheDocument();
    expect(form.querySelector('input[type="color"]')).toBeNull();
    expect(form.querySelector(".sx-color-preview button, .sx-color-preview input, .sx-color-preview select")).toBeNull();
    expect(within(form).queryByLabelText(/^Color/)).toBeNull();
  });

  it("Diácono: el select de responsable lista solo Varones y Multimedia (sus áreas)", () => {
    renderCal("perfil=diacono&vista=agenda");
    fireEvent.click(screen.getByRole("button", { name: "Crear actividad" }));
    const select = within(document.getElementById("sx-event-form")!).getByLabelText("Área responsable *") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Varones", "Multimedia"]);
  });

  it("Finanzas (solo lectura) no ve 'Crear actividad'", () => {
    renderCal("perfil=finanzas&vista=agenda");
    expect(screen.queryByRole("button", { name: "Crear actividad" })).toBeNull();
  });

  it("?crear=1 abre el formulario", () => {
    renderCal("perfil=lider&vista=agenda&crear=1");
    expect(document.getElementById("sx-event-form")).not.toBeNull();
  });

  it("recurrencia: etiquetas calculadas y opciones futuras con Propuesta", () => {
    renderCal("perfil=lider&vista=agenda");
    fireEvent.click(screen.getByRole("button", { name: "Crear actividad" }));
    const form = document.getElementById("sx-event-form")!;
    fireEvent.change(within(form).getByLabelText("Fecha *"), { target: { value: "2026-11-28" } });
    const repeat = within(form).getByLabelText("Repetir") as HTMLSelectElement;
    expect([...repeat.options].map((o) => o.textContent)).toEqual([
      "No se repite",
      "Cada semana, los sábados",
      "Cada 2 semanas, los sábados",
      "Cada mes, el cuarto sábado",
      "Cada mes, el último sábado",
    ]);
    fireEvent.change(repeat, { target: { value: "weekly" } });
    expect(within(form).getByLabelText("Hasta *")).toBeInTheDocument();
    expect(form.textContent).toMatch(/Se repetirá \d+ veces: del 28 nov al/);
    expect(within(form).getByText("Más opciones de repetición")).toBeInTheDocument();
    expect(within(form).getByText(/El mismo día de cada mes/).closest("label")?.querySelector("input")).toBeDisabled();
  });

  it("crear → aparece en la agenda y muestra el toast de simulación", () => {
    renderCal("perfil=lider&vista=agenda");
    fireEvent.click(screen.getByRole("button", { name: "Crear actividad" }));
    const form = document.getElementById("sx-event-form")!;
    // Sin título: error inline con role="alert".
    act(() => {
      fireEvent.submit(form);
    });
    expect(within(form).getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/nombre de la actividad/);
    fireEvent.change(within(form).getByLabelText("Título *"), { target: { value: "Noche de juegos" } });
    fireEvent.change(within(form).getByLabelText("Fecha *"), { target: { value: "2026-10-06" } });
    act(() => {
      fireEvent.submit(form);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Actividad creada. Simulación: no se guardó nada.");
    const row = rowByLabel(/^Noche de juegos, martes 6 de octubre, 19:00 a 21:00, Jóvenes, solo equipo/);
    expect(row).toBeInTheDocument();
  });
});

describe("Calendario › detalle, cancelar y eliminar", () => {
  it("cancelar una fecha de la serie exige motivo y la deja 'Cancelada'", () => {
    renderCal("perfil=lider&vista=agenda");
    fireEvent.click(rowByLabel(/^Reunión de jóvenes, viernes 9 de octubre/));
    let dlg = openDialog();
    expect(within(dlg).getByText("Jóvenes")).toBeInTheDocument();
    expect(within(dlg).getByText(/Se repite cada viernes hasta el 26 feb 2027/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Notas internas · solo equipo CDS|Descripción pública/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: /Cancelar actividad/ }));
    dlg = openDialog();
    expect(within(dlg).getByText("Solo esta fecha")).toBeInTheDocument();
    expect(within(dlg).getByText("Toda la serie desde hoy")).toBeInTheDocument();
    const form = document.getElementById("sx-cancel-form")!;
    act(() => {
      fireEvent.submit(form);
    });
    expect(within(form).getByRole("alert")).toHaveTextContent("Escribe un motivo");
    fireEvent.change(within(form).getByLabelText("Motivo (obligatorio)"), { target: { value: "Feriado" } });
    act(() => {
      fireEvent.submit(form);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Fecha cancelada. Simulación: no se guardó nada.");
    expect(rowByLabel(/^Reunión de jóvenes, viernes 9 de octubre/).getAttribute("aria-label")).toMatch(/cancelada$/);
    expect(rowByLabel(/^Reunión de jóvenes, viernes 9 de octubre/).closest("li")).toHaveClass("is-cancelled");
  });

  it("eliminar explica que se archiva, exige motivo y quita la actividad de las vistas", () => {
    renderCal("perfil=lider&vista=agenda");
    fireEvent.click(rowByLabel(/^Campamento de jóvenes/));
    fireEvent.click(within(openDialog()).getByRole("button", { name: /Eliminar/ }));
    const dlg = openDialog();
    expect(dlg.textContent).toMatch(/No se borra: queda guardada en el historial con el motivo/);
    const form = document.getElementById("sx-archive-form")!;
    act(() => {
      fireEvent.submit(form);
    });
    expect(within(form).getByRole("alert")).toHaveTextContent("Elige el motivo.");
    expect(rows().some((r) => /^Campamento de jóvenes/.test(r.getAttribute("aria-label") ?? ""))).toBe(true);
    fireEvent.change(within(form).getByLabelText("Motivo (obligatorio)"), { target: { value: "Duplicada" } });
    act(() => {
      fireEvent.submit(form);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Actividad eliminada. Simulación: no se guardó nada.");
    expect(rows().some((r) => /^Campamento de jóvenes/.test(r.getAttribute("aria-label") ?? ""))).toBe(false);
  });

  it("detalle de un área ajena: acciones deshabilitadas con explicación", () => {
    renderCal("perfil=lider&vista=agenda");
    fireEvent.click(rowByLabel(/^Culto dominical, domingo 11 de octubre/));
    const dlg = openDialog();
    for (const name of [/Editar/, /Cancelar actividad/, /Eliminar/]) {
      const b = within(dlg).getByRole("button", { name });
      expect(b).toHaveAttribute("aria-disabled", "true");
      expect(b.getAttribute("aria-describedby")).toBe("sx-detail-explain");
    }
    expect(document.getElementById("sx-detail-explain")).toHaveTextContent(
      "Solo el área responsable (Pastoral), Pastor o Administración pueden modificar esta actividad.",
    );
    // Las notas internas sí se ven dentro de la app (con su rótulo).
    expect(within(dlg).getByText(/Notas internas · solo equipo CDS/)).toBeInTheDocument();
  });

  it("si el área solo participa, la explicación lo dice", () => {
    renderCal("perfil=lider&vista=agenda");
    fireEvent.click(rowByLabel(/^Evangelismo en la plaza/));
    expect(document.getElementById("sx-detail-explain")).toHaveTextContent("Tu área participa en esta actividad, pero la organiza Consolidación.");
  });

  it("solo lectura pura (Finanzas): sin footer de acciones", () => {
    renderCal("perfil=finanzas&vista=agenda");
    fireEvent.click(rowByLabel(/^Reunión de jóvenes, viernes 9 de octubre/));
    expect(within(openDialog()).queryByRole("button", { name: /Editar/ })).toBeNull();
  });
});

describe("Calendario › filtro y vistas", () => {
  it("el filtro por área filtra la agenda (URL y popover)", () => {
    renderCal("perfil=lider&vista=agenda&areas=damas&solo=1");
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((r) => /Damas/.test(r.getAttribute("aria-label") ?? ""))).toBe(true);
    expect(screen.getByRole("button", { name: /Áreas: Damas/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtro de áreas" }));
    expect(rows().some((r) => /Pastoral/.test(r.getAttribute("aria-label") ?? ""))).toBe(true);
    // Popover: desmarcar Pastoral deja fuera sus actividades (y las que solo participa no cuentan si es "solo responsable").
    fireEvent.click(screen.getByRole("button", { name: /Áreas: Todas/ }));
    const pop = screen.getByRole("group", { name: "Filtrar por área" });
    expect(within(pop).getByText("Solo como responsable")).toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("checkbox", { name: /Pastoral/ }));
    expect(rows().some((r) => /, Pastoral, /.test(r.getAttribute("aria-label") ?? ""))).toBe(false);
  });

  it("mes: semana desde el lunes, hoy marcado y '+n más' con más de 2 chips (sin matchMedia = 1024–1279)", () => {
    renderCal("perfil=lider&vista=mes");
    const table = screen.getByRole("table", { name: "Octubre 2026" });
    expect([...table.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"]);
    expect(table.querySelector('[aria-current="date"]')).toHaveAccessibleName(/domingo 4 de octubre/);
    expect(within(table).getAllByText(/^\+\d+ más$/).length).toBeGreaterThan(0);
  });

  it("semana: la vigilia del 30-10 aparece en dos segmentos", () => {
    renderCal("perfil=lider&vista=semana&fecha=2026-10-30");
    const blocks = [...document.querySelectorAll(".sx-week-block")].map((b) => b.getAttribute("aria-label") ?? "");
    expect(blocks.filter((l) => l.startsWith("Vigilia"))).toEqual([
      expect.stringMatching(/continúa al día siguiente$/),
      expect.stringMatching(/continuación desde el día anterior$/),
    ]);
  });

  it("?estado=error muestra el error con Reintentar", () => {
    renderCal("perfil=lider&estado=error");
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar el calendario");
  });
});

describe("Mis actividades, Compartir y Reporte", () => {
  it("Mis actividades: Responsable editable vs Participa de solo lectura", () => {
    at("/preview/calendario/mis-actividades?perfil=lider");
    render(
      <SuiteProvider>
        <MyActivitiesScreen />
      </SuiteProvider>,
    );
    expect(screen.getAllByRole("button", { name: /^Acciones de Reunión de jóvenes/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /^Participa/ }));
    expect(screen.getByText("Tu área participa, pero la organiza otra área. Solo puedes verlas.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^Acciones de/ })).toHaveLength(0);
  });

  it("Compartir: nunca dice 'token'; regenerar pide confirmación", () => {
    at("/preview/calendario/compartir?perfil=admin");
    const { container } = render(
      <SuiteProvider>
        <ShareScreen />
      </SuiteProvider>,
    );
    expect(container.textContent?.toLowerCase()).not.toContain("token");
    expect(screen.getByText("Qué se publica")).toBeInTheDocument();
    expect(screen.getByText("Qué nunca se publica")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Regenerar enlace/ }));
    const dlg = openDialog();
    expect(dlg.textContent).toMatch(/dejará de funcionar de inmediato/);
    fireEvent.click(within(dlg).getByRole("button", { name: "Regenerar enlace" }));
    expect(screen.getByRole("status")).toHaveTextContent("Enlace regenerado. Simulación: no se guardó nada.");
    expect((screen.getByLabelText("Enlace público") as HTMLInputElement).value).toMatch(/compartir\/demo-k7p2$/);
  });

  it("Reporte: Líder ve 'Reportes · Calendario', sin notas internas ni motivos", () => {
    at("/preview/reportes/calendario?perfil=lider");
    const { container } = render(
      <SuiteProvider>
        <CalendarReport />
      </SuiteProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Reportes · Calendario");
    expect(screen.queryByRole("navigation", { name: "Secciones de Reportes" })).toBeNull();
    for (const c of Object.values(LEAK_CANARIES)) expect(container.innerHTML).not.toContain(c);
    expect(screen.getByText(/VISTA PREVIA · DATOS DE DEMOSTRACIÓN/)).toBeInTheDocument();
  });
});

describe("Calendario › correcciones ciclo 1", () => {
  it("C3: 'Cancelar actividad' queda aria-disabled hasta 3 caracteres; error role=alert al salir del campo", () => {
    renderCal("perfil=lider&vista=agenda");
    fireEvent.click(rowByLabel(/^Reunión de jóvenes, viernes 9 de octubre/));
    fireEvent.click(within(openDialog()).getByRole("button", { name: /Cancelar actividad/ }));
    const dlg = openDialog();
    const confirm = within(dlg).getByRole("button", { name: "Cancelar actividad" });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    const reason = within(dlg).getByLabelText("Motivo (obligatorio)");
    fireEvent.change(reason, { target: { value: "ab" } });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.blur(reason);
    expect(within(dlg).getByRole("alert")).toHaveTextContent("Escribe un motivo");
    fireEvent.change(reason, { target: { value: "  ab  " } });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(reason, { target: { value: "Feriado" } });
    expect(confirm).not.toHaveAttribute("aria-disabled");
    expect(within(dlg).queryByRole("alert")).toBeNull();
  });

  it("C3: 'Eliminar' queda aria-disabled hasta elegir motivo (y nota si es «Otro»)", () => {
    renderCal("perfil=lider&vista=agenda");
    fireEvent.click(rowByLabel(/^Campamento de jóvenes/));
    fireEvent.click(within(openDialog()).getByRole("button", { name: /Eliminar/ }));
    const dlg = openDialog();
    const confirm = within(dlg).getByRole("button", { name: "Eliminar" });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(within(dlg).getByLabelText("Motivo (obligatorio)"), { target: { value: "Otro" } });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(within(dlg).getByLabelText(/^Nota/), { target: { value: "Se movió a otra fecha" } });
    expect(confirm).not.toHaveAttribute("aria-disabled");
    fireEvent.change(within(dlg).getByLabelText("Motivo (obligatorio)"), { target: { value: "Duplicada" } });
    expect(confirm).not.toHaveAttribute("aria-disabled");
  });

  it("C4: fechas y horas con lang es-CL y eco legible", () => {
    renderCal("perfil=lider&vista=agenda");
    fireEvent.click(screen.getByRole("button", { name: "Crear actividad" }));
    const form = document.getElementById("sx-event-form")!;
    const date = within(form).getByLabelText("Fecha *");
    expect(date).toHaveAttribute("lang", "es-CL");
    expect(within(form).getByLabelText("Hora de inicio")).toHaveAttribute("lang", "es-CL");
    expect(within(form).getByLabelText("Hora de término")).toHaveAttribute("lang", "es-CL");
    expect(date).toHaveAccessibleDescription("domingo 4 de octubre de 2026");
    expect(within(form).getByText("19:00 – 21:00")).toBeInTheDocument();
    fireEvent.change(date, { target: { value: "2026-11-28" } });
    expect(within(form).getByText("sábado 28 de noviembre de 2026")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Repetir"), { target: { value: "weekly" } });
    const until = within(form).getByLabelText("Hasta *");
    expect(until).toHaveAttribute("lang", "es-CL");
    expect(until).toHaveAccessibleDescription(/de 2027$/);
  });

  it("C5: mismo orden dentro del día en Agenda y Mes (hora, luego nombre del área)", () => {
    renderCal("perfil=lider&vista=agenda");
    const sunday = rows()
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter((l) => /domingo 4 de octubre, 11:00/.test(l))
      .map((l) => l.split(",")[0]);
    // 11:00 Escuela dominical (Niños) antes que 11:00 Culto dominical (Pastoral).
    expect(sunday).toEqual(["Escuela dominical", "Culto dominical"]);
  });

  it("C2: el scroll de la semana no vuelve a las 07:00 en cada render", () => {
    renderCal("perfil=lider&vista=semana");
    const scroller = document.querySelector<HTMLElement>(".sx-week-scroll")!;
    expect(scroller.scrollTop).toBe(7 * 44 - 8);
    scroller.scrollTop = 900;
    // Re-render sin cambiar de semana (ocultar la leyenda).
    fireEvent.click(screen.getByRole("button", { name: /Ocultar leyenda/ }));
    expect(scroller.scrollTop).toBe(900);
  });

  it("C1: bloques de la semana sin guiones forzados; bloque corto sin línea de área", () => {
    renderCal("perfil=lider&vista=semana&fecha=2026-10-30");
    const blocks = [...document.querySelectorAll<HTMLElement>(".sx-week-block")];
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(b.style.width).toMatch(/calc\(/);
      const h = parseFloat(b.style.height);
      if (h < 52) expect(b.querySelector(".sx-week-block-area")).toBeNull();
    }
    const culto = blocks.find((b) => b.getAttribute("aria-label")?.startsWith("Culto dominical"))!;
    expect(culto.querySelector(".sx-week-block-end")).toHaveTextContent("–13:00");
  });

  it("C9: Compartir muestra un dominio neutro reservado, nunca el proyecto real", () => {
    at("/preview/calendario/compartir?perfil=admin");
    const { container } = render(
      <SuiteProvider>
        <ShareScreen />
      </SuiteProvider>,
    );
    expect((screen.getByLabelText("Enlace público") as HTMLInputElement).value).toBe("https://suite.casadesalvacion.example/calendario/compartir/demo");
    expect(container.innerHTML).not.toMatch(/web\.app|firebaseapp/);
  });
});

describe("Calendario y Reportes › correcciones ciclo 2", () => {
  const renderReport = (perfil: string) => {
    at(`/preview/reportes/calendario?perfil=${perfil}`);
    return render(
      <SuiteProvider>
        <CalendarReport />
      </SuiteProvider>,
    );
  };

  it("C1: Reportes › Finanzas usa el mismo segmented y 'Descargar PDF' (V2 standalone sigue con 'Exportar PDF')", () => {
    // Los gráficos de V2 miden su contenedor: stubs solo para esta prueba.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    try {
      financeReportChecks();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  function financeReportChecks() {
    at("/preview/reportes/finanzas?perfil=admin");
    const { unmount } = render(
      <PreviewProvider>
        <SuiteProvider>
          <FinanceReport />
        </SuiteProvider>
      </PreviewProvider>,
    );
    const sections = screen.getByRole("navigation", { name: "Secciones de Reportes" });
    expect(within(sections).getByRole("link", { name: "Finanzas" })).toHaveAttribute("aria-current", "page");
    expect(within(sections).getByRole("link", { name: "Calendario" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Descargar PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exportar PDF" })).toBeNull();
    unmount();

    render(
      <PreviewProvider>
        <ReportesScreen />
      </PreviewProvider>,
    );
    expect(screen.getByRole("button", { name: "Exportar PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Secciones de Reportes" })).toBeNull();
  }

  it("C1: Reportes › Calendario (Admin) marca Calendario en el mismo segmented", () => {
    renderReport("admin");
    const sections = screen.getByRole("navigation", { name: "Secciones de Reportes" });
    expect(within(sections).getByRole("link", { name: "Calendario" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Reportes$/);
  });

  it("C2: la vista previa muestra las filas que caben en la página 1 según el alto (no un número fijo)", () => {
    renderReport("admin");
    const fig = document.querySelector(".sx-pdf")!;
    const caption = fig.querySelector("figcaption")!.textContent ?? "";
    const m = caption.match(/Primera página · (\d+) de (\d+) filas · (\d+) páginas?/);
    expect(m).not.toBeNull();
    const [, onFirst, total, pages] = m!.map(Number);
    expect(onFirst).toBeGreaterThan(12);
    expect(onFirst).toBeLessThan(total);
    expect(fig.querySelectorAll(".sx-pdf-tr:not(.is-head)")).toHaveLength(onFirst);
    expect(fig.querySelector(".sx-pdf-foot")?.textContent).toBe(`Página 1 de ${pages}`);
  });

  it("C3: la fila de filtros tiene labels para Período, Área, Estado y Visibilidad, y el switch al final", () => {
    renderReport("admin");
    const row = document.querySelector(".sx-rep-filters")!;
    expect(within(row as HTMLElement).getByRole("group", { name: "Período" })).toBeInTheDocument();
    const desktop = row.querySelector(".sx-rep-filters-desktop")!;
    expect(desktop.lastElementChild).toHaveClass("sx-rep-switch");
    expect(desktop.querySelector("label[for='sx-rep-area']")?.textContent).toBe("Área");
    expect([...desktop.querySelectorAll("legend")].map((l) => l.textContent)).toEqual(["Estado", "Visibilidad"]);
    // El sheet móvil no duplica ids.
    expect(document.querySelectorAll("#sx-rep-area")).toHaveLength(1);
  });

  it("C4: el filtro por área ofrece las 9 áreas activas (incluida Consolidación) y el sheet no recorta la lista", () => {
    const opts = areaOptions([], AREAS, false);
    expect(opts.filter((o) => o.area.active)).toHaveLength(9);
    expect(opts.map((o) => o.area.name)).toContain("Consolidación");
    const css = readFileSync(join(process.cwd(), "components/suite-preview/calendar/calendar.css"), "utf8");
    expect(css).toMatch(/\.fx-sheet-body \.sx-filter-list \{\s*max-height: none;/);
  });

  it("C5: en la semana, a igual hora, las columnas siguen compareDayOrder (Escuela antes que Culto)", () => {
    const day = "2026-10-04";
    const occ = occurrencesInRange(EVENTS, day, day, DEMO_NOW, AREAS);
    const segs = segmentsFor(occ, [day], AREAS);
    const col = (title: string) => segs.find((x) => x.o.event.title === title)!.col;
    expect(col("Escuela dominical")).toBe(0);
    expect(col("Culto dominical")).toBe(1);
  });

  it("C9: el '+n' de la fila de todo el día tiene aria-label 'Ver n actividades más del {día}'", () => {
    const base = EVENTS.find((e) => e.id === "ev-campamento")!;
    const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
    const occ = [0, 1, 2, 3].flatMap((i) =>
      expandRecurrence(
        { ...base, id: `ev-x${i}`, title: `Todo el día ${i}`, allDay: true, startDate: "2026-10-14", endDate: "2026-10-14", recurrence: { freq: "none" } },
        "2026-10-12",
        "2026-10-18",
        DEMO_NOW,
      ),
    );
    render(<WeekGrid days={days} occurrences={occ} areas={AREAS} today="2026-10-04" nowMinutes={600} onOpen={() => {}} onOpenDay={() => {}} />);
    expect(screen.getByRole("button", { name: "Ver 2 actividades más del miércoles 14" })).toHaveTextContent("+2");
  });
});
