import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = [
  join(process.cwd(), "components", "preview2026"),
  join(process.cwd(), "app", "(private)", "preview"),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx)$/.test(name) ? [full] : [];
  });
}

describe("aislamiento de Firestore en el preview 2026", () => {
  it("ningún archivo bajo components/preview2026 o app/**/preview/** importa 'firebase'", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const content = readFileSync(file, "utf8");
        if (/from\s+["']firebase(\/[^"']*)?["']/.test(content)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
