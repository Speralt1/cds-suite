import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AccessProvider } from "@/lib/auth/access-provider";
const state = vi.hoisted(() => ({
  next: null as null | ((snapshot: unknown) => void),
  error: null as null | (() => void),
  logout: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({
    user: { uid: "test", email: "test@cds.test" },
    logout: state.logout,
  }),
}));
vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: {} }) }));
vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  onSnapshot: (
    _: unknown,
    __: unknown,
    next: typeof state.next,
    error: typeof state.error,
  ) => {
    state.next = next;
    state.error = error;
    return state.unsubscribe;
  },
}));
beforeEach(() => {
  state.next = null;
  state.error = null;
  vi.clearAllMocks();
});
function emit(profile: unknown, fromCache = false) {
  act(() =>
    state.next?.({
      exists: () => profile !== null,
      data: () => profile,
      metadata: { fromCache },
    }),
  );
}
it("no muestra datos sin documento, con usuario inactivo ni desde caché", () => {
  render(
    <AccessProvider>
      <p>Finanzas privadas</p>
    </AccessProvider>,
  );
  expect(screen.queryByText("Finanzas privadas")).toBeNull();
  emit(null);
  expect(
    screen.getByText(
      "Tu cuenta aún no tiene acceso autorizado a CDS Administración.",
    ),
  ).toBeVisible();
  emit({ role: "admin", active: false });
  expect(screen.queryByText("Finanzas privadas")).toBeNull();
  emit({ role: "admin", active: true }, true);
  expect(screen.queryByText("Finanzas privadas")).toBeNull();
});
it("concede acceso confirmado y desmonta datos inmediatamente al revocarlo", () => {
  render(
    <AccessProvider>
      <p>Finanzas privadas</p>
    </AccessProvider>,
  );
  emit({ role: "finance", active: true });
  expect(screen.getByText("Finanzas privadas")).toBeVisible();
  emit({ role: "finance", active: false });
  expect(screen.queryByText("Finanzas privadas")).toBeNull();
});
it("falla cerrado ante errores de autorización", () => {
  render(
    <AccessProvider>
      <p>Finanzas privadas</p>
    </AccessProvider>,
  );
  act(() => state.error?.());
  expect(screen.queryByText("Finanzas privadas")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "No pudimos verificar tu acceso",
  );
});
