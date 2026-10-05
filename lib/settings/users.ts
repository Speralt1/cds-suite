import type { AccessUser, Role } from "@/lib/finance/types";
import {
  IMPLIES,
  LEGACY_ROLE_ACCESS,
  allowedHomeModules,
  closure,
  defaultHomeModule,
  deriveLegacyRole,
  effectivePermissions,
  impliedBy,
  isHomeModule,
  isStorablePermission,
  normalizeAccess,
  resolveHome,
  sortPermissions,
  type Landing,
} from "@/lib/shared/access";
import { MAX_AREA_IDS, MAX_POSITION_LENGTH, MAX_STORED_PERMISSIONS } from "@/lib/shared/types";
import type {
  BaseRole,
  HomeModule,
  LegacyRole,
  ModuleId,
  Permission,
  UserAccessDoc,
} from "@/lib/shared/types";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  pastor: "Pastor",
  finance: "Finanzas",
  leader: "Líder",
};

export interface ManagedUser extends AccessUser {
  id: string;
}

export interface ManagedUserUpdate {
  displayName: string;
  role: Role;
  active: boolean;
}

export interface ManagedUserCreate {
  displayName: string;
  email: string;
  role: Role;
}

function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function validateManagedUserCreate(input: ManagedUserCreate) {
  const displayName = normalizeDisplayName(input.displayName);
  const email = input.email.trim().toLowerCase();

  if (!displayName || displayName.length > 120) {
    throw new Error("El nombre debe tener entre 1 y 120 caracteres.");
  }

  if (
    !email ||
    email.length > 160 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Ingresa un correo electrónico válido.");
  }

  if (!(input.role in ROLE_LABELS)) {
    throw new Error("Selecciona un rol válido.");
  }

  return {
    displayName,
    email,
    role: input.role,
  };
}

export function validateManagedUserUpdate(
  currentUid: string,
  targetUid: string,
  update: ManagedUserUpdate,
) {
  const displayName = normalizeDisplayName(update.displayName);

  if (!displayName || displayName.length > 120) {
    throw new Error("El nombre debe tener entre 1 y 120 caracteres.");
  }

  if (targetUid === currentUid && (!update.active || update.role !== "admin")) {
    throw new Error(
      "No puedes desactivar tu propia cuenta ni quitarte el rol administrador.",
    );
  }

  return { ...update, displayName };
}

// ─────────────────────────────────────────────────────────────────────────────
// Acceso v1 (18a §B/§C.1, 18b §3.3–3.4). Lo anterior se conserva tal cual
// (contratos fijados por tests/settings.test.tsx); lo nuevo vive aquí abajo.
// ─────────────────────────────────────────────────────────────────────────────

export const SELF_PROTECTION_ERROR =
  "No puedes desactivar tu propia cuenta ni quitarte el rol administrador.";
export const LAST_ADMIN_ERROR =
  "Debe quedar al menos un administrador activo. Asigna otro administrador antes de hacer este cambio.";
export const SETTINGS_PERMISSION_ERROR =
  "«Administrar configuración» solo se obtiene con el rol base Administrador.";

/** Etiquetas en lenguaje simple (nunca se muestra el nombre técnico del permiso). */
export const PERMISSION_LABEL: Readonly<Record<Permission, string>> = {
  "finance.summary.read": "Ver resumen financiero",
  "finance.details.read": "Ver detalle financiero",
  "finance.records.manage": "Registrar y editar movimientos",
  "finance.pastoral.manage": "Seguimiento pastoral en diezmos",
  "calendar.read": "Ver calendario",
  "calendar.events.manage_assigned": "Gestionar actividades de sus áreas",
  "calendar.events.publish_assigned": "Publicar actividades de sus áreas",
  "calendar.events.manage_all": "Gestionar todas las actividades y el enlace público",
  "members.consolidation.read": "Ver Consolidación",
  "members.consolidation.manage": "Gestionar Consolidación",
  "settings.manage": "Administrar configuración",
};

export const PERMISSION_DESCRIPTION: Readonly<Record<Permission, string>> = {
  "finance.summary.read": "Cifras generales del período, sin movimientos ni nombres.",
  "finance.details.read": "Movimientos, ofrendas, diezmos, campañas y reportes.",
  "finance.records.manage": "Crear, corregir y anular registros financieros.",
  "finance.pastoral.manage": "Ver y escribir notas pastorales de diezmantes.",
  "calendar.read": "Ver todas las actividades, incluidas las de Solo equipo.",
  "calendar.events.manage_assigned": "Crear, editar, cancelar y eliminar actividades de las áreas asignadas.",
  "calendar.events.publish_assigned":
    "Marcar como Pública una actividad de sus áreas para que aparezca en el calendario compartido.",
  "calendar.events.manage_all": "Cualquier área, publicar y administrar el enlace compartido.",
  "members.consolidation.read":
    "Ver personas nuevas, sus visitas, seguimientos y alertas (nombres y teléfonos). Solo con autorización expresa.",
  "members.consolidation.manage":
    "Registrar personas, visitas y seguimientos, cambiar estados y responsables. Puede ser responsable de seguimiento.",
  "settings.manage": "Solo usuarios con rol Administrador.",
};

export interface PermissionGroup {
  id: "finance" | "calendar" | "members" | "settings";
  label: string;
  permissions: readonly Permission[];
  note?: string;
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    id: "finance",
    label: "Finanzas",
    permissions: ["finance.summary.read", "finance.details.read", "finance.records.manage", "finance.pastoral.manage"],
  },
  {
    id: "calendar",
    label: "Calendario",
    permissions: [
      "calendar.read",
      "calendar.events.manage_assigned",
      "calendar.events.publish_assigned",
      "calendar.events.manage_all",
    ],
    note: "Los reportes se muestran según lo que la persona puede ver.",
  },
  {
    id: "members",
    label: "Integrantes",
    permissions: ["members.consolidation.read", "members.consolidation.manage"],
    note: "Datos personales: otórgalo solo a quienes acompañan a las personas nuevas.",
  },
  { id: "settings", label: "Configuración", permissions: ["settings.manage"] },
];

export const HOME_MODULE_LABEL: Readonly<Record<HomeModule, string>> = {
  finance: "Finanzas",
  calendar: "Calendario",
};

export const MODULE_LABEL: Readonly<Record<ModuleId, string>> = {
  finance: "Finanzas",
  calendar: "Calendario",
  members: "Integrantes",
  reports: "Reportes",
  settings: "Configuración",
};

export const POSITION_PRESET_NAMES = ["Administración", "Pastor", "Finanzas", "Líder", "Diácono"] as const;
export type PositionPresetName = (typeof POSITION_PRESET_NAMES)[number];

export interface PositionPreset {
  baseRole: BaseRole;
  permissions: readonly Permission[];
  homeModule: HomeModule;
  /** El cargo propone gestionar actividades de sus áreas (pide áreas al crear). */
  requiresAreas: boolean;
}

function presetFromLegacy(role: LegacyRole): PositionPreset {
  const mapped = LEGACY_ROLE_ACCESS[role];
  return {
    baseRole: mapped.baseRole,
    permissions: [...mapped.permissions],
    homeModule: mapped.homeModule,
    requiresAreas: role === "leader",
  };
}

/** Permisos sugeridos por cargo. Los 4 primeros son idénticos al mapeo de los roles actuales. */
export const POSITION_PRESETS: Readonly<Record<PositionPresetName, PositionPreset>> = {
  Administración: presetFromLegacy("admin"),
  Pastor: presetFromLegacy("pastor"),
  Finanzas: presetFromLegacy("finance"),
  Líder: presetFromLegacy("leader"),
  Diácono: presetFromLegacy("leader"),
};

export function isPositionPreset(value: string): value is PositionPresetName {
  return (POSITION_PRESET_NAMES as readonly string[]).includes(value);
}

/** Lo editable del acceso de una persona (el borrador del editor). */
export interface AccessDraft {
  displayName: string;
  active: boolean;
  baseRole: BaseRole;
  position: string;
  /** Permisos guardados (marcados), sin `settings.manage`. */
  permissions: Permission[];
  areaIds: string[];
  homeModule: HomeModule;
}

/** `users/{uid}` tal como lo lee la lista (legacy o v1). */
export type ManagedUserLike = Pick<ManagedUser, "id" | "displayName" | "email"> &
  UserAccessDoc & { createdAt?: unknown };

/**
 * Borrador a partir del documento. Un documento legacy se promueve con el
 * mapeo EXACTO de la migración (LEGACY_ROLE_ACCESS): mismo acceso financiero.
 */
export function accessDraftFromUser(user: ManagedUserLike): AccessDraft {
  const profile = normalizeAccess(user);
  const displayName = typeof user.displayName === "string" ? user.displayName : "";
  if (!profile) {
    return { displayName, active: false, baseRole: "standard", position: "", permissions: [], areaIds: [], homeModule: "finance" };
  }
  if (profile.schema === "legacy") {
    const mapped = profile.legacyRole ? LEGACY_ROLE_ACCESS[profile.legacyRole] : null;
    return {
      displayName,
      active: profile.active,
      baseRole: mapped?.baseRole ?? "standard",
      position: mapped?.position ?? "",
      permissions: mapped ? [...mapped.permissions] : [],
      areaIds: [],
      homeModule: mapped?.homeModule ?? "finance",
    };
  }
  return {
    displayName,
    active: profile.active,
    baseRole: profile.baseRole,
    position: profile.position,
    permissions: [...profile.permissions],
    areaIds: [...profile.areaIds],
    homeModule: profile.homeModule ?? defaultHomeModule(profile),
  };
}

/** El borrador como documento v1 (para usar las funciones de lib/shared/access). */
export function draftAsDoc(draft: AccessDraft): UserAccessDoc {
  return {
    role: deriveLegacyRole(draft.baseRole, draft.permissions),
    active: draft.active,
    accessSchemaVersion: 1,
    baseRole: draft.baseRole,
    permissions: draft.permissions,
    areaIds: draft.areaIds,
    homeModule: draft.homeModule,
    position: draft.position,
  };
}

/** Permisos efectivos del borrador como si la cuenta estuviera activa. */
export function draftPermissions(draft: AccessDraft): ReadonlySet<Permission> {
  return effectivePermissions(draftAsDoc({ ...draft, active: true }));
}

/** Módulos iniciales elegibles (finance | calendar) con estos permisos. */
export function draftAllowedHomeModules(draft: AccessDraft): HomeModule[] {
  return allowedHomeModules(draftAsDoc({ ...draft, active: true }));
}

/** Aterrizaje del borrador (para "Al ingresar abrirá …"). */
export function draftLanding(draft: AccessDraft): Landing {
  return resolveHome(draftAsDoc(draft));
}

/** Implicados por los marcados: se muestran marcados y deshabilitados. */
export function impliedPermissions(stored: readonly Permission[]): Set<Permission> {
  return impliedBy(stored.filter(isStorablePermission));
}

/** Permiso marcado que incluye a `perm` (el de más arriba), para "Incluido por «…»". */
export function implyingPermission(perm: Permission, stored: readonly Permission[]): Permission | null {
  const implies = (q: Permission, p: Permission) => q !== p && closure(IMPLIES[q] ?? []).has(p);
  const candidates = sortPermissions(stored.filter(isStorablePermission)).filter((q) => implies(q, perm));
  if (!candidates.length) return null;
  return candidates.find((q) => !candidates.some((r) => implies(r, q))) ?? candidates[0];
}

/** Marca o desmarca un permiso. `settings.manage` nunca se guarda; un implicado no se puede desmarcar. */
export function togglePermission(stored: readonly Permission[], perm: Permission, on: boolean): Permission[] {
  if (!isStorablePermission(perm)) return sortPermissions(stored.filter(isStorablePermission));
  if (!on && impliedPermissions(stored).has(perm)) return sortPermissions(stored);
  const next = on ? [...stored, perm] : stored.filter((p) => p !== perm);
  return sortPermissions(next.filter(isStorablePermission));
}

/** Aplica un cargo con sus permisos sugeridos (solo tras confirmación explícita en la UI). */
export function applyPositionPreset(draft: AccessDraft, name: PositionPresetName): AccessDraft {
  const preset = POSITION_PRESETS[name];
  return {
    ...draft,
    position: name,
    baseRole: preset.baseRole,
    permissions: [...preset.permissions],
    homeModule: preset.homeModule,
  };
}

/** ¿Aplicar el cargo cambiaría rol base, permisos o módulo inicial? (si no, no hace falta confirmar). */
export function presetDiffers(draft: AccessDraft, name: PositionPresetName): boolean {
  const preset = POSITION_PRESETS[name];
  return (
    draft.baseRole !== preset.baseRole ||
    draft.homeModule !== preset.homeModule ||
    sortPermissions(draft.permissions).join() !== sortPermissions(preset.permissions).join()
  );
}

export function sameAccessDraft(a: AccessDraft, b: AccessDraft): boolean {
  const key = (d: AccessDraft) =>
    JSON.stringify({
      ...d,
      displayName: normalizeDisplayName(d.displayName),
      position: d.position.trim(),
      permissions: sortPermissions(d.permissions),
      areaIds: [...d.areaIds].sort(),
    });
  return key(a) === key(b);
}

function isActiveAdminDoc(user: UserAccessDoc): boolean {
  const p = normalizeAccess(user);
  return !!p && p.active && p.baseRole === "admin";
}

export function countActiveAdmins(users: readonly UserAccessDoc[]): number {
  return users.filter(isActiveAdminDoc).length;
}

/** El usuario es el único administrador activo de la lista cargada. */
export function isOnlyActiveAdmin(users: readonly ManagedUserLike[], uid: string): boolean {
  const admins = users.filter(isActiveAdminDoc);
  return admins.length === 1 && admins[0].id === uid;
}

const AREA_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Valida un cambio de acceso v1 y devuelve el borrador limpio (lanza Error con
 * copy para la UI). Incluye la auto-protección de las reglas y, sobre la lista
 * cargada, que quede al menos un administrador activo.
 */
export function validateManagedUserAccessV1(
  currentUid: string,
  targetUid: string,
  draft: AccessDraft,
  users: readonly ManagedUserLike[] = [],
): AccessDraft {
  const displayName = normalizeDisplayName(draft.displayName);
  if (!displayName || displayName.length > 120) throw new Error("El nombre debe tener entre 1 y 120 caracteres.");

  const position = draft.position.trim().replace(/\s+/g, " ");
  if (position.length > MAX_POSITION_LENGTH) throw new Error(`El cargo puede tener hasta ${MAX_POSITION_LENGTH} caracteres.`);

  if (draft.baseRole !== "admin" && draft.baseRole !== "standard") throw new Error("Selecciona un rol base válido.");
  if (draft.permissions.includes("settings.manage")) throw new Error(SETTINGS_PERMISSION_ERROR);
  if (!draft.permissions.every(isStorablePermission)) throw new Error("Hay un permiso que no es válido.");
  const permissions = sortPermissions(draft.permissions);
  if (permissions.length > MAX_STORED_PERMISSIONS) throw new Error("Hay demasiados permisos marcados.");

  const areaIds = Array.from(new Set(draft.areaIds));
  if (areaIds.length > MAX_AREA_IDS) throw new Error(`Puedes asignar hasta ${MAX_AREA_IDS} áreas.`);
  if (!areaIds.every((id) => typeof id === "string" && id.length <= 40 && AREA_ID_PATTERN.test(id)))
    throw new Error("Hay un área que no es válida.");

  if (!isHomeModule(draft.homeModule)) throw new Error("Selecciona un módulo inicial válido.");
  if (typeof draft.active !== "boolean") throw new Error("Indica si la cuenta queda activa.");

  if (targetUid === currentUid && (!draft.active || draft.baseRole !== "admin")) throw new Error(SELF_PROTECTION_ERROR);

  const target = users.find((u) => u.id === targetUid);
  const remainsAdmin = draft.active && draft.baseRole === "admin";
  if (target && isActiveAdminDoc(target) && !remainsAdmin) {
    const others = users.filter((u) => u.id !== targetUid && isActiveAdminDoc(u));
    if (!others.length) throw new Error(LAST_ADMIN_ERROR);
  }

  return { displayName, active: draft.active, baseRole: draft.baseRole, position, permissions, areaIds, homeModule: draft.homeModule };
}

/** Campos v1 que escribe la UI (todos menos `email` y `createdAt`, que son inmutables). */
export interface UserAccessV1Fields {
  displayName: string;
  role: LegacyRole;
  active: boolean;
  baseRole: BaseRole;
  position: string;
  permissions: Permission[];
  areaIds: string[];
  homeModule: HomeModule;
  accessSchemaVersion: 1;
  updatedAt: unknown;
  updatedBy: string;
}

/**
 * Campos v1 coherentes para un borrador YA validado: `role` derivado con
 * deriveLegacyRole, `settings.manage` nunca guardado, `accessSchemaVersion: 1`.
 * `updatedAt` debe ser `serverTimestamp()` (las reglas exigen request.time).
 */
export function buildUserAccessV1Fields(draft: AccessDraft, meta: { updatedAt: unknown; updatedBy: string }): UserAccessV1Fields {
  const permissions = sortPermissions(draft.permissions.filter(isStorablePermission));
  return {
    displayName: normalizeDisplayName(draft.displayName),
    role: deriveLegacyRole(draft.baseRole, permissions),
    active: draft.active,
    baseRole: draft.baseRole,
    position: draft.position.trim(),
    permissions,
    areaIds: Array.from(new Set(draft.areaIds)),
    homeModule: draft.homeModule,
    accessSchemaVersion: 1,
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy,
  };
}

/** Documento v1 completo (alta): los campos v1 + `email` y `createdAt`. */
export function buildUserDocV1(
  draft: AccessDraft,
  meta: { email: string; createdAt: unknown; updatedAt: unknown; updatedBy: string },
): UserAccessV1Fields & { email: string; createdAt: unknown } {
  return { ...buildUserAccessV1Fields(draft, meta), email: meta.email, createdAt: meta.createdAt };
}

/** Acceso de un alta: el indicado o, si no, el mapeo del rol actual. */
export function accessDraftForCreate(
  input: { displayName: string; role: Role },
  access?: Omit<AccessDraft, "displayName" | "active">,
): AccessDraft {
  if (access) return { displayName: input.displayName, active: true, ...access };
  const mapped = LEGACY_ROLE_ACCESS[input.role];
  return {
    displayName: input.displayName,
    active: true,
    baseRole: mapped.baseRole,
    position: mapped.position,
    permissions: [...mapped.permissions],
    areaIds: [],
    homeModule: mapped.homeModule,
  };
}

export type AccessWarningKind = "no-areas-manage" | "no-areas-publish" | "home-invalid" | "no-modules";

export interface AccessWarning {
  kind: AccessWarningKind;
  /** Texto completo (editor). */
  text: string;
  /** Texto corto visible (lista). */
  short: string;
}

/**
 * Avisos del acceso (tono advertencia, ícono + texto). `areas` (opcional)
 * hace que solo cuenten las áreas activas existentes.
 */
export function accessWarnings(
  draft: AccessDraft,
  areas?: readonly { id: string; active: boolean }[],
): AccessWarning[] {
  if (!draft.active) return [];
  const out: AccessWarning[] = [];
  const eff = draftPermissions(draft);
  const landing = draftLanding(draft);
  if (landing.kind === "no-modules") {
    out.push({
      kind: "no-modules",
      text: "No tiene permisos de ningún módulo. Al ingresar verá «Aún no tienes módulos asignados».",
      short: "Sin módulos",
    });
    return out;
  }
  const usableAreas = areas
    ? draft.areaIds.filter((id) => areas.some((a) => a.id === id && a.active))
    : draft.areaIds;
  const scoped = draft.baseRole !== "admin" && !eff.has("calendar.events.manage_all");
  if (scoped && !usableAreas.length && eff.has("calendar.events.manage_assigned"))
    out.push({
      kind: "no-areas-manage",
      text: "Gestiona actividades de sus áreas, pero no tiene áreas asignadas. No podrá crear actividades hasta que le asignes una.",
      short: "Sin áreas asignadas",
    });
  if (scoped && !usableAreas.length && eff.has("calendar.events.publish_assigned"))
    out.push({
      kind: "no-areas-publish",
      text: "Puede publicar actividades de sus áreas, pero no tiene áreas asignadas.",
      short: "Sin áreas asignadas",
    });
  if (landing.kind === "module" && landing.invalidConfigured)
    out.push({
      kind: "home-invalid",
      text: `El módulo inicial (${HOME_MODULE_LABEL[landing.invalidConfigured]}) ya no está permitido; al ingresar se abrirá ${MODULE_LABEL[landing.module]}.`,
      short: "Módulo inicial no permitido",
    });
  return out;
}

/** Avisos cortos para la lista (sin repetir "Sin áreas asignadas"). */
export function userListNotices(user: ManagedUserLike, areas?: readonly { id: string; active: boolean }[]): string[] {
  return Array.from(new Set(accessWarnings(accessDraftFromUser(user), areas).map((w) => w.short)));
}

/** "Finanzas (solo resumen) · Calendario (gestiona sus áreas) · Reportes (Calendario)". */
export function accessSummary(draft: AccessDraft): string[] {
  const eff = draftPermissions(draft);
  const out: string[] = [];
  if (eff.has("finance.summary.read")) {
    out.push(
      eff.has("finance.records.manage")
        ? "Finanzas (registra movimientos)"
        : eff.has("finance.details.read")
          ? "Finanzas (consulta el detalle)"
          : "Finanzas (solo resumen)",
    );
  }
  if (eff.has("calendar.read")) {
    out.push(
      eff.has("calendar.events.manage_all")
        ? "Calendario (gestiona todas las actividades)"
        : eff.has("calendar.events.manage_assigned")
          ? "Calendario (gestiona sus áreas)"
          : eff.has("calendar.events.publish_assigned")
            ? "Calendario (publica de sus áreas)"
            : "Calendario (solo lectura)",
    );
  }
  const reports = [eff.has("finance.details.read") ? "Finanzas" : "", eff.has("calendar.read") ? "Calendario" : ""].filter(Boolean);
  if (reports.length) out.push(`Reportes (${reports.join(" y ")})`);
  if (eff.has("settings.manage")) out.push("Configuración");
  return out;
}
