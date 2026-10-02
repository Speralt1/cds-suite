// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  IMPLIES,
  LEGACY_ROLE_ACCESS,
  LEADER_NO_AREAS_WARNING,
  MIGRATION_ACTOR,
  MODULE_HREF,
  MODULE_ORDER,
  PERMISSIONS,
  STORABLE_PERMISSIONS,
  allowedHomeModules,
  can,
  closure,
  defaultHomeModule,
  deriveLegacyRole,
  effectivePermissions,
  maskEmail,
  normalizeAccess,
  planAccessMigration,
  resolveHome,
  sortPermissions,
  visibleModules,
} from "@/lib/shared/access";
import type { BaseRole, HomeModule, LegacyRole, ModuleId, Permission, UserAccessDoc } from "@/lib/shared/types";

const eff = (doc: UserAccessDoc | null | undefined) => sortPermissions(effectivePermissions(doc));
const legacy = (role: string, active = true) => ({ role, active });
const v1 = (over: Partial<Record<keyof UserAccessDoc, unknown>> = {}): UserAccessDoc => ({
  accessSchemaVersion: 1,
  role: "leader",
  active: true,
  baseRole: "standard",
  permissions: [],
  areaIds: [],
  homeModule: "calendar",
  position: "",
  ...over,
});

/** Todos los subconjuntos de los permisos guardables (2^8). */
function subsets(): Permission[][] {
  const all = [...STORABLE_PERMISSIONS];
  const out: Permission[][] = [];
  for (let mask = 0; mask < 1 << all.length; mask++) out.push(all.filter((_, i) => mask & (1 << i)));
  return out;
}

describe("catálogo y cierre", () => {
  it("el catálogo tiene 9 permisos y settings.manage no es guardable", () => {
    expect(PERMISSIONS).toHaveLength(9);
    expect(STORABLE_PERMISSIONS).toHaveLength(8);
    expect(STORABLE_PERMISSIONS).not.toContain("settings.manage");
  });

  it("cada implicación del cierre", () => {
    expect(sortPermissions(closure(["finance.records.manage"]))).toEqual([
      "finance.summary.read",
      "finance.details.read",
      "finance.records.manage",
    ]);
    expect(sortPermissions(closure(["finance.pastoral.manage"]))).toEqual([
      "finance.summary.read",
      "finance.details.read",
      "finance.pastoral.manage",
    ]);
    expect(sortPermissions(closure(["finance.details.read"]))).toEqual(["finance.summary.read", "finance.details.read"]);
    expect(sortPermissions(closure(["calendar.events.manage_all"]))).toEqual([
      "calendar.read",
      "calendar.events.manage_assigned",
      "calendar.events.manage_all",
    ]);
    expect(sortPermissions(closure(["calendar.events.manage_assigned"]))).toEqual([
      "calendar.read",
      "calendar.events.manage_assigned",
    ]);
    expect(sortPermissions(closure(["calendar.events.publish_assigned"]))).toEqual([
      "calendar.read",
      "calendar.events.publish_assigned",
    ]);
    // publicar NO implica gestionar, ni gestionar implica publicar
    expect(closure(["calendar.events.publish_assigned"]).has("calendar.events.manage_assigned")).toBe(false);
    expect(closure(["calendar.events.manage_all"]).has("calendar.events.publish_assigned")).toBe(false);
    expect(Object.keys(IMPLIES).sort()).toEqual(
      [
        "calendar.events.manage_all",
        "calendar.events.manage_assigned",
        "calendar.events.publish_assigned",
        "finance.details.read",
        "finance.pastoral.manage",
        "finance.records.manage",
      ].sort(),
    );
  });

  it("settings.manage solo con baseRole admin, aunque esté guardado", () => {
    expect(can(v1({ permissions: ["settings.manage", "calendar.read"] }), "settings.manage")).toBe(false);
    expect(eff(v1({ permissions: ["settings.manage", "calendar.read"] }))).toEqual(["calendar.read"]);
    expect(can(v1({ baseRole: "admin", role: "admin" }), "settings.manage")).toBe(true);
    expect(can(legacy("admin"), "settings.manage")).toBe(true);
    for (const role of ["pastor", "finance", "leader"]) expect(can(legacy(role), "settings.manage")).toBe(false);
  });

  it("admin (legacy o v1) tiene el catálogo completo", () => {
    expect(eff(legacy("admin"))).toEqual([...PERMISSIONS]);
    expect(eff(v1({ baseRole: "admin", role: "admin", permissions: [] }))).toEqual([...PERMISSIONS]);
  });

  it("inactivo → ∅ (legacy y v1, incluido admin); sin documento → ∅", () => {
    for (const role of ["admin", "pastor", "finance", "leader"]) expect(eff(legacy(role, false))).toEqual([]);
    expect(eff(v1({ baseRole: "admin", role: "admin", active: false }))).toEqual([]);
    expect(eff(v1({ permissions: ["calendar.read"], active: "true" }))).toEqual([]);
    expect(eff(null)).toEqual([]);
    expect(eff(undefined)).toEqual([]);
  });

  it("permisos desconocidos o mal tipados se ignoran", () => {
    expect(eff(v1({ permissions: ["members.consolidation.manage", "calendar.read", 42, null, { x: 1 }, "CALENDAR.READ"] }))).toEqual([
      "calendar.read",
    ]);
    expect(eff(v1({ permissions: "calendar.read" }))).toEqual([]);
    expect(eff(legacy("member"))).toEqual([]);
    expect(eff({ active: true })).toEqual([]);
  });
});

describe("normalizeAccess", () => {
  it("legacy por rol, v1 por accessSchemaVersion === 1, basura tolerada", () => {
    expect(normalizeAccess(legacy("leader"))).toEqual({
      schema: "legacy",
      active: true,
      baseRole: "standard",
      permissions: ["finance.summary.read", "calendar.read", "calendar.events.manage_assigned"],
      areaIds: [],
      homeModule: null,
      position: "Líder",
      legacyRole: "leader",
    });
    expect(
      normalizeAccess(
        v1({
          permissions: ["calendar.read", "calendar.read", "finance.summary.read"],
          areaIds: ["jovenes", "jovenes", "", 3, "alabanza"],
          homeModule: "integrantes",
          position: "x".repeat(80),
          baseRole: "superadmin",
        }),
      ),
    ).toEqual({
      schema: "v1",
      active: true,
      baseRole: "standard",
      permissions: ["finance.summary.read", "calendar.read"],
      areaIds: ["jovenes", "alabanza"],
      homeModule: null,
      position: "x".repeat(60),
      legacyRole: "leader",
    });
    expect(normalizeAccess(v1({ areaIds: Array.from({ length: 30 }, (_, i) => `a${i}`) }))?.areaIds).toHaveLength(20);
    expect(normalizeAccess({ accessSchemaVersion: "1", role: "pastor", active: true })?.schema).toBe("legacy");
    expect(normalizeAccess(null)).toBeNull();
  });
});

describe("tabla legacy (fallback idéntico a la migración y a las reglas)", () => {
  const expected: Record<LegacyRole, Permission[]> = {
    admin: [...PERMISSIONS],
    pastor: [
      "finance.summary.read",
      "finance.details.read",
      "finance.records.manage",
      "finance.pastoral.manage",
      "calendar.read",
      "calendar.events.manage_assigned",
      "calendar.events.manage_all",
    ],
    finance: ["finance.summary.read", "finance.details.read", "finance.records.manage", "calendar.read"],
    leader: ["finance.summary.read", "calendar.read", "calendar.events.manage_assigned"],
  };

  it.each(Object.keys(expected) as LegacyRole[])("%s: permisos efectivos exactos", (role) => {
    expect(eff(legacy(role))).toEqual(expected[role]);
  });

  it("equivalencia financiera bit a bit con las funciones actuales", () => {
    const matrix = (role: string) => ({
      detailsRead: can(legacy(role), "finance.details.read"),
      recordsManage: can(legacy(role), "finance.records.manage"),
      pastoral: can(legacy(role), "finance.pastoral.manage"),
      summary: can(legacy(role), "finance.summary.read"),
      settings: can(legacy(role), "settings.manage"),
    });
    expect(matrix("admin")).toEqual({ detailsRead: true, recordsManage: true, pastoral: true, summary: true, settings: true });
    expect(matrix("pastor")).toEqual({ detailsRead: true, recordsManage: true, pastoral: true, summary: true, settings: false });
    expect(matrix("finance")).toEqual({ detailsRead: true, recordsManage: true, pastoral: false, summary: true, settings: false });
    expect(matrix("leader")).toEqual({ detailsRead: false, recordsManage: false, pastoral: false, summary: true, settings: false });
  });

  it("homeModule del mapeo: finance salvo leader (calendar)", () => {
    expect(LEGACY_ROLE_ACCESS.admin.homeModule).toBe("finance");
    expect(LEGACY_ROLE_ACCESS.pastor.homeModule).toBe("finance");
    expect(LEGACY_ROLE_ACCESS.finance.homeModule).toBe("finance");
    expect(LEGACY_ROLE_ACCESS.leader.homeModule).toBe("calendar");
  });
});

describe("deriveLegacyRole", () => {
  it("casos directos", () => {
    expect(deriveLegacyRole("admin", [])).toBe("admin");
    expect(deriveLegacyRole("standard", ["finance.records.manage", "finance.pastoral.manage"])).toBe("pastor");
    expect(deriveLegacyRole("standard", ["finance.records.manage"])).toBe("finance");
    expect(deriveLegacyRole("standard", ["finance.pastoral.manage"])).toBe("leader");
    expect(deriveLegacyRole("standard", ["calendar.events.manage_all"])).toBe("leader");
    expect(deriveLegacyRole("standard", [])).toBe("leader");
    for (const role of ["pastor", "finance", "leader"] as const) {
      expect(deriveLegacyRole(LEGACY_ROLE_ACCESS[role].baseRole, LEGACY_ROLE_ACCESS[role].permissions)).toBe(role);
    }
  });

  it("propiedad: el rol derivado nunca da más finanzas que el perfil v1 (salvo summary.read); admin ⟺ admin", () => {
    const financial = (perms: Iterable<Permission>) =>
      sortPermissions([...perms].filter((p) => p.startsWith("finance.") || p === "settings.manage"));
    for (const baseRole of ["admin", "standard"] as BaseRole[]) {
      for (const perms of subsets()) {
        const doc = v1({ baseRole, permissions: perms, role: baseRole === "admin" ? "admin" : "leader" });
        const derived = deriveLegacyRole(baseRole, perms);
        expect(derived === "admin").toBe(baseRole === "admin");
        const allowed = new Set([...effectivePermissions(doc), "finance.summary.read" as Permission]);
        for (const p of financial(effectivePermissions(legacy(derived)))) {
          expect(allowed.has(p), `${baseRole} ${perms.join(",")} → ${derived} da ${p}`).toBe(true);
        }
      }
    }
  });
});

describe("módulos visibles", () => {
  const F: ModuleId = "finance";
  const C: ModuleId = "calendar";
  const R: ModuleId = "reports";
  const S: ModuleId = "settings";

  it("matriz por perfil", () => {
    expect(visibleModules(legacy("admin"))).toEqual([F, C, R, S]);
    expect(visibleModules(legacy("pastor"))).toEqual([F, C, R]);
    expect(visibleModules(legacy("finance"))).toEqual([F, C, R]);
    expect(visibleModules(legacy("leader"))).toEqual([F, C, R]);
    expect(visibleModules(v1({ permissions: ["calendar.read"] }))).toEqual([C, R]);
    expect(visibleModules(v1({ permissions: ["finance.summary.read"] }))).toEqual([F]);
    expect(visibleModules(v1({ permissions: ["finance.details.read"] }))).toEqual([F, R]);
    expect(visibleModules(v1({ permissions: ["calendar.events.publish_assigned"] }))).toEqual([C, R]);
    expect(visibleModules(v1({ permissions: [] }))).toEqual([]);
    expect(visibleModules(legacy("admin", false))).toEqual([]);
    expect(visibleModules(null)).toEqual([]);
    expect(MODULE_ORDER).toEqual([F, C, R, S]);
    expect(MODULE_HREF).toEqual({ finance: "/finanzas", calendar: "/calendario", reports: "/reportes", settings: "/configuracion" });
  });
});

describe("resolveHome (módulo inicial)", () => {
  it("1) el configurado si es visible", () => {
    expect(resolveHome(v1({ permissions: ["finance.summary.read", "calendar.read"], homeModule: "finance" }))).toEqual({
      kind: "module",
      module: "finance",
      href: "/finanzas",
      source: "configured",
    });
    // pastor migrado con finance o calendar
    const pastor = { ...LEGACY_ROLE_ACCESS.pastor, accessSchemaVersion: 1, role: "pastor", active: true };
    expect(resolveHome({ ...pastor, homeModule: "finance" })).toMatchObject({ module: "finance", source: "configured" });
    expect(resolveHome({ ...pastor, homeModule: "calendar" })).toMatchObject({ module: "calendar", source: "configured" });
  });

  it("2) el predeterminado del perfil; un configurado inválido queda marcado", () => {
    expect(resolveHome(v1({ permissions: ["calendar.read"], homeModule: "finance" }))).toEqual({
      kind: "module",
      module: "calendar",
      href: "/calendario",
      source: "default",
      invalidConfigured: "finance",
    });
    expect(resolveHome(v1({ permissions: ["finance.records.manage"], homeModule: "calendar" }))).toEqual({
      kind: "module",
      module: "finance",
      href: "/finanzas",
      source: "default",
      invalidConfigured: "calendar",
    });
    // legacy: el del mapeo, sin configurado
    expect(resolveHome(legacy("leader"))).toEqual({ kind: "module", module: "calendar", href: "/calendario", source: "default" });
    expect(resolveHome(legacy("pastor"))).toEqual({ kind: "module", module: "finance", href: "/finanzas", source: "default" });
    expect(resolveHome(legacy("admin"))).toMatchObject({ module: "finance", source: "default" });
    // homeModule fuera de la lista se trata como no configurado (sin invalidConfigured)
    expect(resolveHome(v1({ permissions: ["calendar.read"], homeModule: "integrantes" }))).toEqual({
      kind: "module",
      module: "calendar",
      href: "/calendario",
      source: "default",
    });
  });

  it("defaultHomeModule v1: details → finance; calendar → calendar; si no finance", () => {
    expect(defaultHomeModule(normalizeAccess(v1({ permissions: ["finance.details.read", "calendar.read"] }))!)).toBe("finance");
    expect(defaultHomeModule(normalizeAccess(v1({ permissions: ["finance.summary.read", "calendar.read"] }))!)).toBe("calendar");
    expect(defaultHomeModule(normalizeAccess(v1({ permissions: ["finance.summary.read"] }))!)).toBe("finance");
  });

  it("4) sin módulos → no-modules; inactivo o sin documento → inactive", () => {
    expect(resolveHome(v1({ permissions: [] }))).toEqual({ kind: "no-modules" });
    expect(resolveHome(legacy("member"))).toEqual({ kind: "no-modules" });
    expect(resolveHome(legacy("admin", false))).toEqual({ kind: "inactive" });
    expect(resolveHome(null)).toEqual({ kind: "inactive" });
  });

  it("propiedad: para todo perfil el aterrizaje es un módulo visible (o no-modules si no hay)", () => {
    for (const baseRole of ["admin", "standard"] as BaseRole[]) {
      for (const homeModule of ["finance", "calendar", null] as (HomeModule | null)[]) {
        for (const perms of subsets()) {
          const doc = v1({ baseRole, permissions: perms, homeModule });
          const visible = visibleModules(doc);
          const landing = resolveHome(doc);
          if (!visible.length) {
            expect(landing).toEqual({ kind: "no-modules" });
            continue;
          }
          expect(landing.kind).toBe("module");
          if (landing.kind !== "module") continue;
          expect(visible).toContain(landing.module);
          expect(landing.href).toBe(MODULE_HREF[landing.module]);
          if (homeModule && allowedHomeModules(doc).includes(homeModule)) expect(landing.source).toBe("configured");
          if (landing.source !== "configured" && homeModule) expect(landing.invalidConfigured).toBe(homeModule);
        }
      }
    }
  });
});

describe("planAccessMigration", () => {
  const legacyDoc = (role: string, extra: Record<string, unknown> = {}) => ({
    displayName: `Usuario ${role}`,
    email: `${role}.prueba@cds.test`,
    role,
    active: true,
    createdAt: { seconds: 1 },
    ...extra,
  });

  it.each(["admin", "pastor", "finance", "leader"] as LegacyRole[])("%s: legacy → v1 según el mapeo exacto", (role) => {
    const row = planAccessMigration(`u-${role}`, legacyDoc(role), { pastorHome: "finance" });
    const mapped = LEGACY_ROLE_ACCESS[role];
    expect(row.status).toBe("migrate");
    expect(row.changes).toEqual({
      baseRole: mapped.baseRole,
      position: mapped.position,
      permissions: mapped.permissions,
      areaIds: [],
      homeModule: mapped.homeModule,
      accessSchemaVersion: 1,
      updatedBy: MIGRATION_ACTOR,
    });
    // nunca toca role, displayName, email, active ni createdAt
    for (const key of ["role", "displayName", "email", "active", "createdAt"]) expect(row.changes).not.toHaveProperty(key);
    expect(row.oldRole).toBe(role);
    expect(row.areaIds).toEqual([]);
    // compatibilidad exacta: mismos permisos efectivos antes y después
    const after = { ...legacyDoc(role), ...row.changes };
    expect(eff(after)).toEqual(eff(legacyDoc(role)));
    expect(row.effective).toEqual(eff(legacyDoc(role)));
    // y el rol guardado sigue siendo coherente con el perfil v1
    expect(deriveLegacyRole(mapped.baseRole, mapped.permissions)).toBe(role);
  });

  it("compatibilidad exacta también para inactivos (∅ antes y después)", () => {
    for (const role of ["admin", "pastor", "finance", "leader"]) {
      const doc = legacyDoc(role, { active: false });
      const row = planAccessMigration("u", doc, { pastorHome: "finance" });
      expect(eff({ ...doc, ...row.changes })).toEqual([]);
      expect(row.warnings.join(" ")).toMatch(/inactivo/);
    }
  });

  it("pastorHome solo afecta al pastor", () => {
    expect(planAccessMigration("p", legacyDoc("pastor"), { pastorHome: "calendar" }).changes.homeModule).toBe("calendar");
    expect(planAccessMigration("f", legacyDoc("finance"), { pastorHome: "calendar" }).changes.homeModule).toBe("finance");
    expect(planAccessMigration("l", legacyDoc("leader"), { pastorHome: "finance" }).changes.homeModule).toBe("calendar");
  });

  it("skip_already_v1: no pisa ediciones de un admin", () => {
    const row = planAccessMigration("x", { ...legacyDoc("leader"), ...v1({ areaIds: ["jovenes"] }) }, { pastorHome: "finance" });
    expect(row.status).toBe("skip_already_v1");
    expect(row.changes).toEqual({});
    expect(row.areaIds).toEqual(["jovenes"]);
  });

  it("skip_invalid_role: rol desconocido o ausente", () => {
    const bad = planAccessMigration("x", legacyDoc("member"), { pastorHome: "finance" });
    expect(bad.status).toBe("skip_invalid_role");
    expect(bad.changes).toEqual({});
    expect(bad.warnings[0]).toMatch(/Rol no válido/);
    const missing = planAccessMigration("y", { displayName: "Sin rol", active: true }, { pastorHome: "finance" });
    expect(missing.status).toBe("skip_invalid_role");
    expect(missing.oldRole).toBeNull();
  });

  it("nunca inventa areaIds (aunque el doc legacy traiga un campo suelto)", () => {
    const row = planAccessMigration("x", legacyDoc("leader", { areaIds: ["jovenes"] }), { pastorHome: "finance" });
    expect(row.changes.areaIds).toEqual([]);
    expect(row.areaIds).toEqual([]);
    expect(row.warnings).toContain(LEADER_NO_AREAS_WARNING);
  });

  it("correo enmascarado", () => {
    expect(planAccessMigration("x", legacyDoc("finance"), { pastorHome: "finance" }).emailMasked).toBe("f***@c***.test");
    expect(maskEmail("salvador@gmail.com")).toBe("s***@g***.com");
    expect(maskEmail("sin-arroba")).toBe("***");
    expect(maskEmail(undefined)).toBe("");
  });
});
