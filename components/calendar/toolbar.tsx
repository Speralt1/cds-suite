"use client";

// CalendarToolbar (16b §5.1) y AreaFilter (§5.2).

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Ellipsis, FileText, Plus, Share2, X } from "lucide-react";
import type { Area } from "@/lib/shared/types";
import { AreaSwatch } from "./area-badges";
import { CalDialog } from "./ui";

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
}: {
  options: AreaFilterOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  onlyResponsible: boolean;
  onOnlyResponsible: (v: boolean) => void;
}) {
  const help = useId();
  const all = !selected.length;
  return (
    <div className="cal-filter-body">
      <div className="cal-filter-links">
        <button type="button" className="button-ghost cal-btn-sm" aria-pressed={all} onClick={() => onChange([])}>
          Todas
        </button>
        <button type="button" className="button-ghost cal-btn-sm" aria-pressed={selected.includes(NO_AREAS)} onClick={() => onChange([NO_AREAS])}>
          Ninguna
        </button>
      </div>
      <fieldset className="cal-filter-list">
        <legend className="cal-sr">Áreas visibles</legend>
        {options.map(({ area, count }) => {
          const checked = all || selected.includes(area.id);
          return (
            <label key={area.id} className="cal-filter-row">
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
              <span className="cal-filter-name">
                {area.name}
                {!area.active && <span className="cal-area-inactive"> (inactiva)</span>}
              </span>
              <span className="cal-filter-count cal-num" aria-label={`${count} actividades`}>
                {count}
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="cal-filter-switch">
        <label className="cal-switch">
          <input type="checkbox" role="switch" checked={onlyResponsible} aria-describedby={help} onChange={(e) => onOnlyResponsible(e.target.checked)} />
          <span>Solo como responsable</span>
        </label>
        <p className="cal-help" id={help}>
          Si está apagado, también muestra actividades donde el área participa.
        </p>
      </div>
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
    <div className={`cal-filter ${active ? "is-active" : ""}`} ref={ref}>
      <button
        type="button"
        className="cal-filter-chip"
        aria-expanded={open}
        aria-haspopup={mobile ? "dialog" : "true"}
        aria-controls={mobile ? undefined : popId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cal-filter-chip-label">{label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {active && !mobile && (
        <button type="button" className="cal-filter-clear" aria-label="Quitar filtro de áreas" onClick={() => onChange([])}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
      {!mobile && open && (
        <div className="cal-popover cal-filter-pop" id={popId} role="group" aria-label="Filtrar por área">
          <AreaFilterList options={options} selected={selected} onChange={onChange} onlyResponsible={onlyResponsible} onOnlyResponsible={onOnlyResponsible} />
        </div>
      )}
      {mobile && open && (
        <CalDialog
          onClose={() => setOpen(false)}
          title="Filtrar por área"
          footer={
            <div className="cal-form-foot">
              <button type="button" className="button-secondary" onClick={() => onChange([])}>
                Limpiar
              </button>
              <button type="button" className="button-primary" onClick={() => setOpen(false)}>
                Ver {resultCount} {resultCount === 1 ? "actividad" : "actividades"}
              </button>
            </div>
          }
        >
          <AreaFilterList options={options} selected={selected} onChange={onChange} onlyResponsible={onlyResponsible} onOnlyResponsible={onOnlyResponsible} />
        </CalDialog>
      )}
    </div>
  );
}

function MoreMenu({ canShare }: { canShare: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));
  return (
    <div className="cal-menu" ref={ref}>
      <button
        type="button"
        className="button-secondary cal-btn-icon cal-more-btn"
        aria-label="Más opciones del calendario"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="cal-menu-list" role="menu">
          {canShare && (
            <Link role="menuitem" href="/calendario/compartir" className="cal-menu-item" onClick={() => setOpen(false)}>
              <Share2 size={16} aria-hidden="true" /> Compartir calendario
            </Link>
          )}
          <Link role="menuitem" href="/reportes/calendario" className="cal-menu-item" onClick={() => setOpen(false)}>
            <FileText size={16} aria-hidden="true" /> Ver reporte
          </Link>
        </div>
      )}
    </div>
  );
}

const VIEW_LABEL: Record<CalendarView, string> = { mes: "Mes", semana: "Semana", agenda: "Agenda" };

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
  createDisabledReason,
  onCreate,
  canShare,
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
  /** Si hay texto, "Crear actividad" queda aria-disabled con esta explicación (p. ej. sin conexión). */
  createDisabledReason?: string;
  onCreate: () => void;
  canShare: boolean;
}) {
  const helpId = useId();
  return (
    <div className="cal-toolbar" role="toolbar" aria-label="Navegación del calendario">
      <div className="cal-nav">
        <button type="button" className="button-secondary cal-today-btn" disabled={todayVisible} onClick={onToday}>
          Hoy
        </button>
        <button type="button" className="button-secondary cal-btn-icon cal-prev" aria-label={prevLabel} onClick={onPrev}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <h2 className="cal-title" aria-live="polite">
          {title}
        </h2>
        <button type="button" className="button-secondary cal-btn-icon cal-next" aria-label={nextLabel} onClick={onNext}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="cal-controls">
        <div className="cal-segmented cal-view-switch" role="group" aria-label="Vista">
          {views.map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => onView(v)}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        {filter}
        <MoreMenu canShare={canShare} />
      </div>
      {canCreate && (
        <div className="cal-create">
          <button
            type="button"
            className="button-primary"
            aria-disabled={createDisabledReason ? true : undefined}
            aria-describedby={createDisabledReason ? helpId : undefined}
            onClick={() => !createDisabledReason && onCreate()}
          >
            <Plus size={16} aria-hidden="true" /> Crear actividad
          </button>
          {createDisabledReason && (
            <span className="cal-sr" id={helpId}>
              {createDisabledReason}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
