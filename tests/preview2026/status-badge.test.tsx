import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { STATUS_CONFIG, StatusBadge, type StatusKey } from "@/components/preview2026/status-badge";

describe("StatusBadge", () => {
  it.each(Object.keys(STATUS_CONFIG) as StatusKey[])(
    "siempre renderiza texto legible para el estado %s (nunca solo color)",
    (status) => {
      const { unmount } = render(<StatusBadge status={status} />);
      const expected = STATUS_CONFIG[status].label;
      expect(screen.getByText(expected)).toBeInTheDocument();
      unmount();
    },
  );

  it("acepta una etiqueta con detalle, p. ej. una diferencia", () => {
    render(<StatusBadge status="con-diferencia" label="Diferencia −$4.500" />);
    expect(screen.getByText("Diferencia −$4.500")).toBeInTheDocument();
  });
});
