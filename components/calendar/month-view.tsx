"use client";

// Vista Mes (16b §5.3) y su variante compacta móvil (§5.5). Tabla semántica con
// un botón por día (abre el diálogo del día) y chips <button> con aria-label
// completo. Hoy lleva aria-current="date".

import { useState } from "react";
import { monthGrid, occurrencesOnDay } from "@/lib/calendar/calendar";
import { compareDayOrder, occurrenceOrderKey } from "@/lib/shared/calendar-core";
import { compareLocal, dayLabel, parseYmd, WEEKDAY_HEADERS_MON_FIRST } from "@/lib/shared/dates";
import type { Area, Occurrence, Ymd } from "@/lib/shared/types";
import { areaCss } from "./area-badges";
import { AgendaRow, colorOf, MonthChip } from "./event-bits";
import { CalDialog } from "./ui";

const WEEKDAY_FULL = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/**
 * Orden dentro del día (comparador único compareDayOrder); las que vienen del
 * día anterior van antes de las que empiezan ese día.
 */
export function sortDay(list: Occurrence[], areas: readonly Area[], date: Ymd): Occurrence[] {
  return [...list].sort((a, b) => {
    const ac = compareLocal(a.date, date) < 0 ? 0 : 1;
    const bc = compareLocal(b.date, date) < 0 ? 0 : 1;
    return (
      Number(b.allDay) - Number(a.allDay) ||
      ac - bc ||
      compareDayOrder({ ...occurrenceOrderKey(a, areas), date }, { ...occurrenceOrderKey(b, areas), date })
    );
  });
}

function countLabel(n: number) {
  return n === 0 ? "sin actividades" : n === 1 ? "1 actividad" : `${n} actividades`;
}

export function MonthGrid({
  year,
  month,
  title,
  occurrences,
  areas,
  today,
  maxChips,
  showTime,
  onOpen,
  onOpenDay,
}: {
  year: number;
  month: number;
  title: string;
  occurrences: Occurrence[];
  areas: readonly Area[];
  today: Ymd;
  maxChips: number;
  showTime: boolean;
  onOpen: (o: Occurrence) => void;
  onOpenDay: (date: Ymd) => void;
}) {
  const weeks = monthGrid(year, month);
  return (
    <table className="cal-month" aria-label={title}>
      <thead>
        <tr>
          {WEEKDAY_HEADERS_MON_FIRST.map((d, i) => (
            <th key={d} scope="col" abbr={WEEKDAY_FULL[i]}>
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0].date}>
            {week.map((cell) => {
              const list = sortDay(occurrencesOnDay(occurrences, cell.date), areas, cell.date);
              const shown = list.slice(0, maxChips);
              const extra = list.length - shown.length;
              const isToday = cell.date === today;
              return (
                <td key={cell.date} className={`${cell.inMonth ? "" : "is-out"} ${isToday ? "is-today" : ""}`}>
                  <div className="cal-month-cell">
                    <button
                      type="button"
                      className="cal-day-num"
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${dayLabel(cell.date)}, ${countLabel(list.length)}`}
                      onClick={() => onOpenDay(cell.date)}
                    >
                      {parseYmd(cell.date).d}
                    </button>
                    {shown.length > 0 && (
                      <ul className="cal-month-chips">
                        {shown.map((o) => (
                          <li key={o.key}>
                            <MonthChip o={o} areas={areas} onOpen={onOpen} showTime={showTime} continuation={compareLocal(o.date, cell.date) < 0} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {extra > 0 && (
                      <button
                        type="button"
                        className="cal-more-link"
                        aria-label={`Ver ${extra} actividades más del ${dayLabel(cell.date)}`}
                        onClick={() => onOpenDay(cell.date)}
                      >
                        +{extra} más
                      </button>
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Mes compacto (móvil): puntos de color + lista del día elegido debajo. */
export function MonthGridCompact({
  year,
  month,
  title,
  occurrences,
  areas,
  today,
  onOpen,
}: {
  year: number;
  month: number;
  title: string;
  occurrences: Occurrence[];
  areas: readonly Area[];
  today: Ymd;
  onOpen: (o: Occurrence) => void;
}) {
  const weeks = monthGrid(year, month);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const [picked, setPicked] = useState<Ymd | null>(null);
  const selected = picked && picked.startsWith(monthKey) ? picked : today.startsWith(monthKey) ? today : `${monthKey}-01`;
  const dayList = sortDay(occurrencesOnDay(occurrences, selected), areas, selected);

  return (
    <div className="cal-month-compact">
      <table className="cal-mini-month" aria-label={title}>
        <thead>
          <tr>
            {WEEKDAY_HEADERS_MON_FIRST.map((d, i) => (
              <th key={d} scope="col" abbr={WEEKDAY_FULL[i]}>
                {d.slice(0, 1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].date}>
              {week.map((cell) => {
                const list = sortDay(occurrencesOnDay(occurrences, cell.date), areas, cell.date);
                const isToday = cell.date === today;
                const isSel = cell.date === selected;
                return (
                  <td key={cell.date}>
                    <button
                      type="button"
                      className={`cal-mini-day ${cell.inMonth ? "" : "is-out"} ${isToday ? "is-today" : ""} ${isSel ? "is-selected" : ""}`}
                      aria-pressed={isSel}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${dayLabel(cell.date)}, ${countLabel(list.length)}`}
                      onClick={() => setPicked(cell.date)}
                    >
                      <span className="cal-mini-num">{parseYmd(cell.date).d}</span>
                      <span className="cal-mini-dots" aria-hidden="true">
                        {list.slice(0, 3).map((o) => (
                          <span key={o.key} className="cal-dot" style={areaCss(colorOf(o, areas))} />
                        ))}
                        {list.length > 3 && <span className="cal-dot-plus">+</span>}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <section className="cal-day-list" aria-labelledby="cal-day-list-title">
        <h3 className="cal-agenda-day is-static" id="cal-day-list-title">
          {selected === today ? "Hoy · " : ""}
          {dayLabel(selected)}
        </h3>
        {dayList.length ? (
          <ul className="cal-agenda-list">
            {dayList.map((o) => (
              <AgendaRow key={o.key} o={o} areas={areas} onOpen={onOpen} />
            ))}
          </ul>
        ) : (
          <p className="cal-help cal-day-empty">Sin actividades este día.</p>
        )}
      </section>
    </div>
  );
}

/** Diálogo del día (lista completa de una celda o de "+n más"). */
export function DayDialog({
  date,
  occurrences,
  areas,
  today,
  onClose,
  onOpen,
}: {
  date: Ymd;
  occurrences: Occurrence[];
  areas: readonly Area[];
  today: Ymd;
  onClose: () => void;
  onOpen: (o: Occurrence) => void;
}) {
  const list = sortDay(occurrencesOnDay(occurrences, date), areas, date);
  return (
    <CalDialog variant="center" onClose={onClose} title={`${date === today ? "Hoy · " : ""}${dayLabel(date)}`}>
      {list.length ? (
        <ul className="cal-agenda-list cal-day-dialog-list">
          {list.map((o) => (
            <AgendaRow key={o.key} o={o} areas={areas} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className="cal-help">Sin actividades este día.</p>
      )}
    </CalDialog>
  );
}
