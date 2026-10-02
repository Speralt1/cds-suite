"use client";

// EventDetailSheet (16b §5.7): área responsable destacada, participantes,
// fecha y hora, lugar, visibilidad, estado, recurrencia, descripción pública,
// notas internas (solo dentro de la app) e historial con nombres humanos.

import { Info, Lock, MapPin, Pencil, Repeat, Trash2, Ban, CalendarDays } from "lucide-react";
import { areaById } from "@/lib/suite-preview/areas";
import { dateOf, numericYmd } from "@/lib/suite-preview/dates";
import type { AccessProfile, Area, Occurrence, Ymd } from "@/lib/suite-preview/types";
import { Sheet } from "@/components/finance-preview/ui";
import { AreaChip, AreaPill } from "../primitives";
import { OccurrenceStatusBadge, VisibilityBadge } from "./event-bits";
import { exceptionsText, occurrenceWhen, personName, recurrenceText, shortDay } from "./labels";
import { eventActions } from "./permissions";

function cancelInfo(o: Occurrence): { at?: string; by?: string; reason?: string } | null {
  if (o.status !== "cancelada") return null;
  const e = o.event;
  const ex = e.exceptions.find((x) => x.date === o.date);
  if (ex) return { at: ex.at, by: ex.by, reason: ex.reason };
  if (e.seriesCancellation) return { at: e.seriesCancellation.at, by: e.seriesCancellation.by, reason: e.seriesCancellation.reason };
  return { at: e.cancelledAt, by: e.cancelledBy, reason: e.cancelReason };
}

export function EventDetailSheet({
  occurrence,
  open,
  onClose,
  profile,
  areas,
  users,
  today,
  onEdit,
  onCancel,
  onArchive,
}: {
  occurrence: Occurrence | null;
  open: boolean;
  onClose: () => void;
  profile: AccessProfile | null;
  areas: readonly Area[];
  users: readonly AccessProfile[];
  today: Ymd;
  onEdit: (o: Occurrence) => void;
  onCancel: (o: Occurrence) => void;
  onArchive: (o: Occurrence) => void;
}) {
  const o = occurrence;
  const e = o?.event;
  const area = e ? areaById(areas, e.responsibleAreaId) : undefined;
  const actions = o ? eventActions(profile, o, areas, today) : null;
  const ci = o ? cancelInfo(o) : null;
  const rec = e ? recurrenceText(e) : null;
  const exc = e ? exceptionsText(e) : null;
  const participants = e ? e.participantAreaIds.map((id) => areaById(areas, id)).filter((a): a is Area => !!a) : [];
  const explainId = "sx-detail-explain";

  const footer =
    o && actions?.showFooter ? (
      <div className="sx-detail-foot">
        <div className="sx-detail-actions">
          <button
            type="button"
            className="fx-btn fx-btn-secondary"
            aria-disabled={!actions.canEdit || undefined}
            aria-describedby={!actions.canEdit ? explainId : undefined}
            onClick={() => actions.canEdit && onEdit(o)}
          >
            <Pencil size={16} aria-hidden="true" /> Editar
          </button>
          <button
            type="button"
            className="fx-btn fx-btn-secondary"
            aria-disabled={!actions.canCancel || undefined}
            aria-describedby={!actions.canCancel ? explainId : undefined}
            onClick={() => actions.canCancel && onCancel(o)}
          >
            <Ban size={16} aria-hidden="true" /> Cancelar actividad
          </button>
          <button
            type="button"
            className="fx-btn fx-btn-ghost sx-btn-danger-ghost"
            aria-disabled={!actions.canArchive || undefined}
            aria-describedby={!actions.canArchive ? explainId : undefined}
            onClick={() => actions.canArchive && onArchive(o)}
          >
            <Trash2 size={16} aria-hidden="true" /> Eliminar
          </button>
        </div>
        {(actions.reason || actions.editReason || actions.cancelReason || actions.archiveReason) && (
          <p className="sx-detail-explain" id={explainId}>
            <Info size={14} aria-hidden="true" />
            <span>
              {actions.reason ??
                [actions.editReason, actions.cancelReason, actions.archiveReason].filter((x, i, arr) => x && arr.indexOf(x) === i).join(" ")}
            </span>
          </p>
        )}
      </div>
    ) : undefined;

  return (
    <Sheet
      open={open && !!o}
      onClose={onClose}
      labelId="sx-event-detail-title"
      title={e ? <span className={o?.status === "cancelada" ? "sx-struck" : undefined}>{e.title}</span> : ""}
      footer={footer}
    >
      {o && e && (
        <div className="sx-detail">
          {area && (
            <div className="sx-detail-pill">
              <AreaPill area={area} />
            </div>
          )}
          <div className="sx-detail-badges">
            <OccurrenceStatusBadge status={o.status} />
            <VisibilityBadge visibility={e.visibility} />
          </div>
          <p className="fx-help-13 sx-detail-vis-help">
            {e.visibility === "public" ? "Aparece en el calendario compartido." : "Solo la ven usuarios de CDS."}
          </p>
          {ci && (
            <p className="sx-detail-cancel">
              <Ban size={14} aria-hidden="true" />
              <span>
                Cancelada{ci.at ? ` el ${numericYmd(dateOf(ci.at)).slice(0, 5)}` : ""}
                {ci.by ? ` por ${personName(users, ci.by)}` : ""}
                {ci.reason ? ` · Motivo: ${ci.reason}` : ""}
              </span>
            </p>
          )}

          <div className="sx-detail-when">
            <p className="sx-detail-when-main">
              <CalendarDays size={16} aria-hidden="true" />
              <span>{occurrenceWhen(o)}</span>
            </p>
            {rec && (
              <p className="sx-detail-line">
                <Repeat size={14} aria-hidden="true" />
                <span>
                  {rec}
                  {exc && <span className="sx-detail-exc"> · {exc}</span>}
                </span>
              </p>
            )}
            {e.seriesCancellation && (
              <p className="sx-detail-line">
                <Ban size={14} aria-hidden="true" />
                <span>Serie cancelada desde el {shortDay(e.seriesCancellation.from)}. Las fechas anteriores quedan como realizadas.</span>
              </p>
            )}
            {e.location && (
              <p className="sx-detail-line">
                <MapPin size={14} aria-hidden="true" />
                <span>{e.location}</span>
              </p>
            )}
          </div>

          <section className="sx-detail-section" aria-labelledby="sx-detail-participants">
            <h3 className="fx-h3" id="sx-detail-participants">
              Áreas participantes
            </h3>
            {participants.length ? (
              <ul className="sx-chip-list">
                {participants.map((a) => (
                  <li key={a.id}>
                    <AreaChip area={a} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="fx-help-13">Solo participa el área responsable.</p>
            )}
          </section>

          <section className="sx-detail-section" aria-labelledby="sx-detail-desc">
            <h3 className="fx-h3" id="sx-detail-desc">
              Descripción pública
            </h3>
            <p className="sx-detail-text">{e.publicDescription || <span className="fx-help-13">Sin descripción.</span>}</p>
          </section>

          {e.internalNotes && (
            <section className="sx-detail-section sx-detail-notes" aria-labelledby="sx-detail-notes">
              <h3 className="fx-h3 sx-detail-notes-title" id="sx-detail-notes">
                <Lock size={13} aria-hidden="true" /> Notas internas · solo equipo CDS
              </h3>
              <p className="sx-detail-text">{e.internalNotes}</p>
            </section>
          )}

          <section className="sx-detail-section" aria-labelledby="sx-detail-history">
            <h3 className="fx-h3" id="sx-detail-history">
              Historial
            </h3>
            <ul className="sx-detail-history">
              <li>
                Creada por {personName(users, e.createdBy)} · {numericYmd(dateOf(e.createdAt))}
              </li>
              {e.updatedBy && e.updatedAt && (
                <li>
                  Editada por {personName(users, e.updatedBy)} · {numericYmd(dateOf(e.updatedAt))}
                </li>
              )}
              {e.exceptions.map((x) => (
                <li key={x.date}>
                  Fecha {shortDay(x.date)} cancelada por {personName(users, x.by)} · {numericYmd(dateOf(x.at))}
                </li>
              ))}
              {e.seriesCancellation && (
                <li>
                  Serie cancelada por {personName(users, e.seriesCancellation.by)} · {numericYmd(dateOf(e.seriesCancellation.at))}
                </li>
              )}
              {!e.exceptions.length && e.cancelledBy && e.cancelledAt && (
                <li>
                  Cancelada por {personName(users, e.cancelledBy)} · {numericYmd(dateOf(e.cancelledAt))}
                </li>
              )}
            </ul>
          </section>
        </div>
      )}
    </Sheet>
  );
}
