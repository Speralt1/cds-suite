// Configuración › Finanzas › Banco y caja (doc 30): saldo inicial con
// confirmación, tesorería y conciliación que nunca ajusta sola. Hooks y
// escrituras simulados; datos ficticios.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeBankBalance, PAYOUTS_NOT_CONNECTED } from "@/lib/finance/bank-balance";

const TODAY = "2026-10-13";
const s = vi.hoisted(() => ({
  access: { role: "admin", active: true } as Record<string, unknown>,
  account: null as null | Record<string, unknown>,
  treasury: [] as unknown[],
  payouts: { status: "unavailable", reason: "no conectada" } as unknown,
  estimateError: "",
  saveBankAccount: vi.fn(async () => 1),
  createTreasuryTransfer: vi.fn(async () => "t1"),
  voidTreasuryTransfer: vi.fn(async () => undefined),
  createReconciliation: vi.fn(async () => "r1"),
}));
vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: { kind: "db" } }) }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { uid: "me" } }) }));
vi.mock("@/lib/auth/access-provider", () => ({ useAccess: () => s.access }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/finance/bank-accounts", () => ({
  saveBankAccount: s.saveBankAccount,
  createTreasuryTransfer: s.createTreasuryTransfer,
  voidTreasuryTransfer: s.voidTreasuryTransfer,
  createReconciliation: s.createReconciliation,
}));
vi.mock("@/lib/finance/bank-hooks", () => {
  const empty = { data: [], loading: false, error: "", synced: true };
  return {
    santiagoToday: () => "2026-10-13",
    useBankAccount: () => ({ data: s.account, loading: false, error: "" }),
    useBankHistory: () => empty,
    useRecentTreasury: () => ({ ...empty, data: s.treasury }),
    useRecentReconciliations: () => empty,
    useBankBalance: ({ asOf, payouts }: { asOf?: string; payouts?: unknown }) =>
      s.estimateError
        ? { loading: false, error: s.estimateError, account: s.account, limitReached: false, result: null }
        : {
            loading: false,
            error: "",
            account: s.account,
            limitReached: false,
            result: computeBankBalance({
              account: s.account as never,
              ledger: [],
              treasury: [],
              payouts: (payouts as never) ?? PAYOUTS_NOT_CONNECTED,
              asOf: asOf ?? "2026-10-13",
            }),
          },
  };
});
vi.mock("@/lib/finance/sumup-payouts-client", () => ({ useSumupPayoutsForBank: () => s.payouts }));

import { BankCashSettingsPanel } from "@/components/settings/bank-cash-settings-panel";

const ACCOUNT = {
  id: "main",
  name: "Cuenta corriente principal",
  openingBalance: 1_000_000,
  openingDate: "2026-09-30",
  openingCash: null,
  statementReference: "",
  revision: 2,
};

beforeEach(() => {
  s.payouts = { status: "unavailable", reason: "no conectada" };
  s.estimateError = "";
  s.access = { role: "admin", active: true };
  s.account = null;
  s.treasury = [];
  for (const fn of [s.saveBankAccount, s.createTreasuryTransfer, s.voidTreasuryTransfer, s.createReconciliation]) fn.mockClear();
});

describe("Saldo inicial", () => {
  it("sin configurar: pide revisión y confirmación antes de guardar (r0 → r1)", async () => {
    render(<BankCashSettingsPanel />);
    expect(screen.getAllByText("Saldo pendiente de configurar.").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Configurar saldo inicial" }));
    fireEvent.change(screen.getByLabelText("Saldo según cartola (CLP)"), { target: { value: "1.250.000" } });
    fireEvent.change(screen.getByLabelText("Fecha de corte"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));
    const confirm = screen.getByRole("group", { name: "Confirmar saldo inicial" });
    expect(confirm).toHaveTextContent("$1.250.000");
    expect(confirm).toHaveTextContent("30-09-2026");
    expect(s.saveBankAccount).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirmar y guardar" }));
    await waitFor(() => expect(s.saveBankAccount).toHaveBeenCalledTimes(1));
    expect(s.saveBankAccount).toHaveBeenCalledWith(
      { kind: "db" },
      "me",
      "main",
      { name: "Cuenta corriente principal", openingBalance: 1_250_000, openingDate: "2026-09-30", openingCash: null, statementReference: "" },
      { expectedRevision: 0, reason: "", today: TODAY },
    );
    expect(await screen.findByText(/Saldo inicial configurado/)).toBeInTheDocument();
  });

  it("saldo negativo exige confirmar el sobregiro", () => {
    render(<BankCashSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Configurar saldo inicial" }));
    fireEvent.change(screen.getByLabelText("Saldo según cartola (CLP)"), { target: { value: "-50000" } });
    fireEvent.change(screen.getByLabelText("Fecha de corte"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/sobregiro/);
    fireEvent.click(screen.getByLabelText(/saldo negativo/));
    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));
    expect(screen.getByRole("group", { name: "Confirmar saldo inicial" })).toHaveTextContent("$-50.000");
  });

  it("fecha futura se rechaza", () => {
    render(<BankCashSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Configurar saldo inicial" }));
    fireEvent.change(screen.getByLabelText("Saldo según cartola (CLP)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Fecha de corte"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/futuro/);
  });

  it("cambiar un saldo existente exige motivo y usa la revisión vista", async () => {
    s.account = ACCOUNT;
    render(<BankCashSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar saldo inicial" }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/motivo/);
    fireEvent.change(screen.getByLabelText("Motivo del cambio"), { target: { value: "Cartola corregida" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y guardar" }));
    await waitFor(() => expect(s.saveBankAccount).toHaveBeenCalled());
    expect((s.saveBankAccount.mock.calls[0] as unknown[])[4]).toEqual({ expectedRevision: 2, reason: "Cartola corregida", today: TODAY });
  });

  it("sin settings.manage no hay botón de configurar", () => {
    s.access = { role: "finance", active: true };
    render(<BankCashSettingsPanel />);
    expect(screen.queryByRole("button", { name: /saldo inicial/ })).not.toBeInTheDocument();
  });
});

describe("Tesorería y conciliación", () => {
  beforeEach(() => {
    s.account = ACCOUNT;
  });

  it("un ajuste exige sentido y motivo de 10+ caracteres", async () => {
    render(<BankCashSettingsPanel />);
    fireEvent.change(screen.getByLabelText("Tipo de movimiento"), { target: { value: "adjustment" } });
    fireEvent.change(screen.getByLabelText("Monto (CLP)"), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar movimiento" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/suma o resta/);
    fireEvent.click(screen.getByLabelText("Resta al banco"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar movimiento" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/10 caracteres/);
    fireEvent.change(screen.getByLabelText(/Motivo del ajuste/), { target: { value: "Comisión de mantención" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar movimiento" }));
    await waitFor(() => expect(s.createTreasuryTransfer).toHaveBeenCalledTimes(1));
    expect((s.createTreasuryTransfer.mock.calls[0] as unknown[])[2]).toMatchObject({
      type: "adjustment",
      direction: "out",
      amount: 1500,
      date: TODAY,
      reason: "Comisión de mantención",
    });
  });

  it("sin abonos SumUp: guarda la conciliación pero NO ofrece ajuste (evita contar dos veces)", async () => {
    render(<BankCashSettingsPanel />);
    fireEvent.change(screen.getByLabelText("Saldo que muestra el banco (CLP)"), { target: { value: "1.090.000" } });
    expect(screen.getByText("+ $90.000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar conciliación" }));
    await waitFor(() => expect(s.createReconciliation).toHaveBeenCalledTimes(1));
    expect((s.createReconciliation.mock.calls[0] as unknown[])[2]).toMatchObject({
      reportedBalance: 1_090_000,
      expectedBalance: 1_000_000,
      estimateComplete: false,
      openingRevision: 2,
    });
    expect(await screen.findByText(/No ajustes: el estimado no incluye abonos SumUp/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preparar ajuste manual" })).not.toBeInTheDocument();
  });

  it("el formulario de ajuste advierte mientras los abonos SumUp no están", () => {
    render(<BankCashSettingsPanel />);
    fireEvent.change(screen.getByLabelText("Tipo de movimiento"), { target: { value: "adjustment" } });
    expect(screen.getByText(/se contaría dos veces/)).toBeInTheDocument();
  });

  it("con abonos completos: muestra la diferencia, guarda la foto y solo PREPARA el ajuste con la fecha de la conciliación", async () => {
    s.payouts = { status: "available", payouts: [], pendingDeposit: 0, coverageFrom: "2026-10-01", coverageTo: "2026-10-13", partialReasons: [], warnings: [] };
    render(<BankCashSettingsPanel />);
    fireEvent.change(screen.getByLabelText("Tipo de movimiento"), { target: { value: "adjustment" } });
    expect(screen.queryByText(/se contaría dos veces/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tipo de movimiento"), { target: { value: "cash_deposit" } });
    fireEvent.change(screen.getByLabelText("Fecha del saldo del banco"), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText("Saldo que muestra el banco (CLP)"), { target: { value: "990.000" } });
    expect(screen.getByText("− $10.000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar conciliación" }));
    await waitFor(() => expect(s.createReconciliation).toHaveBeenCalledTimes(1));
    expect((s.createReconciliation.mock.calls[0] as unknown[])[2]).toMatchObject({ estimateComplete: true, date: "2026-10-10" });
    fireEvent.click(await screen.findByRole("button", { name: "Preparar ajuste manual" }));
    expect(screen.getByLabelText("Tipo de movimiento")).toHaveValue("adjustment");
    expect(screen.getByLabelText("Resta al banco")).toBeChecked();
    expect(screen.getByLabelText("Monto (CLP)")).toHaveValue("10000");
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-10-10");
    expect(s.createTreasuryTransfer).not.toHaveBeenCalled();
  });

  it("conciliación en el día de corte: sugiere corregir el saldo inicial, no un ajuste", async () => {
    s.payouts = { status: "available", payouts: [], pendingDeposit: 0, coverageFrom: "2026-10-01", coverageTo: "2026-10-13", partialReasons: [], warnings: [] };
    render(<BankCashSettingsPanel />);
    fireEvent.change(screen.getByLabelText("Fecha del saldo del banco"), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText("Saldo que muestra el banco (CLP)"), { target: { value: "990.000" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar conciliación" }));
    expect(await screen.findByText(/corrige el saldo inicial/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preparar ajuste manual" })).not.toBeInTheDocument();
  });

  it("si el estimado falló (p. ej. índice faltante) no se puede conciliar", () => {
    s.estimateError = "La consulta necesita un índice de Firestore.";
    render(<BankCashSettingsPanel />);
    expect(screen.getByText(/No se puede conciliar: no pudimos calcular el saldo estimado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar conciliación" })).not.toBeInTheDocument();
    expect(s.createReconciliation).not.toHaveBeenCalled();
  });

  it("anular un movimiento pide motivo", async () => {
    s.treasury = [
      { id: "t9", accountId: "main", type: "cash_deposit", direction: "in", amount: 70_000, date: "2026-10-05", note: "", reason: "", status: "active", revision: 1 },
    ];
    render(<BankCashSettingsPanel />);
    const list = screen.getByRole("list", { name: "Últimos movimientos de tesorería" });
    expect(list).toHaveTextContent("Banco + · Caja −");
    fireEvent.click(within(list).getByRole("button", { name: "Anular" }));
    const confirm = within(list).getByRole("button", { name: "Confirmar anulación" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(list).getByLabelText("Motivo de la anulación"), { target: { value: "Duplicado" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(s.voidTreasuryTransfer).toHaveBeenCalledWith({ kind: "db" }, "me", s.treasury[0], "Duplicado"));
  });

  it("líder sin detalle financiero no puede registrar ni conciliar", () => {
    s.access = { role: "leader", active: true };
    render(<BankCashSettingsPanel />);
    expect(screen.queryByRole("button", { name: "Registrar movimiento" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar conciliación" })).not.toBeInTheDocument();
  });
});
