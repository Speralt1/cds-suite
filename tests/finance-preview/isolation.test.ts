import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// El preview Financial UX 2026 NO debe leer ni escribir Firestore.
// Este test recorre TRANSITIVAMENTE todos los imports (relativos y "@/")
// desde las raíces del preview y falla si alguno alcanza Firebase o los
// módulos de finanzas que dependen de Firestore.

const ROOT = process.cwd();
const ENTRY_DIRS = [
  join(ROOT, "app", "preview"),
  join(ROOT, "components", "finance-preview"),
  join(ROOT, "lib", "finance-preview"),
];

const FORBIDDEN_PACKAGES = [/^firebase(\/|$)/, /^firebase-admin(\/|$)/, /^@firebase\//];
const FORBIDDEN_LOCAL = [
  "lib/firebase",
  "lib/auth/",
  "lib/finance/",
  "lib/offerings/",
  "lib/campaigns/",
  "lib/settings/",
  "components/finance/",
  "components/layout/",
  "components/settings/",
  "app/(private)/",
];

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [full] : [];
  });
}

function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : resolve(dirname(from), spec);
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].map((ext) => base + ext),
    ...["index.ts", "index.tsx", "index.js"].map((f) => join(base, f)),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function collect() {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const queue = ENTRY_DIRS.flatMap(walk);
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2] ?? match[3];
      if (!spec) continue;
      const rel = relative(ROOT, file);
      if (FORBIDDEN_PACKAGES.some((re) => re.test(spec))) {
        offenders.push(`${rel} → ${spec}`);
        continue;
      }
      if (spec.startsWith(".") || spec.startsWith("@/")) {
        const target = resolveLocal(spec, file);
        if (!target) continue; // CSS u otros assets sin resolver
        const targetRel = relative(ROOT, target);
        if (FORBIDDEN_LOCAL.some((p) => targetRel.startsWith(p))) {
          offenders.push(`${rel} → ${targetRel}`);
          continue;
        }
        if (/\.(ts|tsx|js|jsx|mjs)$/.test(target)) queue.push(target);
      }
    }
  }
  return { seen, offenders };
}

describe("aislamiento del preview Financial UX 2026", () => {
  it("existen las raíces del preview", () => {
    for (const dir of ENTRY_DIRS) expect(existsSync(dir), dir).toBe(true);
  });

  it("ningún módulo alcanzable desde el preview importa Firebase ni módulos con Firestore", () => {
    const { seen, offenders } = collect();
    expect(seen.size).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  it("el preview no usa APIs de red ni almacenamiento persistente", () => {
    const files = ENTRY_DIRS.flatMap(walk);
    const offenders = files.filter((f) =>
      /\bfetch\(|XMLHttpRequest|localStorage|indexedDB|navigator\.sendBeacon/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
