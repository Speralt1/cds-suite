import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Walker transitivo de imports (relativos y "@/"), con las listas como
// parámetros. Copia parametrizada del de tests/finance-preview/isolation.test.ts.

export const ROOT = process.cwd();

export const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

export function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  if (statSync(dir).isFile()) return [dir];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walkFiles(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [full] : [];
  });
}

export function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : resolve(dirname(from), spec);
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].map((ext) => base + ext),
    ...["index.ts", "index.tsx", "index.js"].map((f) => join(base, f)),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

export function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3]).filter(Boolean);
}

export function collectImportGraph(opts: {
  entries: string[];
  forbiddenPackages: RegExp[];
  forbiddenLocal: string[];
}): { seen: Set<string>; offenders: string[] } {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const queue = opts.entries.flatMap(walkFiles);
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = relative(ROOT, file);
    for (const spec of importsOf(file)) {
      if (opts.forbiddenPackages.some((re) => re.test(spec))) {
        offenders.push(`${rel} → ${spec}`);
        continue;
      }
      if (spec.startsWith(".") || spec.startsWith("@/")) {
        const target = resolveLocal(spec, file);
        if (!target) continue;
        const targetRel = relative(ROOT, target);
        if (opts.forbiddenLocal.some((p) => targetRel.startsWith(p))) {
          offenders.push(`${rel} → ${targetRel}`);
          continue;
        }
        if (/\.(ts|tsx|js|jsx|mjs)$/.test(target)) queue.push(target);
      }
    }
  }
  return { seen, offenders };
}
