// Sistema de áreas: paleta cerrada de 10 colores (16b §4.1) y reglas.
// La actividad hereda SIEMPRE el color de su área responsable.

import { can } from "./access";
import { AREA_COLORS, type AccessProfile, type Area, type AreaColor, type AreaInput, type CalendarEvent } from "./types";

export interface AreaTone {
  /** Nombre del color para el selector ("Azul"). */
  label: string;
  /** Barra o swatch (≥3:1 sobre blanco). */
  swatch: string;
  /** Texto en color de área (≥4,5:1 incluso sobre -soft). */
  ink: string;
  /** Fondo de chip o bloque. */
  soft: string;
}

export const AREA_PALETTE: Record<AreaColor, AreaTone> = {
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

export { AREA_COLORS };

/** `var(--fx-area-azul-swatch)` (tokens definidos en suite-preview.css). */
export function areaVar(color: AreaColor, part: "swatch" | "ink" | "soft"): string {
  return `var(--fx-area-${color}-${part})`;
}

export function areaById(areas: readonly Area[], id: string | undefined | null): Area | undefined {
  return id ? areas.find((a) => a.id === id) : undefined;
}

export function sortAreas(areas: readonly Area[]): Area[] {
  return [...areas].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"));
}

export function activeAreas(areas: readonly Area[]): Area[] {
  return sortAreas(areas.filter((a) => a.active));
}

/** Color de una actividad: el de su área responsable (los participantes nunca lo cambian). */
export function eventColor(event: Pick<CalendarEvent, "responsibleAreaId">, areas: readonly Area[]): AreaTone & { color: AreaColor } {
  const color = areaById(areas, event.responsibleAreaId)?.color ?? "pizarra";
  return { color, ...AREA_PALETTE[color] };
}

/**
 * Áreas que el perfil puede elegir como RESPONSABLE de una actividad:
 * manage_all → todas las activas; manage_assigned → activas ∩ mis áreas.
 */
export function selectableAreas(p: AccessProfile, areas: readonly Area[]): Area[] {
  if (can(p, "calendar.events.manage_all")) return activeAreas(areas);
  if (!can(p, "calendar.events.manage_assigned")) return [];
  return activeAreas(areas).filter((a) => p.areaIds.includes(a.id));
}

/** Opciones de áreas PARTICIPANTES: cualquier área activa salvo la responsable. */
export function participantOptions(areas: readonly Area[], responsibleAreaId?: string): Area[] {
  return activeAreas(areas).filter((a) => a.id !== responsibleAreaId);
}

/** Colores libres (no usados por otra área activa). */
export function freeColors(areas: readonly Area[], editingId?: string): AreaColor[] {
  const used = new Set(areas.filter((a) => a.active && a.id !== editingId).map((a) => a.color));
  return AREA_COLORS.filter((c) => !used.has(c));
}

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Errores por campo (vacío = válido). Nombre único sin distinguir mayúsculas; color único entre activas. */
export function validateArea(input: AreaInput, areas: readonly Area[]): Partial<Record<"name" | "color" | "description", string>> {
  const errors: Partial<Record<"name" | "color" | "description", string>> = {};
  const name = input.name.trim();
  if (!name) errors.name = "Escribe el nombre del área.";
  else if (name.length > 40) errors.name = "Máximo 40 caracteres.";
  else if (areas.some((a) => a.id !== input.id && a.name.trim().toLocaleLowerCase("es") === name.toLocaleLowerCase("es")))
    errors.name = "Ya existe un área con ese nombre.";
  // Al editar sin `active`, manda el estado actual del área (una inactiva puede
  // conservar un color que hoy usa otra activa).
  const current = input.id ? areas.find((a) => a.id === input.id) : undefined;
  const active = input.active ?? current?.active ?? true;
  if (!AREA_COLORS.includes(input.color)) errors.color = "Elige un color de la paleta.";
  else if (active && !freeColors(areas, input.id).includes(input.color))
    errors.color = "Ese color ya lo usa otra área activa.";
  if ((input.description ?? "").length > 200) errors.description = "Máximo 200 caracteres.";
  return errors;
}

/** Actividades (no archivadas) donde el área es responsable o participa. */
export function areaUsage(
  areaId: string,
  events: readonly Pick<CalendarEvent, "responsibleAreaId" | "participantAreaIds" | "status">[],
): { responsible: number; participant: number } {
  let responsible = 0;
  let participant = 0;
  for (const e of events) {
    if (e.status === "archivada") continue;
    if (e.responsibleAreaId === areaId) responsible += 1;
    else if (e.participantAreaIds.includes(areaId)) participant += 1;
  }
  return { responsible, participant };
}

/** Área inactiva que usaba un color libre ("Libre (lo usaba Matrimonios, inactiva)"). */
export function inactiveOwnerOfColor(areas: readonly Area[], color: AreaColor, editingId?: string): Area | undefined {
  return areas.find((a) => !a.active && a.color === color && a.id !== editingId);
}
