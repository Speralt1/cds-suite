// Piezas visuales de área (16b §4.2), reutilizables por Calendario y Reportes.
// Un color SIEMPRE va con su nombre; el texto en color de área usa el token -ink.

import type { CSSProperties } from "react";
import "./area-badges.css";
import { areaStyle } from "@/lib/calendar/areas";
import type { Area, AreaColor } from "@/lib/shared/types";

type AreaLike = Pick<Area, "name" | "color"> & { active?: boolean };

/** Variables CSS del color de un área (`--area-swatch|ink|soft`) para estilos en línea. */
export function areaCss(color: AreaColor): CSSProperties {
  return areaStyle(color) as CSSProperties;
}

/** Cuadro o punto de color (decorativo; el nombre va al lado). */
export function AreaSwatch({ color, size = 10, shape = "dot" }: { color: AreaColor; size?: number; shape?: "dot" | "square" }) {
  return (
    <span
      className={`cal-area-swatch ${shape === "square" ? "is-square" : ""}`}
      style={{ ...areaCss(color), width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** Chip de área participante: punto + nombre. */
export function AreaChip({ area, showInactive = true }: { area: AreaLike; showInactive?: boolean }) {
  return (
    <span className="cal-area-chip" style={areaCss(area.color)}>
      <AreaSwatch color={area.color} size={8} />
      <span>{area.name}</span>
      {showInactive && area.active === false && <span className="cal-area-inactive">(inactiva)</span>}
    </span>
  );
}

/** Pill del área responsable: barra de 4 px + nombre en -ink + " · responsable". */
export function AreaPill({ area, suffix = "responsable" }: { area: AreaLike; suffix?: string | null }) {
  return (
    <span className="cal-area-pill" style={areaCss(area.color)}>
      <span className="cal-area-pill-name">{area.name}</span>
      {suffix && <span className="cal-area-pill-suffix">&nbsp;· {suffix}</span>}
      {area.active === false && <span className="cal-area-inactive">&nbsp;(inactiva)</span>}
    </span>
  );
}
