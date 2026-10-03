"use client";

// Reportes › Calendario (doc 18 §6, 18b §4). Datos reales (Firestore vía
// useCalendarEvents/useAreas), filtros de período, área (+ solo como
// responsable), estado y visibilidad; resumen, tabla responsive y "Descargar
// PDF" (generado en el navegador; jspdf se carga recién al hacer clic).
// Nunca muestra notas internas ni motivos: las filas no los traen.

import { useId, useMemo, useState } from "react";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  CloudOff,
  Download,
  FileX2,
  Globe,
  Lock,
  SlidersHorizontal,
} from "lucide-react";
import { useOptionalAccess } from "@/lib/auth/access-provider";
import { useToast } from "@/components/layout/notice";
import { useAreas } from "@/lib/calendar/areas-client";
import { activeAreas, AREA_PALETTE, areaVar, sortAreas } from "@/lib/calendar/areas";
import { useCalendarEvents } from "@/lib/calendar/events-client";
import { useSantiagoNow } from "@/lib/calendar/use-now";
import {
  activeFilterCount,
  calendarReportRows,
  calendarReportSummary,
  REPORT_STATUS_LABEL,
  REPORT_STATUSES,
  REPORT_VISIBILITIES,
  REPORT_VISIBILITY_LABEL,
  reportByAreaLabel,
  reportFiltersLabel,
  reportPeriodLabel,
  reportSummaryLabel,
  type CalendarReportRow,
  type ReportVisibility,
} from "@/lib/calendar/report";
import { buildCalendarPdf, calendarPdfFileName, calendarPdfLayout, type CalendarReportMeta } from "@/lib/calendar/report-pdf";
import { addMonthsClamped, compareLocal, firstOfMonth, isValidYmd, lastOfMonth, localNow, parseYmd } from "@/lib/shared/dates";
import type { AreaColor, OccurrenceStatus, Ymd } from "@/lib/shared/types";

const MAX_RANGE_MONTHS = 12;
export const PDF_EMPTY_HELP = "No hay actividades con estos filtros para descargar.";

type PeriodMode = "month" | "range";

/** Valida un rango personalizado. Devuelve el período o un mensaje. */
export function validateReportRange(from: string, to: string): { from: Ymd; to: Ymd } | { error: string } {
  if (!isValidYmd(from) || !isValidYmd(to)) return { error: "Elige una fecha de inicio y una de término." };
  if (compareLocal(to, from) < 0) return { error: "La fecha de término debe ser igual o posterior a la de inicio." };
  if (compareLocal(to, addMonthsClamped(from, MAX_RANGE_MONTHS)) > 0)
    return { error: `El rango puede abarcar hasta ${MAX_RANGE_MONTHS} meses.` };
  return { from, to };
}

function Swatch({ color }: { color: AreaColor }) {
  return <span className="cal-rep-swatch" style={{ background: areaVar(color, "swatch") }} aria-hidden="true" />;
}

function StatusBadge({ status }: { status: OccurrenceStatus }) {
  const Icon = status === "cancelled" ? Ban : status === "realized" ? CircleCheck : Clock;
  return (
    <span className={`cal-rep-badge is-${status}`}>
      <Icon size={13} aria-hidden="true" /> {REPORT_STATUS_LABEL[status]}
    </span>
  );
}

/** Ícono de visibilidad: nombre accesible y tooltip "Pública" / "Solo equipo". */
export function VisibilityMark({ row }: { row: Pick<CalendarReportRow, "visibility"> }) {
  const label = REPORT_VISIBILITY_LABEL[row.visibility];
  return (
    <span className="cal-rep-vis" role="img" aria-label={label} title={label}>
      {row.visibility === "public" ? <Globe size={13} aria-hidden="true" /> : <Lock size={13} aria-hidden="true" />}
    </span>
  );
}

function ReportSkeleton() {
  return (
    <div className="panel cal-rep-skeleton" aria-busy="true">
      <p className="cal-sr" role="status">
        Cargando actividades…
      </p>
      <div className="cal-rep-skel is-strip" aria-hidden="true" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="cal-rep-skel" aria-hidden="true" />
      ))}
    </div>
  );
}

export function CalendarReport() {
  const { today, now } = useSantiagoNow();
  const access = useOptionalAccess();
  const { toast } = useToast();
  const { areas, loading: areasLoading, error: areasError } = useAreas();

  const [mode, setMode] = useState<PeriodMode>("month");
  const [month, setMonth] = useState<Ymd | null>(null);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [areaId, setAreaId] = useState("");
  const [onlyResponsible, setOnlyResponsible] = useState(false);
  const [statuses, setStatuses] = useState<OccurrenceStatus[]>([...REPORT_STATUSES]);
  const [visibility, setVisibility] = useState<ReportVisibility>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const ids = useId();

  const monthStart = month ?? firstOfMonth(today);
  const range = mode === "range" ? validateReportRange(rangeFrom, rangeTo) : null;
  const period: { from: Ymd; to: Ymd } | null =
    mode === "month" ? { from: monthStart, to: lastOfMonth(monthStart) } : range && "from" in range ? range : null;
  const rangeError = range && "error" in range ? range.error : "";

  const periodFrom = period?.from ?? "";
  const periodTo = period?.to ?? "";

  const { events, loading, error } = useCalendarEvents(periodFrom || monthStart);

  const filters = useMemo(
    () => ({ areaIds: areaId ? [areaId] : [], onlyResponsible: !!areaId && onlyResponsible, statuses, visibility }),
    [areaId, onlyResponsible, statuses, visibility],
  );
  const rows = useMemo(
    () =>
      periodFrom && periodTo
        ? calendarReportRows({ events, areas, now, filters: { ...filters, from: periodFrom, to: periodTo } })
        : [],
    [events, areas, now, filters, periodFrom, periodTo],
  );
  const summary = useMemo(() => calendarReportSummary(rows), [rows]);
  const filtersLabel = reportFiltersLabel(filters, areas);
  const periodLabel = periodFrom && periodTo ? reportPeriodLabel(periodFrom, periodTo) : "";
  const activeFilters = activeFilterCount(filters);
  const meta: CalendarReportMeta = {
    periodLabel,
    filtersLabel,
    generatedBy: access?.displayName?.trim() || "Usuario de CDS",
    generatedAt: now,
    summaryLabel: reportSummaryLabel(summary),
    byAreaLabel: reportByAreaLabel(summary) || undefined,
  };
  // Mismo cálculo que el PDF (sin jspdf): cuántas páginas tendrá.
  const pageCount = rows.length ? calendarPdfLayout(rows, meta).pageCount : 0;

  const sortedAreas = useMemo(() => sortAreas(areas), [areas]);
  const activeList = useMemo(() => activeAreas(sortedAreas), [sortedAreas]);
  const inactiveList = sortedAreas.filter((a) => !a.active);

  const clear = () => {
    setAreaId("");
    setOnlyResponsible(false);
    setStatuses([...REPORT_STATUSES]);
    setVisibility("all");
  };

  const switchMode = (next: PeriodMode) => {
    if (next === mode) return;
    if (next === "range" && !rangeFrom && !rangeTo) {
      setRangeFrom(monthStart);
      setRangeTo(lastOfMonth(monthStart));
    }
    setMode(next);
  };

  const canDownload = !!period && rows.length > 0 && !loading && !error && !areasError;
  const download = async () => {
    if (!canDownload || busy || !period) return;
    setBusy(true);
    setPdfError("");
    try {
      const pdf = await buildCalendarPdf(
        rows,
        { ...meta, generatedAt: localNow(Date.now()) },
        { swatchHex: (c) => (AREA_PALETTE[c] ?? AREA_PALETTE.pizarra).swatch },
      );
      pdf.save(calendarPdfFileName(period.from, period.to));
      toast("PDF descargado.");
    } catch {
      setPdfError("No pudimos generar el PDF. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const loadError = error || areasError;
  const isLoading = !loadError && (loading || areasLoading);
  const { y: monthY, m: monthM } = parseYmd(monthStart);

  let body: React.ReactNode;
  if (loadError) {
    body = (
      <div className="panel empty cal-rep-state" role="alert">
        <CloudOff size={24} aria-hidden="true" className="cal-rep-state-icon" />
        <h3>No pudimos cargar el reporte</h3>
        <p>{loadError}</p>
        <button type="button" className="button-secondary" onClick={() => window.location.reload()}>
          Reintentar
        </button>
      </div>
    );
  } else if (rangeError) {
    body = (
      <div className="panel empty cal-rep-state">
        <h3>Revisa el período</h3>
        <p>{rangeError}</p>
      </div>
    );
  } else if (isLoading) {
    body = <ReportSkeleton />;
  } else {
    body = (
      <section className="panel cal-rep-panel" aria-labelledby={`${ids}-results`}>
        <h3 id={`${ids}-results`} className="cal-sr">
          Resultados de {periodLabel}
        </h3>
        <div className="cal-rep-summary">
          <p>
            <strong>
              {summary.total} {summary.total === 1 ? "actividad" : "actividades"}
            </strong>{" "}
            · {summary.byStatus.realized} {summary.byStatus.realized === 1 ? "realizada" : "realizadas"} ·{" "}
            {summary.byStatus.scheduled} {summary.byStatus.scheduled === 1 ? "programada" : "programadas"} ·{" "}
            {summary.byStatus.cancelled} {summary.byStatus.cancelled === 1 ? "cancelada" : "canceladas"}
          </p>
          {summary.byArea.length > 0 && (
            <p className="cal-rep-byarea">
              <span className="cal-rep-muted">Por área:</span>
              {summary.byArea.map((a) => (
                <span key={a.areaId} className="cal-rep-area">
                  <Swatch color={a.color} />
                  {a.name} <span className="cal-rep-num">{a.count}</span>
                </span>
              ))}
            </p>
          )}
          <p className="cal-rep-muted cal-rep-applied">Filtros aplicados: {filtersLabel}</p>
        </div>
        {rows.length === 0 ? (
          <div className="empty cal-rep-state">
            <FileX2 size={24} aria-hidden="true" className="cal-rep-state-icon" />
            <h3>No hay actividades con estos filtros.</h3>
            {activeFilters > 0 && (
              <button type="button" className="button-secondary" onClick={clear}>
                Limpiar filtros
              </button>
            )}
          </div>
        ) : (
          <div className="cal-rep-cq">
            <table className="cal-rep-table">
              <caption className="cal-sr">
                Actividades de {periodLabel}. {filtersLabel}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="c-date">Fecha</th>
                  <th scope="col" className="c-time">Hora</th>
                  <th scope="col" className="c-title">Actividad</th>
                  <th scope="col" className="c-resp">Área responsable</th>
                  <th scope="col" className="c-part">Participantes</th>
                  <th scope="col" className="c-loc">Lugar</th>
                  <th scope="col" className="c-status">Estado</th>
                  <th scope="col" className="c-desc">Descripción pública</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={r.status === "cancelled" ? "is-cancelled" : undefined}>
                    <td className="c-date cal-rep-num">{r.dateLabel}</td>
                    <td className="c-time cal-rep-num">{r.time}</td>
                    <td className="c-title">
                      <span className="cal-rep-title">
                        <VisibilityMark row={r} />
                        <span className="cal-rep-title-text">{r.title}</span>
                      </span>
                      {r.participants && <span className="cal-rep-with">con {r.participants}</span>}
                      {r.location && <span className="cal-rep-where">{r.location}</span>}
                    </td>
                    <td className="c-resp">
                      <span className="cal-rep-resp">
                        <Swatch color={r.responsibleColor} />
                        {r.responsible}
                      </span>
                    </td>
                    <td className="c-part">{r.participants || "—"}</td>
                    <td className="c-loc">{r.location || "—"}</td>
                    <td className="c-status">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="c-desc">{r.publicDescription || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="cal-rep-list" aria-label={`Actividades de ${periodLabel}`}>
              {rows.map((r) => (
                <li key={r.key} className={`cal-rep-item${r.status === "cancelled" ? " is-cancelled" : ""}`}>
                  <div className="cal-rep-item-top">
                    <span className="cal-rep-num">
                      {r.dateLabel} · {r.time}
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="cal-rep-title">
                    <VisibilityMark row={r} />
                    <span className="cal-rep-title-text">{r.title}</span>
                  </div>
                  <span className="cal-rep-resp">
                    <Swatch color={r.responsibleColor} />
                    {r.responsible}
                    {r.participants && <span className="cal-rep-muted"> · con {r.participants}</span>}
                  </span>
                  {r.location && <span className="cal-rep-muted">{r.location}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }

  const helpId = `${ids}-pdf-help`;

  return (
    <div className="cal-rep">
      <header className="finance-page-header cal-rep-header">
        <div className="finance-page-title">
          <h2>Reporte de calendario</h2>
          <p>Actividades por período, área, estado y visibilidad.</p>
        </div>
        <div className="cal-rep-download">
          <button
            type="button"
            className="button-secondary"
            onClick={download}
            aria-disabled={!canDownload || busy}
            aria-describedby={helpId}
          >
            <Download size={16} aria-hidden="true" /> {busy ? "Generando…" : "Descargar PDF"}
          </button>
          <p id={helpId} className="cal-rep-help">
            {canDownload
              ? `A4 horizontal · ${pageCount} ${pageCount === 1 ? "página" : "páginas"} · se genera en tu equipo.`
              : isLoading
                ? "Cargando actividades…"
                : PDF_EMPTY_HELP}
          </p>
        </div>
      </header>
      {pdfError && (
        <p role="alert" className="notice error">
          {pdfError}
        </p>
      )}

      <div className={`cal-rep-filters${filtersOpen ? " is-open" : ""}`}>
        <div className="cal-rep-filters-top">
          <div className="cal-rep-period">
            <div className="cal-rep-mode" role="group" aria-label="Tipo de período">
              <button type="button" aria-pressed={mode === "month"} onClick={() => switchMode("month")}>
                Mes
              </button>
              <button type="button" aria-pressed={mode === "range"} onClick={() => switchMode("range")}>
                Rango
              </button>
            </div>
            {mode === "month" ? (
              <div className="cal-rep-stepper" role="group" aria-label="Mes del reporte">
                <button
                  type="button"
                  aria-label="Mes anterior"
                  onClick={() => setMonth(firstOfMonth(addMonthsClamped(monthStart, -1)))}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <span className="cal-rep-stepper-label" aria-live="polite">
                  {reportPeriodLabel(monthStart, lastOfMonth(monthStart))}
                  <span className="cal-sr"> ({monthY}-{String(monthM).padStart(2, "0")})</span>
                </span>
                <button
                  type="button"
                  aria-label="Mes siguiente"
                  onClick={() => setMonth(firstOfMonth(addMonthsClamped(monthStart, 1)))}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="cal-rep-range">
                <label className="cal-rep-field">
                  <span>Desde</span>
                  <input
                    type="date"
                    className="form-input"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    aria-invalid={!!rangeError}
                  />
                </label>
                <label className="cal-rep-field">
                  <span>Hasta</span>
                  <input
                    type="date"
                    className="form-input"
                    value={rangeTo}
                    min={rangeFrom || undefined}
                    onChange={(e) => setRangeTo(e.target.value)}
                    aria-invalid={!!rangeError}
                  />
                </label>
              </div>
            )}
          </div>
          <button
            type="button"
            className="button-secondary cal-rep-filters-btn"
            aria-expanded={filtersOpen}
            aria-controls={`${ids}-filters`}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" /> Filtros{activeFilters ? ` (${activeFilters})` : ""}
          </button>
        </div>

        <div id={`${ids}-filters`} className="cal-rep-filters-body">
          <div className="cal-rep-field">
            <label htmlFor={`${ids}-area`}>Área</label>
            <select
              id={`${ids}-area`}
              className="form-input"
              value={areaId}
              onChange={(e) => {
                setAreaId(e.target.value);
                if (!e.target.value) setOnlyResponsible(false);
              }}
            >
              <option value="">Todas las áreas</option>
              {activeList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              {inactiveList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} (inactiva)
                </option>
              ))}
            </select>
            <label className="cal-rep-check">
              <input
                type="checkbox"
                checked={onlyResponsible}
                disabled={!areaId}
                onChange={(e) => setOnlyResponsible(e.target.checked)}
              />
              <span>Solo como responsable</span>
            </label>
          </div>

          <fieldset className="cal-rep-group">
            <legend>Estado</legend>
            <div className="cal-rep-checks">
              {REPORT_STATUSES.map((s) => (
                <label key={s} className="cal-rep-check">
                  <input
                    type="checkbox"
                    checked={statuses.includes(s)}
                    onChange={(e) =>
                      setStatuses(
                        e.target.checked
                          ? REPORT_STATUSES.filter((x) => x === s || statuses.includes(x))
                          : statuses.filter((x) => x !== s),
                      )
                    }
                  />
                  <span>{REPORT_STATUS_LABEL[s]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="cal-rep-group">
            <legend>Visibilidad</legend>
            <div className="cal-rep-mode" role="group" aria-label="Visibilidad">
              {REPORT_VISIBILITIES.map((v) => (
                <button key={v} type="button" aria-pressed={visibility === v} onClick={() => setVisibility(v)}>
                  {REPORT_VISIBILITY_LABEL[v]}
                </button>
              ))}
            </div>
          </fieldset>

          {activeFilters > 0 && (
            <button type="button" className="button-ghost cal-rep-clear" onClick={clear}>
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {body}
      <p className="cal-rep-help cal-rep-foot">
        El reporte y el PDF no incluyen notas internas, motivos de cancelación ni actividades eliminadas.
      </p>
    </div>
  );
}
