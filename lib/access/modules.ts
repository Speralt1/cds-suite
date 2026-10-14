// Registro único de módulos de CDS Suite (18a §G.3, 18b §1.3).
// Orden fijo: Finanzas · Calendario · Integrantes · Reportes · Configuración.
// Integrantes solo aparece con members.consolidation.* explícito o admin (doc 23).
// Los íconos van como NOMBRES (puro, sin React); el shell los traduce a lucide.

import { MODULE_HREF, MODULE_ORDER } from "@/lib/shared/access";
import type { HomeModule, ModuleId } from "@/lib/shared/types";

export type ModuleIconName = "Wallet" | "CalendarDays" | "Users" | "ChartColumn" | "Settings";

export interface ModuleDef {
  id: ModuleId;
  label: string;
  href: string;
  icon: ModuleIconName;
  /** Descripción corta (selector móvil). */
  description: string;
}

export const MODULE_LABEL: Readonly<Record<ModuleId, string>> = {
  finance: "Finanzas",
  calendar: "Calendario",
  members: "Integrantes",
  reports: "Reportes",
  settings: "Configuración",
};

export const MODULE_DESCRIPTION: Readonly<Record<ModuleId, string>> = {
  finance: "Ingresos, gastos y caja",
  calendar: "Actividades y agenda de la iglesia",
  members: "Consolidación de personas nuevas",
  reports: "Reportes de finanzas y calendario",
  settings: "Áreas, usuarios y ajustes",
};

const MODULE_ICON: Readonly<Record<ModuleId, ModuleIconName>> = {
  finance: "Wallet",
  calendar: "CalendarDays",
  members: "Users",
  reports: "ChartColumn",
  settings: "Settings",
};

export const MODULES: readonly ModuleDef[] = MODULE_ORDER.map((id) => ({
  id,
  label: MODULE_LABEL[id],
  href: MODULE_HREF[id],
  icon: MODULE_ICON[id],
  description: MODULE_DESCRIPTION[id],
}));

export const HOME_MODULE_LABEL: Readonly<Record<HomeModule, string>> = {
  finance: "Finanzas",
  calendar: "Calendario",
};

/** Definiciones de los módulos indicados, en el orden de la navegación. */
export function modulesFor(ids: readonly ModuleId[]): ModuleDef[] {
  return MODULES.filter((m) => ids.includes(m.id));
}

export function moduleDef(id: ModuleId): ModuleDef {
  return MODULES.find((m) => m.id === id) as ModuleDef;
}
