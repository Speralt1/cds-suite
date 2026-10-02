import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Ejecuta la guardia real sobre carpetas temporales (CDS_OUT_DIR).
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function makeOut(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "cds-guard-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function guard(dir: string) {
  return spawnSync(process.execPath, ["scripts/check-no-preview.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, CDS_OUT_DIR: dir },
    encoding: "utf8",
  });
}

const CLEAN = { "index.html": "<html><body>CDS</body></html>", "_next/static/chunks/app.js": "console.log('ok')" };

describe("guardia de deploy (scripts/check-no-preview.mjs)", () => {
  it("out/ limpio → exit 0", () => {
    const r = guard(makeOut(CLEAN));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/✓/);
  });

  it.each([
    ["sentinel SX", { "_next/static/chunks/x.js": "var a='SX_PREVIEW_SENTINEL_V1_c41e'" }],
    ["sentinel FX", { "_next/static/chunks/y.js": "var a='FX_PREVIEW_SENTINEL_V2_7f3a'" }],
    ["ruta /preview/integrantes", { "algo.html": '<a href="/preview/integrantes/consolidacion">x</a>' }],
    ["ruta /preview/calendario", { "datos.json": '{"href":"/preview/calendario"}' }],
    ["carpeta out/preview", { "preview/index.html": "<html></html>" }],
  ])("%s → exit 1", (_, extra) => {
    const r = guard(makeOut({ ...CLEAN, ...extra }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NO desplegar/);
  });

  it("sin out/ → exit 1", () => {
    expect(guard(join(tmpdir(), "cds-guard-no-existe-xyz")).status).toBe(1);
  });
});
