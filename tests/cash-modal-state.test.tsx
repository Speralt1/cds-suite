// R0E — Caja del día: state, loading and date safety of the cash modal.
// Cases A–N of the R0E brief, driven through a stateful parent that applies
// onAreaChange/onDateChange like the real pages do, with the period's data
// arriving asynchronously (re-render with a new store).
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
import { CashModal } from "@/components/finance/offerings/cash-modal";
import { cashDateIssue, isCalendarDate, type CashArea } from "@/lib/offerings/cash";
import { parseDate } from "@/lib/finance/formatters";
import type { FinanceTransaction } from "@/lib/finance/types";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "test", email: "test@cds.test" } }),
}));
vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: {} }) }));
vi.mock("@/lib/finance/transactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/transactions")>()),
  saveTransaction: mocks.save,
}));

HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
  this.open = false;
};

function record(
  area: CashArea,
  date: string,
  amount: number,
  note: string,
  overrides: Partial<FinanceTransaction> = {},
): FinanceTransaction {
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
    ...overrides,
  };
}

function sumUpCash(area: CashArea, date: string, amount: number): FinanceTransaction {
  return record(area, date, amount, "", {
    id: `sumup_${area}_${date}_${amount}`,
    createdBy: "system:sumup",
    updatedBy: "system:sumup",
  });
}

// Per-month data as the page hook would expose it. A missing month is still
// loading (no live, server-confirmed snapshot yet).
type Store = Record<string, { data: FinanceTransaction[]; error?: string }>;

function Page({
  store,
  area: initialArea = "offerings",
  date: initialDate = "2026-10-04",
  onDate,
  onClose,
}: {
  store: Store;
  area?: CashArea;
  date?: string;
  onDate?: (date: string) => void;
  onClose?: () => void;
}) {
  const [area, setArea] = useState<CashArea>(initialArea);
  const [date, setDate] = useState(initialDate);
  const entry = store[date.slice(0, 7)];
  return (
    <CashModal
      area={area}
      date={date}
      allTransactionsForDay={entry?.data ?? []}
      loading={!entry}
      loadError={entry?.error}
      onAreaChange={setArea}
      onDateChange={(next) => {
        onDate?.(next);
        setDate(next);
      }}
      onClose={onClose ?? (() => {})}
    />
  );
}

const amountField = () => screen.queryByRole("textbox", { name: "Efectivo recaudado" });
const noteField = () => screen.getByRole("textbox", { name: "Nota (opcional)" });
const dateField = () => screen.getByLabelText(/Fecha correspondiente/);
const areaField = () => screen.getByRole("combobox", { name: "Área" });
const form = () => document.querySelector("form") as HTMLFormElement;
const title = () => screen.getByRole("heading", { level: 2 }).textContent;
const savedCall = () => {
  expect(mocks.save).toHaveBeenCalledTimes(1);
  const [, , id, input, options] = mocks.save.mock.calls[0];
  return { id, input, existing: options.existing as FinanceTransaction | undefined };
};

function expectBlocked() {
  expect(amountField()).toBeNull();
  expect(screen.getByRole("button", { name: "Guardar efectivo" })).toBeDisabled();
  fireEvent.submit(form());
  expect(mocks.save).not.toHaveBeenCalled();
}

beforeEach(() => {
  mocks.save.mockReset();
  mocks.save.mockResolvedValue(undefined);
});

describe("A/L — registro existente", () => {
  it("abre en modo edición con monto y nota vigentes y actualiza ese mismo registro", async () => {
    const existing = record("offerings", "2026-10-04", 50000, "Servicio AM");
    render(<Page store={{ "2026-10": { data: [existing] } }} />);

    expect(title()).toBe("Editar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("50000");
    expect(noteField()).toHaveValue("Servicio AM");

    fireEvent.change(amountField()!, { target: { value: "52000" } });
    fireEvent.click(screen.getByRole("button", { name: "Actualizar efectivo" }));
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());

    const { id, input, existing: sentExisting } = savedCall();
    expect(id).toBe("cash_offerings_2026-10-04");
    expect(input).toMatchObject({ amount: 52000, note: "Servicio AM", date: "2026-10-04", paymentMethod: "cash", category: "Ofrendas" });
    expect(sentExisting).toBe(existing);
  });
});

describe("E — registro inexistente", () => {
  it("abre vacío y crea el id base del día", async () => {
    render(<Page store={{ "2026-10": { data: [] } }} />);
    expect(title()).toBe("Ingresar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("");
    fireEvent.change(amountField()!, { target: { value: "30000" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar efectivo" }));
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    const { id, input, existing } = savedCall();
    expect(id).toBe("cash_offerings_2026-10-04");
    expect(input.amount).toBe(30000);
    expect(existing).toBeUndefined();
  });
});

describe("F — el mes todavía está cargando (MINOR-1)", () => {
  it("el modal abre ANTES de que llegue el registro: no muestra campos ni permite guardar, y al llegar prellena", async () => {
    const view = render(<Page store={{}} />);
    expect(title()).toBe("Registrar efectivo · Ofrendas");
    expect(screen.getByRole("status")).toHaveTextContent("Cargando el efectivo registrado");
    expectBlocked();

    const existing = record("offerings", "2026-10-04", 50000, "Servicio AM");
    view.rerender(<Page store={{ "2026-10": { data: [existing] } }} />);
    expect(title()).toBe("Editar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("50000");
    expect(noteField()).toHaveValue("Servicio AM");

    // Saving right away sends the complete current amount and note, never "".
    fireEvent.click(screen.getByRole("button", { name: "Actualizar efectivo" }));
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    const { input, existing: sentExisting } = savedCall();
    expect(input).toMatchObject({ amount: 50000, note: "Servicio AM" });
    expect(sentExisting).toBe(existing);
  });

  it("si el registro aparece después de empezar a escribir uno nuevo, el formulario se reinicia con el registro (nunca actualiza con lo tecleado a medias)", async () => {
    const view = render(<Page store={{ "2026-10": { data: [] } }} />);
    fireEvent.change(amountField()!, { target: { value: "12" } });
    fireEvent.change(noteField(), { target: { value: "borrador" } });

    const existing = record("offerings", "2026-10-04", 50000, "Servicio AM");
    view.rerender(<Page store={{ "2026-10": { data: [existing] } }} />);
    expect(title()).toBe("Editar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("50000");
    expect(noteField()).toHaveValue("Servicio AM");
  });

  it("si el registro desaparece (anulado en otro equipo), vuelve a modo nuevo sin arrastrar el monto", () => {
    const existing = record("offerings", "2026-10-04", 50000, "Servicio AM");
    const view = render(<Page store={{ "2026-10": { data: [existing] } }} />);
    view.rerender(<Page store={{ "2026-10": { data: [{ ...existing, status: "voided", revision: 2 }] } }} />);
    expect(title()).toBe("Ingresar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("");
    expect(noteField()).toHaveValue("");
  });

  it("si el registro cambia mientras se edita, bloquea guardar hasta cargar los valores vigentes", async () => {
    const existing = record("offerings", "2026-10-04", 50000, "Servicio AM");
    const view = render(<Page store={{ "2026-10": { data: [existing] } }} />);
    fireEvent.change(amountField()!, { target: { value: "60000" } });

    const updated = { ...existing, amount: 55000, note: "Corregido", revision: 2 };
    view.rerender(<Page store={{ "2026-10": { data: [updated] } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Este registro cambió mientras lo editabas (ahora $55.000)");
    expect(screen.getByRole("button", { name: "Actualizar efectivo" })).toBeDisabled();
    fireEvent.submit(form());
    expect(mocks.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cargar valores vigentes" }));
    expect(amountField()).toHaveValue("55000");
    expect(noteField()).toHaveValue("Corregido");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar efectivo" }));
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(savedCall().existing).toBe(updated);
  });
});

describe("G — error al consultar", () => {
  it("muestra el error, no muestra campos y no permite guardar", () => {
    render(<Page store={{ "2026-10": { data: [], error: "No tienes permiso para ver estos datos." } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso para ver estos datos.");
    expectBlocked();
  });

  it("un error con datos retenidos tampoco permite editar sobre ellos", () => {
    const existing = record("offerings", "2026-10-04", 50000, "Servicio AM");
    render(<Page store={{ "2026-10": { data: [existing], error: "Sin conexión: la información puede estar desactualizada." } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sin conexión");
    expectBlocked();
  });
});

describe("H/I — fecha vacía o inválida (MINOR-3)", () => {
  it("H: borrar la fecha muestra una validación clara, no rompe la pantalla y se recupera con una fecha válida", () => {
    const onDate = vi.fn();
    const existing = record("offerings", "2026-10-07", 70000, "Miércoles");
    render(<Page store={{ "2026-10": { data: [existing] } }} onDate={onDate} />);

    fireEvent.change(dateField(), { target: { value: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Ingresa la fecha correspondiente para continuar.");
    expect(dateField()).toHaveAttribute("aria-invalid", "true");
    expect(onDate).not.toHaveBeenCalled();
    expectBlocked();
    // The area and date stay usable to recover.
    expect(dateField()).toBeEnabled();
    expect(areaField()).toBeEnabled();

    fireEvent.change(dateField(), { target: { value: "2026-10-07" } });
    expect(onDate).toHaveBeenCalledWith("2026-10-07");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(amountField()).toHaveValue("70000");
    expect(noteField()).toHaveValue("Miércoles");
  });

  it("I: una fecha fuera de rango no se propaga ni permite guardar", () => {
    const onDate = vi.fn();
    render(<Page store={{ "2026-09": { data: [] }, "2026-10": { data: [] } }} onDate={onDate} />);
    fireEvent.change(dateField(), { target: { value: "2026-09-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Elige una fecha desde el 9 de septiembre de 2026.");
    expect(onDate).not.toHaveBeenCalled();
    expectBlocked();
  });

  it("I: valida formato y fecha real sin depender de la zona horaria", () => {
    for (const bad of ["2026-02-30", "2026-02-29", "2026-13-01", "2026-00-10", "2026-10-00", "2026-10-4", "26-10-04", "20260-01-01", "2026-10-04T00:00", "basura"]) {
      expect(cashDateIssue(bad)).toBe("La fecha no es válida. Revisa día, mes y año.");
      expect(isCalendarDate(bad)).toBe(false);
    }
    expect(cashDateIssue("")).toBe("Ingresa la fecha correspondiente para continuar.");
    expect(cashDateIssue("2026-09-08")).toMatch(/desde el 9 de septiembre/);
    expect(cashDateIssue("2100-01-01")).toMatch(/hasta el 31 de diciembre de 2099/);
    for (const ok of ["2026-09-09", "2026-10-04", "2028-02-29", "2099-12-31"]) {
      expect(cashDateIssue(ok)).toBeNull();
      expect(isCalendarDate(ok)).toBe(true);
    }
  });
});

describe("J — registro anulado", () => {
  it("un registro anulado no se prellena; se registra con el siguiente id de revisión", async () => {
    const voided = record("offerings", "2026-10-04", 40000, "Anulado", { status: "voided", revision: 2 });
    render(<Page store={{ "2026-10": { data: [voided] } }} />);
    expect(title()).toBe("Ingresar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("");
    expect(noteField()).toHaveValue("");

    fireEvent.change(amountField()!, { target: { value: "45000" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar efectivo" }));
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    const { id, existing } = savedCall();
    expect(id).toBe("cash_offerings_2026-10-04_r2");
    expect(existing).toBeUndefined();
  });

  it("con la base anulada y una revisión activa, edita la revisión activa", () => {
    const voided = record("offerings", "2026-10-04", 40000, "Anulado", { status: "voided", revision: 2 });
    const active = record("offerings", "2026-10-04", 45000, "Revisión", { id: "cash_offerings_2026-10-04_r2" });
    render(<Page store={{ "2026-10": { data: [voided, active] } }} />);
    expect(title()).toBe("Editar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("45000");
  });
});

describe("K — advertencia SumUp CASH", () => {
  it("se calcula para el área y día visibles, y nunca se muestra con datos que aún no cargan", () => {
    const view = render(<Page store={{ "2026-10": { data: [sumUpCash("cafeteria", "2026-10-04", 163500)] } }} />);
    expect(screen.queryByText(/SumUp ya registró/)).toBeNull();

    fireEvent.change(areaField(), { target: { value: "cafeteria" } });
    expect(screen.getByText(/SumUp ya registró \$163\.500 en efectivo de Cafetería/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar efectivo" })).toBeEnabled();

    // Another month that is still loading: no warning from the previous month.
    fireEvent.change(dateField(), { target: { value: "2026-11-01" } });
    expect(screen.queryByText(/SumUp ya registró/)).toBeNull();
    view.rerender(<Page store={{ "2026-10": { data: [] }, "2026-11": { data: [] } }} />);
    expect(screen.queryByText(/SumUp ya registró/)).toBeNull();
  });
});

describe("B — cambiar de mes", () => {
  it("no muestra datos del mes anterior mientras el nuevo carga y luego prellena el registro correcto", () => {
    const oct = record("offerings", "2026-10-04", 50000, "Octubre");
    const sep = record("offerings", "2026-09-28", 20000, "Septiembre");
    const view = render(<Page store={{ "2026-10": { data: [oct] } }} />);
    fireEvent.change(amountField()!, { target: { value: "99999" } });

    fireEvent.change(dateField(), { target: { value: "2026-09-28" } });
    expect(title()).toBe("Registrar efectivo · Ofrendas");
    expectBlocked();
    expect(screen.queryByDisplayValue("99999")).toBeNull();
    expect(screen.queryByDisplayValue("50000")).toBeNull();

    view.rerender(<Page store={{ "2026-10": { data: [oct] }, "2026-09": { data: [sep] } }} />);
    expect(amountField()).toHaveValue("20000");
    expect(noteField()).toHaveValue("Septiembre");

    fireEvent.change(dateField(), { target: { value: "2026-10-04" } });
    expect(amountField()).toHaveValue("50000");
    expect(noteField()).toHaveValue("Octubre");
  });
});

describe("C — cambiar de área", () => {
  it("carga monto y nota del área elegida y descarta lo tecleado", () => {
    const offering = record("offerings", "2026-10-04", 50000, "Ofrenda AM");
    const cafe = record("cafeteria", "2026-10-04", 80000, "Venta AM");
    render(<Page store={{ "2026-10": { data: [offering, cafe] } }} />);
    fireEvent.change(amountField()!, { target: { value: "99999" } });
    fireEvent.change(noteField(), { target: { value: "no debe pasar" } });

    fireEvent.change(areaField(), { target: { value: "cafeteria" } });
    expect(title()).toBe("Editar efectivo · Cafetería");
    expect(amountField()).toHaveValue("80000");
    expect(noteField()).toHaveValue("Venta AM");

    fireEvent.change(areaField(), { target: { value: "offerings" } });
    expect(amountField()).toHaveValue("50000");
    expect(noteField()).toHaveValue("Ofrenda AM");
  });

  it("un área sin registro abre vacía aunque la otra tenga monto y nota", () => {
    render(<Page store={{ "2026-10": { data: [record("offerings", "2026-10-04", 50000, "Ofrenda AM")] } }} />);
    fireEvent.change(areaField(), { target: { value: "cafeteria" } });
    expect(title()).toBe("Ingresar efectivo · Cafetería");
    expect(amountField()).toHaveValue("");
    expect(noteField()).toHaveValue("");
  });

  it("la confirmación de fecha fuera de culto no se arrastra a otra área", () => {
    render(<Page store={{ "2026-10": { data: [] } }} date="2026-10-05" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que el efectivo corresponde/ }));
    expect(screen.getByRole("button", { name: "Registrar efectivo" })).toBeEnabled();
    fireEvent.change(areaField(), { target: { value: "cafeteria" } });
    expect(screen.getByRole("checkbox", { name: /Confirmo que el efectivo corresponde/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Registrar efectivo" })).toBeDisabled();
  });
});

describe("D — cerrar y reabrir", () => {
  function Toggle({ store }: { store: Store }) {
    const [open, setOpen] = useState(true);
    return open ? (
      <Page store={store} onClose={() => setOpen(false)} />
    ) : (
      <button type="button" onClick={() => setOpen(true)}>
        Reabrir
      </button>
    );
  }

  it("al reabrir no conserva lo tecleado ni la confirmación anterior", () => {
    const existing = record("offerings", "2026-10-04", 50000, "Servicio AM");
    render(<Toggle store={{ "2026-10": { data: [existing] } }} />);
    fireEvent.change(amountField()!, { target: { value: "12345" } });
    fireEvent.change(noteField(), { target: { value: "borrador" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
    expect(amountField()).toHaveValue("50000");
    expect(noteField()).toHaveValue("Servicio AM");
  });
});

describe("M — cambio rápido de fecha", () => {
  it("varios cambios seguidos, incluso cruzando meses sin cargar, terminan en el registro de la última fecha", () => {
    const d4 = record("offerings", "2026-10-04", 50000, "Domingo");
    const d7 = record("offerings", "2026-10-07", 70000, "Miércoles");
    render(<Page store={{ "2026-10": { data: [d4, d7] } }} />);

    for (const next of ["2026-10-07", "2026-09-27", "", "2026-10-11", "2026-08-30", "2026-10-07"]) {
      fireEvent.change(dateField(), { target: { value: next } });
    }
    expect(amountField()).toHaveValue("70000");
    expect(noteField()).toHaveValue("Miércoles");

    fireEvent.change(dateField(), { target: { value: "2026-10-11" } });
    fireEvent.change(dateField(), { target: { value: "2026-10-14" } });
    expect(title()).toBe("Ingresar efectivo · Ofrendas");
    expect(amountField()).toHaveValue("");
    expect(noteField()).toHaveValue("");
  });
});

describe("N — cambio rápido de área", () => {
  it("alternar áreas varias veces nunca mezcla montos ni notas", () => {
    const offering = record("offerings", "2026-10-04", 50000, "Ofrenda AM");
    const cafe = record("cafeteria", "2026-10-04", 80000, "Venta AM");
    render(<Page store={{ "2026-10": { data: [offering, cafe] } }} />);
    for (const next of ["cafeteria", "offerings", "cafeteria", "offerings", "cafeteria"]) {
      fireEvent.change(amountField()!, { target: { value: "1" } });
      fireEvent.change(areaField(), { target: { value: next } });
    }
    expect(title()).toBe("Editar efectivo · Cafetería");
    expect(amountField()).toHaveValue("80000");
    expect(noteField()).toHaveValue("Venta AM");
  });
});
