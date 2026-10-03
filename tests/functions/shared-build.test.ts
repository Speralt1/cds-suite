// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SHARED_FILES,
  SHARED_OUT_DIR,
  buildSharedOutputs,
  checkSharedOutputs,
  compileShared,
  generatedHeader,
} from "../../scripts/build-shared.mjs";

const ROOT = path.resolve(__dirname, "../..");

describe("functions/shared está al día con lib/shared (frescura)", () => {
  it("cada archivo generado coincide byte a byte con la transpilación en memoria", () => {
    const expected = buildSharedOutputs();
    expect([...expected.keys()].sort()).toEqual(SHARED_FILES.map((f) => `${f}.js`).sort());
    for (const [file, content] of expected) {
      const actual = fs.readFileSync(path.join(SHARED_OUT_DIR, file), "utf8");
      expect(actual, `functions/shared/${file} desactualizado: corre npm run build:shared`).toBe(content);
    }
  });

  it("no sobran archivos .js en functions/shared", () => {
    const present = fs.readdirSync(SHARED_OUT_DIR).filter((f) => f.endsWith(".js"));
    expect(present.sort()).toEqual(SHARED_FILES.map((f) => `${f}.js`).sort());
    expect(checkSharedOutputs()).toEqual([]);
  });

  it("cada archivo lleva el header GENERADO y es CommonJS", () => {
    for (const name of SHARED_FILES) {
      const js = fs.readFileSync(path.join(SHARED_OUT_DIR, `${name}.js`), "utf8");
      expect(js.startsWith(generatedHeader(name))).toBe(true);
      expect(js).toContain('"use strict";');
      expect(js).not.toMatch(/^\s*import\s/m);
      expect(js).not.toMatch(/^\s*export\s/m);
    }
  });

  it("detecta un cambio en la fuente (la compilación depende del contenido)", () => {
    const src = fs.readFileSync(path.join(ROOT, "lib/shared/share-token-format.ts"), "utf8");
    expect(compileShared("share-token-format", `${src}\nexport const X = 1;\n`)).not.toBe(
      compileShared("share-token-format", src),
    );
  });

  it("`node scripts/build-shared.mjs --check` sale con 0", () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, "scripts/build-shared.mjs"), "--check"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out).toMatch(/al día/);
  });
});
