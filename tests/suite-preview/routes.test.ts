import { describe, expect, it } from "vitest";
import { USERS } from "@/lib/suite-preview/fixtures";
import { PREVIEW_ROUTES, canSeeRoute, guardRoute, isPublicPath, matchRoute, moduleOfPath, withProfile } from "@/lib/suite-preview/routes";

const user = (uid: string) => USERS.find((u) => u.uid === uid)!;

describe("tabla de rutas", () => {
  it.each([
    ["/preview", "admin", true],
    ["/preview/calendario/compartir/demo", "sin-permisos", true],
    ["/preview/calendario/compartir", "lider", false],
    ["/preview/calendario/compartir", "pastor", true],
    ["/preview/calendario/mis-actividades", "finanzas", false],
    ["/preview/calendario/mis-actividades", "lider", true],
    ["/preview/integrantes/consolidacion", "lider", false],
    ["/preview/integrantes/consolidacion/persona", "consolidacion", true],
    ["/preview/integrantes/consolidacion/nueva", "consolidacion", true],
    ["/preview/reportes/finanzas", "lider", false],
    ["/preview/reportes/calendario", "lider", true],
    ["/preview/reportes", "consolidacion", true],
    ["/preview/configuracion/areas", "pastor", false],
    ["/preview/configuracion/finanzas", "admin", true],
    ["/preview/finanzas-2026/resumen", "lider", true],
    ["/preview/finanzas-2026", "lider", false],
    ["/preview/finanzas-2026/movimientos/", "finanzas", true],
    ["/preview/finanzas-2026/configuracion", "finanzas", false],
  ])("%s · %s → %s", (path, uid, allowed) => {
    expect(canSeeRoute(user(uid), path)).toBe(allowed);
  });

  it("el prefijo compartir/ es público pero la administración del enlace no", () => {
    expect(isPublicPath("/preview/calendario/compartir/demo")).toBe(true);
    expect(isPublicPath("/preview/calendario/compartir")).toBe(false);
    expect(matchRoute("/preview/calendario/compartir")?.access).toEqual({ anyOf: ["calendar.events.manage_all"] });
    expect(moduleOfPath("/preview/integrantes/consolidacion/persona?id=p-01")).toBe("integrantes");
  });
});

describe("guardRoute", () => {
  it("propiedad: todo perfil × toda ruta termina en una ruta permitida, sin loops", () => {
    for (const u of USERS) {
      for (const path of PREVIEW_ROUTES) {
        const d = guardRoute(u, path);
        if (d.type !== "redirect") continue;
        const next = guardRoute(u, d.to);
        expect(next.type, `${u.uid} ${path} → ${d.to}`).toBe("allow");
        expect(d.to).not.toBe(path);
      }
    }
  });

  it("sin módulos e inactivo no redirigen", () => {
    expect(guardRoute(user("sin-permisos"), "/preview/calendario")).toEqual({ type: "no-modules" });
    expect(guardRoute({ ...user("lider"), active: false }, "/preview/calendario")).toEqual({ type: "inactive" });
  });

  it("público e ingreso están exentos, incluso sin perfil", () => {
    expect(guardRoute(null, "/preview/calendario/compartir/demo")).toEqual({ type: "public" });
    expect(guardRoute(null, "/preview")).toEqual({ type: "login" });
    expect(guardRoute(user("sin-permisos"), "/preview")).toEqual({ type: "login" });
    expect(guardRoute(null, "/preview/calendario")).toMatchObject({ type: "redirect", to: "/preview" });
  });

  it("Líder en Movimientos va a Resumen con aviso; Líder en Integrantes va a Calendario", () => {
    expect(guardRoute(user("lider"), "/preview/finanzas-2026/movimientos")).toEqual({
      type: "redirect",
      to: "/preview/finanzas-2026/resumen",
      notice: "No tienes acceso a Movimientos. Te llevamos a Resumen financiero.",
    });
    expect(guardRoute(user("lider"), "/preview/integrantes/consolidacion")).toEqual({
      type: "redirect",
      to: "/preview/calendario",
      notice: "No tienes acceso a Integrantes. Te llevamos a Calendario.",
    });
    expect(guardRoute(user("lider"), "/preview/finanzas-2026")).toMatchObject({ to: "/preview/finanzas-2026/resumen" });
  });
});

describe("withProfile", () => {
  it("conserva query y hash", () => {
    expect(withProfile("/preview/calendario?vista=mes#hoy", "lider")).toBe("/preview/calendario?vista=mes&perfil=lider#hoy");
    expect(withProfile("/preview/calendario?perfil=admin", "lider")).toBe("/preview/calendario?perfil=lider");
  });

  it("la ruta pública y el ingreso nunca llevan perfil", () => {
    expect(withProfile("/preview/calendario/compartir/demo?t=demo-k7p2&perfil=admin", "admin")).toBe(
      "/preview/calendario/compartir/demo?t=demo-k7p2",
    );
    expect(withProfile("/preview?perfil=xyz", "xyz")).toBe("/preview");
  });
});
