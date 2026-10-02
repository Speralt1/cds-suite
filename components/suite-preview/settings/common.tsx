"use client";

// Piezas comunes de Configuración (Áreas, Usuarios y permisos): switch con
// texto, estados ?estado=cargando|vacio|error y badges de aviso.

import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/finance-preview/ui";
import { notifyQueryChange, useQueryParam } from "../use-query";

export type ScreenState = "cargando" | "vacio" | "error" | null;

/** Lee `?estado=` (cargando | vacio | error); cualquier otro valor = normal. */
export function useScreenState(): { state: ScreenState; clear: () => void } {
  const raw = useQueryParam("estado");
  const state = raw === "cargando" || raw === "vacio" || raw === "error" ? raw : null;
  return { state, clear: () => setUrlParam("estado", null) };
}

/** Switch de 44×24 (role="switch"). El texto visible lo pone quien lo usa. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  describedBy,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Nombre accesible ("Jóvenes activa", "Cuenta activa"). */
  label: string;
  disabled?: boolean;
  describedBy?: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      className="sx-set-switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <span className="sx-set-switch-thumb" aria-hidden="true" />
    </button>
  );
}

/** Badge de aviso con ícono + texto (nunca solo color). */
export function NoticeBadge({ icon: Icon, tone, children }: { icon: LucideIcon; tone: "warning" | "neutral" | "info" | "success"; children: React.ReactNode }) {
  return (
    <span className={`fx-badge fx-tone-${tone} sx-set-badge`}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

/** Filas skeleton de las listas de Configuración (6 filas, 16b §12). */
export function SettingsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="sx-set-skeleton" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <div className="sx-set-skeleton-row" key={i}>
          <Skeleton h={28} w={28} style={{ borderRadius: 999 }} />
          <div style={{ flex: 1, display: "grid", gap: 6 }}>
            <Skeleton h={12} w="40%" />
            <Skeleton h={10} w="65%" />
          </div>
          <Skeleton h={22} w={72} style={{ borderRadius: 999 }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Cambia un parámetro de la URL (deep link del editor) y deja que el router de
 * Next lo registre: con `state = null` Next sincroniza su URL canónica, así un
 * refresco del router no restaura el parámetro anterior.
 */
export function setUrlParam(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(null, "", url);
  notifyQueryChange();
}
