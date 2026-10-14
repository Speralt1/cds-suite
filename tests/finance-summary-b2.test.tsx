// PR B2 · Resumen (BalanceBand, FundsPosition) y calendario de caja
// (Design Lock 28 §C1/§C2). Datos ficticios.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BalanceBand, BalanceBandSkeleton, balanceSentence } from "@/components/finance/dashboard/balance-band";
import { FundsPosition } from "@/components/finance/dashboard/funds-position";
import { CashCalendarLegend, CashCalendarSection } from "@/components/finance/dashboard/cash-calendar";
import { CashDayPanel } from "@/components/finance/dashboard/cash-day-panel";
import { SummaryDashboard, SummaryPage } from "@/components/finance/dashboard/summary-page";
import { clpSigned } from "@/lib/finance/formatters";
import { buildMonthCalendar, dayWarnings, defaultSelectedDay, reviewDays } from "@/lib/finance/insights";
import type { FinanceTransaction, MonthlySummary } from "@/lib/finance/types";

const TS = "\u2009"; // espacio fino
const MINUS = "\u2212";
// Testing Library colapsa el espacio fino; se compara el texto crudo.
const amount = (text: string) => {
  const found = [...document.querySelectorAll(".fin-balance-amount")].find((el) => el.textContent === text);
  if (!found) throw new Error(`Sin cifra "${text}"`);
  return found;
};

const state = vi.hoisted(() => ({
  access: { role: "finance", active: true } as Record<string, unknown>,
  summary: null as MonthlySummary | null,
  summaryError: "",
  tx: { data: [] as FinanceTransaction[], loading: false, error: "" },
}));

vi.mock("@/lib/auth/access-provider", () => ({
  useAccess: () => state.access,
}));
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "test", email: "test@cds.test" } }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/finanzas",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/finance/hooks", () => ({
  usePeriod: () => useState({ year: 2026, month: 10, view: "month" as const }),
  useSummaries: () => ({
    data: state.summary && !state.summaryError ? [state.summary] : [],
    loading: false,
    error: state.summaryError,
  }),
  useTransactions: () => ({ ...state.tx, synced: !state.tx.loading && !state.tx.error }),
}));
vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: {} }) }));
vi.mock("@/lib/finance/transactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/transactions")>()),
  saveTransaction: vi.fn(),
}));
// PR D (doc 30): SummaryPage monta la tarjeta de saldo; aquí se reemplaza por un doble.
vi.mock("@/components/finance/bank/bank-balance-card", () => ({
  BankBalanceCard: (p: { variant?: string; connectSumupPayouts?: boolean }) => (
    <p data-testid="bank-tile" data-variant={p.variant} data-connect={String(!!p.connectSumupPayouts)}>
      Tile bancario
    </p>
  ),
}));
vi.mock("@/components/finance/charts/finance-charts", () => ({
  FinanceCharts: () => <div>Gráficos</div>,
}));

HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
  this.open = false;
};

function summary(over: Partial<MonthlySummary> = {}): MonthlySummary {
  return {
    id: "2026-10",
    incomeTotal: 4641132,
    expenseTotal: 532000,
    result: 4109132,
    titheTotal: 1000000,
    transactionCount: 12,
    incomeByCategory: { Ofrendas: 3641132, Diezmos: 1000000 },
    expenseByCategory: { Arriendo: 532000 },
    dailyIncome: {},
    dailyExpense: {},
    ...over,
  };
}

beforeEach(() => {
  state.access = { role: "finance", active: true };
  state.summary = summary();
  state.summaryError = "";
  state.tx = { data: [], loading: false, error: "" };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("clpSigned", () => {
  it("usa U+2212 y espacio fino; el cero no lleva signo", () => {
    expect(clpSigned(4641132)).toBe(`+${TS}$4.641.132`);
    expect(clpSigned(-20400)).toBe(`${MINUS}${TS}$20.400`);
    expect(clpSigned(0)).toBe("$0");
    expect(clpSigned(4109132, { plus: false })).toBe("$4.109.132");
    expect(clpSigned(-20400)).not.toContain("-");
  });
});

describe("BalanceBand", () => {
  const base = { title: "Resultado de octubre 2026", income: 4641132, expense: 532000, result: 4109132 };

  it("resultado positivo: Ingresos con +, Gastos con −, resultado sin signo y <dl> semántico", () => {
    const { container } = render(<BalanceBand {...base} tithe={1000000} />);
    expect(screen.getByRole("region", { name: "Resultado de octubre 2026" })).toBeInTheDocument();
    expect(container.querySelector("dl")).not.toBeNull();
    expect(amount(`+${TS}$4.641.132`)).toBeInTheDocument();
    expect(amount(`${MINUS}${TS}$532.000`)).toBeInTheDocument();
    expect(amount("$4.109.132")).toBeInTheDocument();
    expect(screen.getByText("Incluye diezmos $1.000.000")).toBeInTheDocument();
    expect(screen.getByText("Ingresos menos gastos. No es dinero disponible.")).toBeInTheDocument();
    expect(screen.queryByText("Déficit")).toBeNull();
    // Sin KPI de "Movimientos": el conteo vive en "Últimos movimientos".
    expect(screen.queryByText("Movimientos")).toBeNull();
  });

  it("resultado negativo: etiqueta Déficit y − además del color", () => {
    render(<BalanceBand {...base} income={100000} expense={120400} result={-20400} />);
    expect(screen.getByText("Déficit")).toBeInTheDocument();
    const deficit = amount(`${MINUS}${TS}$20.400`);
    expect(deficit.closest(".fin-balance-item")).toHaveClass("is-result", "is-deficit");
  });

  it("resumen para lector de pantalla", () => {
    render(<BalanceBand {...base} />);
    expect(
      screen.getByText("Ingresos 4.641.132 pesos menos gastos 532.000 pesos, resultado 4.109.132 pesos"),
    ).toHaveClass("sr-only");
    expect(balanceSentence(100000, 120400, -20400)).toBe(
      "Ingresos 100.000 pesos menos gastos 120.400 pesos, resultado déficit de 20.400 pesos",
    );
  });

  it("gastos = 0 con ingresos: chip de advertencia (solo si se pide)", () => {
    const { rerender } = render(<BalanceBand {...base} expense={0} result={4641132} showMissingExpenses />);
    expect(screen.getByText("Sin gastos registrados. ¿Faltan egresos?")).toBeInTheDocument();
    rerender(<BalanceBand {...base} expense={0} result={4641132} />);
    expect(screen.queryByText("Sin gastos registrados. ¿Faltan egresos?")).toBeNull();
  });

  it("comisión SumUp pendiente como sublínea de Gastos", () => {
    render(<BalanceBand {...base} sumUpFeePending />);
    expect(screen.getByText("Comisión SumUp: pendiente de datos")).toBeInTheDocument();
  });

  it("variación del resultado en monto; % solo para ingresos con base positiva", () => {
    render(
      <BalanceBand
        {...base}
        previous={{ income: 4129900, result: 2869132, label: "septiembre" }}
      />,
    );
    expect(screen.getByText("$1.240.000 más que septiembre")).toBeInTheDocument();
    expect(screen.getByText("↑ 12,4 % vs. septiembre")).toBeInTheDocument();
  });

  it("nunca muestra % sobre una base negativa", () => {
    const { container } = render(
      <BalanceBand
        {...base}
        income={100000}
        expense={20000}
        result={80000}
        previous={{ income: 0, result: -50000, label: "septiembre" }}
      />,
    );
    expect(screen.getByText("$130.000 más que septiembre")).toBeInTheDocument();
    expect(container.textContent).not.toContain("%");
  });

  it("vacío: $0 neutro y nota; cargando: aria-busy sin cifras", () => {
    const { container, unmount } = render(
      <BalanceBand title="Resultado de octubre 2026" income={0} expense={0} result={0} emptyNote="Aún no hay movimientos en octubre 2026." />,
    );
    expect(screen.getAllByText("$0")).toHaveLength(3);
    expect(container.querySelector(".is-signed")).toBeNull();
    expect(screen.getByText("Aún no hay movimientos en octubre 2026.")).toBeInTheDocument();
    unmount();
    render(<BalanceBandSkeleton title="Resultado de octubre 2026" />);
    expect(screen.getByRole("region", { name: "Resultado de octubre 2026" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});

describe("FundsPosition", () => {
  it("sin tile de saldo no renderiza nada", () => {
    const { container } = render(<FundsPosition isCurrentPeriod todayLabel="15 oct" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("con tile lo muestra, con su encabezado; en un período pasado aclara que no depende de él", () => {
    const { rerender } = render(
      <FundsPosition bankTile={<p>Saldo bancario estimado</p>} isCurrentPeriod todayLabel="15 oct" />,
    );
    expect(screen.getByRole("heading", { name: "Posición de fondos" })).toBeInTheDocument();
    expect(screen.getByText("Dinero en un momento dado. No se suma al resultado.")).toBeInTheDocument();
    expect(screen.getByText("Saldo bancario estimado")).toBeInTheDocument();
    rerender(
      <FundsPosition
        bankTile={<p>Saldo bancario estimado</p>}
        tiles={[<p key="cash">Efectivo en caja</p>]}
        isCurrentPeriod={false}
        todayLabel="15 oct"
      />,
    );
    expect(screen.getByRole("heading", { name: "Posición de fondos · hoy, 15 oct" })).toBeInTheDocument();
    expect(screen.getByText(/No depende del período seleccionado\./)).toBeInTheDocument();
    expect(screen.getByText("Efectivo en caja")).toBeInTheDocument();
  });
});

describe("Resumen integrado", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15, 12));
  });

  it("muestra la banda y el conteo en 'Últimos movimientos · N en el período'", () => {
    render(<SummaryPage />);
    expect(screen.getByRole("heading", { name: "Resultado de octubre 2026" })).toBeInTheDocument();
    expect(amount(`+${TS}$4.641.132`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Últimos movimientos · 12 en el período" })).toBeInTheDocument();
    expect(screen.queryByText("Gastos y resultado")).toBeNull();
    expect(screen.getByRole("heading", { name: "Calendario de caja · Octubre 2026" })).toBeInTheDocument();
  });

  it("Posición de fondos: oculta sin tile, visible con tile y nunca para el líder", () => {
    const tile = <p>Tile de saldo</p>;
    const first = render(<SummaryDashboard />);
    expect(screen.queryByText("Posición de fondos")).toBeNull();
    first.unmount();

    // /finanzas (SummaryPage) monta el saldo bancario en modo "funds" con abonos SumUp conectados.
    const page = render(<SummaryPage />);
    expect(screen.getByRole("heading", { name: "Posición de fondos" })).toBeInTheDocument();
    expect(screen.getByTestId("bank-tile")).toHaveAttribute("data-variant", "funds");
    expect(screen.getByTestId("bank-tile")).toHaveAttribute("data-connect", "true");
    page.unmount();

    const second = render(<SummaryDashboard fundsBankTile={tile} />);
    expect(screen.getByRole("heading", { name: "Posición de fondos" })).toBeInTheDocument();
    expect(screen.getByText("Tile de saldo")).toBeInTheDocument();
    second.unmount();

    state.access = { role: "leader", active: true };
    render(<SummaryDashboard fundsBankTile={tile} />);
    expect(screen.queryByText("Posición de fondos")).toBeNull();
    expect(screen.queryByText("Tile de saldo")).toBeNull();
    expect(screen.getByRole("heading", { name: "Resultado de octubre 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /Calendario de/ })).toBeNull();
  });

  it("el panel abre el CashModal real con el área y la fecha del día", () => {
    render(<SummaryPage />);
    const aside = screen.getByRole("complementary", { name: "Detalle del día" });
    expect(within(aside).getByRole("heading", { level: 3, name: "Domingo 4 de octubre · Culto" })).toBeInTheDocument();
    fireEvent.click(within(aside).getByRole("button", { name: "Registrar efectivo · Cafetería" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent("Ingresar efectivo · Cafetería");
    expect(within(dialog).getByLabelText(/Fecha correspondiente/)).toHaveValue("2026-10-04");
  });

  it("'Revisar movimientos' pasa a Diario y lleva el foco al título de la banda", () => {
    render(<SummaryPage />);
    const aside = screen.getByRole("complementary", { name: "Detalle del día" });
    fireEvent.click(within(aside).getByRole("button", { name: "Revisar movimientos" }));
    expect(screen.getByRole("button", { name: "Diario" })).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toHaveAttribute("id", "fin-balance-title");
    expect(document.activeElement).toHaveTextContent("Resultado del dom 4 oct");
  });

  it("Diario: sin el chip de gastos en cero y con el conteo del día", () => {
    state.summary = summary({ expenseTotal: 0, result: 4641132, dailyIncome: { "15": 50000 } });
    state.tx = { data: [tx({ id: "t15", day: "15", amount: 50000 })], loading: false, error: "" };
    render(<SummaryPage />);
    expect(screen.getByText("Sin gastos registrados. ¿Faltan egresos?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Diario" }));
    expect(screen.getByRole("heading", { name: "Resultado del jue 15 oct" })).toBeInTheDocument();
    expect(screen.queryByText("Sin gastos registrados. ¿Faltan egresos?")).toBeNull();
    expect(screen.getByRole("heading", { name: "Movimientos del día · 1" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Ingresos del día" })).toBeInTheDocument();
  });

  it("Diario con error: sin panel ni conteo falso", () => {
    state.tx = { data: [], loading: false, error: "Sin conexión con el servidor." };
    render(<SummaryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Diario" }));
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("Sin conexión con el servidor.");
    expect(screen.queryByRole("region", { name: "Ingresos del día" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar efectivo ·/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Movimientos del día" })).toBeInTheDocument();
  });

  it("Diario cargando: skeleton con un solo aviso de estado, sin panel ni conteo", () => {
    state.tx = { data: [], loading: true, error: "" };
    render(<SummaryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Diario" }));
    expect(screen.getByRole("region", { name: "Resultado del jue 15 oct" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Ingresos del día" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Movimientos del día" })).toBeInTheDocument();
  });

  it("el tile de saldo no se remonta al cambiar de vista y sigue visible si fallan los resúmenes", () => {
    let mounts = 0;
    function Tile() {
      useEffect(() => {
        mounts++;
      }, []);
      return <p>Tile de saldo</p>;
    }
    const view = render(<SummaryDashboard fundsBankTile={<Tile />} />);
    fireEvent.click(screen.getByRole("button", { name: "Diario" }));
    fireEvent.click(screen.getByRole("button", { name: "Anual" }));
    fireEvent.click(screen.getByRole("button", { name: "Mensual" }));
    expect(screen.getByText("Tile de saldo")).toBeInTheDocument();
    expect(mounts).toBe(1);
    view.unmount();
    state.summaryError = "No pudimos cargar los resúmenes.";
    render(<SummaryDashboard fundsBankTile={<Tile />} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los resúmenes.");
    expect(screen.queryByRole("region", { name: /Resultado de/ })).toBeNull();
    expect(screen.getByText("Tile de saldo")).toBeInTheDocument();
  });

  it("tabla por tipo de dinero: línea secundaria con % y movimientos para paneles angostos", () => {
    state.tx = {
      data: [
        tx({ id: "c1", day: "4", amount: 75000 }),
        tx({ id: "t1", day: "5", amount: 25000, category: "Otros", paymentMethod: "transfer" }),
      ],
      loading: false,
      error: "",
    };
    render(<SummaryPage />);
    const table = screen.getByRole("heading", { name: "Ingresos por tipo de dinero" }).closest("section")!;
    const efectivo = within(table).getByRole("rowheader", { name: /^Efectivo/ });
    expect(within(efectivo).getByText("75% · 1 mov.")).toHaveClass("fin-amount-sub");
    expect(within(table).getByRole("rowheader", { name: /^Transferencia/ })).toHaveTextContent("25% · 1 mov.");
    expect(within(table).getByRole("rowheader", { name: /^Total ingresos/ })).toHaveTextContent("100% · 2 mov.");
    // The wide-layout columns stay (hidden by the container query on phones).
    const efectivoRow = efectivo.closest("tr")!;
    expect(efectivoRow.querySelector("td.is-pct")).toHaveTextContent("75%");
    expect(efectivoRow.querySelector("td.is-count")).toHaveTextContent("1");
  });

  it("si la banda de Diario falla, el foco cae en el botón Diario", () => {
    render(<SummaryPage />);
    const aside = screen.getByRole("complementary", { name: "Detalle del día" });
    state.summaryError = "No pudimos cargar el resumen del día.";
    fireEvent.click(within(aside).getByRole("button", { name: "Revisar movimientos" }));
    expect(screen.queryByRole("region", { name: /^Resultado del/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Diario" }));
  });

  it("Anual cargando: un solo aviso de estado", () => {
    state.tx = { data: [], loading: true, error: "" };
    render(<SummaryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Anual" }));
    expect(screen.getAllByText("Consultando información…").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("mes negativo: Déficit y signo menos en el resultado", () => {
    state.summary = summary({ incomeTotal: 100000, expenseTotal: 120400, result: -20400, titheTotal: 0 });
    render(<SummaryPage />);
    expect(screen.getByText("Déficit")).toBeInTheDocument();
    expect(amount(`${MINUS}${TS}$20.400`)).toBeInTheDocument();
  });
});

// ---------- Calendario de caja ----------

const TODAY = "2026-10-15"; // jueves
function tx(over: Partial<FinanceTransaction> & { id: string; day: string; amount: number }): FinanceTransaction {
  return {
    type: "income",
    status: "active",
    category: "Ofrendas",
    paymentMethod: "cash",
    description: "Movimiento",
    note: "",
    source: "general",
    revision: 1,
    createdBy: "uid-1",
    createdAt: undefined as never,
    updatedBy: "uid-1",
    updatedAt: undefined as never,
    date: undefined as never,
    period: "2026-10",
    ...over,
  } as FinanceTransaction;
}
const sumUp = (id: string, day: string, amount: number, category = "Ofrendas") =>
  tx({ id: `sumup_${id}`, day, amount, category, paymentMethod: "card", createdBy: "system:sumup", description: `Cobro SumUp ${id}` });

// dom 4: falta efectivo de Ofrendas (4 cobros SumUp, $85.000)
// mié 7: sin registros · dom 11: efectivo $165.000 · mié 14: faltan 2 áreas
const TX: FinanceTransaction[] = [
  sumUp("a", "4", 30000),
  sumUp("b", "4", 25000),
  sumUp("c", "4", 20000),
  sumUp("d", "4", 10000),
  tx({ id: "cash11", day: "11", amount: 165000, description: "Ofrendas en efectivo" }),
  sumUp("e", "14", 40000),
  sumUp("f", "14", 15000, "Cafetería"),
];

function Harness({ manage = true, onViewDay = vi.fn(), onRegisterCash = vi.fn() }: {
  manage?: boolean;
  onViewDay?: (date: string) => void;
  onRegisterCash?: (area: string, date: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const calendar = buildMonthCalendar(TX, 2026, 10, TODAY);
  const review = reviewDays(TX, 2026, 10, TODAY);
  return (
    <CashCalendarSection
      year={2026}
      month={10}
      calendar={calendar}
      review={review}
      transactions={TX}
      selected={selected || defaultSelectedDay(calendar, review, TODAY)!}
      onSelect={setSelected}
      onRegisterCash={manage ? onRegisterCash : undefined}
      onViewDay={onViewDay}
    />
  );
}

const cell = (name: RegExp | string) =>
  screen.getByRole("button", { name: typeof name === "string" ? new RegExp(`^${name}`) : name });

describe("Calendario de caja · celdas", () => {
  it("estados con etiqueta además del color, aria-current y aria-pressed", () => {
    render(<Harness />);
    const oct4 = cell("domingo 4 de octubre");
    expect(oct4).toHaveAccessibleName("domingo 4 de octubre, día de culto, falta efectivo de Ofrendas, 1 advertencia");
    expect(oct4).toHaveClass("has-warning");
    expect(oct4).toHaveTextContent("Falta efectivo · Ofrendas");
    expect(oct4).toHaveAttribute("aria-pressed", "true"); // primera advertencia por defecto

    const oct7 = cell("miércoles 7 de octubre");
    expect(oct7).toHaveAccessibleName("miércoles 7 de octubre, día de culto, sin registros de Ofrendas ni Cafetería, 1 advertencia");
    expect(oct7).toHaveClass("has-empty");
    expect(oct7).toHaveTextContent("Sin registros");

    const oct11 = cell("domingo 11 de octubre");
    expect(oct11).toHaveAccessibleName("domingo 11 de octubre, día de culto, efectivo registrado $165.000");
    expect(oct11).toHaveTextContent("$165 mil");
    expect(oct11).toHaveAttribute("aria-pressed", "false");

    const oct14 = cell("miércoles 14 de octubre");
    expect(oct14).toHaveAccessibleName(/falta efectivo de Ofrendas y Cafetería, 2 advertencias$/);
    expect(oct14).toHaveTextContent("Falta efectivo · 2 áreas");

    const oct15 = cell("jueves 15 de octubre");
    expect(oct15).toHaveAccessibleName("jueves 15 de octubre, hoy");
    expect(oct15).toHaveAttribute("aria-current", "date");
    expect(oct15).toHaveClass("is-today");

    expect(cell("martes 20 de octubre")).toHaveClass("is-future");
    expect(screen.getByRole("table", { name: "Calendario de Octubre 2026" })).toBeInTheDocument();
  });

  it("roving tabindex: una sola parada de Tab y flechas/Inicio/Fin", () => {
    const { container } = render(<Harness />);
    const stops = () => container.querySelectorAll('.fin-cal-cell[tabindex="0"]');
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveAttribute("data-date", "2026-10-04");

    const oct4 = cell("domingo 4 de octubre");
    oct4.focus();
    fireEvent.keyDown(oct4, { key: "ArrowRight" });
    expect(document.activeElement).toHaveAttribute("data-date", "2026-10-05");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toHaveAttribute("data-date", "2026-10-12");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toHaveAttribute("data-date", "2026-10-18");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toHaveAttribute("data-date", "2026-10-12");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toHaveAttribute("data-date", "2026-10-05");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "Home" }); // la semana empieza en septiembre
    expect(document.activeElement).toHaveAttribute("data-date", "2026-10-01");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" }); // fuera del mes: no se mueve
    expect(document.activeElement).toHaveAttribute("data-date", "2026-10-01");
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toHaveAttribute("data-date", "2026-10-01");
    // Mover el foco no selecciona; Enter/Espacio (click) sí.
    expect(cell("jueves 1 de octubre")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(document.activeElement!);
    expect(cell("jueves 1 de octubre")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 3, name: "Jueves 1 de octubre" })).toBeInTheDocument();
  });

  it("chip de estado: cuenta advertencias y días; Revisar selecciona la primera y lleva el foco al panel", () => {
    render(<Harness />);
    fireEvent.click(cell("domingo 11 de octubre"));
    fireEvent.click(screen.getByRole("button", { name: "4 advertencias en 3 días · Revisar" }));
    expect(cell("domingo 4 de octubre")).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toHaveTextContent("Domingo 4 de octubre · Culto");
  });

  it("sin advertencias: mensaje de todo registrado", () => {
    const calendar = buildMonthCalendar([], 2026, 11, TODAY);
    render(
      <CashCalendarSection
        year={2026}
        month={11}
        calendar={calendar}
        review={[]}
        transactions={[]}
        selected="2026-11-01"
        onSelect={() => {}}
        onViewDay={() => {}}
      />,
    );
    expect(screen.getByText("Todo registrado en los días de culto de este mes.")).toBeInTheDocument();
    expect(cell("domingo 1 de noviembre")).toHaveTextContent("1");
    expect(screen.queryByRole("navigation", { name: "Advertencias del mes" })).toBeNull();
  });
});

describe("Leyenda", () => {
  it("muestra las 6 señales y se puede contraer (móvil)", () => {
    render(<CashCalendarLegend />);
    const list = screen.getByRole("list", { name: "Leyenda del calendario" });
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "Falta efectivo: SumUp registró cobros y no hay efectivo del área",
      "Sin registros: día de culto sin Ofrendas ni Cafetería",
      "$165 milEfectivo registrado",
      "3Hoy",
      "3Día seleccionado",
      "CultoDía de culto",
    ]);
    const toggle = screen.getByRole("button", { name: "Ocultar leyenda" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Ver leyenda" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Panel del día", () => {
  it("navegación entre advertencias: anterior / siguiente y posición", () => {
    render(<Harness />);
    const nav = () => screen.getByRole("navigation", { name: "Advertencias del mes" });
    expect(nav()).toHaveTextContent("1 de 3");
    expect(within(nav()).getByRole("button", { name: "Advertencia anterior" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(nav()).getByRole("button", { name: "Siguiente advertencia" }));
    expect(screen.getByRole("heading", { level: 3, name: "Miércoles 7 de octubre · Culto" })).toBeInTheDocument();
    expect(nav()).toHaveTextContent("2 de 3");
    const next = within(nav()).getByRole("button", { name: "Siguiente advertencia" });
    next.focus();
    fireEvent.click(next);
    expect(nav()).toHaveTextContent("3 de 3");
    // At the end the button is aria-disabled: it keeps the focus and does nothing.
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    expect(nav()).toHaveTextContent("3 de 3");
    expect(document.activeElement).toBe(next);
    // Desde un día sin advertencias: la anterior y la siguiente del mes.
    fireEvent.click(cell("domingo 11 de octubre"));
    expect(nav()).toHaveTextContent("3 días con advertencias");
    fireEvent.click(within(nav()).getByRole("button", { name: "Advertencia anterior" }));
    expect(cell("miércoles 7 de octubre")).toHaveAttribute("aria-pressed", "true");
  });

  it("tarjeta de advertencia: tipo, causa, movimientos asociados, estado y acciones con manage", () => {
    const onRegisterCash = vi.fn();
    const onViewDay = vi.fn();
    render(<Harness onRegisterCash={onRegisterCash} onViewDay={onViewDay} />);
    expect(screen.getByRole("status")).toHaveTextContent("Domingo 4 de octubre: 1 advertencia");
    const warnings = screen.getByRole("region", { name: "Advertencias (1)" });
    expect(within(warnings).getByText("Falta efectivo · Ofrendas")).toBeInTheDocument();
    expect(
      within(warnings).getByText(
        "SumUp registró $85.000 en Ofrendas este día, pero no hay efectivo de Ofrendas registrado.",
      ),
    ).toBeInTheDocument();
    expect(within(warnings).getByText("Cobro SumUp a")).toBeInTheDocument();
    expect(within(warnings).queryByText("Cobro SumUp d")).toBeNull();
    expect(within(warnings).getByText("Pendiente")).toBeInTheDocument();
    fireEvent.click(within(warnings).getByRole("button", { name: "Ver los 4 movimientos" }));
    expect(onViewDay).toHaveBeenLastCalledWith("2026-10-04");
    fireEvent.click(within(warnings).getByRole("button", { name: "Registrar efectivo · Ofrendas" }));
    expect(onRegisterCash).toHaveBeenCalledWith("offerings", "2026-10-04");
    fireEvent.click(within(warnings).getByRole("button", { name: "Revisar movimientos" }));
    expect(onViewDay).toHaveBeenCalledTimes(2);
    expect(within(warnings).queryByText(/no registrar movimientos/)).toBeNull();
    // Ingresos del día
    const income = screen.getByRole("region", { name: "Ingresos del día" });
    expect(within(income).getByRole("rowheader", { name: "Ofrendas" })).toBeInTheDocument();
  });

  it("sin manage: lectura con nota y sin registrar", () => {
    render(<Harness manage={false} />);
    expect(screen.queryByRole("button", { name: /Registrar efectivo/ })).toBeNull();
    expect(screen.getByText("Puedes revisar este día, pero no registrar movimientos.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revisar movimientos" })).toBeInTheDocument();
  });

  it("sin registros: causa de día de culto y registrar por área; día futuro", () => {
    render(<Harness />);
    fireEvent.click(cell("miércoles 7 de octubre"));
    expect(screen.getByText("Es día de culto y no hay ingresos de Ofrendas ni de Cafetería registrados.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar efectivo · Ofrendas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar efectivo · Cafetería" })).toBeInTheDocument();
    fireEvent.click(cell("martes 20 de octubre"));
    expect(screen.getByText("Día futuro: aún no hay registros.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Martes 20 de octubre: sin advertencias");
  });

  it("vista Diario: el panel sin navegación enlaza a la lista de movimientos", () => {
    const calendar = buildMonthCalendar(TX, 2026, 10, TODAY);
    const day = calendar.days.find((d) => d.date === "2026-10-04")!;
    expect(dayWarnings(day, TX)).toHaveLength(1);
    render(<CashDayPanel date="2026-10-04" status={day} transactions={TX} />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("link", { name: "Revisar movimientos" })).toHaveAttribute("href", "#fin-movements");
  });
});

describe("Modo apilado (<52rem): diálogo del día", () => {
  beforeEach(() => {
    class NarrowResizeObserver {
      constructor(private cb: ResizeObserverCallback) {}
      observe(target: Element) {
        this.cb([{ target, contentRect: { width: 400 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", NarrowResizeObserver);
  });

  it("tocar un día abre el diálogo; al cerrarlo el foco vuelve a la celda", () => {
    render(<Harness />);
    expect(screen.queryByRole("complementary", { name: "Detalle del día" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Días por revisar (4)" })).toBeInTheDocument();

    const oct11 = cell("domingo 11 de octubre");
    oct11.focus();
    fireEvent.click(oct11);
    const dialog = screen.getByRole("dialog", { name: "Domingo 11 de octubre · Culto" });
    expect(within(dialog).getByRole("region", { name: "Ingresos del día" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(cell("domingo 11 de octubre"));
  });

  it("Esc cierra; navegar dentro del diálogo devuelve el foco al día nuevo", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Ver día domingo 4 de octubre" }));
    let dialog = screen.getByRole("dialog", { name: "Domingo 4 de octubre · Culto" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente advertencia" }));
    dialog = screen.getByRole("dialog", { name: "Miércoles 7 de octubre · Culto" });
    act(() => {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(cell("miércoles 7 de octubre"));
  });
});
