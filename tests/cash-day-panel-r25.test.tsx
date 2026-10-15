// R2.5 · Panel del día del calendario de caja: "Efectivo por área" (estados
// neutros), "Resumen del día" (Depósitos = solo transferencias) y sin
// movimientos individuales. Datos ficticios.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CashDayPanel, cashAreaRows, dayBreakdown } from "@/components/finance/dashboard/cash-day-panel";
import { dayStatus, incomeByMethod } from "@/lib/finance/insights";
import type { FinanceTransaction } from "@/lib/finance/types";

const TODAY = "2026-10-15"; // jueves
const SUNDAY = "2026-10-11";

function tx(over: Partial<FinanceTransaction> & { id: string; amount: number }): FinanceTransaction {
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
    day: "11",
    ...over,
  } as FinanceTransaction;
}
const sumUp = (id: string, amount: number, category = "Ofrendas", day = "11") =>
  tx({ id: `sumup_${id}`, amount, category, day, paymentMethod: "card", createdBy: "system:sumup", description: `Cobro SumUp ${id}` });

// dom 11: Cafetería SumUp $120.000 + efectivo $125.000; Ofrendas transferencia
// $20.000; tarjeta manual $5.000 y "other" $3.000 (Otros ingresos); gasto $40.000.
const MIXED: FinanceTransaction[] = [
  sumUp("c1", 70000, "Cafetería"),
  sumUp("c2", 50000, "Cafetería"),
  tx({ id: "cash-c", amount: 125000, category: "Cafetería" }),
  tx({ id: "tr-o", amount: 20000, paymentMethod: "transfer" }),
  tx({ id: "card-m", amount: 5000, category: "Donación", paymentMethod: "card" }),
  tx({ id: "oth", amount: 3000, category: "Donación", paymentMethod: "other" }),
  tx({ id: "exp", amount: 40000, type: "expense", category: "Aseo" }),
  tx({ id: "void", amount: 999000, status: "voided" as FinanceTransaction["status"] }),
];

const status = (txs: FinanceTransaction[], date = SUNDAY) => dayStatus(date, txs, TODAY);
const summary = () => screen.getByRole("region", { name: "Resumen del día" });
const areaRegion = () => screen.queryByRole("region", { name: "Efectivo por área" });

describe("dayBreakdown (R2.5)", () => {
  it("Depósitos = solo transferencias; tarjeta manual y 'other' van a Otros medios; totales = suma de filas", () => {
    const b = dayBreakdown(MIXED, SUNDAY);
    expect(b.rows).toEqual([
      { label: "Ofrendas", sumUp: 0, cash: 0, deposits: 20000, otherMethods: 0, total: 20000 },
      { label: "Cafetería", sumUp: 120000, cash: 125000, deposits: 0, otherMethods: 0, total: 245000 },
      { label: "Otros ingresos", sumUp: 0, cash: 0, deposits: 0, otherMethods: 8000, total: 8000 },
    ]);
    expect(b.totals).toEqual({ sumUp: 120000, cash: 125000, deposits: 20000, otherMethods: 8000 });
    expect(b.showOtherMethods).toBe(true);
    expect(b.expenses).toBe(40000);
    // Regresión: total del día = suma de filas = suma de columnas.
    const rowSum = b.rows.reduce((s, r) => s + r.total, 0);
    const colSum = b.totals.sumUp + b.totals.cash + b.totals.deposits + b.totals.otherMethods;
    expect(b.totalIncome).toBe(273000);
    expect(rowSum).toBe(b.totalIncome);
    expect(colSum).toBe(b.totalIncome);
    for (const r of b.rows) expect(r.sumUp + r.cash + r.deposits + r.otherMethods).toBe(r.total);
  });

  it("regresión KPI: 'Ingresos por tipo de dinero' sigue separando transferencia, tarjeta otra y otro", () => {
    const dayIncome = MIXED.filter((t) => t.status === "active" && t.type === "income");
    const kpi = incomeByMethod(dayIncome);
    const byKey = Object.fromEntries(kpi.rows.map((r) => [r.key, r.amount]));
    expect(byKey).toEqual({ cash: 125000, sumup: 120000, otherCard: 5000, transfer: 20000, other: 3000 });
    expect(kpi.total).toBe(dayBreakdown(MIXED, SUNDAY).totalIncome);
  });

  it("sin Otros medios la columna no existe", () => {
    const txs = MIXED.filter((t) => t.category !== "Donación");
    expect(dayBreakdown(txs, SUNDAY).showOtherMethods).toBe(false);
    render(<CashDayPanel date={SUNDAY} status={status(txs)} transactions={txs} />);
    const headers = within(summary()).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Fuente", "SumUp", "Efectivo", "Depósitos", "Total"]);
    expect(within(summary()).queryByText("Otros medios")).toBeNull();
  });
});

describe("Panel del día · Resumen del día", () => {
  it("tabla con caption, columna Otros medios solo si hay monto, ceros con '—' y fila Total del día", () => {
    render(<CashDayPanel date={SUNDAY} status={status(MIXED)} transactions={MIXED} />);
    const table = within(summary()).getByRole("table");
    expect(within(table).getByText("Montos SumUp en bruto, antes de comisión.").tagName).toBe("CAPTION");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Fuente",
      "SumUp",
      "Efectivo",
      "Depósitos",
      "Otros medios",
      "Total",
    ]);
    const rowOf = (name: string) => within(table).getByRole("rowheader", { name }).closest("tr")!;
    const cells = (name: string) => [...rowOf(name).querySelectorAll("td")].map((td) => td.textContent);
    expect(cells("Cafetería")).toEqual(["$120.000", "$125.000", "—", "—", "$245.000"]);
    expect(cells("Ofrendas")).toEqual(["—", "—", "$20.000", "—", "$20.000"]);
    expect(cells("Otros ingresos")).toEqual(["—", "—", "—", "$8.000", "$8.000"]);
    const zero = rowOf("Ofrendas").querySelector('td[data-label="SumUp"]')!;
    expect(zero).toHaveClass("is-zero");
    expect(rowOf("Ofrendas").querySelector('td[data-label="Depósitos"]')).not.toHaveClass("is-zero");
    expect(rowOf("Ofrendas").querySelector('td[data-label="Otros medios"]')).toHaveClass("is-zero");
    // Total del día en <tfoot>, con th scope=row y total destacado.
    const foot = table.querySelector("tfoot")!;
    expect(foot.querySelectorAll("tr")).toHaveLength(1);
    const footHeader = within(foot).getByRole("rowheader", { name: "Total del día" });
    expect(footHeader).toHaveAttribute("scope", "row");
    expect(cells("Total del día")).toEqual(["$120.000", "$125.000", "$20.000", "$8.000", "$273.000"]);
    expect(foot.querySelector('td[data-label="Total"]')).toHaveClass("is-strong");
    // Sin fila de Gastos en la tabla: va como línea aparte.
    expect(within(table).queryByRole("rowheader", { name: /Gastos/ })).toBeNull();
    expect(within(table).queryByText("SumUp bruto")).toBeNull();
    expect(within(table).queryByText("Otros")).toBeNull();
    expect(screen.getByText("Gastos del día: $40.000")).toHaveClass("fin-day-expenses");
  });

  it("orden: Efectivo por área → Resumen del día → Gastos del día", () => {
    render(<CashDayPanel date={SUNDAY} status={status(MIXED)} transactions={MIXED} />);
    const order = [
      screen.getByRole("heading", { name: "Domingo 11 de octubre · Culto" }),
      areaRegion()!,
      summary(),
      screen.getByText("Gastos del día: $40.000"),
    ];
    for (let i = 1; i < order.length; i++)
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sin enlaces ni acciones para consultar movimientos individuales (con y sin manage)", () => {
    for (const onRegisterCash of [() => {}, undefined]) {
      const { container, unmount } = render(
        <CashDayPanel date={SUNDAY} status={status(MIXED)} transactions={MIXED} onRegisterCash={onRegisterCash} />,
      );
      expect(screen.queryByText(/Ver movimientos/)).toBeNull();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
      expect(container.querySelector("a, [href]")).toBeNull();
      // Las únicas acciones son registrar efectivo por área (solo con manage).
      for (const button of screen.queryAllByRole("button"))
        expect(button).toHaveAccessibleName(/^Registrar efectivo · /);
      if (!onRegisterCash) expect(screen.queryAllByRole("button")).toHaveLength(0);
      // Ningún movimiento individual: ni descripciones ni IDs.
      for (const t of MIXED) {
        expect(screen.queryByText(t.description)).toBeNull();
        expect(screen.queryByText(t.id)).toBeNull();
      }
      unmount();
    }
  });

  it("día sin movimientos: texto vacío, sin tabla, sin acción ni gastos", () => {
    render(<CashDayPanel date="2026-10-13" status={status([], "2026-10-13")} transactions={MIXED} />);
    expect(within(summary()).getByText("Sin movimientos activos este día.")).toBeInTheDocument();
    expect(within(summary()).queryByRole("table")).toBeNull();
    expect(screen.queryByText(/Ver movimientos/)).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByText(/Gastos del día/)).toBeNull();
    expect(areaRegion()).toBeNull(); // martes sin culto ni actividad de área
  });

  it("no muestra movimientos individuales (descripción, monto) ni 'Ver los N movimientos'", () => {
    const txs = [sumUp("a", 30000), sumUp("b", 25000), sumUp("c", 20000), sumUp("d", 10000)];
    render(<CashDayPanel date={SUNDAY} status={status(txs)} transactions={txs} onRegisterCash={() => {}} />);
    for (const t of txs) {
      expect(screen.queryByText(t.description)).toBeNull();
      expect(screen.queryByText(t.id)).toBeNull();
      expect(screen.queryByText(new Intl.NumberFormat("es-CL").format(t.amount), { exact: false })).toBeNull();
    }
    expect(screen.queryByText(/Ver los/)).toBeNull();
    expect(screen.queryByText(/Movimientos asociados|Causa/)).toBeNull();
    expect(document.querySelector(".fin-warning-movs, .fin-warning-card, .fin-warning-link")).toBeNull();
    // Solo el agregado del día ($85.000): SumUp y Total de la fila y del Total del día.
    expect(within(summary()).getAllByText("$85.000")).toHaveLength(4);
  });
});

describe("Panel del día · Efectivo por área", () => {
  const pendingAndRegistered = [sumUp("o1", 45000), tx({ id: "cash-c", amount: 125000, category: "Cafetería" })];

  it("pendiente vs registrado: textos, íconos neutros y sin 'Falta' ni advertencia", () => {
    expect(cashAreaRows(pendingAndRegistered, SUNDAY, status(pendingAndRegistered))).toEqual({
      show: true,
      rows: [
        { kind: "pending", area: "Ofrendas" },
        { kind: "registered", area: "Cafetería", cash: 125000 },
      ],
    });
    render(
      <CashDayPanel
        date={SUNDAY}
        status={status(pendingAndRegistered)}
        transactions={pendingAndRegistered}
        onRegisterCash={() => {}}
      />,
    );
    const [pending, registered] = within(areaRegion()!).getAllByRole("listitem");
    expect(pending).toHaveTextContent("Ofrendas");
    expect(pending).toHaveTextContent("Efectivo pendiente de confirmar");
    expect(pending).toHaveTextContent("SumUp registró ventas. El efectivo aún no se ha registrado.");
    expect(pending).not.toHaveTextContent("$");
    expect(pending.querySelector("svg")).toHaveClass("lucide-clock-3");
    expect(registered).toHaveTextContent("Cafetería");
    expect(registered).toHaveTextContent("Efectivo registrado");
    expect(registered).toHaveTextContent("$125.000");
    expect(registered.querySelector("svg")).toHaveClass("lucide-banknote");
    expect(within(registered).queryByRole("button")).toBeNull();
    const panel = areaRegion()!.closest(".fin-day-panel")!;
    expect(panel).not.toHaveTextContent(/Falta|advertencia/i);
    expect(panel.querySelector(".lucide-triangle-alert, [class*='warning']")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Domingo 11 de octubre: 1 pendiente");
    // No hay "Confirmar sin efectivo" ni botones deshabilitados de relleno.
    expect(screen.queryByText(/Confirmar sin efectivo/)).toBeNull();
    expect(panel.querySelector("button[disabled], button[aria-disabled='true']")).toBeNull();
  });

  it("el efectivo registrado del área es el agregado del día", () => {
    const txs = [
      tx({ id: "c1", amount: 100000 }),
      tx({ id: "c2", amount: 65000 }),
      sumUp("o", 30000),
    ];
    render(<CashDayPanel date={SUNDAY} status={status(txs)} transactions={txs} />);
    const rows = within(areaRegion()!).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Ofrendas·Efectivo registrado$165.000");
    expect(screen.getByRole("status")).toHaveTextContent("Domingo 11 de octubre: sin pendientes");
  });

  it("sin registros en día de culto: una sola fila y ambos botones con permiso", () => {
    const onRegisterCash = vi.fn();
    const tithe = [tx({ id: "t", amount: 50000, category: "Diezmos", source: "tithe" })];
    render(<CashDayPanel date={SUNDAY} status={status(tithe)} transactions={tithe} onRegisterCash={onRegisterCash} />);
    const rows = within(areaRegion()!).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Sin registros de Ofrendas ni Cafetería");
    expect(rows[0].querySelector("svg")).toHaveClass("lucide-circle-dashed");
    within(rows[0]).getByRole("button", { name: "Registrar efectivo · Ofrendas" }).click();
    within(rows[0]).getByRole("button", { name: "Registrar efectivo · Cafetería" }).click();
    expect(onRegisterCash.mock.calls).toEqual([["offerings"], ["cafeteria"]]);
    expect(screen.queryByText(/no registrar movimientos/)).toBeNull();
  });

  it("sin permiso: sin botones y una sola línea de solo lectura al final de la sección", () => {
    const both = [sumUp("o", 10000), sumUp("c", 20000, "Cafetería")];
    render(<CashDayPanel date={SUNDAY} status={status(both)} transactions={both} />);
    const region = areaRegion()!;
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    expect(within(region).queryAllByRole("button")).toHaveLength(0);
    const notes = within(region).getAllByText("Puedes revisar este día, pero no registrar movimientos.");
    expect(notes).toHaveLength(1);
    expect(region.lastElementChild).toBe(notes[0]);
    expect(screen.getByRole("status")).toHaveTextContent("Domingo 11 de octubre: 2 pendientes");
  });

  it("antes de SPLIT o en un día futuro no hay pendiente (mismas guardas que dayStatus)", () => {
    const before = [sumUp("x", 9000, "Ofrendas", "6")].map((t) => ({ ...t, period: "2026-09" }));
    const st = dayStatus("2026-09-06", before, TODAY);
    expect(st.pendingCashAreas).toEqual([]);
    expect(cashAreaRows(before, "2026-09-06", st).rows).toEqual([]);
    const future = [sumUp("f", 9000, "Ofrendas", "18")];
    const fs = dayStatus("2026-10-18", future, TODAY);
    expect(cashAreaRows(future, "2026-10-18", fs)).toEqual({ show: false, rows: [] });
  });
});
