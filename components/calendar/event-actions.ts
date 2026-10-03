// Qué acciones ofrece el detalle de una actividad y, si no, por qué (16b §5.7,
// 18b §2.3). Se apoya en las reglas puras de lib/calendar/calendar, que espejan
// las Firestore Rules: la UI explica antes de que el guardado falle.

import {
  areaById,
  canArchiveEvent,
  canManageEvent,
  canManageSeries,
  canPublishEvent,
  isRecurring,
  isSeriesEnded,
  isSeriesStarted,
  startedLockHelp,
  type CalendarActor,
} from "@/lib/calendar/calendar";
import { CALENDAR_ERROR_MESSAGES } from "@/lib/calendar/errors";
import { compareLocal } from "@/lib/shared/dates";
import type { Area, Occurrence, Ymd } from "@/lib/shared/types";

export interface EventActions {
  /** false = solo lectura pura (sin ningún permiso de gestión): no hay footer. */
  showFooter: boolean;
  canEdit: boolean;
  canCancel: boolean;
  canArchive: boolean;
  /** Puede cancelar solo esta fecha (serie) o la actividad (sin serie). */
  canCancelThisDate: boolean;
  /** Puede cancelar la serie desde hoy. */
  canCancelSeries: boolean;
  /** Botón "Publicar" (actividad Solo equipo que gestiona y puede publicar). */
  canPublish: boolean;
  /** Botón "Dejar de publicar". */
  canUnpublish: boolean;
  /** "Para publicarla, pide a Pastor o Administración." (gestiona, pero no publica). */
  publishHint: string | null;
  /** Una línea para una serie o actividad ya iniciada (el formulario bloquea día y hora). */
  startedNote: string | null;
  /** Explicación general cuando ninguna acción está disponible. */
  reason: string | null;
  /** Explicaciones puntuales cuando solo algunas acciones están bloqueadas. */
  editReason: string | null;
  cancelReason: string | null;
  archiveReason: string | null;
}

export const PAST_REASON = "Las actividades pasadas solo las corrige Pastor o Administración.";
export const SERIES_CANCELLED_REASON = "Esta serie está cancelada: solo Pastor o Administración pueden modificarla.";
export const PUBLISH_HINT = "Para publicarla, pide a Pastor o Administración.";
export const ARCHIVE_STARTED_REASON =
  "Esta actividad ya empezó: solo Pastor o Administración pueden eliminarla. Para quitar fechas futuras, usa «Cancelar».";

const NONE: EventActions = {
  showFooter: false,
  canEdit: false,
  canCancel: false,
  canArchive: false,
  canCancelThisDate: false,
  canCancelSeries: false,
  canPublish: false,
  canUnpublish: false,
  publishHint: null,
  startedNote: null,
  reason: null,
  editReason: null,
  cancelReason: null,
  archiveReason: null,
};

export function eventActions(
  actor: CalendarActor | null,
  o: Occurrence,
  areas: readonly Area[],
  today: Ymd,
  offline = false,
): EventActions {
  if (!actor || !actor.can("calendar.events.manage_assigned")) return NONE;
  const e = o.event;
  const recurring = isRecurring(e);
  const manageAll = actor.can("calendar.events.manage_all");
  const resp = areaById(areas, e.responsibleAreaId);
  const respName = resp?.name ?? "otra área";
  const mine = actor.areaIds.includes(e.responsibleAreaId);
  const participates = e.participantAreaIds.some((id) => actor.areaIds.includes(id));

  let canEdit = recurring ? canManageSeries(actor, e, areas, today) : canManageEvent(actor, e, areas, today);
  const futureDate = compareLocal(o.date, today) >= 0;
  let canCancelThisDate = recurring
    ? canManageEvent(actor, e, areas, today, o.date) &&
      futureDate &&
      o.status !== "cancelled" &&
      !e.exceptions.some((x) => x.date === o.date) &&
      (!e.recurrence.until || compareLocal(o.date, e.recurrence.until) <= 0)
    : canManageEvent(actor, e, areas, today) && e.status === "scheduled";
  let canCancelSeries =
    recurring && canManageSeries(actor, e, areas, today) && !e.seriesCancellation && !isSeriesEnded(e, today);
  let canArchive = canArchiveEvent(actor, e, areas, today);

  const scheduled = e.status === "scheduled";
  const publisher = canPublishEvent(actor, e);
  let canPublish = canEdit && scheduled && e.visibility === "internal" && publisher;
  let canUnpublish = canEdit && scheduled && e.visibility === "public" && publisher;
  const publishHint = canEdit && scheduled && e.visibility === "internal" && !publisher ? PUBLISH_HINT : null;
  const startedNote = canEdit && scheduled && isSeriesStarted(e, today) ? startedLockHelp(e) : null;

  let reason: string | null = null;
  if (!manageAll && !mine) {
    reason = participates
      ? `Tu área participa en esta actividad, pero la organiza ${respName}. Solo ${respName}, Pastor o Administración pueden modificarla.`
      : `Solo el área responsable (${respName}), Pastor o Administración pueden modificar esta actividad.`;
  } else if (!manageAll && resp && !resp.active) {
    reason = `${respName} está inactiva: solo Pastor o Administración pueden modificar sus actividades.`;
  } else if (!manageAll && recurring && e.seriesCancellation) {
    reason = SERIES_CANCELLED_REASON;
  } else if (!canEdit && !canCancelThisDate && !canCancelSeries && !canArchive) {
    reason = e.status === "cancelled" ? "Esta actividad está cancelada." : PAST_REASON;
  }

  const canCancel = canCancelThisDate || canCancelSeries;
  let editReason = reason || canEdit ? null : e.status === "cancelled" ? "Una actividad cancelada no se edita." : PAST_REASON;
  let cancelReason =
    reason || canCancel
      ? null
      : o.status === "cancelled"
        ? recurring
          ? "Esta fecha ya está cancelada."
          : "Esta actividad ya está cancelada."
        : PAST_REASON;
  let archiveReason = reason || canArchive ? null : ARCHIVE_STARTED_REASON;

  if (offline) {
    const any = canEdit || canCancel || canArchive || canPublish || canUnpublish;
    canEdit = canCancelThisDate = canCancelSeries = canArchive = canPublish = canUnpublish = false;
    if (any && !reason) {
      reason = CALENDAR_ERROR_MESSAGES.offline;
      editReason = cancelReason = archiveReason = null;
    }
  }

  return {
    showFooter: true,
    canEdit,
    canCancel: canCancelThisDate || canCancelSeries,
    canArchive,
    canCancelThisDate,
    canCancelSeries,
    canPublish,
    canUnpublish,
    publishHint,
    startedNote,
    reason,
    editReason,
    cancelReason,
    archiveReason,
  };
}
