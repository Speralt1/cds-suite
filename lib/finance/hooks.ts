"use client";
import {
  createElement,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  collection,
  documentId,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint,
  type DocumentData,
} from "firebase/firestore";
import { getFirebaseServices } from "../firebase";
import { errorMessage, periodBounds, periodId, parseDate } from "./formatters";
import { MAX_PERIOD_RECORDS } from "./constants";
import { safeLimit } from "./query-limit";
import { useOnlineStatus } from "../browser/online";
import type {
  FinanceTransaction,
  MonthlySummary,
  PeriodSelection,
} from "./types";
export type DataState<T> = { data: T; loading: boolean; error: string };
// `synced`: the data comes from a server-confirmed snapshot of the listener
// that is active right now for these exact constraints. Cached or retained
// data keeps being shown (loading=false) but is never `synced`, so forms that
// write on top of it (Caja del día) can wait for the real current state.
export type CollectionState<T> = DataState<T[]> & { synced: boolean };
const FinanceDataCacheContext = createContext<Map<string, unknown[]> | null>(
  null,
);
export function FinanceDataCacheProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [cache] = useState(() => new Map<string, unknown[]>());
  return createElement(
    FinanceDataCacheContext.Provider,
    { value: cache },
    children,
  );
}
export function useCollection<T>(
  name: string,
  constraints: QueryConstraint[],
  enabled = true,
  cacheKey?: string,
): CollectionState<T> {
  const online = useOnlineStatus();
  const cache = useContext(FinanceDataCacheContext);
  const resolvedCacheKey = cacheKey ? `${name}:${cacheKey}` : "";
  const [state, setState] = useState<{
    key: QueryConstraint[];
    data: T[];
    error: string;
    synced: boolean;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = onSnapshot(
      query(collection(getFirebaseServices().db, name), ...constraints),
      { includeMetadataChanges: true },
      (s) => {
        if (s.metadata.hasPendingWrites) return;
        const data = s.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
        if (resolvedCacheKey) cache?.set(resolvedCacheKey, data);
        setState({
          key: constraints,
          data,
          error: "",
          synced: !s.metadata.fromCache,
        });
      },
      (e) =>
        setState({
          key: constraints,
          data: resolvedCacheKey
            ? ((cache?.get(resolvedCacheKey) as T[] | undefined) ?? [])
            : [],
          error: errorMessage(e),
          synced: false,
        }),
    );
    return () => {
      unsubscribe();
      // The retained snapshot stops being current once its listener is gone;
      // a later re-enable must not report it as synced.
      setState((current) =>
        current?.synced ? { ...current, synced: false } : current,
      );
    };
  }, [name, constraints, enabled, cache, resolvedCacheKey]);
  const cached = resolvedCacheKey
    ? (cache?.get(resolvedCacheKey) as T[] | undefined)
    : undefined;
  return !enabled
    ? { data: [], loading: false, error: "", synced: false }
    : state?.key === constraints
      ? {
          data: state.data,
          loading: false,
          error:
            state.error ||
            (!online
              ? "Sin conexión: la información puede estar desactualizada."
              : ""),
          synced: state.synced && online,
        }
      : cached
        ? {
            data: cached,
            loading: false,
            error: !online
              ? "Sin conexión: la información puede estar desactualizada."
              : "",
            synced: false,
          }
        : { data: [], loading: true, error: "", synced: false };
}
export function useDocument<T>(
  name: string,
  id: string,
  enabled = true,
): DataState<T | null> {
  const online = useOnlineStatus();
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      doc(getFirebaseServices().db, name, id),
      { includeMetadataChanges: true },
      (s) => {
        if (s.metadata.hasPendingWrites) return;
        setState({
          key: `${name}/${id}`,
          data: s.exists() ? ({ id: s.id, ...s.data() } as T) : null,
          error: "",
        });
      },
      (e) =>
        setState({ key: `${name}/${id}`, data: null, error: errorMessage(e) }),
    );
  }, [name, id, enabled]);
  return !enabled
    ? { data: null, loading: false, error: "" }
    : state?.key === `${name}/${id}`
      ? {
          ...state,
          loading: false,
          error:
            state.error ||
            (!online
              ? "Sin conexión: la información puede estar desactualizada."
              : ""),
        }
      : { data: null, loading: true, error: "" };
}
export function useSummaries(p: PeriodSelection) {
  const constraints = useMemo(
    () =>
      p.view === "month"
        ? [where(documentId(), "==", periodId(p.year, p.month))]
        : [
            where(documentId(), ">=", `${p.year}-01`),
            where(documentId(), "<=", `${p.year}-12`),
            orderBy(documentId()),
            safeLimit(12),
          ],
    [p.year, p.month, p.view],
  );
  return useCollection<MonthlySummary>(
    "financeMonthlySummaries",
    constraints,
    true,
    `summary:${p.view}:${p.year}:${p.view === "month" ? p.month : "all"}`,
  );
}
export function useTransactions(
  p: PeriodSelection,
  enabled = true,
  max = MAX_PERIOD_RECORDS,
) {
  const constraints = useMemo(() => {
    const b = periodBounds({ year: p.year, month: p.month, view: p.view });
    return p.view === "month"
      ? [
          where("period", "==", periodId(p.year, p.month)),
          orderBy("date", "desc"),
          safeLimit(max),
        ]
      : [
          where("date", ">=", parseDate(b.start)),
          where("date", "<", parseDate(b.end)),
          orderBy("date", "desc"),
          safeLimit(max),
        ];
  }, [p.year, p.month, p.view, max]);
  return useCollection<FinanceTransaction>(
    "financeTransactions",
    constraints,
    enabled,
    `transactions:${p.view}:${p.year}:${p.view === "month" ? p.month : "all"}:${max}`,
  );
}
export function usePeriod() {
  return useState<PeriodSelection>(() => ({
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    view: "month",
  }));
}
export type WithId = DocumentData & { id: string };
