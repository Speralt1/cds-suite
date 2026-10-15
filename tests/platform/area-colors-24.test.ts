// R2.6 · Paleta de 24 colores: compatibilidad con el calendario público
// (calendarPublicFeed usa la copia generada en functions/shared) y con los
// tokens CSS. Datos ficticios.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AREA_COLORS, AREA_PALETTE } from "@/lib/calendar/areas";
import { toPublicArea } from "@/lib/shared/public-calendar";
import { publicAreaStyle } from "@/components/public-calendar/area-style";

const require = createRequire(join(process.cwd(), "package.json"));
const feedShared = require("./functions/shared/public-calendar.js");

const NEW_COLORS = AREA_COLORS.slice(10);

describe("calendarPublicFeed · colores de área", () => {
  it("la Function (copia generada) y el cliente publican los 24 colores tal cual", () => {
    for (const color of AREA_COLORS) {
      const area = { id: "musica", name: "Música", color };
      expect(toPublicArea(area).color).toBe(color);
      expect(feedShared.toPublicArea(area).color).toBe(color);
    }
  });

  it("un color desconocido sigue cayendo en Pizarra (lo que hace la versión desplegada hoy con los 14 nuevos)", () => {
    for (const color of ["petroleo-x", "rojo", "", 7]) {
      const area = { id: "musica", name: "Música", color } as never;
      expect(toPublicArea(area).color).toBe("pizarra");
      expect(feedShared.toPublicArea(area).color).toBe("pizarra");
    }
  });

  it("la página pública colorea los 14 nuevos con su propio tono, con respaldo hex", () => {
    for (const color of NEW_COLORS) {
      const style = publicAreaStyle(color) as Record<string, string>;
      expect(style["--pub-area-swatch"]).toBe(`var(--area-${color}-swatch, ${AREA_PALETTE[color].swatch})`);
      expect(style["--pub-area-ink"]).toBe(`var(--area-${color}-ink, ${AREA_PALETTE[color].ink})`);
    }
  });
});

describe("tokens CSS de la paleta", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  it("globals.css define swatch, ink y soft de los 24 colores con los mismos hex que la paleta", () => {
    for (const color of AREA_COLORS)
      for (const part of ["swatch", "ink", "soft"] as const)
        expect(css).toContain(`--area-${color}-${part}: ${AREA_PALETTE[color][part]};`);
  });
});
