"use client";

// /calendario/mis-actividades (16b §5.6, 18b §2.2): actividades de mis áreas.
// "Responsable" (editables según permisos, con acciones rápidas) y "Participa"
// (solo lectura: participar no da edición).

import { useEffect, useRef, useState } from "react";
import { Ban, CalendarX2, Ellipsis, Info, Pencil, Tags, Trash2 } from "lucide-react";
import { areaById } from "@/lib/calendar/areas";
import { canCreateEvents, myActivities } from "@/lib/calendar/calendar";
import { CALENDAR_ERROR_MESSAGES } from "@/lib/calendar/errors";
import { useCalendarEvents } from "@/lib/calendar/events-client";
import { addDays, addMonthsClamped, firstOfMonth, lastOfMonth } from "@/lib/shared/dates";
import type { Area, Occurrence } from "@/lib/shared/types";
import { AgendaList } from "./agenda-view";
import { AreaChip } from "./area-badges";
import { CreateFab, LoadErrorBody, OfflineBanner } from "./calendar-screen";
import { eventActions } from "./event-actions";
import { useEventSheets } from "./event-sheets";
import { MOBILE_QUERY, useMedia } from "./hooks";
import { shortDateYear } from "./labels";
import { EmptyState, PageHeader, Skeleton } from "./ui";
import { useCalendarBase, type CalendarBase } from "./use-calendar-base";

function RowMenu({
  o,
  base,
  onEdit,
  onCancel,
  onArchive,
}: {
  o: Occurrence;
  base: CalendarBase;
  onEdit: () => void;
  onCancel: () => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const a = eventActions(base.actor, o, base.areas, base.today, base.offline);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const item = (label: string, Icon: typeof Pencil, enabled: boolean, run: () => void, danger?: boolean) => (
    <button
      type="button"
      role="menuitem"
      className={`cal-menu-item ${danger ? "cal-menu-danger" : ""}`}
      aria-disabled={!enabled || undefined}
      onClick={() => {
        if (!enabled) return;
        setOpen(false);
        run();
      }}
    >
      <Icon size={16} aria-hidden="true" /> {label}
    </button>
  );
  return (
    <div className="cal-menu cal-row-menu" ref={ref}>
      <button
        type="button"
        className="button-ghost cal-btn-icon cal-row-menu-btn"
        aria-label={`Acciones de ${o.event.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="cal-menu-list" role="menu">
          {item("Editar", Pencil, a.canEdit, onEdit)}
          {item("Cancelar", Ban, a.canCancel, onCancel)}
          {item("Eliminar", Trash2, a.canArchive, onArchive, true)}
        </div>
      )}
    </div>
  );
}

export function MyActivitiesScreen() {
  const [attempt, setAttempt] = useState(0);
  return <MyActivitiesInner key={attempt} onRetry={() => setAttempt((n) => n + 1)} />;
}

function MyActivitiesInner({ onRetry }: { onRetry: () => void }) {
  const base = useCalendarBase();
  const { actor, areas, today, now, offline } = base;
  const [tab, setTab] = useState<"responsable" | "participa">("responsable");
  const [showPast, setShowPast] = useState(false);
  const mobile = useMedia(MOBILE_QUERY);
  const to = lastOfMonth(addMonthsClamped(today, 1));
  const pastFrom = firstOfMonth(addMonthsClamped(today, -1));
  const { events, loading, error } = useCalendarEvents(pastFrom);
  const sheets = useEventSheets({ base, events, defaultDate: today });
  const myAreas = actor.areaIds.map((id) => areaById(areas, id)).filter((a): a is Area => !!a);

  const header = (
    <PageHeader
      title="Mis actividades"
      subtitle={
        myAreas.length ? (
          <span className="cal-my-areas">
            <strong>Tus áreas:</strong>
            {myAreas.map((a) => (
              <AreaChip key={a.id} area={a} />
            ))}
          </span>
        ) : (
          "Actividades de tus áreas."
        )
      }
    />
  );

  if (error || base.areasError)
    return (
      <div className="cal-screen">
        {header}
        <LoadErrorBody message={error || base.areasError} onRetry={onRetry} />
      </div>
    );
  if (loading || base.areasLoading)
    return (
      <div className="cal-screen">
        {header}
        <div className="panel" role="status" aria-live="polite">
          <span className="cal-sr">Cargando actividades…</span>
          <div className="cal-skel-rows" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} h={64} />
            ))}
          </div>
        </div>
      </div>
    );
  if (!actor.areaIds.length)
    return (
      <div className="cal-screen">
        {header}
        <div className="panel cal-my-empty">
          <EmptyState
            icon={Tags}
            title="Aún no tienes áreas asignadas"
            body="Pide al administrador que te asigne un área para crear y administrar actividades."
          />
        </div>
      </div>
    );

  const upcoming = myActivities(actor, events, areas, today, to, now);
  const past = myActivities(actor, events, areas, pastFrom, addDays(today, -1), now).filter((x) => x.occurrence.date < today);
  const list = upcoming.filter((x) => (tab === "responsable" ? x.role === "responsable" : x.role === "participante"));
  const pastList = past.filter((x) => (tab === "responsable" ? x.role === "responsable" : x.role === "participante"));
  const countR = upcoming.filter((x) => x.role === "responsable").length;
  const countP = upcoming.length - countR;
  const canCreate = canCreateEvents(actor, areas);
  const showFab = mobile && canCreate;

  return (
    <div className={`cal-screen${showFab ? " has-fab" : ""}`}>
      {header}
      {offline && <OfflineBanner />}
      <div className="cal-my-toolbar">
        <div className="cal-segmented cal-my-tabs" role="group" aria-label="Rol de tu área">
          <button type="button" aria-pressed={tab === "responsable"} onClick={() => setTab("responsable")}>
            Responsable · <span className="cal-num">{countR}</span>
          </button>
          <button type="button" aria-pressed={tab === "participa"} onClick={() => setTab("participa")}>
            Participa · <span className="cal-num">{countP}</span>
          </button>
        </div>
        <p className="cal-help-13">Próximas, hasta el {shortDateYear(to)}.</p>
      </div>
      {tab === "participa" && (
        <p className="cal-note cal-my-note">
          <Info size={14} aria-hidden="true" />
          <span>Tu área participa, pero la organiza otra área. Solo puedes verlas.</span>
        </p>
      )}
      <div className="cal-agenda-wrap cal-my-list">
        {list.length ? (
          <AgendaList
            ariaLabel={tab === "responsable" ? "Actividades donde tu área es responsable" : "Actividades donde tu área participa"}
            occurrences={list.map((x) => x.occurrence)}
            areas={areas}
            today={today}
            from={today}
            to={to}
            onOpen={sheets.openDetail}
            trailing={
              tab === "responsable"
                ? (o) => (
                    <RowMenu
                      o={o}
                      base={base}
                      onEdit={() => sheets.openEdit(o)}
                      onCancel={() => sheets.openCancel(o)}
                      onArchive={() => sheets.openArchive(o)}
                    />
                  )
                : undefined
            }
          />
        ) : (
          <div className="panel">
            {tab === "responsable" ? (
              <EmptyState
                icon={CalendarX2}
                title="Tus áreas no tienen actividades próximas"
                action={
                  canCreate && !offline ? (
                    <button type="button" className="button-primary" onClick={sheets.openCreate}>
                      Crear actividad
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState icon={CalendarX2} title="Tu área no participa en actividades próximas" />
            )}
          </div>
        )}
        {pastList.length > 0 && (
          <div className="cal-my-past">
            <button type="button" className="cal-toggle" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
              {showPast ? "Ocultar pasadas" : `Ver pasadas (${pastList.length})`}
            </button>
            {showPast && (
              <AgendaList
                ariaLabel="Actividades pasadas"
                occurrences={pastList.map((x) => x.occurrence)}
                areas={areas}
                today={today}
                from={pastFrom}
                to={addDays(today, -1)}
                onOpen={sheets.openDetail}
              />
            )}
          </div>
        )}
      </div>
      {showFab && <CreateFab onCreate={sheets.openCreate} disabledReason={offline ? CALENDAR_ERROR_MESSAGES.offline : undefined} />}
      {sheets.sheets}
    </div>
  );
}
