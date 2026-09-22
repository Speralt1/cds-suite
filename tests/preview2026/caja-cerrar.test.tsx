import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Preview2026CerrarCajaPage from "@/app/(private)/preview/finanzas-2026/caja/cerrar/page";

describe("Cierre de caja (preview 2026)", () => {
  it("el esperado es texto calculado: no existe ningún input para editarlo", () => {
    render(<Preview2026CerrarCajaPage />);
    const inputs = screen
      .getAllByRole("textbox")
      .concat(screen.queryAllByRole("spinbutton"));
    for (const input of inputs) {
      expect(input.id).not.toBe("p26-expected");
      expect((input as HTMLInputElement).name).not.toMatch(/esperado/i);
    }
    const expected = screen.getByTestId("p26-expected");
    expect(expected.tagName).not.toBe("INPUT");
    expect(expected.querySelector("input")).toBeNull();
  });

  it("el botón de cierre está deshabilitado con diferencia sin motivo, y se habilita al elegir motivo", async () => {
    const user = userEvent.setup();
    render(<Preview2026CerrarCajaPage />);
    const closeButton = screen.getByTestId("p26-close-button");
    // Contado por defecto ($210.000) difiere del esperado ($214.500).
    expect(closeButton).toBeDisabled();

    await user.selectOptions(
      screen.getByLabelText(/motivo/i),
      "Faltante — vuelto entregado de más",
    );
    expect(closeButton).toBeEnabled();
  });
});
