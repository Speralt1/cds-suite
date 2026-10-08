// R0E — useCollection `synced`: only a server-confirmed snapshot of the
// listener active right now counts as current. Retained and cached data keep
// rendering as before (loading=false) for every other screen.
import { act, render, screen } from "@testing-library/react";
import { useMemo } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { FinanceDataCacheProvider, useCollection } from "@/lib/finance/hooks";

const state = vi.hoisted(() => ({
  listeners: [] as { next: (snapshot: unknown) => void; error: (e: unknown) => void; active: boolean }[],
}));

vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: {} }) }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  documentId: vi.fn(),
  limit: vi.fn((value) => ({ value })),
  orderBy: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: (_: unknown, __: unknown, next: (snapshot: unknown) => void, error: (e: unknown) => void) => {
    const listener = { next, error, active: true };
    state.listeners.push(listener);
    return () => {
      listener.active = false;
    };
  },
}));

function emit(id: string, fromCache: boolean, hasPendingWrites = false) {
  act(() => {
    for (const listener of state.listeners.filter((l) => l.active)) {
      listener.next({
        docs: [{ id, data: () => ({}) }],
        metadata: { fromCache, hasPendingWrites },
      });
    }
  });
}

function Probe({ enabled = true, cacheKey, query = "a" }: { enabled?: boolean; cacheKey?: string; query?: string }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const constraints = useMemo(() => [], [query]);
  const result = useCollection<{ id: string }>("items", constraints, enabled, cacheKey);
  return (
    <p>
      {result.loading ? "cargando" : result.data[0]?.id ?? "vacío"}
      {" · "}
      {result.synced ? "sincronizado" : "no sincronizado"}
      {result.error && ` · ${result.error}`}
    </p>
  );
}

beforeEach(() => {
  state.listeners.length = 0;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

it("un snapshot de caché se muestra pero no está sincronizado; el del servidor sí", () => {
  render(<Probe />);
  expect(screen.getByText("cargando · no sincronizado")).toBeVisible();
  emit("local", true);
  expect(screen.getByText("local · no sincronizado")).toBeVisible();
  emit("servidor", false);
  expect(screen.getByText("servidor · sincronizado")).toBeVisible();
});

it("las escrituras pendientes no cambian el estado", () => {
  render(<Probe />);
  emit("servidor", false);
  emit("pendiente", false, true);
  expect(screen.getByText("servidor · sincronizado")).toBeVisible();
});

it("al volver a habilitar se conserva lo retenido (sin parpadeo) pero deja de estar sincronizado hasta el próximo snapshot", () => {
  const view = render(<Probe />);
  emit("primero", false);
  view.rerender(<Probe enabled={false} />);
  expect(screen.getByText("vacío · no sincronizado")).toBeVisible();
  view.rerender(<Probe />);
  expect(screen.getByText("primero · no sincronizado")).toBeVisible();
  emit("segundo", false);
  expect(screen.getByText("segundo · sincronizado")).toBeVisible();
});

it("los datos de la caché compartida se muestran al remontar pero no están sincronizados", () => {
  function View({ visible }: { visible: boolean }) {
    return <FinanceDataCacheProvider>{visible ? <Probe cacheKey="k" /> : null}</FinanceDataCacheProvider>;
  }
  const view = render(<View visible />);
  emit("conservado", false);
  view.rerender(<View visible={false} />);
  view.rerender(<View visible />);
  expect(screen.getByText("conservado · no sincronizado")).toBeVisible();
});

it("sin conexión nunca está sincronizado", () => {
  render(<Probe />);
  emit("servidor", false);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.getByText(/^servidor · no sincronizado · Sin conexión/)).toBeVisible();
});

it("un error de la consulta nunca está sincronizado", () => {
  render(<Probe />);
  emit("servidor", false);
  act(() => state.listeners.at(-1)!.error(new Error("Sin permiso")));
  expect(screen.getByText(/no sincronizado · Sin permiso/)).toBeVisible();
});

it("al cambiar las restricciones no hereda la sincronización de la consulta anterior", () => {
  const view = render(<Probe />);
  emit("a", false);
  view.rerender(<Probe query="b" />);
  expect(screen.getByText("cargando · no sincronizado")).toBeVisible();
  emit("b", false);
  expect(screen.getByText("b · sincronizado")).toBeVisible();
});
