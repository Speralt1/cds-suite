"use client";
import { useMemo, useEffect, useState } from "react";
import {
  collection,
  documentId,
  getCountFromServer,
  orderBy,
  query,
  startAfter,
  where,
  Timestamp,
} from "firebase/firestore";
import { getFirebaseServices } from "../firebase";
import { useCollection } from "./hooks";
import { PAGE_SIZE, MAX_PERIOD_RECORDS } from "./constants";
import { errorMessage, periodId } from "./formatters";
import { safeLimit } from "./query-limit";
import type { TitheProfile, TitheAttribution } from "./types";
export function useProfiles(search: string, cursor = "") {
  const constraints = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [
      orderBy("searchName"),
      orderBy(documentId()),
      ...(term
        ? [
            where("searchName", ">=", term),
            where("searchName", "<=", term + "\uf8ff"),
          ]
        : []),
      ...(cursor
        ? [startAfter(...(JSON.parse(cursor) as [string, string]))]
        : []),
      safeLimit(PAGE_SIZE + 1),
    ];
  }, [search, cursor]);
  return useCollection<TitheProfile>(
    "titheProfiles",
    constraints,
    true,
    `profiles:${search.trim().toLowerCase()}:${cursor}`,
  );
}
export function useLatestAttribution(profileId: string) {
  const constraints = useMemo(
    () => [
      where("profileId", "==", profileId),
      where("status", "==", "active"),
      orderBy("date", "desc"),
      safeLimit(1),
    ],
    [profileId],
  );
  return useCollection<TitheAttribution>(
    "titheAttributions",
    constraints,
    true,
    `latest:${profileId}`,
  );
}
export function useMonthlyAttributions(year: number, month: number) {
  const constraints = useMemo(
    () => [
      where("period", "==", periodId(year, month)),
      orderBy("date", "desc"),
      safeLimit(MAX_PERIOD_RECORDS),
    ],
    [year, month],
  );
  return useCollection<TitheAttribution>(
    "titheAttributions",
    constraints,
    true,
    `monthly:${periodId(year, month)}`,
  );
}
export function useNewProfileCount(year: number, refresh: number) {
  const [state, setState] = useState<{
    year: number;
    refresh: number;
    count: number;
    error: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    getCountFromServer(
      query(
        collection(getFirebaseServices().db, "titheProfiles"),
        where(
          "createdAt",
          ">=",
          Timestamp.fromDate(new Date(Date.UTC(year, 0, 1))),
        ),
        where(
          "createdAt",
          "<",
          Timestamp.fromDate(new Date(Date.UTC(year + 1, 0, 1))),
        ),
      ),
    )
      .then((s) => {
        if (active)
          setState({ year, refresh, count: s.data().count, error: "" });
      })
      .catch((e) => {
        if (active)
          setState({ year, refresh, count: 0, error: errorMessage(e) });
      });
    return () => {
      active = false;
    };
  }, [year, refresh]);
  return state?.year === year && state.refresh === refresh
    ? { ...state, loading: false }
    : { count: 0, error: "", loading: true };
}
