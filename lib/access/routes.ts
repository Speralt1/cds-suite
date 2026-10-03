// Tabla de rutas privadas y guardia de acceso (18a §F). Puro y testeable.
// Gana la regla más específica (prefijo más largo; "exact" gana a "prefix" del
// mismo largo). Los destinos de un redirect son siempre hrefs de módulos
// visibles, por lo que no hay loops (lo prueba un test de propiedad).

import {
  MODULE_HREF,
  effectivePermissions,
  modulesForPermissions,
  resolveHome,
} from "@/lib/shared/access";
import type { ModuleId, Permission, UserAccessDoc } from "@/lib/shared/types";
import { MODULE_LABEL } from "./modules";

export type RouteAccess = "resolve" | { anyOf: readonly Permission[] };

export interface RouteRule {
  path: string;
  /** exact: solo esa ruta · prefix: la ruta y sus hijas. */
  match: "exact" | "prefix";
  access: RouteAccess;
  /** Nombre de la sección para el aviso "No tienes acceso a {label}". */
  label: string;
  module: ModuleId | null;
}

const anyOf = (...permissions: Permission[]) => ({ anyOf: permissions }) as const;

export const ROUTE_RULES: readonly RouteRule[] = [
  { path: "/inicio", match: "prefix", access: "resolve", label: "Inicio", module: null },
  // Las subrutas de detalle las sigue cubriendo DetailGuard (sin redirect).
  { path: "/finanzas", match: "prefix", access: anyOf("finance.summary.read"), label: "Finanzas", module: "finance" },
  { path: "/calendario", match: "prefix", access: anyOf("calendar.read"), label: "Calendario", module: "calendar" },
  {
    path: "/calendario/mis-actividades",
    match: "prefix",
    access: anyOf("calendar.read"),
    label: "Mis actividades",
    module: "calendar",
  },
  {
    path: "/calendario/compartir",
    match: "exact",
    access: anyOf("calendar.events.manage_all"),
    label: "Compartir calendario",
    module: "calendar",
  },
  {
    path: "/reportes",
    match: "prefix",
    access: anyOf("finance.details.read", "calendar.read"),
    label: "Reportes",
    module: "reports",
  },
  {
    path: "/reportes/calendario",
    match: "prefix",
    access: anyOf("calendar.read"),
    label: "Reporte de calendario",
    module: "reports",
  },
  {
    path: "/configuracion",
    match: "prefix",
    access: anyOf("settings.manage"),
    label: "Configuración",
    module: "settings",
  },
  {
    path: "/configuracion/areas",
    match: "prefix",
    access: anyOf("settings.manage"),
    label: "Áreas",
    module: "settings",
  },
  {
    path: "/configuracion/usuarios",
    match: "prefix",
    access: anyOf("settings.manage"),
    label: "Usuarios y permisos",
    module: "settings",
  },
  {
    path: "/configuracion/finanzas",
    match: "prefix",
    access: anyOf("settings.manage"),
    label: "Finanzas e integraciones",
    module: "settings",
  },
];

/** Páginas privadas conocidas (para tests de propiedad y verificación). */
export const PRIVATE_ROUTES: readonly string[] = [
  "/inicio",
  "/dashboard",
  "/finanzas",
  "/finanzas/movimientos",
  "/finanzas/ofrendas",
  "/finanzas/diezmos",
  "/finanzas/diezmos/perfil",
  "/finanzas/campanas",
  "/finanzas/reportes",
  "/calendario",
  "/calendario/mis-actividades",
  "/calendario/compartir",
  "/reportes",
  "/reportes/calendario",
  "/configuracion",
  "/configuracion/areas",
  "/configuracion/usuarios",
  "/configuracion/finanzas",
];

/** Quita query, hash y barra final. */
export function normalizePath(pathname: string | null | undefined): string {
  const path = (pathname || "/").split(/[?#]/)[0] || "/";
  if (path.length <= 1) return path;
  return path.replace(/\/+$/, "") || "/";
}

function ruleMatches(rule: RouteRule, path: string): boolean {
  if (rule.match === "exact") return path === rule.path;
  return path === rule.path || path.startsWith(`${rule.path}/`);
}

/** Regla más específica para una ruta (null si no está en la tabla). */
export function matchRoute(pathname: string): RouteRule | null {
  const path = normalizePath(pathname);
  let best: RouteRule | null = null;
  let bestScore = -1;
  for (const rule of ROUTE_RULES) {
    if (!ruleMatches(rule, path)) continue;
    const score = rule.path.length * 2 + (rule.match === "exact" ? 1 : 0);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

/** Módulo al que pertenece una ruta (`/finanzas/reportes` → finance). */
export function moduleOfPath(pathname: string | null | undefined): ModuleId | null {
  return matchRoute(normalizePath(pathname))?.module ?? null;
}

export type GuardDecision =
  | { type: "allow" }
  | {
      type: "redirect";
      to: string;
      /** Aviso para el deep link no permitido (null en aterrizaje y /inicio). */
      notice: string | null;
      reason: "landing" | "home" | "forbidden";
    }
  | { type: "no-modules" }
  | { type: "inactive" };

const ALLOW: GuardDecision = { type: "allow" };

/** "No tienes acceso a {qué}. Te llevamos a {destino}." (18b §1.5). */
export function accessNoticeText(what: string, destination: string): string {
  return `No tienes acceso a ${what}. Te llevamos a ${destination}.`;
}

/**
 * Decide qué hacer con una ruta privada para un usuario (v1 o legacy `{role, active}`).
 * - sin perfil o inactivo → "inactive" (lo resuelve AccessProvider, sin cambios);
 * - activo sin módulos → "no-modules" (pantalla in situ, sin redirect);
 * - `/inicio` → módulo inicial;
 * - `/finanzas` con intención de aterrizaje → módulo inicial si no es Finanzas;
 * - ruta permitida o fuera de la tabla → "allow";
 * - sección no permitida de un módulo visible → raíz del módulo, con aviso;
 * - módulo no visible → módulo inicial, con aviso.
 */
export function guardRoute(
  user: UserAccessDoc | null | undefined,
  pathname: string,
  intentPending = false,
): GuardDecision {
  const home = resolveHome(user);
  if (home.kind === "inactive") return { type: "inactive" };
  if (home.kind === "no-modules") return { type: "no-modules" };

  const path = normalizePath(pathname);
  const rule = matchRoute(path);
  if (!rule) return ALLOW;

  if (rule.access === "resolve") {
    return { type: "redirect", to: home.href, notice: null, reason: "home" };
  }

  if (intentPending && path === MODULE_HREF.finance && home.href !== path) {
    return { type: "redirect", to: home.href, notice: null, reason: "landing" };
  }

  const perms = effectivePermissions(user);
  if (rule.access.anyOf.some((p) => perms.has(p))) return ALLOW;

  const modules = modulesForPermissions(perms);
  if (rule.module && modules.includes(rule.module)) {
    return {
      type: "redirect",
      to: MODULE_HREF[rule.module],
      notice: accessNoticeText(rule.label, MODULE_LABEL[rule.module]),
      reason: "forbidden",
    };
  }
  return {
    type: "redirect",
    to: home.href,
    notice: accessNoticeText(rule.module ? MODULE_LABEL[rule.module] : rule.label, MODULE_LABEL[home.module]),
    reason: "forbidden",
  };
}
