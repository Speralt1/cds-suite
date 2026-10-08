// Áreas de la iglesia (18a §C.2, 18b §3.2): paleta cerrada de 10 colores,
// slug estable, validación de nombre y color únicos entre áreas activas y el
// color de cada actividad (siempre el de su área responsable).
//
// Puro: sin React ni Firebase (lo usan Calendario, Reportes y Configuración).

import { AREA_COLORS } from "@/lib/shared/types";
import type { Area, AreaColor, CalendarEvent, EventStatus } from "@/lib/shared/types";

export { AREA_COLORS };
export type { Area, AreaColor };

export interface AreaTone {
  /** Nombre del color en español ("Azul"). Todo color se muestra con su nombre. */
  label: string;
  /** Barra o swatch (≥3:1 sobre blanco). */
  swatch: string;
  /** Texto en color de área (≥4,5:1 incluso sobre -soft). */
  ink: string;
  /** Fondo de chip o bloque. */
  soft: string;
}

/** Paleta cerrada (16b §4.1). El orden es el de AREA_COLORS. */
export const AREA_PALETTE: Readonly<Record<AreaColor, Readonly<AreaTone>>> = {
  azul: { label: "Azul", swatch: "#2f6fb0", ink: "#245a8f", soft: "#e6eef7" },
  indigo: { label: "Índigo", swatch: "#5b5fc7", ink: "#464aa6", soft: "#ebebf8" },
  naranjo: { label: "Naranjo", swatch: "#c4561d", ink: "#a3461a", soft: "#f8ebe3" },
  ambar: { label: "Ámbar", swatch: "#a06a00", ink: "#7d5300", soft: "#f5eedf" },
  frambuesa: { label: "Frambuesa", swatch: "#b03a8a", ink: "#8f2e70", soft: "#f5e7f1" },
  cafe: { label: "Café", swatch: "#8a5a3c", ink: "#6e4529", soft: "#f1ebe7" },
  teal: { label: "Verde azulado", swatch: "#1f7f86", ink: "#17646a", soft: "#e3f0f1" },
  pizarra: { label: "Pizarra", swatch: "#5e6b78", ink: "#4a5560", soft: "#edeff1" },
  verde: { label: "Verde", swatch: "#3d8a3f", ink: "#2e6e30", soft: "#e7f1e7" },
  carmin: { label: "Carmín", swatch: "#b83a4b", ink: "#962d3c", soft: "#f6e7e9" },
};

/** Color neutro para actividades cuya área ya no existe. */
export const FALLBACK_AREA_COLOR: AreaColor = "pizarra";

export const AREA_NAME_MAX = 40;
export const AREA_DESCRIPTION_MAX = 200;
export const AREA_SLUG_MAX = 40;
export const AREA_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isAreaColor(value: unknown): value is AreaColor {
  return typeof value === "string" && (AREA_COLORS as readonly string[]).includes(value);
}

/** `var(--area-azul-swatch, #2f6fb0)`: token del shell con el hex como respaldo. */
export function areaVar(color: AreaColor, part: "swatch" | "ink" | "soft"): string {
  const safe = isAreaColor(color) ? color : FALLBACK_AREA_COLOR;
  return `var(--area-${safe}-${part}, ${AREA_PALETTE[safe][part]})`;
}

/** Variables CSS locales (`--area-swatch`, `--area-ink`, `--area-soft`) para un elemento. */
export function areaStyle(color: AreaColor): Record<string, string> {
  return {
    "--area-swatch": areaVar(color, "swatch"),
    "--area-ink": areaVar(color, "ink"),
    "--area-soft": areaVar(color, "soft"),
  };
}

function collator(a: string, b: string) {
  return a.localeCompare(b, "es", { sensitivity: "base" });
}

/** Orden por nombre (es-CL, sin distinguir mayúsculas ni tildes). */
export function sortAreas<A extends Pick<Area, "name">>(areas: readonly A[]): A[] {
  return [...areas].sort((a, b) => collator(a.name, b.name));
}

export function activeAreas<A extends Pick<Area, "name" | "active">>(areas: readonly A[]): A[] {
  return sortAreas(areas.filter((a) => a.active));
}

export function areaById<A extends Pick<Area, "id">>(areas: readonly A[], id: string | null | undefined): A | undefined {
  return id ? areas.find((a) => a.id === id) : undefined;
}

/**
 * Áreas que se pueden elegir en un selector: las activas por nombre, más las
 * inactivas que ya estaban elegidas (`keepIds`) para no perderlas al editar.
 */
export function selectableAreas<A extends Area>(areas: readonly A[], keepIds: readonly string[] = []): A[] {
  const keep = new Set(keepIds);
  const active = activeAreas(areas);
  const extra = sortAreas(areas.filter((a) => !a.active && keep.has(a.id)));
  return [...active, ...extra];
}

/** Color y tonos de una actividad: los de su área responsable (los participantes nunca lo cambian). */
export function eventColor(
  event: Pick<CalendarEvent, "responsibleAreaId">,
  areas: readonly Pick<Area, "id" | "color">[],
): AreaTone & { color: AreaColor } {
  const found = areas.find((a) => a.id === event.responsibleAreaId)?.color;
  const color = isAreaColor(found) ? found : FALLBACK_AREA_COLOR;
  return { color, ...AREA_PALETTE[color] };
}

/** Colores libres: los que no usa ninguna otra área activa (en el orden de la paleta). */
export function freeColors(areas: readonly Pick<Area, "id" | "color" | "active">[], editingId?: string): AreaColor[] {
  const used = new Set(areas.filter((a) => a.active && a.id !== editingId).map((a) => a.color));
  return AREA_COLORS.filter((c) => !used.has(c));
}

/** Área inactiva que tenía un color hoy libre (para "libre, lo usaba Matrimonios"). */
export function inactiveOwnerOfColor<A extends Area>(areas: readonly A[], color: AreaColor, editingId?: string): A | undefined {
  return areas.find((a) => !a.active && a.color === color && a.id !== editingId);
}

/** "Jóvenes Adultos!" → "jovenes-adultos" (vacío si no queda nada). Máx. 40. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, AREA_SLUG_MAX)
    .replace(/-+$/g, "");
}

/**
 * Slug libre para un área nueva: `jovenes`, `jovenes-2`, `jovenes-3`…
 * Siempre cumple `^[a-z0-9]+(-[a-z0-9]+)*$` y ≤40 (sin nombre útil → "area").
 */
export function uniqueAreaSlug(name: string, takenIds: Iterable<string>): string {
  const taken = new Set(takenIds);
  const base = slugify(name) || "area";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const head = base.slice(0, AREA_SLUG_MAX - suffix.length).replace(/-+$/g, "") || "area";
    const candidate = `${head}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function isAreaSlug(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= AREA_SLUG_MAX && AREA_SLUG_PATTERN.test(value);
}

export function normalizeAreaName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function nameKey(value: string): string {
  return normalizeAreaName(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es");
}

export interface AreaInput {
  /** Id del área que se edita (ausente al crear). */
  id?: string;
  name: string;
  description?: string;
  color: AreaColor | "" | null;
  /** Estado con que quedará. Sin valor: el actual del área (o activa si es nueva). */
  active?: boolean;
}

export type AreaErrors = Partial<Record<"name" | "color" | "description", string>>;

export const AREA_ERRORS = {
  nameRequired: "Escribe el nombre del área.",
  nameTooLong: `Máximo ${AREA_NAME_MAX} caracteres.`,
  nameTaken: "Ya existe un área con ese nombre.",
  colorRequired: "Elige un color de la paleta.",
  colorTaken: "Ese color ya lo usa otra área activa.",
  descriptionTooLong: `Máximo ${AREA_DESCRIPTION_MAX} caracteres.`,
} as const;

/**
 * Errores por campo (objeto vacío = válido). Nombre y color son únicos entre
 * las áreas ACTIVAS (sin contar la que se edita); un área inactiva puede
 * conservar un nombre o color que hoy usa otra activa.
 */
export function validateArea(input: AreaInput, areas: readonly Area[]): AreaErrors {
  const errors: AreaErrors = {};
  const current = input.id ? areas.find((a) => a.id === input.id) : undefined;
  const willBeActive = input.active ?? current?.active ?? true;
  const others = areas.filter((a) => a.active && a.id !== input.id);

  const name = normalizeAreaName(input.name ?? "");
  if (!name) errors.name = AREA_ERRORS.nameRequired;
  else if (name.length > AREA_NAME_MAX) errors.name = AREA_ERRORS.nameTooLong;
  else if (willBeActive && others.some((a) => nameKey(a.name) === nameKey(name))) errors.name = AREA_ERRORS.nameTaken;

  if (!isAreaColor(input.color)) errors.color = AREA_ERRORS.colorRequired;
  else if (willBeActive && others.some((a) => a.color === input.color)) errors.color = AREA_ERRORS.colorTaken;

  if ((input.description ?? "").trim().length > AREA_DESCRIPTION_MAX) errors.description = AREA_ERRORS.descriptionTooLong;
  return errors;
}

export function hasAreaErrors(errors: AreaErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Actividades no archivadas donde el área es responsable o (si no) participa. */
export function areaUsage(
  areaId: string,
  events: readonly { responsibleAreaId: string; participantAreaIds: readonly string[]; status: EventStatus }[],
): { responsible: number; participant: number } {
  let responsible = 0;
  let participant = 0;
  for (const e of events) {
    if (e.status === "archived") continue;
    if (e.responsibleAreaId === areaId) responsible += 1;
    else if (e.participantAreaIds.includes(areaId)) participant += 1;
  }
  return { responsible, participant };
}

/** "1 actividad" / "3 actividades". */
export function activityCount(n: number): string {
  return `${n} ${n === 1 ? "actividad" : "actividades"}`;
}
