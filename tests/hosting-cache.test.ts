// @vitest-environment node
// Caché de Hosting: el HTML (/, /finanzas, …) se revalida en cada carga para que, tras un
// deploy, el navegador no use HTML viejo que apunta a chunks /_next/static/ ya inexistentes.
// Los chunks llevan hash de contenido y pueden quedar en caché un año.
// Firebase aplica las reglas de headers en el orden definido: la última que coincide gana.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

const ROOT = path.resolve(__dirname, "..");
const firebase = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8"));
const rules: HeaderRule[] = firebase.hosting.headers;

const NO_CACHE = "no-cache";
const IMMUTABLE = "public, max-age=31536000, immutable";

/** Glob mínimo de Hosting para los patrones de este archivo: "**" = cualquier ruta (incluida "/"). */
const globToRegExp = (glob: string) =>
  new RegExp(
    "^" +
      glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\u0000/g, ".*") +
      "$",
  );

/** Headers efectivos para una ruta: todas las reglas que coinciden, en orden, la última gana. */
const effectiveHeaders = (urlPath: string) => {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (!globToRegExp(rule.source).test(urlPath)) continue;
    for (const { key, value } of rule.headers) out[key] = value;
  }
  return out;
};

const ruleFor = (source: string) => {
  const rule = rules.find((r) => r.source === source);
  expect(rule, `regla ${source}`).toBeDefined();
  return Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]));
};

describe("firebase.json · caché de Hosting", () => {
  it("la regla catch-all no-cache va primero para que las específicas la sobrescriban", () => {
    expect(rules[0]).toEqual({ source: "**", headers: [{ key: "Cache-Control", value: NO_CACHE }] });
    expect(rules.filter((r) => r.source === "**")).toHaveLength(1);
  });

  it.each(["/", "/finanzas", "/calendario", "/campanas", "/index.html", "/finanzas.html", "/404.html"])(
    "HTML y rutas sin extensión se revalidan: %s",
    (urlPath) => {
      expect(effectiveHeaders(urlPath)["Cache-Control"]).toBe(NO_CACHE);
    },
  );

  it("/_next/static/** (con hash de contenido) es inmutable", () => {
    expect(ruleFor("/_next/static/**")).toEqual({ "Cache-Control": IMMUTABLE });
    const staticIdx = rules.findIndex((r) => r.source === "/_next/static/**");
    expect(staticIdx).toBeGreaterThan(rules.findIndex((r) => r.source === "**"));
    for (const urlPath of [
      "/_next/static/chunks/app/page-0123abcd.js",
      "/_next/static/css/app-0123abcd.css",
      "/_next/static/media/font.0123abcd.woff2",
      "/_next/static/BUILD_ID/_buildManifest.js",
    ]) {
      expect(effectiveHeaders(urlPath)["Cache-Control"], urlPath).toBe(IMMUTABLE);
    }
  });

  it("ninguna otra regla deja HTML con caché larga ni marca inmutable fuera de /_next/static", () => {
    for (const rule of rules) {
      if (rule.source === "/_next/static/**") continue;
      for (const h of rule.headers) {
        if (h.key.toLowerCase() !== "cache-control") continue;
        expect(h.value, rule.source).not.toMatch(/immutable|max-age=[1-9]/);
      }
    }
  });

  it("headers existentes intactos (y siguen ganando sobre la catch-all)", () => {
    expect(ruleFor("/sw.js")).toEqual({ "Cache-Control": "no-cache, no-store, must-revalidate" });
    expect(ruleFor("/manifest.webmanifest")).toEqual({ "Content-Type": "application/manifest+json" });
    expect(ruleFor("/calendario-publico")).toEqual({
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": NO_CACHE,
    });
    expect(effectiveHeaders("/sw.js")["Cache-Control"]).toBe("no-cache, no-store, must-revalidate");
    expect(effectiveHeaders("/manifest.webmanifest")).toEqual({
      "Cache-Control": NO_CACHE,
      "Content-Type": "application/manifest+json",
    });
    expect(effectiveHeaders("/calendario-publico")["Referrer-Policy"]).toBe("no-referrer");
  });
});
