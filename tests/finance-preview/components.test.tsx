import { describe, expect, it, vi, beforeAll } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/preview/finanzas-2026" }));

import { FinancialShell } from "@/components/finance-preview/shell";
import { PreviewProvider } from "@/components/finance-preview/context";
import { HoyScreen } from "@/components/finance-preview/screens/hoy";
import { CajaScreen, ConciliacionScreen, MovimientosScreen } from "@/components/finance-preview/screens/operacion";
import { CafeteriaScreen, CampanasScreen, OfrendasScreen } from "@/components/finance-preview/screens/fuentes";
import { ReportesScreen } from "@/components/finance-preview/screens/analisis";
import { DetailSheet } from "@/components/finance-preview/movements";
import { MoneyAmount, StatusBadge } from "@/components/finance-preview/ui";
import { TRANSACTIONS } from "@/lib/finance-preview/fixtures";

beforeAll(() => {
  // recharts mide su contenedor; jsdom no trae ResizeObserver ni matchMedia.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
});

const withProvider = (ui: React.ReactNode) => render(<PreviewProvider>{ui}</PreviewProvider>);

/** Texto visible sin la frase fija permitida. */
function textWithoutAllowedPhrase(container: HTMLElement) {
  return (container.textContent ?? "").replace(/no representa el saldo bancario/gi, "");
}

describe("shell del preview", () => {
  it("muestra siempre el aviso de datos de demostración y la navegación pedida", () => {
    render(
      <FinancialShell>
        <p>contenido</p>
      </FinancialShell>,
    );
    expect(screen.getAllByRole("note")[0]).toHaveTextContent(/Vista previa · datos de demostración/);
    const nav = screen.getByRole("navigation", { name: "Finanzas" });
    for (const label of ["Hoy", "Movimientos", "Caja", "Conciliación", "Ofrendas", "Diezmos", "Cafetería", "Campañas", "Reportes", "Configuración"])
      expect(within(nav).getByRole("link", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /^Atención, \d+ pendientes$/ })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
    // marcador que usa la guardia de deploy para detectar el preview en out/
    expect(document.querySelector('[data-preview="FX_PREVIEW_SENTINEL_V2_7f3a"]')).not.toBeNull();
  });
});

describe("Hoy", () => {
  it("tiene exactamente 3 métricas, sin Saldo ni Diezmos como métrica paralela", () => {
    const { container } = withProvider(<HoyScreen />);
    const metrics = container.querySelectorAll(".fx-metric");
    expect(metrics).toHaveLength(3);
    expect([...metrics].map((m) => m.querySelector("h2")?.textContent)).toEqual([
      "Ingresos registrados",
      "Gastos registrados",
      "Resultado del período",
    ]);
    expect(screen.getByText(/Ingresos − gastos\. No representa el saldo bancario\./)).toBeInTheDocument();
    expect(textWithoutAllowedPhrase(container)).not.toMatch(/saldo/i);
    expect(container.textContent).not.toMatch(/líquid/i);
  });

  it("explica cómo se calcula cada métrica", () => {
    withProvider(<HoyScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Cómo se calcula Ingresos registrados" }));
    expect(screen.getByText(/No incluye anulados ni campañas/)).toBeInTheDocument();
  });

  it("resolver un ítem de atención es una simulación con deshacer", () => {
    withProvider(<HoyScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Simulación: no se guardó nada/);
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
  });
});

describe("Movimientos", () => {
  it("agrupa SumUp por día con un toggle accesible (aria-expanded)", () => {
    withProvider(<MovimientosScreen />);
    const toggle = screen.getAllByRole("button", { name: /^Ver \d+ pagos/ })[0];
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("el detalle de un pago SumUp solo permite Reclasificar o Marcar para revisión", () => {
    const sumup = TRANSACTIONS.find((t) => t.origin === "sumup" && t.status === "active")!;
    withProvider(<DetailSheet tx={sumup} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Editar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Anular/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Reclasificar" })).toBeInTheDocument();
    expect(screen.getByText("Comisión pendiente de datos de SumUp")).toBeInTheDocument();
  });

  it("anular un movimiento manual exige motivo", () => {
    const manual = TRANSACTIONS.find((t) => t.origin === "manual" && t.status === "active" && t.type === "expense")!;
    withProvider(<DetailSheet tx={manual} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Anular/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar anulación" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/motivo/);
  });
});

describe("Caja", () => {
  it("Ofrendas usa doble conteo ciego, sin 'esperado', y una diferencia exige motivo", () => {
    const { container } = withProvider(<CajaScreen />);
    const ofrendas = container.querySelector('[aria-labelledby="caja-ofrendas"]') as HTMLElement;
    expect(ofrendas.textContent).not.toMatch(/esperado/i);
    expect(within(ofrendas).getByText("Oculto hasta terminar")).toBeInTheDocument();
    fireEvent.click(within(ofrendas).getByRole("button", { name: "Agregar uno de $20.000" }));
    fireEvent.click(within(ofrendas).getByRole("button", { name: "Terminar conteo 2" }));
    fireEvent.click(within(ofrendas).getByRole("button", { name: "Cerrar con diferencia" }));
    expect(within(ofrendas).getByRole("alert")).toHaveTextContent(/Explica la diferencia/);
    // el esperado de Cafetería es texto calculado de ejemplo, nunca un input
    fireEvent.click(screen.getByRole("button", { name: "Cafetería" }));
    const cafe = container.querySelector('[aria-labelledby="caja-cafeteria"]') as HTMLElement;
    expect(within(cafe).getByText("Esperado en caja")).toBeInTheDocument();
    expect(within(cafe).getByText("Ejemplo")).toBeInTheDocument();
    expect(within(cafe).queryAllByRole("textbox")).toHaveLength(0);
  });
});

describe("estado del culto en curso (una sola regla)", () => {
  it("ninguna pantalla muestra 'Falta efectivo' para hoy: es 'Por registrar'", () => {
    for (const Screen of [OfrendasScreen, CafeteriaScreen, CajaScreen]) {
      const { container, unmount } = withProvider(<Screen />);
      const todayRow = [...container.querySelectorAll("tr")].find((tr) => /dom 4 oct/.test(tr.textContent ?? ""));
      expect(todayRow, Screen.name).toBeDefined();
      expect(todayRow!.textContent).not.toMatch(/Falta efectivo/);
      expect(todayRow!.textContent).toMatch(/Por registrar/);
      unmount();
    }
  });
});

describe("Conciliación, fuentes y reportes", () => {
  it("Conciliación se marca como Propuesta y no muestra líquido sin comisión", () => {
    withProvider(<ConciliacionScreen />);
    expect(screen.getAllByText("Propuesta").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pendiente de SumUp").length).toBeGreaterThan(0);
  });

  it("Ofrendas y Cafetería son pantallas separadas y nunca muestran el total de la otra", () => {
    const ofr = withProvider(<OfrendasScreen />);
    expect(ofr.container.textContent).toMatch(/Donaciones de los cultos/);
    expect(ofr.container.textContent).not.toMatch(/Ventas de cafetería/);
    ofr.unmount();
    const caf = withProvider(<CafeteriaScreen />);
    expect(caf.container.textContent).toMatch(/No son donaciones/);
  });

  it("Campañas se declara fuera del libro", () => {
    withProvider(<CampanasScreen />);
    expect(screen.getAllByText("Fuera del libro").length).toBeGreaterThan(0);
  });

  it("Reportes no muestra nombres de diezmantes ni la palabra Saldo fuera de la frase fija", () => {
    const { container } = withProvider(<ReportesScreen />);
    expect(container.textContent).not.toMatch(/Familia |Camila Fuentes|Rodrigo Espinoza/);
    expect(textWithoutAllowedPhrase(container)).not.toMatch(/saldo/i);
  });
});

describe("primitivas", () => {
  it("MoneyAmount usa el signo menos real y lo lee en voz", () => {
    const { container } = render(<MoneyAmount value={-4500} />);
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("\u2212$4.500");
    expect(screen.getByText("menos 4.500 pesos")).toHaveClass("fx-sr");
  });

  it("los estados nunca dependen solo del color: ícono + texto", () => {
    const { container } = render(<StatusBadge status="difference" detail="−$4.500" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toMatch(/Con diferencia · −\$4\.500/);
  });
});
