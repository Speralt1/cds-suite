"use client";

// Vista Mes (16b §5.3) y su variante compacta móvil (§5.5).
// Accesibilidad: se usa la alternativa aceptada en 16b §13.2: tabla semántica
// con un botón por día (abre el popover del día) y chips <button> con
// aria-label completo. Hoy lleva aria-current="date".

import { useState } from "react";
import { areaById } from "@/lib/suite-preview/areas";
import { monthGrid, occurrencesOnDay } from "@/lib/suite-preview/calendar";
import { compareLocal, dayLabel, parseYmd, WEEKDAY_HEADERS_MON_FIRST } from "@/lib/suite-preview/dates";
import type { Area, Occurrence, Ymd } from "@/lib/suite-preview/types";
import { Sheet } from "@/components/finance-preview/ui";
import { areaStyle } from "../primitives";
import { AgendaRow, MonthChip } from "./event-bits";

const WEEKDAY_FULL = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** Orden dentro del día: todo el día, por hora de inicio y por nombre de área. */
export function sortDay(list: Occurrence[], areas: readonly Area[], date: Ymd): Occurrence[] {
  return [...list].sort((a, b) => {
    const ac = compareLocal(a.date, date) < 0 ? 0 : 1;
    const bc = compareLocal(b.date, date) < 0 ? 0 : 1;
    return (
      Number(b.allDay) - Number(a.allDay) ||
      ac - bc ||
      compareLocal(a.startTime ?? "", b.startTime ?? "") ||
      (areaById(areas, a.event.responsibleAreaId)?.name ?? "").localeCompare(areaById(areas, b.event.responsibleAreaId)?.name ?? "", "es")
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
    <table className="sx-month" aria-label={title}>
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
                  <div className="sx-month-cell">
                    <button
                      type="button"
                      className="sx-day-num"
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${dayLabel(cell.date)}, ${countLabel(list.length)}`}
                      onClick={() => onOpenDay(cell.date)}
                    >
                      {parseYmd(cell.date).d}
                    </button>
                    {shown.length > 0 && (
                      <ul className="sx-month-chips">
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
                        className="sx-more-link"
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
    <div className="sx-month-compact">
      <table className="sx-mini-month" aria-label={title}>
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
                      className={`sx-mini-day ${cell.inMonth ? "" : "is-out"} ${isToday ? "is-today" : ""} ${isSel ? "is-selected" : ""}`}
                      aria-pressed={isSel}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${dayLabel(cell.date)}, ${countLabel(list.length)}`}
                      onClick={() => setPicked(cell.date)}
                    >
                      <span className="sx-mini-num">{parseYmd(cell.date).d}</span>
                      <span className="sx-mini-dots" aria-hidden="true">
                        {list.slice(0, 3).map((o) => (
                          <span key={o.key} className="sx-dot" style={areaStyle(areaById(areas, o.event.responsibleAreaId)?.color ?? "pizarra")} />
                        ))}
                        {list.length > 3 && <span className="sx-dot-plus">+</span>}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <section className="sx-day-list" aria-labelledby="sx-day-list-title">
        <h3 className="sx-agenda-day is-static" id="sx-day-list-title">
          {selected === today ? "Hoy · " : ""}
          {dayLabel(selected)}
        </h3>
        {dayList.length ? (
          <ul className="sx-agenda-list">
            {dayList.map((o) => (
              <AgendaRow key={o.key} o={o} areas={areas} onOpen={onOpen} />
            ))}
          </ul>
        ) : (
          <p className="fx-help-13 sx-day-empty">Sin actividades este día.</p>
        )}
      </section>
    </div>
  );
}

/** Popover del día (dialog centrado con foco atrapado y Esc). */
export function DayDialog({
  date,
  occurrences,
  areas,
  today,
  onClose,
  onOpen,
}: {
  date: Ymd | null;
  occurrences: Occurrence[];
  areas: readonly Area[];
  today: Ymd;
  onClose: () => void;
  onOpen: (o: Occurrence) => void;
}) {
  const list = date ? sortDay(occurrencesOnDay(occurrences, date), areas, date) : [];
  return (
    <Sheet
      open={!!date}
      onClose={onClose}
      variant="center"
      labelId="sx-day-dialog-title"
      title={date ? `${date === today ? "Hoy · " : ""}${dayLabel(date)}` : ""}
    >
      {date &&
        (list.length ? (
          <ul className="sx-agenda-list sx-day-dialog-list">
            {list.map((o) => (
              <AgendaRow key={o.key} o={o} areas={areas} onOpen={onOpen} />
            ))}
          </ul>
        ) : (
          <p className="fx-help-13">Sin actividades este día.</p>
        ))}
    </Sheet>
  );
}
