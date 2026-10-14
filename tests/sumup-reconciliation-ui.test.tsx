// Panel "Conciliación SumUp" (doc 29): estados de carga, éxito, pendiente,
// revisión, error de cuenta y Function no disponible. Solo lectura.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcile } from "@/lib/shared/sumup-payouts";
import { clp as clpText } from "@/lib/finance/formatters";
import type { PayoutsResponse } from "@/lib/offerings/payouts-client";
import { cafeteriaCase, groupedOfferingsCase, row, sale } from "./functions/sumup-payouts-fixtures";

const requestMock = vi.fn();

vi.mock("@/lib/firebase", () => ({ getFirebaseFunctions: () => ({}) }));
vi.mock("@/lib/finance/formatters", async (orig) => ({
  ...(await orig<typeof import("@/lib/finance/formatters")>()),
  today: () => "2026-10-20",
}));
vi.mock("@/lib/offerings/payouts-client", async (orig) => ({
  ...(await orig<typeof import("@/lib/offerings/payouts-client")>()),
  requestPayoutsReconciliation: (...args: unknown[]) => requestMock(...args),
}));

const { SumUpReconciliationPanel } = await import("@/components/finance/offerings/sumup-reconciliation-panel");

function response(over: { pendingOfferings?: boolean; reviewOfferings?: boolean; failCafeteria?: string } = {}): PayoutsResponse {
  const caf = cafeteriaCase();
  const ofr = groupedOfferingsCase();
  const ofrSales = [...ofr.sales];
  const ofrRows = [...ofr.rows];
  if (over.pendingOfferings) ofrSales.push(sale("offerings", "PEND1", "2026-10-18", 12_000));
  if (over.reviewOfferings) ofrRows.push(row(null, 2000, 0, "2026-10-15", "FICT DED", { id: "ded", type: "REFUND_DEDUCTION" }));
  const accounts = over.failCafeteria ? (["offerings"] as const) : (["offerings", "cafeteria"] as const);
  const result = reconcile({
    accounts: [...accounts],
    rowsByAccount: { offerings: ofrRows, cafeteria: caf.rows },
    salesByAccount: { offerings: ofrSales, cafeteria: caf.sales },
    period: { startDate: "2026-10-01", endDate: "2026-10-31" },
    asOfDate: "2026-10-20",
  });
  const accountResults: PayoutsResponse["accounts"] = result.accounts.map((a) => ({ ok: true as const, errorClass: null, ...a }));
  if (over.failCafeteria) accountResults.push({ ok: false, account: "cafeteria", errorClass: over.failCafeteria });
  return {
    readOnly: true,
    period: result.period,
    payoutFetch: { startDate: "2026-10-01", endDate: "2026-10-20" },
    asOfDate: "2026-10-20",
    policy: result.policy,
    differenceBusinessDays: result.differenceBusinessDays,
    accounts: accountResults,
    totals: result.totals,
  };
}

async function openPanel(date = "2026-10-15") {
  const utils = render(<SumUpReconciliationPanel selectedDate={date} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Consultar abonos" }));
  });
  return utils;
}

// Llaves: mockReset() devuelve el mock y vitest trataría ese retorno como teardown.
beforeEach(() => {
  requestMock.mockReset();
});

/** Rechazo creado en el momento de la llamada (como lo haría httpsCallable). */
function rejectWith(error: Error) {
  requestMock.mockImplementation(() => Promise.reject(error));
}

describe("Conciliación SumUp — panel de solo lectura", () => {
  it("no consulta nada hasta que la persona lo pide", () => {
    render(<SumUpReconciliationPanel selectedDate="2026-10-15" />);
    expect(screen.getByRole("heading", { name: "Conciliación SumUp" })).toBeInTheDocument();
    expect(screen.getByText("SOLO LECTURA")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("consulta el mes visible completo y muestra el estado de carga", async () => {
    let resolve: (v: PayoutsResponse) => void = () => {};
    requestMock.mockReturnValue(new Promise<PayoutsResponse>((r) => (resolve = r)));
    await openPanel();
    expect(requestMock).toHaveBeenCalledWith({ account: "both", startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(screen.getByRole("status")).toHaveTextContent("Consultando abonos de SumUp…");
    await act(async () => resolve(response()));
    expect(screen.queryByText("Consultando abonos de SumUp…")).not.toBeInTheDocument();
  });

  it("caso Cafetería: bruto, comisión SumUp, abono neto y estado con ícono + texto", async () => {
    requestMock.mockResolvedValue(response());
    await openPanel();
    const caf = screen.getByTestId("recon-cafeteria");
    const rowEl = within(caf).getByTestId("settlement-row");
    expect(rowEl).toHaveTextContent("13-10");
    expect(rowEl).toHaveTextContent("11-10");
    expect(rowEl).toHaveTextContent("$462.500");
    expect(rowEl).toHaveTextContent("$15.968");
    expect(rowEl).toHaveTextContent("$446.532");
    const status = within(rowEl).getByText("Conciliado");
    expect(status.closest("[data-status]")).toHaveAttribute("data-status", "CONCILIADO");
    expect(status.closest("[data-status]")?.querySelector("svg")).not.toBeNull();
    expect(within(caf).getByTestId("pending-cafeteria")).toHaveTextContent("$0");
  });

  it("abono agrupado: muestra los dos días de venta", async () => {
    requestMock.mockResolvedValue(response());
    await openPanel();
    const rowEl = within(screen.getByTestId("recon-offerings")).getByTestId("settlement-row");
    expect(rowEl).toHaveTextContent("10-10, 11-10");
    expect(rowEl).toHaveTextContent("$100.522");
    expect(rowEl).toHaveTextContent("$97.170");
  });

  it("ventas por abonar: 'SumUp pendiente de abono' y comisión 'pendiente' (nunca $0)", async () => {
    requestMock.mockResolvedValue(response({ pendingOfferings: true }));
    await openPanel();
    const ofr = screen.getByTestId("recon-offerings");
    expect(within(ofr).getByTestId("pending-offerings")).toHaveTextContent("$12.000 · comisión pendiente");
    const pending = within(ofr).getByTestId("pending-row");
    expect(pending).toHaveTextContent("Por abonar");
    expect(pending).toHaveTextContent("pendiente");
    expect(within(pending).getByText("Pendiente")).toBeInTheDocument();
  });

  it("deducciones: 'Requiere revisión' con motivo, ajuste negativo y comisión sin confirmar en el total", async () => {
    requestMock.mockResolvedValue(response({ reviewOfferings: true }));
    await openPanel();
    const ofr = screen.getByTestId("recon-offerings");
    expect(within(ofr).getByText("Requiere revisión")).toBeInTheDocument();
    expect(within(ofr).getByText(/descuentos de SumUp/)).toBeInTheDocument();
    expect(within(ofr).getAllByText(clpText(-2000)).length).toBeGreaterThan(0);
    expect(within(ofr).getByText("$3.352 · sin confirmar")).toBeInTheDocument();
  });

  it("una cuenta con error no rompe la otra", async () => {
    requestMock.mockResolvedValue(response({ failCafeteria: "provider_unavailable" }));
    await openPanel();
    expect(within(screen.getByTestId("recon-cafeteria")).getByText(/SumUp no respondió a tiempo/)).toBeInTheDocument();
    expect(within(screen.getByTestId("recon-offerings")).getByTestId("settlement-row")).toBeInTheDocument();
  });

  it("Function no desplegada / error → 'Conciliación SumUp aún no disponible' (sin alarma)", async () => {
    rejectWith(Object.assign(new Error("internal"), { code: "functions/internal" }));
    await openPanel();
    const msg = screen.getByText(/Conciliación SumUp aún no disponible/);
    expect(msg).toHaveClass("field-help");
    expect(msg).not.toHaveClass("notice-warning");
  });

  it.each([["functions/not-found"], ["functions/unavailable"]])("%s → no disponible", async (code) => {
    rejectWith(Object.assign(new Error("x"), { code }));
    await openPanel();
    expect(screen.getByText(/aún no disponible/)).toBeInTheDocument();
  });

  it("sin permiso → mensaje claro", async () => {
    rejectWith(Object.assign(new Error("sumup-payouts/forbidden"), { code: "functions/permission-denied" }));
    await openPanel();
    expect(screen.getByText("No tienes permiso para ver la conciliación SumUp.")).toBeInTheDocument();
  });

  it("al cambiar de mes vuelve a consultar ese mes; 'Actualizar' repite la consulta", async () => {
    requestMock.mockResolvedValue(response());
    const { rerender } = await openPanel("2026-10-15");
    await act(async () => rerender(<SumUpReconciliationPanel selectedDate="2026-09-03" />));
    expect(requestMock).toHaveBeenLastCalledWith({ account: "both", startDate: "2026-09-01", endDate: "2026-09-30" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Actualizar/ })));
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it("mes futuro: no consulta", () => {
    render(<SumUpReconciliationPanel selectedDate="2026-11-02" />);
    expect(screen.getByText("Aún no hay abonos para este mes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Consultar abonos" })).not.toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });
});
