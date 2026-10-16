"use client";
import { useMemo, useEffect, useState } from "react";
import {
  collection,
  documentId,
  getCountFromServer,
  getDocs,
  getDocsFromServer,
  orderBy,
  query,
  startAfter,
  where,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseServices } from "../firebase";
import { useCollection } from "./hooks";
import { PAGE_SIZE, MAX_PERIOD_RECORDS } from "./constants";
import { errorMessage, parseDate, periodId } from "./formatters";
import { safeLimit } from "./query-limit";
import { normalizeName } from "../shared/names";
import { titheDonorReport, type TitheDonorReport } from "./tithe-donors";
import type { FinanceTransaction, TitheProfile, TitheAttribution } from "./types";
export function useProfiles(search: string, cursor = "", enabled = true) {
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
    enabled,
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

async function fetchLinkedDocuments<T>(name: string, ids: string[]): Promise<T[]> {
  const validDocumentId = (id: string) =>
    !!id && id !== "." && id !== ".." && !id.includes("/") &&
    new TextEncoder().encode(id).length <= 1500;
  const unique = [...new Set(ids.filter(validDocumentId))];
  const results: T[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const snapshot = await getDocsFromServer(
      query(
        collection(getFirebaseServices().db, name),
        where(documentId(), "in", unique.slice(i, i + 30)),
      ),
    );
    results.push(...snapshot.docs.map((d) => ({ ...d.data(), id: d.id }) as T));
  }
  return results;
}

/** Validate each attribution against its ledger movement and profile before counting. */
export function useValidatedMonthlyDonors(
  year: number,
  month: number,
  attributions: TitheAttribution[],
  ready: boolean,
) {
  const period = periodId(year, month);
  const [state, setState] = useState<{
    period: string;
    source: TitheAttribution[];
    report: TitheDonorReport;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    if (attributions.length >= MAX_PERIOD_RECORDS) {
      return;
    }
    const candidates = attributions.filter((a) => a.status === "active");
    Promise.all([
      fetchLinkedDocuments<FinanceTransaction>(
        "financeTransactions",
        candidates.map((a) => a.id),
      ),
      fetchLinkedDocuments<TitheProfile>(
        "titheProfiles",
        candidates.map((a) => a.profileId),
      ),
    ])
      .then(([transactions, profiles]) => {
        if (active)
          setState({
            period,
            source: attributions,
            report: titheDonorReport(period, attributions, transactions, profiles),
            error: "",
          });
      })
      .catch((e) => {
        if (active)
          setState({
            period,
            source: attributions,
            report: { donors: [], excluded: 0 },
            error: errorMessage(e),
          });
      });
    return () => {
      active = false;
    };
  }, [period, attributions, ready]);
  if (ready && attributions.length >= MAX_PERIOD_RECORDS)
    return {
      report: { donors: [], excluded: 0 },
      loading: false,
      error: "Hay demasiados aportes en este mes para mostrar un conteo completo.",
    };
  return ready && state?.period === period && state.source === attributions
    ? { report: state.report, loading: false, error: state.error }
    : { report: { donors: [], excluded: 0 }, loading: true, error: "" };
}

/** Total de fichas, activas y archivadas, independiente del mes seleccionado. */
export function useTotalProfileCount(refresh: number) {
  const [state, setState] = useState<{
    refresh: number;
    count: number;
    error: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    getCountFromServer(collection(getFirebaseServices().db, "titheProfiles"))
      .then((s) => {
        if (active) setState({ refresh, count: s.data().count, error: "" });
      })
      .catch((e) => {
        if (active)
          setState({ refresh, count: 0, error: errorMessage(e) });
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  return state?.refresh === refresh
    ? { count: state.count, error: state.error, loading: false }
    : { count: 0, error: "", loading: true };
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

// ── Integridad de diezmos (doc 27) ──────────────────────────────────────────

/** Máximo de fichas que se cargan para buscar coincidencias de nombre en el cliente. */
export const PROFILE_DIRECTORY_LIMIT = 500;
export interface ProfileDirectoryState {
  data: TitheProfile[];
  loading: boolean;
  error: string;
  /** Hay más de PROFILE_DIRECTORY_LIMIT fichas: la comparación es parcial. */
  truncated: boolean;
}
/**
 * Lista acotada de fichas (activas y archivadas) leída UNA vez al montar (orderBy searchName,
 * límite 500 + 1 para detectar el corte). Sobre ella se calculan en el cliente los nombres
 * similares y la búsqueda normalizada; nunca se consulta por tecla.
 */
export function useProfileDirectory(enabled = true, refresh = 0): ProfileDirectoryState {
  const [state, setState] = useState<
    (ProfileDirectoryState & { refresh: number }) | null
  >(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    getDocs(
      query(
        collection(getFirebaseServices().db, "titheProfiles"),
        orderBy("searchName"),
        safeLimit(PROFILE_DIRECTORY_LIMIT + 1),
      ),
    )
      .then((s) => {
        if (!active) return;
        const data = s.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as TitheProfile,
        );
        setState({
          refresh,
          data: data.slice(0, PROFILE_DIRECTORY_LIMIT),
          loading: false,
          error: "",
          truncated: data.length > PROFILE_DIRECTORY_LIMIT,
        });
      })
      .catch((e) => {
        if (active)
          setState({
            refresh,
            data: [],
            loading: false,
            error: errorMessage(e),
            truncated: false,
          });
      });
    return () => {
      active = false;
    };
  }, [enabled, refresh]);
  return enabled && state?.refresh === refresh
    ? state
    : { data: [], loading: enabled, error: "", truncated: false };
}

/** "2026-10" → ["2026-10-01", "2026-11-01"]; null si el período no es válido. */
export function monthRange(period: string): [string, string] | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000 || year > 2099) return null;
  return [
    `${periodId(year, month)}-01`,
    `${month === 12 ? periodId(year + 1, 1) : periodId(year, month + 1)}-01`,
  ];
}
/** Tope de diezmos del mes que se muestran en el aviso de diezmo repetido. */
export const MONTH_TITHES_LIMIT = 20;
function monthTitheConstraints(profileId: string, period: string) {
  const range = monthRange(period);
  if (!profileId || !range) return null;
  // Índice existente: titheAttributions (profileId ASC, status ASC, date DESC).
  return [
    where("profileId", "==", profileId),
    where("status", "==", "active"),
    where("date", ">=", parseDate(range[0])),
    where("date", "<", parseDate(range[1])),
    orderBy("date", "desc"),
    safeLimit(MONTH_TITHES_LIMIT),
  ];
}
/** Diezmos activos de la ficha en el mes `period` ("AAAA-MM"). Se re-suscribe solo si cambia el mes. */
export function useMonthTithes(profileId: string, period: string) {
  const constraints = useMemo(
    () => monthTitheConstraints(profileId, period),
    [profileId, period],
  );
  return useCollection<TitheAttribution>(
    "titheAttributions",
    constraints ?? [],
    !!constraints,
    `month-tithes:${profileId}:${period}`,
  );
}
/**
 * Diezmos activos de la ficha en UNA fecha (comprobación al guardar). Igualdad en profileId,
 * status y date: mismo índice (profileId, status, date DESC). No depende del tope del mes,
 * así que no se pierden duplicados en meses con muchos aportes.
 */
export const SAME_DAY_TITHES_LIMIT = 30;
export async function fetchSameDayTithes(
  db: Firestore,
  profileId: string,
  date: string,
) {
  if (!profileId) return [];
  const s = await getDocs(
    query(
      collection(db, "titheAttributions"),
      where("profileId", "==", profileId),
      where("status", "==", "active"),
      where("date", "==", parseDate(date)),
      safeLimit(SAME_DAY_TITHES_LIMIT),
    ),
  );
  return s.docs.map((d) => ({ id: d.id, ...d.data() }) as TitheAttribution);
}
/** Método de pago de hasta 30 movimientos por consulta documentId()-in. */
export async function fetchTransactionMethods(db: Firestore, ids: string[]) {
  const unique = [...new Set(ids)];
  const map: Record<string, string> = {};
  for (let i = 0; i < unique.length; i += 30) {
    const snapshot = await getDocs(
      query(
        collection(db, "financeTransactions"),
        where(documentId(), "in", unique.slice(i, i + 30)),
      ),
    );
    snapshot.docs.forEach((d) => {
      map[d.id] = (d.data() as { paymentMethod?: string }).paymentMethod || "";
    });
  }
  return map;
}
// Method comes from a batched read of financeTransactions, limited to the
// rows currently rendered (§C3): up to 30 ids per documentId()-"in" query.
export function useTransactionMethods(ids: string[]) {
  const key = [...new Set(ids)].sort().join(",");
  const [state, setState] = useState<{
    key: string;
    map: Record<string, string>;
  }>({ key: "", map: {} });
  useEffect(() => {
    if (!key) return;
    let active = true;
    fetchTransactionMethods(getFirebaseServices().db, key.split(","))
      .then((map) => {
        if (active) setState({ key, map });
      })
      .catch(() => {
        if (active) setState({ key, map: {} });
      });
    return () => {
      active = false;
    };
  }, [key]);
  return key ? (state.key === key ? state.map : {}) : {};
}

/**
 * Búsqueda normalizada en el cliente: cada palabra buscada debe aparecer dentro del nombre
 * normalizado ("perez" encuentra "Pérez", "perez juan" encuentra "Juan Pérez").
 */
export function matchesProfileSearch(displayName: string, search: string) {
  const words = normalizeName(search).split(" ").filter(Boolean);
  if (!words.length) return true;
  const name = normalizeName(displayName);
  return words.every((w) => name.includes(w));
}
/** Conteo en el servidor (agregación, sin leer documentos) de fichas con `active == value`. */
export function useProfileCount(active: boolean, refresh: number, enabled = true) {
  const [state, setState] = useState<{
    key: string;
    count: number;
    error: string;
  } | null>(null);
  const key = `${active}:${refresh}`;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getCountFromServer(
      query(
        collection(getFirebaseServices().db, "titheProfiles"),
        where("active", "==", active),
      ),
    )
      .then((s) => {
        if (alive) setState({ key, count: s.data().count, error: "" });
      })
      .catch((e) => {
        if (alive) setState({ key, count: 0, error: errorMessage(e) });
      });
    return () => {
      alive = false;
    };
  }, [active, key, enabled]);
  return enabled && state?.key === key
    ? { count: state.count, error: state.error, loading: false }
    : { count: 0, error: "", loading: enabled };
}
/** Conteo de diezmos activos de una ficha (agregación; usa el índice profileId+status+date). */
export function useActiveTitheCount(profileId: string, refresh = 0) {
  const [state, setState] = useState<{ key: string; count: number | null } | null>(null);
  const key = `${profileId}:${refresh}`;
  useEffect(() => {
    let alive = true;
    getCountFromServer(
      query(
        collection(getFirebaseServices().db, "titheAttributions"),
        where("profileId", "==", profileId),
        where("status", "==", "active"),
      ),
    )
      .then((s) => {
        if (alive) setState({ key, count: s.data().count });
      })
      .catch(() => {
        if (alive) setState({ key, count: null });
      });
    return () => {
      alive = false;
    };
  }, [profileId, key]);
  return state?.key === key ? state.count : undefined;
}
