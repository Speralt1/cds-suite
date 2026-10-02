"use client";

// CalendarToolbar (16b §5.1) y AreaFilter (§5.2).

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Ellipsis, FileText, Plus, Share2, X } from "lucide-react";
import type { Area } from "@/lib/suite-preview/types";
import { Sheet } from "@/components/finance-preview/ui";
import { AreaSwatch } from "../primitives";

export type CalendarView = "mes" | "semana" | "agenda";

export interface AreaFilterOption {
  area: Area;
  count: number;
}

/** Selección "Ninguna" (vacío significa "Todas"). */
export const NO_AREAS = "-";

export function areaFilterLabel(selected: readonly string[], areas: readonly Area[]): string {
  if (!selected.length) return "Áreas: Todas";
  if (selected.includes(NO_AREAS)) return "Áreas: Ninguna";
  if (selected.length > 2) return `Áreas (${selected.length})`;
  return `Áreas: ${selected.map((id) => areas.find((a) => a.id === id)?.name ?? id).join(", ")}`;
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose]);
}

function AreaFilterList({
  options,
  selected,
  onChange,
  onlyResponsible,
  onOnlyResponsible,
  showResponsibleSwitch = true,
}: {
  options: AreaFilterOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  onlyResponsible: boolean;
  onOnlyResponsible?: (v: boolean) => void;
  showResponsibleSwitch?: boolean;
}) {
  const help = useId();
  const all = !selected.length;
  return (
    <div className="sx-filter-body">
      <div className="sx-filter-links">
        <button type="button" className="fx-btn fx-btn-ghost fx-btn-sm" aria-pressed={all} onClick={() => onChange([])}>
          Todas
        </button>
        <button
          type="button"
          className="fx-btn fx-btn-ghost fx-btn-sm"
          aria-pressed={selected.includes(NO_AREAS)}
          onClick={() => onChange([NO_AREAS])}
        >
          Ninguna
        </button>
      </div>
      <fieldset className="sx-filter-list">
        <legend className="fx-sr">Áreas visibles</legend>
        {options.map(({ area, count }) => {
          const checked = all || selected.includes(area.id);
          return (
            <label key={area.id} className="sx-filter-row">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const base = all ? options.map((o) => o.area.id) : selected.filter((id) => id !== NO_AREAS);
                  const next = e.target.checked ? [...base, area.id] : base.filter((id) => id !== area.id);
                  onChange(next.length === options.length ? [] : next.length ? next : [NO_AREAS]);
                }}
              />
              <AreaSwatch color={area.color} size={12} shape="square" />
              <span className="sx-filter-name">
                {area.name}
                {!area.active && <span className="sx-area-inactive"> (inactiva)</span>}
              </span>
              <span className="sx-filter-count fx-num" aria-label={`${count} actividades`}>
                {count}
              </span>
            </label>
          );
        })}
      </fieldset>
      {showResponsibleSwitch && onOnlyResponsible && (
        <div className="sx-filter-switch">
          <label className="sx-switch">
            <input type="checkbox" role="switch" checked={onlyResponsible} aria-describedby={help} onChange={(e) => onOnlyResponsible(e.target.checked)} />
            <span>Solo como responsable</span>
          </label>
          <p className="fx-help" id={help}>
            Si está apagado, también muestra actividades donde el área participa.
          </p>
        </div>
      )}
    </div>
  );
}

export function AreaFilter({
  options,
  areas,
  selected,
  onChange,
  onlyResponsible,
  onOnlyResponsible,
  mobile,
  resultCount,
}: {
  options: AreaFilterOption[];
  areas: readonly Area[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  onlyResponsible: boolean;
  onOnlyResponsible: (v: boolean) => void;
  mobile: boolean;
  resultCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open && !mobile, () => setOpen(false));
  const active = selected.length > 0;
  const none = selected.includes(NO_AREAS);
  const label = mobile ? `Áreas (${none ? 0 : active ? selected.length : "Todas"})` : areaFilterLabel(selected, areas);
  const popId = useId();

  return (
    <div className={`sx-filter ${active ? "is-active" : ""}`} ref={ref}>
      <button
        type="button"
        className="sx-filter-chip"
        aria-expanded={open}
        aria-haspopup={mobile ? "dialog" : "true"}
        aria-controls={mobile ? undefined : popId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sx-filter-chip-label">{label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {active && !mobile && (
        <button type="button" className="sx-filter-clear" aria-label="Quitar filtro de áreas" onClick={() => onChange([])}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
      {!mobile && open && (
        <div className="sx-popover sx-filter-pop" id={popId} role="group" aria-label="Filtrar por área">
          <AreaFilterList options={options} selected={selected} onChange={onChange} onlyResponsible={onlyResponsible} onOnlyResponsible={onOnlyResponsible} />
        </div>
      )}
      {mobile && (
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          labelId="sx-area-filter-title"
          title="Filtrar por área"
          footer={
            <div className="sx-cal-form-foot">
              <button type="button" className="fx-btn fx-btn-secondary" onClick={() => onChange([])}>
                Limpiar
              </button>
              <button type="button" className="fx-btn fx-btn-primary" onClick={() => setOpen(false)}>
                Ver {resultCount} {resultCount === 1 ? "actividad" : "actividades"}
              </button>
            </div>
          }
        >
          <AreaFilterList options={options} selected={selected} onChange={onChange} onlyResponsible={onlyResponsible} onOnlyResponsible={onOnlyResponsible} />
        </Sheet>
      )}
    </div>
  );
}

function MoreMenu({ canShare, shareHref, reportHref }: { canShare: boolean; shareHref: string; reportHref: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));
  return (
    <div className="fx-menu" ref={ref}>
      <button
        type="button"
        className="fx-btn fx-btn-secondary fx-btn-icon sx-more-btn"
        aria-label="Más opciones del calendario"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="fx-menu-list" role="menu">
          {canShare && (
            <Link role="menuitem" href={shareHref} className="fx-menu-item" onClick={() => setOpen(false)}>
              <Share2 size={16} aria-hidden="true" /> Compartir calendario
            </Link>
          )}
          <Link role="menuitem" href={reportHref} className="fx-menu-item" onClick={() => setOpen(false)}>
            <FileText size={16} aria-hidden="true" /> Ver reporte
          </Link>
        </div>
      )}
    </div>
  );
}

export function CalendarToolbar({
  title,
  view,
  onView,
  views,
  onPrev,
  onNext,
  onToday,
  todayVisible,
  prevLabel,
  nextLabel,
  filter,
  canCreate,
  onCreate,
  canShare,
  shareHref,
  reportHref,
}: {
  title: string;
  view: CalendarView;
  onView: (v: CalendarView) => void;
  views: CalendarView[];
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  todayVisible: boolean;
  prevLabel: string;
  nextLabel: string;
  filter: React.ReactNode;
  canCreate: boolean;
  onCreate: () => void;
  canShare: boolean;
  shareHref: string;
  reportHref: string;
}) {
  const VIEW_LABEL: Record<CalendarView, string> = { mes: "Mes", semana: "Semana", agenda: "Agenda" };
  return (
    <div className="sx-cal-toolbar" role="toolbar" aria-label="Navegación del calendario">
      <div className="sx-cal-nav">
        <button type="button" className="fx-btn fx-btn-secondary sx-today-btn" disabled={todayVisible} onClick={onToday}>
          Hoy
        </button>
        <button type="button" className="fx-btn fx-btn-secondary fx-btn-icon sx-cal-prev" aria-label={prevLabel} onClick={onPrev}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <h2 className="sx-cal-title" aria-live="polite">
          {title}
        </h2>
        <button type="button" className="fx-btn fx-btn-secondary fx-btn-icon sx-cal-next" aria-label={nextLabel} onClick={onNext}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="sx-cal-controls">
        <div className="fx-segmented sx-view-switch" role="group" aria-label="Vista">
          {views.map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => onView(v)}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        {filter}
        <MoreMenu canShare={canShare} shareHref={shareHref} reportHref={reportHref} />
      </div>
      {canCreate && (
        <div className="sx-cal-create">
          <button type="button" className="fx-btn fx-btn-primary" onClick={onCreate}>
            <Plus size={16} aria-hidden="true" /> Crear actividad
          </button>
        </div>
      )}
    </div>
  );
}
