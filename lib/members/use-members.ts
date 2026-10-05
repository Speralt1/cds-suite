"use client";

// Estado compartido de Consolidación V1 para las pantallas de /integrantes:
// personas en vivo (una sola suscripción para todo el módulo), responsables
// válidos (`membersOwnerOptions`, se cargan una vez con reintento) y los
// derivados (alertas, vistas por persona). Estados: cargando, error de red,
// sin permiso y sin conexión.

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAccessModel } from "@/lib/access/model";
import { useOnlineStatus } from "@/lib/browser/online";
import { useSantiagoNow } from "@/lib/calendar/use-now";
import { fetchOwnerOptions } from "./api";
import { subscribePeople, type ReadErrorKind } from "./client";
import { buildPersonView, computeAlerts, type PersonView } from "./consolidation";
import type { Alert, LocalDateTime, OwnerOption, Person, Ymd } from "./types";

export interface MembersState {
  persons: Person[];
  /** Primera carga de personas en curso. */
  loading: boolean;
  /** Error de lectura de personas (null si no hay). */
  error: ReadErrorKind | null;
  retry: () => void;
  /** Responsables válidos (null mientras cargan o si fallaron). */
  owners: OwnerOption[] | null;
  ownersLoading: boolean;
  ownersError: boolean;
  retryOwners: () => void;
  ownerName: (uid: string | null | undefined) => string | null;
  alerts: Alert[];
  views: ReadonlyMap<string, PersonView>;
  today: Ymd;
  now: LocalDateTime;
  online: boolean;
  canManage: boolean;
  canReadCalendar: boolean;
}

const MembersContext = createContext<MembersState | null>(null);

export function MembersProvider({ children }: { children: React.ReactNode }) {
  const access = useAccessModel();
  const canRead = access.can("members.consolidation.read");
  const canManage = access.can("members.consolidation.manage");
  const canReadCalendar = access.can("calendar.read");
  const { today, now } = useSantiagoNow();
  const online = useOnlineStatus();

  // Personas (en vivo).
  const [peopleKey, setPeopleKey] = useState(0);
  const [people, setPeople] = useState<{ key: number; persons: Person[]; loaded: boolean; error: ReadErrorKind | null }>({
    key: -1,
    persons: [],
    loaded: false,
    error: null,
  });
  useEffect(() => {
    if (!canRead) return;
    const key = peopleKey;
    return subscribePeople(
      (persons) => setPeople({ key, persons, loaded: true, error: null }),
      (error) => setPeople((s) => ({ key, persons: s.key === key ? s.persons : [], loaded: true, error })),
    );
  }, [canRead, peopleKey]);
  const fresh = people.key === peopleKey;
  const persons = useMemo(() => (fresh ? people.persons : []), [fresh, people.persons]);
  const retry = useCallback(() => setPeopleKey((k) => k + 1), []);

  // Responsables válidos (una vez; reintento manual).
  const [ownersKey, setOwnersKey] = useState(0);
  const [ownersState, setOwnersState] = useState<{ key: number; owners: OwnerOption[] | null; error: boolean }>({
    key: -1,
    owners: null,
    error: false,
  });
  useEffect(() => {
    if (!canRead) return;
    let alive = true;
    const key = ownersKey;
    fetchOwnerOptions().then(
      (owners) => alive && setOwnersState({ key, owners, error: false }),
      () => alive && setOwnersState({ key, owners: null, error: true }),
    );
    return () => {
      alive = false;
    };
  }, [canRead, ownersKey]);
  const ownersFresh = ownersState.key === ownersKey;
  const owners = ownersFresh ? ownersState.owners : null;
  const retryOwners = useCallback(() => setOwnersKey((k) => k + 1), []);

  const ownerMap = useMemo(() => (owners ? new Map(owners.map((o) => [o.uid, o.displayName] as const)) : null), [owners]);
  const ownerSet = useMemo(() => (ownerMap ? new Set(ownerMap.keys()) : null), [ownerMap]);
  const alerts = useMemo(() => computeAlerts(persons, ownerSet, now), [persons, ownerSet, now]);
  const views = useMemo(() => {
    const map = new Map<string, PersonView>();
    for (const p of persons) map.set(p.id, buildPersonView(p, alerts, ownerMap, today));
    return map;
  }, [persons, alerts, ownerMap, today]);
  const ownerName = useCallback((uid: string | null | undefined) => (uid ? (ownerMap?.get(uid) ?? null) : null), [ownerMap]);

  const value = useMemo<MembersState>(
    () => ({
      persons,
      loading: canRead && (!fresh || !people.loaded),
      error: fresh ? people.error : null,
      retry,
      owners,
      ownersLoading: canRead && !ownersFresh,
      ownersError: ownersFresh && ownersState.error,
      retryOwners,
      ownerName,
      alerts,
      views,
      today,
      now,
      online,
      canManage,
      canReadCalendar,
    }),
    [
      persons,
      canRead,
      fresh,
      people.loaded,
      people.error,
      retry,
      owners,
      ownersFresh,
      ownersState.error,
      retryOwners,
      ownerName,
      alerts,
      views,
      today,
      now,
      online,
      canManage,
      canReadCalendar,
    ],
  );
  return createElement(MembersContext.Provider, { value }, children);
}

export function useMembers(): MembersState {
  const ctx = useContext(MembersContext);
  if (!ctx) throw new Error("useMembers debe usarse dentro de MembersProvider");
  return ctx;
}
