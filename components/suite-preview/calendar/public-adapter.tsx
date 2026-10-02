"use client";

// Adaptador del calendario público: lee el store de la sesión (useSuite) y el
// enlace presentado (?t=), llama a resolvePublicCalendar (proyección por lista
// blanca) y entrega a components/suite-preview/public/** SOLO ese resultado
// convertido en un modelo de presentación (etiquetas de fecha ya calculadas).

import { useMemo } from "react";
import { monthGrid } from "@/lib/suite-preview/calendar";
import { DEMO_NOW, DEMO_TODAY } from "@/lib/suite-preview/clock";
import { addDays, compareLocal, dayLabel, daysBetween, monthTitle, parseYmd, shiftMonth, ymd, daysInMonth, MONTH_NAMES } from "@/lib/suite-preview/dates";
import { DEFAULT_PRESENTED_TOKEN, resolvePublicCalendar, sortPublicEvents } from "@/lib/suite-preview/share";
import type { PublicCalendar, PublicEvent, Ymd } from "@/lib/suite-preview/types";
import type { PublicCalendarModel, PublicDayInfo, PublicEventView, PublicMonth } from "../public/model";
import { PublicCalendarPage } from "../public/public-calendar";
import { useSuite } from "../provider";
import { replaceQueryParam, useQueryParam } from "../use-query";
import { occurrenceWhen, spokenTime } from "./labels";

function whenOf(e: PublicEvent): string {
  return occurrenceWhen({
    date: e.startDate,
    endDate: e.endDate,
    allDay: e.allDay,
    startTime: e.startTime ?? undefined,
    endTime: e.endTime ?? undefined,
  });
}

/** Modelo de presentación a partir de la proyección pública (nunca de actividades internas). */
export function buildPublicModel(cal: PublicCalendar, today: Ymd): PublicCalendarModel {
  const events: PublicEventView[] = sortPublicEvents(cal.events).map((e) => {
    const span = Math.max(0, daysBetween(e.startDate, e.endDate));
    const time = spokenTime({ allDay: e.allDay, startTime: e.startTime ?? undefined, endTime: e.endTime ?? undefined });
    return {
      event: e,
      when: whenOf(e),
      aria: `${e.title}, ${dayLabel(e.startDate)}, ${time}, ${e.responsibleArea.name}${e.status === "cancelada" ? ", cancelada" : ""}`,
      spans: Array.from({ length: span + 1 }, (_, i) => addDays(e.startDate, i)),
    };
  });

  const start = parseYmd(cal.range.from);
  const end = parseYmd(cal.range.to);
  const months: PublicMonth[] = [];
  for (let i = 0; i < 24; i++) {
    const { y, m } = shiftMonth(start.y, start.m, i);
    if (y * 12 + m > end.y * 12 + end.m) break;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.push({
      key,
      title: monthTitle(y, m),
      name: MONTH_NAMES[m - 1],
      first: ymd(y, m, 1),
      last: ymd(y, m, daysInMonth(y, m)),
      weeks: monthGrid(y, m).map((w) =>
        w.map((c) => ({ date: c.date, day: parseYmd(c.date).d, inMonth: c.inMonth, isToday: c.date === today })),
      ),
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
  const initialMonth = Math.max(
    0,
    months.findIndex((m) => m.key === today.slice(0, 7)),
  );
  return { churchName: cal.churchName, areas: cal.areas, events, months, days, today, initialMonth };
}

export function PublicCalendarScreen() {
  const { ready, state } = useSuite();
  const t = useQueryParam("t");
  const estado = useQueryParam("estado");
  const presented = t ?? DEFAULT_PRESENTED_TOKEN;
  const cal = useMemo(
    () =>
      ready
        ? resolvePublicCalendar({
            link: state.shareLink,
            events: state.events,
            areas: state.areas,
            presentedToken: presented,
            today: DEMO_TODAY,
            now: DEMO_NOW,
          })
        : null,
    [ready, state.shareLink, state.events, state.areas, presented],
  );
  const model = useMemo(() => {
    if (!cal) return null;
    const base = buildPublicModel(cal, DEMO_TODAY);
    return estado === "vacio" ? { ...base, events: [] } : base;
  }, [cal, estado]);

  if (!ready || estado === "cargando") return <PublicCalendarPage status="loading" model={null} />;
  if (!cal) return <PublicCalendarPage status="unavailable" model={null} />;
  if (estado === "error") return <PublicCalendarPage status="error" model={null} onRetry={() => replaceQueryParam("estado", null)} />;
  return <PublicCalendarPage status="ready" model={model} />;
}
