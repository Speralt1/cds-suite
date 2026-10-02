import { afterEach, describe, expect, it } from "vitest";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import nextConfig from "@/next.config";

// Barrera 1 del preview: la extensión .preview.tsx solo es página en dev o con
// CDS_FINANCE_PREVIEW=1. El build por defecto (desplegable) no la conoce.
describe("next.config · exclusión del preview", () => {
  const original = process.env.CDS_FINANCE_PREVIEW;
  afterEach(() => {
    if (original === undefined) delete process.env.CDS_FINANCE_PREVIEW;
    else process.env.CDS_FINANCE_PREVIEW = original;
  });

  it("el build de producción sin bandera no incluye preview.tsx", () => {
    delete process.env.CDS_FINANCE_PREVIEW;
    const cfg = nextConfig(PHASE_PRODUCTION_BUILD);
    expect(cfg.pageExtensions).not.toContain("preview.tsx");
    expect(cfg.output).toBe("export");
  });

  it("next dev y el build con bandera sí lo incluyen", () => {
    delete process.env.CDS_FINANCE_PREVIEW;
    expect(nextConfig(PHASE_DEVELOPMENT_SERVER).pageExtensions).toContain("preview.tsx");
    process.env.CDS_FINANCE_PREVIEW = "1";
    expect(nextConfig(PHASE_PRODUCTION_BUILD).pageExtensions).toContain("preview.tsx");
  });

  it("conserva las extensiones normales del resto de la app", () => {
    delete process.env.CDS_FINANCE_PREVIEW;
    expect(nextConfig(PHASE_PRODUCTION_BUILD).pageExtensions).toEqual(["tsx", "ts", "jsx", "js"]);
  });
});
