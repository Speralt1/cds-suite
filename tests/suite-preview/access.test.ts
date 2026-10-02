import { describe, expect, it } from "vitest";
import {
  CARGO_PRESETS,
  PERMISSIONS,
  can,
  effectivePermissions,
  landingLabel,
  legacyRoleToProfile,
  moduleHref,
  resolveInitialModule,
  validateProfileChange,
  visibleModules,
} from "@/lib/suite-preview/access";
import { AREAS, USERS } from "@/lib/suite-preview/fixtures";
import type { AccessProfile, Permission } from "@/lib/suite-preview/types";

const user = (uid: string) => USERS.find((u) => u.uid === uid)!;
const std = (permissions: Permission[], extra: Partial<AccessProfile> = {}): AccessProfile => ({
  uid: "x",
  displayName: "X",
  email: "x@demo.invalid",
  active: true,
  baseRole: "standard",
  cargo: "Líder",
  permissions,
  areaIds: [],
  initialModule: "calendario",
  ...extra,
});

describe("cierre de permisos", () => {
  it("aplica cada implicación", () => {
    expect([...effectivePermissions(std(["finance.records.manage"]))].sort()).toEqual(
      ["finance.details.read", "finance.records.manage", "finance.summary.read"].sort(),
    );
    expect(can(std(["finance.pastoral.manage"]), "finance.summary.read")).toBe(true);
    expect([...effectivePermissions(std(["calendar.events.manage_all"]))].sort()).toEqual(
      ["calendar.events.manage_all", "calendar.events.manage_assigned", "calendar.read"].sort(),
    );
    expect(can(std(["members.consolidation.manage"]), "members.consolidation.read")).toBe(true);
    expect(can(std(["finance.summary.read"]), "finance.details.read")).toBe(false);
  });

  it("settings.manage solo existe con baseRole admin, aunque esté guardado en permissions", () => {
    expect(can(std(["settings.manage"]), "settings.manage")).toBe(false);
    expect(can(user("admin"), "settings.manage")).toBe(true);
    expect(effectivePermissions(user("admin")).size).toBe(PERMISSIONS.length);
  });

  it("un perfil inactivo no tiene permisos y los permisos desconocidos se ignoran", () => {
    expect(effectivePermissions({ ...user("admin"), active: false }).size).toBe(0);
    expect([...effectivePermissions(std(["calendar.read", "nope.invalid" as Permission]))]).toEqual(["calendar.read"]);
  });
});

describe("módulos visibles por perfil", () => {
  it.each([
    ["admin", ["finanzas", "calendario", "integrantes", "reportes", "configuracion"]],
    ["pastor", ["finanzas", "calendario", "integrantes", "reportes"]],
    ["lider", ["finanzas", "calendario", "reportes"]],
    ["diacono", ["finanzas", "calendario", "reportes"]],
    ["finanzas", ["finanzas", "calendario", "reportes"]],
    ["consolidacion", ["calendario", "integrantes", "reportes"]],
    ["sin-permisos", []],
    ["lider-fallback", ["calendario", "reportes"]],
  ])("%s", (uid, modules) => {
    expect(visibleModules(user(uid))).toEqual(modules);
  });
});

describe("módulo inicial (B.7)", () => {
  it("cada cargo aterriza donde corresponde", () => {
    expect(resolveInitialModule(user("admin"))).toMatchObject({ kind: "module", href: "/preview/finanzas-2026", source: "initial" });
    expect(resolveInitialModule(user("finanzas"))).toMatchObject({ href: "/preview/finanzas-2026" });
    expect(resolveInitialModule(user("lider"))).toMatchObject({ href: "/preview/calendario" });
    expect(resolveInitialModule(user("pastor"))).toMatchObject({ href: "/preview/calendario" });
    expect(resolveInitialModule(user("consolidacion"))).toMatchObject({ href: "/preview/integrantes/consolidacion" });
  });

  it("un módulo inicial no permitido cae al preset con advertencia (paso 6)", () => {
    expect(resolveInitialModule(user("lider-fallback"))).toEqual({
      kind: "module",
      module: "calendario",
      href: "/preview/calendario",
      source: "preset",
      invalidInitial: "finanzas",
    });
  });

  it("si tampoco sirve el preset, usa el primer módulo permitido (paso 7)", () => {
    const p = std(["members.consolidation.read"], { cargo: "Finanzas", initialModule: "finanzas" });
    expect(resolveInitialModule(p)).toMatchObject({ module: "integrantes", source: "first" });
  });

  it("sin módulos e inactivo no tienen destino", () => {
    expect(resolveInitialModule(user("sin-permisos"))).toEqual({ kind: "no-modules" });
    expect(resolveInitialModule({ ...user("lider"), active: false })).toEqual({ kind: "inactive" });
    expect(landingLabel(resolveInitialModule(user("consolidacion")))).toBe("Entra a Consolidación");
  });

  it("Finanzas sin detalle entra a Resumen", () => {
    expect(moduleHref("finanzas", user("lider"))).toBe("/preview/finanzas-2026/resumen");
    expect(moduleHref("reportes", user("lider"))).toBe("/preview/reportes/calendario");
    expect(moduleHref("reportes", user("finanzas"))).toBe("/preview/reportes/finanzas");
  });
});

describe("migración de roles", () => {
  const base = { uid: "u1", displayName: "U", email: "u@demo.invalid", active: true };
  it("mapea los 4 roles actuales", () => {
    expect(legacyRoleToProfile("admin", base)).toMatchObject({ baseRole: "admin", cargo: "Administración", initialModule: "finanzas" });
    const pastor = legacyRoleToProfile("pastor", base);
    expect(pastor).toMatchObject({ cargo: "Pastor", initialModule: "finanzas" });
    expect(can(pastor, "finance.records.manage")).toBe(true);
    expect(can(pastor, "settings.manage")).toBe(false);
    expect(legacyRoleToProfile("finance", base)).toMatchObject({ cargo: "Finanzas", permissions: CARGO_PRESETS.Finanzas.permissions });
    expect(legacyRoleToProfile("leader", base)).toMatchObject({ cargo: "Líder", areaIds: [], initialModule: "calendario" });
  });
});

describe("validateProfileChange", () => {
  const users = [...USERS];
  it("no permite dejar el sistema sin administradores activos ni autodegradarse", () => {
    const r = validateProfileChange("admin", users, { ...user("admin"), baseRole: "standard", permissions: ["calendar.read"], initialModule: "calendario" }, AREAS);
    expect(r.errors).toContain("Debe quedar al menos un administrador activo.");
    expect(r.errors).toContain("No puedes quitarte el rol de administrador.");
    expect(validateProfileChange("admin", users, { ...user("admin"), active: false }, AREAS).errors).toContain(
      "No puedes desactivar tu propia cuenta.",
    );
  });

  it("rechaza settings.manage en permissions y áreas inexistentes", () => {
    const r = validateProfileChange("admin", users, { ...user("lider"), permissions: ["settings.manage", "calendar.read"], areaIds: ["no-existe"] }, AREAS);
    expect(r.errors.some((e) => /Administrar configuración/.test(e))).toBe(true);
    expect(r.errors.some((e) => /áreas asignadas que no existen/.test(e))).toBe(true);
  });

  it("advierte manage_assigned sin áreas y módulo inicial ya no permitido", () => {
    expect(validateProfileChange("admin", users, { ...user("lider"), areaIds: [] }, AREAS).warnings).toContain(
      "Sin áreas asignadas: solo podrá ver el calendario.",
    );
    const r = validateProfileChange("admin", users, user("lider-fallback"), AREAS);
    expect(r.errors).toContain("El módulo inicial no está permitido para estos permisos.");
    expect(r.warnings.some((w) => /se abrirá Calendario/.test(w))).toBe(true);
  });
});
