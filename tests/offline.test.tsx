import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useMemo } from "react";
import { useCollection } from "@/lib/finance/hooks";

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
