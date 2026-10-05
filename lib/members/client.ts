"use client";

// Lecturas de Consolidación V1 (doc 23 §4, §10). Las cuatro colecciones son de
// SOLO LECTURA para el cliente: toda escritura va por los callables (./api).
// Mapeo tolerante documento → tipo: un campo faltante o con tipo inesperado
// nunca rompe la pantalla (se usa un valor neutro).

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import { localNow, isValidYmd } from "@/lib/shared/dates";
import {
  ARRIVAL_SOURCES,
  CLOSED_REASONS,
  CONSOLIDATION_STATUSES,
  FOLLOW_UP_RESULTS,
  FOLLOW_UP_TYPES,
  LIFECYCLE_STAGES,
  MEMBERS_COLLECTIONS,
  PERSON_CHANGE_ACTIONS,
  projectionOf,
} from "@/lib/shared/members";
import { errorCode } from "@/lib/calendar/errors";
import type { FollowUp, LocalDateTime, Person, PersonChange, Visit, Ymd } from "./types";

export const PEOPLE_LIMIT = 1000;
export const HISTORY_LIMIT = 200;
const CALENDAR_EVENTS = "calendarEvents";

// ---------- Mapeo tolerante ----------

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const ymdOrNull = (v: unknown): Ymd | null => (typeof v === "string" && isValidYmd(v) ? v : null);
function oneOf<T extends string>(v: unknown, values: readonly T[], fallback: T): T;
function oneOf<T extends string>(v: unknown, values: readonly T[], fallback: null): T | null;
function oneOf<T extends string>(v: unknown, values: readonly T[], fallback: T | null): T | null {
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Timestamp de Firestore (o Date, epoch ms, ISO) → hora de pared de Santiago. */
export function toLocalDateTime(v: unknown): LocalDateTime | null {
  try {
    if (!v) return null;
    if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: unknown }).toDate === "function")
      return localNow((v as { toDate: () => Date }).toDate());
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : localNow(v);
    if (typeof v === "object" && v !== null && typeof (v as { seconds?: unknown }).seconds === "number")
      return localNow((v as { seconds: number }).seconds * 1000);
    if (typeof v === "number" && Number.isFinite(v)) return localNow(v);
    if (typeof v === "string") {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return v;
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : localNow(t);
    }
  } catch {
    return null;
  }
  return null;
}

export function toPerson(id: string, data: Raw | undefined): Person {
  const d = data ?? {};
  const createdAt = toLocalDateTime(d.createdAt);
  const projection = projectionOf(d);
  const entryDate = ymdOrNull(d.entryDate) ?? createdAt?.slice(0, 10) ?? projection.firstVisitDate ?? "1970-01-01";
  const revision = typeof d.revision === "number" && Number.isInteger(d.revision) && d.revision > 0 ? d.revision : 1;
  return {
    id,
    fullName: str(d.fullName)?.trim() ?? "Sin nombre",
    phoneE164: str(d.phoneE164) ?? "",
    email: str(d.email),
    entryDate,
    firstVisitAt: ymdOrNull(d.firstVisitAt) ?? projection.firstVisitDate,
    arrivalSource: oneOf(d.arrivalSource, ARRIVAL_SOURCES, null),
    calendarEventId: str(d.calendarEventId),
    invitedBy: str(d.invitedBy),
    lifecycleStage: oneOf(d.lifecycleStage, LIFECYCLE_STAGES, "en_consolidacion"),
    consolidationStatus: oneOf(d.consolidationStatus, CONSOLIDATION_STATUSES, "por_contactar"),
    closedReason: oneOf(d.closedReason, CLOSED_REASONS, null),
    followUpOwnerUid: str(d.followUpOwnerUid),
    doNotContact: d.doNotContact === true,
    createdAt,
    createdBy: str(d.createdBy),
    updatedAt: toLocalDateTime(d.updatedAt),
    revision,
    projection,
  };
}

export function toVisit(id: string, data: Raw | undefined): Visit {
  const d = data ?? {};
  const createdAt = toLocalDateTime(d.createdAt);
  return {
    id,
    personId: str(d.personId) ?? "",
    date: ymdOrNull(d.date) ?? createdAt?.slice(0, 10) ?? "1970-01-01",
    calendarEventId: str(d.calendarEventId),
    note: str(d.note),
    firstVisit: d.firstVisit === true,
    createdAt,
    createdBy: str(d.createdBy),
  };
}

export function toFollowUp(id: string, data: Raw | undefined): FollowUp {
  const d = data ?? {};
  const createdAt = toLocalDateTime(d.createdAt);
  return {
    id,
    personId: str(d.personId) ?? "",
    contactDate: ymdOrNull(d.contactDate) ?? createdAt?.slice(0, 10) ?? "1970-01-01",
    type: oneOf(d.type, FOLLOW_UP_TYPES, "otro"),
    result: oneOf(d.result, FOLLOW_UP_RESULTS, "otro"),
    note: str(d.note),
    nextAction: str(d.nextAction),
    nextActionDate: ymdOrNull(d.nextActionDate),
    ownerUid: str(d.ownerUid),
    createdAt,
    createdBy: str(d.createdBy),
  };
}

export function toPersonChange(id: string, data: Raw | undefined): PersonChange {
  const d = data ?? {};
  const scalar = (v: unknown) => (typeof v === "string" || typeof v === "boolean" ? v : null);
  return {
    id,
    personId: str(d.personId) ?? "",
    action: oneOf(d.action, PERSON_CHANGE_ACTIONS, "profile_updated"),
    field: str(d.field),
    from: scalar(d.from),
    to: scalar(d.to),
    changedFields: Array.isArray(d.changedFields) ? d.changedFields.filter((x): x is string => typeof x === "string") : [],
    reason: oneOf(d.reason, CLOSED_REASONS, null),
    reasonNote: str(d.reasonNote),
    refId: str(d.refId),
    revision: typeof d.revision === "number" ? d.revision : null,
    actorUid: str(d.actorUid),
    at: toLocalDateTime(d.at),
  };
}

// ---------- Errores de lectura ----------

export type ReadErrorKind = "permission" | "network" | "other";

export function readErrorKind(error: unknown): ReadErrorKind {
  const code = errorCode(error);
  if (code === "permission-denied" || code === "unauthenticated") return "permission";
  if (["unavailable", "deadline-exceeded", "cancelled", "resource-exhausted"].includes(code)) return "network";
  return "other";
}

// ---------- Personas (en vivo) ----------

/** `membersPeople` ordenadas por ingreso (más reciente primero), máx. 1000. */
export function subscribePeople(onNext: (persons: Person[]) => void, onError: (kind: ReadErrorKind) => void): () => void {
  const q = query(
    collection(getFirebaseServices().db, MEMBERS_COLLECTIONS.people),
    orderBy("entryDate", "desc"),
    limit(PEOPLE_LIMIT),
  );
  return onSnapshot(
    q,
    (snap) => onNext(snap.docs.map((d) => toPerson(d.id, d.data() as DocumentData))),
    (error) => onError(readErrorKind(error)),
  );
}

// ---------- Historial de una persona (en vivo) ----------

export interface PersonHistory {
  visits: Visit[];
  followUps: FollowUp[];
  changes: PersonChange[];
  loading: boolean;
  error: ReadErrorKind | null;
}

const EMPTY_HISTORY: PersonHistory = { visits: [], followUps: [], changes: [], loading: true, error: null };

/** Visitas, seguimientos y cambios de una persona (índices `personId ASC, createdAt|at DESC`). */
export function usePersonHistory(personId: string | null, retryKey = 0): PersonHistory {
  const key = personId ? `${personId}#${retryKey}` : "";
  const [state, setState] = useState<{ key: string; parts: Partial<Record<"visits" | "followUps" | "changes", unknown[]>>; error: ReadErrorKind | null }>({
    key: "",
    parts: {},
    error: null,
  });

  useEffect(() => {
    if (!personId) return;
    const k = `${personId}#${retryKey}`;
    const { db } = getFirebaseServices();
    const byPerson = (name: string, order: string) =>
      query(collection(db, name), where("personId", "==", personId), orderBy(order, "desc"), limit(HISTORY_LIMIT));
    const set = (part: "visits" | "followUps" | "changes", list: unknown[]) =>
      setState((s) => (s.key === k ? { ...s, parts: { ...s.parts, [part]: list } } : { key: k, parts: { [part]: list }, error: null }));
    const fail = (error: unknown) => setState((s) => ({ key: k, parts: s.key === k ? s.parts : {}, error: readErrorKind(error) }));
    const unsubs = [
      onSnapshot(byPerson(MEMBERS_COLLECTIONS.visits, "createdAt"), (s) => set("visits", s.docs.map((d) => toVisit(d.id, d.data()))), fail),
      onSnapshot(byPerson(MEMBERS_COLLECTIONS.followUps, "createdAt"), (s) => set("followUps", s.docs.map((d) => toFollowUp(d.id, d.data()))), fail),
      onSnapshot(byPerson(MEMBERS_COLLECTIONS.changes, "at"), (s) => set("changes", s.docs.map((d) => toPersonChange(d.id, d.data()))), fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [personId, retryKey]);

  if (!personId || state.key !== key) return EMPTY_HISTORY;
  const { parts, error } = state;
  return {
    visits: (parts.visits as Visit[] | undefined) ?? [],
    followUps: (parts.followUps as FollowUp[] | undefined) ?? [],
    changes: (parts.changes as PersonChange[] | undefined) ?? [],
    loading: !error && (!parts.visits || !parts.followUps || !parts.changes),
    error,
  };
}

// ---------- Títulos de actividades del calendario ----------

const titleCache = new Map<string, string | null>();

/**
 * Títulos de `calendarEvents/{id}` para la ficha. SOLO se leen con
 * calendar.read (`enabled`); sin él no hay ninguna lectura y la UI muestra
 * "Actividad del calendario". Un id inexistente o ilegible → null.
 */
export function useCalendarTitles(ids: readonly string[], enabled: boolean): Record<string, string | null> {
  const wanted = enabled ? [...new Set(ids)].filter(Boolean).sort() : [];
  const wantedKey = wanted.join("|");
  const [titles, setTitles] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!wantedKey) return;
    let alive = true;
    const pending = wantedKey.split("|").filter((id) => !titleCache.has(id));
    const publish = () => {
      if (!alive) return;
      setTitles(Object.fromEntries(wantedKey.split("|").map((id) => [id, titleCache.get(id) ?? null])));
    };
    if (!pending.length) {
      publish();
      return;
    }
    const { db } = getFirebaseServices();
    Promise.all(
      pending.map(async (id) => {
        try {
          const snap = await getDoc(doc(db, CALENDAR_EVENTS, id));
          const data = snap.exists() ? (snap.data() as Raw) : null;
          titleCache.set(id, data && data.status !== "archived" ? str(data.title) : null);
        } catch {
          // Sin caché: un error transitorio se reintenta en la próxima ficha.
        }
      }),
    ).then(publish);
    return () => {
      alive = false;
    };
  }, [wantedKey]);

  return enabled ? titles : {};
}
