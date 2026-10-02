// Reporte de calendario (16c §G / 16a G). Nunca incluye notas internas ni
// motivos de cancelación; las archivadas no aparecen.

import { areaById } from "./areas";
import { occurrenceTimeLabel, occurrencesInRange } from "./calendar";
import { numericYmd, weekdayOf } from "./dates";
import type { Area, AreaColor, CalendarEvent, LocalDateTime, OccurrenceStatus, Ymd } from "./types";

export const OCCURRENCE_STATUS_LABEL: Record<OccurrenceStatus, string> = {
  programada: "Programada",
  realizada: "Realizada",
  cancelada: "Cancelada",
};

export const VISIBILITY_LABEL = { public: "Pública", team: "Solo equipo" } as const;

const WD = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export interface CalendarReportRow {
  key: string;
  date: Ymd;
  /** "dom 04-10-2026" */
  dateLabel: string;
  /** "11:00–13:00" o "Todo el día" */
  time: string;
  title: string;
  responsibleAreaId: string;
  responsible: string;
  responsibleColor: AreaColor;
  /** Nombres separados por coma ("" si no hay). */
  participants: string;
  location: string;
  status: OccurrenceStatus;
  statusLabel: string;
  visibility: "public" | "team";
  visibilityLabel: string;
  publicDescription: string;
}

/** Columnas exactas del reporte (orden de la tabla y del PDF). */
export const REPORT_COLUMNS: readonly { key: keyof CalendarReportRow; label: string }[] = [
  { key: "dateLabel", label: "Fecha" },
  { key: "time", label: "Hora" },
  { key: "title", label: "Actividad" },
  { key: "responsible", label: "Área responsable" },
  { key: "participants", label: "Participantes" },
  { key: "location", label: "Lugar" },
  { key: "statusLabel", label: "Estado" },
  { key: "visibilityLabel", label: "Visibilidad" },
  { key: "publicDescription", label: "Descripción pública" },
];

export interface CalendarReportFilters {
  events: readonly CalendarEvent[];
  areas: readonly Area[];
  from: Ymd;
  to: Ymd;
  /** Área (responsable o participante; con onlyResponsible, solo responsable). */
  areaId?: string;
  onlyResponsible: boolean;
  statuses: readonly OccurrenceStatus[];
  visibility: "all" | "public" | "team";
  now: LocalDateTime;
}

export function calendarReportRows(i: CalendarReportFilters): CalendarReportRow[] {
  return occurrencesInRange(i.events, i.from, i.to, i.now)
    .filter((o) => i.statuses.includes(o.status))
    .filter((o) => i.visibility === "all" || o.event.visibility === i.visibility)
    .filter(
      (o) =>
        !i.areaId ||
        o.event.responsibleAreaId === i.areaId ||
        (!i.onlyResponsible && o.event.participantAreaIds.includes(i.areaId)),
    )
    .map((o) => {
      const e = o.event;
      const resp = areaById(i.areas, e.responsibleAreaId);
      return {
        key: o.key,
        date: o.date,
        dateLabel: `${WD[weekdayOf(o.date)]} ${numericYmd(o.date)}`,
        time: occurrenceTimeLabel(o),
        title: e.title,
        responsibleAreaId: e.responsibleAreaId,
        responsible: resp?.name ?? "—",
        responsibleColor: resp?.color ?? "pizarra",
        participants: e.participantAreaIds
          .map((id) => areaById(i.areas, id)?.name)
          .filter(Boolean)
          .join(", "),
        location: e.location ?? "",
        status: o.status,
        statusLabel: OCCURRENCE_STATUS_LABEL[o.status],
        visibility: e.visibility,
        visibilityLabel: VISIBILITY_LABEL[e.visibility],
        publicDescription: e.publicDescription ?? "",
      };
    });
}

/** Conteos por estado y por área responsable (encabezado del reporte). */
export function calendarReportSummary(rows: readonly CalendarReportRow[]): {
  total: number;
  byStatus: Record<OccurrenceStatus, number>;
  byArea: { areaId: string; name: string; count: number }[];
} {
  const byStatus: Record<OccurrenceStatus, number> = { programada: 0, realizada: 0, cancelada: 0 };
  const areas = new Map<string, { areaId: string; name: string; count: number }>();
  for (const r of rows) {
    byStatus[r.status]++;
    const cur = areas.get(r.responsibleAreaId) ?? { areaId: r.responsibleAreaId, name: r.responsible, count: 0 };
    cur.count++;
    areas.set(r.responsibleAreaId, cur);
  }
  return { total: rows.length, byStatus, byArea: [...areas.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es")) };
}
