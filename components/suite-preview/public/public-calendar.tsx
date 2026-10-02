"use client";

// Calendario público (16b §6): sin shell, sin perfil, sin "Ver como".
// PRESENTACIONAL: recibe solo el modelo armado desde la proyección pública.
// Allowlist de imports (test de aislamiento): types, sentinel,
// finance-preview/format, react y lucide-react.

import { useEffect, useRef, useState } from "react";
import { Ban, CalendarDays, CalendarX2, ChevronDown, ChevronLeft, ChevronRight, CloudOff, FlaskConical, MapPin, X } from "lucide-react";
import { SX_PREVIEW_SENTINEL } from "@/lib/suite-preview/sentinel";
import type { AreaColor, PublicArea, Ymd } from "@/lib/suite-preview/types";
import type { PublicCalendarModel, PublicEventView, PublicStatus } from "./model";

export const PUBLIC_UNAVAILABLE_TITLE = "Este calendario no está disponible";
export const PUBLIC_TZ_NOTE = "Horarios de Chile continental (America/Santiago).";
const WEEKDAYS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const WEEKDAYS_FULL = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function areaVars(color: AreaColor): React.CSSProperties {
  return {
    "--sx-area-swatch": `var(--fx-area-${color}-swatch)`,
    "--sx-area-ink": `var(--fx-area-${color}-ink)`,
    "--sx-area-soft": `var(--fx-area-${color}-soft)`,
  } as React.CSSProperties;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="fx sx sx-public" lang="es-CL" data-suite-preview={SX_PREVIEW_SENTINEL}>
      <p className="sx-pub-banner" role="note">
        <FlaskConical size={14} aria-hidden="true" /> Vista previa · datos de demostración
      </p>
      {children}
    </div>
  );
}

function Header({ churchName }: { churchName: string }) {
  return (
    <header className="sx-pub-header">
      <div className="sx-pub-header-inner">
        <span className="sx-pub-mark" aria-hidden="true">
          CS
        </span>
        <h1 className="sx-pub-brand">
          <span className="sx-pub-name">{churchName}</span>
          <span className="sx-pub-sub">Calendario de actividades</span>
        </h1>
      </div>
    </header>
  );
}

/** "Este calendario no está disponible": idéntico para enlace inválido o desactivado. */
export function PublicUnavailable() {
  return (
    <Frame>
      <main id="fx-main" className="sx-pub-unavailable" tabIndex={-1}>
        <span className="sx-pub-unavailable-icon" aria-hidden="true">
          <CalendarX2 size={24} />
        </span>
        <h1 className="fx-h1">{PUBLIC_UNAVAILABLE_TITLE}</h1>
        <p className="sx-pub-unavailable-body">Es posible que el enlace haya cambiado. Pide el enlace actualizado a la iglesia.</p>
      </main>
    </Frame>
  );
}

function PublicDialog({ open, onClose, labelId, children }: { open: boolean; onClose: () => void; labelId: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      back.current = document.activeElement as HTMLElement | null;
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCloseEv = () => {
      onClose();
      back.current?.focus?.();
    };
    d.addEventListener("close", onCloseEv);
    return () => d.removeEventListener("close", onCloseEv);
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      className="fx-dialog sx-pub-dialog"
      aria-labelledby={labelId}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close?.();
      }}
    >
      {open && children}
    </dialog>
  );
}

function matchesAreas(v: PublicEventView, selected: readonly string[]): boolean {
  if (!selected.length) return true;
  return selected.includes(v.event.responsibleArea.slug) || v.event.participantAreas.some((a) => selected.includes(a.slug));
}

function PublicRow({ v, onOpen }: { v: PublicEventView; onOpen: (id: string) => void }) {
  const e = v.event;
  const others = e.participantAreas.map((a) => a.name);
  const multi = e.endDate !== e.startDate;
  return (
    <li className={`sx-agenda-item ${e.status === "cancelada" ? "is-cancelled" : ""}`} style={areaVars(e.responsibleArea.color)}>
      <button type="button" className="sx-agenda-row" onClick={() => onOpen(e.id)} aria-label={v.aria}>
        <span className="sx-agenda-time fx-num" aria-hidden="true">
          {e.allDay ? (
            <span>{multi ? "Varios días" : "Todo el día"}</span>
          ) : (
            <>
              <span>{e.startTime}</span>
              {e.endTime && <span className="sx-agenda-time-end">{e.endTime}</span>}
            </>
          )}
        </span>
        <span className="sx-agenda-bar" aria-hidden="true" />
        <span className="sx-agenda-main" aria-hidden="true">
          <span className="sx-agenda-title">
            <span className="sx-agenda-title-text">{e.title}</span>
          </span>
          <span className="sx-agenda-meta">
            <span className="sx-agenda-area">{e.responsibleArea.name}</span>
            {others.length > 0 && <span> · con {others.slice(0, 2).join(", ")}{others.length > 2 ? ` +${others.length - 2}` : ""}</span>}
            {e.location && <span> · {e.location}</span>}
          </span>
        </span>
        {e.status === "cancelada" && (
          <span className="sx-agenda-status" aria-hidden="true">
            <span className="fx-badge fx-tone-neutral">
              <Ban size={12} aria-hidden="true" /> Cancelada
            </span>
          </span>
        )}
      </button>
    </li>
  );
}

function AreaFilterPanel({
  areas,
  selected,
  onChange,
}: {
  areas: PublicArea[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const all = !selected.length;
  return (
    <fieldset className="sx-pub-filter-panel">
      <legend className="fx-sr">Áreas visibles</legend>
      <label className="sx-filter-row">
        <input type="checkbox" checked={all} onChange={() => onChange([])} />
        <span className="sx-filter-name">Todas las áreas</span>
      </label>
      {areas.map((a) => (
        <label key={a.slug} className="sx-filter-row">
          <input
            type="checkbox"
            checked={!all && selected.includes(a.slug)}
            onChange={(e) => {
              const next = e.target.checked ? [...selected, a.slug] : selected.filter((s) => s !== a.slug);
              onChange(next.length === areas.length ? [] : next);
            }}
          />
          <span className="sx-area-swatch is-square" style={{ ...areaVars(a.color), width: 12, height: 12 }} aria-hidden="true" />
          <span className="sx-filter-name">{a.name}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function PublicCalendarPage({ status, model, onRetry }: { status: PublicStatus; model: PublicCalendarModel | null; onRetry?: () => void }) {
  const [view, setView] = useState<"agenda" | "mes">("agenda");
  const [monthIdx, setMonthIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<Ymd | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);

  if (status === "unavailable" || (status === "ready" && !model)) return <PublicUnavailable />;

  if (status === "loading" || status === "error" || !model) {
    return (
      <Frame>
        <Header churchName="Casa de Salvación" />
        <main id="fx-main" className="sx-pub-main" tabIndex={-1}>
          {status === "error" ? (
            <div className="fx-empty" role="alert">
              <span className="fx-empty-icon" aria-hidden="true">
                <CloudOff size={24} />
              </span>
              <p className="fx-empty-title">No pudimos cargar el calendario. Inténtalo más tarde.</p>
              {onRetry && (
                <button type="button" className="fx-btn fx-btn-secondary" onClick={onRetry}>
                  Reintentar
                </button>
              )}
            </div>
          ) : (
            <div className="sx-pub-skeleton" aria-busy="true" aria-label="Cargando el calendario">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="fx-skel" style={{ height: 56 }} />
              ))}
            </div>
          )}
        </main>
      </Frame>
    );
  }

  const idx = monthIdx ?? model.initialMonth;
  const month = model.months[idx];
  const isCurrent = idx === model.initialMonth;
  const visible = model.events.filter((v) => matchesAreas(v, selected));
  const detail = detailId ? model.events.find((v) => v.event.id === detailId) ?? null : null;
  const goMonth = (n: number) => {
    setMonthIdx(Math.max(0, Math.min(model.months.length - 1, n)));
    setShowEarlier(false);
    setPickedDay(null);
  };
  const dayHeader = (date: Ymd) => {
    const d = model.days[date];
    if (!d) return date;
    return `${d.isToday ? "Hoy · " : d.isTomorrow ? "Mañana · " : ""}${d.label}`;
  };

  // ---- Agenda del mes visible (solo días con actividades) ----
  const agendaFrom = isCurrent && !showEarlier ? model.today : month.first;
  const agendaEvents = visible.filter((v) => v.event.startDate >= agendaFrom && v.event.startDate <= month.last);
  const groups: { date: Ymd; items: PublicEventView[] }[] = [];
  for (const v of agendaEvents) {
    const last = groups[groups.length - 1];
    if (last && last.date === v.event.startDate) last.items.push(v);
    else groups.push({ date: v.event.startDate, items: [v] });
  }
  const next = model.months[idx + 1];

  // ---- Mes ----
  const selectedDay = pickedDay && pickedDay.startsWith(month.key) ? pickedDay : model.today.startsWith(month.key) ? model.today : month.first;
  const onDay = (date: Ymd) => visible.filter((v) => v.spans.includes(date));
  const filterLabel = selected.length ? `Áreas (${selected.length})` : "Áreas (Todas)";

  return (
    <Frame>
      <Header churchName={model.churchName} />
      <main id="fx-main" className="sx-pub-main" tabIndex={-1}>
        <div className="sx-pub-toolbar">
          <div className="sx-pub-nav">
            <button
              type="button"
              className="fx-btn fx-btn-secondary fx-btn-icon"
              disabled={idx === 0}
              aria-label={idx === 0 ? "No hay más meses publicados" : "Mes anterior"}
              onClick={() => goMonth(idx - 1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <h2 className="sx-pub-month" aria-live="polite">
              {month.title}
            </h2>
            <button
              type="button"
              className="fx-btn fx-btn-secondary fx-btn-icon"
              disabled={idx === model.months.length - 1}
              aria-label={idx === model.months.length - 1 ? "No hay más meses publicados" : "Mes siguiente"}
              onClick={() => goMonth(idx + 1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button type="button" className="fx-btn fx-btn-secondary sx-pub-today" disabled={isCurrent} onClick={() => goMonth(model.initialMonth)}>
              Hoy
            </button>
          </div>
          <div className="sx-pub-controls">
            <div className="fx-segmented sx-view-switch" role="group" aria-label="Vista">
              <button type="button" aria-pressed={view === "agenda"} onClick={() => setView("agenda")}>
                Agenda
              </button>
              <button type="button" aria-pressed={view === "mes"} onClick={() => setView("mes")}>
                Mes
              </button>
            </div>
            <button
              type="button"
              className={`sx-filter-chip ${selected.length ? "is-on" : ""}`}
              aria-expanded={filterOpen}
              aria-controls="sx-pub-filter"
              onClick={() => setFilterOpen((v) => !v)}
            >
              <span className="sx-filter-chip-label">{filterLabel}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        {filterOpen && (
          <div id="sx-pub-filter" className="sx-pub-filter">
            <AreaFilterPanel areas={model.areas} selected={selected} onChange={setSelected} />
            <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={() => setFilterOpen(false)}>
              Listo
            </button>
          </div>
        )}

        {view === "agenda" ? (
          <div className="sx-pub-agenda">
            {isCurrent && !showEarlier && (
              <button type="button" className="fx-btn fx-btn-ghost sx-earlier" onClick={() => setShowEarlier(true)}>
                Ver días anteriores
              </button>
            )}
            {groups.length ? (
              groups.map((g) => (
                <section key={g.date} className="sx-agenda-group" aria-labelledby={`sx-pub-day-${g.date}`}>
                  <h3 className={`sx-agenda-day ${model.days[g.date]?.isToday ? "is-today" : ""}`} id={`sx-pub-day-${g.date}`}>
                    {dayHeader(g.date)}
                  </h3>
                  <ul className="sx-agenda-list">
                    {g.items.map((v) => (
                      <PublicRow key={v.event.id} v={v} onOpen={setDetailId} />
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <div className="fx-empty sx-pub-empty">
                <span className="fx-empty-icon" aria-hidden="true">
                  <CalendarDays size={24} />
                </span>
                <p className="fx-empty-title">No hay actividades publicadas en {month.name}.</p>
                {next && (
                  <button type="button" className="fx-btn fx-btn-secondary" onClick={() => goMonth(idx + 1)}>
                    Ver {next.name} <ChevronRight size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="sx-pub-monthview">
            <table className="sx-mini-month sx-pub-grid" aria-label={month.title}>
              <thead>
                <tr>
                  {WEEKDAYS.map((d, i) => (
                    <th key={d} scope="col" abbr={WEEKDAYS_FULL[i]}>
                      <span className="sx-pub-wd-long">{d}</span>
                      <span className="sx-pub-wd-short">{d.slice(0, 1)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {month.weeks.map((w) => (
                  <tr key={w[0].date}>
                    {w.map((c) => {
                      const list = onDay(c.date);
                      const isSel = c.date === selectedDay;
                      const n = list.length;
                      return (
                        <td key={c.date}>
                          <button
                            type="button"
                            className={`sx-mini-day sx-pub-day ${c.inMonth ? "" : "is-out"} ${c.isToday ? "is-today" : ""} ${isSel ? "is-selected" : ""}`}
                            aria-pressed={isSel}
                            aria-current={c.isToday ? "date" : undefined}
                            aria-label={`${model.days[c.date]?.label ?? c.date}, ${n === 0 ? "sin actividades" : n === 1 ? "1 actividad" : `${n} actividades`}`}
                            onClick={() => setPickedDay(c.date)}
                          >
                            <span className="sx-mini-num">{c.day}</span>
                            <span className="sx-pub-day-events" aria-hidden="true">
                              {list.slice(0, 3).map((v) => (
                                <span key={v.event.id} className={`sx-pub-day-ev ${v.event.status === "cancelada" ? "is-cancelled" : ""}`} style={areaVars(v.event.responsibleArea.color)}>
                                  <span className="sx-pub-day-ev-text">
                                    {v.event.startTime && v.event.startDate === c.date ? `${v.event.startTime} ` : ""}
                                    {v.event.title}
                                  </span>
                                </span>
                              ))}
                              {n > 3 && <span className="sx-pub-day-more">+{n - 3}</span>}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <section className="sx-day-list" aria-labelledby="sx-pub-day-list">
              <h3 className="sx-agenda-day is-static" id="sx-pub-day-list">
                {dayHeader(selectedDay)}
              </h3>
              {onDay(selectedDay).length ? (
                <ul className="sx-agenda-list">
                  {onDay(selectedDay).map((v) => (
                    <PublicRow key={v.event.id} v={v} onOpen={setDetailId} />
                  ))}
                </ul>
              ) : (
                <p className="fx-help-13 sx-day-empty">No hay actividades publicadas este día.</p>
              )}
            </section>
          </div>
        )}

        <p className="sx-pub-tz">{PUBLIC_TZ_NOTE}</p>
      </main>

      <PublicDialog open={!!detail} onClose={() => setDetailId(null)} labelId="sx-pub-detail-title">
        {detail && (
          <>
            <div className="fx-sheet-handle" aria-hidden="true" />
            <div className="fx-sheet-head">
              <div style={{ minWidth: 0 }}>
                <span className="sx-area-pill" style={areaVars(detail.event.responsibleArea.color)}>
                  <span className="sx-area-pill-name">Organiza: {detail.event.responsibleArea.name}</span>
                </span>
                <h2
                  id="sx-pub-detail-title"
                  className={`fx-h2 sx-pub-detail-title ${detail.event.status === "cancelada" ? "sx-struck" : ""}`}
                  tabIndex={-1}
                  data-autofocus
                >
                  {detail.event.title}
                </h2>
              </div>
              <button
                type="button"
                className="fx-close"
                aria-label="Cerrar"
                onClick={() => setDetailId(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="fx-sheet-body sx-detail">
              {detail.event.status === "cancelada" && (
                <p className="sx-detail-cancel">
                  <Ban size={14} aria-hidden="true" />
                  <span>
                    <strong>Cancelada.</strong> Esta actividad no se realizará.
                  </span>
                </p>
              )}
              <p className="sx-detail-when-main">
                <CalendarDays size={16} aria-hidden="true" />
                <span>{detail.when}</span>
              </p>
              {detail.event.location && (
                <p className="sx-detail-line">
                  <MapPin size={14} aria-hidden="true" />
                  <span>{detail.event.location}</span>
                </p>
              )}
              {detail.event.participantAreas.length > 0 && (
                <section className="sx-detail-section" aria-labelledby="sx-pub-participants">
                  <h3 className="fx-h3" id="sx-pub-participants">
                    Participan
                  </h3>
                  <ul className="sx-chip-list">
                    {detail.event.participantAreas.map((a) => (
                      <li key={a.slug}>
                        <span className="sx-area-chip" style={areaVars(a.color)}>
                          <span className="sx-area-swatch" style={{ width: 8, height: 8 }} aria-hidden="true" />
                          <span>{a.name}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {detail.event.publicDescription && (
                <section className="sx-detail-section" aria-labelledby="sx-pub-desc">
                  <h3 className="fx-h3" id="sx-pub-desc">
                    Descripción
                  </h3>
                  <p className="sx-detail-text">{detail.event.publicDescription}</p>
                </section>
              )}
              <p className="fx-help sx-pub-tz-inline">{PUBLIC_TZ_NOTE}</p>
            </div>
          </>
        )}
      </PublicDialog>
    </Frame>
  );
}
