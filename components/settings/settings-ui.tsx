"use client";

// Piezas pequeñas de Configuración (Áreas y Usuarios). Reusan las clases
// productivas (panel, button-*, notice) y utilidades de Tailwind con los tokens
// existentes; sin una segunda familia de botones ni de modales.

import { createContext, useContext } from "react";
import { CircleAlert, Info, RotateCw, TriangleAlert } from "lucide-react";
import { AREA_PALETTE, areaVar, type AreaColor } from "@/lib/calendar/areas";

/**
 * Dentro del layout de Configuración el h1 es "Configuración" (mismo patrón que
 * Calendario y Reportes) y cada sección se titula con h2. Montada fuera de ese
 * layout, la sección es el encabezado principal de la página (h1).
 */
const SettingsSectionContext = createContext(false);

export function SettingsSectionProvider({ children }: { children: React.ReactNode }) {
  return <SettingsSectionContext.Provider value>{children}</SettingsSectionContext.Provider>;
}

/** Encabezado de sección: h2 20/600 + descripción 14 muted; el CTA se alinea con el título. */
export function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  const Heading = useContext(SettingsSectionContext) ? "h2" : "h1";
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <Heading className="min-w-0 text-xl leading-7 font-semibold text-ink">{title}</Heading>
        {action}
      </div>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{subtitle}</p>
    </div>
  );
}

/** Interruptor accesible (role="switch"), 44 px de alto táctil. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  describedBy,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={`relative inline-block h-6 w-10 rounded-full border transition-colors motion-reduce:transition-none ${
          checked ? "border-primary bg-primary" : "border-[#cbd4ca] bg-[#e7ece5]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-[left] motion-reduce:transition-none ${
            checked ? "left-[19px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

/** Aviso en tono advertencia: siempre ícono + texto visible. */
export function WarningNote({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p id={id} className="flex items-start gap-2 rounded-[10px] bg-warning-soft px-3 py-2.5 text-[13px] leading-5 text-[#6f4c14]">
      <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function InfoNote({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p id={id} className="flex items-start gap-2 rounded-[10px] bg-primary-soft px-3 py-2.5 text-[13px] leading-5 text-primary">
      <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Insignia corta de aviso (lista): ícono + texto, nunca solo el ícono. */
export function WarningBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-[#6f4c14]">
      <TriangleAlert size={12} aria-hidden="true" />
      {children}
    </span>
  );
}

export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <span id={id} role="alert" className="flex items-center gap-1 text-xs font-normal text-danger">
      <CircleAlert size={14} aria-hidden="true" />
      {children}
    </span>
  );
}

export function SettingsLoading({ label }: { label: string }) {
  return (
    <div role="status" className="panel py-10">
      <span className="animate-pulse motion-reduce:animate-none">{label}</span>
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="panel flex flex-col items-start gap-4">
      <p role="alert" className="flex items-start gap-2 text-sm text-danger">
        <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>{message}</span>
      </p>
      <button type="button" className="button-secondary" onClick={onRetry}>
        <RotateCw size={16} aria-hidden="true" />
        Reintentar
      </button>
    </div>
  );
}

/** Cuadrado o punto con el color del área (decorativo: el nombre siempre va al lado). */
export function AreaDot({ color, size = 12, square = false }: { color: AreaColor; size?: number; square?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 ${square ? "rounded-[4px]" : "rounded-full"}`}
      style={{ width: size, height: size, background: areaVar(color, "swatch") }}
    />
  );
}

/** Chip de área: swatch + nombre en tinta del área sobre su fondo suave. */
export function AreaTag({ name, color, inactive = false }: { name: string; color: AreaColor; inactive?: boolean }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: areaVar(color, "soft"), color: areaVar(color, "ink") }}
      title={AREA_PALETTE[color].label}
    >
      <AreaDot color={color} size={8} />
      <span className="truncate">{name}</span>
      {inactive && <span className="font-normal">(inactiva)</span>}
    </span>
  );
}
