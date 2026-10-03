import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_ROLE_ACCESS,
  deriveLegacyRole,
  effectivePermissions,
  sortPermissions,
} from "@/lib/shared/access";
import { LEGACY_ROLES, STORABLE_PERMISSIONS, type LegacyRole, type Permission } from "@/lib/shared/types";
import {
  LAST_ADMIN_ERROR,
  POSITION_PRESETS,
  SELF_PROTECTION_ERROR,
  SETTINGS_PERMISSION_ERROR,
  accessDraftFromUser,
  accessSummary,
  accessWarnings,
  applyPositionPreset,
  buildUserAccessV1Fields,
  buildUserDocV1,
  countActiveAdmins,
  draftAllowedHomeModules,
  draftAsDoc,
  impliedPermissions,
  implyingPermission,
  isOnlyActiveAdmin,
  presetDiffers,
  togglePermission,
  userListNotices,
  validateManagedUserAccessV1,
  validateManagedUserUpdate,
  type AccessDraft,
  type ManagedUserLike,
} from "@/lib/settings/users";

const fb = vi.hoisted(() => ({
  updates: [] as { path: string; data: Record<string, unknown> }[],
  sets: [] as { path: string; data: Record<string, unknown> }[],
  resetEmails: [] as string[],
}));

vi.mock("@/lib/firebase", () => ({
  getFirebaseServices: () => ({ app: { options: {} }, db: {}, auth: {} }),
}));
vi.mock("firebase/app", () => ({ initializeApp: () => ({}), deleteApp: async () => undefined }));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({}),
  setPersistence: async () => undefined,
  inMemoryPersistence: {},
  createUserWithEmailAndPassword: async () => ({ user: { uid: "new-uid" } }),
  deleteUser: async () => undefined,
  signOut: async () => undefined,
  sendPasswordResetEmail: async (_auth: unknown, email: string) => {
    fb.resetEmails.push(email);
  },
}));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: () => "SERVER_TS",
  doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` }),
  setDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    fb.sets.push({ path: ref.path, data });
  },
  updateDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    fb.updates.push({ path: ref.path, data });
  },
}));

// Espejo de validUserV1 de firestore.rules (18a §C.1/§D.2) para el payload resultante.
const V1_KEYS = [
  "displayName",
  "email",
  "role",
  "active",
  "createdAt",
  "baseRole",
  "position",
  "permissions",
  "areaIds",
  "homeModule",
  "accessSchemaVersion",
  "updatedAt",
  "updatedBy",
].sort();
const CATALOG_NO_SETTINGS = STORABLE_PERMISSIONS as readonly string[];

function rulesDerivedRole(d: { baseRole: string; permissions: string[] }) {
  if (d.baseRole === "admin") return "admin";
  if (d.permissions.includes("finance.records.manage") && d.permissions.includes("finance.pastoral.manage")) return "pastor";
  if (d.permissions.includes("finance.records.manage")) return "finance";
  return "leader";
}

function satisfiesValidUserV1(d: Record<string, unknown>, actor: string): boolean {
  const perms = d.permissions as string[];
  const areaIds = d.areaIds as string[];
  return (
    JSON.stringify(Object.keys(d).sort()) === JSON.stringify(V1_KEYS) &&
    typeof d.displayName === "string" &&
    d.displayName.length >= 1 &&
    d.displayName.length <= 120 &&
    ["admin", "pastor", "finance", "leader"].includes(d.role as string) &&
    typeof d.active === "boolean" &&
    ["admin", "standard"].includes(d.baseRole as string) &&
    typeof d.position === "string" &&
    d.position.length <= 60 &&
    Array.isArray(perms) &&
    perms.length <= 8 &&
    perms.every((p) => CATALOG_NO_SETTINGS.includes(p)) &&
    new Set(perms).size === perms.length &&
    (d.baseRole === "admin") === (d.role === "admin") &&
    d.role === rulesDerivedRole(d as { baseRole: string; permissions: string[] }) &&
    Array.isArray(areaIds) &&
    areaIds.length <= 20 &&
    new Set(areaIds).size === areaIds.length &&
    areaIds.every((id) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) && id.length <= 40) &&
    ["finance", "calendar"].includes(d.homeModule as string) &&
    d.accessSchemaVersion === 1 &&
    d.updatedAt === "SERVER_TS" &&
    d.updatedBy === actor
  );
}

function subsets<T>(items: readonly T[]): T[][] {
  return Array.from({ length: 1 << items.length }, (_, mask) => items.filter((_, i) => mask & (1 << i)));
}

const draft = (patch: Partial<AccessDraft> = {}): AccessDraft => ({
  displayName: "Ana Pérez",
  active: true,
  baseRole: "standard",
  position: "Líder",
  permissions: ["finance.summary.read", "calendar.events.manage_assigned"],
  areaIds: ["jovenes"],
  homeModule: "calendar",
  ...patch,
});

const legacyUser = (id: string, role: LegacyRole, active = true): ManagedUserLike => ({
  id,
  displayName: `Usuario ${id}`,
  email: `${id}@cds.cl`,
  role,
  active,
  createdAt: "CREATED",
});

describe("payload v1 coherente", () => {
  it("para todo conjunto de permisos y rol base: role derivado y válido para las reglas", () => {
    for (const baseRole of ["admin", "standard"] as const) {
      for (const permissions of subsets(STORABLE_PERMISSIONS)) {
        const doc = buildUserDocV1(draft({ baseRole, permissions }), {
          email: "ana@cds.cl",
          createdAt: "CREATED",
          updatedAt: "SERVER_TS",
          updatedBy: "admin-1",
        });
        expect(doc.role).toBe(deriveLegacyRole(baseRole, permissions));
        expect(satisfiesValidUserV1(doc as unknown as Record<string, unknown>, "admin-1")).toBe(true);
      }
    }
  });

  it("los campos de edición no incluyen email ni createdAt (inmutables)", () => {
    const fields = buildUserAccessV1Fields(draft(), { updatedAt: "SERVER_TS", updatedBy: "admin-1" });
    expect(Object.keys(fields).sort()).toEqual(V1_KEYS.filter((k) => k !== "email" && k !== "createdAt"));
  });

  it("settings.manage nunca se guarda", () => {
    expect(togglePermission(["calendar.read"], "settings.manage", true)).toEqual(["calendar.read"]);
    const sneaky = draft({ permissions: ["settings.manage", "calendar.read"] as Permission[] });
    expect(buildUserAccessV1Fields(sneaky, { updatedAt: "SERVER_TS", updatedBy: "x" }).permissions).toEqual(["calendar.read"]);
    expect(() => validateManagedUserAccessV1("admin-1", "u2", sneaky)).toThrow(SETTINGS_PERMISSION_ERROR);
  });
});

describe("cargos (presets)", () => {
  it("los 4 cargos actuales son idénticos al mapeo legacy", () => {
    const pairs: [keyof typeof POSITION_PRESETS, LegacyRole][] = [
      ["Administración", "admin"],
      ["Pastor", "pastor"],
      ["Finanzas", "finance"],
      ["Líder", "leader"],
    ];
    for (const [name, role] of pairs) {
      const preset = POSITION_PRESETS[name];
      expect(preset.baseRole).toBe(LEGACY_ROLE_ACCESS[role].baseRole);
      expect(preset.permissions).toEqual(LEGACY_ROLE_ACCESS[role].permissions);
      expect(preset.homeModule).toBe(LEGACY_ROLE_ACCESS[role].homeModule);
      expect(deriveLegacyRole(preset.baseRole, preset.permissions)).toBe(role);
    }
    expect(POSITION_PRESETS.Líder.requiresAreas).toBe(true);
  });

  it("aplicar un cargo reemplaza rol base, permisos y módulo inicial (y conserva áreas)", () => {
    const next = applyPositionPreset(draft(), "Pastor");
    expect(next.position).toBe("Pastor");
    expect(next.permissions).toEqual(LEGACY_ROLE_ACCESS.pastor.permissions);
    expect(next.homeModule).toBe("finance");
    expect(next.areaIds).toEqual(["jovenes"]);
    expect(presetDiffers(draft(), "Pastor")).toBe(true);
    expect(presetDiffers(applyPositionPreset(draft(), "Finanzas"), "Finanzas")).toBe(false);
  });
});

describe("promoción de documentos legacy", () => {
  it.each(LEGACY_ROLES)("%s: conserva exactamente el mismo acceso (incluido el financiero)", (role) => {
    const user = legacyUser("u1", role);
    const promoted = accessDraftFromUser(user);
    expect(promoted.baseRole).toBe(LEGACY_ROLE_ACCESS[role].baseRole);
    expect(promoted.permissions).toEqual(LEGACY_ROLE_ACCESS[role].permissions);
    expect(promoted.position).toBe(LEGACY_ROLE_ACCESS[role].position);
    expect(promoted.homeModule).toBe(LEGACY_ROLE_ACCESS[role].homeModule);
    expect(promoted.areaIds).toEqual([]);
    const before = sortPermissions(effectivePermissions(user));
    const after = sortPermissions(effectivePermissions(draftAsDoc(promoted)));
    expect(after).toEqual(before);
    const finance = (list: Permission[]) => list.filter((p) => p.startsWith("finance."));
    expect(finance(after)).toEqual(finance(before));
    expect(deriveLegacyRole(promoted.baseRole, promoted.permissions)).toBe(role);
  });

  it("un documento v1 se lee tal cual", () => {
    const v1: ManagedUserLike = {
      id: "u3",
      displayName: "Carla",
      email: "carla@cds.cl",
      role: "leader",
      active: true,
      accessSchemaVersion: 1,
      baseRole: "standard",
      position: "Coordinación",
      permissions: ["calendar.events.publish_assigned"],
      areaIds: ["alabanza"],
      homeModule: "calendar",
    };
    expect(accessDraftFromUser(v1)).toEqual({
      displayName: "Carla",
      active: true,
      baseRole: "standard",
      position: "Coordinación",
      permissions: ["calendar.events.publish_assigned"],
      areaIds: ["alabanza"],
      homeModule: "calendar",
    });
  });
});

describe("auto-protección y al menos un administrador", () => {
  const users = [legacyUser("me", "admin"), legacyUser("other", "admin"), legacyUser("x", "leader")];

  it("no puedes desactivarte ni quitarte el rol administrador", () => {
    const me = accessDraftFromUser(users[0]);
    expect(() => validateManagedUserAccessV1("me", "me", { ...me, active: false }, users)).toThrow(SELF_PROTECTION_ERROR);
    expect(() => validateManagedUserAccessV1("me", "me", { ...me, baseRole: "standard" }, users)).toThrow(
      SELF_PROTECTION_ERROR,
    );
    expect(validateManagedUserAccessV1("me", "me", { ...me, position: "Dirección" }, users).position).toBe("Dirección");
  });

  it("debe quedar al menos un administrador activo en la lista cargada", () => {
    const onlyOne = [legacyUser("me", "admin"), legacyUser("solo", "admin"), legacyUser("off", "admin", false)];
    // Hay 2 admins activos: quitarle admin a "solo" está permitido.
    const solo = accessDraftFromUser(onlyOne[1]);
    expect(() => validateManagedUserAccessV1("me", "solo", { ...solo, baseRole: "standard" }, onlyOne)).not.toThrow();
    // Si "solo" fuera el único activo (vista desactualizada), se bloquea.
    const stale = [legacyUser("solo", "admin"), legacyUser("off", "admin", false)];
    expect(isOnlyActiveAdmin(stale, "solo")).toBe(true);
    expect(countActiveAdmins(stale)).toBe(1);
    expect(() => validateManagedUserAccessV1("me", "solo", { ...solo, active: false }, stale)).toThrow(LAST_ADMIN_ERROR);
    expect(isOnlyActiveAdmin(users, "me")).toBe(false);
  });

  it("límites del documento", () => {
    expect(() => validateManagedUserAccessV1("me", "x", draft({ position: "x".repeat(61) }))).toThrow(/cargo/);
    const many = Array.from({ length: 21 }, (_, i) => `area-${i}`);
    expect(() => validateManagedUserAccessV1("me", "x", draft({ areaIds: many }))).toThrow(/20 áreas/);
    expect(() => validateManagedUserAccessV1("me", "x", draft({ areaIds: ["Mal Id"] }))).toThrow(/área/);
    expect(() => validateManagedUserAccessV1("me", "x", draft({ homeModule: "reports" as never }))).toThrow(/módulo/);
    expect(() => validateManagedUserAccessV1("me", "x", draft({ displayName: " " }))).toThrow(/nombre/);
  });

  it("el contrato existente de validateManagedUserUpdate no cambia", () => {
    expect(validateManagedUserUpdate("a", "b", { displayName: " X  Y ", role: "leader", active: true })).toEqual({
      displayName: "X Y",
      role: "leader",
      active: true,
    });
  });
});

describe("permisos implicados y avisos", () => {
  it("los implicados quedan marcados y no se pueden desmarcar", () => {
    const stored: Permission[] = ["finance.records.manage", "calendar.events.manage_all"];
    const implied = impliedPermissions(stored);
    expect([...implied].sort()).toEqual(
      ["calendar.events.manage_assigned", "calendar.read", "finance.details.read", "finance.summary.read"].sort(),
    );
    expect(togglePermission(stored, "finance.summary.read", false)).toEqual(sortPermissions(stored));
    expect(implyingPermission("finance.summary.read", stored)).toBe("finance.records.manage");
    expect(implyingPermission("calendar.read", stored)).toBe("calendar.events.manage_all");
    expect(implyingPermission("calendar.read", ["calendar.read"])).toBeNull();
  });

  it("módulo inicial limitado a lo que puede ver", () => {
    expect(draftAllowedHomeModules(draft({ permissions: ["calendar.read"] }))).toEqual(["calendar"]);
    expect(draftAllowedHomeModules(draft())).toEqual(["finance", "calendar"]);
    expect(draftAllowedHomeModules(draft({ permissions: [] }))).toEqual([]);
  });

  it("avisa sin áreas (gestionar / publicar), módulo inicial no permitido y sin módulos", () => {
    const areas = [{ id: "jovenes", active: false }];
    expect(accessWarnings(draft({ areaIds: [] })).map((w) => w.kind)).toEqual(["no-areas-manage"]);
    // Asignada solo a un área inactiva: igual queda sin áreas utilizables.
    expect(accessWarnings(draft(), areas).map((w) => w.kind)).toEqual(["no-areas-manage"]);
    expect(
      accessWarnings(draft({ permissions: ["calendar.events.publish_assigned"], areaIds: [] })).map((w) => w.kind),
    ).toEqual(["no-areas-publish"]);
    const home = accessWarnings(draft({ permissions: ["calendar.read"], homeModule: "finance" }));
    expect(home.map((w) => w.kind)).toEqual(["home-invalid"]);
    expect(home[0].text).toBe("El módulo inicial (Finanzas) ya no está permitido; al ingresar se abrirá Calendario.");
    expect(accessWarnings(draft({ permissions: [] })).map((w) => w.kind)).toEqual(["no-modules"]);
    expect(accessWarnings(draft({ areaIds: [], active: false }))).toEqual([]);
    expect(accessWarnings(draft({ areaIds: [], baseRole: "admin" }))).toEqual([]);
    expect(userListNotices(legacyUser("l", "leader"))).toEqual(["Sin áreas asignadas"]);
  });

  it("resume lo que verá", () => {
    expect(accessSummary(draft())).toEqual([
      "Finanzas (solo resumen)",
      "Calendario (gestiona sus áreas)",
      "Reportes (Calendario)",
    ]);
  });
});

describe("users-client escribe v1", () => {
  beforeEach(() => {
    fb.updates.length = 0;
    fb.sets.length = 0;
    fb.resetEmails.length = 0;
  });

  it("updateManagedUserAccess escribe el payload v1 completo (promueve legacy)", async () => {
    const { updateManagedUserAccess } = await import("@/lib/settings/users-client");
    const users = [legacyUser("me", "admin"), legacyUser("u1", "leader")];
    await updateManagedUserAccess({} as never, "me", "u1", draft({ areaIds: ["jovenes", "jovenes"] }), users);
    expect(fb.updates).toHaveLength(1);
    const { path, data } = fb.updates[0];
    expect(path).toBe("users/u1");
    expect(satisfiesValidUserV1({ ...data, email: "u1@cds.cl", createdAt: "CREATED" }, "me")).toBe(true);
    expect(data.areaIds).toEqual(["jovenes"]);
    expect(data.role).toBe("leader");
  });

  it("setManagedUserActive desactiva a partir de lo guardado y respeta la auto-protección", async () => {
    const { setManagedUserActive } = await import("@/lib/settings/users-client");
    const users = [legacyUser("me", "admin"), legacyUser("u1", "finance")];
    await setManagedUserActive({} as never, "me", users[1], false, users);
    expect(fb.updates[0].data).toMatchObject({ active: false, role: "finance", accessSchemaVersion: 1 });
    await expect(setManagedUserActive({} as never, "me", users[0], false, users)).rejects.toThrow(SELF_PROTECTION_ERROR);
    expect(fb.updates).toHaveLength(1);
  });

  it("updateManagedUser (clásico) promueve con el mapeo exacto del rol", async () => {
    const { updateManagedUser } = await import("@/lib/settings/users-client");
    await updateManagedUser({} as never, "me", "u1", { displayName: "Pedro", role: "pastor", active: true });
    const data = fb.updates[0].data;
    expect(data.permissions).toEqual(LEGACY_ROLE_ACCESS.pastor.permissions);
    expect(data.role).toBe("pastor");
    expect(satisfiesValidUserV1({ ...data, email: "e@cds.cl", createdAt: "C" }, "me")).toBe(true);
  });

  it("createManagedUser escribe v1 con role y envía el correo de contraseña", async () => {
    const { createManagedUser } = await import("@/lib/settings/users-client");
    const auth = { currentUser: { uid: "me" }, languageCode: "" };
    const result = await createManagedUser({} as never, auth as never, {
      displayName: " Ana ",
      email: "ANA@cds.cl",
      role: "leader",
      access: {
        baseRole: "standard",
        position: "Diácono",
        permissions: [...POSITION_PRESETS.Diácono.permissions],
        areaIds: ["jovenes"],
        homeModule: "calendar",
      },
    });
    expect(result).toEqual({ uid: "new-uid", resetEmailSent: true, resetEmailError: "" });
    expect(fb.resetEmails).toEqual(["ana@cds.cl"]);
    const { path, data } = fb.sets[0];
    expect(path).toBe("users/new-uid");
    expect(satisfiesValidUserV1(data, "me")).toBe(true);
    expect(data.createdAt).toBe("SERVER_TS");
    expect(data).toMatchObject({ email: "ana@cds.cl", role: "leader", position: "Diácono", areaIds: ["jovenes"], active: true });
  });

  it("createManagedUser sin acceso explícito usa el mapeo del rol", async () => {
    const { createManagedUser } = await import("@/lib/settings/users-client");
    const auth = { currentUser: { uid: "me" }, languageCode: "" };
    await createManagedUser({} as never, auth as never, { displayName: "Fin", email: "f@cds.cl", role: "finance" });
    expect(fb.sets[0].data).toMatchObject({
      role: "finance",
      baseRole: "standard",
      position: "Finanzas",
      permissions: LEGACY_ROLE_ACCESS.finance.permissions,
      homeModule: "finance",
      accessSchemaVersion: 1,
      updatedBy: "me",
    });
  });
});
