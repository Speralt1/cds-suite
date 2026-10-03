"use client";

// Piezas de render de una actividad (16b §4.2): chip de mes, fila de agenda y
// badges de estado/visibilidad. El color SIEMPRE es el del área responsable y
// siempre va acompañado del nombre (o del aria-label en el chip de mes).

import { forwardRef } from "react";
import { Ban, CircleCheck, Clock, Globe, Lock } from "lucide-react";
import { areaById, FALLBACK_AREA_COLOR } from "@/lib/calendar/areas";
import type { Area, Occurrence, Visibility } from "@/lib/shared/types";
import { areaCss } from "./area-badges";
import { occurrenceAria, participantsLine } from "./labels";
import { CalBadge } from "./ui";

export function OccurrenceStatusBadge({ status }: { status: Occurrence["status"] }) {
  if (status === "cancelled") return <CalBadge icon={Ban} text="Cancelada" tone="neutral" />;
  if (status === "realized") return <CalBadge icon={CircleCheck} text="Realizada" tone="neutral" />;
  return <CalBadge icon={Clock} text="Programada" tone="info" />;
}

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  return visibility === "public" ? (
    <CalBadge icon={Globe} text="Pública" tone="info" />
  ) : (
    <CalBadge icon={Lock} text="Solo equipo" tone="neutral" />
  );
}

export function stateClass(o: Occurrence): string {
  return o.status === "cancelled" ? "is-cancelled" : o.status === "realized" ? "is-done" : "";
}

export function colorOf(o: Occurrence, areas: readonly Area[]) {
  return areaById(areas, o.event.responsibleAreaId)?.color ?? FALLBACK_AREA_COLOR;
}

/** Chip de mes (desktop): "11:00 Culto dominical" sobre el -soft del responsable. */
export const MonthChip = forwardRef<
  HTMLButtonElement,
  { o: Occurrence; areas: readonly Area[]; onOpen: (o: Occurrence) => void; showTime?: boolean; continuation?: boolean }
>(function MonthChip({ o, areas, onOpen, showTime = true, continuation }, ref) {
  const aria = occurrenceAria(o, areas);
  return (
    <button
      ref={ref}
      type="button"
      className={`cal-ev-chip ${stateClass(o)} ${continuation ? "is-cont" : ""}`}
      style={areaCss(colorOf(o, areas))}
      aria-label={aria}
      title={aria}
      onClick={() => onOpen(o)}
    >
      {o.status === "cancelled" && <Ban size={11} className="cal-ev-chip-icon" aria-hidden="true" />}
      {showTime && !o.allDay && !continuation && <span className="cal-ev-chip-time">{o.startTime}</span>}
      <span className="cal-ev-chip-title">{o.event.title}</span>
      {o.event.visibility === "internal" && <Lock size={11} className="cal-ev-chip-lock" aria-hidden="true" />}
    </button>
  );
});

/** Fila de agenda: hora · barra · título · "Área · con … · Lugar". Toda la fila abre el detalle. */
export function AgendaRow({
  o,
  areas,
  onOpen,
  trailing,
}: {
  o: Occurrence;
  areas: readonly Area[];
  onOpen: (o: Occurrence) => void;
  trailing?: React.ReactNode;
}) {
  const area = areaById(areas, o.event.responsibleAreaId);
  const withLine = participantsLine(o.event, areas);
  const multi = o.endDate !== o.date;
  return (
    <li className={`cal-agenda-item ${stateClass(o)}`} style={areaCss(colorOf(o, areas))}>
      <button type="button" className="cal-agenda-row" onClick={() => onOpen(o)} aria-label={occurrenceAria(o, areas)}>
        <span className="cal-agenda-time cal-num" aria-hidden="true">
          {o.allDay ? (
            <span>{multi ? "Varios días" : "Todo el día"}</span>
          ) : (
            <>
              <span>{o.startTime}</span>
              {o.endTime && <span className="cal-agenda-time-end">{o.endTime}</span>}
            </>
          )}
        </span>
        <span className="cal-agenda-bar" aria-hidden="true" />
        <span className="cal-agenda-main" aria-hidden="true">
          <span className="cal-agenda-title">
            <span className="cal-agenda-title-text">{o.event.title}</span>
            {o.event.visibility === "internal" && <Lock size={13} className="cal-agenda-lock" aria-hidden="true" />}
          </span>
          <span className="cal-agenda-meta">
            <span className="cal-agenda-area">{area?.name ?? "—"}</span>
            {withLine && <span> · {withLine}</span>}
            {o.event.location && <span> · {o.event.location}</span>}
          </span>
        </span>
        {o.status !== "scheduled" && (
          <span className="cal-agenda-status" aria-hidden="true">
            <OccurrenceStatusBadge status={o.status} />
          </span>
        )}
      </button>
      {trailing}
    </li>
  );
}
