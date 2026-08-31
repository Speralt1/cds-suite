import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import { AuthProvider, useAuth } from "@/lib/auth/auth-provider";
import { AuthGuard } from "@/components/layout/auth-guard";
import { AppShell } from "@/components/layout/app-shell";
import Home from "@/app/page";
import LoginPage from "@/app/login/page";
import { getAuthErrorMessage } from "@/lib/auth/errors";

const firebase = vi.hoisted(() => ({
  onChange: null as ((user: User | null) => void) | null,
  onError: null as ((error: unknown) => void) | null,
  auth: {},
  configured: true,
  setPersistence: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  browserLocalPersistence: "local",
  setPersistence: firebase.setPersistence,
  signInWithEmailAndPassword: firebase.signIn,
  signOut: firebase.signOut,
  onAuthStateChanged: (
    _: unknown,
    next: typeof firebase.onChange,
    error: typeof firebase.onError,
  ) => {
    firebase.onChange = next;
    firebase.onError = error;
    return firebase.unsubscribe;
  },
}));
vi.mock("@/lib/firebase", () => ({
  get isFirebaseConfigured() {
    return firebase.configured;
  },
  getFirebaseServices: () => ({ auth: firebase.auth }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: firebase.replace }),
  usePathname: () => "/dashboard",
}));

const account = {
  uid: "local-test-user",
  email: "prueba@example.test",
} as User;

async function resolveSession(user: User | null) {
  await waitFor(() => expect(firebase.onChange).not.toBeNull());
  await act(async () => firebase.onChange?.(user));
}

beforeEach(() => {
  vi.clearAllMocks();
  firebase.onChange = null;
  firebase.onError = null;
  firebase.configured = true;
  firebase.setPersistence.mockResolvedValue(undefined);
  firebase.signIn.mockResolvedValue({ user: account });
  firebase.signOut.mockResolvedValue(undefined);
});

describe("session boundaries", () => {
  it("never renders private content while loading or signed out", async () => {
    render(
      <AuthProvider>
        <AuthGuard>
          <p>Contenido privado</p>
        </AuthGuard>
      </AuthProvider>,
    );
    expect(screen.queryByText("Contenido privado")).not.toBeInTheDocument();
    await resolveSession(null);
    expect(firebase.replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByText("Contenido privado")).not.toBeInTheDocument();
  });

  it("restores a Firebase session before showing private content and removes it on sign-out", async () => {
    render(
      <AuthProvider>
        <AuthGuard>
          <p>Contenido privado</p>
        </AuthGuard>
      </AuthProvider>,
    );
    await resolveSession(account);
    expect(firebase.setPersistence).toHaveBeenCalledWith(
      firebase.auth,
      "local",
    );
    expect(screen.getByText("Contenido privado")).toBeVisible();
    await act(async () => firebase.onChange?.(null));
    expect(screen.queryByText("Contenido privado")).not.toBeInTheDocument();
    expect(firebase.replace).toHaveBeenCalledWith("/login");
  });

  it.each([
    [null, "/login"],
    [account, "/dashboard"],
  ])(
    "routes the root according to the resolved session",
    async (user, route) => {
      render(
        <AuthProvider>
          <Home />
        </AuthProvider>,
      );
      expect(firebase.replace).not.toHaveBeenCalled();
      await resolveSession(user);
      expect(firebase.replace).toHaveBeenCalledWith(route);
    },
  );

  it("fails closed if persistence cannot initialize", async () => {
    firebase.setPersistence.mockRejectedValueOnce({
      code: "auth/web-storage-unsupported",
    });
    render(
      <AuthProvider>
        <AuthGuard>
          <p>Contenido privado</p>
        </AuthGuard>
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(firebase.replace).toHaveBeenCalledWith("/login"),
    );
    expect(screen.queryByText("Contenido privado")).not.toBeInTheDocument();
  });

  it("unsubscribes from Firebase when the provider unmounts", async () => {
    const view = render(
      <AuthProvider>
        <span />
      </AuthProvider>,
    );
    await resolveSession(null);
    view.unmount();
    expect(firebase.unsubscribe).toHaveBeenCalledOnce();
  });

  it("clears displayed private content when Firebase reports an observer error", async () => {
    render(
      <AuthProvider>
        <AuthGuard>
          <p>Contenido privado</p>
        </AuthGuard>
      </AuthProvider>,
    );
    await resolveSession(account);
    await act(async () =>
      firebase.onError?.({ code: "auth/network-request-failed" }),
    );
    expect(screen.queryByText("Contenido privado")).not.toBeInTheDocument();
    expect(firebase.replace).toHaveBeenCalledWith("/login");
  });
});

describe("login", () => {
  it("validates empty fields without calling Firebase", async () => {
    const interaction = userEvent.setup();
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    await resolveSession(null);
    await interaction.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Completa tu correo y contraseña",
    );
    expect(firebase.signIn).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("link", { name: /registro|registrar/i }),
    ).not.toBeInTheDocument();
  });

  it("uses Firebase email/password login, preserves password whitespace, and waits for the observer to navigate", async () => {
    const interaction = userEvent.setup();
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    await resolveSession(null);
    await interaction.type(
      screen.getByLabelText("Correo electrónico"),
      "prueba@example.test",
    );
    await interaction.type(screen.getByLabelText("Contraseña"), " pass-test ");
    await interaction.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(firebase.signIn).toHaveBeenCalledWith(
      firebase.auth,
      "prueba@example.test",
      " pass-test ",
    );
    expect(firebase.replace).not.toHaveBeenCalled();
    await resolveSession(account);
    expect(firebase.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("reports connection errors and allows retry", async () => {
    firebase.signIn.mockRejectedValueOnce({
      code: "auth/network-request-failed",
    });
    const interaction = userEvent.setup();
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    await resolveSession(null);
    await interaction.type(
      screen.getByLabelText("Correo electrónico"),
      "prueba@example.test",
    );
    await interaction.type(
      screen.getByLabelText("Contraseña"),
      "test-password",
    );
    await interaction.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Revisa tu conexión");
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeEnabled();
  });

  it("explains missing configuration and disables login", async () => {
    firebase.configured = false;
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "aún no está configurada",
    );
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeDisabled();
  });
});

describe("sign out", () => {
  it("calls Firebase signOut and hides the authenticated shell", async () => {
    const interaction = userEvent.setup();
    render(
      <AuthProvider>
        <AuthGuard>
          <AppShell>
            <p>Contenido privado</p>
          </AppShell>
        </AuthGuard>
      </AuthProvider>,
    );
    await resolveSession(account);
    await interaction.click(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    );
    expect(firebase.signOut).toHaveBeenCalledWith(firebase.auth);
    expect(screen.queryByText("Contenido privado")).not.toBeInTheDocument();
    expect(firebase.replace).toHaveBeenCalledWith("/login");
  });

  it("keeps the session and displays a useful error when signOut fails", async () => {
    firebase.signOut.mockRejectedValueOnce({
      code: "auth/network-request-failed",
    });
    const interaction = userEvent.setup();
    render(
      <AuthProvider>
        <AuthGuard>
          <AppShell>
            <p>Contenido privado</p>
          </AppShell>
        </AuthGuard>
      </AuthProvider>,
    );
    await resolveSession(account);
    await interaction.click(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    );
    expect(screen.getByText("Contenido privado")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Revisa tu conexión");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });
});

it.each([
  ["auth/wrong-password", "contraseña es incorrecta"],
  ["auth/user-not-found", "No encontramos un usuario"],
  ["auth/invalid-credential", "correo o la contraseña"],
  ["auth/network-request-failed", "conexión a internet"],
])("maps %s to a useful message", (code, message) => {
  expect(getAuthErrorMessage({ code })).toContain(message);
});

function HookOutsideProvider() {
  useAuth();
  return null;
}
it("rejects useAuth outside its provider", () => {
  expect(() => render(<HookOutsideProvider />)).toThrow(
    "useAuth must be used inside AuthProvider",
  );
});
