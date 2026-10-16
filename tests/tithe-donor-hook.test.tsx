import { render, screen } from "@testing-library/react";
import { Timestamp, getDocsFromServer } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useValidatedMonthlyDonors } from "@/lib/finance/tithe-hooks";
import { parseDate } from "@/lib/finance/formatters";
import type { TitheAttribution } from "@/lib/finance/types";

vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: {} }) }));
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/firestore")>()),
  collection: (_db: unknown, name: string) => ({ name }),
  documentId: () => "__name__",
  where: (_field: string, _operator: string, ids: string[]) => ({ ids }),
  query: (ref: { name: string }, ...constraints: { ids: string[] }[]) => ({ ...ref, constraints }),
  getDocsFromServer: vi.fn(),
}));

function View({ attributions }: { attributions: TitheAttribution[] }) {
  const result = useValidatedMonthlyDonors(2026, 10, attributions, true);
  return <p>{result.loading ? "Cargando" : result.error || result.report.donors.length}</p>;
}

describe("validated monthly donor hook", () => {
  beforeEach(() => { vi.mocked(getDocsFromServer).mockReset(); });

  it("reads 31 links in two batches and accepts valid long document IDs", async () => {
    const date = parseDate("2026-10-12");
    const ids = Array.from({ length: 31 }, (_, i) =>
      i === 0 ? `movement-${"x".repeat(140)}` : `movement-${i}`,
    );
    const attributions = ids.map((id, i) => ({
      id, transactionId: id, profileId: `profile-${i}`, amount: 1000,
      date, period: "2026-10", status: "active",
    })) as TitheAttribution[];
    const requests: { name: string; size: number }[] = [];
    vi.mocked(getDocsFromServer).mockImplementation(async (request) => {
      const q = request as unknown as { name: string; constraints: { ids: string[] }[] };
      const batch = q.constraints[0].ids;
      requests.push({ name: q.name, size: batch.length });
      return {
        docs: batch.map((id) => ({
          id,
          data: () => q.name === "financeTransactions"
            ? { source: "tithe", type: "income", category: "Diezmos",
                status: "active", period: "2026-10", amount: 1000,
                date: Timestamp.fromMillis(date.toMillis()) }
            : { type: "person", displayName: id },
        })),
      } as never;
    });
    render(<View attributions={attributions} />);
    expect(await screen.findByText("31")).toBeInTheDocument();
    expect(requests.filter((r) => r.name === "financeTransactions").map((r) => r.size)).toEqual([30, 1]);
    expect(requests.filter((r) => r.name === "titheProfiles").map((r) => r.size)).toEqual([30, 1]);
  });
});
