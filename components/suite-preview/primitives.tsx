"use client";

// Primitivas visuales compartidas por los módulos nuevos (16b §3.7, §4.2).
// Reutilizan las clases fx-* de Finanzas; las nuevas usan el prefijo sx-.
// Colores de área: SIEMPRE con su nombre; texto en color de área = token -ink.

import type { CSSProperties, ReactNode } from "react";
import { areaVar } from "@/lib/suite-preview/areas";
import type { Area, AreaColor } from "@/lib/suite-preview/types";
import { ProposalPill } from "@/components/finance-preview/ui";

type AreaLike = Pick<Area, "name" | "color"> & { active?: boolean };

/** Variables CSS del color de un área para usar en estilos en línea. */
export function areaStyle(color: AreaColor): CSSProperties {
  return {
    "--sx-area-swatch": areaVar(color, "swatch"),
    "--sx-area-ink": areaVar(color, "ink"),
    "--sx-area-soft": areaVar(color, "soft"),
  } as CSSProperties;
}

/** Cuadro o punto de color (decorativo; el nombre va al lado). */
export function AreaSwatch({ color, size = 10, shape = "dot" }: { color: AreaColor; size?: number; shape?: "dot" | "square" }) {
  return (
    <span
      className={`sx-area-swatch ${shape === "square" ? "is-square" : ""}`}
      style={{ ...areaStyle(color), width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** Chip de área participante: punto + nombre (alto 24, borde fx-line). */
export function AreaChip({ area, showInactive = true }: { area: AreaLike; showInactive?: boolean }) {
  return (
    <span className="sx-area-chip" style={areaStyle(area.color)}>
      <AreaSwatch color={area.color} size={8} />
      <span>{area.name}</span>
      {showInactive && area.active === false && <span className="sx-area-inactive">(inactiva)</span>}
    </span>
  );
}

/** Pill del área responsable: barra de 4 px + nombre en -ink + " · responsable". */
export function AreaPill({ area, suffix = "responsable" }: { area: AreaLike; suffix?: string | null }) {
  return (
    <span className="sx-area-pill" style={areaStyle(area.color)}>
      <span className="sx-area-pill-name">{area.name}</span>
      {suffix && <span className="sx-area-pill-suffix"> · {suffix}</span>}
      {area.active === false && <span className="sx-area-inactive"> (inactiva)</span>}
    </span>
  );
}

/**
 * Header de página (título, subtítulo y acciones). Mismas clases que
 * FinancialHeader con period=false; sin selector de período.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  proposal,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  proposal?: boolean;
}) {
  return (
    <header className="fx-header">
      <div className="fx-header-text">
        <h1 className="fx-h1">
          {title}
          {proposal && <ProposalPill />}
        </h1>
        {subtitle && <p className="fx-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="fx-header-actions">{actions}</div>}
    </header>
  );
}
