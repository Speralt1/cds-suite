// Registro de módulos y secciones de la navegación (datos puros).
// Los íconos van como NOMBRES; components/suite-preview/icons.ts los traduce a lucide.
// Lo usan la sidebar, el rail, la barra móvil, el ingreso y "Entra a…".

import { MODULE_LABEL, can, moduleHref, visibleModules } from "./access";
import { FINANCE_BASE, normalizePath } from "./routes";
import type { AccessProfile, ModuleId, Permission } from "./types";

export type IconName =
  | "CircleDollarSign"
  | "CalendarDays"
  | "UsersRound"
  | "ChartColumn"
  | "Settings"
  | "LayoutDashboard"
  | "Inbox"
  | "ArrowLeftRight"
  | "Wallet"
  | "Scale"
  | "HandCoins"
  | "HandHeart"
  | "Coffee"
  | "Target"
  | "Calendar"
  | "CalendarCheck"
  | "Share2"
  | "Contact"
  | "SlidersHorizontal"
  | "Tags"
  | "UserCog"
  | "Plug"
  | "PieChart";

export interface NavSection {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  /** Badge de conteo (lo calcula el shell). */
  badge?: "finance-attention" | "members-attention";
  /** Atajo hacia otro módulo (se muestra con ↗). */
  shortcut?: boolean;
  /** Solo coincide con la ruta exacta (más `alsoMatches`). */
  exact?: boolean;
  /** Otras rutas que activan esta sección. */
  alsoMatches?: readonly string[];
  /** Permiso requerido además del del módulo. */
  requires?: Permission;
}

export interface NavGroupDef {
  label?: string;
  items: NavSection[];
}

export interface ModuleDef {
  id: ModuleId;
  label: string;
  icon: IconName;
}

export const MODULE_ICON: Record<ModuleId, IconName> = {
  finanzas: "CircleDollarSign",
  calendario: "CalendarDays",
  integrantes: "UsersRound",
  reportes: "ChartColumn",
  configuracion: "Settings",
};

const F = FINANCE_BASE;
const C = "/preview/integrantes/consolidacion";

/**
 * Secciones de Finanzas con detalle (fuente única: components/finance-preview/nav.ts
 * las expone como NAV_GROUPS). R5: Reportes y Configuración financieros viven en
 * los módulos globales; aquí quedan como atajos ↗.
 */
export const FINANCE_SECTION_GROUPS: readonly NavGroupDef[] = [
  {
    items: [
      { id: "hoy", label: "Hoy", href: F, icon: "LayoutDashboard", exact: true, alsoMatches: [`${F}/hoy`] },
      { id: "atencion", label: "Atención", href: `${F}/atencion`, icon: "Inbox", badge: "finance-attention" },
      { id: "movimientos", label: "Movimientos", href: `${F}/movimientos`, icon: "ArrowLeftRight" },
      { id: "caja", label: "Caja", href: `${F}/caja`, icon: "Wallet" },
      { id: "conciliacion", label: "Conciliación", href: `${F}/conciliacion`, icon: "Scale" },
    ],
  },
  {
    label: "Fuentes",
    items: [
      { id: "ofrendas", label: "Ofrendas", href: `${F}/ofrendas`, icon: "HandCoins" },
      { id: "diezmos", label: "Diezmos", href: `${F}/diezmos`, icon: "HandHeart" },
      { id: "cafeteria", label: "Cafetería", href: `${F}/cafeteria`, icon: "Coffee" },
      { id: "campanas", label: "Campañas", href: `${F}/campanas`, icon: "Target" },
    ],
  },
  {
    label: "Análisis",
    items: [
      {
        id: "reportes-financieros",
        label: "Reportes financieros",
        href: "/preview/reportes/finanzas",
        icon: "ChartColumn",
        shortcut: true,
        alsoMatches: [`${F}/reportes`],
      },
    ],
  },
  {
    label: "Sistema",
    items: [
      {
        id: "configuracion-financiera",
        label: "Configuración financiera",
        href: "/preview/configuracion/finanzas",
        icon: "Settings",
        shortcut: true,
        requires: "settings.manage",
        alsoMatches: [`${F}/configuracion`],
      },
    ],
  },
];

const RESUMEN: NavSection = { id: "resumen", label: "Resumen", href: `${F}/resumen`, icon: "PieChart" };

function allowed(p: AccessProfile, s: NavSection): boolean {
  return !s.requires || can(p, s.requires);
}

function filterGroups(p: AccessProfile, groups: readonly NavGroupDef[]): NavGroupDef[] {
  return groups.map((g) => ({ ...g, items: g.items.filter((s) => allowed(p, s)) })).filter((g) => g.items.length);
}

/** Secciones del módulo para el perfil (grupos con etiqueta opcional). */
export function moduleSections(m: ModuleId, p: AccessProfile): NavGroupDef[] {
  switch (m) {
    case "finanzas":
      return can(p, "finance.details.read") ? filterGroups(p, FINANCE_SECTION_GROUPS) : [{ items: [RESUMEN] }];
    case "calendario":
      return filterGroups(p, [
        {
          items: [
            { id: "calendario", label: "Calendario", href: "/preview/calendario", icon: "Calendar", exact: true },
            {
              id: "mis-actividades",
              label: "Mis actividades",
              href: "/preview/calendario/mis-actividades",
              icon: "CalendarCheck",
              requires: "calendar.events.manage_assigned",
            },
            {
              id: "compartir",
              label: "Compartir",
              href: "/preview/calendario/compartir",
              icon: "Share2",
              exact: true,
              requires: "calendar.events.manage_all",
            },
          ],
        },
      ]);
    case "integrantes":
      return [
        {
          label: "Consolidación",
          items: [
            { id: "inicio", label: "Inicio", href: C, icon: "LayoutDashboard", exact: true },
            { id: "atencion", label: "Atención", href: `${C}/atencion`, icon: "Inbox", badge: "members-attention" },
            { id: "personas", label: "Personas", href: `${C}/personas`, icon: "Contact", alsoMatches: [`${C}/persona`, `${C}/nueva`] },
            { id: "ajustes", label: "Ajustes", href: `${C}/ajustes`, icon: "SlidersHorizontal" },
          ],
        },
      ];
    case "reportes":
      return filterGroups(p, [
        {
          items: [
            { id: "finanzas", label: "Finanzas", href: "/preview/reportes/finanzas", icon: "CircleDollarSign", requires: "finance.details.read" },
            { id: "calendario", label: "Calendario", href: "/preview/reportes/calendario", icon: "CalendarDays", requires: "calendar.read" },
          ],
        },
      ]);
    case "configuracion":
      return [
        {
          items: [
            { id: "areas", label: "Áreas", href: "/preview/configuracion/areas", icon: "Tags" },
            { id: "usuarios", label: "Usuarios y permisos", href: "/preview/configuracion/usuarios", icon: "UserCog" },
            { id: "finanzas", label: "Finanzas e integraciones", href: "/preview/configuracion/finanzas", icon: "Plug" },
          ],
        },
      ];
  }
}

export function flatSections(groups: readonly NavGroupDef[]): NavSection[] {
  return groups.flatMap((g) => g.items);
}

function sectionMatches(s: NavSection, path: string): number {
  const targets = [s.href, ...(s.alsoMatches ?? [])];
  let best = -1;
  for (const t of targets) {
    const exact = s.exact && t === s.href;
    if (path === t || (!exact && path.startsWith(`${t}/`))) best = Math.max(best, t.length);
  }
  return best;
}

/** Id de la sección activa (la coincidencia más específica) o null. */
export function activeSectionId(groups: readonly NavGroupDef[], pathname: string): string | null {
  const path = normalizePath(pathname);
  let best: NavSection | null = null;
  let score = -1;
  for (const s of flatSections(groups)) {
    if (s.shortcut) continue; // los atajos llevan a otro módulo
    const m = sectionMatches(s, path);
    if (m > score) {
      best = s;
      score = m;
    }
  }
  return best?.id ?? null;
}

/** Un módulo con una sola sección es una hoja (sin subnav). */
export function isLeafModule(m: ModuleId, p: AccessProfile): boolean {
  return flatSections(moduleSections(m, p)).length === 1;
}

/** Href del link de un módulo: su entrada o, si es hoja, su única sección. */
export function moduleLinkHref(m: ModuleId, p: AccessProfile): string {
  const sections = flatSections(moduleSections(m, p));
  return sections.length === 1 ? sections[0].href : moduleHref(m, p);
}

// ---------- Barra inferior móvil (16b §3.3) ----------

export type CreateAction = "finance-register" | "calendar-create" | "members-create";

export type BottomTab =
  | { kind: "section"; section: NavSection }
  | { kind: "create"; action: CreateAction; label: "Registrar" | "Crear" | "Nueva"; href?: string }
  | { kind: "attention"; section: NavSection }
  | { kind: "shortcut"; module: ModuleId; label: string; ariaLabel: string; href: string; icon: IconName }
  | { kind: "more" };

/** Href del "+ Crear" de Calendario: la pantalla abre el formulario al leer `?crear=1`. */
export const CALENDAR_CREATE_HREF = "/preview/calendario?crear=1";
export const MEMBERS_CREATE_HREF = `${C}/nueva`;

function createFor(m: ModuleId, p: AccessProfile): BottomTab | null {
  if (m === "finanzas" && can(p, "finance.records.manage")) return { kind: "create", action: "finance-register", label: "Registrar" };
  if (m === "calendario" && can(p, "calendar.events.manage_assigned") && (can(p, "calendar.events.manage_all") || p.areaIds.length))
    return { kind: "create", action: "calendar-create", label: "Crear", href: CALENDAR_CREATE_HREF };
  if (m === "integrantes" && can(p, "members.consolidation.manage"))
    return { kind: "create", action: "members-create", label: "Nueva", href: MEMBERS_CREATE_HREF };
  return null;
}

/**
 * Regla de la barra inferior: [sección 1] [sección 2] [+ crear si puede]
 * [Atención si existe; si no, atajo al primer otro módulo cuando hay crear o
 * menos de 2 secciones] [Más]. Entre 3 y 5 ítems.
 */
export function bottomTabs(m: ModuleId, p: AccessProfile): BottomTab[] {
  const sections = flatSections(moduleSections(m, p)).filter((s) => !s.shortcut);
  const attention = sections.find((s) => s.badge);
  const main = sections.filter((s) => s !== attention).slice(0, 2);
  const tabs: BottomTab[] = main.map((section) => ({ kind: "section", section }));
  const create = createFor(m, p);
  if (create) tabs.push(create);
  if (attention) tabs.push({ kind: "attention", section: attention });
  else if (create || main.length < 2) {
    const other = visibleModules(p).find((x) => x !== m);
    if (other)
      tabs.push({
        kind: "shortcut",
        module: other,
        label: MODULE_LABEL[other],
        ariaLabel: `Ir a ${MODULE_LABEL[other]}`,
        href: moduleLinkHref(other, p),
        icon: MODULE_ICON[other],
      });
  }
  tabs.push({ kind: "more" });
  return tabs;
}

/** Secciones que no caben en la barra (van en "Más"). */
export function moreSections(m: ModuleId, p: AccessProfile): NavGroupDef[] {
  const inBar = new Set(
    bottomTabs(m, p).flatMap((t) => (t.kind === "section" || t.kind === "attention" ? [t.section.id] : [])),
  );
  return moduleSections(m, p)
    .map((g) => ({ ...g, items: g.items.filter((s) => !inBar.has(s.id)) }))
    .filter((g) => g.items.length);
}
