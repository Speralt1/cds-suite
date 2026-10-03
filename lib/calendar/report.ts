// Reporte de calendario (doc 18 §6, 18b §4). Puro: sin React ni Firebase.
//
// - Las ocurrencias salen de lib/shared (occurrencesInRange), con el MISMO
//   orden que el resto de las vistas (compareDayOrder).
// - Nunca lleva notas internas, motivos de cancelación/archivo ni uids: las
//   filas se arman por lista blanca de campos y no tienen dónde guardarlos.
// - Las actividades archivadas nunca aparecen.
// - Columnas exactas de la misión (8). La visibilidad es filtro y se informa en
//   el encabezado (doc 18 §11.4), no es columna: va escrita junto al estado en
//   el PDF y bajo el título en pantalla.

import { occurrencesInRange } from "@/lib/shared/calendar-core";
import { compareLocal, firstOfMonth, isValidYmd, lastOfMonth, MONTH_NAMES, monthTitle, numericYmd, parseYmd, weekdayOf } from "@/lib/shared/dates";
import type { Area, AreaColor, CalendarEvent, LocalDateTime, Occurrence, OccurrenceStatus, Visibility, Ymd } from "@/lib/shared/types";

export const REPORT_STATUSES: readonly OccurrenceStatus[] = ["scheduled", "realized", "cancelled"];

export const REPORT_STATUS_LABEL: Readonly<Record<OccurrenceStatus, string>> = {
  scheduled: "Programada",
  realized: "Realizada",
  cancelled: "Cancelada",
};

export type ReportVisibility = "all" | Visibility;

export const REPORT_VISIBILITIES: readonly ReportVisibility[] = ["all", "public", "internal"];

export const REPORT_VISIBILITY_LABEL: Readonly<Record<ReportVisibility, string>> = {
  all: "Todas",
  public: "Pública",
  internal: "Solo equipo",
};

const WEEKDAY_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const FALLBACK_COLOR: AreaColor = "pizarra";

export interface CalendarReportRow {
  /** `${eventId}@${date}` (clave estable de la ocurrencia). */
  key: string;
  date: Ymd;
  /** "dom 04-10-2026" */
  dateLabel: string;
  /** "11:00–13:00" o "Todo el día". */
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
  /** No es columna: se escribe junto al estado (PDF) y bajo el título (pantalla). */
  visibility: Visibility;
  publicDescription: string;
}

export type ReportColumnKey =
  | "dateLabel"
  | "time"
  | "title"
  | "responsible"
  | "participants"
  | "location"
  | "statusLabel"
  | "publicDescription";

/** Columnas exactas del reporte (orden de la tabla y del PDF). */
export const REPORT_COLUMNS: readonly { key: ReportColumnKey; label: string }[] = [
  { key: "dateLabel", label: "Fecha" },
  { key: "time", label: "Hora" },
  { key: "title", label: "Actividad" },
  { key: "responsible", label: "Área responsable" },
  { key: "participants", label: "Participantes" },
  { key: "location", label: "Lugar" },
  { key: "statusLabel", label: "Estado" },
  { key: "publicDescription", label: "Descripción pública" },
];

export interface CalendarReportFilters {
  /** Período inclusivo. */
  from: Ymd;
  to: Ymd;
  /** Áreas elegidas (vacío = todas). Coincide como responsable o como participante. */
  areaIds?: readonly string[];
  /** Con áreas elegidas: solo cuando el área es la responsable. */
  onlyResponsible?: boolean;
  /** Estados incluidos (por defecto todos). */
  statuses?: readonly OccurrenceStatus[];
  visibility?: ReportVisibility;
}

export interface CalendarReportInput {
  events: readonly CalendarEvent[];
  areas: readonly Area[];
  /** "Ahora" en America/Santiago (deriva "Realizada"). */
  now: LocalDateTime;
  filters: CalendarReportFilters;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** "Todo el día" o "11:00–13:00". */
export function reportTimeLabel(o: Pick<Occurrence, "allDay" | "startTime" | "endTime">): string {
  if (o.allDay) return "Todo el día";
  if (!o.startTime) return "";
  return o.endTime ? `${o.startTime}–${o.endTime}` : o.startTime;
}

/** "dom 04-10-2026" */
export function reportDateLabel(date: Ymd): string {
  return `${WEEKDAY_SHORT[weekdayOf(date)]} ${numericYmd(date)}`;
}

/** Filas del reporte, en el orden único del calendario. */
export function calendarReportRows(input: CalendarReportInput): CalendarReportRow[] {
  const f = input.filters;
  const statuses = new Set(f.statuses ?? REPORT_STATUSES);
  const visibility = f.visibility ?? "all";
  const areaIds = new Set(f.areaIds ?? []);
  const onlyResponsible = f.onlyResponsible === true;
  const areaMap = new Map(input.areas.map((a) => [a.id, a] as const));

  if (!isValidYmd(f.from) || !isValidYmd(f.to) || compareLocal(f.to, f.from) < 0) return [];

  const visible = input.events.filter(
    (e) =>
      !!e &&
      e.status !== "archived" &&
      isValidYmd(e.startDate) &&
      isValidYmd(e.endDate) &&
      compareLocal(e.endDate, e.startDate) >= 0 &&
      !!e.recurrence,
  );
  return occurrencesInRange(visible, f.from, f.to, input.now, input.areas)
    .filter((o) => statuses.has(o.status))
    .filter((o) => visibility === "all" || o.event.visibility === visibility)
    .filter((o) => {
      if (!areaIds.size) return true;
      if (areaIds.has(o.event.responsibleAreaId)) return true;
      return !onlyResponsible && ids(o.event.participantAreaIds).some((id) => areaIds.has(id));
    })
    .map((o): CalendarReportRow => {
      const e = o.event;
      const responsible = areaMap.get(e.responsibleAreaId);
      return {
        key: o.key,
        date: o.date,
        dateLabel: reportDateLabel(o.date),
        time: reportTimeLabel(o),
        title: text(e.title),
        responsibleAreaId: e.responsibleAreaId,
        responsible: responsible?.name ?? "—",
        responsibleColor: responsible?.color ?? FALLBACK_COLOR,
        participants: ids(e.participantAreaIds)
          .map((id) => areaMap.get(id)?.name)
          .filter((n): n is string => !!n)
          .join(", "),
        location: text(e.location),
        status: o.status,
        statusLabel: REPORT_STATUS_LABEL[o.status],
        visibility: e.visibility === "public" ? "public" : "internal",
        publicDescription: text(e.publicDescription),
      };
    });
}

export interface CalendarReportSummary {
  total: number;
  byStatus: Record<OccurrenceStatus, number>;
  byArea: { areaId: string; name: string; color: AreaColor; count: number }[];
}

/** Conteos por estado y por área responsable (mismos números en pantalla y PDF). */
export function calendarReportSummary(rows: readonly CalendarReportRow[]): CalendarReportSummary {
  const byStatus: Record<OccurrenceStatus, number> = { scheduled: 0, realized: 0, cancelled: 0 };
  const areas = new Map<string, { areaId: string; name: string; color: AreaColor; count: number }>();
  for (const r of rows) {
    byStatus[r.status]++;
    const cur = areas.get(r.responsibleAreaId) ?? {
      areaId: r.responsibleAreaId,
      name: r.responsible,
      color: r.responsibleColor,
      count: 0,
    };
    cur.count++;
    areas.set(r.responsibleAreaId, cur);
  }
  return {
    total: rows.length,
    byStatus,
    byArea: [...areas.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es")),
  };
}

/** "42 actividades · 30 realizadas · 9 programadas · 3 canceladas" */
export function reportSummaryLabel(s: CalendarReportSummary): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    plural(s.total, "actividad", "actividades"),
    plural(s.byStatus.realized, "realizada", "realizadas"),
    plural(s.byStatus.scheduled, "programada", "programadas"),
    plural(s.byStatus.cancelled, "cancelada", "canceladas"),
  ].join(" · ");
}

/** "Pastoral 12 · Jóvenes 8" */
export function reportByAreaLabel(s: CalendarReportSummary): string {
  return s.byArea.map((a) => `${a.name} ${a.count}`).join(" · ");
}

/** ¿El período es exactamente un mes calendario? */
export function isWholeMonth(from: Ymd, to: Ymd): boolean {
  return from === firstOfMonth(from) && to === lastOfMonth(from);
}

/**
 * Período legible: "Octubre 2026", "1 al 15 de octubre de 2026",
 * "15 de octubre al 10 de noviembre de 2026" o
 * "15 de diciembre de 2026 al 10 de enero de 2027".
 */
export function reportPeriodLabel(from: Ymd, to: Ymd): string {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (isWholeMonth(from, to)) return monthTitle(a.y, a.m);
  if (from === to) return `${a.d} de ${MONTH_NAMES[a.m - 1]} de ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${a.d} al ${b.d} de ${MONTH_NAMES[b.m - 1]} de ${b.y}`;
  if (a.y === b.y) return `${a.d} de ${MONTH_NAMES[a.m - 1]} al ${b.d} de ${MONTH_NAMES[b.m - 1]} de ${b.y}`;
  return `${a.d} de ${MONTH_NAMES[a.m - 1]} de ${a.y} al ${b.d} de ${MONTH_NAMES[b.m - 1]} de ${b.y}`;
}

/**
 * Línea de filtros aplicados (siempre explícita, incluso sin filtros):
 * "Áreas: Jóvenes, Alabanza (solo como responsable) · Estados: Programada, Realizada · Visibilidad: Pública"
 * o "Áreas: todas · Estados: todos · Visibilidad: todas".
 */
export function reportFiltersLabel(f: Omit<CalendarReportFilters, "from" | "to">, areas: readonly Area[]): string {
  const areaMap = new Map(areas.map((a) => [a.id, a] as const));
  const chosen = [...new Set(f.areaIds ?? [])];
  const areaPart = chosen.length
    ? `Áreas: ${chosen.map((id) => areaMap.get(id)?.name ?? "Área sin nombre").join(", ")}${f.onlyResponsible ? " (solo como responsable)" : ""}`
    : "Áreas: todas";
  const statuses = REPORT_STATUSES.filter((s) => (f.statuses ?? REPORT_STATUSES).includes(s));
  const statusPart =
    statuses.length === REPORT_STATUSES.length
      ? "Estados: todos"
      : `Estados: ${statuses.map((s) => REPORT_STATUS_LABEL[s]).join(", ") || "ninguno"}`;
  const visibility = f.visibility ?? "all";
  const visibilityPart = `Visibilidad: ${visibility === "all" ? "todas" : REPORT_VISIBILITY_LABEL[visibility]}`;
  return [areaPart, statusPart, visibilityPart].join(" · ");
}

/** Cantidad de filtros distintos del valor por defecto (para "Filtros (n)"). */
export function activeFilterCount(f: Omit<CalendarReportFilters, "from" | "to">): number {
  const statuses = f.statuses ?? REPORT_STATUSES;
  return (
    ((f.areaIds ?? []).length ? 1 : 0) +
    (REPORT_STATUSES.every((s) => statuses.includes(s)) ? 0 : 1) +
    ((f.visibility ?? "all") === "all" ? 0 : 1)
  );
}
