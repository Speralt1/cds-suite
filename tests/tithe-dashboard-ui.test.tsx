import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TithesPage } from "@/components/finance/tithes/tithes-page";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth/access-provider", () => ({
  useAccess: () => ({ role: "finance", active: true }),
}));
vi.mock("@/lib/finance/hooks", () => ({
  usePeriod: () => [{ year: 2026, month: 10, view: "month" }, vi.fn()],
  useSummaries: () => ({
    data: [{ id: "2026-10", incomeTotal: 2720750, expenseTotal: 0,
      result: 2720750, titheTotal: 2720750, transactionCount: 27,
      incomeByCategory: {}, expenseByCategory: {}, dailyIncome: {}, dailyExpense: {} }],
    loading: false, error: "",
  }),
}));
vi.mock("@/lib/finance/tithe-hooks", () => ({
  useProfiles: () => ({ data: [], loading: false, error: "" }),
  useLatestAttribution: () => ({ data: [], loading: false, error: "" }),
  useProfileCount: () => ({ count: 1, loading: false, error: "" }),
  useTotalProfileCount: () => ({ count: 41, loading: false, error: "" }),
  useMonthlyAttributions: () => ({ data: [], synced: true, loading: false, error: "" }),
  useValidatedMonthlyDonors: (_year: number, month: number) => ({
    report: {
      donors: month === 10 ? [
        { profile: { id: "p1", displayName: "Ana", type: "person" },
          contributions: 2, total: 15000,
          latestDate: { toDate: () => new Date("2026-10-12T12:00:00Z") } },
        { profile: { id: "f1", displayName: "Familia Silva", type: "family" },
          contributions: 1, total: 8000,
          latestDate: { toDate: () => new Date("2026-10-10T12:00:00Z") } },
      ] : Array.from({ length: 4 }, (_, i) => ({ profile: { id: `old${i}` } })),
      excluded: 0,
    },
    loading: false, error: "",
  }),
}));
vi.mock("@/components/finance/shared", () => ({
  DetailGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  FinancePageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  Notice: () => null,
  Loading: () => null,
  Empty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PeriodPicker: () => null,
  Modal: ({ title, children }: { title: string; children: React.ReactNode }) =>
    <div role="dialog" aria-label={title}>{children}</div>,
}));
vi.mock("@/components/finance/forms/profile-form", () => ({ ProfileForm: () => null }));
vi.mock("@/components/finance/tithes/tithe-register", () => ({ TitheRegister: () => null }));
vi.mock("@/components/finance/tithes/duplicate-profiles", () => ({ DuplicateProfilesPanel: () => null }));

describe("tithe dashboard", () => {
  it("shows four distinct metrics and opens the month donor detail", () => {
    render(<TithesPage />);
    expect(screen.getByRole("heading", { name: "Diezmos del mes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Diezmantes del mes$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Diezmantes del mes anterior" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Personas/familias registradas" })).toBeInTheDocument();
    expect(screen.getByText(/Septiembre 2026 · −50% este mes/)).toBeInTheDocument();
    expect(screen.getByText("41")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle de diezmantes del mes" }));
    const detail = screen.getByRole("dialog", { name: "Diezmantes · Octubre 2026" });
    expect(within(detail).getByText("Ana")).toBeInTheDocument();
    expect(within(detail).getByText("Familia Silva")).toBeInTheDocument();
    expect(within(detail).getByText("15.000", { exact: false })).toBeInTheDocument();
    expect(within(detail).getByText("12-10-2026", { exact: false })).toBeInTheDocument();
  });
});
