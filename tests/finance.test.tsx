import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import DashboardPage from "@/app/(private)/dashboard/page";
import { FinanceNav, DetailGuard } from "@/components/finance/shared";
import {
  canSeePastoral,
  canSeeDetails,
  isAuthorized,
} from "@/lib/finance/permissions";
import type { AccessUser, Role } from "@/lib/finance/types";
const state = vi.hoisted(() => ({ role: "admin" as Role, path: "/finanzas" }));
vi.mock("@/lib/auth/access-provider", () => ({
  useAccess: () => ({ role: state.role, active: true }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
beforeEach(() => {
  state.role = "admin";
  state.path = "/finanzas";
});
it("mantiene acceso a Finanzas desde el dashboard y módulos futuros sin acciones", () => {
  render(<DashboardPage />);
  expect(screen.getByRole("link", { name: "Ingresar" })).toHaveAttribute(
    "href",
    "/finanzas",
  );
  expect(screen.getAllByText("Próximamente")).toHaveLength(4);
});
it.each(["admin", "pastor", "finance"] as Role[])(
  "navegación con rutas reales para %s",
  (role) => {
    state.role = role;
    state.path = "/finanzas/diezmos/abc";
    render(<FinanceNav />);
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "Diezmos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Movimientos" })).toHaveAttribute(
      "href",
      "/finanzas/movimientos",
    );
  },
);
it("líder solo ve resumen y no monta componentes de detalle", () => {
  state.role = "leader";
  const privateRender = vi.fn();
  function Private() {
    privateRender();
    return <p>Privado</p>;
  }
  render(
    <>
      <FinanceNav />
      <DetailGuard>
        <Private />
      </DetailGuard>
    </>,
  );
  expect(screen.queryByRole("link", { name: "Diezmos" })).toBeNull();
  expect(screen.queryByText("Privado")).toBeNull();
  expect(privateRender).not.toHaveBeenCalled();
});
it("permisos explícitos y denegación por defecto", () => {
  for (const role of ["admin", "pastor", "finance", "leader"] as Role[]) {
    expect(canSeeDetails(role)).toBe(role !== "leader");
    expect(canSeePastoral(role)).toBe(role === "admin" || role === "pastor");
  }
  expect(isAuthorized(null)).toBeFalsy();
  expect(isAuthorized({ role: "admin", active: false } as AccessUser)).toBe(
    false,
  );
  expect(
    isAuthorized({ role: "inventado", active: true } as unknown as AccessUser),
  ).toBe(false);
});
