"use client";

// /preview/calendario/mis-actividades (16b §5.6): actividades de mis áreas,
// "Responsable" (editables, con acciones rápidas) y "Participa" (solo lectura).

import { useEffect, useRef, useState } from "react";
import { Ban, CalendarX2, Ellipsis, Info, Pencil, Tags, Trash2 } from "lucide-react";
import { areaById } from "@/lib/suite-preview/areas";
import { canCreateEvents, myActivities } from "@/lib/suite-preview/calendar";
import { DEMO_NOW, DEMO_TODAY } from "@/lib/suite-preview/clock";
import { addDays, addMonthsClamped, firstOfMonth, lastOfMonth } from "@/lib/suite-preview/dates";
import type { Area, Occurrence } from "@/lib/suite-preview/types";
import { EmptyState, ErrorState, Panel, SkeletonRows } from "@/components/finance-preview/ui";
import { AreaChip, PageHeader } from "../primitives";
import { useSuite } from "../provider";
import { replaceQueryParam, useQueryParam } from "../use-query";
import { AgendaList } from "./agenda-view";
import { useEventSheets } from "./event-sheets";
import { shortDateYear } from "./labels";
import { eventActions } from "./permissions";

function RowMenu({
  o,
  areas,
  onEdit,
  onCancel,
  onArchive,
}: {
  o: Occurrence;
  areas: readonly Area[];
  onEdit: () => void;
  onCancel: () => void;
  onArchive: () => void;
}) {
  const { profile } = useSuite();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const a = eventActions(profile, o, areas, DEMO_TODAY);
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
      className={`fx-menu-item ${danger ? "sx-menu-danger" : ""}`}
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
    <div className="fx-menu sx-cal-row-menu" ref={ref}>
      <button
        type="button"
        className="fx-btn fx-btn-ghost fx-btn-icon sx-cal-row-menu-btn"
        aria-label={`Acciones de ${o.event.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="fx-menu-list" role="menu">
          {item("Editar", Pencil, a.canEdit, onEdit)}
          {item("Cancelar", Ban, a.canCancel, onCancel)}
          {item("Eliminar", Trash2, a.canArchive, onArchive, true)}
        </div>
      )}
    </div>
  );
}

export function MyActivitiesScreen() {
  const { profile, state } = useSuite();
  const estado = useQueryParam("estado");
  const [tab, setTab] = useState<"responsable" | "participa">("responsable");
  const [showPast, setShowPast] = useState(false);
  const today = DEMO_TODAY;
  const to = lastOfMonth(addMonthsClamped(today, 1));
  const pastFrom = firstOfMonth(addMonthsClamped(today, -1));
  const sheets = useEventSheets({ defaultDate: today });
  const areas = state.areas;
  const myAreas = (profile?.areaIds ?? []).map((id) => areaById(areas, id)).filter((a): a is Area => !!a);

  const header = (
    <PageHeader
      title="Mis actividades"
      subtitle={
        myAreas.length ? (
          <span className="sx-my-areas">
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

  if (estado === "cargando")
    return (
      <>
        {header}
        <Panel>
          <SkeletonRows rows={5} h={64} />
        </Panel>
      </>
    );
  if (estado === "error")
    return (
      <>
        {header}
        <Panel>
          <ErrorState title="No pudimos cargar tus actividades" onRetry={() => replaceQueryParam("estado", null)} />
        </Panel>
      </>
    );
  if (!profile || !myAreas.length)
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            icon={Tags}
            title="Aún no tienes áreas asignadas"
            body="Pide al administrador que te asigne un área para crear y administrar actividades."
          />
        </Panel>
        {sheets.sheets}
      </>
    );

  const upcoming = estado === "vacio" ? [] : myActivities(profile, state.events, areas, today, to, DEMO_NOW);
  const past = estado === "vacio" ? [] : myActivities(profile, state.events, areas, pastFrom, addDays(today, -1), DEMO_NOW).filter((x) => x.occurrence.date < today);
  const list = tab === "responsable" ? upcoming.filter((x) => x.role === "responsable") : upcoming.filter((x) => x.role === "participante");
  const pastList = tab === "responsable" ? past.filter((x) => x.role === "responsable") : past.filter((x) => x.role === "participante");
  const countR = upcoming.filter((x) => x.role === "responsable").length;
  const countP = upcoming.length - countR;
  const canCreate = canCreateEvents(profile, areas);

  return (
    <>
      {header}
      <div className="sx-my-toolbar">
        <div className="fx-segmented sx-my-tabs" role="group" aria-label="Rol de tu área">
          <button type="button" aria-pressed={tab === "responsable"} onClick={() => setTab("responsable")}>
            Responsable · <span className="fx-num">{countR}</span>
          </button>
          <button type="button" aria-pressed={tab === "participa"} onClick={() => setTab("participa")}>
            Participa · <span className="fx-num">{countP}</span>
          </button>
        </div>
        <p className="fx-help-13">Próximas, hasta el {shortDateYear(to)}.</p>
      </div>
      {tab === "participa" && (
        <p className="sx-note sx-my-note">
          <Info size={14} aria-hidden="true" />
          <span>Tu área participa, pero la organiza otra área. Solo puedes verlas.</span>
        </p>
      )}
      <div className="sx-agenda-wrap sx-my-list">
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
                      areas={areas}
                      onEdit={() => sheets.openEdit(o)}
                      onCancel={() => sheets.openCancel(o)}
                      onArchive={() => sheets.openArchive(o)}
                    />
                  )
                : undefined
            }
          />
        ) : (
          <Panel>
            {tab === "responsable" ? (
              <EmptyState
                icon={CalendarX2}
                title="Tus áreas no tienen actividades próximas"
                action={
                  canCreate ? (
                    <button type="button" className="fx-btn fx-btn-primary" onClick={sheets.openCreate}>
                      Crear actividad
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState icon={CalendarX2} title="Tu área no participa en actividades próximas" />
            )}
          </Panel>
        )}
        {pastList.length > 0 && (
          <div className="sx-my-past">
            <button type="button" className="fx-toggle" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
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
      {sheets.sheets}
    </>
  );
}
