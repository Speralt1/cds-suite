// @vitest-environment node
// Cableado estático: firebase.json (rewrites, headers, emulador, predeploy) e index.js.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const firebase = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8"));
const indexJs = fs.readFileSync(path.join(ROOT, "functions/index.js"), "utf8");

type Rewrite = { source: string; destination?: string; function?: { functionId: string; region: string } };
type HeaderRule = { source: string; headers: { key: string; value: string }[] };

describe("firebase.json", () => {
  const rewrites: Rewrite[] = firebase.hosting.rewrites;
  const sources = rewrites.map((r) => r.source);

  it("rewrites existentes intactos y los nuevos en orden", () => {
    expect(sources).toEqual(["/api/sumup-sync", "/api/calendario-publico", "/c/**", "/campanas/**", "/calendario/compartir/**"]);
    expect(rewrites[1]).toEqual({
      source: "/api/calendario-publico",
      function: { functionId: "calendarPublicFeed", region: "southamerica-west1" },
    });
    expect(rewrites[4]).toEqual({ source: "/calendario/compartir/**", destination: "/calendario-publico.html" });
    expect(firebase.hosting.cleanUrls).toBe(true);
    expect(firebase.hosting.trailingSlash).toBe(false);
  });

  it("headers de privacidad para la página pública (y los existentes se conservan)", () => {
    const headers: HeaderRule[] = firebase.hosting.headers;
    expect(headers.map((h) => h.source)).toEqual(["/sw.js", "/manifest.webmanifest", "/calendario/compartir/**", "/calendario-publico"]);
    for (const source of ["/calendario/compartir/**", "/calendario-publico"]) {
      const rule = headers.find((h) => h.source === source)!;
      expect(Object.fromEntries(rule.headers.map((h) => [h.key, h.value]))).toEqual({
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
        "Cache-Control": "no-cache",
      });
    }
  });

  it("emulador de Functions y predeploy --check", () => {
    expect(firebase.emulators.functions).toEqual({ host: "127.0.0.1", port: 5001 });
    expect(firebase.emulators.auth.port).toBe(9099);
    expect(firebase.emulators.firestore.port).toBe(8080);
    expect(firebase.functions.predeploy).toEqual(["node scripts/build-shared.mjs --check"]);
    expect(firebase.functions.source).toBe("functions");
  });
});

describe("functions/index.js", () => {
  it("exporta las Functions del calendario en la región y con los límites de la spec", () => {
    expect(indexJs).toContain('const REGION = "southamerica-west1";');
    expect(indexJs).toMatch(/exports\.calendarPublicFeed = onRequest\(\s*\{ region: REGION, timeoutSeconds: 15, memory: "256MiB", maxInstances: 5 \}/);
    expect(indexJs).toMatch(/exports\.calendarShareLinkManage = onCall\(\s*\{ region: REGION, timeoutSeconds: 15, maxInstances: 3 \}/);
    expect(indexJs).toContain('isEmulator: process.env.FUNCTIONS_EMULATOR === "true"');
  });

  it("requireFinanceUser usa el modelo compartido (sin la lista de roles a mano)", () => {
    expect(indexJs).toContain("createRequireFinanceUser(");
    expect(indexJs).not.toMatch(/\['admin', 'pastor', 'finance'\]\.includes/);
  });
});
