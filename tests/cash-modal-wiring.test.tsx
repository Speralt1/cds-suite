// R0E — the cash modal as the real pages wire it: real SummaryPage /
// OfferingsPage, real useCollection/useTransactions, and a scripted Firestore
// listener layer that delivers cache and server snapshots asynchronously.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
import { SummaryPage } from "@/components/finance/dashboard/summary-page";
import { OfferingsPage } from "@/components/finance/offerings/offerings-page";
import { FinanceDataCacheProvider } from "@/lib/finance/hooks";
import { parseDate } from "@/lib/finance/formatters";
import type { CashArea } from "@/lib/offerings/cash";
import type { FinanceTransaction } from "@/lib/finance/types";

type Listener = {
  ref: { name?: string; cs?: { kind: string; field?: string; value?: unknown }[] };
  next: (snapshot: unknown) => void;
  active: boolean;
};

const fs = vi.hoisted(() => ({ listeners: [] as Listener[], save: vi.fn() }));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "test", email: "test@cds.test" } }),
}));
vi.mock("@/lib/auth/access-provider", () => ({
  useAccess: () => ({ role: "admin", active: true }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/finanzas",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/components/finance/charts/finance-charts", () => ({ FinanceCharts: () => null }));
vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: {} }) }));
vi.mock("@/lib/finance/transactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/transactions")>()),
  saveTransaction: fs.save,
}));
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/firestore")>()),
  collection: (_db: unknown, name: string) => ({ name }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  documentId: () => "__name__",
  query: (col: { name: string }, ...cs: unknown[]) => ({ name: col.name, cs }),
  where: (field: string, _op: string, value: unknown) => ({ kind: "where", field, value }),
  orderBy: () => ({ kind: "orderBy" }),
  limit: (value: number) => ({ kind: "limit", value }),
  onSnapshot: (ref: Listener["ref"], ...rest: unknown[]) => {
    const next = rest.find((item) => typeof item === "function") as Listener["next"];
    const listener: Listener = { ref, next, active: true };
    fs.listeners.push(listener);
    return () => {
      listener.active = false;
    };
  },
}));

HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
  this.open = false;
};

function record(area: CashArea, date: string, amount: number, note: string): FinanceTransaction {
  return {
    id: `cash_${area}_${date}`,
    type: "income",
    status: "active",
    paymentMethod: "cash",
    category: area === "offerings" ? "Ofrendas" : "Cafetería",
    description: area === "offerings" ? "Ofrendas en efectivo" : "Cafetería en efectivo",
    note,
    amount,
    source: "general",
    revision: 1,
    createdBy: "uid-1",
    createdAt: Timestamp.fromMillis(1000),
    updatedBy: "uid-1",
    updatedAt: Timestamp.fromMillis(1000),
    period: date.slice(0, 7),
    day: String(Number(date.slice(8, 10))),
    date: parseDate(date),
  };
}

// Delivers a snapshot to every active financeTransactions listener of `period`.
function emit(period: string, docs: FinanceTransaction[], fromCache = false, includeCancelled = false) {
  const targets = fs.listeners.filter(
    (l) =>
      (l.active || includeCancelled) &&
      l.ref.name === "financeTransactions" &&
      l.ref.cs?.some((c) => c.kind === "where" && c.field === "period" && c.value === period),
  );
  act(() => {
    for (const l of targets) {
      l.next({
        docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
        metadata: { fromCache, hasPendingWrites: false },
      });
    }
  });
  return targets.length;
}

const dialog = () => screen.getByRole("dialog");
const amountField = () => within(dialog()).queryByRole("textbox", { name: "Efectivo recaudado" });
const noteField = () => within(dialog()).getByRole("textbox", { name: "Nota (opcional)" });
const dateField = () => within(dialog()).getByLabelText(/Fecha correspondiente/);
const modalTitle = () => within(dialog()).getByRole("heading", { level: 2 }).textContent;

function expectWaiting() {
  expect(modalTitle()).toBe("Registrar efectivo · Ofrendas");
  expect(amountField()).toBeNull();
  expect(within(dialog()).getByRole("button", { name: "Guardar efectivo" })).toBeDisabled();
  fireEvent.submit(dialog().querySelector("form")!);
  expect(fs.save).not.toHaveBeenCalled();
}

beforeEach(() => {
  fs.listeners.length = 0;
  fs.save.mockReset();
  fs.save.mockResolvedValue(undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 12)); // miércoles 7 oct 2026, día de culto
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(() => vi.useRealTimers());

function renderSummary() {
  return render(
    <FinanceDataCacheProvider>
      <SummaryPage />
    </FinanceDataCacheProvider>,
  );
}

describe("Resumen — Registrar efectivo", () => {
  it("MINOR-1: con el mes sin cargar el modal espera; un snapshot de caché no basta; al llegar el del servidor prellena el registro", async () => {
    renderSummary();
    fireEvent.click(screen.getByRole("button", { name: "+ Registrar efectivo" }));
    expectWaiting();

    const existing = record("offerings", "2026-10-07", 50000, "Culto miércoles");
    // Partial local cache (record not there yet): still not writable.
    expect(emit("2026-10", [], true)).toBeGreaterThan(0);
    expectWaiting();

    emit("2026-10", [existing]);
    expect(modalTitle()).toBe("Editar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("50000");
    expect(noteField()).toHaveValue("Culto miércoles");

    fireEvent.click(within(dialog()).getByRole("button", { name: "Actualizar efectivo" }));
    await vi.waitFor(() => expect(fs.save).toHaveBeenCalledTimes(1));
    const [, , id, input, options] = fs.save.mock.calls[0];
    expect(id).toBe("cash_offerings_2026-10-07");
    expect(input).toMatchObject({ amount: 50000, note: "Culto miércoles" });
    expect(options.existing).toMatchObject({ id: existing.id, revision: 1, amount: 50000 });
  });

  it("MINOR-1: al cambiar a un mes no cargado espera ese mes e ignora snapshots tardíos del mes anterior", () => {
    renderSummary();
    fireEvent.click(screen.getByRole("button", { name: "+ Registrar efectivo" }));
    emit("2026-10", []);
    expect(modalTitle()).toBe("Ingresar efectivo · Ofrendas");
    fireEvent.change(amountField()!, { target: { value: "99999" } });

    fireEvent.change(dateField(), { target: { value: "2026-09-27" } });
    expectWaiting();
    // A late October snapshot, even one delivered to the cancelled October
    // listener of the modal, does not make September writable.
    emit("2026-10", [record("offerings", "2026-10-07", 1, "tarde")], false, true);
    expectWaiting();

    emit("2026-09", [record("offerings", "2026-09-27", 20000, "Septiembre")]);
    expect(modalTitle()).toBe("Editar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("20000");
    expect(noteField()).toHaveValue("Septiembre");
  });

  it("MINOR-2: al reabrir no usa el snapshot retenido de la apertura anterior", () => {
    renderSummary();
    fireEvent.click(screen.getByRole("button", { name: "+ Registrar efectivo" }));
    emit("2026-10", []);
    expect(modalTitle()).toBe("Ingresar efectivo · Ofrendas");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    // Recorded meanwhile (the modal's own listener is closed).
    const existing = record("offerings", "2026-10-07", 50000, "Registrado en otro equipo");
    emit("2026-10", [existing]);

    fireEvent.click(screen.getByRole("button", { name: "+ Registrar efectivo" }));
    expectWaiting();
    expect(within(dialog()).queryByText("Registrar efectivo")).toBeNull();

    emit("2026-10", [existing]);
    expect(modalTitle()).toBe("Editar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("50000");
    expect(noteField()).toHaveValue("Registrado en otro equipo");
  });

  it("MINOR-3: borrar la fecha muestra validación, la página sigue estable y se recupera", () => {
    renderSummary();
    fireEvent.click(screen.getByRole("button", { name: "+ Registrar efectivo" }));
    emit("2026-10", [record("offerings", "2026-10-04", 30000, "Domingo")]);

    fireEvent.change(dateField(), { target: { value: "" } });
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Ingresa la fecha correspondiente para continuar.");
    expect(screen.getByRole("heading", { name: "Resumen financiero" })).toBeInTheDocument();
    expect(fs.save).not.toHaveBeenCalled();

    fireEvent.change(dateField(), { target: { value: "2026-10-04" } });
    expect(amountField()).toHaveValue("30000");
  });
});

describe("Ofrendas y Cafetería — Caja del día", () => {
  function renderOfferings() {
    return render(
      <FinanceDataCacheProvider>
        <OfferingsPage />
      </FinanceDataCacheProvider>,
    );
  }

  it("abre el registro existente prellenado y cambiar de área carga el del área", () => {
    renderOfferings();
    emit("2026-10", [
      record("offerings", "2026-10-07", 50000, "Ofrenda"),
      record("cafeteria", "2026-10-07", 80000, "Venta"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Editar efectivo · \$50\.000/ }));
    expect(modalTitle()).toBe("Editar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("50000");

    fireEvent.change(within(dialog()).getByRole("combobox", { name: "Área" }), { target: { value: "cafeteria" } });
    expect(modalTitle()).toBe("Editar efectivo · Cafetería");
    expect(amountField()).toHaveValue("80000");
    expect(noteField()).toHaveValue("Venta");
  });

  it("MINOR-3: borrar la fecha de la página no rompe la pantalla ni la caja del día", () => {
    renderOfferings();
    emit("2026-10", [record("offerings", "2026-10-07", 50000, "Ofrenda")]);
    const pageDate = screen.getByLabelText("Fecha");
    fireEvent.change(pageDate, { target: { value: "" } });
    expect(screen.getByRole("button", { name: /Editar efectivo · \$50\.000/ })).toBeInTheDocument();
    // The typed value is kept (not snapped back) so the user can keep typing,
    // including years that start with zeros.
    expect(pageDate).toHaveValue("");
    fireEvent.change(pageDate, { target: { value: "0020-10-07" } });
    expect(pageDate).toHaveValue("0020-10-07");
    fireEvent.change(pageDate, { target: { value: "2026-10-07" } });
    expect(pageDate).toHaveValue("2026-10-07");
    expect(screen.getByRole("button", { name: /Editar efectivo · \$50\.000/ })).toBeInTheDocument();
    // ‹ moves the day and the input follows it.
    fireEvent.click(screen.getByRole("button", { name: "Día anterior" }));
    expect(pageDate).toHaveValue("2026-10-06");
    // "Hoy" also restores a half-typed input when today is already selected.
    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    fireEvent.change(pageDate, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(pageDate).toHaveValue("2026-10-07");
  });

  it("MINOR-1: cambiar en el modal a un mes no cargado espera ese mes antes de permitir guardar", () => {
    renderOfferings();
    emit("2026-10", []);
    fireEvent.click(screen.getAllByRole("button", { name: /Registrar efectivo/ })[0]);
    fireEvent.change(dateField(), { target: { value: "2026-09-27" } });
    expectWaiting();
    emit("2026-09", [record("offerings", "2026-09-27", 20000, "Septiembre")], true);
    expectWaiting();
    emit("2026-09", [record("offerings", "2026-09-27", 20000, "Septiembre")]);
    expect(amountField()).toHaveValue("20000");
  });
});
