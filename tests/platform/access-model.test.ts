import { describe, expect, it } from "vitest";
import { accessModel } from "@/lib/access/model";
import { MODULES, MODULE_LABEL, modulesFor } from "@/lib/access/modules";
import { PERMISSION_DESCRIPTION, PERMISSION_GROUPS, PERMISSION_LABEL, POSITION_PRESETS } from "@/lib/access/labels";
import { LEGACY_ROLE_ACCESS, PERMISSIONS, effectivePermissions, sortPermissions } from "@/lib/shared/access";
import { PROFILES, profile, v1 } from "./profiles";

describe("accessModel", () => {
  it.each(PROFILES.map((p) => [p.name, p] as const))("%s: módulos, aterrizaje y permisos", (_, p) => {
    const model = accessModel(p.doc);
    expect(model.modules).toEqual(p.modules);
    const home = model.home.kind === "module" ? model.home.href : model.home.kind;
    expect(home).toBe(p.home);
    expect(sortPermissions(model.perms)).toEqual(sortPermissions(effectivePermissions(p.doc)));
    for (const perm of PERMISSIONS) expect(model.can(perm)).toBe(model.perms.has(perm));
  });

  it("funciona con el objeto legacy {role, active} de los mocks existentes", () => {
    const leader = accessModel({ role: "leader", active: true });
    expect(leader.can("finance.summary.read")).toBe(true);
    expect(leader.can("finance.details.read")).toBe(false);
    expect(leader.can("calendar.events.manage_assigned")).toBe(true);
    expect(leader.areaIds).toEqual([]);
    expect(leader.profile?.position).toBe(LEGACY_ROLE_ACCESS.leader.position);
    expect(accessModel({ role: "admin", active: true }).can("settings.manage")).toBe(true);
  });

  it("sin perfil o inactivo: sin permisos, sin módulos, sin áreas", () => {
    for (const doc of [null, undefined, { role: "admin", active: false }, v1({ active: false, areaIds: ["a"] })]) {
      const model = accessModel(doc);
      expect(model.perms.size).toBe(0);
      expect(model.modules).toEqual([]);
      expect(model.areaIds).toEqual([]);
      expect(model.home).toEqual({ kind: "inactive" });
      expect(model.canAny(["calendar.read", "finance.summary.read"])).toBe(false);
    }
  });

  it("áreas solo de v1 y canAny", () => {
    const model = accessModel(profile("v1 líder con áreas").doc);
    expect(model.areaIds).toEqual(["jovenes"]);
    expect(model.canAny(["settings.manage", "calendar.read"])).toBe(true);
    expect(model.canAny(["settings.manage", "finance.details.read"])).toBe(false);
  });

  describe("fingerprint", () => {
    it("es estable para el mismo acceso y no depende del orden de áreas", () => {
      const a = accessModel(v1({ permissions: ["calendar.read"], areaIds: ["b", "a"] }));
      const b = accessModel(v1({ permissions: ["calendar.read"], areaIds: ["a", "b"], position: "Otro" }));
      expect(a.fingerprint).toBe(b.fingerprint);
    });

    it("cambia con permisos efectivos, áreas, módulo inicial y estado", () => {
      const base = v1({ permissions: ["calendar.read"], areaIds: ["a"], homeModule: "calendar" });
      const fp = accessModel(base).fingerprint;
      expect(accessModel({ ...base, permissions: ["calendar.events.manage_assigned"] }).fingerprint).not.toBe(fp);
      expect(accessModel({ ...base, areaIds: ["a", "b"] }).fingerprint).not.toBe(fp);
      expect(accessModel({ ...base, homeModule: "finance" }).fingerprint).not.toBe(fp);
      expect(accessModel({ ...base, active: false }).fingerprint).not.toBe(fp);
    });

    it("los 4 roles legacy tienen fingerprints distintos (un cambio de rol desmonta los datos)", () => {
      const fps = ["admin", "pastor", "finance", "leader"].map((role) => accessModel({ role, active: true }).fingerprint);
      expect(new Set(fps).size).toBe(4);
      expect(accessModel(null).fingerprint).toBe("none");
    });
  });
});

describe("registro de módulos", () => {
  it("orden fijo y sin Integrantes", () => {
    expect(MODULES.map((m) => m.label)).toEqual(["Finanzas", "Calendario", "Reportes", "Configuración"]);
    expect(MODULES.map((m) => m.href)).toEqual(["/finanzas", "/calendario", "/reportes", "/configuracion"]);
    expect(JSON.stringify(MODULES)).not.toMatch(/integrantes/i);
    expect(Object.values(MODULE_LABEL)).not.toContain("Integrantes");
  });

  it("modulesFor respeta el orden de la navegación", () => {
    expect(modulesFor(["settings", "finance"]).map((m) => m.id)).toEqual(["finance", "settings"]);
  });
});

describe("copy de permisos", () => {
  it("cada permiso tiene label y descripción sin identificadores internos", () => {
    for (const perm of PERMISSIONS) {
      expect(PERMISSION_LABEL[perm]).toBeTruthy();
      expect(PERMISSION_DESCRIPTION[perm]).toBeTruthy();
      expect(`${PERMISSION_LABEL[perm]} ${PERMISSION_DESCRIPTION[perm]}`).not.toMatch(/finance\.|calendar\.|settings\.|token|UID|Firestore/);
    }
    expect(PERMISSION_GROUPS.flatMap((g) => g.permissions).sort()).toEqual([...PERMISSIONS].sort());
  });

  it("los cargos sugeridos nunca guardan settings.manage y coinciden con el mapeo legacy", () => {
    for (const preset of POSITION_PRESETS) expect(preset.permissions).not.toContain("settings.manage");
    for (const role of ["admin", "pastor", "finance", "leader"] as const) {
      const preset = POSITION_PRESETS.find((p) => p.position === LEGACY_ROLE_ACCESS[role].position);
      expect(preset?.permissions).toEqual(LEGACY_ROLE_ACCESS[role].permissions);
      expect(preset?.baseRole).toBe(LEGACY_ROLE_ACCESS[role].baseRole);
    }
  });
});
