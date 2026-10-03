import { describe, expect, it } from "vitest";
import {
  buildMonthCalendar,
  dayStatus,
  groupAttributionsByMonth,
  incomeByMethod,
  isSumUpTransaction,
  reviewDays,
  titheAggregates,
} from "@/lib/finance/insights";
import type { FinanceTransaction, TitheAttribution } from "@/lib/finance/types";

// Minimal active-income transaction builder for pure-function tests: only
// the fields incomeByMethod / dayStatus read are populated.
function tx(
  partial: Partial<FinanceTransaction> & {
    day: string;
    period: string;
    amount: number;
  },
): FinanceTransaction {
  return {
    id: partial.id || `tx_${Math.random()}`,
    type: "income",
    status: "active",
    category: "Ofrendas",
    paymentMethod: "cash",
    description: "",
    source: "general",
    revision: 1,
    createdBy: "user_1",
    createdAt: undefined as never,
    updatedBy: "user_1",
    updatedAt: undefined as never,
    date: undefined as never,
    ...partial,
  };
}

describe("isSumUpTransaction", () => {
  it("matches by id prefix or system createdBy", () => {
    expect(isSumUpTransaction("sumup_abc", "user_1")).toBe(true);
    expect(isSumUpTransaction("tx_1", "system:sumup")).toBe(true);
    expect(isSumUpTransaction("tx_1", "user_1")).toBe(false);
  });
});

describe("incomeByMethod", () => {
  it("sums by method to the same total as all active income", () => {
    const transactions = [
      tx({ period: "2026-09", day: "16", amount: 120000, paymentMethod: "cash", category: "Ofrendas" }),
      tx({ id: "sumup_1", period: "2026-09", day: "16", amount: 45000, paymentMethod: "card", category: "Ofrendas", createdBy: "system:sumup" }),
      tx({ id: "sumup_2", period: "2026-09", day: "16", amount: 210000, paymentMethod: "card", category: "Cafetería", createdBy: "system:sumup" }),
      tx({ period: "2026-09", day: "5", amount: 60000, paymentMethod: "transfer", category: "Diezmos" }),
      tx({ period: "2026-09", day: "3", amount: 802800, paymentMethod: "card", category: "SumUp histórico sin separar", createdBy: "system:sumup", id: "sumup_hist" }),
      // Excluded: expense and voided rows must not count.
      tx({ period: "2026-09", day: "1", amount: 5000, paymentMethod: "cash", type: "expense" }),
      tx({ period: "2026-09", day: "1", amount: 999999, paymentMethod: "cash", status: "voided" }),
    ];

    const result = incomeByMethod(transactions);
    const sumOfRows = result.rows.reduce((sum, r) => sum + r.amount, 0);
    expect(sumOfRows).toBe(result.total);
    expect(result.total).toBe(120000 + 45000 + 210000 + 60000 + 802800);

    const sumUpRow = result.rows.find((r) => r.key === "sumup")!;
    expect(sumUpRow.amount).toBe(45000 + 210000 + 802800);
    expect(result.sumUpByCategory).toEqual({
      Ofrendas: 45000,
      Cafetería: 210000,
      "SumUp histórico sin separar": 802800,
    });

    const cashRow = result.rows.find((r) => r.key === "cash")!;
    expect(cashRow.amount).toBe(120000);
    const percentSum = result.rows.reduce((sum, r) => sum + r.percent, 0);
    expect(percentSum).toBeGreaterThan(99);
    expect(percentSum).toBeLessThan(101);
  });

  it("omits 'Tarjeta · otra' and 'Otro' rows when they are zero", () => {
    const result = incomeByMethod([
      tx({ period: "2026-09", day: "1", amount: 1000, paymentMethod: "cash" }),
    ]);
    expect(result.rows.map((r) => r.key)).toEqual(["cash", "sumup", "transfer"]);
  });

  it("includes a non-SumUp card row separately when present", () => {
    const result = incomeByMethod([
      tx({ id: "getnet_1", period: "2026-09", day: "1", amount: 30000, paymentMethod: "card", createdBy: "user_1" }),
    ]);
    const otherCard = result.rows.find((r) => r.key === "otherCard");
    expect(otherCard?.amount).toBe(30000);
  });
});

describe("dayStatus — Falta efectivo (SPLIT = 2026-09-09)", () => {
  const today = "2026-09-22";

  it("flags Falta efectivo when SumUp has income and cash is 0, on/after the split, up to today", () => {
    const status = dayStatus(
      "2026-09-16",
      [
        tx({ id: "sumup_1", period: "2026-09", day: "16", amount: 210000, paymentMethod: "card", category: "Cafetería", createdBy: "system:sumup" }),
      ],
      today,
    );
    expect(status.missingCashAreas).toEqual(["Cafetería"]);
    expect(status.statusLabel).toBe("Falta efectivo · Cafetería");
  });

  it("does not flag Falta efectivo when cash was also registered that day", () => {
    const status = dayStatus(
      "2026-09-16",
      [
        tx({ id: "sumup_1", period: "2026-09", day: "16", amount: 210000, paymentMethod: "card", category: "Cafetería", createdBy: "system:sumup" }),
        tx({ period: "2026-09", day: "16", amount: 50000, paymentMethod: "cash", category: "Cafetería" }),
      ],
      today,
    );
    expect(status.missingCashAreas).toEqual([]);
  });

  it("flags both areas as 'Falta efectivo · 2 áreas' on 2026-09-13", () => {
    const status = dayStatus(
      "2026-09-13",
      [
        tx({ id: "sumup_1", period: "2026-09", day: "13", amount: 10000, paymentMethod: "card", category: "Ofrendas", createdBy: "system:sumup" }),
        tx({ id: "sumup_2", period: "2026-09", day: "13", amount: 20000, paymentMethod: "card", category: "Cafetería", createdBy: "system:sumup" }),
      ],
      today,
    );
    expect(status.missingCashAreas).toEqual(["Ofrendas", "Cafetería"]);
    expect(status.statusLabel).toBe("Falta efectivo · 2 áreas");
  });

  it("never flags Falta efectivo before the split date (2026-09-09)", () => {
    const status = dayStatus(
      "2026-09-08",
      [
        tx({ id: "sumup_1", period: "2026-09", day: "8", amount: 999999, paymentMethod: "card", category: "Cafetería", createdBy: "system:sumup" }),
      ],
      today,
    );
    expect(status.missingCashAreas).toEqual([]);
  });

  it("flags exactly on the split date, 2026-09-09", () => {
    const status = dayStatus(
      "2026-09-09",
      [
        tx({ id: "sumup_1", period: "2026-09", day: "9", amount: 5000, paymentMethod: "card", category: "Ofrendas", createdBy: "system:sumup" }),
      ],
      today,
    );
    expect(status.missingCashAreas).toEqual(["Ofrendas"]);
  });

  it("does not flag Falta efectivo for a future day (2026-09-20 relative to an earlier today)", () => {
    const status = dayStatus(
      "2026-09-20",
      [
        tx({ id: "sumup_1", period: "2026-09", day: "20", amount: 5000, paymentMethod: "card", category: "Ofrendas", createdBy: "system:sumup" }),
      ],
      "2026-09-18",
    );
    expect(status.isFuture).toBe(true);
    expect(status.missingCashAreas).toEqual([]);
    expect(status.statusLabel).toBe("");
  });
});

describe("dayStatus — Sin registros", () => {
  const today = "2026-09-22";

  it("flags a past worship day (Wednesday) with no transactions", () => {
    // 2026-09-02 is a Wednesday.
    const status = dayStatus("2026-09-02", [], today);
    expect(status.isWorshipDay).toBe(true);
    expect(status.noRecords).toBe(true);
    expect(status.statusLabel).toBe("Sin registros");
  });

  it("flags a past worship day (Sunday) with no transactions", () => {
    // 2026-09-20 is a Sunday.
    const status = dayStatus("2026-09-20", [], today);
    expect(status.isWorshipDay).toBe(true);
    expect(status.noRecords).toBe(true);
  });

  it("does not flag a non-worship day even with no transactions", () => {
    // 2026-09-01 is a Tuesday.
    const status = dayStatus("2026-09-01", [], today);
    expect(status.isWorshipDay).toBe(false);
    expect(status.noRecords).toBe(false);
  });

  it("does not flag today, even if it is a worship day with no transactions yet", () => {
    // Use a today that is itself a Wednesday/Sunday.
    const wednesdayToday = "2026-09-16";
    const status = dayStatus(wednesdayToday, [], wednesdayToday);
    expect(status.isToday).toBe(true);
    expect(status.noRecords).toBe(false);
  });

  it("does not flag a future worship day", () => {
    const status = dayStatus("2026-09-27", [], "2026-09-22");
    expect(status.isFuture).toBe(true);
    expect(status.noRecords).toBe(false);
  });

  it("does not flag a worship day that has any active transaction, even non-income", () => {
    const status = dayStatus(
      "2026-09-02",
      [tx({ period: "2026-09", day: "2", amount: 1000, type: "expense", paymentMethod: "cash" })],
      today,
    );
    expect(status.noRecords).toBe(false);
  });
});

function attribution(
  partial: Partial<TitheAttribution> & { period: string; amount: number; day: string },
): TitheAttribution {
  return {
    id: partial.id || `attr_${Math.random()}`,
    transactionId: partial.transactionId || `tx_${Math.random()}`,
    profileId: "profile_1",
    status: "active",
    note: "",
    createdBy: "user_1",
    createdAt: undefined as never,
    updatedBy: "user_1",
    updatedAt: undefined as never,
    date: {
      toDate: () => new Date(`${partial.period}-${partial.day.padStart(2, "0")}T12:00:00.000Z`),
    } as never,
    ...partial,
  };
}

describe("groupAttributionsByMonth", () => {
  it("groups by month, sums only active amounts, and counts every row", () => {
    const groups = groupAttributionsByMonth([
      attribution({ period: "2026-09", day: "16", amount: 60000 }),
      attribution({ period: "2026-09", day: "9", amount: 60000, status: "voided" }),
      attribution({ period: "2026-08", day: "30", amount: 50000 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ period: "2026-09", count: 2, subtotal: 60000 });
    expect(groups[1]).toMatchObject({ period: "2026-08", count: 1, subtotal: 50000 });
  });
});

describe("titheAggregates", () => {
  it("computes thisMonth/last12Months from active rows and thisYear from the current-year set", () => {
    const today = "2026-09-22";
    const last12 = [
      attribution({ period: "2026-09", day: "16", amount: 30000 }),
      attribution({ period: "2026-09", day: "9", amount: 30000, status: "voided" }),
      attribution({ period: "2026-08", day: "1", amount: 20000 }),
    ];
    const currentYear = [
      ...last12,
      attribution({ period: "2026-01", day: "5", amount: 10000 }),
    ];
    const result = titheAggregates(last12, currentYear, today);
    expect(result.thisMonth).toBe(30000);
    expect(result.last12Months).toBe(50000);
    expect(result.thisYear).toBe(60000);
    expect(result.thisYearCount).toBe(3);
  });

  it("returns 0 for thisYear when the current-year data isn't loaded", () => {
    const result = titheAggregates([], undefined, "2026-09-22");
    expect(result.thisYear).toBe(0);
    expect(result.thisYearCount).toBe(0);
  });
});

describe("buildMonthCalendar / reviewDays", () => {
  it("orders review items chronologically and lists both alert kinds", () => {
    const today = "2026-09-22";
    const transactions = [
      tx({ id: "sumup_1", period: "2026-09", day: "16", amount: 210000, paymentMethod: "card", category: "Cafetería", createdBy: "system:sumup" }),
      tx({ id: "sumup_2", period: "2026-09", day: "20", amount: 5000, paymentMethod: "card", category: "Ofrendas", createdBy: "system:sumup" }),
    ];
    const calendar = buildMonthCalendar(transactions, 2026, 9, today);
    expect(calendar.days).toHaveLength(30);
    expect(calendar.weeks.every((w) => w.length === 7)).toBe(true);

    const review = reviewDays(transactions, 2026, 9, today);
    const dates = review.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
    expect(review.some((r) => r.kind === "no-records" && r.date === "2026-09-02")).toBe(true);
    expect(review.some((r) => r.kind === "missing-cash" && r.date === "2026-09-16")).toBe(true);
    expect(review.some((r) => r.kind === "missing-cash" && r.date === "2026-09-20")).toBe(true);
  });
});
