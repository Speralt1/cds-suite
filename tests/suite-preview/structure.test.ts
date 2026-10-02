import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIEW_ROUTES } from "@/lib/suite-preview/routes";

const ROOT = process.cwd();
const PREVIEW = join(ROOT, "app", "preview");

function walkAll(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? [full, ...walkAll(full)] : [full];
  });
}

/** Carpeta (relativa a app/preview) de cada ruta de la preview. */
function folderFor(route: string): string {
  const sub = route.replace(/^\/preview\/?/, "");
  if (sub === "" || sub.startsWith("finanzas-2026")) return sub;
  if (sub.startsWith("calendario/compartir/")) return `(publico)/${sub}`;
  return `(suite)/${sub}`;
}

describe("estructura de app/preview", () => {
  it("cada ruta de la preview tiene su page.preview.tsx", () => {
    const missing = PREVIEW_ROUTES.map(folderFor).filter((f) => !existsSync(join(PREVIEW, f, "page.preview.tsx")));
    expect(missing).toEqual([]);
    expect(PREVIEW_ROUTES.length).toBe(32);
  });

  it("no hay segmentos dinámicos ([…])", () => {
    expect(walkAll(PREVIEW).filter((f) => /\[/.test(relative(PREVIEW, f)))).toEqual([]);
  });

  it("layout.tsx solo en app/preview, (suite) y finanzas-2026; nunca layout.preview.tsx", () => {
    const layouts = walkAll(PREVIEW)
      .filter((f) => /\/layout\.[a-z.]+$/.test(f))
      .map((f) => relative(PREVIEW, f))
      .sort();
    expect(layouts).toEqual(["(suite)/layout.tsx", "finanzas-2026/layout.tsx", "layout.tsx"]);
  });

  it("app/preview/layout.tsx contiene el gate de CDS_FINANCE_PREVIEW", () => {
    const src = readFileSync(join(PREVIEW, "layout.tsx"), "utf8");
    expect(src).toMatch(/process\.env\.CDS_FINANCE_PREVIEW !== "1"/);
    expect(src).toMatch(/notFound\(\)/);
  });
});
