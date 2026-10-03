// @vitest-environment node
// Cobertura de rutas privadas: cada app/(private)/**/page.tsx debe estar en
// PRIVATE_ROUTES y tener una regla en ROUTE_RULES (lib/access/routes.ts). Sin
// regla, guardRoute devuelve "allow" por omisión; este test impide que una
// página nueva quede abierta sin decidirlo explícitamente.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVATE_ROUTES, ROUTE_RULES, guardRoute, matchRoute } from "@/lib/access/routes";
import { effectivePermissions } from "@/lib/shared/access";
import { PROFILES } from "./profiles";

const PRIVATE_DIR = path.join(process.cwd(), "app", "(private)");

/**
 * Rutas sin regla a propósito (ALLOW explícito, no por omisión), con su motivo.
 * /dashboard no tiene contenido: solo marca la intención de aterrizaje y
 * redirige a /finanzas, donde RouteGuard resuelve el módulo inicial.
 */
const EXPLICIT_ALLOW: Readonly<Record<string, string>> = {
  "/dashboard": "aterrizaje: redirige a /finanzas sin mostrar datos",
};

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pageFiles(full));
    else if (/^page\.(tsx|ts|jsx|js)$/.test(name)) out.push(full);
  }
  return out;
}

/** app/(private)/a/(grupo)/[id]/page.tsx → /a/x (grupos fuera; segmentos dinámicos con un valor de muestra). */
function routeOf(file: string): string {
  const segments = path
    .relative(PRIVATE_DIR, path.dirname(file))
    .split(path.sep)
    .filter((s) => s && !/^\(.*\)$/.test(s))
    .map((s) => (/^\[.*\]$/.test(s) ? "muestra" : s));
  return `/${segments.join("/")}`;
}

const ROUTES = pageFiles(PRIVATE_DIR).map(routeOf).sort();

describe("cobertura de rutas privadas", () => {
  it("encuentra las páginas privadas", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(PRIVATE_ROUTES.length);
    expect(ROUTES).toContain("/calendario");
  });

  it.each(ROUTES)("%s está en PRIVATE_ROUTES", (route) => {
    expect(PRIVATE_ROUTES).toContain(route);
  });

  it.each(ROUTES.filter((r) => !(r in EXPLICIT_ALLOW)))("%s tiene una regla en ROUTE_RULES (no ALLOW por omisión)", (route) => {
    const rule = matchRoute(route);
    expect(rule, route).not.toBeNull();
    expect(ROUTE_RULES).toContain(rule);
  });

  it("toda ruta de PRIVATE_ROUTES tiene su página (sin entradas huérfanas)", () => {
    for (const route of PRIVATE_ROUTES) expect(ROUTES, route).toContain(route);
  });

  it("las excepciones explícitas existen y siguen sin regla (si se agrega una, se quita de la lista)", () => {
    for (const route of Object.keys(EXPLICIT_ALLOW)) {
      expect(ROUTES).toContain(route);
      expect(matchRoute(route)).toBeNull();
    }
  });

  it("en cada página cubierta, allow ⇔ el perfil tiene alguno de los permisos de la regla", () => {
    let checked = 0;
    for (const route of ROUTES.filter((r) => !(r in EXPLICIT_ALLOW))) {
      const rule = matchRoute(route)!;
      if (rule.access === "resolve") continue;
      const anyOf = rule.access.anyOf;
      for (const p of PROFILES) {
        if (p.home === "inactive" || p.home === "no-modules") continue;
        const perms = effectivePermissions(p.doc);
        const decision = guardRoute(p.doc, route);
        expect(decision.type === "allow", `${p.name} ${route}`).toBe(anyOf.some((x) => perms.has(x)));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
