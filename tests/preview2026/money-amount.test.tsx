import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoneyAmount } from "@/components/preview2026/money-amount";

describe("MoneyAmount", () => {
  it("formatea en pesos chilenos, tabular y sin decimales", () => {
    render(<MoneyAmount value={102000} />);
    expect(screen.getByText("$102.000")).toBeInTheDocument();
  });

  it("usa el signo menos real (U+2212) además del color para negativos", () => {
    render(<MoneyAmount value={-4500} />);
    const el = screen.getByText("−$4.500");
    expect(el).toBeInTheDocument();
    expect(el.className).toContain("p26-money__value");
    expect(el.closest(".p26-money")?.className).toContain("p26-money--negative");
  });

  it("muestra la base explícita (bruto/líquido/efectivo) cuando se pasa", () => {
    render(<MoneyAmount value={12000} basis="bruto" />);
    expect(screen.getByText("bruto")).toBeInTheDocument();
  });

  it("el aria-label indica el signo para valores negativos", () => {
    render(<MoneyAmount value={-4500} />);
    const wrapper = screen.getByText("−$4.500").closest(".p26-money");
    expect(wrapper?.getAttribute("aria-label")).toMatch(/^menos /);
  });
});
