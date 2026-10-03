"use client";

// Cliente Firestore del Calendario: lectura en vivo por rango y mutaciones
// atómicas (evento + `changes/r{revision}` en un writeBatch). Los planes y la
// auditoría son puros (./audit) y espejan las reglas.

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import type { CalendarEvent, Visibility, Ymd } from "@/lib/shared/types";
import {
  planArchive,
  planCancelEvent,
  planCancelOccurrence,
  planCancelSeriesFrom,
  planCreate,
  planUpdate,
  planVisibility,
  type UpdatePlan,
} from "./audit";
import type { EventInput } from "./calendar";
import { calendarErrorMessage } from "./errors";

export const EVENTS_COLLECTION = "calendarEvents";

export interface CalendarEventsState {
  events: CalendarEvent[];
  loading: boolean;
  /** Mensaje en español ("" si no hay error). */
  error: string;
}

function toEvent(snap: QueryDocumentSnapshot<DocumentData>): CalendarEvent {
  const d = snap.data();
  return {
    ...(d as Omit<CalendarEvent, "id">),
    participantAreaIds: Array.isArray(d.participantAreaIds) ? d.participantAreaIds : [],
    exceptions: Array.isArray(d.exceptions) ? d.exceptions : [],
    recurrence: d.recurrence && typeof d.recurrence === "object" ? d.recurrence : { freq: "none" },
    id: snap.id,
  };
}

/**
 * Actividades con `lastDate >= fromYmd`, en vivo. Las archivadas se excluyen
 * en memoria (no aparecen en ninguna vista ni reporte).
 */
export function useCalendarEvents(fromYmd: string): CalendarEventsState {
  const [state, setState] = useState<CalendarEventsState & { key: string }>({
    key: "",
    events: [],
    loading: true,
    error: "",
  });

  useEffect(() => {
    if (!fromYmd) return;
    const q = query(collection(getFirebaseServices().db, EVENTS_COLLECTION), where("lastDate", ">=", fromYmd));
    return onSnapshot(
      q,
      (snapshot) =>
        setState({
          key: fromYmd,
          events: snapshot.docs.map(toEvent).filter((e) => e.status !== "archived"),
          loading: false,
          error: "",
        }),
      (error) => setState({ key: fromYmd, events: [], loading: false, error: calendarErrorMessage(error, "load") }),
    );
  }, [fromYmd]);

  const fresh = state.key === fromYmd;
  return { events: fresh ? state.events : [], loading: !fresh || state.loading, error: fresh ? state.error : "" };
}

function actorUid(): string {
  const uid = getFirebaseServices().auth.currentUser?.uid;
  if (!uid) throw Object.assign(new Error("calendar/unauthenticated"), { code: "unauthenticated" });
  return uid;
}

function context() {
  return { actorUid: actorUid(), now: serverTimestamp() };
}

async function commitUpdate(event: CalendarEvent, plan: UpdatePlan): Promise<void> {
  const { db } = getFirebaseServices();
  const ref = doc(db, EVENTS_COLLECTION, event.id);
  const batch = writeBatch(db);
  batch.update(ref, plan.patch as DocumentData);
  batch.set(doc(ref, "changes", plan.changeId), plan.change as unknown as DocumentData);
  await batch.commit();
}

/** Crea la actividad (revision 1) y su registro `created`. Devuelve el id. */
export async function createEvent(input: EventInput): Promise<string> {
  const { db } = getFirebaseServices();
  const plan = planCreate(input, context());
  const ref = doc(collection(db, EVENTS_COLLECTION));
  const batch = writeBatch(db);
  batch.set(ref, plan.data as unknown as DocumentData);
  batch.set(doc(ref, "changes", plan.changeId), plan.change as unknown as DocumentData);
  await batch.commit();
  return ref.id;
}

/** Edita la actividad (en una serie: toda la serie). */
export async function updateEvent(event: CalendarEvent, input: EventInput): Promise<void> {
  await commitUpdate(event, planUpdate(event, input, context()));
}

/** Alias: en V1 editar una serie siempre aplica a toda la serie. */
export const updateSeries = updateEvent;

/** Cancela una actividad simple (no recurrente): queda visible como «Cancelada». */
export async function cancelEvent(event: CalendarEvent, reason: string): Promise<void> {
  await commitUpdate(event, planCancelEvent(event, reason, context()));
}

/** Cancela solo una fecha de una serie (excepción con motivo). */
export async function cancelOccurrence(event: CalendarEvent, date: Ymd, reason: string): Promise<void> {
  await commitUpdate(event, planCancelOccurrence(event, date, reason, context()));
}

/** Cancela la serie desde una fecha (las anteriores quedan como realizadas). */
export async function cancelSeriesFrom(event: CalendarEvent, from: Ymd, reason: string): Promise<void> {
  await commitUpdate(event, planCancelSeriesFrom(event, from, reason, context()));
}

/** "Eliminar": archiva con motivo (nada se borra). */
export async function archiveEvent(event: CalendarEvent, reason: string): Promise<void> {
  await commitUpdate(event, planArchive(event, reason, context()));
}

/** Publicar (`public`) o dejar de publicar (`internal`). */
export async function setVisibility(event: CalendarEvent, visibility: Visibility): Promise<void> {
  await commitUpdate(event, planVisibility(event, visibility, context()));
}
