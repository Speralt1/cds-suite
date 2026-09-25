import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import DashboardPage from "@/app/(private)/dashboard/page";
import { FinanceNav, DetailGuard } from "@/components/finance/shared";
import { TransactionList } from "@/components/finance/transactions/transaction-list";
import {
  canSeePastoral,
  canSeeDetails,
  isAuthorized,
} from "@/lib/finance/permissions";
import type { AccessUser, FinanceTransaction, Role } from "@/lib/finance/types";
const state = vi.hoisted(() => ({
  role: "admin" as Role,
  path: "/finanzas",
  replace: vi.fn(),
}));
vi.mock("@/lib/auth/access-provider", () => ({
  useAccess: () => ({ role: state.role, active: true }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useRouter: () => ({ replace: state.replace }),
}));
beforeEach(() => {
  state.role = "admin";
  state.path = "/finanzas";
  state.replace.mockClear();
});
it("/dashboard ya no tiene contenido propio: redirige a /finanzas", () => {
  render(<DashboardPage />);
  expect(state.replace).toHaveBeenCalledWith("/finanzas");
});
it.each(["admin", "pastor", "finance"] as Role[])(
  "navegación con rutas reales para %s",
  (role) => {
    state.role = role;
    state.path = "/finanzas/diezmos/abc";
    render(<FinanceNav />);
    expect(screen.getAllByRole("link")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Diezmos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Movimientos" })).toHaveAttribute(
      "href",
      "/finanzas/movimientos",
    );
    expect(screen.getByRole("link", { name: "Campañas" })).toHaveAttribute(
      "href",
      "/finanzas/campanas",
    );
    expect(
      screen.getByRole("link", { name: "Ofrendas y Cafetería" }),
    ).toHaveAttribute(
      "href",
      "/finanzas/ofrendas",
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
it("un rol sin permiso de detalle ve la barra solo con Resumen", () => {
  state.role = "leader";
  render(<FinanceNav />);
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveTextContent("Resumen");
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

function makeTransaction(overrides: Partial<FinanceTransaction>): FinanceTransaction {
  return {
    id: "financeTransactions/abc",
    type: "income",
    amount: 1000,
    date: { toDate: () => new Date("2026-09-14") } as never,
    category: "Ofrendas",
    paymentMethod: "cash",
    description: "Movimiento",
    note: "",
    status: "active",
    period: "2026-09",
    day: "14",
    source: "general",
    revision: 1,
    createdBy: "uid1",
    ...overrides,
  } as FinanceTransaction;
}

it("los movimientos importados de SumUp no muestran Editar ni Anular y sí un badge de solo lectura", () => {
  const items = [
    makeTransaction({
      id: "sumup_offerings_tx1",
      createdBy: "system:sumup",
      category: "Ofrendas",
      paymentMethod: "card",
    }),
    makeTransaction({ id: "financeTransactions/manual1", createdBy: "uid1" }),
  ];
  render(<TransactionList items={items} />);
  expect(screen.getByText("SumUp · solo lectura")).toBeInTheDocument();
  expect(screen.queryAllByRole("button", { name: "Editar" })).toHaveLength(1);
  expect(screen.queryAllByRole("button", { name: "Anular" })).toHaveLength(1);
});

// Slice 3a: "Líquido" ahora es legítimo, pero SOLO dentro del bloque que
// muestra la comisión/depósito real de SumUp (settlement) — nunca como
// etiqueta de un monto que en realidad es bruto (spec §UI "Etiquetas").
// "Conciliado" tampoco se usa: SumUp pagando el líquido esperado no es lo
// mismo que estar conciliado contra la cartola del banco (ver
// lib/finance/sumup-settlement.ts).
it("offerings-page no usa lenguaje engañoso (líquido/conciliado) en las etiquetas de SumUp", () => {
  const source = readFileSync(
    "components/finance/offerings/offerings-page.tsx",
    "utf-8",
  );

  expect(source).not.toMatch(/Tarjeta SumUp · líquido/i);
  expect(source).not.toMatch(/Tarjeta líquida/i);
  expect(source).not.toMatch(/Conciliado/);

  // Toda aparición de "líquido" debe vivir en el bloque de settlement real
  // (identificado por mencionar comisionSumUp o settlement cerca), nunca
  // suelta junto a "Tarjeta SumUp (bruto)".
  const liquidMatches = [...source.matchAll(/líquid[oa]/gi)];
  expect(liquidMatches.length).toBeGreaterThan(0);
  for (const match of liquidMatches) {
    const index = match.index ?? 0;
    const window = source.slice(Math.max(0, index - 400), index + 400);
    expect(window).toMatch(/comisionSumUp|settlement/i);
  }
});
