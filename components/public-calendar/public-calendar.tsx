"use client";

// Calendario público (18b §2.5): sin shell, sin sesión, sin enlaces a rutas
// privadas. PRESENTACIONAL: recibe solo el modelo armado desde la proyección
// pública (lista blanca de lib/shared). Imports permitidos: lib/shared, react,
// lucide-react y archivos de esta carpeta. Los estilos (prefijo `pub-`) viven
// en ./public-calendar.css y los carga la ruta.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, CalendarDays, CalendarX2, ChevronDown, ChevronLeft, ChevronRight, CloudOff, MapPin, Repeat, X } from "lucide-react";
import { CHURCH_NAME } from "@/lib/shared/public-calendar";
import type { PublicArea, Ymd } from "@/lib/shared/types";
import { publicAreaStyle } from "./area-style";
import type { PublicCalendarModel, PublicEventView, PublicStatus } from "./model";

export const PUBLIC_UNAVAILABLE_TITLE = "Este calendario no está disponible";
export const PUBLIC_UNAVAILABLE_BODY = "Es posible que el enlace haya cambiado. Pide el enlace actualizado a la iglesia.";
export const PUBLIC_ERROR_TEXT = "No pudimos cargar el calendario. Revisa tu conexión e inténtalo de nuevo.";
export const PUBLIC_TZ_NOTE = "Horarios en hora de Chile continental.";

const WEEKDAYS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const WEEKDAYS_FULL = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="pub-root" lang="es-CL">
      {children}
    </div>
  );
}

function Header({ churchName }: { churchName: string }) {
  return (
    <header className="pub-header">
      <div className="pub-header-inner">
        <span className="pub-mark" aria-hidden="true">
          CS
        </span>
        <h1 className="pub-brand">
          <span className="pub-name">{churchName}</span>
          <span className="pub-sub">Calendario de actividades</span>
        </h1>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="pub-footer">
      <p>{PUBLIC_TZ_NOTE}</p>
    </footer>
  );
}

/** "Este calendario no está disponible": idéntico para enlace inválido, regenerado o desactivado. */
export function PublicUnavailable() {
  return (
    <Frame>
      <main className="pub-unavailable">
        <span className="pub-unavailable-icon" aria-hidden="true">
          <CalendarX2 size={24} />
        </span>
        <h1 className="pub-unavailable-title">{PUBLIC_UNAVAILABLE_TITLE}</h1>
        <p className="pub-unavailable-body">{PUBLIC_UNAVAILABLE_BODY}</p>
      </main>
    </Frame>
  );
}

function PublicDialog({
  open,
  onClose,
  labelId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelId: string;
  children: ReactNode;
}) {
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
      back.current?.focus?.();
    }
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCloseEvent = () => onClose();
    d.addEventListener("close", onCloseEvent);
    return () => d.removeEventListener("close", onCloseEvent);
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      className="pub-dialog"
      aria-labelledby={labelId}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
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

function CancelledBadge() {
  return (
    <span className="pub-badge">
      <Ban size={12} aria-hidden="true" /> Cancelada
    </span>
  );
}

function PublicRow({ v, onOpen }: { v: PublicEventView; onOpen: (id: string) => void }) {
  const e = v.event;
  const others = e.participantAreas.map((a) => a.name);
  const multi = e.endDate !== e.startDate;
  const cancelled = e.status === "cancelled";
  return (
    <li className={`pub-agenda-item${cancelled ? " is-cancelled" : ""}`} style={publicAreaStyle(e.responsibleArea.color)}>
      <button type="button" className="pub-agenda-row" onClick={() => onOpen(e.id)} aria-label={v.aria}>
        <span className="pub-agenda-time" aria-hidden="true">
          {e.allDay ? (
            <span>{multi ? "Varios días" : "Todo el día"}</span>
          ) : (
            <>
              <span>{e.startTime}</span>
              {e.endTime && <span className="pub-agenda-time-end">{e.endTime}</span>}
            </>
          )}
        </span>
        <span className="pub-agenda-bar" aria-hidden="true" />
        <span className="pub-agenda-main" aria-hidden="true">
          <span className="pub-agenda-title">{e.title}</span>
          <span className="pub-agenda-meta">
            <span className="pub-agenda-area">{e.responsibleArea.name}</span>
            {others.length > 0 && (
              <span>
                {" "}
                · con {others.slice(0, 2).join(", ")}
                {others.length > 2 ? ` +${others.length - 2}` : ""}
              </span>
            )}
            {e.location && <span> · {e.location}</span>}
          </span>
        </span>
        {cancelled && (
          <span className="pub-agenda-status" aria-hidden="true">
            <CancelledBadge />
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
    <fieldset className="pub-filter-panel">
      <legend className="pub-sr">Áreas visibles</legend>
      <label className="pub-filter-row">
        <input type="checkbox" checked={all} onChange={() => onChange([])} />
        <span>Todas las áreas</span>
      </label>
      {areas.map((a) => (
        <label key={a.slug} className="pub-filter-row">
          <input
            type="checkbox"
            checked={!all && selected.includes(a.slug)}
            onChange={(ev) => {
              const next = ev.target.checked ? [...selected, a.slug] : selected.filter((s) => s !== a.slug);
              onChange(next.length === areas.length ? [] : next);
            }}
          />
          <span className="pub-swatch" style={publicAreaStyle(a.color)} aria-hidden="true" />
          <span>{a.name}</span>
        </label>
      ))}
    </fieldset>
  );
}

function LoadingBody() {
  return (
    <div className="pub-skeleton" aria-busy="true">
      <p className="pub-sr" role="status">
        Cargando el calendario…
      </p>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="pub-skel" aria-hidden="true" />
      ))}
    </div>
  );
}

function ErrorBody({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="pub-empty" role="alert">
      <span className="pub-empty-icon" aria-hidden="true">
        <CloudOff size={24} />
      </span>
      <p className="pub-empty-title">{PUBLIC_ERROR_TEXT}</p>
      {onRetry && (
        <button type="button" className="pub-btn" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

export function PublicCalendarView({
  status,
  model,
  onRetry,
}: {
  status: PublicStatus;
  model: PublicCalendarModel | null;
  onRetry?: () => void;
}) {
  const [view, setView] = useState<"agenda" | "mes">("agenda");
  const [monthIdx, setMonthIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<Ymd | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);

  if (status === "unavailable" || (status === "ready" && (!model || !model.months.length))) return <PublicUnavailable />;

  if (status !== "ready" || !model) {
    return (
      <Frame>
        <Header churchName={CHURCH_NAME} />
        <main className="pub-main">{status === "error" ? <ErrorBody onRetry={onRetry} /> : <LoadingBody />}</main>
        <Footer />
      </Frame>
    );
  }

  const idx = Math.max(0, Math.min(model.months.length - 1, monthIdx ?? model.initialMonth));
  const month = model.months[idx];
  const isCurrent = idx === model.initialMonth && model.today.startsWith(month.key);
  const visible = model.events.filter((v) => matchesAreas(v, selected));
  const detail = detailId ? (model.events.find((v) => v.event.id === detailId) ?? null) : null;
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
  const hideEarlier = isCurrent && !showEarlier;
  const inMonth = visible.filter((v) => v.event.startDate >= month.first && v.event.startDate <= month.last);
  const agendaEvents = hideEarlier ? inMonth.filter((v) => v.event.startDate >= model.today) : inMonth;
  const hasEarlier = hideEarlier && inMonth.length > agendaEvents.length;
  const groups: { date: Ymd; items: PublicEventView[] }[] = [];
  for (const v of agendaEvents) {
    const last = groups[groups.length - 1];
    if (last && last.date === v.event.startDate) last.items.push(v);
    else groups.push({ date: v.event.startDate, items: [v] });
  }
  const next = model.months[idx + 1];

  // ---- Mes ----
  const selectedDay =
    pickedDay && pickedDay.startsWith(month.key) ? pickedDay : model.today.startsWith(month.key) ? model.today : month.first;
  const onDay = (date: Ymd) => visible.filter((v) => v.spans.includes(date));
  const filterLabel = selected.length ? `Áreas (${selected.length})` : "Áreas (todas)";
  const selectedList = onDay(selectedDay);

  return (
    <Frame>
      <Header churchName={model.churchName} />
      <main className="pub-main">
        <div className="pub-toolbar">
          <div className="pub-nav">
            <button
              type="button"
              className="pub-btn pub-btn-icon"
              disabled={idx === 0}
              aria-label={idx === 0 ? "No hay meses anteriores publicados" : "Mes anterior"}
              onClick={() => goMonth(idx - 1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <h2 className="pub-month" aria-live="polite">
              {month.title}
            </h2>
            <button
              type="button"
              className="pub-btn pub-btn-icon"
              disabled={idx === model.months.length - 1}
              aria-label={idx === model.months.length - 1 ? "No hay meses siguientes publicados" : "Mes siguiente"}
              onClick={() => goMonth(idx + 1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button type="button" className="pub-btn pub-today" disabled={idx === model.initialMonth} onClick={() => goMonth(model.initialMonth)}>
              Hoy
            </button>
          </div>
          <div className="pub-controls">
            <div className="pub-segmented" role="group" aria-label="Vista">
              <button type="button" aria-pressed={view === "agenda"} onClick={() => setView("agenda")}>
                Agenda
              </button>
              <button type="button" aria-pressed={view === "mes"} onClick={() => setView("mes")}>
                Mes
              </button>
            </div>
            {model.areas.length > 0 && (
              <button
                type="button"
                className={`pub-filter-chip${selected.length ? " is-on" : ""}`}
                aria-expanded={filterOpen}
                aria-controls="pub-filter"
                onClick={() => setFilterOpen((v) => !v)}
              >
                <span className="pub-filter-chip-label">{filterLabel}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        {filterOpen && (
          <div id="pub-filter" className="pub-filter">
            <AreaFilterPanel areas={model.areas} selected={selected} onChange={setSelected} />
            <button type="button" className="pub-btn pub-btn-sm" onClick={() => setFilterOpen(false)}>
              Listo
            </button>
          </div>
        )}

        {view === "agenda" ? (
          <div className="pub-agenda">
            {hasEarlier && (
              <button type="button" className="pub-btn-ghost pub-earlier" onClick={() => setShowEarlier(true)}>
                Ver días anteriores
              </button>
            )}
            {groups.length ? (
              groups.map((g) => (
                <section key={g.date} className="pub-agenda-group" aria-labelledby={`pub-day-${g.date}`}>
                  <h3 className={`pub-agenda-day${model.days[g.date]?.isToday ? " is-today" : ""}`} id={`pub-day-${g.date}`}>
                    {dayHeader(g.date)}
                  </h3>
                  <ul className="pub-agenda-list">
                    {g.items.map((v) => (
                      <PublicRow key={v.event.id} v={v} onOpen={setDetailId} />
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <div className="pub-empty">
                <span className="pub-empty-icon" aria-hidden="true">
                  <CalendarDays size={24} />
                </span>
                <p className="pub-empty-title">
                  {selected.length
                    ? "Ninguna actividad de las áreas elegidas."
                    : hasEarlier
                      ? `No quedan actividades publicadas en ${month.name}.`
                      : `No hay actividades publicadas en ${month.name}.`}
                </p>
                {selected.length > 0 ? (
                  <button type="button" className="pub-btn" onClick={() => setSelected([])}>
                    Mostrar todas las áreas
                  </button>
                ) : (
                  next && (
                    <button type="button" className="pub-btn" onClick={() => goMonth(idx + 1)}>
                      Ver {next.name} <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="pub-monthview">
            <table className="pub-grid" aria-label={month.title}>
              <thead>
                <tr>
                  {WEEKDAYS.map((d, i) => (
                    <th key={d} scope="col" abbr={WEEKDAYS_FULL[i]}>
                      <span className="pub-wd-long">{d}</span>
                      <span className="pub-wd-short">{d.slice(0, 1)}</span>
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
                            className={`pub-day${c.inMonth ? "" : " is-out"}${c.isToday ? " is-today" : ""}${isSel ? " is-selected" : ""}`}
                            aria-pressed={isSel}
                            aria-current={c.isToday ? "date" : undefined}
                            aria-label={`${model.days[c.date]?.label ?? c.date}, ${n === 0 ? "sin actividades" : n === 1 ? "1 actividad" : `${n} actividades`}`}
                            onClick={() => setPickedDay(c.date)}
                          >
                            <span className="pub-day-num">{c.day}</span>
                            <span className="pub-day-events" aria-hidden="true">
                              {list.slice(0, 3).map((v) => (
                                <span
                                  key={v.event.id}
                                  className={`pub-day-ev${v.event.status === "cancelled" ? " is-cancelled" : ""}`}
                                  style={publicAreaStyle(v.event.responsibleArea.color)}
                                >
                                  <span className="pub-day-ev-text">
                                    {v.event.startTime && v.event.startDate === c.date ? `${v.event.startTime} ` : ""}
                                    {v.event.title}
                                  </span>
                                </span>
                              ))}
                              {n > 3 && <span className="pub-day-more">+{n - 3}</span>}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <section className="pub-day-list" aria-labelledby="pub-day-list-title">
              <h3 className="pub-agenda-day is-static" id="pub-day-list-title">
                {dayHeader(selectedDay)}
              </h3>
              {selectedList.length ? (
                <ul className="pub-agenda-list">
                  {selectedList.map((v) => (
                    <PublicRow key={v.event.id} v={v} onOpen={setDetailId} />
                  ))}
                </ul>
              ) : (
                <p className="pub-day-empty">No hay actividades publicadas este día.</p>
              )}
            </section>
          </div>
        )}
      </main>
      <Footer />

      <PublicDialog open={!!detail} onClose={() => setDetailId(null)} labelId="pub-detail-title">
        {detail && (
          <>
            <div className="pub-dialog-head">
              <div className="pub-dialog-heading">
                <span className="pub-pill" style={publicAreaStyle(detail.event.responsibleArea.color)}>
                  <span className="pub-swatch" aria-hidden="true" />
                  Organiza: {detail.event.responsibleArea.name}
                </span>
                <h2
                  id="pub-detail-title"
                  className={`pub-detail-title${detail.event.status === "cancelled" ? " is-struck" : ""}`}
                  tabIndex={-1}
                  data-autofocus
                >
                  {detail.event.title}
                </h2>
              </div>
              <button type="button" className="pub-close" aria-label="Cerrar" onClick={() => setDetailId(null)}>
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="pub-detail">
              {detail.event.status === "cancelled" && (
                <p className="pub-detail-cancel">
                  <Ban size={14} aria-hidden="true" />
                  <span>
                    <strong>Cancelada.</strong> Esta actividad no se realizará.
                  </span>
                </p>
              )}
              <p className="pub-detail-when">
                <CalendarDays size={16} aria-hidden="true" />
                <span>{detail.when}</span>
              </p>
              {detail.event.recurrenceLabel && (
                <p className="pub-detail-line">
                  <Repeat size={14} aria-hidden="true" />
                  <span>{detail.event.recurrenceLabel}</span>
                </p>
              )}
              {detail.event.location && (
                <p className="pub-detail-line">
                  <MapPin size={14} aria-hidden="true" />
                  <span>{detail.event.location}</span>
                </p>
              )}
              {detail.event.participantAreas.length > 0 && (
                <section className="pub-detail-section" aria-labelledby="pub-participants">
                  <h3 id="pub-participants">Participan</h3>
                  <ul className="pub-chip-list">
                    {detail.event.participantAreas.map((a) => (
                      <li key={a.slug}>
                        <span className="pub-chip" style={publicAreaStyle(a.color)}>
                          <span className="pub-swatch" aria-hidden="true" />
                          {a.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {detail.event.publicDescription && (
                <section className="pub-detail-section" aria-labelledby="pub-desc">
                  <h3 id="pub-desc">Descripción</h3>
                  <p className="pub-detail-text">{detail.event.publicDescription}</p>
                </section>
              )}
              <p className="pub-detail-tz">{PUBLIC_TZ_NOTE}</p>
            </div>
          </>
        )}
      </PublicDialog>
    </Frame>
  );
}
