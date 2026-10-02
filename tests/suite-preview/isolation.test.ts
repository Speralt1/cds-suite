import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { IMPORT_RE, ROOT, collectImportGraph, importsOf, resolveLocal, walkFiles } from "../helpers/import-graph";

// La preview de CDS Suite NO debe leer ni escribir Firestore, ni usar red ni
// almacenamiento del navegador. Extiende tests/finance-preview/isolation.test.ts
// (que no se modifica) a los directorios nuevos.

const ENTRY_DIRS = [
  join(ROOT, "app", "preview"),
  join(ROOT, "components", "suite-preview"),
  join(ROOT, "lib", "suite-preview"),
  join(ROOT, "lib", "finance-preview", "clock.ts"),
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

const files = () => ENTRY_DIRS.flatMap(walkFiles);
const rel = (f: string) => relative(ROOT, f);

describe("aislamiento de la preview de CDS Suite", () => {
  it("existen las raíces", () => {
    for (const dir of ENTRY_DIRS) expect(existsSync(dir), dir).toBe(true);
  });

  it("ningún módulo alcanzable importa Firebase ni módulos con Firestore", () => {
    const { seen, offenders } = collectImportGraph({ entries: ENTRY_DIRS, forbiddenPackages: FORBIDDEN_PACKAGES, forbiddenLocal: FORBIDDEN_LOCAL });
    expect(seen.size).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });

  it("sin APIs de red ni almacenamiento (incluye sessionStorage y document.cookie)", () => {
    const offenders = files().filter((f) =>
      /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|navigator\.sendBeacon|document\.cookie/.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("el reloj del sistema solo se usa en lib/suite-preview/dates.ts", () => {
    const offenders = files().filter((f) => !f.endsWith(join("lib", "suite-preview", "dates.ts")) && /Date\.now\(|new Date\(/.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("jspdf solo se importa de forma dinámica y solo en report-pdf.ts", () => {
    for (const f of files()) {
      const src = readFileSync(f, "utf8");
      const isPdf = f.endsWith(join("lib", "suite-preview", "report-pdf.ts"));
      expect(/(?:from\s+|import\s+)["']jspdf(?:-autotable)?["']/.test(src), `${rel(f)} import estático`).toBe(false);
      if (!isPdf) expect(/import\(\s*["']jspdf/.test(src), `${rel(f)} import dinámico`).toBe(false);
    }
    expect(readFileSync(join(ROOT, "lib", "suite-preview", "report-pdf.ts"), "utf8")).toMatch(/import\("jspdf"\)/);
  });

  it("lib/suite-preview es puro: sin React, sin lucide ni next", () => {
    for (const f of walkFiles(join(ROOT, "lib", "suite-preview")))
      for (const spec of importsOf(f)) expect(/^(react|react-dom|lucide-react|next)(\/|$)/.test(spec), `${rel(f)} → ${spec}`).toBe(false);
  });

  it("components/suite-preview/public/** solo importa la allowlist", () => {
    const dir = join(ROOT, "components", "suite-preview", "public");
    const allowed = ["lib/suite-preview/types", "lib/suite-preview/sentinel", "lib/finance-preview/format"];
    for (const f of walkFiles(dir)) {
      for (const spec of importsOf(f)) {
        if (spec === "react" || spec === "lucide-react") continue;
        const target = spec.startsWith(".") || spec.startsWith("@/") ? resolveLocal(spec, f) : null;
        const t = target ? rel(target) : spec;
        const ok = t.startsWith("components/suite-preview/public/") || allowed.some((a) => t.startsWith(a));
        expect(ok, `${rel(f)} → ${spec}`).toBe(true);
      }
    }
  });

  it("el walker detecta Firebase cuando existe (control positivo)", () => {
    const source = readFileSync(join(ROOT, "lib", "finance", "formatters.ts"), "utf8");
    expect([...source.matchAll(IMPORT_RE)].some((m) => FORBIDDEN_PACKAGES.some((re) => re.test(m[1] ?? "")))).toBe(true);
  });
});
