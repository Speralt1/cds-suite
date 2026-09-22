import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Preview2026MovimientosPage from "@/app/(private)/preview/finanzas-2026/movimientos/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("Movimientos (preview 2026)", () => {
  it("cambiar el filtro de fuente actualiza la franja de totales", async () => {
    const user = userEvent.setup();
    render(<Preview2026MovimientosPage />);

    const strip = screen.getByTestId("p26-totals-strip");
    const before = within(strip).getByText(/movimientos$/).textContent;

    const sourceSelect = screen.getByLabelText("Fuente");
    await user.selectOptions(sourceSelect, "cafeteria");

    const after = within(strip).getByText(/movimientos$/).textContent;
    expect(after).not.toEqual(before);
  });
});
