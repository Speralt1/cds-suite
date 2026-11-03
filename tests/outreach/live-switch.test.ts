import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OUTREACH_FEATURES, outreachLiveBundled } from "@/lib/outreach/features";

describe("Interruptor del espacio en vivo", () => {
  it("se empaqueta con enabled || LIVE", () => {
    expect(outreachLiveBundled(false, false)).toBe(false);
    expect(outreachLiveBundled(true, false)).toBe(true);
    expect(outreachLiveBundled(false, true)).toBe(true);
  });
  it("next.config y la página usan el mismo criterio", () => {
    const root = path.resolve(__dirname, "../..");
    const cfg = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
    expect(cfg).toMatch(/import \{ OUTREACH_LIVE_BUNDLED \} from "\.\/lib\/outreach\/features"/);
    expect(cfg).toMatch(/if \(!OUTREACH_LIVE_BUNDLED\)/);
    expect(cfg).toMatch(/components\/outreach\/live\/live-workspace/);
    const page = fs.readFileSync(path.join(root, "app/(private)/integrantes/ve-por-los-tuyos/page.tsx"), "utf8");
    expect(page).toMatch(/OUTREACH_LIVE_BUNDLED \? dynamic/);
  });
  it("en esta rama el submódulo sigue apagado", () => {
    expect(OUTREACH_FEATURES.enabled).toBe(false);
  });
});
