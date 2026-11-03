import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import SimWorkspace from "@/components/outreach/sim-workspace";

describe("«Ve por los tuyos» · espacio simulado (doc 40)", () => {
  it("panorama → propuesta → confirmación → Mi lista → contacto, con datos ficticios", async () => {
    const user = userEvent.setup();
    render(<SimWorkspace />);
    expect(screen.getByRole("note")).toHaveTextContent("Nada se guarda ni se envía");
    expect(screen.getByRole("heading", { name: "Ve por los tuyos" })).toBeInTheDocument();
    // Asistencia con denominador: 240/40/20 de 300; la ausencia no se deduce.
    expect(screen.getByText("Revisar y confirmar ausencias")).toBeInTheDocument();
    const fu = screen.getByRole("region", { name: "Seguimiento" });
    expect(within(fu).getByText("Sin asignar").nextSibling).toHaveTextContent("240");

    await user.click(screen.getByRole("button", { name: /Distribución/ }));
    await user.click(screen.getByRole("button", { name: "Generar propuesta" }));
    expect(screen.getByRole("heading", { name: "Propuesta · 240 personas" })).toBeInTheDocument();
    expect(screen.getAllByText("16/20")).toHaveLength(15);
    await user.click(screen.getByRole("button", { name: "Confirmar distribución" }));
    expect(screen.getByRole("status")).toHaveTextContent("240 asignaciones nuevas");

    await user.click(screen.getByRole("button", { name: /Mi lista/ }));
    expect(screen.getByRole("heading", { name: "Primer contacto 16" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Registrar contacto" })[0]);
    await user.click(screen.getByRole("button", { name: "Guardar contacto" }));
    expect(screen.getByRole("heading", { name: "Primer contacto 15" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Próximamente 1" })).toBeInTheDocument();
  });

  it("una edición cerrada se consulta aparte y sin pendientes de la vigente", async () => {
    const user = userEvent.setup();
    render(<SimWorkspace />);
    await user.selectOptions(screen.getByLabelText("Edición"), "vplt-2025");
    expect(screen.getByText("Cerrada: sus pendientes no aparecen en la edición vigente.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Distribución/ })).toBeNull();
  });
});

describe("Exclusión de la build productiva", () => {
  it("check:no-preview prohíbe la simulación y los valores de decisión", async () => {
    const { FORBIDDEN_TEXT } = (await import(path.resolve(__dirname, "../../scripts/check-no-preview.mjs"))) as { FORBIDDEN_TEXT: string[] };
    expect(FORBIDDEN_TEXT).toEqual(expect.arrayContaining(["outreach-sim-fixture", "acepto_a_cristo", "+56900000", "@example.test"]));
  });

  it("next.config reemplaza la simulación por un módulo vacío sin la variable", () => {
    const cfg = fs.readFileSync(path.resolve(__dirname, "../../next.config.ts"), "utf8");
    expect(cfg).toMatch(/NEXT_PUBLIC_CDS_OUTREACH_SIM === "1"/);
    expect(cfg).toMatch(/components\/outreach\/sim-disabled\.tsx/);
  });

  it("los interruptores productivos del submódulo están apagados", async () => {
    const { OUTREACH_FEATURES } = await import("@/lib/outreach/features");
    expect(OUTREACH_FEATURES).toEqual({ enabled: false, decisions: false, messaging: false });
  });
});
