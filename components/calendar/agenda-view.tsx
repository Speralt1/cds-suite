"use client";

// Vista Agenda (16b §5.5): solo días con actividades, header de día sticky y
// ancla "Hoy" (si hoy no tiene actividades se inserta igual con "Sin actividades hoy.").

import { useEffect, useRef } from "react";
import { agendaGroups } from "@/lib/calendar/calendar";
import { compareLocal, dayLabel } from "@/lib/shared/dates";
import type { Area, Occurrence, Ymd } from "@/lib/shared/types";
import { AgendaRow } from "./event-bits";

export function AgendaList({
  occurrences,
  areas,
  today,
  from,
  to,
  onOpen,
  trailing,
  scrollToToday,
  ariaLabel = "Agenda",
}: {
  occurrences: Occurrence[];
  areas: readonly Area[];
  today: Ymd;
  from: Ymd;
  to: Ymd;
  onOpen: (o: Occurrence) => void;
  trailing?: (o: Occurrence) => React.ReactNode;
  scrollToToday?: boolean;
  ariaLabel?: string;
}) {
  const groups = agendaGroups(occurrences, today, from, areas);
  const todayInRange = compareLocal(today, from) >= 0 && compareLocal(today, to) <= 0;
  if (todayInRange && !groups.some((g) => g.isToday)) {
    const idx = groups.findIndex((g) => compareLocal(g.date, today) > 0);
    const entry = { date: today, label: `Hoy · ${dayLabel(today)}`, isToday: true, items: [] as Occurrence[] };
    if (idx === -1) groups.push(entry);
    else groups.splice(idx, 0, entry);
  }
  const todayRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (scrollToToday && todayRef.current && typeof todayRef.current.scrollIntoView === "function") {
      todayRef.current.scrollIntoView({ block: "start" });
    }
  }, [scrollToToday]);

  return (
    <div className="cal-agenda" aria-label={ariaLabel} role="region">
      {groups.map((g) => (
        <section key={g.date} className="cal-agenda-group" ref={g.isToday ? todayRef : undefined} aria-labelledby={`cal-day-${g.date}`}>
          <h3 className={`cal-agenda-day ${g.isToday ? "is-today" : ""}`} id={`cal-day-${g.date}`}>
            {g.label}
          </h3>
          {g.items.length ? (
            <ul className="cal-agenda-list">
              {g.items.map((o) => (
                <AgendaRow key={o.key} o={o} areas={areas} onOpen={onOpen} trailing={trailing?.(o)} />
              ))}
            </ul>
          ) : (
            <p className="cal-help cal-day-empty">Sin actividades hoy.</p>
          )}
        </section>
      ))}
    </div>
  );
}
