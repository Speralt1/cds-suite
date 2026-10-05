// Matriz de acceso a Integrantes › Consolidación V1 (doc 23 §9; matriz de la misión #1–#8).
// Admin implícito; resto SOLO con members.consolidation.* explícito; el fallback legacy no otorga nada.
import { describe, expect, it } from "vitest";
import { guardRoute } from "@/lib/access/routes";
import { can, effectivePermissions, LEGACY_ROLE_ACCESS, planAccessMigration, visibleModules } from "@/lib/shared/access";
import type { UserAccessDoc } from "@/lib/shared/types";

const v1 = (permissions: string[], over: Partial<Record<keyof UserAccessDoc, unknown>> = {}): UserAccessDoc => ({
  accessSchemaVersion: 1,
  role: "leader",
  active: true,
  baseRole: "standard",
  permissions,
  areaIds: [],
  homeModule: "calendar",
  position: "",
  ...over,
});

const ROUTES = [
  "/integrantes",
  "/integrantes/consolidacion",
  "/integrantes/consolidacion/atencion",
  "/integrantes/consolidacion/personas",
  "/integrantes/consolidacion/persona",
  "/integrantes/consolidacion/nueva",
];

describe("Integrantes: quién entra", () => {
  it("#1 admin (legacy y v1) entra a todo, incluido registrar", () => {
    for (const doc of [{ role: "admin", active: true }, v1([], { role: "admin", baseRole: "admin" })]) {
      expect(visibleModules(doc)).toContain("members");
      for (const r of ROUTES) expect(guardRoute(doc, r)).toEqual({ type: "allow" });
      expect(can(doc, "members.consolidation.manage")).toBe(true);
    }
  });

  it("#2 read entra a dashboard, atención, personas y ficha; registrar redirige al dashboard", () => {
    const doc = v1(["members.consolidation.read"]);
    expect(visibleModules(doc)).toEqual(["members"]);
    for (const r of ROUTES.filter((x) => !x.endsWith("/nueva"))) expect(guardRoute(doc, r)).toEqual({ type: "allow" });
    expect(guardRoute(doc, "/integrantes/consolidacion/nueva")).toMatchObject({
      type: "redirect",
      to: "/integrantes",
      reason: "forbidden",
    });
    expect(can(doc, "members.consolidation.manage")).toBe(false);
  });

  it("#3 manage entra a todo (manage implica read)", () => {
    const doc = v1(["members.consolidation.manage"]);
    expect(effectivePermissions(doc).has("members.consolidation.read")).toBe(true);
    for (const r of ROUTES) expect(guardRoute(doc, r)).toEqual({ type: "allow" });
  });
});

describe("Integrantes: quién NO entra", () => {
  const DENIED: [string, UserAccessDoc][] = [
    ["#4 v1 sin permisos de Integrantes (finanzas + calendario)", v1(["finance.summary.read", "calendar.read"])],
    ["#6 solo calendar.read", v1(["calendar.read"])],
    ["#6b gestiona todo el calendario", v1(["calendar.events.manage_all"])],
    ["#7 solo finance.details.read", v1(["finance.details.read"], { homeModule: "finance" })],
    ["legacy pastor (fallback)", { role: "pastor", active: true }],
    ["legacy finance (fallback)", { role: "finance", active: true }],
    ["legacy leader (fallback)", { role: "leader", active: true }],
    ["v1 pastor migrado (mapeo legacy exacto)", v1([...LEGACY_ROLE_ACCESS.pastor.permissions], { role: "pastor", homeModule: "finance" })],
  ];

  for (const [name, doc] of DENIED)
    it(`${name}: sin módulo y el deep link redirige con aviso, sin datos`, () => {
      expect(visibleModules(doc)).not.toContain("members");
      expect(can(doc, "members.consolidation.read")).toBe(false);
      for (const r of ROUTES) {
        const d = guardRoute(doc, r);
        expect(d.type, r).toBe("redirect");
        if (d.type === "redirect") {
          expect(d.to.startsWith("/integrantes")).toBe(false);
          expect(d.reason).toBe("forbidden");
          expect(d.notice).toMatch(/^No tienes acceso a Integrantes\./);
        }
      }
    });

  it("#5 deep link sin permiso: /integrantes/consolidacion/persona?id=… no se permite", () => {
    expect(guardRoute(v1(["calendar.read"]), "/integrantes/consolidacion/persona?id=abc").type).toBe("redirect");
  });

  it("#8 usuario inactivo (con manage o admin) no accede", () => {
    expect(guardRoute(v1(["members.consolidation.manage"], { active: false }), "/integrantes/consolidacion")).toEqual({ type: "inactive" });
    expect(guardRoute({ role: "admin", active: false }, "/integrantes")).toEqual({ type: "inactive" });
    expect(can(v1(["members.consolidation.manage"], { active: false }), "members.consolidation.read")).toBe(false);
  });

  it("legacy y migración: ningún rol obtiene members.* por fallback ni por la migración", () => {
    for (const role of ["pastor", "finance", "leader"] as const) {
      expect(LEGACY_ROLE_ACCESS[role].permissions.some((p) => p.startsWith("members."))).toBe(false);
      const row = planAccessMigration("u", { role, active: true }, { pastorHome: "finance" });
      expect(row.effective?.some((p) => p.startsWith("members."))).toBe(false);
      expect((row.changes.permissions as string[]).some((p) => p.startsWith("members."))).toBe(false);
    }
  });
});
