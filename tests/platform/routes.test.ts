import { beforeEach, describe, expect, it } from "vitest";
import {
  PRIVATE_ROUTES,
  ROUTE_RULES,
  guardRoute,
  matchRoute,
  moduleOfPath,
  normalizePath,
  type GuardDecision,
} from "@/lib/access/routes";
import { consumeLandingIntent, markLandingIntent, peekLandingIntent } from "@/lib/access/landing-intent";
import { MODULE_HREF, visibleModules } from "@/lib/shared/access";
import type { UserAccessDoc } from "@/lib/shared/types";
import { PROFILES, profile } from "./profiles";

const EXTRA_ROUTES = [
  "/finanzas/",
  "/finanzas/diezmos/abc",
  "/calendario/compartir/",
  "/calendario/compartir/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde",
  "/configuracion/areas/",
  "/reportes/calendario?desde=2026-10-01",
  "/ruta-desconocida",
];
const ROUTES = [...PRIVATE_ROUTES, ...EXTRA_ROUTES];

/**
 * Simula RouteGuard: sigue los redirects consumiendo la intención en la
 * primera evaluación. Devuelve la ruta final y los pasos.
 */
function follow(doc: UserAccessDoc | null, start: string, intent: boolean) {
  let path = start;
  let pending = intent;
  const steps: GuardDecision[] = [];
  for (let i = 0; i < 5; i++) {
    const decision = guardRoute(doc, path, pending);
    pending = false;
    steps.push(decision);
    if (decision.type !== "redirect") return { path, steps, final: decision };
    path = decision.to;
  }
  throw new Error(`loop: ${start} → ${path}`);
}

describe("propiedad: todos los perfiles × todas las rutas", () => {
  for (const p of PROFILES) {
    it(`${p.name}: decisión válida, destinos permitidos y sin loops`, () => {
      const visibleHrefs = visibleModules(p.doc).map((m) => MODULE_HREF[m]);
      for (const route of ROUTES) {
        for (const intent of [false, true]) {
          const decision = guardRoute(p.doc, route, intent);
          if (p.home === "inactive") {
            expect(decision).toEqual({ type: "inactive" });
            continue;
          }
          if (p.home === "no-modules") {
            // Pantalla in situ: nunca redirige.
            expect(decision).toEqual({ type: "no-modules" });
            continue;
          }
          if (decision.type === "redirect") {
            expect(visibleHrefs).toContain(decision.to);
            expect(guardRoute(p.doc, decision.to, false)).toEqual({ type: "allow" });
            expect(normalizePath(decision.to)).not.toBe(normalizePath(route));
            if (decision.reason !== "forbidden") expect(decision.notice).toBeNull();
            else expect(decision.notice).toMatch(/^No tienes acceso a .+\. Te llevamos a .+\.$/);
          } else {
            expect(decision.type).toBe("allow");
          }
          const run = follow(p.doc, route, intent);
          expect(run.final.type).toBe("allow");
          expect(run.steps.length).toBeLessThanOrEqual(2);
        }
      }
    });
  }

  it("la intención solo afecta a /finanzas", () => {
    for (const p of PROFILES) {
      for (const route of ROUTES.filter((r) => normalizePath(r) !== "/finanzas")) {
        expect(guardRoute(p.doc, route, true)).toEqual(guardRoute(p.doc, route, false));
      }
    }
  });

  it("/inicio lleva siempre al módulo inicial", () => {
    for (const p of PROFILES.filter((x) => x.home.startsWith("/"))) {
      expect(guardRoute(p.doc, "/inicio")).toEqual({ type: "redirect", to: p.home, notice: null, reason: "home" });
    }
  });
});

describe("aterrizaje", () => {
  it("Líder en /finanzas con intención → /calendario, sin aviso", () => {
    expect(guardRoute({ role: "leader", active: true }, "/finanzas", true)).toEqual({
      type: "redirect",
      to: "/calendario",
      notice: null,
      reason: "landing",
    });
  });

  it("Líder en /finanzas sin intención (deep link) ve su resumen", () => {
    expect(guardRoute({ role: "leader", active: true }, "/finanzas", false)).toEqual({ type: "allow" });
  });

  it("los perfiles con inicio en Finanzas se quedan en /finanzas", () => {
    for (const role of ["admin", "pastor", "finance"]) {
      expect(guardRoute({ role, active: true }, "/finanzas", true)).toEqual({ type: "allow" });
    }
  });

  it("pastor v1 con inicio Calendario aterriza en /calendario", () => {
    const decision = guardRoute(profile("v1 pastor (inicio calendario)").doc, "/finanzas", true);
    expect(decision).toMatchObject({ type: "redirect", to: "/calendario", reason: "landing" });
  });

  it("perfil sin Finanzas aterriza en su módulo sin aviso de deep link", () => {
    expect(guardRoute(profile("v1 solo calendario").doc, "/finanzas", true)).toMatchObject({
      to: "/calendario",
      notice: null,
    });
  });
});

describe("intención de aterrizaje en memoria", () => {
  beforeEach(() => {
    consumeLandingIntent();
  });

  it("se consume exactamente una vez", () => {
    expect(peekLandingIntent()).toBe(false);
    markLandingIntent();
    markLandingIntent();
    expect(peekLandingIntent()).toBe(true);
    expect(peekLandingIntent()).toBe(true);
    expect(consumeLandingIntent()).toBe(true);
    expect(consumeLandingIntent()).toBe(false);
    expect(peekLandingIntent()).toBe(false);
  });

  it("Líder: /finanzas con intención → /calendario y después ya no redirige", () => {
    const leader = { role: "leader", active: true };
    markLandingIntent();
    const first = guardRoute(leader, "/finanzas", consumeLandingIntent());
    expect(first).toMatchObject({ type: "redirect", to: "/calendario" });
    expect(guardRoute(leader, "/calendario", consumeLandingIntent())).toEqual({ type: "allow" });
    // Volver a /finanzas después: deep link normal, sin redirect.
    expect(guardRoute(leader, "/finanzas", consumeLandingIntent())).toEqual({ type: "allow" });
  });
});

describe("deep links no permitidos (copy 18b §1.5)", () => {
  it("Líder → /configuracion: aviso y módulo inicial", () => {
    for (const route of ["/configuracion", "/configuracion/usuarios", "/configuracion/areas"]) {
      expect(guardRoute({ role: "leader", active: true }, route)).toEqual({
        type: "redirect",
        to: "/calendario",
        notice: "No tienes acceso a Configuración. Te llevamos a Calendario.",
        reason: "forbidden",
      });
    }
  });

  it("finanzas → /configuracion vuelve a Finanzas", () => {
    expect(guardRoute({ role: "finance", active: true }, "/configuracion")).toMatchObject({
      to: "/finanzas",
      notice: "No tienes acceso a Configuración. Te llevamos a Finanzas.",
    });
  });

  it("sección no permitida de un módulo visible → raíz del módulo", () => {
    for (const role of ["finance", "leader"]) {
      expect(guardRoute({ role, active: true }, "/calendario/compartir")).toEqual({
        type: "redirect",
        to: "/calendario",
        notice: "No tienes acceso a Compartir calendario. Te llevamos a Calendario.",
        reason: "forbidden",
      });
    }
    expect(guardRoute(profile("v1 detalle financiero sin calendario").doc, "/reportes/calendario")).toMatchObject({
      to: "/reportes",
      notice: "No tienes acceso a Reporte de calendario. Te llevamos a Reportes.",
    });
  });

  it("módulo no visible → módulo inicial", () => {
    expect(guardRoute(profile("v1 solo calendario").doc, "/finanzas/movimientos")).toMatchObject({
      to: "/calendario",
      notice: "No tienes acceso a Finanzas. Te llevamos a Calendario.",
    });
    expect(guardRoute(profile("v1 solo resumen financiero").doc, "/calendario")).toMatchObject({
      to: "/finanzas",
      notice: "No tienes acceso a Calendario. Te llevamos a Finanzas.",
    });
  });

  it("Compartir: manage_all entra; el enlace público con token no es la página de administración", () => {
    expect(guardRoute({ role: "pastor", active: true }, "/calendario/compartir")).toEqual({ type: "allow" });
    expect(guardRoute({ role: "admin", active: true }, "/calendario/compartir/")).toEqual({ type: "allow" });
    expect(matchRoute("/calendario/compartir/abc")?.path).toBe("/calendario");
  });

  it("Líder conserva las subrutas de Finanzas (DetailGuard sigue siendo la barrera, sin redirect)", () => {
    for (const route of PRIVATE_ROUTES.filter((r) => r.startsWith("/finanzas"))) {
      expect(guardRoute({ role: "leader", active: true }, route)).toEqual({ type: "allow" });
    }
  });

  it("Mis actividades requiere ver el calendario", () => {
    expect(guardRoute(profile("v1 líder con áreas").doc, "/calendario/mis-actividades")).toEqual({ type: "allow" });
    expect(guardRoute(profile("v1 solo resumen financiero").doc, "/calendario/mis-actividades")).toMatchObject({
      to: "/finanzas",
    });
  });
});

describe("tabla de rutas", () => {
  it("incluye las rutas del contrato", () => {
    const paths = ROUTE_RULES.map((r) => r.path);
    for (const path of [
      "/inicio",
      "/finanzas",
      "/calendario",
      "/calendario/mis-actividades",
      "/calendario/compartir",
      "/reportes",
      "/reportes/calendario",
      "/configuracion",
      "/configuracion/areas",
      "/configuracion/usuarios",
    ]) {
      expect(paths).toContain(path);
    }
    expect(ROUTE_RULES.find((r) => r.path === "/calendario/compartir")?.match).toBe("exact");
    // Integrantes (doc 23): todo /integrantes exige members.consolidation.read; registrar, manage.
    expect(ROUTE_RULES.find((r) => r.path === "/integrantes")).toMatchObject({
      match: "prefix",
      access: { anyOf: ["members.consolidation.read"] },
      module: "members",
    });
    expect(ROUTE_RULES.find((r) => r.path === "/integrantes/consolidacion/nueva")).toMatchObject({
      match: "exact",
      access: { anyOf: ["members.consolidation.manage"] },
    });
  });

  it("gana el prefijo más largo y moduleOfPath activa el módulo correcto", () => {
    expect(matchRoute("/reportes/calendario")?.label).toBe("Reporte de calendario");
    expect(matchRoute("/calendario/mis-actividades/x")?.label).toBe("Mis actividades");
    expect(moduleOfPath("/finanzas/reportes")).toBe("finance");
    expect(moduleOfPath("/reportes")).toBe("reports");
    expect(moduleOfPath("/configuracion/usuarios")).toBe("settings");
    expect(moduleOfPath("/inicio")).toBeNull();
    expect(moduleOfPath("/finanzas-falsa")).toBeNull();
    expect(moduleOfPath(null)).toBeNull();
  });

  it("normalizePath quita query, hash y barra final", () => {
    expect(normalizePath("/finanzas/?x=1#y")).toBe("/finanzas");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
    expect(normalizePath(undefined)).toBe("/");
  });
});
