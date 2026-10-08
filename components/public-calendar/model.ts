// Modelo de presentación del calendario público. Se arma SOLO a partir de la
// proyección pública (`PublicCalendar`, lista blanca de lib/shared): nunca
// recibe actividades internas. Puro: solo importa lib/shared.

import {
  addDays,
  compareLocal,
  dayLabel,
  daysBetween,
  daysInMonth,
  MONTH_NAMES,
  monthTitle,
  parseYmd,
  shiftMonth,
  startOfWeek,
  ymd,
} from "@/lib/shared/dates";
import { sortPublicEvents } from "@/lib/shared/public-calendar";
import type { PublicArea, PublicCalendar, PublicEvent, Ymd } from "@/lib/shared/types";

export interface PublicDayInfo {
  /** "domingo 4 de octubre" */
  label: string;
  isToday: boolean;
  isTomorrow: boolean;
}

export interface PublicMonthCell {
  date: Ymd;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

export interface PublicMonth {
  /** "2026-10" */
  key: string;
  /** "Octubre 2026" */
  title: string;
  /** "octubre" */
  name: string;
  first: Ymd;
  last: Ymd;
  weeks: PublicMonthCell[][];
}

export interface PublicEventView {
  event: PublicEvent;
  /** "viernes 9 de octubre · 20:00 – 22:00" */
  when: string;
  /** aria-label completo de la fila. */
  aria: string;
  /** Fechas que ocupa (varios días / pasada la medianoche). */
  spans: Ymd[];
}

export interface PublicCalendarModel {
  churchName: string;
  areas: PublicArea[];
  events: PublicEventView[];
  months: PublicMonth[];
  days: Record<Ymd, PublicDayInfo>;
  today: Ymd;
  initialMonth: number;
}

export type PublicStatus = "loading" | "error" | "unavailable" | "ready";

/** "viernes 9 de octubre · 20:00 – 22:00" (o "Todo el día", o con fin otro día). */
export function publicWhen(e: Pick<PublicEvent, "startDate" | "endDate" | "allDay" | "startTime" | "endTime">): string {
  const multi = compareLocal(e.endDate, e.startDate) > 0;
  if (e.allDay) {
    return multi ? `${dayLabel(e.startDate)} – ${dayLabel(e.endDate)} · Todo el día` : `${dayLabel(e.startDate)} · Todo el día`;
  }
  const time = e.endTime ? `${e.startTime ?? ""} – ${e.endTime}` : (e.startTime ?? "");
  return multi ? `${dayLabel(e.startDate)} · ${time} (termina el ${dayLabel(e.endDate)})` : `${dayLabel(e.startDate)} · ${time}`;
}

/** "11:00 a 13:00" para lectores de pantalla. */
export function spokenTime(e: Pick<PublicEvent, "allDay" | "startTime" | "endTime">): string {
  if (e.allDay) return "todo el día";
  return e.endTime ? `${e.startTime ?? ""} a ${e.endTime}` : (e.startTime ?? "");
}

/** Semanas (lunes a domingo) que cubren el mes. */
export function publicMonthWeeks(y: number, m: number, today: Ymd): PublicMonthCell[][] {
  const first = ymd(y, m, 1);
  const last = ymd(y, m, daysInMonth(y, m));
  const weeks: PublicMonthCell[][] = [];
  for (let d = startOfWeek(first); compareLocal(d, last) <= 0; d = addDays(d, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(d, i);
        return { date, day: parseYmd(date).d, inMonth: date.slice(0, 7) === first.slice(0, 7), isToday: date === today };
      }),
    );
  }
  return weeks;
}

/** Modelo de presentación a partir de la proyección pública. */
export function buildPublicModel(cal: PublicCalendar, today: Ymd): PublicCalendarModel {
  const events: PublicEventView[] = sortPublicEvents(cal.events).map((e) => {
    const span = Math.max(0, Math.min(31, daysBetween(e.startDate, e.endDate)));
    return {
      event: e,
      when: publicWhen(e),
      aria: `${e.title}, ${dayLabel(e.startDate)}, ${spokenTime(e)}, ${e.responsibleArea.name}${e.status === "cancelled" ? ", cancelada" : ""}`,
      spans: Array.from({ length: span + 1 }, (_, i) => addDays(e.startDate, i)),
    };
  });

  const start = parseYmd(cal.range.from);
  const end = parseYmd(cal.range.to);
  const months: PublicMonth[] = [];
  for (let i = 0; i < 24; i++) {
    const { y, m } = shiftMonth(start.y, start.m, i);
    if (y * 12 + m > end.y * 12 + end.m) break;
    months.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      title: monthTitle(y, m),
      name: MONTH_NAMES[m - 1],
      first: ymd(y, m, 1),
      last: ymd(y, m, daysInMonth(y, m)),
      weeks: publicMonthWeeks(y, m, today),
    });
  }

  const days: Record<Ymd, PublicDayInfo> = {};
  const first = months[0]?.weeks[0][0].date ?? cal.range.from;
  const lastWeeks = months[months.length - 1]?.weeks;
  const last = lastWeeks ? lastWeeks[lastWeeks.length - 1][6].date : cal.range.to;
  for (let d = first; compareLocal(d, last) <= 0; d = addDays(d, 1)) {
    const diff = daysBetween(today, d);
    days[d] = { label: dayLabel(d), isToday: diff === 0, isTomorrow: diff === 1 };
  }
  const found = months.findIndex((mo) => mo.key === today.slice(0, 7));
  const initialMonth = found >= 0 ? found : compareLocal(today, cal.range.from) < 0 ? 0 : Math.max(0, months.length - 1);
  return { churchName: cal.churchName, areas: cal.areas, events, months, days, today, initialMonth };
}
