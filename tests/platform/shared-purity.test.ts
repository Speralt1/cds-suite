// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHARED_FILES } from "../../scripts/build-shared.mjs";

const DIR = path.resolve(__dirname, "../../lib/shared");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".ts"));

/** Quita comentarios (// y bloque) para escanear solo el código. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("lib/shared es puro", () => {
  it("contiene exactamente los archivos que compila build-shared", () => {
    expect(files.map((f) => f.replace(/\.ts$/, "")).sort()).toEqual([...SHARED_FILES].sort());
  });

  it.each(files)("%s: solo imports relativos ./x, sin React/Firebase/navegador/Node", (file) => {
    const src = code(fs.readFileSync(path.join(DIR, file), "utf8"));
    const specifiers = [...src.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of specifiers) expect(spec, `${file} importa ${spec}`).toMatch(/^\.\/[a-z-]+$/);
    expect(src).not.toMatch(/@\//);
    expect(src).not.toMatch(/firebase/i);
    expect(src).not.toMatch(/\breact\b/i);
    expect(src).not.toMatch(/\bwindow\b/);
    expect(src).not.toMatch(/\bdocument\b/);
    expect(src).not.toMatch(/\blocalStorage\b|\bsessionStorage\b|\bnavigator\b/);
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/\bprocess\./);
    expect(src).not.toMatch(/\bMath\.random\b/);
  });

  it.each(files.filter((f) => f !== "dates.ts"))("%s: sin Date (el reloj se inyecta; solo dates.ts usa Date)", (file) => {
    const src = code(fs.readFileSync(path.join(DIR, file), "utf8"));
    expect(src).not.toMatch(/\bDate\.now\b/);
    expect(src).not.toMatch(/new\s+Date\s*\(/);
    expect(src).not.toMatch(/\bDate\s*\(/);
  });

  it("dates.ts no lee el reloj del sistema (sin Date.now ni new Date() vacío)", () => {
    const src = code(fs.readFileSync(path.join(DIR, "dates.ts"), "utf8"));
    expect(src).not.toMatch(/\bDate\.now\b/);
    expect(src).not.toMatch(/new\s+Date\s*\(\s*\)/);
  });
});
