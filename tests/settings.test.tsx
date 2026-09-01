import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsGuard } from "@/components/settings/settings-guard";
import { validateTransaction } from "@/lib/finance/calculations";
import type { Role, TransactionInput } from "@/lib/finance/types";
import {
  FALLBACK_FINANCE_SETTINGS,
  categoriesForTransaction,
  resolveFinanceSettings,
  validateNewCategory,
} from "@/lib/settings/finance-settings";
import { validateManagedUserUpdate } from "@/lib/settings/users";

const access = vi.hoisted(() => ({ role: "admin" as Role }));

vi.mock("@/lib/auth/access-provider", () => ({
  useAccess: () => ({ role: access.role, active: true }),
}));

beforeEach(() => {
  access.role = "admin";
});

describe("acceso a Configuración", () => {
  it("permite al administrador montar el contenido", () => {
    render(
      <SettingsGuard>
        <p>Configuración privada</p>
      </SettingsGuard>,
    );
    expect(screen.getByText("Configuración privada")).toBeVisible();
  });

  it.each(["pastor", "finance", "leader"] as Role[])(
    "impide que %s monte el contenido",
    (role) => {
      access.role = role;
      render(
        <SettingsGuard>
          <p>Configuración privada</p>
        </SettingsGuard>,
      );
      expect(screen.queryByText("Configuración privada")).toBeNull();
      expect(screen.getByText(/solo está disponible/i)).toBeVisible();
    },
  );
});

describe("categorías financieras configurables", () => {
  it("usa defaults más Cafetería cuando el documento no existe", () => {
    const settings = resolveFinanceSettings(undefined);
    expect(settings.incomeCategoriesActive).toContain("Cafetería");
    expect(settings.expenseCategoriesActive).toContain("Cafetería");
    expect(settings).toEqual(FALLBACK_FINANCE_SETTINGS);
  });

  it("oculta una categoría inactiva en altas y la conserva para históricos", () => {
    const settings = resolveFinanceSettings({
      incomeCategoriesAll: ["Taller histórico"],
      incomeCategoriesActive: ["Ofrendas"],
      expenseCategoriesAll: [],
      expenseCategoriesActive:
        FALLBACK_FINANCE_SETTINGS.expenseCategoriesActive,
    });
    expect(categoriesForTransaction(settings, "income")).not.toContain(
      "Taller histórico",
    );
    expect(
      categoriesForTransaction(settings, "income", "Taller histórico"),
    ).toContain("Taller histórico");
    expect(settings.incomeCategoriesAll).toContain("Taller histórico");
  });

  it.each([
    ["income", "Cafetería"],
    ["expense", "Cafetería"],
  ] as const)("Cafetería funciona como %s", (type, category) => {
    const input: TransactionInput = {
      type,
      amount: 1000,
      date: "2026-09-01",
      category,
      paymentMethod: "cash",
      description: "Venta de prueba",
      note: "",
    };
    expect(() => validateTransaction(input)).not.toThrow();
  });

  it("normaliza espacios y rechaza nombres repetidos", () => {
    expect(
      validateNewCategory(
        FALLBACK_FINANCE_SETTINGS,
        "income",
        "  Taller   comunitario  ",
      ),
    ).toBe("Taller comunitario");
    expect(() =>
      validateNewCategory(FALLBACK_FINANCE_SETTINGS, "income", "  cafetería "),
    ).toThrow("Ya existe");
  });
});

describe("protección del administrador", () => {
  it("permite actualizar otro usuario", () => {
    expect(
      validateManagedUserUpdate("admin", "other", {
        displayName: "  Otra   Persona ",
        role: "finance",
        active: false,
      }),
    ).toEqual({
      displayName: "Otra Persona",
      role: "finance",
      active: false,
    });
  });

  it("impide quitar el acceso propio", () => {
    expect(() =>
      validateManagedUserUpdate("admin", "admin", {
        displayName: "Admin",
        role: "finance",
        active: true,
      }),
    ).toThrow("No puedes");
    expect(() =>
      validateManagedUserUpdate("admin", "admin", {
        displayName: "Admin",
        role: "admin",
        active: false,
      }),
    ).toThrow("No puedes");
  });
});
