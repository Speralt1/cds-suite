"use client";

// EventDetailSheet (16b §5.7, 18b §2.3): área responsable destacada,
// participantes, fecha y hora, lugar, visibilidad, estado, recurrencia,
// descripción pública, notas internas (solo dentro de la app) e historial.
// Las acciones respetan los permisos y, si no están disponibles, lo explican.

import { useId } from "react";
import { Ban, CalendarDays, Globe, Info, Lock, MapPin, Pencil, Repeat, Trash2 } from "lucide-react";
import { areaById } from "@/lib/calendar/areas";
import type { CalendarActor } from "@/lib/calendar/calendar";
import type { Area, Occurrence, Ymd } from "@/lib/shared/types";
import { AreaChip, AreaPill } from "./area-badges";
import { eventActions } from "./event-actions";
import { OccurrenceStatusBadge, VisibilityBadge } from "./event-bits";
import { exceptionsText, occurrenceWhen, recurrenceText, shortDay, storedDate } from "./labels";
import { CalDialog } from "./ui";

function cancelReasonOf(o: Occurrence): string | null {
  if (o.status !== "cancelled") return null;
  return o.cancelReason;
}

export function EventDetailSheet({
  occurrence: o,
  onClose,
  actor,
  areas,
  today,
  uid,
  offline,
  onEdit,
  onCancel,
  onArchive,
  onPublish,
  onUnpublish,
}: {
  occurrence: Occurrence;
  onClose: () => void;
  actor: CalendarActor | null;
  areas: readonly Area[];
  today: Ymd;
  uid: string | null;
  offline: boolean;
  onEdit: (o: Occurrence) => void;
  onCancel: (o: Occurrence) => void;
  onArchive: (o: Occurrence) => void;
  onPublish: (o: Occurrence) => void;
  onUnpublish: (o: Occurrence) => void;
}) {
  const e = o.event;
  const explainId = useId();
  const area = areaById(areas, e.responsibleAreaId);
  const actions = eventActions(actor, o, areas, today, offline);
  const reason = cancelReasonOf(o);
  const rec = recurrenceText(e);
  const exc = exceptionsText(e);
  const participants = e.participantAreaIds.map((id) => areaById(areas, id)).filter((a): a is Area => !!a);
  const by = (who: string | undefined) => (who && uid && who === uid ? " por ti" : "");

  const explanations = actions.reason
    ? [actions.reason]
    : [actions.editReason, actions.cancelReason, actions.archiveReason].filter((x, i, arr): x is string => !!x && arr.indexOf(x) === i);

  const footer = actions.showFooter ? (
    <div className="cal-detail-foot">
      <div className="cal-detail-actions">
        <button
          type="button"
          className="button-secondary"
          aria-disabled={!actions.canEdit || undefined}
          aria-describedby={!actions.canEdit && explanations.length ? explainId : undefined}
          onClick={() => actions.canEdit && onEdit(o)}
        >
          <Pencil size={16} aria-hidden="true" /> Editar
        </button>
        {actions.canPublish && (
          <button type="button" className="button-secondary" onClick={() => onPublish(o)}>
            <Globe size={16} aria-hidden="true" /> Publicar
          </button>
        )}
        {actions.canUnpublish && (
          <button type="button" className="button-secondary" onClick={() => onUnpublish(o)}>
            <Lock size={16} aria-hidden="true" /> Dejar de publicar
          </button>
        )}
        <button
          type="button"
          className="button-secondary"
          aria-disabled={!actions.canCancel || undefined}
          aria-describedby={!actions.canCancel && explanations.length ? explainId : undefined}
          onClick={() => actions.canCancel && onCancel(o)}
        >
          <Ban size={16} aria-hidden="true" /> Cancelar actividad
        </button>
        <button
          type="button"
          className="button-ghost cal-btn-danger-ghost"
          aria-disabled={!actions.canArchive || undefined}
          aria-describedby={!actions.canArchive && explanations.length ? explainId : undefined}
          onClick={() => actions.canArchive && onArchive(o)}
        >
          <Trash2 size={16} aria-hidden="true" /> Eliminar
        </button>
      </div>
      {explanations.length > 0 && (
        <p className="cal-detail-explain" id={explainId}>
          <Info size={14} aria-hidden="true" />
          <span>{explanations.join(" ")}</span>
        </p>
      )}
    </div>
  ) : undefined;

  return (
    <CalDialog
      onClose={onClose}
      title={<span className={o.status === "cancelled" ? "cal-struck" : undefined}>{e.title}</span>}
      footer={footer}
    >
      <div className="cal-detail">
        {area && (
          <div className="cal-detail-pill">
            <AreaPill area={area} />
          </div>
        )}
        <div className="cal-detail-badges">
          <OccurrenceStatusBadge status={o.status} />
          <VisibilityBadge visibility={e.visibility} />
        </div>
        <p className="cal-help-13 cal-detail-vis-help">
          {e.visibility === "public" ? "Aparece en el calendario compartido." : "Solo la ven usuarios de CDS."}
        </p>
        {actions.publishHint && (
          <p className="cal-help cal-detail-hint">
            <Info size={14} aria-hidden="true" />
            <span>{actions.publishHint}</span>
          </p>
        )}
        {o.status === "cancelled" && (
          <p className="cal-detail-cancel">
            <Ban size={14} aria-hidden="true" />
            <span>
              {o.isRecurring && !e.seriesCancellation ? "Esta fecha está cancelada" : "Cancelada"}
              {reason ? ` · Motivo: ${reason}` : ""}
            </span>
          </p>
        )}

        <div className="cal-detail-when">
          <p className="cal-detail-when-main">
            <CalendarDays size={16} aria-hidden="true" />
            <span>{occurrenceWhen(o)}</span>
          </p>
          {rec && (
            <p className="cal-detail-line">
              <Repeat size={14} aria-hidden="true" />
              <span>
                {rec}
                {exc && <span className="cal-detail-exc"> · {exc}</span>}
              </span>
            </p>
          )}
          {e.seriesCancellation && (
            <p className="cal-detail-line">
              <Ban size={14} aria-hidden="true" />
              <span>Serie cancelada desde el {shortDay(e.seriesCancellation.from)}. Las fechas anteriores quedan como realizadas.</span>
            </p>
          )}
          {actions.startedNote && (
            <p className="cal-detail-line">
              <Info size={14} aria-hidden="true" />
              <span>{actions.startedNote}</span>
            </p>
          )}
          {e.location && (
            <p className="cal-detail-line">
              <MapPin size={14} aria-hidden="true" />
              <span>{e.location}</span>
            </p>
          )}
        </div>

        <section className="cal-detail-section" aria-labelledby={`${explainId}-participants`}>
          <h3 className="cal-h3" id={`${explainId}-participants`}>
            Áreas participantes
          </h3>
          {participants.length ? (
            <ul className="cal-chip-list">
              {participants.map((a) => (
                <li key={a.id}>
                  <AreaChip area={a} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="cal-help-13">Solo participa el área responsable.</p>
          )}
        </section>

        <section className="cal-detail-section" aria-labelledby={`${explainId}-desc`}>
          <h3 className="cal-h3" id={`${explainId}-desc`}>
            Descripción pública
          </h3>
          <p className="cal-detail-text">{e.publicDescription || <span className="cal-help-13">Sin descripción.</span>}</p>
        </section>

        {e.internalNotes && (
          <section className="cal-detail-section cal-detail-notes" aria-labelledby={`${explainId}-notes`}>
            <h3 className="cal-h3 cal-detail-notes-title" id={`${explainId}-notes`}>
              <Lock size={13} aria-hidden="true" /> Notas internas · solo equipo CDS
            </h3>
            <p className="cal-detail-text">{e.internalNotes}</p>
          </section>
        )}

        <section className="cal-detail-section" aria-labelledby={`${explainId}-history`}>
          <h3 className="cal-h3" id={`${explainId}-history`}>
            Historial
          </h3>
          <ul className="cal-detail-history">
            {storedDate(e.createdAt) && (
              <li>
                Creada el {storedDate(e.createdAt)}
                {by(e.createdBy)}
              </li>
            )}
            {e.revision > 1 && storedDate(e.updatedAt) && (
              <li>
                Último cambio el {storedDate(e.updatedAt)}
                {by(e.updatedBy)}
              </li>
            )}
            {e.exceptions.map((x) => (
              <li key={x.date}>
                Fecha {shortDay(x.date)} cancelada{by(x.by)}
              </li>
            ))}
            {e.seriesCancellation && (
              <li>
                Serie cancelada desde el {shortDay(e.seriesCancellation.from)}
                {storedDate(e.seriesCancellation.at) ? ` · ${storedDate(e.seriesCancellation.at)}` : ""}
                {by(e.seriesCancellation.by)}
              </li>
            )}
          </ul>
        </section>
      </div>
    </CalDialog>
  );
}
