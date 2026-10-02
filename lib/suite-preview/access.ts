// Motor de permisos de CDS Suite (preview). Único lugar donde vive el cierre
// de permisos. Invariante: `settings.manage` existe solo vía baseRole = admin.

import {
  PERMISSIONS,
  type AccessProfile,
  type Area,
  type Cargo,
  type InitialModule,
  type LegacyRole,
  type ModuleId,
  type Permission,
} from "./types";

export { PERMISSIONS };
export type { Permission, ModuleId, InitialModule };

export const IMPLIES: Readonly<Partial<Record<Permission, readonly Permission[]>>> = {
  "finance.details.read": ["finance.summary.read"],
  "finance.records.manage": ["finance.details.read"],
  "finance.pastoral.manage": ["finance.details.read"],
  "calendar.events.manage_all": ["calendar.events.manage_assigned"],
  "calendar.events.manage_assigned": ["calendar.read"],
  "members.consolidation.manage": ["members.consolidation.read"],
};

export const MODULE_ORDER: readonly ModuleId[] = ["finanzas", "calendario", "integrantes", "reportes", "configuracion"];

export const MODULE_LABEL: Record<ModuleId, string> = {
  finanzas: "Finanzas",
  calendario: "Calendario",
  integrantes: "Integrantes",
  reportes: "Reportes",
  configuracion: "Configuración",
};

/** Descripciones del sheet "Cambiar de módulo" (16b §3.3). */
export const MODULE_DESCRIPTION: Record<ModuleId, string> = {
  finanzas: "Ingresos, gastos y caja",
  calendario: "Actividades y agenda de la iglesia",
  integrantes: "Personas nuevas y su seguimiento",
  reportes: "Reportes de finanzas y calendario",
  configuracion: "Áreas, usuarios y ajustes",
};

/** Etiquetas humanas para Usuarios y permisos (nunca mostrar el id técnico). */
export const PERMISSION_LABEL: Record<Permission, string> = {
  "finance.summary.read": "Ver resumen financiero",
  "finance.details.read": "Ver finanzas completas y reportes financieros",
  "finance.records.manage": "Registrar y anular movimientos",
  "finance.pastoral.manage": "Seguimiento pastoral de diezmos",
  "calendar.read": "Ver calendario",
  "calendar.events.manage_assigned": "Gestionar actividades de sus áreas",
  "calendar.events.manage_all": "Gestionar todas las actividades y el enlace público",
  "members.consolidation.read": "Ver Consolidación",
  "members.consolidation.manage": "Registrar personas, visitas y seguimientos",
  "settings.manage": "Administrar configuración",
};

export const INITIAL_MODULE_LABEL: Record<InitialModule, string> = {
  finanzas: "Finanzas",
  calendario: "Calendario",
  "integrantes/consolidacion": "Consolidación",
};

const ALL: ReadonlySet<Permission> = new Set(PERMISSIONS);

/** Cierre transitivo de un conjunto de permisos. */
export function closure(perms: Iterable<Permission>): Set<Permission> {
  const out = new Set<Permission>();
  const stack = [...perms];
  while (stack.length) {
    const p = stack.pop()!;
    if (out.has(p)) continue;
    out.add(p);
    for (const q of IMPLIES[p] ?? []) stack.push(q);
  }
  return out;
}

/** Permisos que un permiso implica (sin incluirlo). Útil para el checklist de Usuarios. */
export function impliedBy(perms: Iterable<Permission>): Set<Permission> {
  const direct = new Set(perms);
  const out = new Set<Permission>();
  for (const p of direct) for (const q of closure(IMPLIES[p] ?? [])) out.add(q);
  return out;
}

/**
 * !active → ∅ ; admin → catálogo completo ; standard → cierre(permisos válidos) \ {settings.manage}.
 */
export function effectivePermissions(p: AccessProfile): ReadonlySet<Permission> {
  if (!p.active) return new Set();
  if (p.baseRole === "admin") return new Set(ALL);
  const valid = p.permissions.filter((x): x is Permission => ALL.has(x as Permission));
  const eff = closure(valid);
  eff.delete("settings.manage");
  return eff;
}

export function can(p: AccessProfile | null | undefined, perm: Permission): boolean {
  return !!p && effectivePermissions(p).has(perm);
}

export function canAny(p: AccessProfile | null | undefined, perms: readonly Permission[]): boolean {
  if (!p) return false;
  const eff = effectivePermissions(p);
  return perms.some((x) => eff.has(x));
}

const MODULE_PERMS: Record<ModuleId, readonly Permission[]> = {
  finanzas: ["finance.summary.read"],
  calendario: ["calendar.read"],
  integrantes: ["members.consolidation.read"],
  reportes: ["finance.details.read", "calendar.read"],
  configuracion: ["settings.manage"],
};

export function canSeeModule(p: AccessProfile, m: ModuleId): boolean {
  return canAny(p, MODULE_PERMS[m]);
}

/** Módulos visibles en el orden fijo de la navegación. */
export function visibleModules(p: AccessProfile): ModuleId[] {
  return MODULE_ORDER.filter((m) => canSeeModule(p, m));
}

export function moduleOfInitial(i: InitialModule): ModuleId {
  return i === "integrantes/consolidacion" ? "integrantes" : i;
}

/** Ruta de entrada de un módulo para un perfil. */
export function moduleHref(m: ModuleId, p: AccessProfile): string {
  switch (m) {
    case "finanzas":
      return can(p, "finance.details.read") ? "/preview/finanzas-2026" : "/preview/finanzas-2026/resumen";
    case "calendario":
      return "/preview/calendario";
    case "integrantes":
      return "/preview/integrantes/consolidacion";
    case "reportes":
      // Directo a la primera sección permitida (el índice /preview/reportes también redirige).
      return can(p, "finance.details.read") ? "/preview/reportes/finanzas" : "/preview/reportes/calendario";
    case "configuracion":
      return "/preview/configuracion/areas";
  }
}

export interface CargoPreset {
  baseRole: "admin" | "standard";
  permissions: Permission[];
  initialModule: InitialModule;
  requiresAreas: boolean;
}

/** Presets por cargo (16a B.3). */
export const CARGO_PRESETS: Record<Cargo, CargoPreset> = {
  Administración: { baseRole: "admin", permissions: [], initialModule: "finanzas", requiresAreas: false },
  Pastor: {
    baseRole: "standard",
    permissions: [
      "finance.summary.read",
      "finance.details.read",
      "finance.records.manage",
      "finance.pastoral.manage",
      "calendar.events.manage_all",
      "members.consolidation.manage",
    ],
    initialModule: "calendario",
    requiresAreas: false,
  },
  Líder: {
    baseRole: "standard",
    permissions: ["finance.summary.read", "calendar.events.manage_assigned"],
    initialModule: "calendario",
    requiresAreas: true,
  },
  Diácono: {
    baseRole: "standard",
    permissions: ["finance.summary.read", "calendar.events.manage_assigned"],
    initialModule: "calendario",
    requiresAreas: true,
  },
  Finanzas: {
    baseRole: "standard",
    permissions: ["finance.records.manage", "calendar.read"],
    initialModule: "finanzas",
    requiresAreas: false,
  },
  Consolidación: {
    baseRole: "standard",
    permissions: ["members.consolidation.manage", "calendar.read"],
    initialModule: "integrantes/consolidacion",
    requiresAreas: false,
  },
};

export type Landing =
  | { kind: "inactive" }
  | { kind: "no-modules" }
  | {
      kind: "module";
      module: ModuleId;
      href: string;
      source: "initial" | "preset" | "first";
      /** El módulo inicial configurado ya no está permitido (advertencia en Usuarios). */
      invalidInitial?: InitialModule;
    };

/** Resolución del módulo inicial (16a B.7, pasos 1–7). */
export function resolveInitialModule(p: AccessProfile | null | undefined): Landing {
  if (!p || !p.active) return { kind: "inactive" };
  const allowed = visibleModules(p);
  if (!allowed.length) return { kind: "no-modules" };
  const initial = moduleOfInitial(p.initialModule);
  if (allowed.includes(initial)) return { kind: "module", module: initial, href: moduleHref(initial, p), source: "initial" };
  const preset = moduleOfInitial(CARGO_PRESETS[p.cargo].initialModule);
  if (allowed.includes(preset))
    return { kind: "module", module: preset, href: moduleHref(preset, p), source: "preset", invalidInitial: p.initialModule };
  const first = allowed[0];
  return { kind: "module", module: first, href: moduleHref(first, p), source: "first", invalidInitial: p.initialModule };
}

/** "Entra a Calendario", "Sin módulos asignados"… (login y simulador). */
export function landingLabel(l: Landing): string {
  if (l.kind === "inactive") return "Cuenta sin acceso";
  if (l.kind === "no-modules") return "Sin módulos asignados";
  return `Entra a ${l.module === "integrantes" ? "Consolidación" : MODULE_LABEL[l.module]}`;
}

/** Módulos iniciales que el perfil puede elegir al guardar. */
export function allowedInitialModules(p: AccessProfile): InitialModule[] {
  const visible = visibleModules(p);
  return (["finanzas", "calendario", "integrantes/consolidacion"] as const).filter((i) =>
    visible.includes(moduleOfInitial(i)),
  );
}

/** Migración de los 4 roles actuales (16a B.4). */
export function legacyRoleToProfile(
  role: LegacyRole,
  base: { uid: string; displayName: string; email: string; active: boolean },
): AccessProfile {
  const common = { ...base, legacyRole: role, areaIds: [] as string[] };
  switch (role) {
    case "admin":
      return { ...common, baseRole: "admin", cargo: "Administración", permissions: [], initialModule: "finanzas" };
    case "pastor":
      return {
        ...common,
        baseRole: "standard",
        cargo: "Pastor",
        permissions: [...CARGO_PRESETS.Pastor.permissions],
        initialModule: "finanzas",
      };
    case "finance":
      return {
        ...common,
        baseRole: "standard",
        cargo: "Finanzas",
        permissions: [...CARGO_PRESETS.Finanzas.permissions],
        initialModule: "finanzas",
      };
    case "leader":
      return {
        ...common,
        baseRole: "standard",
        cargo: "Líder",
        permissions: [...CARGO_PRESETS.Líder.permissions],
        initialModule: "calendario",
      };
  }
}

/** Valida un cambio en Usuarios y permisos. Los errores bloquean; las advertencias no. */
export function validateProfileChange(
  actorUid: string,
  users: readonly AccessProfile[],
  next: AccessProfile,
  areas: readonly Area[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const after = users.some((u) => u.uid === next.uid)
    ? users.map((u) => (u.uid === next.uid ? next : u))
    : [...users, next];
  if (!after.some((u) => u.active && u.baseRole === "admin")) errors.push("Debe quedar al menos un administrador activo.");
  if (next.uid === actorUid) {
    const before = users.find((u) => u.uid === actorUid);
    if (before?.baseRole === "admin" && next.baseRole !== "admin") errors.push("No puedes quitarte el rol de administrador.");
    if (before?.active && !next.active) errors.push("No puedes desactivar tu propia cuenta.");
  }
  if (next.permissions.some((x) => !ALL.has(x))) errors.push("Hay permisos que no existen.");
  if (next.permissions.includes("settings.manage"))
    errors.push("Administrar configuración solo se obtiene con el rol de administrador.");
  const areaIds = new Set(areas.map((a) => a.id));
  if (next.areaIds.some((id) => !areaIds.has(id))) errors.push("Hay áreas asignadas que no existen.");
  if (next.active && visibleModules(next).length && !allowedInitialModules(next).includes(next.initialModule))
    errors.push("El módulo inicial no está permitido para estos permisos.");
  const eff = effectivePermissions(next);
  if (eff.has("calendar.events.manage_assigned") && !eff.has("calendar.events.manage_all") && !next.areaIds.length)
    warnings.push("Sin áreas asignadas: solo podrá ver el calendario.");
  const landing = resolveInitialModule(next);
  if (landing.kind === "module" && landing.invalidInitial)
    warnings.push(
      `El módulo inicial (${INITIAL_MODULE_LABEL[landing.invalidInitial]}) ya no está permitido; se abrirá ${landing.module === "integrantes" ? "Consolidación" : MODULE_LABEL[landing.module]}.`,
    );
  return { errors, warnings };
}

// ---------- Usuarios y permisos (16b §10.2): textos y agrupación ----------

/** Descripción en lenguaje simple de cada permiso (debajo de la etiqueta). */
export const PERMISSION_DESCRIPTION: Record<Permission, string> = {
  "finance.summary.read": "Cifras generales del período, sin detalle ni nombres.",
  "finance.details.read": "Movimientos, ofrendas, diezmos, caja, campañas y reportes financieros.",
  "finance.records.manage": "Registrar, editar y anular movimientos, diezmos y campañas.",
  "finance.pastoral.manage": "Seguimiento pastoral en las fichas de diezmo.",
  "calendar.read": "Calendario de toda la iglesia, incluidas las actividades solo para el equipo.",
  "calendar.events.manage_assigned": "Crear, editar y cancelar las actividades de sus áreas asignadas.",
  "calendar.events.manage_all": "Todas las actividades de la iglesia y el enlace público del calendario.",
  "members.consolidation.read": "Personas nuevas, su ficha, su historial y las alertas.",
  "members.consolidation.manage": "Registrar personas, visitas y seguimientos; cambiar estado y responsable.",
  "settings.manage": "Áreas, usuarios y configuración de finanzas e integraciones.",
};

/** Grupos del checklist, en el orden de la navegación. */
export const PERMISSION_GROUPS: readonly { id: ModuleId; label: string; permissions: readonly Permission[] }[] = [
  {
    id: "finanzas",
    label: "Finanzas",
    permissions: ["finance.summary.read", "finance.details.read", "finance.records.manage", "finance.pastoral.manage"],
  },
  {
    id: "calendario",
    label: "Calendario",
    permissions: ["calendar.read", "calendar.events.manage_assigned", "calendar.events.manage_all"],
  },
  { id: "integrantes", label: "Integrantes", permissions: ["members.consolidation.read", "members.consolidation.manage"] },
  { id: "configuracion", label: "Configuración", permissions: ["settings.manage"] },
];

/**
 * Permiso marcado que incluye a `perm` (para "Incluido en «…»"), o null si
 * nadie lo implica. Se elige el más alto de la cadena (el que no está implicado
 * por otro permiso marcado).
 */
export function implyingPermission(perm: Permission, stored: readonly Permission[]): Permission | null {
  const sources = stored.filter((s) => s !== perm && closure(IMPLIES[s] ?? []).has(perm));
  if (!sources.length) return null;
  const top = sources.find((s) => !sources.some((o) => o !== s && closure(IMPLIES[o] ?? []).has(s)));
  return top ?? sources[0];
}

/** Nombre del módulo de entrada ("Consolidación" para Integrantes). */
export function landingModuleName(m: ModuleId): string {
  return m === "integrantes" ? "Consolidación" : MODULE_LABEL[m];
}

/** "Finanzas (solo resumen)", "Calendario (gestiona sus áreas)"… en el orden de la navegación. */
export function visibleModulesSummary(p: AccessProfile): string[] {
  const eff = effectivePermissions(p);
  return visibleModules(p).map((m) => {
    switch (m) {
      case "finanzas":
        return eff.has("finance.details.read") ? "Finanzas" : "Finanzas (solo resumen)";
      case "calendario":
        return eff.has("calendar.events.manage_all")
          ? "Calendario (gestiona todo)"
          : eff.has("calendar.events.manage_assigned")
            ? "Calendario (gestiona sus áreas)"
            : "Calendario (lectura)";
      case "integrantes":
        return eff.has("members.consolidation.manage") ? "Consolidación" : "Consolidación (lectura)";
      case "reportes":
        return eff.has("finance.details.read") && eff.has("calendar.read")
          ? "Reportes"
          : eff.has("finance.details.read")
            ? "Reportes (Finanzas)"
            : "Reportes (Calendario)";
      case "configuracion":
        return "Configuración";
    }
  });
}
