// Colores de área para la página pública. Usa los tokens globales
// `--area-{color}-{swatch|ink|soft}` (app/globals.css) con un respaldo local
// para que la página, que no carga el shell, siempre tenga color.

import type { CSSProperties } from "react";
import { AREA_PALETTE } from "@/lib/calendar/areas";
import type { AreaColor } from "@/lib/shared/types";

// Mismos hex que la paleta (lib/calendar/areas.ts): una sola fuente para los 24 colores.
const FALLBACK: Readonly<Record<AreaColor, { swatch: string; ink: string; soft: string }>> = AREA_PALETTE;

export function publicAreaStyle(color: AreaColor): CSSProperties {
  const tone = FALLBACK[color] ?? FALLBACK.pizarra;
  const key = FALLBACK[color] ? color : "pizarra";
  return {
    "--pub-area-swatch": `var(--area-${key}-swatch, ${tone.swatch})`,
    "--pub-area-ink": `var(--area-${key}-ink, ${tone.ink})`,
    "--pub-area-soft": `var(--area-${key}-soft, ${tone.soft})`,
  } as CSSProperties;
}
