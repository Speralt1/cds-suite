import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import {
  SumUpGroupRow,
  TransactionRow,
  TransactionTable,
} from "@/components/finance/transactions/transaction-list";
import { groupMovements } from "@/lib/finance/movement-groups";
import { parseDate } from "@/lib/finance/formatters";
import type { FinanceTransaction } from "@/lib/finance/types";

let seq = 0;
function sumUpTx(
  overrides: Partial<FinanceTransaction> & {
    day: string;
    period: string;
    amount: number;
    category: string;
  },
): FinanceTransaction {
  seq += 1;
  const date = parseDate(
    `${overrides.period}-${overrides.day.padStart(2, "0")}`,
  );
  return {
    id: `sumup_${seq}`,
    type: "income",
    status: "active",
    paymentMethod: "card",
    description: "",
    source: "general",
    revision: 1,
    createdBy: "system:sumup",
    createdAt: Timestamp.fromMillis(seq * 1000),
    updatedBy: "system:sumup",
    updatedAt: Timestamp.fromMillis(seq * 1000),
    date,
    ...overrides,
  };
}

describe("SumUpGroupRow", () => {
  it("arranca cerrado, tiene aria-expanded/aria-controls y expande al hacer click", async () => {
    const items = [
      sumUpTx({ period: "2026-09", day: "16", category: "Cafetería", amount: 1000 }),
      sumUpTx({ period: "2026-09", day: "16", category: "Cafetería", amount: 2000 }),
      sumUpTx({ period: "2026-09", day: "16", category: "Cafetería", amount: 3000 }),
    ];
    const [group] = groupMovements(items);
    if (group.kind !== "sumup-group") throw new Error("expected group");
    render(<SumUpGroupRow group={group} />);

    const toggle = screen.getByRole("button", { name: "Ver 3 pagos" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("3 pagos con tarjeta")).toBeInTheDocument();
    expect(screen.getByText("Tarjeta · SumUp")).toBeInTheDocument();
    expect(screen.getByText("SumUp · solo lectura")).toBeInTheDocument();
    expect(screen.getByText("Bruto")).toBeInTheDocument();
    expect(screen.queryByText("Ver", { exact: true })).toBeNull();

    const user = userEvent.setup();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Ocultar 3 pagos" }),
    ).toBeInTheDocument();
    const controlsId = toggle.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    const detail = document.getElementById(controlsId!);
    expect(detail).not.toBeNull();
    // Cada pago individual tiene "Ver" pero no "Editar" ni "Anular".
    const verButtons = within(detail!).getAllByRole("button", { name: "Ver" });
    expect(verButtons).toHaveLength(3);
    expect(within(detail!).queryByRole("button", { name: "Editar" })).toBeNull();
    expect(within(detail!).queryByRole("button", { name: "Anular" })).toBeNull();
  });

  it("1 pago usa singular y el grupo anulado muestra el texto y la pill, sin candado de solo lectura", () => {
    const voided = groupMovements([
      sumUpTx({
        period: "2026-09",
        day: "16",
        category: "Ofrendas",
        amount: 1000,
        status: "voided",
      }),
    ])[0];
    if (voided.kind !== "sumup-group") throw new Error("expected group");
    render(<SumUpGroupRow group={voided} />);
    expect(screen.getByText("1 pago")).toBeInTheDocument();
    expect(
      screen.getByText("SumUp · Ofrendas · Anulados o reembolsados en SumUp"),
    ).toBeInTheDocument();
    expect(screen.getByText("Anulado")).toBeInTheDocument();
    expect(screen.queryByText("SumUp · solo lectura")).toBeNull();
  });
});

describe("TransactionTable + mezcla de filas y grupos", () => {
  it("un solo encabezado y como máximo 1 fila SumUp por día × categoría × estado", () => {
    const items = [
      sumUpTx({ period: "2026-09", day: "16", category: "Ofrendas", amount: 1000 }),
      sumUpTx({ period: "2026-09", day: "16", category: "Ofrendas", amount: 2000 }),
      sumUpTx({ period: "2026-09", day: "16", category: "Cafetería", amount: 3000 }),
    ];
    const entries = groupMovements(items);
    render(
      <TransactionTable>
        {entries.map((entry) =>
          entry.kind === "single" ? (
            <TransactionRow key={entry.key} t={entry.transaction} />
          ) : (
            <SumUpGroupRow key={entry.key} group={entry} />
          ),
        )}
      </TransactionTable>,
    );
    expect(screen.getAllByText("Fecha / Categoría")).toHaveLength(1);
    expect(screen.getByText("SumUp · Ofrendas")).toBeInTheDocument();
    expect(screen.getByText("SumUp · Cafetería")).toBeInTheDocument();
    expect(screen.getAllByText("SumUp · solo lectura")).toHaveLength(2);
  });
});
