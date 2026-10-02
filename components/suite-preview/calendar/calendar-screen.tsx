"use client";

// /preview/calendario: Calendario global (16b §5.1–5.5, §11, §12).
// Estado en la URL: ?vista=mes|semana|agenda&fecha=YYYY-MM-DD&areas=a,b&solo=1
// ?crear=1 abre el formulario (lo usa el "+ Crear" de la barra inferior).
// ?estado=cargando|vacio|error muestra los estados de la pantalla.

import { useEffect, useMemo, useState } from "react";
import { CalendarX2, Eye, EyeOff } from "lucide-react";
import { activeAreas } from "@/lib/suite-preview/areas";
import { canCreateEvents, filterByAreas, monthGrid, occurrencesInRange, weekRange } from "@/lib/suite-preview/calendar";
import { DEMO_NOW, DEMO_TODAY } from "@/lib/suite-preview/clock";
import { addDays, addMonthsClamped, compareLocal, firstOfMonth, isValidYmd, lastOfMonth, monthTitle, parseYmd } from "@/lib/suite-preview/dates";
import type { Area, Occurrence, Ymd } from "@/lib/suite-preview/types";
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/finance-preview/ui";
import { AreaSwatch, PageHeader } from "../primitives";
import { useSuite } from "../provider";
import { replaceQueryParam, useQueryParam } from "../use-query";
import { AgendaList } from "./agenda-view";
import { useEventSheets } from "./event-sheets";
import { MOBILE_QUERY, useMedia, WIDE_QUERY } from "./hooks";
import { monthName, weekTitle } from "./labels";
import { DayDialog, MonthGrid, MonthGridCompact } from "./month-view";
import { AreaFilter, CalendarToolbar, NO_AREAS, type AreaFilterOption, type CalendarView } from "./toolbar";
import { WeekGrid } from "./week-view";

const NOW_MINUTES = (() => {
  const [h, m] = DEMO_NOW.slice(11, 16).split(":").map(Number);
  return h * 60 + m;
})();

function parseView(v: string | null): CalendarView | null {
  return v === "mes" || v === "semana" || v === "agenda" ? v : null;
}

/** Conteo por área en el período (responsable, o también participante si no es "solo responsable"). */
export function areaOptions(list: readonly Occurrence[], areas: readonly Area[], onlyResponsible: boolean): AreaFilterOption[] {
  const count = (id: string) =>
    list.filter((o) => o.event.responsibleAreaId === id || (!onlyResponsible && o.event.participantAreaIds.includes(id))).length;
  const active = activeAreas(areas).map((area) => ({ area, count: count(area.id) }));
  const inactive = areas
    .filter((a) => !a.active)
    .map((area) => ({ area, count: count(area.id) }))
    .filter((x) => x.count > 0);
  return [...active, ...inactive];
}

export function CalendarScreen() {
  const { state, profile, eff, hrefFor } = useSuite();
  const mobile = useMedia(MOBILE_QUERY);
  const wide = useMedia(WIDE_QUERY);
  const desktopLg = useMedia("(min-width: 1024px)");
  const today = DEMO_TODAY;

  const vistaParam = parseView(useQueryParam("vista"));
  const fechaParam = useQueryParam("fecha");
  const areasParam = useQueryParam("areas");
  const soloParam = useQueryParam("solo");
  const crearParam = useQueryParam("crear");
  const estado = useQueryParam("estado");

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

  // Expansión barata (decenas de actividades): sin memo manual (React Compiler).
  const all = occurrencesInRange(state.events, range.from, range.to, DEMO_NOW);
  const options = areaOptions(all, state.areas, onlyResponsible);
  const filtered = estado === "vacio" ? [] : selected.includes(NO_AREAS) ? [] : filterByAreas(all, selected, onlyResponsible);

  const canCreate = !!profile && canCreateEvents(profile, state.areas);
  const sheets = useEventSheets({
    defaultDate: compareLocal(anchor, today) > 0 ? anchor : today,
    onCreated: (info) => {
      if (compareLocal(info.startDate, range.from) < 0 || compareLocal(info.startDate, range.to) > 0) replaceQueryParam("fecha", info.startDate);
    },
  });
  const { openCreate } = sheets;

  useEffect(() => {
    if (crearParam !== "1") return;
    replaceQueryParam("crear", null);
    if (canCreate) openCreate();
  }, [crearParam, canCreate, openCreate]);

  const setAnchor = (d: Ymd) => replaceQueryParam("fecha", d === today ? null : d);
  const step = (dir: 1 | -1) => {
    setShowEarlier(false);
    if (view === "semana") setAnchor(addDays(anchor, 7 * dir));
    else setAnchor(firstOfMonth(addMonthsClamped(firstOfMonth(anchor), dir)));
  };
  const todayVisible =
    view === "semana" ? compareLocal(today, week.from) >= 0 && compareLocal(today, week.to) <= 0 : isCurrentMonth;
  const title = view === "semana" ? weekTitle(week.from, week.to) : monthTitle(y, m);
  const monthLabel = monthName(anchor);

  const legendAreas = options.filter((o) => !selected.length || selected.includes(o.area.id));

  const filter = (
    <AreaFilter
      options={options}
      areas={state.areas}
      selected={selected}
      onChange={(ids) => replaceQueryParam("areas", ids.length ? ids.join(",") : null)}
      onlyResponsible={onlyResponsible}
      onOnlyResponsible={(v) => replaceQueryParam("solo", v ? "1" : null)}
      mobile={mobile}
      resultCount={filtered.length}
    />
  );

  let body: React.ReactNode;
  if (estado === "cargando") {
    body = (
      <Panel className="sx-cal-panel" flush>
        <div className="sx-cal-skeleton" aria-busy="true" aria-label="Cargando el calendario">
          {view === "agenda" || mobile ? (
            Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="sx-skel-group">
                <Skeleton h={18} w={200} />
                <Skeleton h={56} />
                <Skeleton h={56} />
              </div>
            ))
          ) : (
            <div className="sx-skel-grid">
              {Array.from({ length: 42 }, (_, i) => (
                <div key={i} className="sx-skel-cell">
                  <Skeleton h={14} w={18} />
                  {i % 5 === 1 && <Skeleton h={18} style={{ marginTop: 8 }} />}
                  {i % 7 === 3 && <Skeleton h={18} style={{ marginTop: 4 }} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    );
  } else if (estado === "error") {
    body = (
      <Panel>
        <ErrorState title="No pudimos cargar el calendario" onRetry={() => replaceQueryParam("estado", null)} />
      </Panel>
    );
  } else {
    const empty = filtered.length === 0;
    const filteredOut = empty && all.length > 0 && selected.length > 0;
    const emptyState = filteredOut ? (
      <EmptyState
        icon={CalendarX2}
        title="Ninguna actividad de las áreas elegidas."
        body="Prueba con otras áreas."
        action={
          <button type="button" className="fx-btn fx-btn-secondary" onClick={() => replaceQueryParam("areas", null)}>
            Mostrar todas las áreas
          </button>
        }
      />
    ) : (
      <EmptyState
        icon={CalendarX2}
        title={view === "agenda" ? "No hay actividades próximas." : `No hay actividades en ${monthLabel}`}
        body={canCreate ? "Prueba con otras áreas o crea una actividad." : "Prueba con otras áreas o con otro mes."}
        action={
          canCreate ? (
            <button type="button" className="fx-btn fx-btn-primary" onClick={openCreate}>
              Crear actividad
            </button>
          ) : undefined
        }
      />
    );

    if (view === "agenda") {
      body = (
        <div className="sx-agenda-wrap">
          {isCurrentMonth && !showEarlier && (
            <button type="button" className="fx-btn fx-btn-ghost sx-earlier" onClick={() => setShowEarlier(true)}>
              Ver días anteriores
            </button>
          )}
          {empty ? (
            <Panel>{emptyState}</Panel>
          ) : (
            <AgendaList
              occurrences={filtered}
              areas={state.areas}
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
        <div className="sx-month-wrap">
          {mobile ? (
            <MonthGridCompact year={y} month={m} title={title} occurrences={filtered} areas={state.areas} today={today} onOpen={sheets.openDetail} />
          ) : (
            <Panel flush className="sx-cal-panel">
              <MonthGrid
                year={y}
                month={m}
                title={title}
                occurrences={filtered}
                areas={state.areas}
                today={today}
                maxChips={wide ? 3 : 2}
                showTime={desktopLg}
                onOpen={sheets.openDetail}
                onOpenDay={setDay}
              />
            </Panel>
          )}
          {empty && <div className="sx-empty-overlay">{emptyState}</div>}
        </div>
      );
    } else {
      body = (
        <div className="sx-month-wrap">
          <Panel flush className="sx-cal-panel">
            <WeekGrid days={week.days} occurrences={filtered} areas={state.areas} today={today} nowMinutes={NOW_MINUTES} onOpen={sheets.openDetail} onOpenDay={setDay} />
          </Panel>
          {empty && <div className="sx-empty-overlay">{emptyState}</div>}
        </div>
      );
    }
  }

  return (
    <div className="sx-cal">
      <PageHeader title="Calendario" subtitle="Actividades de todas las áreas de la iglesia." />
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
        onCreate={openCreate}
        canShare={eff.has("calendar.events.manage_all")}
        shareHref={hrefFor("/preview/calendario/compartir")}
        reportHref={hrefFor("/preview/reportes/calendario")}
      />
      {!mobile && view !== "agenda" && estado !== "cargando" && estado !== "error" && (
        <div className="sx-legend">
          {legend && (
            <ul className="sx-legend-list" aria-label="Leyenda de áreas">
              {legendAreas.map(({ area }) => (
                <li key={area.id}>
                  <AreaSwatch color={area.color} size={10} shape="square" />
                  {area.name}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="fx-toggle sx-legend-toggle" onClick={() => setLegend((v) => !v)}>
            {legend ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            {legend ? "Ocultar leyenda" : "Mostrar leyenda"}
          </button>
        </div>
      )}
      {body}
      <DayDialog
        date={day}
        occurrences={filtered}
        areas={state.areas}
        today={today}
        onClose={() => setDay(null)}
        onOpen={(o) => {
          setDay(null);
          sheets.openDetail(o);
        }}
      />
      {sheets.sheets}
    </div>
  );
}
