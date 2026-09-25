import { describe, it, expect } from "vitest";
import {
  settlementStatus,
  totalCommissionInRange,
  sumUpAccountForCategory,
  hasAnySettlement,
  type SumUpDailySettlement,
} from "../lib/finance/sumup-settlement";

function daily(overrides: Partial<SumUpDailySettlement>): SumUpDailySettlement {
  return {
    account: "offerings",
    date: "2026-09-10",
    bruto: 10000,
    reembolsado: 0,
    comisionSumUp: 340,
    liquidoEsperado: 9660,
    depositado: 9660,
    references: [],
    txCount: 1,
    txLinked: 1,
    txPending: 0,
    linkStatus: "complete",
    basis: "net",
    ...overrides,
  };
}

describe("settlementStatus", () => {
  it("sin payout todavía -> por depositar (nunca $0)", () => {
    const status = settlementStatus(daily({ depositado: null, linkStatus: "pending" }), "2026-09-11");
    expect(status.code).toBe("por-depositar");
  });

  it("sin documento (día aún no procesado) -> por depositar", () => {
    const status = settlementStatus(undefined, "2026-09-11");
    expect(status.code).toBe("por-depositar");
  });

  it("depositado == liquidoEsperado -> pagado por SumUp (no 'conciliado': aún no cruza con el banco)", () => {
    const status = settlementStatus(daily({ liquidoEsperado: 9660, depositado: 9660 }), "2026-09-11");
    expect(status.code).toBe("pagado");
    expect(status.label).toBe("Pagado por SumUp");
  });

  it("diferencia detectada pero dentro de los 5 días hábiles -> sigue por depositar", () => {
    const status = settlementStatus(daily({ date: "2026-09-10", liquidoEsperado: 9660, depositado: 9000 }), "2026-09-11");
    expect(status.code).toBe("por-depositar");
  });

  it("diferencia detectada y ya pasaron 5 días hábiles -> diferencia con SumUp", () => {
    const status = settlementStatus(daily({ date: "2026-09-01", liquidoEsperado: 9660, depositado: 9000 }), "2026-09-20");
    expect(status.code).toBe("diferencia");
    expect(status.label).toBe("Diferencia con SumUp");
  });

  it("hasReviewRows fuerza 'Requiere revisión' sin importar el estado del depósito", () => {
    const status = settlementStatus(daily({ liquidoEsperado: 9660, depositado: 9660 }), "2026-09-11", true);
    expect(status.code).toBe("revision");
    expect(status.label).toBe("Requiere revisión");
  });
});

describe("totalCommissionInRange / sumUpAccountForCategory / hasAnySettlement", () => {
  it("suma la comisión de todos los días y cuentas del rango", () => {
    const map = new Map([
      ["offerings_2026-09-10", daily({ comisionSumUp: 340 })],
      ["cafeteria_2026-09-10", daily({ account: "cafeteria", comisionSumUp: 680 })],
    ]);
    expect(totalCommissionInRange(map)).toBe(1020);
    expect(hasAnySettlement(map)).toBe(true);
  });

  it("un mes sin settlements todavía no confunde 'sin datos' con '$0'", () => {
    expect(hasAnySettlement(new Map())).toBe(false);
  });

  it("mapea categorías del libro a la cuenta SumUp correspondiente", () => {
    expect(sumUpAccountForCategory("Ofrendas")).toBe("offerings");
    expect(sumUpAccountForCategory("Cafetería")).toBe("cafeteria");
    expect(sumUpAccountForCategory("Diezmos")).toBeNull();
  });
});
