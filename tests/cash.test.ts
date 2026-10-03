import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  cashTransactionId,
  cashDailyIdCandidates,
  findActiveDailyCash,
  nextCashWriteId,
  saveDailyCash,
} from "@/lib/offerings/cash";
import type { FinanceTransaction } from "@/lib/finance/types";

const saveTransactionMock = vi.hoisted(() => vi.fn(async (_db, _uid, id) => id));
vi.mock("@/lib/finance/transactions", () => ({
  saveTransaction: saveTransactionMock,
}));

function tx(id: string, status: "active" | "voided"): FinanceTransaction {
  return { id, status } as FinanceTransaction;
}

beforeEach(() => {
  saveTransactionMock.mockClear();
});

describe("cashDailyIdCandidates / findActiveDailyCash", () => {
  it("resuelve el id base cuando es el único registro", () => {
    const items = [tx(cashTransactionId("offerings", "2026-09-14"), "active")];
    expect(findActiveDailyCash(items, "offerings", "2026-09-14")?.id).toBe(
      "cash_offerings_2026-09-14",
    );
  });

  it("no encuentra activo cuando el único registro está anulado", () => {
    const items = [tx(cashTransactionId("offerings", "2026-09-14"), "voided")];
    expect(findActiveDailyCash(items, "offerings", "2026-09-14")).toBeUndefined();
  });

  it("encuentra la revisión activa tras anular el registro original", () => {
    const items = [
      tx("cash_offerings_2026-09-14", "voided"),
      tx("cash_offerings_2026-09-14_r2", "active"),
    ];
    expect(findActiveDailyCash(items, "offerings", "2026-09-14")?.id).toBe(
      "cash_offerings_2026-09-14_r2",
    );
  });

  it("no mezcla áreas o fechas distintas", () => {
    const items = [
      tx("cash_cafeteria_2026-09-14", "active"),
      tx("cash_offerings_2026-09-15", "active"),
    ];
    expect(findActiveDailyCash(items, "offerings", "2026-09-14")).toBeUndefined();
  });
});

describe("nextCashWriteId", () => {
  it("usa el id base si nunca se ha usado", () => {
    expect(nextCashWriteId([], "offerings", "2026-09-14")).toBe(
      "cash_offerings_2026-09-14",
    );
  });

  it("salta a _r2 si el id base existe anulado", () => {
    const items = [tx("cash_offerings_2026-09-14", "voided")];
    expect(nextCashWriteId(items, "offerings", "2026-09-14")).toBe(
      "cash_offerings_2026-09-14_r2",
    );
  });

  it("encuentra el siguiente _r{n} libre tras varias anulaciones", () => {
    const items = [
      tx("cash_offerings_2026-09-14", "voided"),
      tx("cash_offerings_2026-09-14_r2", "voided"),
      tx("cash_offerings_2026-09-14_r3", "voided"),
    ];
    expect(nextCashWriteId(items, "offerings", "2026-09-14")).toBe(
      "cash_offerings_2026-09-14_r4",
    );
  });

  it("genera hasta 50 candidatos estables y deterministas", () => {
    const ids = cashDailyIdCandidates("cafeteria", "2026-09-14", 3);
    expect(ids).toEqual([
      "cash_cafeteria_2026-09-14",
      "cash_cafeteria_2026-09-14_r2",
      "cash_cafeteria_2026-09-14_r3",
    ]);
  });
});

describe("saveDailyCash — F1: anular y volver a registrar el mismo día", () => {
  it("escribe en el id base cuando no hay registro previo", async () => {
    await saveDailyCash(
      {} as never,
      "uid1",
      "offerings",
      "2026-09-14",
      5000,
      "",
      undefined,
      [],
    );
    expect(saveTransactionMock).toHaveBeenCalledWith(
      {},
      "uid1",
      "cash_offerings_2026-09-14",
      expect.objectContaining({ amount: 5000 }),
      expect.objectContaining({ existing: undefined }),
    );
  });

  it("actualiza el registro activo existente usando su propio id", async () => {
    const existing = tx("cash_offerings_2026-09-14", "active");
    existing.amount = 1000;
    await saveDailyCash(
      {} as never,
      "uid1",
      "offerings",
      "2026-09-14",
      2000,
      "",
      existing,
    );
    expect(saveTransactionMock).toHaveBeenCalledWith(
      {},
      "uid1",
      "cash_offerings_2026-09-14",
      expect.anything(),
      expect.objectContaining({ existing }),
    );
  });

  it("tras anular el registro del día, el reingreso usa un id de revisión nuevo (no bloquea el día)", async () => {
    const voided = [tx("cash_offerings_2026-09-14", "voided")];
    await saveDailyCash(
      {} as never,
      "uid1",
      "offerings",
      "2026-09-14",
      3000,
      "Reingreso tras anulación",
      undefined,
      voided,
    );
    expect(saveTransactionMock).toHaveBeenCalledWith(
      {},
      "uid1",
      "cash_offerings_2026-09-14_r2",
      expect.objectContaining({ amount: 3000 }),
      expect.objectContaining({ existing: undefined }),
    );
  });
});
