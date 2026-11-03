// Acceso a Integrantes › Ve por los tuyos (doc 40 §4): permisos members.outreach.*, módulo y rutas.
import { describe, expect, it } from "vitest";
import { guardRoute } from "@/lib/access/routes";
import { can, effectivePermissions, normalizeAccess, visibleModules } from "@/lib/shared/access";
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

const OUTREACH = [
  "members.outreach.coordinate",
  "members.outreach.reception",
  "members.outreach.followup_assigned",
  "members.outreach.decisions",
] as const;

describe("Ve por los tuyos: módulo y rutas", () => {
  for (const p of OUTREACH)
    it(`${p} solo: ve Integrantes, entra a Ve por los tuyos y NO a Consolidación`, () => {
      const doc = v1([p]);
      expect(visibleModules(doc)).toContain("members");
      expect(guardRoute(doc, "/integrantes")).toEqual({ type: "allow" });
      expect(guardRoute(doc, "/integrantes/ve-por-los-tuyos")).toEqual({ type: "allow" });
      for (const r of ["/integrantes/consolidacion", "/integrantes/consolidacion/personas", "/integrantes/consolidacion/nueva"]) {
        expect(guardRoute(doc, r), r).toMatchObject({ type: "redirect", to: "/integrantes", reason: "forbidden" });
      }
      expect(can(doc, "members.consolidation.read")).toBe(false);
    });

  it("consolidation.read NO da acceso a Ve por los tuyos", () => {
    const doc = v1(["members.consolidation.read"]);
    expect(guardRoute(doc, "/integrantes/consolidacion")).toEqual({ type: "allow" });
    expect(guardRoute(doc, "/integrantes/ve-por-los-tuyos")).toMatchObject({ type: "redirect", to: "/integrantes" });
    for (const p of OUTREACH) expect(can(doc, p)).toBe(false);
  });

  it("coordinate implica reception; decisions y followup_assigned no implican nada", () => {
    expect(effectivePermissions(v1(["members.outreach.coordinate"])).has("members.outreach.reception")).toBe(true);
    expect(effectivePermissions(v1(["members.outreach.reception"])).has("members.outreach.coordinate")).toBe(false);
    expect(effectivePermissions(v1(["members.outreach.decisions"])).has("members.outreach.coordinate")).toBe(false);
  });

  it("admin los tiene todos de forma implícita (incluye decisions, pendiente de decisión del admin)", () => {
    const admin = v1([], { role: "admin", baseRole: "admin" });
    for (const p of OUTREACH) expect(can(admin, p)).toBe(true);
    expect(guardRoute(admin, "/integrantes/ve-por-los-tuyos")).toEqual({ type: "allow" });
  });

  it("los roles legacy no reciben ningún permiso de Ve por los tuyos ni el módulo", () => {
    for (const role of ["pastor", "finance", "leader"]) {
      const doc = { role, active: true };
      for (const p of OUTREACH) expect(can(doc, p)).toBe(false);
      expect(visibleModules(doc)).not.toContain("members");
      expect(guardRoute(doc, "/integrantes/ve-por-los-tuyos")).toMatchObject({ type: "redirect", reason: "forbidden" });
    }
  });

  it("un usuario inactivo con permisos queda inactivo; v1 conserva los permisos guardados", () => {
    expect(guardRoute(v1([...OUTREACH], { active: false }), "/integrantes/ve-por-los-tuyos")).toEqual({ type: "inactive" });
    expect(normalizeAccess(v1(["members.outreach.decisions"]))?.permissions).toEqual(["members.outreach.decisions"]);
  });
});
