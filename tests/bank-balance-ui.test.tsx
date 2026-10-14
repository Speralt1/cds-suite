// Tarjeta "Saldo bancario estimado" (doc 30): renderizados tipo "story" de cada
// estado con datos ficticios, más la tarjeta conectada con hooks simulados.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { computeBankBalance, PAYOUTS_NOT_CONNECTED, type BankBalanceInput } from "@/lib/finance/bank-balance";
import type { BankBalanceState } from "@/lib/finance/bank-hooks";

const state = vi.hoisted(() => ({
  access: { role: "admin", active: true } as Record<string, unknown>,
  hook: null as unknown as BankBalanceState,
  hookArgs: [] as unknown[],
}));
vi.mock("@/lib/auth/access-provider", () => ({ useAccess: () => state.access }));
vi.mock("@/lib/finance/bank-hooks", () => ({
  useBankBalance: (args: unknown) => {
    state.hookArgs.push(args);
    return state.hook;
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { BankBalanceCard, BankBalanceView, ymdLabel } from "@/components/finance/bank/bank-balance-card";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

function stateFrom(o: Partial<BankBalanceInput> = {}, extra: Partial<BankBalanceState> = {}): BankBalanceState {
  const result = computeBankBalance({
    account: { openingBalance: 1_250_000, openingDate: "2026-09-30", openingCash: null },
    ledger: [
      { id: "a", type: "income", amount: 200_000, paymentMethod: "transfer", status: "active", period: "2026-10", day: "5" },
      { id: "b", type: "income", amount: 80_000, paymentMethod: "cash", status: "active", period: "2026-10", day: "5" },
      { id: "c", type: "expense", amount: 50_000, paymentMethod: "transfer", status: "active", period: "2026-10", day: "6" },
    ],
    treasury: [],
    payouts: PAYOUTS_NOT_CONNECTED,
    asOf: "2026-10-13",
    accountId: "main",
    ...o,
  });
  return { loading: false, error: "", account: null, result, limitReached: false, ...extra };
}
const LOADING: BankBalanceState = { loading: true, error: "", account: null, result: null, limitReached: false };

describe("BankBalanceView (stories)", () => {
  it("cargando: estado accesible sin cifras", () => {
    render(<BankBalanceView state={LOADING} canConfigure />);
    expect(screen.getByRole("status", { name: "Cargando saldo bancario estimado" })).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("error: mensaje con role=alert y sin montos", () => {
    render(<BankBalanceView state={{ ...LOADING, loading: false, error: "La consulta necesita un índice de Firestore." }} canConfigure />);
    expect(screen.getByRole("alert")).toHaveTextContent(/No pudimos calcular el saldo estimado\. La consulta necesita un índice/);
  });

  it("sin configurar (admin): 'Saldo pendiente de configurar' + botón a Configuración, sin monto de banco", () => {
    render(<BankBalanceView state={stateFrom({ account: null })} canConfigure periodResult={{ label: "Octubre 2026", value: 230_000 }} />);
    const bank = screen.getByTestId("bank-figure");
    expect(within(bank).getByText("Saldo pendiente de configurar")).toBeInTheDocument();
    expect(within(bank).queryByText(/\$/)).not.toBeInTheDocument();
    expect(within(bank).getByRole("link", { name: "Configurar saldo inicial" })).toHaveAttribute("href", "/configuracion/finanzas#banco-y-caja");
    expect(within(screen.getByTestId("cash-figure")).getByText("Sin fecha de corte")).toBeInTheDocument();
    expect(within(screen.getByTestId("result-figure")).getByText("$230.000")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cómo se calcula/ })).not.toBeInTheDocument();
  });

  it("sin configurar (no admin): explica quién debe configurarlo, sin botón", () => {
    render(<BankBalanceView state={stateFrom({ account: null })} canConfigure={false} />);
    expect(screen.queryByRole("link", { name: "Configurar saldo inicial" })).not.toBeInTheDocument();
    expect(screen.getByText(/Debe configurarlo un administrador en Configuración › Finanzas › Banco y caja/)).toBeInTheDocument();
  });

  it("parcial (sin abonos SumUp): cifra con 'Estimado', corte e 'Incompleto: faltan abonos SumUp' en texto", () => {
    render(<BankBalanceView state={stateFrom()} canConfigure />);
    const bank = screen.getByTestId("bank-figure");
    expect(within(bank).getByText("$1.400.000")).toBeInTheDocument();
    expect(within(bank).getByText("Estimado")).toBeInTheDocument();
    expect(within(bank).getByText("Corte 30-09-2026")).toBeInTheDocument();
    expect(within(bank).getByText("Incompleto: faltan abonos SumUp")).toBeInTheDocument();
    expect(within(screen.getByTestId("cash-figure")).getByText("$80.000")).toBeInTheDocument();
    expect(within(screen.getByTestId("cash-figure")).getByText(/Solo lo registrado desde el 30-09-2026/)).toBeInTheDocument();
    expect(within(screen.getByTestId("sumup-figure")).getByText("Sin dato de SumUp")).toBeInTheDocument();
    expect(within(screen.getByTestId("result-figure")).getByText("—")).toBeInTheDocument();
  });

  it("completo con abonos: sin aviso de incompleto y con SumUp pendiente bruto", () => {
    render(
      <BankBalanceView
        state={stateFrom({
          payouts: {
            status: "available",
            pendingDeposit: 45_000,
            payouts: [{ id: "p1", payoutDate: "2026-10-07", netPaid: 97_000, fee: 3_000, status: "SUCCESSFUL" }],
          },
        })}
        canConfigure
      />,
    );
    expect(within(screen.getByTestId("bank-figure")).getByText("$1.497.000")).toBeInTheDocument();
    expect(screen.queryByText(/Incompleto/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("sumup-figure")).getByText("$45.000")).toBeInTheDocument();
  });

  it("saldo negativo: además del color, texto '(negativo)' para lectores de pantalla", () => {
    render(<BankBalanceView state={stateFrom({ account: { openingBalance: -900_000, openingDate: "2026-09-30", openingCash: null }, ledger: [] })} canConfigure />);
    expect(within(screen.getByTestId("bank-figure")).getByText("(negativo)")).toBeInTheDocument();
  });

  it("límite alcanzado se informa honestamente", () => {
    render(<BankBalanceView state={stateFrom({ ledgerTruncated: true }, { limitReached: true })} canConfigure />);
    expect(screen.getByText(/Límite alcanzado/)).toBeInTheDocument();
  });

  it("¿Cómo se calcula?: hoja con cada línea, signo en texto y total", () => {
    render(<BankBalanceView state={stateFrom()} canConfigure />);
    fireEvent.click(screen.getByRole("button", { name: /Cómo se calcula/ }));
    const dialog = screen.getByRole("dialog", { name: "¿Cómo se calcula?" });
    const lists = within(dialog).getAllByRole("list");
    const bankItems = within(lists[0]).getAllByRole("listitem");
    expect(bankItems[0]).toHaveTextContent("Saldo inicial según cartola");
    expect(bankItems[0]).toHaveTextContent("$1.250.000");
    expect(within(lists[0]).getByText("Abonos SumUp recibidos (neto)").parentElement).toHaveTextContent("No disponible");
    expect(within(lists[0]).getAllByLabelText("resta").length).toBeGreaterThan(0);
    expect(bankItems.at(-1)).toHaveTextContent("Saldo bancario estimado$1.400.000");
    expect(within(dialog).getByText(/Faltan los abonos SumUp/)).toBeInTheDocument();
    expect(within(dialog).getByText(/no es dinero en el banco/)).toBeInTheDocument();
  });

  it("ymdLabel", () => {
    expect(ymdLabel("2026-09-30")).toBe("30-09-2026");
    expect(ymdLabel(null)).toBe("—");
  });
});

describe("BankBalanceCard (conectada)", () => {
  beforeEach(() => {
    state.hookArgs = [];
    state.hook = stateFrom({ account: null });
  });
  it("líder (solo resumen): no renderiza nada y no habilita la consulta", () => {
    state.access = { role: "leader", active: true };
    const { container } = render(<BankBalanceCard />);
    expect(container).toBeEmptyDOMElement();
    expect(state.hookArgs.at(-1)).toMatchObject({ enabled: false });
  });
  it("finanzas: ve la tarjeta pero no el botón de configurar", () => {
    state.access = { role: "finance", active: true };
    render(<BankBalanceCard periodResult={{ label: "Octubre 2026", value: -5_000 }} />);
    expect(screen.getByText("Saldo pendiente de configurar")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Configurar saldo inicial" })).not.toBeInTheDocument();
    expect(state.hookArgs.at(-1)).toMatchObject({ enabled: true, accountId: "main" });
  });
  it("admin: ve el botón de configurar", () => {
    state.access = { role: "admin", active: true };
    render(<BankBalanceCard />);
    expect(screen.getByRole("link", { name: "Configurar saldo inicial" })).toBeInTheDocument();
  });
});
