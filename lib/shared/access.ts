// Modelo de acceso de CDS Suite (18a §B, §H). Único lugar donde viven el
// cierre de permisos, el fallback legacy, los módulos, el módulo inicial y el
// planner puro de la migración. Lo usan el cliente, las Functions (vía
// functions/shared/access.js) y los scripts.
//
// Invariante: `settings.manage` existe solo vía baseRole = admin.

import {
  HOME_MODULES,
  LEGACY_ROLES,
  MAX_AREA_IDS,
  MAX_POSITION_LENGTH,
  PERMISSIONS,
  STORABLE_PERMISSIONS,
} from "./types";
import type {
  AccessProfile,
  BaseRole,
  HomeModule,
  LegacyRole,
  ModuleId,
  Permission,
  UserAccessDoc,
} from "./types";

export { PERMISSIONS, STORABLE_PERMISSIONS };
export type { AccessProfile, BaseRole, HomeModule, LegacyRole, ModuleId, Permission, UserAccessDoc };

/** Implicaciones directas (el cierre es transitivo). */
export const IMPLIES: Readonly<Partial<Record<Permission, readonly Permission[]>>> = {
  "finance.details.read": ["finance.summary.read"],
  "finance.records.manage": ["finance.details.read"],
  "finance.pastoral.manage": ["finance.details.read"],
  "calendar.events.manage_all": ["calendar.events.manage_assigned"],
  "calendar.events.manage_assigned": ["calendar.read"],
  "calendar.events.publish_assigned": ["calendar.read"],
  "members.consolidation.manage": ["members.consolidation.read"],
};

export interface LegacyRoleAccess {
  baseRole: BaseRole;
  position: string;
  permissions: Permission[];
  homeModule: HomeModule;
}

/** Fallback legacy, IDÉNTICO al mapeo de la migración y a `legacyPermissions()` de las reglas. */
export const LEGACY_ROLE_ACCESS: Readonly<Record<LegacyRole, Readonly<LegacyRoleAccess>>> = {
  admin: { baseRole: "admin", position: "Administración", permissions: [], homeModule: "finance" },
  pastor: {
    baseRole: "standard",
    position: "Pastor",
    homeModule: "finance",
    permissions: [
      "finance.summary.read",
      "finance.details.read",
      "finance.records.manage",
      "finance.pastoral.manage",
      "calendar.read",
      "calendar.events.manage_all",
    ],
  },
  finance: {
    baseRole: "standard",
    position: "Finanzas",
    homeModule: "finance",
    permissions: ["finance.summary.read", "finance.details.read", "finance.records.manage", "calendar.read"],
  },
  leader: {
    baseRole: "standard",
    position: "Líder",
    homeModule: "calendar",
    permissions: ["finance.summary.read", "calendar.read", "calendar.events.manage_assigned"],
  },
};

const ALL: ReadonlySet<Permission> = new Set<Permission>(PERMISSIONS);
const STORABLE: ReadonlySet<Permission> = new Set<Permission>(STORABLE_PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && ALL.has(value as Permission);
}

export function isStorablePermission(value: unknown): value is Permission {
  return typeof value === "string" && STORABLE.has(value as Permission);
}

export function isLegacyRole(value: unknown): value is LegacyRole {
  return typeof value === "string" && (LEGACY_ROLES as readonly string[]).includes(value);
}

export function isHomeModule(value: unknown): value is HomeModule {
  return typeof value === "string" && (HOME_MODULES as readonly string[]).includes(value);
}

/** Ordena y deduplica según el orden del catálogo. */
export function sortPermissions(perms: Iterable<Permission>): Permission[] {
  const set = new Set(perms);
  return PERMISSIONS.filter((p) => set.has(p));
}

/** Cierre transitivo de un conjunto de permisos. */
export function closure(perms: Iterable<Permission>): Set<Permission> {
  const out = new Set<Permission>();
  const stack: Permission[] = [...perms];
  while (stack.length) {
    const p = stack.pop() as Permission;
    if (out.has(p)) continue;
    out.add(p);
    for (const q of IMPLIES[p] ?? []) stack.push(q);
  }
  return out;
}

/** Permisos que los marcados implican (sin incluir los marcados salvo que otro los implique). */
export function impliedBy(perms: Iterable<Permission>): Set<Permission> {
  const out = new Set<Permission>();
  for (const p of new Set(perms)) for (const q of closure(IMPLIES[p] ?? [])) out.add(q);
  return out;
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item || out.includes(item)) continue;
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Normaliza `users/{uid}` (v1 si `accessSchemaVersion === 1`; si no, legacy por `role`).
 * Devuelve null si no hay documento. Nunca confía en los datos: permisos fuera del
 * catálogo guardable se ignoran (incluido `settings.manage`).
 */
export function normalizeAccess(doc: UserAccessDoc | null | undefined): AccessProfile | null {
  if (!doc || typeof doc !== "object") return null;
  const active = doc.active === true;
  const legacyRole = isLegacyRole(doc.role) ? doc.role : null;
  if (doc.accessSchemaVersion === 1) {
    const stored = Array.isArray(doc.permissions) ? doc.permissions.filter(isStorablePermission) : [];
    return {
      schema: "v1",
      active,
      baseRole: doc.baseRole === "admin" ? "admin" : "standard",
      permissions: sortPermissions(stored),
      areaIds: stringList(doc.areaIds, MAX_AREA_IDS),
      homeModule: isHomeModule(doc.homeModule) ? doc.homeModule : null,
      position: typeof doc.position === "string" ? doc.position.slice(0, MAX_POSITION_LENGTH) : "",
      legacyRole,
    };
  }
  if (!legacyRole) {
    return {
      schema: "legacy",
      active,
      baseRole: "standard",
      permissions: [],
      areaIds: [],
      homeModule: null,
      position: "",
      legacyRole: null,
    };
  }
  const mapped = LEGACY_ROLE_ACCESS[legacyRole];
  return {
    schema: "legacy",
    active,
    baseRole: mapped.baseRole,
    permissions: [...mapped.permissions],
    areaIds: [],
    homeModule: null,
    position: mapped.position,
    legacyRole,
  };
}

/** Permisos efectivos de un perfil ya normalizado. */
export function profilePermissions(p: AccessProfile | null | undefined): Set<Permission> {
  if (!p || !p.active) return new Set();
  if (p.baseRole === "admin") return new Set(ALL);
  const eff = closure(p.permissions.filter(isStorablePermission));
  eff.delete("settings.manage");
  return eff;
}

/**
 * Permisos efectivos de `users/{uid}`:
 * null o !active → ∅ ; baseRole admin → catálogo completo ; si no → cierre(permisos) \ {settings.manage}.
 */
export function effectivePermissions(doc: UserAccessDoc | null | undefined): ReadonlySet<Permission> {
  return profilePermissions(normalizeAccess(doc));
}

export function can(doc: UserAccessDoc | null | undefined, permission: Permission): boolean {
  return effectivePermissions(doc).has(permission);
}

export function canAny(doc: UserAccessDoc | null | undefined, permissions: readonly Permission[]): boolean {
  const eff = effectivePermissions(doc);
  return permissions.some((p) => eff.has(p));
}

/**
 * Rol legacy coherente con un perfil v1 (se guarda siempre en `role`):
 * admin ⟺ baseRole admin ; pastor si el cierre incluye records + pastoral ;
 * finance si incluye records ; si no leader.
 */
export function deriveLegacyRole(baseRole: BaseRole, perms: readonly Permission[]): LegacyRole {
  if (baseRole === "admin") return "admin";
  const eff = closure(perms.filter(isStorablePermission));
  if (eff.has("finance.records.manage") && eff.has("finance.pastoral.manage")) return "pastor";
  if (eff.has("finance.records.manage")) return "finance";
  return "leader";
}

// ---------- Módulos y módulo inicial ----------

// Integrantes (Consolidación V1, doc 23) solo se ve con permiso EXPLÍCITO o admin:
// el fallback legacy no lo otorga a ningún rol.
export const MODULE_ORDER: readonly ModuleId[] = ["finance", "calendar", "members", "reports", "settings"];

export const MODULE_HREF: Readonly<Record<ModuleId, string>> = {
  finance: "/finanzas",
  calendar: "/calendario",
  members: "/integrantes",
  reports: "/reportes",
  settings: "/configuracion",
};

/** Basta con uno de los permisos para ver el módulo. */
export const MODULE_PERMISSIONS: Readonly<Record<ModuleId, readonly Permission[]>> = {
  finance: ["finance.summary.read"],
  calendar: ["calendar.read"],
  members: ["members.consolidation.read"],
  reports: ["finance.details.read", "calendar.read"],
  settings: ["settings.manage"],
};

/** Módulos visibles para un conjunto de permisos efectivos, en el orden de la navegación. */
export function modulesForPermissions(eff: ReadonlySet<Permission>): ModuleId[] {
  return MODULE_ORDER.filter((m) => MODULE_PERMISSIONS[m].some((p) => eff.has(p)));
}

export function visibleModules(doc: UserAccessDoc | null | undefined): ModuleId[] {
  return modulesForPermissions(effectivePermissions(doc));
}

export type Landing =
  | { kind: "inactive" }
  | { kind: "no-modules" }
  | {
      kind: "module";
      module: ModuleId;
      href: string;
      source: "configured" | "default" | "first";
      /** El módulo inicial configurado ya no está permitido. */
      invalidConfigured?: HomeModule;
    };

/**
 * Módulo inicial predeterminado según el perfil:
 * legacy → el del mapeo ; v1 → finance con details.read, calendar con calendar.read, si no finance.
 */
export function defaultHomeModule(p: AccessProfile): HomeModule {
  if (p.schema === "legacy" && p.legacyRole) return LEGACY_ROLE_ACCESS[p.legacyRole].homeModule;
  const eff = profilePermissions({ ...p, active: true });
  if (eff.has("finance.details.read")) return "finance";
  if (eff.has("calendar.read")) return "calendar";
  return "finance";
}

/**
 * Resolución del aterrizaje (18a §B.5):
 * 1) módulo configurado si es visible → 2) predeterminado del perfil si es visible →
 * 3) primer módulo visible → 4) "no-modules". Sin perfil o inactivo → "inactive".
 */
export function resolveHome(doc: UserAccessDoc | null | undefined): Landing {
  const p = normalizeAccess(doc);
  if (!p || !p.active) return { kind: "inactive" };
  const modules = modulesForPermissions(profilePermissions(p));
  if (!modules.length) return { kind: "no-modules" };
  const configured = p.homeModule;
  if (configured && modules.includes(configured)) {
    return { kind: "module", module: configured, href: MODULE_HREF[configured], source: "configured" };
  }
  const invalid = configured ? { invalidConfigured: configured } : {};
  const fallback = defaultHomeModule(p);
  if (modules.includes(fallback)) {
    return { kind: "module", module: fallback, href: MODULE_HREF[fallback], source: "default", ...invalid };
  }
  const first = modules[0];
  return { kind: "module", module: first, href: MODULE_HREF[first], source: "first", ...invalid };
}

/** Módulos iniciales que se pueden elegir con estos permisos. */
export function allowedHomeModules(doc: UserAccessDoc | null | undefined): HomeModule[] {
  const visible = visibleModules(doc);
  return HOME_MODULES.filter((m) => visible.includes(m));
}

// ---------- Planner de migración (18a §H) ----------

export const MIGRATION_ACTOR = "system:migrate-access-v1";
export const LEADER_NO_AREAS_WARNING = "Líder sin áreas: solo verá el calendario hasta que se le asignen";
export const INACTIVE_USER_WARNING = "Usuario inactivo: no tendrá acceso hasta que se reactive";

export type MigrationStatus = "migrate" | "skip_already_v1" | "skip_invalid_role";

export interface MigrationPlanRow {
  uid: string;
  displayName: string;
  emailMasked: string;
  oldRole: string | null;
  status: MigrationStatus;
  baseRole?: BaseRole;
  position?: string;
  permissions?: Permission[];
  effective?: Permission[];
  homeModule?: HomeModule;
  areaIds: string[];
  /**
   * Campos a escribir con `update()`. NO incluye `updatedAt`: el script agrega
   * `updatedAt: FieldValue.serverTimestamp()`. Nunca incluye role, displayName,
   * email, active ni createdAt.
   */
  changes: Record<string, unknown>;
  warnings: string[];
}

export interface MigrationOptions {
  pastorHome: HomeModule;
}

/** "salvador@gmail.com" → "s***@g***.com". */
export function maskEmail(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return "***";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local[0]}***@${host[0]}***${tld}`;
}

export function planAccessMigration(
  uid: string,
  doc: UserAccessDoc & { displayName?: unknown; email?: unknown },
  opts: MigrationOptions,
): MigrationPlanRow {
  const displayName = typeof doc.displayName === "string" ? doc.displayName : "";
  const emailMasked = maskEmail(doc.email);
  const oldRole = typeof doc.role === "string" ? doc.role : null;
  const base = { uid, displayName, emailMasked, oldRole };

  if (doc.accessSchemaVersion === 1) {
    return { ...base, status: "skip_already_v1", areaIds: stringList(doc.areaIds, MAX_AREA_IDS), changes: {}, warnings: [] };
  }
  if (!isLegacyRole(doc.role)) {
    return {
      ...base,
      status: "skip_invalid_role",
      areaIds: [],
      changes: {},
      warnings: [`Rol no válido: ${oldRole === null ? "(sin rol)" : JSON.stringify(oldRole)}`],
    };
  }

  const role = doc.role;
  const mapped = LEGACY_ROLE_ACCESS[role];
  const homeModule: HomeModule = role === "pastor" ? opts.pastorHome : mapped.homeModule;
  const permissions = [...mapped.permissions];
  const changes: Record<string, unknown> = {
    baseRole: mapped.baseRole,
    position: mapped.position,
    permissions: [...permissions],
    areaIds: [],
    homeModule,
    accessSchemaVersion: 1,
    updatedBy: MIGRATION_ACTOR,
  };
  const effective = sortPermissions(effectivePermissions({ ...doc, ...changes }));
  const warnings: string[] = [];
  if (role === "leader") warnings.push(LEADER_NO_AREAS_WARNING);
  if (doc.active !== true) warnings.push(INACTIVE_USER_WARNING);
  return {
    ...base,
    status: "migrate",
    baseRole: mapped.baseRole,
    position: mapped.position,
    permissions,
    effective,
    homeModule,
    areaIds: [],
    changes,
    warnings,
  };
}
