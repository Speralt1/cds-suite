// SumUp CASH Intake V1 — UI sub-slice (Hosting): Movimientos never labels
// SumUp cash as card, and the manual "Caja del día" modal warns (never
// blocks) when SumUp already recorded cash for that area/day.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
import { SumUpGroupRow } from "@/components/finance/transactions/transaction-list";
import { CashModal } from "@/components/finance/offerings/cash-modal";
import { groupMovements } from "@/lib/finance/movement-groups";
import { parseDate } from "@/lib/finance/formatters";
import { sumUpCashForDay } from "@/lib/offerings/cash";
import type { FinanceTransaction } from "@/lib/finance/types";

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "test", email: "test@cds.test" } }),
}));
vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: {} }) }));

let seq = 0;
function tx(overrides: Partial<FinanceTransaction> & { amount: number }): FinanceTransaction {
  seq += 1;
  const period = overrides.period || "2026-10";
  const day = overrides.day || "4";
  return {
    id: `sumup_cafeteria_${seq}`,
    type: "income",
    status: "active",
    paymentMethod: "card",
    category: "Cafetería",
    description: "",
    note: "",
    source: "general",
    revision: 1,
    createdBy: "system:sumup",
    createdAt: Timestamp.fromMillis(seq * 1000),
    updatedBy: "system:sumup",
    updatedAt: Timestamp.fromMillis(seq * 1000),
    period,
    day,
    date: parseDate(`${period}-${day.padStart(2, "0")}`),
    ...overrides,
  };
}

describe("Movimientos — grupos SumUp por método", () => {
  it("tarjeta y efectivo SumUp del mismo día/categoría quedan en grupos distintos y la suma total no cambia", () => {
    const items = [
      tx({ amount: 8000 }),
      tx({ amount: 2000 }),
      tx({ amount: 163500, paymentMethod: "cash", description: "Venta Cafetería efectivo · SumUp" }),
    ];
    const entries = groupMovements(items);
    const groups = entries.filter((e) => e.kind === "sumup-group");
    expect(groups).toHaveLength(2);
    const [card, cash] = groups as Extract<(typeof entries)[number], { kind: "sumup-group" }>[];
    expect(card).toMatchObject({ paymentMethod: "card", count: 2, amount: 10000, label: "SumUp · Cafetería" });
    expect(cash).toMatchObject({ paymentMethod: "cash", count: 1, amount: 163500, label: "SumUp · Cafetería · Efectivo" });
    // The card key is unchanged from before CASH Intake V1.
    expect(card.key).toBe("sumup|active|income|2026-10|4|Cafetería");
    expect(cash.key).toBe("sumup|active|income|2026-10|4|Cafetería|cash");
  });

  it("el grupo de efectivo SumUp nunca dice tarjeta ni 'Bruto'", () => {
    const [group] = groupMovements([tx({ amount: 163500, paymentMethod: "cash" })]);
    if (group.kind !== "sumup-group") throw new Error("expected group");
    render(<SumUpGroupRow group={group} />);
    expect(screen.getByText("1 registro en efectivo")).toBeInTheDocument();
    expect(screen.getByText("Efectivo · SumUp")).toBeInTheDocument();
    expect(screen.queryByText(/tarjeta/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Bruto")).not.toBeInTheDocument();
  });

  it("el efectivo SumUp anulado conserva el rótulo de anulado", () => {
    const [group] = groupMovements([tx({ amount: 5000, paymentMethod: "cash", status: "voided" })]);
    if (group.kind !== "sumup-group") throw new Error("expected group");
    expect(group.label).toBe("SumUp · Cafetería · Efectivo · Anulados o reembolsados en SumUp");
    render(<SumUpGroupRow group={group} />);
    expect(screen.getByText("Anulado")).toBeInTheDocument();
  });
});

describe("Caja del día — aviso de efectivo ya registrado en SumUp", () => {
  const manual = tx({ id: "cash_cafeteria_2026-10-04", amount: 50000, paymentMethod: "cash", createdBy: "uid-1", updatedBy: "uid-1" });
  const sumUpCash = tx({ amount: 163500, paymentMethod: "cash" });

  it("sumUpCashForDay cuenta solo efectivo SumUp activo del área y día (nunca el manual ni la tarjeta)", () => {
    const items = [
      manual,
      sumUpCash,
      tx({ amount: 9999 }),
      tx({ amount: 1, paymentMethod: "cash", status: "voided" }),
      tx({ amount: 2, paymentMethod: "cash", day: "5" }),
      tx({ amount: 3, paymentMethod: "cash", category: "Ofrendas" }),
    ];
    expect(sumUpCashForDay(items, "cafeteria", "2026-10-04")).toEqual({ amount: 163500, count: 1 });
    expect(sumUpCashForDay(items, "offerings", "2026-10-04")).toEqual({ amount: 3, count: 1 });
    expect(sumUpCashForDay([manual], "cafeteria", "2026-10-04")).toEqual({ amount: 0, count: 0 });
  });

  function renderModal(items: FinanceTransaction[]) {
    // jsdom has no <dialog> modal API; Modal only needs these to exist.
    HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
      this.open = false;
    };
    return render(
      <CashModal
        area="cafeteria"
        date="2026-10-04"
        allTransactionsForDay={items}
        loading={false}
        onAreaChange={() => {}}
        onDateChange={() => {}}
        onClose={() => {}}
      />,
    );
  }

  it("muestra el aviso (sin bloquear) cuando SumUp ya registró efectivo ese día", () => {
    renderModal([sumUpCash]);
    expect(screen.getByRole("status")).toHaveTextContent("SumUp ya registró $163.500 en efectivo de Cafetería para este día");
    expect(screen.getByRole("button", { name: "Registrar efectivo" })).toBeEnabled();
  });

  it("no muestra aviso cuando no hay efectivo SumUp (el registro manual sigue igual)", () => {
    renderModal([manual]);
    expect(screen.queryByText(/SumUp ya registró/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actualizar efectivo" })).toBeEnabled();
  });
});
