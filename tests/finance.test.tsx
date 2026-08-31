import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import DashboardPage from "@/app/(private)/dashboard/page";
import { FinanceWorkspace } from "@/components/finance/finance-workspace";

it("links to Finanzas and keeps future modules non-interactive", () => {
  render(<DashboardPage />);
  expect(screen.getByRole("link", { name: "Ingresar" })).toHaveAttribute(
    "href",
    "/finanzas",
  );
  expect(screen.getAllByText("Próximamente")).toHaveLength(4);
  expect(screen.getAllByRole("link")).toHaveLength(1);
});

it("switches placeholder panels with clicks and keyboard navigation", async () => {
  const interaction = userEvent.setup();
  render(<FinanceWorkspace />);
  expect(screen.getAllByRole("tab")).toHaveLength(4);
  await interaction.click(screen.getByRole("tab", { name: "Movimientos" }));
  expect(screen.getByRole("tabpanel")).toHaveTextContent(
    "Cada movimiento, en su lugar",
  );
  await interaction.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Diezmos" })).toHaveFocus();
  expect(screen.getByRole("tabpanel")).toHaveTextContent(
    "Un espacio para la generosidad",
  );
  await interaction.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "Reportes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await interaction.keyboard("{Home}");
  expect(screen.getByRole("tab", { name: "Resumen" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
