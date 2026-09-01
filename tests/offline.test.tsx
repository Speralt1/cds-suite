import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useMemo } from "react";
import { FinanceDataCacheProvider, useCollection } from "@/lib/finance/hooks";

const state = vi.hoisted(() => ({
  next: null as null | ((snapshot: unknown) => void),
  error: null as null | ((error: unknown) => void),
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
  onSnapshot: (
    _: unknown,
    __: unknown,
    next: typeof state.next,
    error: typeof state.error,
  ) => {
    state.next = next;
    state.error = error;
    return vi.fn();
  },
}));

function Probe() {
  const constraints = useMemo(() => [], []);
  const result = useCollection<{ id: string }>("items", constraints);
  return (
    <div>
      <span>{result.loading ? "cargando" : result.data[0]?.id}</span>
      {result.error && <p role="alert">{result.error}</p>}
    </div>
  );
}

function CachedProbe() {
  const constraints = useMemo(() => [], []);
  const result = useCollection<{ id: string }>(
    "cached-items",
    constraints,
    true,
    "navigation",
  );
  return <span>{result.loading ? "cargando" : result.data[0]?.id}</span>;
}

beforeEach(() => {
  state.next = null;
  state.error = null;
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

it("no confunde un snapshot inicial de caché con estar sin conexión", () => {
  render(<Probe />);
  act(() =>
    state.next?.({
      docs: [{ id: "cache", data: () => ({}) }],
      metadata: { fromCache: true, hasPendingWrites: false },
    }),
  );
  expect(screen.getByText("cache")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();

  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.getByRole("alert")).toHaveTextContent("Sin conexión");
});

it("mantiene el último snapshot útil al volver a montar un módulo", () => {
  function View({ visible }: { visible: boolean }) {
    return (
      <FinanceDataCacheProvider>
        {visible ? <CachedProbe /> : null}
      </FinanceDataCacheProvider>
    );
  }

  const view = render(<View visible />);
  act(() =>
    state.next?.({
      docs: [{ id: "conservado", data: () => ({}) }],
      metadata: { fromCache: false, hasPendingWrites: false },
    }),
  );
  expect(screen.getByText("conservado")).toBeVisible();

  view.rerender(<View visible={false} />);
  view.rerender(<View visible />);
  expect(screen.getByText("conservado")).toBeVisible();
  expect(screen.queryByText("cargando")).toBeNull();
});
