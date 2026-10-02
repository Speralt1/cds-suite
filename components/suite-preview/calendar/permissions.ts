// Qué acciones ofrece el detalle de una actividad y, si no, por qué (16b §5.7).
// Se apoya en las reglas puras de lib/suite-preview/calendar (las mismas que
// revalida el store al despachar).

import { can } from "@/lib/suite-preview/access";
import { areaById } from "@/lib/suite-preview/areas";
import { canArchiveEvent, canManageEvent, canManageSeries, isSeriesEnded } from "@/lib/suite-preview/calendar";
import { compareLocal } from "@/lib/suite-preview/dates";
import { isRecurring } from "@/lib/suite-preview/recurrence";
import type { AccessProfile, Area, Occurrence, Ymd } from "@/lib/suite-preview/types";

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
  /** Explicación general cuando ninguna acción está disponible. */
  reason: string | null;
  /** Explicaciones puntuales cuando solo algunas acciones están bloqueadas. */
  editReason: string | null;
  cancelReason: string | null;
  archiveReason: string | null;
}

export const PAST_REASON = "Las actividades pasadas solo las corrige Pastor o Administración.";
export const SERIES_CANCELLED_REASON = "Esta serie está cancelada: solo Pastor o Administración pueden modificarla.";

export function eventActions(p: AccessProfile | null, o: Occurrence, areas: readonly Area[], today: Ymd): EventActions {
  const none: EventActions = {
    showFooter: false,
    canEdit: false,
    canCancel: false,
    canArchive: false,
    canCancelThisDate: false,
    canCancelSeries: false,
    reason: null,
    editReason: null,
    cancelReason: null,
    archiveReason: null,
  };
  if (!p || !can(p, "calendar.events.manage_assigned")) return none;
  const e = o.event;
  const recurring = isRecurring(e);
  const manageAll = can(p, "calendar.events.manage_all");
  const resp = areaById(areas, e.responsibleAreaId);
  const respName = resp?.name ?? "otra área";
  const mine = p.areaIds.includes(e.responsibleAreaId);
  const participates = e.participantAreaIds.some((id) => p.areaIds.includes(id));

  const canEdit = recurring ? canManageSeries(p, e, areas, today) : canManageEvent(p, e, areas, today);
  const futureDate = compareLocal(o.date, today) >= 0;
  const canCancelThisDate = recurring
    ? canManageEvent(p, e, areas, today, o.date) && futureDate && o.status !== "cancelada" && !e.exceptions.some((x) => x.date === o.date)
    : canManageEvent(p, e, areas, today) && e.status === "programada" && compareLocal(e.endDate, today) >= 0;
  const canCancelSeries = recurring && canManageSeries(p, e, areas, today) && !e.seriesCancellation && !isSeriesEnded(e, today);
  const canCancel = canCancelThisDate || canCancelSeries;
  const canArchive = canArchiveEvent(p, e, areas, today);

  let reason: string | null = null;
  if (!manageAll && !mine) {
    reason = participates
      ? `Tu área participa en esta actividad, pero la organiza ${respName}.`
      : `Solo el área responsable (${respName}), Pastor o Administración pueden modificar esta actividad.`;
  } else if (!manageAll && resp && !resp.active) {
    reason = `${respName} está inactiva: solo Pastor o Administración pueden modificar sus actividades.`;
  } else if (!manageAll && recurring && e.seriesCancellation) {
    reason = SERIES_CANCELLED_REASON;
  } else if (!canEdit && !canCancel && !canArchive) {
    reason = e.status === "archivada" ? "Esta actividad está eliminada." : PAST_REASON;
  }

  const editReason = reason || canEdit ? null : PAST_REASON;
  const cancelReason =
    reason || canCancel
      ? null
      : o.status === "cancelada"
        ? recurring
          ? "Esta fecha ya está cancelada."
          : "Esta actividad ya está cancelada."
        : PAST_REASON;
  const archiveReason =
    reason || canArchive
      ? null
      : "Esta actividad ya empezó: solo Pastor o Administración pueden eliminarla. Para quitar fechas futuras, usa «Cancelar».";

  return { showFooter: true, canEdit, canCancel, canArchive, canCancelThisDate, canCancelSeries, reason, editReason, cancelReason, archiveReason };
}
