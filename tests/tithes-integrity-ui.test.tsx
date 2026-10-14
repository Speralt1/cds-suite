// Integridad de diezmos (doc 27): UI de fichas duplicadas y de diezmo repetido.
// Firestore se simula: las reglas y el cliente real se prueban en tests/rules.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
import { ProfileForm } from "@/components/finance/forms/profile-form";
import { TransactionForm } from "@/components/finance/forms/transaction-form";
import { TitheRegister } from "@/components/finance/tithes/tithe-register";
import { DuplicateProfileError } from "@/lib/finance/profiles";
import { dateTimeLabel, parseDate, shortReference } from "@/lib/finance/formatters";
import {
  monthLabel,
  sameDateAndAmount,
  summarizeMonthTithes,
} from "@/lib/finance/tithe-integrity";
import type { TitheAttribution, TitheProfile } from "@/lib/finance/types";

const m = vi.hoisted(() => ({
  directory: [] as unknown[],
  monthTithes: [] as unknown[],
  monthCalls: [] as [string, string][],
  methods: {} as Record<string, string>,
  exact: [] as unknown[],
  saveProfile: vi.fn(),
  saveTransaction: vi.fn(),
  findExact: vi.fn(),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "u-test", email: "test@example.test" } }),
}));
vi.mock("@/lib/auth/access-provider", () => ({
  useAccess: () => ({ role: "finance", active: true }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/finanzas/diezmos",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: {}, storage: {} }) }));
vi.mock("@/lib/settings/finance-settings-client", async () => {
  const { FALLBACK_FINANCE_SETTINGS } = await import("@/lib/settings/finance-settings");
  return { useFinanceSettings: () => ({ data: FALLBACK_FINANCE_SETTINGS, exists: false, loading: false, error: "" }) };
});
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/firestore")>()),
  collection: () => ({}),
  doc: (_db: unknown, ...path: string[]) => ({ id: path[path.length - 1] || "auto-id", path: path.join("/") }),
  getDoc: async () => ({ data: () => ({ displayName: "Juan Pérez" }) }),
}));
vi.mock("@/lib/finance/profiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/profiles")>()),
  saveProfile: m.saveProfile,
}));
vi.mock("@/lib/finance/transactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/transactions")>()),
  saveTransaction: m.saveTransaction,
  newTransactionId: () => "tx-stable-id",
}));
vi.mock("@/lib/finance/tithe-integrity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/tithe-integrity")>()),
  findExactTitheMatches: m.findExact,
}));
vi.mock("@/lib/finance/tithe-hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/tithe-hooks")>()),
  useProfileDirectory: () => ({ data: m.directory, loading: false, error: "", truncated: false }),
  useProfiles: () => ({ data: [], loading: false, error: "", synced: true }),
  useMonthTithes: (profileId: string, period: string) => {
    m.monthCalls.push([profileId, period]);
    return { data: profileId ? m.monthTithes : [], loading: false, error: "", synced: true };
  },
  useTransactionMethods: (ids: string[]) => (ids.length ? m.methods : {}),
}));

HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
  this.open = false;
};

const ts = (ms: number) => Timestamp.fromMillis(ms);
function profile(id: string, displayName: string, active = true, extra: Partial<TitheProfile> = {}): TitheProfile {
  return {
    id,
    displayName,
    searchName: displayName.toLowerCase(),
    type: "person",
    phone: "",
    email: "",
    members: "",
    active,
    pastoralContactAuthorized: false,
    createdAt: ts(1000),
    createdBy: "u",
    updatedAt: ts(2000),
    updatedBy: "u",
    ...extra,
  };
}
function attribution(id: string, date: string, amount: number, createdMs = 1000): TitheAttribution {
  return {
    id,
    transactionId: id,
    profileId: "p1",
    amount,
    date: parseDate(date),
    period: date.slice(0, 7),
    status: "active",
    note: "",
    createdBy: "u",
    createdAt: ts(createdMs),
    updatedBy: "u",
    updatedAt: ts(createdMs),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  m.directory = [];
  m.monthTithes = [];
  m.monthCalls = [];
  m.methods = {};
  m.saveProfile.mockReset().mockResolvedValue({ id: "new" });
  m.saveTransaction.mockReset().mockResolvedValue("tx-stable-id");
  m.findExact.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
});

async function typeName(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre" }), { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}
const saveProfileButton = () => screen.getByRole("button", { name: "Guardar ficha" });

describe("ficha: nombre igual o similar", () => {
  it("nombre equivalente (misma clave) bloquea el alta y ofrece usar la ficha existente", async () => {
    const existing = profile("p1", "Juan Pérez");
    m.directory = [existing];
    const onUse = vi.fn();
    render(<ProfileForm onClose={vi.fn()} onSaved={vi.fn()} onUseExisting={onUse} />);
    await typeName("  JUAN  PÉREZ. ");
    const notice = screen.getByText("Ya existe una ficha con este nombre").closest("[role=status]") as HTMLElement;
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(within(notice).getByText(/segundo apellido/)).toBeInTheDocument();
    fireEvent.click(saveProfileButton());
    await act(async () => {});
    expect(m.saveProfile).not.toHaveBeenCalled();
    fireEvent.click(within(notice).getByRole("button", { name: "Usar ficha existente" }));
    expect(onUse).toHaveBeenCalledWith(existing);
    const review = within(notice).getByRole("button", { name: /Revisar coincidencias/ });
    expect(review).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(review);
    expect(review).toHaveAttribute("aria-expanded", "true");
    expect(within(notice).getByText(/Mismo nombre/)).toBeInTheDocument();
  });

  it("el bloqueo usa el nombre actual aunque el debounce no haya corrido", async () => {
    m.directory = [profile("p1", "Juan Pérez")];
    render(<ProfileForm onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre" }), { target: { value: "juan perez" } });
    fireEvent.click(saveProfileButton());
    await act(async () => {});
    expect(m.saveProfile).not.toHaveBeenCalled();
    expect(screen.getByText("Ya existe una ficha con este nombre")).toBeInTheDocument();
  });

  it("homónimo distinguido y personas distintas con nombre parecido no se bloquean", async () => {
    m.directory = [profile("p1", "Juan Pérez")];
    const onSaved = vi.fn();
    render(<ProfileForm onClose={vi.fn()} onSaved={onSaved} />);
    await typeName("Juana Pérez");
    expect(screen.getByText("Ya encontramos una persona con un nombre similar")).toBeInTheDocument();
    expect(screen.queryByText("Ya existe una ficha con este nombre")).toBeNull();
    fireEvent.click(saveProfileButton());
    await act(async () => {});
    expect(m.saveProfile).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalled();
  });

  it("coincidencia archivada ofrece «Revisar y reactivar», no «Usar ficha existente»", async () => {
    const archived = profile("p9", "Ana Soto", false);
    m.directory = [archived];
    const onReactivate = vi.fn();
    render(<ProfileForm onClose={vi.fn()} onSaved={vi.fn()} onUseExisting={vi.fn()} onReactivateExisting={onReactivate} />);
    await typeName("ana soto");
    expect(screen.queryByRole("button", { name: "Usar ficha existente" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revisar y reactivar" }));
    expect(onReactivate).toHaveBeenCalledWith(archived);
  });

  it("reactivar: abre la ficha archivada con «Ficha activa» marcada", () => {
    render(<ProfileForm existing={profile("p9", "Ana Soto", false)} reactivate onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Ficha activa" })).toBeChecked();
    expect(screen.getByText(/guarda para reactivar/)).toBeInTheDocument();
  });

  it("archivar explica que no se elimina", () => {
    render(<ProfileForm existing={profile("p1", "Juan Pérez")} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Ficha activa" }));
    expect(screen.getByText(/conserva su historial, deja de aparecer al registrar diezmos. No se elimina./)).toBeInTheDocument();
  });

  it("editar una ficha antigua duplicada nunca se bloquea (aviso informativo)", async () => {
    const legacy = profile("p2", "Juan Pérez");
    m.directory = [profile("p1", "Juan Pérez"), legacy];
    m.saveProfile.mockResolvedValue({ id: "p2", possibleDuplicateOf: "p1" });
    const onSaved = vi.fn();
    render(<ProfileForm existing={legacy} onClose={vi.fn()} onSaved={onSaved} />);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Posible ficha duplicada")).toBeInTheDocument();
    fireEvent.click(saveProfileButton());
    await act(async () => {});
    expect(m.saveProfile).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0][1]).toMatch(/Posible ficha duplicada/);
  });

  it("renombrar a un nombre ya usado se bloquea", async () => {
    m.directory = [profile("p1", "Juan Pérez"), profile("p2", "Pedro Rojas")];
    render(<ProfileForm existing={profile("p2", "Pedro Rojas")} onClose={vi.fn()} onSaved={vi.fn()} />);
    await typeName("Juan Perez");
    fireEvent.click(saveProfileButton());
    await act(async () => {});
    expect(m.saveProfile).not.toHaveBeenCalled();
  });

  it("colisión detectada por el servidor (DuplicateProfileError) muestra el bloqueo", async () => {
    m.saveProfile.mockRejectedValue(new DuplicateProfileError("p77", "maria_soto"));
    render(<ProfileForm onClose={vi.fn()} onSaved={vi.fn()} />);
    await typeName("María Soto");
    fireEvent.click(saveProfileButton());
    await act(async () => {});
    expect(screen.getByText("Ya existe una ficha con este nombre")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("registrar diezmo: búsqueda normalizada", () => {
  it("«perez» encuentra «Pérez»; «perez juan» encuentra «Juan Pérez»; solo activas", () => {
    m.directory = [profile("p1", "Juan Pérez"), profile("p2", "Ana Pérez", false), profile("p3", "Pedro Rojas")];
    render(<TitheRegister onClose={vi.fn()} onSaved={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: "Buscar persona o familia" });
    fireEvent.change(search, { target: { value: "perez" } });
    expect(screen.getByRole("button", { name: /Juan Pérez/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ana Pérez/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pedro Rojas/ })).toBeNull();
    fireEvent.change(search, { target: { value: "PEREZ juan" } });
    expect(screen.getByRole("button", { name: /Juan Pérez/ })).toBeInTheDocument();
  });
});

describe("diezmo repetido en el mes", () => {
  const p1 = profile("p1", "Juan Pérez");

  it("helpers: mes, resumen y misma fecha/monto", () => {
    const items = [attribution("a", "2026-10-02", 145000), attribution("b", "2026-10-01", 50000)];
    expect(monthLabel("2026-10")).toBe("octubre de 2026");
    expect(summarizeMonthTithes(items)).toMatchObject({ count: 2, total: 195000, latest: { id: "a" } });
    expect(sameDateAndAmount(items, "2026-10-02", 145000).map((a) => a.id)).toEqual(["a"]);
    expect(sameDateAndAmount(items, "2026-10-02", 1).length).toBe(0);
  });

  it("muestra cantidad, total y último; nunca bloquea; se consulta por mes", async () => {
    vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
    m.monthTithes = [attribution("aaaaaa111111", "2026-10-02", 145000), attribution("bbbbbb222222", "2026-10-01", 50000)];
    m.methods = { aaaaaa111111: "transfer", bbbbbb222222: "cash" };
    render(<TransactionForm profile={p1} onClose={vi.fn()} onSaved={vi.fn()} />);
    const warning = screen.getByText(/ya registra/).closest("[role=status]") as HTMLElement;
    expect(warning).toHaveAttribute("aria-live", "polite");
    expect(warning.textContent).toMatch(/2 diezmos durante octubre de 2026/);
    expect(warning.textContent).toMatch(/total \$195\.000/);
    expect(warning.textContent).toMatch(/Último: 02-10-2026 · \$145\.000/);
    const review = within(warning).getByRole("button", { name: "Revisar aportes" });
    fireEvent.click(review);
    expect(review).toHaveAttribute("aria-expanded", "true");
    expect(within(warning).getByText("Transferencia")).toBeInTheDocument();
    expect(within(warning).getByText("Efectivo")).toBeInTheDocument();
    fireEvent.click(within(warning).getByRole("button", { name: "Registrar otro diezmo" }));
    expect(within(warning).getByText(/Puedes registrar otro diezmo/)).toBeInTheDocument();

    const callsBefore = m.monthCalls.filter(([id]) => id === "p1").map(([, period]) => period);
    expect(new Set(callsBefore)).toEqual(new Set(["2026-10"]));
    // Cambiar el día dentro del mes no cambia el período consultado; cambiar de mes sí.
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-10-05" } });
    expect(new Set(m.monthCalls.map(([, period]) => period))).toEqual(new Set(["2026-10"]));
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-09-30" } });
    expect(m.monthCalls.at(-1)).toEqual(["p1", "2026-09"]);

    fireEvent.change(screen.getByRole("textbox", { name: /Monto CLP/ }), { target: { value: "145000" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await act(async () => {});
    expect(m.saveTransaction).toHaveBeenCalledTimes(1);
  });

  it("sin diezmos en el mes no hay aviso", () => {
    render(<TransactionForm profile={p1} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByText(/ya registra/)).toBeNull();
  });

  it("coincidencia exacta: paso de confirmación (alertdialog) antes de guardar", async () => {
    const match = attribution("cccccc333333", "2026-10-02", 145000, Date.UTC(2026, 9, 2, 17, 58));
    m.findExact.mockResolvedValue([match]);
    render(<TransactionForm profile={p1} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Monto CLP/ }), { target: { value: "145000" } });
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-10-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await act(async () => {});
    expect(m.findExact).toHaveBeenCalledWith({}, "p1", { date: "2026-10-02", amount: 145000, paymentMethod: "transfer" });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName(/Encontramos un aporte con los mismos datos/);
    expect(dialog).toHaveAccessibleDescription(/Comprueba que no estés registrándolo dos veces/);
    expect(within(dialog).getByText(/Registrado el 02-10-2026 14:58/)).toBeInTheDocument();
    expect(within(dialog).getByText("…333333")).toBeInTheDocument();
    const back = within(dialog).getByRole("button", { name: "Volver y revisar" });
    expect(back).toHaveFocus();
    expect(m.saveTransaction).not.toHaveBeenCalled();

    // Volver: no guarda y regresa al formulario.
    fireEvent.click(back);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(m.saveTransaction).not.toHaveBeenCalled();

    // Escape en el paso de confirmación también vuelve (no cierra el modal).
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await act(async () => {});
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // Confirmar: guarda una vez, sin volver a preguntar.
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await act(async () => {});
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sí, es otro aporte" }));
    await act(async () => {});
    expect(m.saveTransaction).toHaveBeenCalledTimes(1);
    expect(m.saveTransaction.mock.calls[0][2]).toBe("tx-stable-id");
    expect(m.findExact).toHaveBeenCalledTimes(3);
  });

  it("doble clic / doble envío: un solo guardado con el id estable", async () => {
    let release: (v: string) => void = () => {};
    m.saveTransaction.mockImplementation(() => new Promise<string>((r) => (release = r)));
    render(<TransactionForm profile={p1} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Monto CLP/ }), { target: { value: "5000" } });
    const form = screen.getByRole("button", { name: "Guardar" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    await act(async () => {});
    expect(m.saveTransaction).toHaveBeenCalledTimes(1);
    await act(async () => release("tx-stable-id"));
  });
});

describe("formatters de auditoría", () => {
  it("dateTimeLabel: fecha y hora de Chile (America/Santiago)", () => {
    expect(dateTimeLabel(Timestamp.fromDate(new Date("2026-10-08T17:58:00Z")))).toBe("08-10-2026 14:58");
    expect(dateTimeLabel(Timestamp.fromDate(new Date("2026-07-08T17:58:00Z")))).toBe("08-07-2026 13:58");
    expect(dateTimeLabel(undefined)).toBe("Sin registro");
  });
  it("shortReference: últimos 6 caracteres", () => {
    expect(shortReference("AbCdEfGh5UFRhF")).toBe("…5UFRhF");
    expect(shortReference("abc")).toBe("abc");
  });
});
