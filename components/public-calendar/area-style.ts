// Colores de área para la página pública. Usa los tokens globales
// `--area-{color}-{swatch|ink|soft}` (app/globals.css) con un respaldo local
// para que la página, que no carga el shell, siempre tenga color.

import type { CSSProperties } from "react";
import type { AreaColor } from "@/lib/shared/types";

const FALLBACK: Record<AreaColor, { swatch: string; ink: string; soft: string }> = {
  azul: { swatch: "#2f6fb0", ink: "#245a8f", soft: "#e6eef7" },
  indigo: { swatch: "#5b5fc7", ink: "#464aa6", soft: "#ebebf8" },
  naranjo: { swatch: "#c4561d", ink: "#a3461a", soft: "#f8ebe3" },
  ambar: { swatch: "#a06a00", ink: "#7d5300", soft: "#f5eedf" },
  frambuesa: { swatch: "#b03a8a", ink: "#8f2e70", soft: "#f5e7f1" },
  cafe: { swatch: "#8a5a3c", ink: "#6e4529", soft: "#f1ebe7" },
  teal: { swatch: "#1f7f86", ink: "#17646a", soft: "#e3f0f1" },
  pizarra: { swatch: "#5e6b78", ink: "#4a5560", soft: "#edeff1" },
  verde: { swatch: "#3d8a3f", ink: "#2e6e30", soft: "#e7f1e7" },
  carmin: { swatch: "#b83a4b", ink: "#962d3c", soft: "#f6e7e9" },
};

export function publicAreaStyle(color: AreaColor): CSSProperties {
  const tone = FALLBACK[color] ?? FALLBACK.pizarra;
  const key = FALLBACK[color] ? color : "pizarra";
  return {
    "--pub-area-swatch": `var(--area-${key}-swatch, ${tone.swatch})`,
    "--pub-area-ink": `var(--area-${key}-ink, ${tone.ink})`,
    "--pub-area-soft": `var(--area-${key}-soft, ${tone.soft})`,
  } as CSSProperties;
}
