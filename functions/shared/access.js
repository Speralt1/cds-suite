// GENERADO por scripts/build-shared.mjs desde lib/shared/access.ts — NO EDITAR.
"use strict";
// Modelo de acceso de CDS Suite (18a §B, §H). Único lugar donde viven el
// cierre de permisos, el fallback legacy, los módulos, el módulo inicial y el
// planner puro de la migración. Lo usan el cliente, las Functions (vía
// functions/shared/access.js) y los scripts.
//
// Invariante: `settings.manage` existe solo vía baseRole = admin.
Object.defineProperty(exports, "__esModule", { value: true });
exports.INACTIVE_USER_WARNING = exports.LEADER_NO_AREAS_WARNING = exports.MIGRATION_ACTOR = exports.MODULE_PERMISSIONS = exports.MODULE_HREF = exports.MODULE_ORDER = exports.LEGACY_ROLE_ACCESS = exports.IMPLIES = exports.STORABLE_PERMISSIONS = exports.PERMISSIONS = void 0;
exports.isPermission = isPermission;
exports.isStorablePermission = isStorablePermission;
exports.isLegacyRole = isLegacyRole;
exports.isHomeModule = isHomeModule;
exports.sortPermissions = sortPermissions;
exports.closure = closure;
exports.impliedBy = impliedBy;
exports.normalizeAccess = normalizeAccess;
exports.profilePermissions = profilePermissions;
exports.effectivePermissions = effectivePermissions;
exports.can = can;
exports.canAny = canAny;
exports.deriveLegacyRole = deriveLegacyRole;
exports.modulesForPermissions = modulesForPermissions;
exports.visibleModules = visibleModules;
exports.defaultHomeModule = defaultHomeModule;
exports.resolveHome = resolveHome;
exports.allowedHomeModules = allowedHomeModules;
exports.maskEmail = maskEmail;
exports.planAccessMigration = planAccessMigration;
const types_1 = require("./types");
Object.defineProperty(exports, "PERMISSIONS", { enumerable: true, get: function () { return types_1.PERMISSIONS; } });
Object.defineProperty(exports, "STORABLE_PERMISSIONS", { enumerable: true, get: function () { return types_1.STORABLE_PERMISSIONS; } });
/** Implicaciones directas (el cierre es transitivo). */
exports.IMPLIES = {
    "finance.details.read": ["finance.summary.read"],
    "finance.records.manage": ["finance.details.read"],
    "finance.pastoral.manage": ["finance.details.read"],
    "calendar.events.manage_all": ["calendar.events.manage_assigned"],
    "calendar.events.manage_assigned": ["calendar.read"],
    "calendar.events.publish_assigned": ["calendar.read"],
    "members.consolidation.manage": ["members.consolidation.read"],
};
/** Fallback legacy, IDÉNTICO al mapeo de la migración y a `legacyPermissions()` de las reglas. */
exports.LEGACY_ROLE_ACCESS = {
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
const ALL = new Set(types_1.PERMISSIONS);
const STORABLE = new Set(types_1.STORABLE_PERMISSIONS);
function isPermission(value) {
    return typeof value === "string" && ALL.has(value);
}
function isStorablePermission(value) {
    return typeof value === "string" && STORABLE.has(value);
}
function isLegacyRole(value) {
    return typeof value === "string" && types_1.LEGACY_ROLES.includes(value);
}
function isHomeModule(value) {
    return typeof value === "string" && types_1.HOME_MODULES.includes(value);
}
/** Ordena y deduplica según el orden del catálogo. */
function sortPermissions(perms) {
    const set = new Set(perms);
    return types_1.PERMISSIONS.filter((p) => set.has(p));
}
/** Cierre transitivo de un conjunto de permisos. */
function closure(perms) {
    const out = new Set();
    const stack = [...perms];
    while (stack.length) {
        const p = stack.pop();
        if (out.has(p))
            continue;
        out.add(p);
        for (const q of exports.IMPLIES[p] ?? [])
            stack.push(q);
    }
    return out;
}
/** Permisos que los marcados implican (sin incluir los marcados salvo que otro los implique). */
function impliedBy(perms) {
    const out = new Set();
    for (const p of new Set(perms))
        for (const q of closure(exports.IMPLIES[p] ?? []))
            out.add(q);
    return out;
}
function stringList(value, max) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        if (typeof item !== "string" || !item || out.includes(item))
            continue;
        out.push(item);
        if (out.length >= max)
            break;
    }
    return out;
}
/**
 * Normaliza `users/{uid}` (v1 si `accessSchemaVersion === 1`; si no, legacy por `role`).
 * Devuelve null si no hay documento. Nunca confía en los datos: permisos fuera del
 * catálogo guardable se ignoran (incluido `settings.manage`).
 */
function normalizeAccess(doc) {
    if (!doc || typeof doc !== "object")
        return null;
    const active = doc.active === true;
    const legacyRole = isLegacyRole(doc.role) ? doc.role : null;
    if (doc.accessSchemaVersion === 1) {
        const stored = Array.isArray(doc.permissions) ? doc.permissions.filter(isStorablePermission) : [];
        return {
            schema: "v1",
            active,
            baseRole: doc.baseRole === "admin" ? "admin" : "standard",
            permissions: sortPermissions(stored),
            areaIds: stringList(doc.areaIds, types_1.MAX_AREA_IDS),
            homeModule: isHomeModule(doc.homeModule) ? doc.homeModule : null,
            position: typeof doc.position === "string" ? doc.position.slice(0, types_1.MAX_POSITION_LENGTH) : "",
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
    const mapped = exports.LEGACY_ROLE_ACCESS[legacyRole];
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
function profilePermissions(p) {
    if (!p || !p.active)
        return new Set();
    if (p.baseRole === "admin")
        return new Set(ALL);
    const eff = closure(p.permissions.filter(isStorablePermission));
    eff.delete("settings.manage");
    return eff;
}
/**
 * Permisos efectivos de `users/{uid}`:
 * null o !active → ∅ ; baseRole admin → catálogo completo ; si no → cierre(permisos) \ {settings.manage}.
 */
function effectivePermissions(doc) {
    return profilePermissions(normalizeAccess(doc));
}
function can(doc, permission) {
    return effectivePermissions(doc).has(permission);
}
function canAny(doc, permissions) {
    const eff = effectivePermissions(doc);
    return permissions.some((p) => eff.has(p));
}
/**
 * Rol legacy coherente con un perfil v1 (se guarda siempre en `role`):
 * admin ⟺ baseRole admin ; pastor si el cierre incluye records + pastoral ;
 * finance si incluye records ; si no leader.
 */
function deriveLegacyRole(baseRole, perms) {
    if (baseRole === "admin")
        return "admin";
    const eff = closure(perms.filter(isStorablePermission));
    if (eff.has("finance.records.manage") && eff.has("finance.pastoral.manage"))
        return "pastor";
    if (eff.has("finance.records.manage"))
        return "finance";
    return "leader";
}
// ---------- Módulos y módulo inicial ----------
// Integrantes (Consolidación V1, doc 23) solo se ve con permiso EXPLÍCITO o admin:
// el fallback legacy no lo otorga a ningún rol.
exports.MODULE_ORDER = ["finance", "calendar", "members", "reports", "settings"];
exports.MODULE_HREF = {
    finance: "/finanzas",
    calendar: "/calendario",
    members: "/integrantes",
    reports: "/reportes",
    settings: "/configuracion",
};
/** Basta con uno de los permisos para ver el módulo. */
exports.MODULE_PERMISSIONS = {
    finance: ["finance.summary.read"],
    calendar: ["calendar.read"],
    members: ["members.consolidation.read"],
    reports: ["finance.details.read", "calendar.read"],
    settings: ["settings.manage"],
};
/** Módulos visibles para un conjunto de permisos efectivos, en el orden de la navegación. */
function modulesForPermissions(eff) {
    return exports.MODULE_ORDER.filter((m) => exports.MODULE_PERMISSIONS[m].some((p) => eff.has(p)));
}
function visibleModules(doc) {
    return modulesForPermissions(effectivePermissions(doc));
}
/**
 * Módulo inicial predeterminado según el perfil:
 * legacy → el del mapeo ; v1 → finance con details.read, calendar con calendar.read, si no finance.
 */
function defaultHomeModule(p) {
    if (p.schema === "legacy" && p.legacyRole)
        return exports.LEGACY_ROLE_ACCESS[p.legacyRole].homeModule;
    const eff = profilePermissions({ ...p, active: true });
    if (eff.has("finance.details.read"))
        return "finance";
    if (eff.has("calendar.read"))
        return "calendar";
    return "finance";
}
/**
 * Resolución del aterrizaje (18a §B.5):
 * 1) módulo configurado si es visible → 2) predeterminado del perfil si es visible →
 * 3) primer módulo visible → 4) "no-modules". Sin perfil o inactivo → "inactive".
 */
function resolveHome(doc) {
    const p = normalizeAccess(doc);
    if (!p || !p.active)
        return { kind: "inactive" };
    const modules = modulesForPermissions(profilePermissions(p));
    if (!modules.length)
        return { kind: "no-modules" };
    const configured = p.homeModule;
    if (configured && modules.includes(configured)) {
        return { kind: "module", module: configured, href: exports.MODULE_HREF[configured], source: "configured" };
    }
    const invalid = configured ? { invalidConfigured: configured } : {};
    const fallback = defaultHomeModule(p);
    if (modules.includes(fallback)) {
        return { kind: "module", module: fallback, href: exports.MODULE_HREF[fallback], source: "default", ...invalid };
    }
    const first = modules[0];
    return { kind: "module", module: first, href: exports.MODULE_HREF[first], source: "first", ...invalid };
}
/** Módulos iniciales que se pueden elegir con estos permisos. */
function allowedHomeModules(doc) {
    const visible = visibleModules(doc);
    return types_1.HOME_MODULES.filter((m) => visible.includes(m));
}
// ---------- Planner de migración (18a §H) ----------
exports.MIGRATION_ACTOR = "system:migrate-access-v1";
exports.LEADER_NO_AREAS_WARNING = "Líder sin áreas: solo verá el calendario hasta que se le asignen";
exports.INACTIVE_USER_WARNING = "Usuario inactivo: no tendrá acceso hasta que se reactive";
/** "salvador@gmail.com" → "s***@g***.com". */
function maskEmail(value) {
    if (typeof value !== "string" || !value)
        return "";
    const at = value.lastIndexOf("@");
    if (at <= 0 || at === value.length - 1)
        return "***";
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    const dot = domain.lastIndexOf(".");
    const host = dot > 0 ? domain.slice(0, dot) : domain;
    const tld = dot > 0 ? domain.slice(dot) : "";
    return `${local[0]}***@${host[0]}***${tld}`;
}
function planAccessMigration(uid, doc, opts) {
    const displayName = typeof doc.displayName === "string" ? doc.displayName : "";
    const emailMasked = maskEmail(doc.email);
    const oldRole = typeof doc.role === "string" ? doc.role : null;
    const base = { uid, displayName, emailMasked, oldRole };
    if (doc.accessSchemaVersion === 1) {
        return { ...base, status: "skip_already_v1", areaIds: stringList(doc.areaIds, types_1.MAX_AREA_IDS), changes: {}, warnings: [] };
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
    const mapped = exports.LEGACY_ROLE_ACCESS[role];
    const homeModule = role === "pastor" ? opts.pastorHome : mapped.homeModule;
    const permissions = [...mapped.permissions];
    const changes = {
        baseRole: mapped.baseRole,
        position: mapped.position,
        permissions: [...permissions],
        areaIds: [],
        homeModule,
        accessSchemaVersion: 1,
        updatedBy: exports.MIGRATION_ACTOR,
    };
    const effective = sortPermissions(effectivePermissions({ ...doc, ...changes }));
    const warnings = [];
    if (role === "leader")
        warnings.push(exports.LEADER_NO_AREAS_WARNING);
    if (doc.active !== true)
        warnings.push(exports.INACTIVE_USER_WARNING);
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
