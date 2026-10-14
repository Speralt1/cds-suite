import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CashDayDialog } from "@/components/finance/dashboard/cash-calendar";

// QA (iPad 1194×834 al 125 %): en modo apilado el diálogo del día se abría y se
// cerraba ~10 ms después. El cleanup del efecto cierra el <dialog>, el efecto lo
// vuelve a abrir (StrictMode en desarrollo) y el evento "close" nativo, que el
// navegador encola de forma asíncrona, llegaba con el diálogo ya abierto otra vez.
describe("CashDayDialog", () => {
  it("ignora un evento close tardío si el diálogo volvió a abrirse (StrictMode)", async () => {
    const onClose = vi.fn();
    render(
      <StrictMode>
        <CashDayDialog title="Domingo 4 de octubre" onClose={onClose}>
          <p>Detalle</p>
        </CashDayDialog>
      </StrictMode>,
    );
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    await act(async () => {
      dialog.dispatchEvent(new Event("close"));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("un cierre nativo real (diálogo ya cerrado) avisa al padre", async () => {
    const onClose = vi.fn();
    render(
      <CashDayDialog title="Domingo 4 de octubre" onClose={onClose}>
        <p>Detalle</p>
      </CashDayDialog>,
    );
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    await act(async () => {
      dialog.removeAttribute("open");
      dialog.dispatchEvent(new Event("close"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
