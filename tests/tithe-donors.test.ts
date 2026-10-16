import { describe, expect, it, vi } from "vitest";
import { parseDate, santiagoDateLabel, santiagoToday } from "@/lib/finance/formatters";
import { titheDonorReport } from "@/lib/finance/tithe-donors";
import { variation } from "@/lib/finance/calculations";
import type { FinanceTransaction, TitheAttribution, TitheProfile } from "@/lib/finance/types";

function profile(id: string, type: "person" | "family", active = true) {
  return { id, type, displayName: `${type} ${id}`, active } as TitheProfile;
}
function pair(id: string, profileId: string, amount: number, day: string) {
  const date = parseDate(day);
  return {
    attribution: {
      id, transactionId: id, profileId, amount, date,
      period: day.slice(0, 7), status: "active",
    } as TitheAttribution,
    transaction: {
      id, amount, date, period: day.slice(0, 7),
      type: "income", source: "tithe", category: "Diezmos", status: "active",
    } as FinanceTransaction,
  };
}

describe("monthly tithe donors", () => {
  it("counts a person once for several donations and keeps families distinct", () => {
    const a = pair("a", "person", 1000, "2026-10-01");
    const b = pair("b", "person", 2500, "2026-10-31");
    const c = pair("c", "family", 3000, "2026-10-12");
    const report = titheDonorReport(
      "2026-10", [a.attribution, b.attribution, c.attribution],
      [a.transaction, b.transaction, c.transaction],
      [profile("person", "person"), profile("family", "family", false)],
    );
    expect(report.excluded).toBe(0);
    expect(report.donors).toHaveLength(2);
    expect(report.donors.find((d) => d.profile.id === "person")).toMatchObject({
      contributions: 2, total: 3500,
    });
    expect(report.donors.find((d) => d.profile.id === "person")?.latestDate.toMillis())
      .toBe(parseDate("2026-10-31").toMillis());
    expect(report.donors.find((d) => d.profile.id === "family")?.total).toBe(3000);
  });

  it("excludes voided, orphaned, mismatched and duplicate movements", () => {
    const good = pair("good", "p1", 1000, "2026-10-02");
    const voided = pair("voided", "p1", 1000, "2026-10-03");
    voided.attribution.status = "voided";
    const orphan = pair("orphan", "missing", 1000, "2026-10-04");
    const wrongAmount = pair("wrong", "p1", 1000, "2026-10-05");
    wrongAmount.transaction.amount = 900;
    const wrongMonth = pair("month", "p1", 1000, "2026-09-30");
    const report = titheDonorReport(
      "2026-10",
      [good.attribution, good.attribution, voided.attribution, orphan.attribution,
        wrongAmount.attribution, wrongMonth.attribution],
      [good.transaction, voided.transaction, orphan.transaction,
        wrongAmount.transaction, wrongMonth.transaction],
      [profile("p1", "person")],
    );
    expect(report.donors).toHaveLength(1);
    expect(report.donors[0]).toMatchObject({ contributions: 1, total: 1000 });
    expect(report.excluded).toBe(4);
  });

  it("leaves percentage undefined when the previous month has no donors", () => {
    expect(variation(3, 0)).toBeNull();
    expect(variation(26, 32)).toBe(-18.75);
  });

  it("uses the civil day in Santiago at a UTC month boundary", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-01T02:30:00Z"));
      expect(santiagoToday()).toBe("2026-10-31");
    } finally {
      vi.useRealTimers();
    }
  });

  it("labels a late Chilean donation on its local day", () => {
    expect(santiagoDateLabel({ toDate: () => new Date("2026-11-01T02:30:00Z") } as never))
      .toBe("31-10-2026");
  });
});
