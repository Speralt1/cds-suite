import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Mod = {
  checkOut: (dir: string, o?: { live?: boolean }) => string[];
  liveBundled: (env?: Record<string, string>, features?: string) => boolean;
  REQUIRED_ROUTES: string[];
};
const load = async () => (await import(path.resolve(__dirname, "../../scripts/check-no-preview.mjs"))) as Mod;

async function fakeOut(files: Record<string, string>) {
  const { REQUIRED_ROUTES } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnp-"));
  for (const r of REQUIRED_ROUTES) {
    fs.mkdirSync(path.dirname(path.join(dir, r)), { recursive: true });
    fs.writeFileSync(path.join(dir, r), "<html></html>");
  }
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  return dir;
}

describe("check-no-preview · espacio en vivo", () => {
  const liveChunk = { "_next/static/chunks/live.js": 'x="acepto_a_cristo";y="outreachCoordinatorOp"' };
  it("con el espacio en vivo empaquetado, solo su chunk puede llevar la decisión", async () => {
    const { checkOut } = await load();
    expect(checkOut(await fakeOut(liveChunk), { live: true })).toEqual([]);
    const other = await fakeOut({ ...liveChunk, "_next/static/chunks/otro.js": 'z="acepto_a_cristo"' });
    expect(checkOut(other, { live: true })).toEqual([expect.stringContaining("otro.js")]);
  });
  it("sin empaquetar (producción con enabled=false) no puede haber código en vivo", async () => {
    const { checkOut } = await load();
    expect(checkOut(await fakeOut(liveChunk), { live: false }).length).toBeGreaterThan(0);
  });
  it("liveBundled sigue el criterio de features.ts", async () => {
    const { liveBundled } = await load();
    expect(liveBundled({}, "enabled: false,")).toBe(false);
    expect(liveBundled({}, "enabled: true,")).toBe(true);
    expect(liveBundled({ NEXT_PUBLIC_CDS_OUTREACH_LIVE: "1" }, "enabled: false,")).toBe(true);
  });
});
