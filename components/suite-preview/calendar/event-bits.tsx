"use client";

// Piezas de render de una actividad (16b §4.2): chip de mes, fila de agenda y
// badges de estado/visibilidad. El color SIEMPRE es el del área responsable y
// siempre va acompañado del nombre (o del aria-label en el chip de mes).

import { forwardRef } from "react";
import { Ban, CircleCheck, Clock, Globe, Lock, type LucideIcon } from "lucide-react";
import { areaById } from "@/lib/suite-preview/areas";
import type { Area, Occurrence } from "@/lib/suite-preview/types";
import { areaStyle } from "../primitives";
import { occurrenceAria, participantsLine } from "./labels";

type BadgeTone = "info" | "neutral" | "warning";

export function SxBadge({ icon: Icon, text, tone, title }: { icon: LucideIcon; text: string; tone: BadgeTone; title?: string }) {
  return (
    <span className={`fx-badge fx-tone-${tone}`} title={title}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {text}
    </span>
  );
}

export function OccurrenceStatusBadge({ status }: { status: Occurrence["status"] }) {
  if (status === "cancelada") return <SxBadge icon={Ban} text="Cancelada" tone="neutral" />;
  if (status === "realizada") return <SxBadge icon={CircleCheck} text="Realizada" tone="neutral" />;
  return <SxBadge icon={Clock} text="Programada" tone="info" />;
}

export function VisibilityBadge({ visibility }: { visibility: "public" | "team" }) {
  return visibility === "public" ? (
    <SxBadge icon={Globe} text="Pública" tone="info" />
  ) : (
    <SxBadge icon={Lock} text="Solo equipo" tone="neutral" />
  );
}

function stateClass(o: Occurrence): string {
  return o.status === "cancelada" ? "is-cancelled" : o.status === "realizada" ? "is-done" : "";
}

/** Chip de mes (desktop): "11:00 Culto dominical" sobre el -soft del responsable. */
export const MonthChip = forwardRef<
  HTMLButtonElement,
  { o: Occurrence; areas: readonly Area[]; onOpen: (o: Occurrence) => void; showTime?: boolean; continuation?: boolean }
>(function MonthChip({ o, areas, onOpen, showTime = true, continuation }, ref) {
  const area = areaById(areas, o.event.responsibleAreaId);
  const aria = occurrenceAria(o, areas);
  return (
    <button
      ref={ref}
      type="button"
      className={`sx-ev-chip ${stateClass(o)} ${continuation ? "is-cont" : ""}`}
      style={areaStyle(area?.color ?? "pizarra")}
      aria-label={aria}
      title={aria}
      onClick={() => onOpen(o)}
    >
      {o.status === "cancelada" && <Ban size={11} className="sx-ev-chip-icon" aria-hidden="true" />}
      {showTime && !o.allDay && !continuation && <span className="sx-ev-chip-time">{o.startTime}</span>}
      <span className="sx-ev-chip-title">{o.event.title}</span>
      {o.event.visibility === "team" && <Lock size={11} className="sx-ev-chip-lock" aria-hidden="true" />}
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
    <li className={`sx-agenda-item ${stateClass(o)}`} style={areaStyle(area?.color ?? "pizarra")}>
      <button type="button" className="sx-agenda-row" onClick={() => onOpen(o)} aria-label={occurrenceAria(o, areas)}>
        <span className="sx-agenda-time fx-num" aria-hidden="true">
          {o.allDay ? (
            <span>{multi ? "Varios días" : "Todo el día"}</span>
          ) : (
            <>
              <span>{o.startTime}</span>
              {o.endTime && <span className="sx-agenda-time-end">{o.endTime}</span>}
            </>
          )}
        </span>
        <span className="sx-agenda-bar" aria-hidden="true" />
        <span className="sx-agenda-main" aria-hidden="true">
          <span className="sx-agenda-title">
            <span className="sx-agenda-title-text">{o.event.title}</span>
            {o.event.visibility === "team" && <Lock size={13} className="sx-agenda-lock" aria-hidden="true" />}
          </span>
          <span className="sx-agenda-meta">
            <span className="sx-agenda-area">{area?.name ?? "—"}</span>
            {withLine && <span> · {withLine}</span>}
            {o.event.location && <span> · {o.event.location}</span>}
          </span>
        </span>
        {o.status !== "programada" && (
          <span className="sx-agenda-status" aria-hidden="true">
            <OccurrenceStatusBadge status={o.status} />
          </span>
        )}
      </button>
      {trailing}
    </li>
  );
}
