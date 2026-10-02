// Tabla de rutas de la preview y guardia de acceso (puras).
// Gana la regla más específica; la barra final se normaliza.

import { MODULE_LABEL, canAny, moduleHref, resolveInitialModule, visibleModules } from "./access";
import type { AccessProfile, ModuleId, Permission } from "./types";

export const PREVIEW_ROOT = "/preview";
export const FINANCE_BASE = "/preview/finanzas-2026";
export const PUBLIC_SHARE_PATH = "/preview/calendario/compartir/demo";
export const PROFILE_PARAM = "perfil";

type Access = "login" | "public" | { anyOf: readonly Permission[] };

export interface RouteRule {
  path: string;
  /** exact: solo esa ruta · prefix: la ruta y sus hijas · children: solo las hijas. */
  match: "exact" | "prefix" | "children";
  access: Access;
  /** Nombre de la sección para el aviso "No tienes acceso a {label}". */
  label: string;
  module: ModuleId | null;
}

const F = FINANCE_BASE;
const details = { anyOf: ["finance.details.read"] } as const;

export const ROUTE_RULES: readonly RouteRule[] = [
  { path: PREVIEW_ROOT, match: "exact", access: "login", label: "Ingreso", module: null },
  { path: "/preview/calendario/compartir", match: "children", access: "public", label: "Calendario público", module: null },
  // Finanzas
  { path: F, match: "prefix", access: details, label: "Hoy", module: "finanzas" },
  { path: `${F}/hoy`, match: "prefix", access: details, label: "Hoy", module: "finanzas" },
  { path: `${F}/atencion`, match: "prefix", access: details, label: "Atención", module: "finanzas" },
  { path: `${F}/movimientos`, match: "prefix", access: details, label: "Movimientos", module: "finanzas" },
  { path: `${F}/caja`, match: "prefix", access: details, label: "Caja", module: "finanzas" },
  { path: `${F}/conciliacion`, match: "prefix", access: details, label: "Conciliación", module: "finanzas" },
  { path: `${F}/ofrendas`, match: "prefix", access: details, label: "Ofrendas", module: "finanzas" },
  { path: `${F}/diezmos`, match: "prefix", access: details, label: "Diezmos", module: "finanzas" },
  { path: `${F}/cafeteria`, match: "prefix", access: details, label: "Cafetería", module: "finanzas" },
  { path: `${F}/campanas`, match: "prefix", access: details, label: "Campañas", module: "finanzas" },
  { path: `${F}/reportes`, match: "prefix", access: details, label: "Reportes financieros", module: "finanzas" },
  {
    path: `${F}/configuracion`,
    match: "prefix",
    access: { anyOf: ["settings.manage"] },
    label: "Configuración financiera",
    module: "finanzas",
  },
  {
    path: `${F}/resumen`,
    match: "prefix",
    access: { anyOf: ["finance.summary.read"] },
    label: "Resumen financiero",
    module: "finanzas",
  },
  // Calendario
  { path: "/preview/calendario", match: "prefix", access: { anyOf: ["calendar.read"] }, label: "Calendario", module: "calendario" },
  {
    path: "/preview/calendario/mis-actividades",
    match: "prefix",
    access: { anyOf: ["calendar.events.manage_assigned"] },
    label: "Mis actividades",
    module: "calendario",
  },
  {
    path: "/preview/calendario/compartir",
    match: "exact",
    access: { anyOf: ["calendar.events.manage_all"] },
    label: "Compartir calendario",
    module: "calendario",
  },
  // Integrantes
  {
    path: "/preview/integrantes",
    match: "prefix",
    access: { anyOf: ["members.consolidation.read"] },
    label: "Integrantes",
    module: "integrantes",
  },
  {
    path: "/preview/integrantes/consolidacion/nueva",
    match: "prefix",
    access: { anyOf: ["members.consolidation.manage"] },
    label: "Nueva persona",
    module: "integrantes",
  },
  // Reportes
  {
    path: "/preview/reportes",
    match: "prefix",
    access: { anyOf: ["finance.details.read", "calendar.read"] },
    label: "Reportes",
    module: "reportes",
  },
  { path: "/preview/reportes/finanzas", match: "prefix", access: details, label: "Reportes financieros", module: "reportes" },
  {
    path: "/preview/reportes/calendario",
    match: "prefix",
    access: { anyOf: ["calendar.read"] },
    label: "Reporte de calendario",
    module: "reportes",
  },
  // Configuración
  {
    path: "/preview/configuracion",
    match: "prefix",
    access: { anyOf: ["settings.manage"] },
    label: "Configuración",
    module: "configuracion",
  },
];

/** Todas las páginas de la preview (spec §8 + Finanzas V2). */
export const PREVIEW_ROUTES: readonly string[] = [
  PREVIEW_ROOT,
  F,
  `${F}/hoy`,
  `${F}/atencion`,
  `${F}/movimientos`,
  `${F}/caja`,
  `${F}/conciliacion`,
  `${F}/ofrendas`,
  `${F}/diezmos`,
  `${F}/cafeteria`,
  `${F}/campanas`,
  `${F}/reportes`,
  `${F}/configuracion`,
  `${F}/resumen`,
  "/preview/calendario",
  "/preview/calendario/mis-actividades",
  "/preview/calendario/compartir",
  PUBLIC_SHARE_PATH,
  "/preview/integrantes",
  "/preview/integrantes/consolidacion",
  "/preview/integrantes/consolidacion/atencion",
  "/preview/integrantes/consolidacion/personas",
  "/preview/integrantes/consolidacion/nueva",
  "/preview/integrantes/consolidacion/persona",
  "/preview/integrantes/consolidacion/ajustes",
  "/preview/reportes",
  "/preview/reportes/finanzas",
  "/preview/reportes/calendario",
  "/preview/configuracion",
  "/preview/configuracion/areas",
  "/preview/configuracion/usuarios",
  "/preview/configuracion/finanzas",
];

/** Quita query, hash y barra final. */
export function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0];
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

function ruleMatches(rule: RouteRule, path: string): boolean {
  if (rule.match === "exact") return path === rule.path;
  if (rule.match === "children") return path.startsWith(`${rule.path}/`);
  return path === rule.path || path.startsWith(`${rule.path}/`);
}

/** Regla más específica para una ruta (o null si no es de la preview). */
export function matchRoute(pathname: string): RouteRule | null {
  const path = normalizePath(pathname);
  let best: RouteRule | null = null;
  let bestScore = -1;
  for (const rule of ROUTE_RULES) {
    if (!ruleMatches(rule, path)) continue;
    // "children" y "exact" ganan a un "prefix" del mismo largo.
    const score = rule.path.length * 2 + (rule.match === "prefix" ? 0 : 1);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

export function isPublicPath(pathname: string): boolean {
  return matchRoute(pathname)?.access === "public";
}

export function isLoginPath(pathname: string): boolean {
  return matchRoute(pathname)?.access === "login";
}

export function moduleOfPath(pathname: string): ModuleId | null {
  return matchRoute(pathname)?.module ?? null;
}

export function routeLabel(pathname: string): string {
  return matchRoute(pathname)?.label ?? "esta sección";
}

export function canSeeRoute(p: AccessProfile | null, pathname: string): boolean {
  const rule = matchRoute(pathname);
  if (!rule) return true;
  if (rule.access === "login" || rule.access === "public") return true;
  if (!p || !p.active) return false;
  return canAny(p, rule.access.anyOf);
}

export type GuardDecision =
  | { type: "allow" }
  | { type: "public" }
  | { type: "login" }
  | { type: "inactive" }
  | { type: "no-modules" }
  | { type: "redirect"; to: string; notice: string };

export const INVALID_PROFILE_NOTICE = "Perfil de demostración no válido. Elige con qué perfil entras.";

/**
 * Decide qué hacer con una ruta para un perfil. El destino de un redirect es
 * siempre una ruta permitida (moduleHref de un módulo visible o el aterrizaje),
 * por lo que no hay loops.
 */
export function guardRoute(p: AccessProfile | null, pathname: string): GuardDecision {
  const rule = matchRoute(pathname);
  if (rule?.access === "login") return { type: "login" };
  if (rule?.access === "public") return { type: "public" };
  if (!p) return { type: "redirect", to: PREVIEW_ROOT, notice: INVALID_PROFILE_NOTICE };
  if (!p.active) return { type: "inactive" };
  const visible = visibleModules(p);
  if (!visible.length) return { type: "no-modules" };
  if (!rule || canSeeRoute(p, pathname)) return { type: "allow" };
  let to: string;
  let what = rule.label;
  if (rule.module && visible.includes(rule.module)) {
    to = moduleHref(rule.module, p);
  } else {
    const landing = resolveInitialModule(p);
    to = landing.kind === "module" ? landing.href : PREVIEW_ROOT;
    if (rule.module) what = MODULE_LABEL[rule.module];
  }
  const dest = normalizePath(to) === FINANCE_BASE ? "Finanzas" : routeLabel(to);
  return { type: "redirect", to, notice: `No tienes acceso a ${what}. Te llevamos a ${dest}.` };
}

/**
 * Agrega (o quita) `?perfil=` a un href interno, conservando query y hash.
 * Las rutas públicas y el ingreso nunca llevan el perfil.
 */
export function withProfile(href: string, slug: string | null | undefined): string {
  const hashIdx = href.indexOf("#");
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : "";
  const noHash = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const qIdx = noHash.indexOf("?");
  const path = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
  const params = new URLSearchParams(qIdx >= 0 ? noHash.slice(qIdx + 1) : "");
  if (!slug || isPublicPath(path) || isLoginPath(path)) params.delete(PROFILE_PARAM);
  else params.set(PROFILE_PARAM, slug);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash}`;
}
