// Bandera real (sin mocks): Posición de fondos queda apagada hasta que el
// administrador decida volver a mostrarla (18/10/2026).
import { describe, expect, it } from "vitest";
import { FINANCE_FEATURES } from "@/lib/finance/features";

describe("FINANCE_FEATURES", () => {
  it("Posición de fondos (saldo bancario estimado) está apagada por defecto", () => {
    expect(FINANCE_FEATURES.fundsPosition).toBe(false);
  });
});
