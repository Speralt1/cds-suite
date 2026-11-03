import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import SimWorkspace from "@/components/outreach/sim-workspace";
import { initialSimState } from "@/lib/outreach/sim/state";

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
    // 35 encargados, cada persona con el de su mesa: 30 mesas de 7 y 5 de 6.
    expect(screen.getByText(/240 con el encargado de su mesa/)).toBeInTheDocument();
    expect(screen.getAllByText("7/20")).toHaveLength(30);
    expect(screen.getAllByText("6/20")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Confirmar distribución" }));
    expect(screen.getByRole("status")).toHaveTextContent("240 asignaciones nuevas");

    await user.click(screen.getByRole("button", { name: /Mi lista/ }));
    expect(screen.getByRole("heading", { name: "Primer contacto 7" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Registrar contacto" })[0]);
    await user.click(screen.getByRole("button", { name: "Guardar contacto" }));
    expect(screen.getByRole("heading", { name: "Primer contacto 6" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Próximamente 1" })).toBeInTheDocument();
  });

  it("mesa: busca por nombre, exige el «sí» de la persona y marca con un toque", async () => {
    const user = userEvent.setup();
    const sim = initialSimState();
    const marked = new Set(sim.decisions.map((d) => d.registrationId));
    const target = sim.sync.registrations.find((r) => r.tableNumber === 12 && !marked.has(r.id));
    if (!target?.ticketCode) throw new Error("la simulación debía tener alguien sin marca en la mesa 12");
    render(<SimWorkspace />);
    await user.click(screen.getByRole("button", { name: /Mesa/ }));
    const before = Number(screen.getByRole("heading", { name: /En esta mesa 12/ }).textContent!.replace(/^.*\s/, ""));
    await user.type(screen.getByLabelText(/Busca por nombre o apellido/), target.fullName);
    const results = screen.getByRole("list", { name: "Resultados" });
    expect(within(results).getByText(target.fullName)).toBeInTheDocument();
    // La mesa nunca ve teléfonos.
    expect(results.textContent).not.toMatch(/\+569/);
    await user.click(within(results).getByRole("button", { name: "Elegir" }));
    const accept = screen.getByRole("button", { name: "Aceptó a Cristo" });
    expect(accept).toBeDisabled();
    await user.click(screen.getByLabelText(/Dijo que sí/));
    await user.click(accept);
    // ya estaba sentada en la mesa 12: el total no cambia y ahora lleva su marca
    expect(screen.getByRole("heading", { name: `En esta mesa 12 ${before}` })).toBeInTheDocument();
    const row = screen.getAllByText(target.fullName).map((n) => n.closest("li")).find((li) => li?.textContent?.includes("Aceptó a Cristo"));
    expect(row).toBeTruthy();
  });

  it("mesa: «Está en mi mesa» sienta sin decisión ni «sí» y aparece como «Sin marca»", async () => {
    const user = userEvent.setup();
    const sim = initialSimState();
    const target = sim.sync.registrations.find((r) => r.status === "activa" && r.tableNumber == null && r.fullName.trim().split(/\s+/).length >= 2);
    if (!target) throw new Error("la simulación debía tener alguien sin mesa");
    render(<SimWorkspace />);
    await user.click(screen.getByRole("button", { name: /Mesa/ }));
    const before = Number(screen.getByRole("heading", { name: /En esta mesa 12/ }).textContent!.replace(/^.*\s/, ""));
    await user.type(screen.getByLabelText(/Busca por nombre o apellido/), target.fullName);
    await user.click(within(screen.getByRole("list", { name: "Resultados" })).getAllByRole("button", { name: "Elegir" })[0]);
    expect(screen.getByRole("checkbox", { name: "¿Te podemos anotar para acompañarte? · Dijo que sí" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Está en mi mesa (sin decisión)" }));
    expect(screen.getByRole("heading", { name: `En esta mesa 12 ${before + 1}` })).toBeInTheDocument();
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
