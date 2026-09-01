"use client";
import { useEffect, useMemo, useState } from "react";
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
export function useCollection<T>(
  name: string,
  constraints: QueryConstraint[],
  enabled = true,
): DataState<T[]> {
  const online = useOnlineStatus();
  const [state, setState] = useState<{
    key: QueryConstraint[];
    data: T[];
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(getFirebaseServices().db, name), ...constraints),
      { includeMetadataChanges: true },
      (s) => {
        if (s.metadata.hasPendingWrites) return;
        setState({
          key: constraints,
          data: s.docs.map((d) => ({ id: d.id, ...d.data() }) as T),
          error: "",
        });
      },
      (e) => setState({ key: constraints, data: [], error: errorMessage(e) }),
    );
  }, [name, constraints, enabled]);
  return !enabled
    ? { data: [], loading: false, error: "" }
    : state?.key === constraints
      ? {
          ...state,
          loading: false,
          error:
            state.error ||
            (!online
              ? "Sin conexión: la información puede estar desactualizada."
              : ""),
        }
      : { data: [], loading: true, error: "" };
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
  return useCollection<MonthlySummary>("financeMonthlySummaries", constraints);
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
