import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ access: { role: "admin", active: true } as Record<string, unknown> }));

vi.mock("next/navigation", () => ({ usePathname: () => "/configuracion" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/auth/access-provider", () => ({ useAccess: () => state.access }));

import ConfigurationLayout from "@/app/(private)/configuracion/layout";
import { ConfigurationPage } from "@/components/settings/configuration-page";

describe("Configuración: patrón de módulo (ciclo 1, C2)", () => {
  it("h1 «Configuración», luego la subnav y luego el h2 de la sección", () => {
    const { container } = render(
      <ConfigurationLayout>
        <ConfigurationPage />
      </ConfigurationLayout>,
    );
    const h1 = screen.getByRole("heading", { level: 1, name: "Configuración" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(h1.className).toContain("text-xl");
    expect(h1.className).toContain("font-semibold");
    const nav = screen.getByRole("navigation", { name: "Secciones de Configuración" });
    expect(within(nav).getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");
    const h2 = screen.getByRole("heading", { level: 2, name: "General" });
    expect(h2.className).toContain("text-xl");
    expect(h2.className).toContain("font-semibold");
    expect(screen.getByText("Datos generales de la iglesia en CDS Suite.").className).toContain("text-muted");
    // Orden en el documento: h1 → subnav → h2 → contenido.
    const order = [...container.querySelectorAll("h1, nav, h2, h3")];
    expect(order.indexOf(h1)).toBeLessThan(order.indexOf(nav));
    expect(order.indexOf(nav)).toBeLessThan(order.indexOf(h2));
    expect(screen.getByRole("heading", { level: 3, name: "Datos de la iglesia" })).toBeVisible();
  });

  it("sin permiso de configuración no muestra el módulo", () => {
    state.access = { role: "leader", active: true };
    render(
      <ConfigurationLayout>
        <ConfigurationPage />
      </ConfigurationLayout>,
    );
    expect(screen.queryByRole("navigation", { name: "Secciones de Configuración" })).toBeNull();
    expect(screen.getByRole("heading", { name: /solo está disponible para administradores/ })).toBeVisible();
  });
});
