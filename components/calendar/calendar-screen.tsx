"use client";

// /calendario: Calendario global (16b §5.1–5.5, 18b §2.1–2.2).
// Estado en la URL: ?vista=mes|semana|agenda&fecha=YYYY-MM-DD&areas=a,b&solo=1
// ?crear=1 abre el formulario (atajo "+ Crear" de la barra móvil).
// Mes por defecto en escritorio; Agenda por defecto en móvil (<768), donde
// Semana no existe.

import { useEffect, useId, useMemo, useState } from "react";
import { CalendarX2, Eye, EyeOff, Plus, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { canCreateEvents, filterByAreas, monthGrid, weekRange } from "@/lib/calendar/calendar";
import { CALENDAR_ERROR_MESSAGES } from "@/lib/calendar/errors";
import { useCalendarEvents } from "@/lib/calendar/events-client";
import { occurrencesInRange } from "@/lib/shared/calendar-core";
import { addDays, addMonthsClamped, compareLocal, firstOfMonth, isValidYmd, lastOfMonth, monthTitle, parseYmd } from "@/lib/shared/dates";
import type { Area, Occurrence, Ymd } from "@/lib/shared/types";
import { AgendaList } from "./agenda-view";
import { AreaSwatch } from "./area-badges";
import { useEventSheets } from "./event-sheets";
import { DESKTOP_QUERY, MOBILE_QUERY, useMedia, WIDE_QUERY } from "./hooks";
import { monthName, weekTitle } from "./labels";
import { DayDialog, MonthGrid, MonthGridCompact } from "./month-view";
import { AreaFilter, CalendarToolbar, NO_AREAS, type AreaFilterOption, type CalendarView } from "./toolbar";
import { EmptyState, ErrorState, InlineNotice, Skeleton } from "./ui";
import { useCalendarBase } from "./use-calendar-base";
import { replaceQueryParam, useQueryParam } from "./use-query";
import { WeekGrid } from "./week-view";

function parseView(v: string | null): CalendarView | null {
  return v === "mes" || v === "semana" || v === "agenda" ? v : null;
}

/** Conteo por área en el período (responsable, o también participante si no es "solo responsable"). */
export function areaOptions(list: readonly Occurrence[], areas: readonly Area[], onlyResponsible: boolean): AreaFilterOption[] {
  const count = (id: string) =>
    list.filter((o) => o.event.responsibleAreaId === id || (!onlyResponsible && o.event.participantAreaIds.includes(id))).length;
  const active = areas.filter((a) => a.active).map((area) => ({ area, count: count(area.id) }));
  const inactive = areas
    .filter((a) => !a.active)
    .map((area) => ({ area, count: count(area.id) }))
    .filter((x) => x.count > 0);
  return [...active, ...inactive];
}

function LoadingBody({ agenda }: { agenda: boolean }) {
  return (
    <div className="panel cal-panel" role="status" aria-live="polite">
      <span className="cal-sr">Cargando actividades…</span>
      <div className="cal-skeleton-wrap" aria-hidden="true">
        {agenda ? (
          Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="cal-skel-group">
              <Skeleton h={18} w={200} />
              <Skeleton h={64} />
              <Skeleton h={64} />
            </div>
          ))
        ) : (
          <div className="cal-skel-grid">
            {Array.from({ length: 42 }, (_, i) => (
              <div key={i} className="cal-skel-cell">
                <Skeleton h={14} w={18} />
                {i % 5 === 1 && <Skeleton h={22} style={{ marginTop: 8 }} />}
                {i % 7 === 3 && <Skeleton h={22} style={{ marginTop: 4 }} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function LoadErrorBody({ message, onRetry }: { message: string; onRetry: () => void }) {
  if (message === CALENDAR_ERROR_MESSAGES.loadPermission) {
    return (
      <div className="panel">
        <EmptyState
          icon={ShieldAlert}
          title="Ya no tienes acceso a esta información"
          body="Puede que tus permisos hayan cambiado. Recarga la página o pide ayuda al administrador."
          action={
            <button type="button" className="button-secondary" onClick={() => window.location.reload()}>
              <RefreshCw size={16} aria-hidden="true" /> Recargar
            </button>
          }
        />
      </div>
    );
  }
  return (
    <div className="panel">
      <ErrorState title="No pudimos cargar el calendario" body="Revisa tu conexión e inténtalo de nuevo." onRetry={onRetry} />
    </div>
  );
}

export function OfflineBanner() {
  return (
    <InlineNotice tone="warning" icon={WifiOff}>
      {CALENDAR_ERROR_MESSAGES.offline}
    </InlineNotice>
  );
}

/**
 * "+ Crear" flotante del móvil (<768): la barra superior del Calendario no deja
 * "Crear actividad" en la primera pantalla, así que queda fijo abajo a la
 * derecha, 16 px sobre la barra inferior. Solo para quien puede crear.
 */
export function CreateFab({ onCreate, disabledReason }: { onCreate: () => void; disabledReason?: string }) {
  const helpId = useId();
  return (
    <>
      <button
        type="button"
        className="button-primary cal-fab"
        aria-label="Crear actividad"
        aria-disabled={disabledReason ? true : undefined}
        aria-describedby={disabledReason ? helpId : undefined}
        onClick={() => !disabledReason && onCreate()}
      >
        <Plus size={18} aria-hidden="true" /> Crear
      </button>
      {disabledReason && (
        <span className="cal-sr" id={helpId}>
          {disabledReason}
        </span>
      )}
    </>
  );
}

export function CalendarScreen() {
  const [attempt, setAttempt] = useState(0);
  return <CalendarScreenInner key={attempt} onRetry={() => setAttempt((n) => n + 1)} />;
}

function CalendarScreenInner({ onRetry }: { onRetry: () => void }) {
  const base = useCalendarBase();
  const { actor, areas, today, now, offline } = base;
  const mobile = useMedia(MOBILE_QUERY);
  const wide = useMedia(WIDE_QUERY);
  const desktopLg = useMedia(DESKTOP_QUERY);

  const vistaParam = parseView(useQueryParam("vista"));
  const fechaParam = useQueryParam("fecha");
  const areasParam = useQueryParam("areas");
  const soloParam = useQueryParam("solo");
  const crearParam = useQueryParam("crear");

  const views: CalendarView[] = mobile ? ["agenda", "mes"] : ["mes", "semana", "agenda"];
  const view: CalendarView = vistaParam && views.includes(vistaParam) ? vistaParam : mobile ? "agenda" : "mes";
  const anchor: Ymd = fechaParam && isValidYmd(fechaParam) ? fechaParam : today;
  const selected = useMemo(() => (areasParam ? areasParam.split(",").filter(Boolean) : []), [areasParam]);
  const onlyResponsible = soloParam === "1";
  const [showEarlier, setShowEarlier] = useState(false);
  const [legend, setLegend] = useState(true);
  const [day, setDay] = useState<Ymd | null>(null);

  const { y, m } = parseYmd(anchor);
  const isCurrentMonth = firstOfMonth(anchor) === firstOfMonth(today);
  const week = weekRange(anchor);
  const grid = monthGrid(y, m);
  const range =
    view === "mes"
      ? { from: grid[0][0].date, to: grid[grid.length - 1][6].date }
      : view === "semana"
        ? { from: week.from, to: week.to }
        : { from: isCurrentMonth && !showEarlier ? today : firstOfMonth(anchor), to: addDays(lastOfMonth(anchor), 14) };

  const { events, loading, error } = useCalendarEvents(firstOfMonth(range.from));
  const all = occurrencesInRange(events, range.from, range.to, now, areas);
  const options = areaOptions(all, areas, onlyResponsible);
  const filtered = selected.includes(NO_AREAS) ? [] : filterByAreas(all, selected, onlyResponsible);

  const canCreate = canCreateEvents(actor, areas);
  const sheets = useEventSheets({
    base,
    events,
    defaultDate: compareLocal(anchor, today) > 0 ? anchor : today,
    onCreated: (info) => {
      if (compareLocal(info.startDate, range.from) < 0 || compareLocal(info.startDate, range.to) > 0) replaceQueryParam("fecha", info.startDate);
    },
  });
  const { openCreate } = sheets;
  const create = () => {
    if (!offline) openCreate();
  };

  useEffect(() => {
    if (crearParam !== "1" || base.areasLoading) return;
    replaceQueryParam("crear", null);
    if (canCreate && !offline) openCreate();
  }, [crearParam, canCreate, openCreate, offline, base.areasLoading]);

  const setAnchor = (d: Ymd) => replaceQueryParam("fecha", d === today ? null : d);
  const step = (dir: 1 | -1) => {
    setShowEarlier(false);
    if (view === "semana") setAnchor(addDays(anchor, 7 * dir));
    else setAnchor(firstOfMonth(addMonthsClamped(firstOfMonth(anchor), dir)));
  };
  const todayVisible =
    view === "semana" ? compareLocal(today, week.from) >= 0 && compareLocal(today, week.to) <= 0 : isCurrentMonth;
  const title = view === "semana" ? weekTitle(week.from, week.to) : monthTitle(y, m);
  const nowMinutes = (() => {
    const [h, min] = now.slice(11, 16).split(":").map(Number);
    return h * 60 + min;
  })();

  const legendAreas = options.filter((o) => !selected.length || selected.includes(o.area.id));
  const isLoading = loading || base.areasLoading;
  const loadError = error || base.areasError;

  const filter = (
    <AreaFilter
      options={options}
      areas={areas}
      selected={selected}
      onChange={(ids) => replaceQueryParam("areas", ids.length ? ids.join(",") : null)}
      onlyResponsible={onlyResponsible}
      onOnlyResponsible={(v) => replaceQueryParam("solo", v ? "1" : null)}
      mobile={mobile}
      resultCount={filtered.length}
    />
  );

  let body: React.ReactNode;
  if (loadError) {
    body = <LoadErrorBody message={error ? error : CALENDAR_ERROR_MESSAGES.loadNetwork} onRetry={onRetry} />;
  } else if (isLoading) {
    body = <LoadingBody agenda={view === "agenda" || mobile} />;
  } else {
    const empty = filtered.length === 0;
    const filteredOut = empty && all.length > 0 && selected.length > 0;
    const emptyState = filteredOut ? (
      <EmptyState
        icon={CalendarX2}
        title="Ninguna actividad de las áreas elegidas."
        body="Prueba con otras áreas."
        action={
          <button type="button" className="button-secondary" onClick={() => replaceQueryParam("areas", null)}>
            Mostrar todas las áreas
          </button>
        }
      />
    ) : (
      <EmptyState
        icon={CalendarX2}
        title={view === "agenda" ? "No hay actividades próximas." : `No hay actividades en ${monthName(anchor)}`}
        body={canCreate ? "Prueba con otras áreas o crea una actividad." : "Prueba con otras áreas o con otro mes."}
        action={
          canCreate && !offline ? (
            <button type="button" className="button-primary" onClick={create}>
              Crear actividad
            </button>
          ) : undefined
        }
      />
    );

    if (view === "agenda") {
      body = (
        <div className="cal-agenda-wrap">
          {isCurrentMonth && !showEarlier && (
            <button type="button" className="button-ghost cal-earlier" onClick={() => setShowEarlier(true)}>
              Ver días anteriores
            </button>
          )}
          {empty ? (
            <div className="panel">{emptyState}</div>
          ) : (
            <AgendaList
              occurrences={filtered}
              areas={areas}
              today={today}
              from={range.from}
              to={range.to}
              onOpen={sheets.openDetail}
              scrollToToday={showEarlier}
            />
          )}
        </div>
      );
    } else if (view === "mes") {
      body = (
        <div className="cal-month-wrap">
          {mobile ? (
            <MonthGridCompact year={y} month={m} title={title} occurrences={filtered} areas={areas} today={today} onOpen={sheets.openDetail} />
          ) : (
            <div className="panel cal-panel is-flush">
              <MonthGrid
                year={y}
                month={m}
                title={title}
                occurrences={filtered}
                areas={areas}
                today={today}
                maxChips={wide ? 3 : 2}
                showTime={desktopLg}
                onOpen={sheets.openDetail}
                onOpenDay={setDay}
              />
            </div>
          )}
          {empty && <div className="cal-empty-overlay">{emptyState}</div>}
        </div>
      );
    } else {
      body = (
        <div className="cal-month-wrap">
          <div className="panel cal-panel is-flush">
            <WeekGrid days={week.days} occurrences={filtered} areas={areas} today={today} nowMinutes={nowMinutes} onOpen={sheets.openDetail} onOpenDay={setDay} />
          </div>
          {empty && <div className="cal-empty-overlay">{emptyState}</div>}
        </div>
      );
    }
  }

  const showFab = mobile && canCreate;

  return (
    <div className={`cal-screen${showFab ? " has-fab" : ""}`}>
      {offline && <OfflineBanner />}
      <CalendarToolbar
        title={title}
        view={view}
        views={views}
        onView={(v) => replaceQueryParam("vista", v)}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onToday={() => {
          setShowEarlier(false);
          setAnchor(today);
        }}
        todayVisible={todayVisible}
        prevLabel={view === "semana" ? "Semana anterior" : "Mes anterior"}
        nextLabel={view === "semana" ? "Semana siguiente" : "Mes siguiente"}
        filter={filter}
        canCreate={canCreate}
        createDisabledReason={offline ? CALENDAR_ERROR_MESSAGES.offline : undefined}
        onCreate={create}
        canShare={actor.can("calendar.events.manage_all")}
      />
      {!mobile && view !== "agenda" && !isLoading && !loadError && legendAreas.length > 0 && (
        <div className="cal-area-legend">
          {legend && (
            <ul className="cal-legend-list" aria-label="Leyenda de áreas">
              {legendAreas.map(({ area }) => (
                <li key={area.id}>
                  <AreaSwatch color={area.color} size={10} shape="square" />
                  {area.name}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="cal-toggle cal-legend-toggle" onClick={() => setLegend((v) => !v)}>
            {legend ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            {legend ? "Ocultar leyenda" : "Mostrar leyenda"}
          </button>
        </div>
      )}
      {body}
      {day && (
        <DayDialog
          date={day}
          occurrences={filtered}
          areas={areas}
          today={today}
          onClose={() => setDay(null)}
          onOpen={(o) => {
            setDay(null);
            sheets.openDetail(o);
          }}
        />
      )}
      {showFab && <CreateFab onCreate={create} disabledReason={offline ? CALENDAR_ERROR_MESSAGES.offline : undefined} />}
      {sheets.sheets}
    </div>
  );
}
