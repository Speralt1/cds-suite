"use client";

// Calendario de caja del Resumen (Design Lock 28 §C2): encabezado con chip de
// estado, leyenda, grilla con roving tabindex, panel del día en línea (≥52rem)
// o en un diálogo (modo apilado) y "Días por revisar" debajo en modo apilado.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ChevronDown, CircleCheck, CircleDashed, TriangleAlert, X } from "lucide-react";
import { clp, clpShort } from "@/lib/finance/formatters";
import type { DayStatus, MonthCalendar, ReviewItem } from "@/lib/finance/insights";
import { MONTHS } from "@/lib/finance/constants";
import type { FinanceTransaction } from "@/lib/finance/types";
import type { CashArea } from "@/lib/offerings/cash";
import {
  CashDayPanel,
  dateLabelShort,
  dayTitle,
  longDayLabel,
  plural,
} from "./cash-day-panel";
import "./tokens.css";
import "./cash-calendar.css";

/** Ancho (en rem) bajo el cual el calendario pasa a modo apilado. */
export const STACKED_BELOW_REM = 52;
const REVIEW_PREVIEW = 5;
const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function rootFontSize() {
  if (typeof window === "undefined") return 16;
  return parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
}

// Same threshold as the CSS container query on .fin-cal-section: JS needs it
// to decide whether tapping a day opens the dialog. Without ResizeObserver
// (jsdom, very old browsers) the inline layout is kept.
function useStackedLayout(ref: RefObject<HTMLElement | null>) {
  const [stacked, setStacked] = useState(false);
  // First frame: measure before paint so phones don't flash the inline panel.
  // jsdom reports 0 (no layout): keep the inline default there.
  useLayoutEffect(() => {
    const width = ref.current?.getBoundingClientRect().width || 0;
    if (width > 0 && width < STACKED_BELOW_REM * rootFontSize()) setStacked(true);
  }, [ref]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = (width: number) => setStacked(width < STACKED_BELOW_REM * rootFontSize());
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(el);
    // "Aa" (B1) changes the root font size without resizing the section.
    const textSize =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => measure(el.getBoundingClientRect().width));
    textSize?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-text-size"],
    });
    return () => {
      observer.disconnect();
      textSize?.disconnect();
    };
  }, [ref]);
  return stacked;
}

/** aria-label de la celda: "sábado 3 de octubre, hoy, día de culto, falta efectivo de Ofrendas, 1 advertencia". */
export function cellLabel(day: DayStatus) {
  const parts = [longDayLabel(day.date)];
  if (day.isToday) parts.push("hoy");
  if (day.isWorshipDay) parts.push("día de culto");
  if (day.missingCashAreas.length)
    parts.push(`falta efectivo de ${day.missingCashAreas.join(" y ")}`);
  if (day.noRecords) parts.push("sin registros de Ofrendas ni Cafetería");
  if (!day.isFuture && day.calendarCash > 0)
    parts.push(`efectivo registrado ${clp(day.calendarCash)}`);
  const warnings = day.missingCashAreas.length + (day.noRecords ? 1 : 0);
  if (warnings) parts.push(plural(warnings, "advertencia", "advertencias"));
  return parts.join(", ");
}

function CellContent({ day }: { day: DayStatus }) {
  const missing = day.missingCashAreas.length;
  const showCash = !day.isFuture && day.calendarCash > 0;
  return (
    <>
      <span className="fin-cal-cell-top">
        <span className="fin-cal-num">{Number(day.date.slice(8, 10))}</span>
        {day.isWorshipDay && <span className="fin-cal-worship">Culto</span>}
      </span>
      {missing > 0 ? (
        <span className="fin-cal-chip">
          <TriangleAlert aria-hidden="true" />
          <span className="fin-cal-chip-full">
            Falta efectivo · {missing === 2 ? "2 áreas" : day.missingCashAreas[0]}
          </span>
          <span className="fin-cal-chip-mid">Falta</span>
        </span>
      ) : day.noRecords ? (
        <span className="fin-cal-chip">
          <CircleDashed aria-hidden="true" />
          <span className="fin-cal-chip-full">Sin registros</span>
          <span className="fin-cal-chip-mid">Sin reg.</span>
        </span>
      ) : null}
      {showCash && <span className="fin-cal-amount">{clpShort(day.calendarCash)}</span>}
    </>
  );
}

function defaultTabStop(days: DayStatus[], selected: string) {
  return (
    days.find((d) => d.date === selected)?.date ||
    days.find((d) => d.isToday)?.date ||
    days[0]?.date
  );
}

export function CashCalendarGrid({
  year,
  month,
  calendar,
  selected,
  onActivate,
  gridRef,
}: {
  year: number;
  month: number;
  calendar: MonthCalendar;
  selected: string;
  onActivate: (date: string) => void;
  gridRef?: RefObject<HTMLTableElement | null>;
}) {
  const ownRef = useRef<HTMLTableElement>(null);
  const tableRef = gridRef || ownRef;
  // Roving tabindex: one Tab stop. The remembered focus only applies while
  // the selection it was made under is still the current one.
  const [focus, setFocus] = useState<{ date: string; selected: string } | null>(null);
  const inMonth = (date: string) => calendar.days.some((d) => d.date === date);
  const tabStop =
    focus && focus.selected === selected && inMonth(focus.date)
      ? focus.date
      : defaultTabStop(calendar.days, selected);

  function moveTo(date: string) {
    if (!inMonth(date)) return;
    setFocus({ date, selected });
    tableRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${date}"]`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: DayStatus) {
    const dayNumber = Number(day.date.slice(8, 10));
    const last = calendar.days.length;
    const mondayIndex = (day.weekday + 6) % 7;
    let target: number | null = null;
    if (event.key === "ArrowLeft") target = dayNumber - 1;
    else if (event.key === "ArrowRight") target = dayNumber + 1;
    else if (event.key === "ArrowUp") target = dayNumber - 7;
    else if (event.key === "ArrowDown") target = dayNumber + 7;
    else if (event.key === "Home") target = Math.max(1, dayNumber - mondayIndex);
    else if (event.key === "End") target = Math.min(last, dayNumber + (6 - mondayIndex));
    if (target === null) return;
    event.preventDefault();
    if (target < 1 || target > last) return;
    moveTo(`${day.date.slice(0, 8)}${String(target).padStart(2, "0")}`);
  }

  return (
    <table
      ref={tableRef}
      className="fin-cal-table"
      aria-label={`Calendario de ${MONTHS[month - 1]} ${year}`}
    >
      <thead>
        <tr>
          {WEEKDAYS.map((label) => (
            <th scope="col" key={label}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {calendar.weeks.map((week, i) => (
          <tr key={i}>
            {week.map((day, j) =>
              day ? (
                <td key={day.date}>
                  <button
                    type="button"
                    data-date={day.date}
                    className={[
                      "fin-cal-cell",
                      day.isToday && "is-today",
                      day.isFuture && "is-future",
                      day.missingCashAreas.length ? "has-warning" : day.noRecords && "has-empty",
                      !day.isFuture && day.calendarCash > 0 && "has-cash",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    tabIndex={day.date === tabStop ? 0 : -1}
                    aria-pressed={selected === day.date}
                    aria-current={day.isToday ? "date" : undefined}
                    aria-label={cellLabel(day)}
                    onKeyDown={(event) => onKeyDown(event, day)}
                    onClick={() => {
                      setFocus({ date: day.date, selected: day.date });
                      onActivate(day.date);
                    }}
                  >
                    <CellContent day={day} />
                  </button>
                </td>
              ) : (
                <td key={`blank-${i}-${j}`} aria-hidden="true" />
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CashCalendarLegend() {
  const [open, setOpen] = useState(true);
  const listId = useId();
  return (
    <div className={`fin-cal-legend${open ? "" : " is-collapsed"}`}>
      <button
        type="button"
        className="fin-cal-legend-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={16} aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }} />
        {open ? "Ocultar leyenda" : "Ver leyenda"}
      </button>
      <ul id={listId} className="fin-cal-legend-list" aria-label="Leyenda del calendario">
        <li>
          <span className="fin-cal-legend-sample is-warning" aria-hidden="true">
            <TriangleAlert size={16} />
          </span>
          Falta efectivo: SumUp registró cobros y no hay efectivo del área
        </li>
        <li>
          <span className="fin-cal-legend-sample is-empty" aria-hidden="true">
            <CircleDashed size={16} />
          </span>
          Sin registros: día de culto sin Ofrendas ni Cafetería
        </li>
        <li>
          <span className="fin-cal-legend-sample is-cash" aria-hidden="true">
            $165 mil
          </span>
          Efectivo registrado
        </li>
        <li>
          <span className="fin-cal-legend-sample is-today" aria-hidden="true">
            <span>3</span>
          </span>
          Hoy
        </li>
        <li>
          <span className="fin-cal-legend-sample is-selected" aria-hidden="true">
            3
          </span>
          Día seleccionado
        </li>
        <li>
          <span className="fin-cal-legend-sample is-worship" aria-hidden="true">
            Culto
          </span>
          Día de culto
        </li>
      </ul>
    </div>
  );
}

/** Diálogo del día (modo apilado): medidas y comportamiento de CalDialog. */
export function CashDayDialog({
  title,
  subtitle,
  onClose,
  returnFocus,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  /** Elemento al que vuelve el foco al cerrar (la celda del día). */
  returnFocus?: () => HTMLElement | null | undefined;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  const returnRef = useRef(returnFocus);
  useEffect(() => {
    closeRef.current = onClose;
    returnRef.current = returnFocus;
  });
  useEffect(() => {
    const d = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (d && !d.open) {
      try {
        if (typeof d.showModal === "function") d.showModal();
        else d.setAttribute("open", "");
      } catch {
        d.setAttribute("open", "");
      }
    }
    d?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      if (d?.open && typeof d.close === "function") d.close();
      const target = returnRef.current?.() || opener;
      target?.focus?.();
    };
  }, []);
  const requestClose = () => closeRef.current();
  return (
    <dialog
      ref={ref}
      className="fin-day-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      // Closed natively (e.g. a second Esc the browser won't let us cancel).
      // The "close" event is queued asynchronously: when the effect cleanup
      // closes the dialog and the effect immediately reopens it (React
      // StrictMode re-runs effects in development), the stale event arrives
      // while the dialog is open again and must be ignored.
      onClose={() => {
        if (!ref.current?.open) requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="fin-day-dialog-head">
        <div className="fin-day-dialog-titles">
          <h2 id={titleId} className="fin-day-dialog-title" tabIndex={-1} data-autofocus>
            {title}
          </h2>
          {subtitle}
        </div>
        <button type="button" className="fin-day-dialog-close" aria-label="Cerrar" onClick={requestClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="fin-day-dialog-body">{children}</div>
    </dialog>
  );
}

export interface CashCalendarSectionProps {
  year: number;
  month: number;
  calendar: MonthCalendar;
  review: ReviewItem[];
  transactions: FinanceTransaction[];
  selected: string;
  onSelect: (date: string) => void;
  /** Solo con finance.records.manage. */
  onRegisterCash?: (area: CashArea, date: string) => void;
  /** Vista Diario de esa fecha ("Revisar movimientos"). */
  onViewDay: (date: string) => void;
}

export function CashCalendarSection({
  year,
  month,
  calendar,
  review,
  transactions,
  selected,
  onSelect,
  onRegisterCash,
  onViewDay,
}: CashCalendarSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stacked = useStackedLayout(sectionRef);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showAllReview, setShowAllReview] = useState(false);
  const titleId = useId();
  // Leaving stacked mode (rotation, wider window) closes the dialog for good.
  if (!stacked && dialogOpen) setDialogOpen(false);

  const reviewDates = [...new Set(review.map((item) => item.date))];
  const status = calendar.days.find((d) => d.date === selected);
  const position = reviewDates.indexOf(selected);
  const previousDate =
    position >= 0 ? reviewDates[position - 1] : [...reviewDates].reverse().find((d) => d < selected);
  const nextDate = position >= 0 ? reviewDates[position + 1] : reviewDates.find((d) => d > selected);

  function open(date: string) {
    onSelect(date);
    if (stacked) setDialogOpen(true);
  }

  function reviewFirst() {
    const first = reviewDates[0];
    if (!first) return;
    onSelect(first);
    if (stacked) setDialogOpen(true);
    else headingRef.current?.focus();
  }

  const panel = (inDialog: boolean) => (
    <CashDayPanel
      date={selected}
      status={status}
      transactions={transactions}
      onRegisterCash={onRegisterCash ? (area) => onRegisterCash(area, selected) : undefined}
      onReviewMovements={() => onViewDay(selected)}
      showHeading={!inDialog}
      headingRef={inDialog ? undefined : headingRef}
      variant={inDialog ? "plain" : "card"}
      navigation={{
        position: position >= 0 ? position + 1 : null,
        total: reviewDates.length,
        onPrevious: previousDate ? () => onSelect(previousDate) : undefined,
        onNext: nextDate ? () => onSelect(nextDate) : undefined,
      }}
    />
  );

  const visibleReview = showAllReview ? review : review.slice(0, REVIEW_PREVIEW);

  return (
    <section ref={sectionRef} className="fin-cal-section" aria-labelledby={titleId}>
      <div className="fin-cal-layout">
        <div className="fin-cal-main">
          <h3 id={titleId} className="fin-cal-title">
            Calendario de caja · {MONTHS[month - 1]} {year}
          </h3>
          <p className="fin-cal-help">
            Montos: efectivo de Ofrendas y Cafetería. Toca un día para ver el detalle y los diezmos.
          </p>
          {review.length ? (
            <button type="button" className="fin-cal-status is-warning" onClick={reviewFirst}>
              <TriangleAlert size={16} aria-hidden="true" />
              <span>
                {plural(review.length, "advertencia", "advertencias")} en{" "}
                {plural(reviewDates.length, "día", "días")} ·{" "}
                <span className="fin-cal-status-action">Revisar</span>
              </span>
            </button>
          ) : (
            <p className="fin-cal-status is-ok">
              <CircleCheck size={16} aria-hidden="true" />
              Todo registrado en los días de culto de este mes.
            </p>
          )}
          <CashCalendarLegend />
          <div className="fin-cal-grid-wrap">
            <CashCalendarGrid
              year={year}
              month={month}
              calendar={calendar}
              selected={selected}
              onActivate={open}
              gridRef={gridRef}
            />
          </div>
          {stacked && review.length > 0 && (
            <div className="fin-review">
              <h4 className="fin-review-title">Días por revisar ({review.length})</h4>
              <ul className="fin-review-list">
                {visibleReview.map((item) => (
                  <li key={`${item.date}-${item.kind}-${item.area || ""}`}>
                    {item.kind === "missing-cash" ? (
                      <TriangleAlert size={16} aria-hidden="true" />
                    ) : (
                      <CircleDashed size={16} aria-hidden="true" />
                    )}
                    <span>
                      {item.label} — {dateLabelShort(item.date)}
                    </span>
                    <button
                      type="button"
                      className="button-secondary"
                      aria-label={`Ver día ${longDayLabel(item.date)}`}
                      onClick={() => open(item.date)}
                    >
                      Ver día
                    </button>
                  </li>
                ))}
              </ul>
              {review.length > REVIEW_PREVIEW && !showAllReview && (
                <button
                  type="button"
                  className="button-secondary fin-review-more"
                  onClick={() => setShowAllReview(true)}
                >
                  Ver las {review.length} advertencias
                </button>
              )}
            </div>
          )}
        </div>
        {!stacked && <aside className="fin-cal-aside" aria-label="Detalle del día">{panel(false)}</aside>}
      </div>
      {stacked && dialogOpen && (
        <CashDayDialog
          title={dayTitle(selected, status)}
          subtitle={status?.isToday ? <span className="fin-day-today mt-1">Hoy</span> : undefined}
          onClose={() => setDialogOpen(false)}
          returnFocus={() =>
            gridRef.current?.querySelector<HTMLElement>(`button[data-date="${selected}"]`)
          }
        >
          {panel(true)}
        </CashDayDialog>
      )}
    </section>
  );
}

/** Cargando: skeleton 5×7 con la altura final. */
export function CashCalendarSkeleton({ year, month }: { year: number; month: number }) {
  return (
    <section className="fin-cal-skeleton" aria-busy="true" aria-label={`Calendario de caja · ${MONTHS[month - 1]} ${year}`}>
      <h3 className="fin-cal-title">
        Calendario de caja · {MONTHS[month - 1]} {year}
      </h3>
      {/* Sin role="status": la banda ya anuncia la carga (un solo aviso). */}
      <p className="sr-only">Consultando información…</p>
      <div className="fin-cal-skeleton-grid" aria-hidden="true">
        {Array.from({ length: 35 }, (_, i) => (
          <span key={i} className="fin-skeleton" />
        ))}
      </div>
    </section>
  );
}
