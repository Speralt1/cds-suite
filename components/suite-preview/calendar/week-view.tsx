"use client";

// Vista Semana (16b §5.4): fila de todo el día / varios días, grilla 00–24 con
// scroll inicial a las 07:00, superposiciones lado a lado (máx. 3 columnas) y
// actividades que cruzan medianoche en dos segmentos ("continúa").

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { areaById } from "@/lib/suite-preview/areas";
import { compareLocal, daysBetween, parseYmd, WEEKDAY_NAMES, weekdayOf } from "@/lib/suite-preview/dates";
import type { Area, Occurrence, Ymd } from "@/lib/suite-preview/types";
import { areaStyle } from "../primitives";
import { occurrenceAria, WEEKDAYS_SHORT } from "./labels";

const HOUR_PX = 44;
const MAX_COLS = 3;

function minutes(t: string | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

interface Segment {
  o: Occurrence;
  day: Ymd;
  start: number;
  end: number;
  continues: boolean;
  continued: boolean;
  col: number;
  cols: number;
}

function segmentsFor(list: readonly Occurrence[], days: readonly Ymd[]): Segment[] {
  const set = new Set(days);
  const out: Segment[] = [];
  for (const o of list) {
    if (o.allDay) continue;
    const s = minutes(o.startTime);
    const overnight = compareLocal(o.endDate, o.date) > 0;
    const e = o.endTime ? minutes(o.endTime) : s + 60;
    if (!overnight) {
      if (set.has(o.date)) out.push({ o, day: o.date, start: s, end: Math.max(e, s + 30), continues: false, continued: false, col: 0, cols: 1 });
    } else {
      if (set.has(o.date)) out.push({ o, day: o.date, start: s, end: 1440, continues: true, continued: false, col: 0, cols: 1 });
      if (set.has(o.endDate)) out.push({ o, day: o.endDate, start: 0, end: Math.max(e, 30), continues: false, continued: true, col: 0, cols: 1 });
    }
  }
  // Columnas por grupo de superposición (por día).
  for (const day of days) {
    const segs = out.filter((x) => x.day === day).sort((a, b) => a.start - b.start || b.end - a.end);
    let cluster: Segment[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
      cluster.forEach((c) => (c.cols = cols));
      cluster = [];
    };
    for (const seg of segs) {
      if (seg.start >= clusterEnd && cluster.length) flush();
      const used = new Set(cluster.filter((c) => c.end > seg.start).map((c) => c.col));
      let col = 0;
      while (used.has(col)) col++;
      seg.col = col;
      cluster.push(seg);
      clusterEnd = Math.max(clusterEnd, seg.end);
    }
    if (cluster.length) flush();
  }
  return out;
}

interface AllDayBar {
  o: Occurrence;
  startIdx: number;
  span: number;
  lane: number;
  first: boolean;
  continuesNext: boolean;
}

function allDayBars(list: readonly Occurrence[], from: Ymd): AllDayBar[] {
  const bars: AllDayBar[] = [];
  const laneEnds: number[] = [];
  for (const o of list.filter((x) => x.allDay)) {
    const startIdx = Math.max(0, daysBetween(from, o.date));
    const endIdx = Math.min(6, daysBetween(from, o.endDate));
    if (endIdx < 0 || startIdx > 6) continue;
    let lane = laneEnds.findIndex((end) => end < startIdx);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endIdx);
    } else laneEnds[lane] = endIdx;
    bars.push({ o, startIdx, span: endIdx - startIdx + 1, lane, first: daysBetween(from, o.date) >= 0, continuesNext: daysBetween(from, o.endDate) > 6 });
  }
  return bars;
}

export function WeekGrid({
  days,
  occurrences,
  areas,
  today,
  nowMinutes,
  onOpen,
  onOpenDay,
}: {
  days: Ymd[];
  occurrences: Occurrence[];
  areas: readonly Area[];
  today: Ymd;
  nowMinutes: number;
  onOpen: (o: Occurrence) => void;
  onOpenDay: (date: Ymd) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX;
  }, [days]);

  const segs = segmentsFor(occurrences, days);
  const bars = allDayBars(occurrences, days[0]);
  const visibleBars = bars.filter((b) => b.lane < 2);
  const hiddenByDay = days.map((_, i) => bars.filter((b) => b.lane >= 2 && b.startIdx <= i && b.startIdx + b.span - 1 >= i).length);
  const lanes = Math.max(1, Math.min(2, Math.max(0, ...bars.map((b) => b.lane + 1)))) + (hiddenByDay.some(Boolean) ? 1 : 0);

  return (
    <div className="sx-week" role="group" aria-label="Semana">
      <div className="sx-week-head" aria-hidden="true">
        <span className="sx-week-gutter" />
        {days.map((d) => (
          <span key={d} className={`sx-week-dayhead ${d === today ? "is-today" : ""}`}>
            <span className="sx-week-wd">{WEEKDAYS_SHORT[weekdayOf(d)]}</span>
            <span className="sx-week-dn">{parseYmd(d).d}</span>
          </span>
        ))}
      </div>
      <div className="sx-week-allday">
        <span className="sx-week-gutter sx-week-allday-label">Todo el día</span>
        <div className="sx-week-allday-grid" style={{ gridTemplateRows: `repeat(${lanes}, 24px)` }}>
          {visibleBars.map((b) => {
            const color = areaById(areas, b.o.event.responsibleAreaId)?.color ?? "pizarra";
            return (
              <button
                key={b.o.key}
                type="button"
                className={`sx-allday-bar ${b.first ? "" : "is-cont"} ${b.o.status === "cancelada" ? "is-cancelled" : b.o.status === "realizada" ? "is-done" : ""}`}
                style={{ ...areaStyle(color), gridColumn: `${b.startIdx + 1} / span ${b.span}`, gridRow: b.lane + 1 }}
                aria-label={occurrenceAria(b.o, areas)}
                onClick={() => onOpen(b.o)}
              >
                <span className="sx-ev-chip-title">{b.o.event.title}</span>
                {b.continuesNext && <ChevronRight size={12} aria-hidden="true" />}
              </button>
            );
          })}
          {hiddenByDay.map((n, i) =>
            n > 0 ? (
              <button key={days[i]} type="button" className="sx-more-link" style={{ gridColumn: i + 1, gridRow: 3 }} onClick={() => onOpenDay(days[i])}>
                +{n}
              </button>
            ) : null,
          )}
        </div>
      </div>
      <div className="sx-week-scroll" ref={scrollRef} tabIndex={0} aria-label="Horario de la semana (desplazable)">
        <div className="sx-week-body" style={{ height: 24 * HOUR_PX }}>
          <div className="sx-week-hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="sx-week-hour" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const daySegs = segs.filter((s) => s.day === d);
            const overflow = daySegs.filter((s) => s.cols > MAX_COLS && s.col >= MAX_COLS - 1);
            return (
              <div key={d} className={`sx-week-col ${d === today ? "is-today" : ""}`} aria-label={`${WEEKDAY_NAMES[weekdayOf(d)]} ${parseYmd(d).d}`} role="group">
                {daySegs
                  .filter((s) => !(s.cols > MAX_COLS && s.col >= MAX_COLS - 1))
                  .map((s) => {
                    const cols = Math.min(s.cols, MAX_COLS);
                    const height = Math.max(22, ((s.end - s.start) / 60) * HOUR_PX);
                    const color = areaById(areas, s.o.event.responsibleAreaId)?.color ?? "pizarra";
                    const area = areaById(areas, s.o.event.responsibleAreaId);
                    return (
                      <button
                        key={`${s.o.key}-${s.day}`}
                        type="button"
                        className={`sx-week-block ${s.o.status === "cancelada" ? "is-cancelled" : s.o.status === "realizada" ? "is-done" : ""} ${s.continued ? "is-continued" : ""}`}
                        style={{
                          ...areaStyle(color),
                          top: (s.start / 60) * HOUR_PX,
                          height,
                          left: `calc(${(s.col / cols) * 100}% + 2px)`,
                          width: `calc(${100 / cols}% - 4px)`,
                        }}
                        aria-label={`${occurrenceAria(s.o, areas)}${s.continues ? ", continúa al día siguiente" : ""}${s.continued ? ", continuación desde el día anterior" : ""}`}
                        onClick={() => onOpen(s.o)}
                      >
                        <span className="sx-week-block-title">
                          {s.o.event.title}
                          {s.o.event.visibility === "team" && <Lock size={10} aria-hidden="true" />}
                        </span>
                        <span className="sx-week-block-time fx-num">
                          {s.continued ? `hasta ${s.o.endTime}` : `${s.o.startTime}${s.o.endTime ? `–${s.o.endTime}` : ""}`}
                        </span>
                        {height >= 64 && area && <span className="sx-week-block-area">{area.name}</span>}
                        {s.continues && (
                          <span className="sx-week-block-cont">
                            continúa <ChevronDown size={10} aria-hidden="true" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                {overflow.length > 0 && (
                  <button
                    type="button"
                    className="sx-week-more"
                    style={{ top: (Math.min(...overflow.map((s) => s.start)) / 60) * HOUR_PX, left: `${((MAX_COLS - 1) / MAX_COLS) * 100}%`, width: `${100 / MAX_COLS}%` }}
                    onClick={() => onOpenDay(d)}
                  >
                    +{overflow.length}
                  </button>
                )}
                {d === today && <span className="sx-now-line" style={{ top: (nowMinutes / 60) * HOUR_PX }} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
