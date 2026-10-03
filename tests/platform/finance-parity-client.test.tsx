import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailGuard, FinanceNav } from "@/components/finance/shared";
import { SummaryPage } from "@/components/finance/dashboard/summary-page";
import { SettingsGuard } from "@/components/settings/settings-guard";
import { canSeeDetails, canSeePastoral, isAuthorized, ROLES } from "@/lib/finance/permissions";
import { can } from "@/lib/shared/access";
import type { AccessUser, Role } from "@/lib/finance/types";
import { v1 } from "./profiles";

const state = vi.hoisted(() => ({
  access: { role: "admin", active: true } as Record<string, unknown>,
  path: "/finanzas",
  transactionsEnabled: [] as boolean[],
}));

vi.mock("@/lib/auth/access-provider", () => ({
  useAccess: () => state.access,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/lib/finance/hooks", () => ({
  usePeriod: () =>
    useState({ year: 2026, month: 10, view: "month" as const }),
  useSummaries: () => ({ data: [], loading: false, error: "" }),
  useTransactions: (_period: unknown, enabled = true) => {
    state.transactionsEnabled.push(enabled);
    return { data: [], loading: false, error: "" };
  },
}));
vi.mock("@/components/finance/charts/finance-charts", () => ({
  FinanceCharts: () => <div>Gráficos</div>,
}));

beforeEach(() => {
  state.access = { role: "admin", active: true };
  state.path = "/finanzas";
  state.transactionsEnabled = [];
});

/** Comportamiento por rol ANTERIOR a este cambio (lib/finance/permissions @ e6b2084). */
const ORIGINAL = {
  details: (role?: Role) => role === "admin" || role === "pastor" || role === "finance",
  pastoral: (role?: Role) => role === "admin" || role === "pastor",
};

describe("wrappers @deprecated = can() para los roles legacy", () => {
  it.each(ROLES)("%s", (role) => {
    const legacy = { role, active: true };
    expect(canSeeDetails(role)).toBe(can(legacy, "finance.details.read"));
    expect(canSeePastoral(role)).toBe(can(legacy, "finance.pastoral.manage"));
    expect(canSeeDetails(role)).toBe(ORIGINAL.details(role));
    expect(canSeePastoral(role)).toBe(ORIGINAL.pastoral(role));
    expect(can(legacy, "settings.manage")).toBe(role === "admin");
    expect(can(legacy, "finance.summary.read")).toBe(true);
  });

  it("deniega por defecto sin rol o con un rol inventado", () => {
    expect(canSeeDetails(undefined)).toBe(false);
    expect(canSeePastoral(undefined)).toBe(false);
    expect(canSeeDetails("inventado" as Role)).toBe(false);
  });

  it("isAuthorized conserva su semántica (activo + rol válido), también para documentos v1", () => {
    expect(isAuthorized(null)).toBe(false);
    for (const role of ROLES) {
      expect(isAuthorized({ role, active: true } as AccessUser)).toBe(true);
      expect(isAuthorized({ role, active: false } as AccessUser)).toBe(false);
    }
    expect(isAuthorized(v1({ role: "leader", permissions: [] }) as unknown as AccessUser)).toBe(true);
    expect(isAuthorized({ active: true, accessSchemaVersion: 1 } as unknown as AccessUser)).toBe(false);
  });
});

describe("call sites con can(access, …): mismo comportamiento", () => {
  it.each(ROLES)("FinanceNav y DetailGuard para %s", (role) => {
    state.access = { role, active: true };
    render(
      <>
        <FinanceNav />
        <DetailGuard>
          <p>Detalle privado</p>
        </DetailGuard>
      </>,
    );
    expect(screen.getAllByRole("link", { hidden: false }).filter((a) => a.closest("nav"))).toHaveLength(
      ORIGINAL.details(role) ? 6 : 1,
    );
    expect(screen.queryByText("Detalle privado") !== null).toBe(ORIGINAL.details(role));
  });

  it("SettingsGuard solo deja pasar a administración (legacy y v1)", () => {
    for (const [access, allowed] of [
      [{ role: "admin", active: true }, true],
      [{ role: "pastor", active: true }, false],
      [v1({ role: "admin", baseRole: "admin" }), true],
      [v1({ role: "leader", permissions: ["settings.manage"] }), false],
    ] as const) {
      state.access = access as Record<string, unknown>;
      const view = render(
        <SettingsGuard>
          <p>Configuración privada</p>
        </SettingsGuard>,
      );
      expect(screen.queryByText("Configuración privada") !== null).toBe(allowed);
      view.unmount();
    }
  });

  it("v1 con detalle financiero ve la navegación completa; v1 solo resumen ve 1 link", () => {
    state.access = v1({ role: "finance", permissions: ["finance.records.manage"] });
    const first = render(<FinanceNav />);
    expect(screen.getAllByRole("link")).toHaveLength(6);
    first.unmount();
    state.access = v1({ permissions: ["finance.summary.read", "calendar.read"] });
    render(<FinanceNav />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Resumen"]);
  });
});

describe("Líder (solo finance.summary.read): el resumen no cambia", () => {
  function renderSummary(access: Record<string, unknown>) {
    state.access = access;
    state.transactionsEnabled = [];
    const view = render(<SummaryPage />);
    const html = view.container.innerHTML;
    const enabled = [...state.transactionsEnabled];
    view.unmount();
    return { html, enabled };
  }

  it("legacy y v1 equivalentes renderizan exactamente lo mismo, sin pedir movimientos", () => {
    const legacy = renderSummary({ role: "leader", active: true });
    const migrated = renderSummary(
      v1({
        role: "leader",
        position: "Líder",
        permissions: ["finance.summary.read", "calendar.read", "calendar.events.manage_assigned"],
        areaIds: ["jovenes"],
      }),
    );
    expect(migrated.html).toBe(legacy.html);
    expect(legacy.enabled.length).toBeGreaterThan(0);
    expect(legacy.enabled.every((e) => e === false)).toBe(true);
    expect(migrated.enabled.every((e) => e === false)).toBe(true);
  });

  it("el resumen del líder difiere del de finanzas (sanidad: el detalle sí depende del permiso)", () => {
    const leader = renderSummary({ role: "leader", active: true });
    const finance = renderSummary({ role: "finance", active: true });
    expect(finance.enabled.some((e) => e === true)).toBe(true);
    expect(finance.html).not.toBe(leader.html);
  });
});
