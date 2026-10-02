"use client";

// /preview/reportes/calendario (16b §7.1): filtros, franja de resumen, tabla
// (desktop, con container queries) / lista (móvil), "Descargar PDF" (jspdf local,
// A4 horizontal, rótulo de vista previa, sin notas internas) y una vista previa
// visual de la primera página del PDF.

import { useId, useMemo, useState } from "react";
import { Ban, ChevronLeft, ChevronRight, CircleCheck, Clock, Download, FileX2, Globe, Lock, SlidersHorizontal } from "lucide-react";
import { activeAreas, AREA_PALETTE, areaById } from "@/lib/suite-preview/areas";
import { DEMO_NOW, DEMO_TODAY } from "@/lib/suite-preview/clock";
import { addMonthsClamped, firstOfMonth, lastOfMonth, monthTitle, numericYmd, parseYmd } from "@/lib/suite-preview/dates";
import { calendarReportRows, calendarReportSummary, OCCURRENCE_STATUS_LABEL, type CalendarReportRow } from "@/lib/suite-preview/report";
import { calendarPdfLayout, PDF_GEOMETRY, type CalendarPdfLayout, type CalendarReportMeta } from "@/lib/suite-preview/report-pdf";
import type { OccurrenceStatus } from "@/lib/suite-preview/types";
import { EmptyState, ErrorState, Panel, Sheet, Skeleton, SkeletonRows } from "@/components/finance-preview/ui";
import { AreaSwatch, PageHeader } from "../primitives";
import { useSuite } from "../provider";
import { replaceQueryParam, useQueryParam } from "../use-query";
import { SxBadge } from "../calendar/event-bits";
import { shortDay } from "../calendar/labels";
import { ReportSections, useBothReportSections } from "./report-sections";

const ALL_STATUSES: OccurrenceStatus[] = ["programada", "realizada", "cancelada"];
type Vis = "all" | "public" | "team";
const VIS_LABEL: Record<Vis, string> = { all: "Todas", public: "Pública", team: "Solo equipo" };

function StatusCell({ s }: { s: OccurrenceStatus }) {
  if (s === "cancelada") return <SxBadge icon={Ban} text="Cancelada" tone="neutral" />;
  if (s === "realizada") return <SxBadge icon={CircleCheck} text="Realizada" tone="neutral" />;
  return <SxBadge icon={Clock} text="Programada" tone="info" />;
}

function VisIcon({ v }: { v: "public" | "team" }) {
  return v === "public" ? <Globe size={13} aria-hidden="true" /> : <Lock size={13} aria-hidden="true" />;
}

/** "vie 9 oct" */
const rowDay = (r: CalendarReportRow) => shortDay(r.date);

export function CalendarReport() {
  const { state, profile, simulate, toast } = useSuite();
  const estado = useQueryParam("estado");
  const [month, setMonth] = useState(firstOfMonth(DEMO_TODAY));
  const [areaId, setAreaId] = useState("");
  const [onlyResponsible, setOnlyResponsible] = useState(false);
  const [statuses, setStatuses] = useState<OccurrenceStatus[]>(ALL_STATUSES);
  const [visibility, setVisibility] = useState<Vis>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const periodId = useId();

  const areas = state.areas;
  const { y, m } = parseYmd(month);
  const periodLabel = monthTitle(y, m);
  const rows = useMemo(
    () =>
      estado === "vacio"
        ? []
        : calendarReportRows({
            events: state.events,
            areas,
            from: month,
            to: lastOfMonth(month),
            areaId: areaId || undefined,
            onlyResponsible,
            statuses,
            visibility,
            now: DEMO_NOW,
          }),
    [estado, state.events, areas, month, areaId, onlyResponsible, statuses, visibility],
  );
  const summary = calendarReportSummary(rows);
  const area = areaById(areas, areaId);
  const filtersLabel = [
    area ? `Área: ${area.name}${onlyResponsible ? " (solo responsable)" : ""}` : "Áreas: todas",
    statuses.length === 3 ? "Estados: todos" : `Estados: ${statuses.map((s) => OCCURRENCE_STATUS_LABEL[s]).join(", ") || "ninguno"}`,
    `Visibilidad: ${VIS_LABEL[visibility].toLocaleLowerCase("es")}`,
  ].join(" · ");
  const activeFilters = (areaId ? 1 : 0) + (statuses.length !== 3 ? 1 : 0) + (visibility !== "all" ? 1 : 0);
  const summaryLabel = `${summary.total} ${summary.total === 1 ? "actividad" : "actividades"} · ${summary.byStatus.realizada} realizadas · ${summary.byStatus.programada} programadas · ${summary.byStatus.cancelada} canceladas`;
  const byAreaLabel = summary.byArea.map((a) => `${a.name} ${a.count}`).join(" · ");
  const both = useBothReportSections();
  const meta: CalendarReportMeta = {
    periodLabel,
    filtersLabel,
    generatedBy: profile?.displayName ?? "Usuario de CDS",
    generatedOn: `${numericYmd(DEMO_TODAY)} ${DEMO_NOW.slice(11, 16)}`,
    summaryLabel,
    byAreaLabel,
  };
  // Mismo cálculo que el PDF (barato: decenas de filas).
  const layout = calendarPdfLayout(rows, meta);
  const clear = () => {
    setAreaId("");
    setOnlyResponsible(false);
    setStatuses(ALL_STATUSES);
    setVisibility("all");
  };

  const download = async () => {
    setBusy(true);
    try {
      const { buildCalendarPdf, calendarPdfFileName } = await import("@/lib/suite-preview/report-pdf");
      const pdf = await buildCalendarPdf(rows, meta);
      pdf.save(calendarPdfFileName(month.slice(0, 7)));
      simulate(`PDF generado en tu equipo (${pdf.pageCount} ${pdf.pageCount === 1 ? "página" : "páginas"})`);
    } catch {
      toast("No pudimos generar el PDF. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  /** Controles de filtro; `prefix` evita ids duplicados entre la fila desktop y el sheet. */
  const areaField = (prefix: string) => (
    <div className="sx-field sx-rep-field">
      <label htmlFor={`${prefix}-area`}>Área</label>
      <select id={`${prefix}-area`} className="fx-select" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
        <option value="">Todas las áreas</option>
        {activeAreas(areas).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
        {areas
          .filter((a) => !a.active)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} (inactiva)
            </option>
          ))}
      </select>
    </div>
  );
  const responsibleSwitch = (
    <label className="sx-switch sx-rep-switch">
      <input type="checkbox" role="switch" checked={onlyResponsible} disabled={!areaId} onChange={(e) => setOnlyResponsible(e.target.checked)} />
      <span>Solo como responsable</span>
    </label>
  );
  const statusField = (
    <fieldset className="sx-cal-fieldset sx-rep-group">
      <legend className="sx-legend">Estado</legend>
      <div className="sx-rep-checks">
        {ALL_STATUSES.map((s) => (
          <label key={s} className="sx-cal-check">
            <input
              type="checkbox"
              checked={statuses.includes(s)}
              onChange={(e) => setStatuses(e.target.checked ? ALL_STATUSES.filter((x) => x === s || statuses.includes(x)) : statuses.filter((x) => x !== s))}
            />
            <span>{OCCURRENCE_STATUS_LABEL[s]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  const visibilityField = (
    <fieldset className="sx-cal-fieldset sx-rep-group">
      <legend className="sx-legend">Visibilidad</legend>
      <div className="fx-segmented sx-rep-vis" role="group" aria-label="Visibilidad">
        {(Object.keys(VIS_LABEL) as Vis[]).map((v) => (
          <button key={v} type="button" aria-pressed={visibility === v} onClick={() => setVisibility(v)}>
            {VIS_LABEL[v]}
          </button>
        ))}
      </div>
    </fieldset>
  );

  const stepper = (
    <div className="sx-rep-period">
      <span className="sx-rep-label" id={periodId}>
        Período
      </span>
      <div className="fx-stepper sx-rep-stepper" role="group" aria-labelledby={periodId}>
        <button type="button" aria-label="Mes anterior" onClick={() => setMonth(firstOfMonth(addMonthsClamped(month, -1)))}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <span className="fx-stepper-label" aria-live="polite">
          {periodLabel}
        </span>
        <button type="button" aria-label="Mes siguiente" onClick={() => setMonth(firstOfMonth(addMonthsClamped(month, 1)))}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (estado === "cargando") {
    body = (
      <Panel>
        <Skeleton h={18} w={360} />
        <div style={{ marginTop: 16 }}>
          <SkeletonRows rows={8} h={44} />
        </div>
      </Panel>
    );
  } else if (estado === "error") {
    body = (
      <Panel>
        <ErrorState title="No pudimos cargar el reporte" onRetry={() => replaceQueryParam("estado", null)} />
      </Panel>
    );
  } else {
    body = (
      <div className="sx-rep-layout">
        <Panel flush className="sx-rep-panel">
          <div className="sx-rep-summary">
            <p>
              <strong>
                {summary.total} {summary.total === 1 ? "actividad" : "actividades"}
              </strong>{" "}
              · {summary.byStatus.realizada} realizadas · {summary.byStatus.programada} programadas · {summary.byStatus.cancelada} canceladas
            </p>
            {summary.byArea.length > 0 && (
              <p className="sx-rep-byarea">
                <span className="fx-help-13">Por área:</span>
                {summary.byArea.map((a) => {
                  const ar = areaById(areas, a.areaId);
                  return (
                    <span key={a.areaId} className="sx-rep-area">
                      {ar && <AreaSwatch color={ar.color} size={10} shape="square" />}
                      {a.name} <span className="fx-num">{a.count}</span>
                    </span>
                  );
                })}
              </p>
            )}
          </div>
          {rows.length === 0 ? (
            <EmptyState
              icon={FileX2}
              title="No hay actividades con estos filtros."
              action={
                activeFilters > 0 ? (
                  <button type="button" className="fx-btn fx-btn-secondary" onClick={clear}>
                    Limpiar filtros
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="sx-rep-cq">
              <table className="fx-table sx-rep-table">
                <caption className="fx-sr">
                  Actividades de {periodLabel}. {filtersLabel}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="c-date">Fecha</th>
                    <th scope="col" className="c-time">Hora</th>
                    <th scope="col" className="c-title">Actividad</th>
                    <th scope="col" className="c-resp">Responsable</th>
                    <th scope="col" className="c-part">Participantes</th>
                    <th scope="col" className="c-loc">Lugar</th>
                    <th scope="col" className="c-status">Estado</th>
                    <th scope="col" className="c-vis">Visibilidad</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const ar = areaById(areas, r.responsibleAreaId);
                    return (
                      <tr key={r.key} className={r.status === "cancelada" ? "is-cancelled" : ""}>
                        <td className="c-date fx-num">{rowDay(r)}</td>
                        <td className="c-time fx-num">{r.time}</td>
                        <td className="c-title">
                          <span className="sx-rep-title">
                            <span className="sx-rep-vis-inline" title={r.visibilityLabel}>
                              <VisIcon v={r.visibility} />
                              <span className="fx-sr">{r.visibilityLabel}</span>
                            </span>
                            <span className="sx-rep-title-text">{r.title}</span>
                          </span>
                          {r.participants && <span className="sx-rep-with">con {r.participants}</span>}
                          {r.publicDescription && <span className="sx-rep-desc">{r.publicDescription}</span>}
                        </td>
                        <td className="c-resp">
                          <span className="sx-rep-resp">
                            {ar && <AreaSwatch color={ar.color} size={10} shape="square" />}
                            {r.responsible}
                          </span>
                        </td>
                        <td className="c-part">{r.participants || "—"}</td>
                        <td className="c-loc">{r.location || "—"}</td>
                        <td className="c-status">
                          <StatusCell s={r.status} />
                        </td>
                        <td className="c-vis">
                          <span className="sx-rep-vis">
                            <VisIcon v={r.visibility} /> {r.visibilityLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ul className="sx-rep-list" aria-label={`Actividades de ${periodLabel}`}>
                {rows.map((r) => {
                  const ar = areaById(areas, r.responsibleAreaId);
                  return (
                    <li key={r.key} className={`sx-rep-item ${r.status === "cancelada" ? "is-cancelled" : ""}`}>
                      <div className="sx-rep-item-top">
                        <span className="fx-num">
                          {rowDay(r)} · {r.time}
                        </span>
                        <StatusCell s={r.status} />
                      </div>
                      <div className="sx-rep-item-main">
                        <span className="sx-rep-title-text">{r.title}</span>
                        <span className="sx-rep-resp">
                          {ar && <AreaSwatch color={ar.color} size={10} shape="square" />}
                          {r.responsible}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Vista previa del PDF" labelledBy="sx-pdf-preview-title" className="sx-pdf-panel">
          <PdfMock rows={rows} layout={layout} periodLabel={periodLabel} />
          <p className="fx-help sx-pdf-note">A4 horizontal · se genera en tu equipo, sin conexión · no incluye notas internas ni motivos.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="sx-rep">
      <PageHeader
        title={both ? "Reportes" : "Reportes · Calendario"}
        subtitle="Actividades por período, área, estado y visibilidad."
        actions={
          <button type="button" className="fx-btn fx-btn-secondary sx-rep-download" onClick={download} disabled={busy || estado === "cargando" || estado === "error"}>
            <Download size={16} aria-hidden="true" /> {busy ? "Generando…" : "Descargar PDF"}
          </button>
        }
      />
      <ReportSections current="calendario" />
      <div className="sx-rep-filters">
        {stepper}
        <div className="sx-rep-filters-desktop">
          {areaField("sx-rep")}
          {statusField}
          {visibilityField}
          {responsibleSwitch}
        </div>
        <button type="button" className="fx-btn fx-btn-secondary sx-rep-filters-btn" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal size={16} aria-hidden="true" /> Filtros{activeFilters ? ` (${activeFilters})` : ""}
        </button>
      </div>
      {body}
      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        labelId="sx-rep-filters-title"
        title="Filtros"
        footer={
          <div className="sx-cal-form-foot">
            <button type="button" className="fx-btn fx-btn-secondary" onClick={clear}>
              Limpiar
            </button>
            <button type="button" className="fx-btn fx-btn-primary" onClick={() => setFiltersOpen(false)}>
              Ver {rows.length} {rows.length === 1 ? "actividad" : "actividades"}
            </button>
          </div>
        }
      >
        <div className="sx-cal-form">
          <div className="sx-rep-sheet-area">
            {areaField("sx-rep-sheet")}
            {responsibleSwitch}
          </div>
          {statusField}
          {visibilityField}
        </div>
      </Sheet>
    </div>
  );
}

const G = PDF_GEOMETRY;
/** Longitud en mm → CSS relativo al ancho de la página (container query). */
const mm = (v: number) => `calc(${v} * var(--sx-mm))`;
const pt = (v: number) => mm(v * G.mmPerPt);
const COLS = G.columnWidths.map((w) => mm(w)).join(" ");

/**
 * Maqueta de la primera página del PDF (no es el PDF: es su vista previa).
 * Usa el mismo cálculo que el PDF (calendarPdfLayout): mismas líneas, mismo
 * alto de fila y mismas filas en la página 1, a escala del ancho disponible.
 */
function PdfMock({ rows, layout, periodLabel }: { rows: CalendarReportRow[]; layout: CalendarPdfLayout; periodLabel: string }) {
  const { state } = useSuite();
  const first = layout.pages[0] ?? [];
  const tableRow = (lines: string[][], height: number, cls: string, key: string, row?: CalendarReportRow) => (
    <div key={key} className={`sx-pdf-tr ${cls}`} style={{ height: mm(height), gridTemplateColumns: COLS }}>
      {lines.map((cell, col) => {
        const ar = row && col === G.responsibleColumn ? areaById(state.areas, row.responsibleAreaId) : undefined;
        return (
          <span
            key={col}
            className="sx-pdf-td"
            style={{ padding: `${mm(G.padding)} ${mm(G.padding)} ${mm(G.padding)} ${mm(col === G.responsibleColumn ? G.responsiblePadLeft : G.padding)}` }}
          >
            {ar && <span className="sx-pdf-swatch" style={{ background: AREA_PALETTE[ar.color].swatch }} />}
            {cell.map((l, i) => (
              <span key={i} className="sx-pdf-line">
                {l || " "}
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
  return (
    <figure className="sx-pdf" aria-label={`Vista previa de la primera página del PDF: ${periodLabel}`}>
      <div className="sx-pdf-page" aria-hidden="true">
        <div className="sx-pdf-sheet" style={{ fontSize: pt(G.fontSize), lineHeight: mm(G.lineHeight) }}>
          <div className="sx-pdf-band" style={{ height: mm(9), padding: `0 ${mm(G.margin.left)}` }}>
            <span>Casa de Salvación</span>
            <span>VISTA PREVIA · DATOS DE DEMOSTRACIÓN</span>
          </div>
          {layout.header.flatMap((h, i) =>
            (Array.isArray(h.text) ? h.text : [h.text]).map((t, j) => (
              <p
                key={`${i}-${j}`}
                className={`sx-pdf-hline ${h.tone === "strong" ? "is-strong" : ""} ${h.bold ? "is-bold" : ""}`}
                style={{ top: mm(h.y + j * h.size * 1.15 * G.mmPerPt - h.size * G.mmPerPt * 0.78), left: mm(G.margin.left), fontSize: pt(h.size) }}
              >
                {t}
              </p>
            )),
          )}
          <div className="sx-pdf-table" style={{ top: mm(layout.startY), left: mm(G.margin.left), width: mm(G.page.width - G.margin.left - G.margin.right) }}>
            {tableRow(layout.head.lines, layout.head.height, "is-head", "head")}
            {first.map((idx, i) => tableRow(layout.rows[idx].lines, layout.rows[idx].height, i % 2 === 0 ? "is-alt" : "", rows[idx].key, rows[idx]))}
          </div>
          {rows.length === 0 && (
            <p className="sx-pdf-hline" style={{ top: mm(layout.startY + 13 - 10 * G.mmPerPt * 0.78), left: mm(G.margin.left), fontSize: pt(10) }}>
              No hay actividades con estos filtros.
            </p>
          )}
          <p className="sx-pdf-foot" style={{ top: mm(G.page.height - 7 - G.fontSize * G.mmPerPt * 0.78), right: mm(G.margin.right) }}>
            Página 1 de {layout.pageCount}
          </p>
        </div>
      </div>
      <figcaption className="fx-help">
        Primera página · {first.length} de {rows.length} {rows.length === 1 ? "fila" : "filas"} · {layout.pageCount}{" "}
        {layout.pageCount === 1 ? "página" : "páginas"}
      </figcaption>
    </figure>
  );
}
