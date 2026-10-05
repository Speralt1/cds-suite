// @vitest-environment node
// Aislamiento de Integrantes › Consolidación V1 (doc 24 §5–§7; matriz #42–#50):
// - el calendario público (página + Function + proyección) no conoce datos de Integrantes;
// - Integrantes no importa ni escribe nada de Finanzas, SumUp ni del Calendario;
// - las Functions financieras no dependen del código de Integrantes.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MEMBERS_COLLECTIONS } from "@/lib/shared/members";

const ROOT = path.resolve(__dirname, "../..");

function files(dir: string, exts = /\.(ts|tsx|js|mjs|css)$/): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(rel, exts));
    else if (exts.test(entry.name)) out.push(rel);
  }
  return out;
}
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const MEMBERS_WORDS = [...Object.values(MEMBERS_COLLECTIONS), "lib/members", "components/members", "shared/members", "members.consolidation"];

describe("calendario público: no toca Integrantes (#43)", () => {
  const PUBLIC = [
    ...files("app/calendario-publico"),
    ...files("components/public-calendar"),
    "lib/shared/public-calendar.ts",
    "lib/calendar/public-feed-client.ts",
    ...files("functions/calendar"),
    "functions/shared/public-calendar.js",
  ];

  it("existen los archivos revisados", () => {
    expect(PUBLIC.length).toBeGreaterThan(6);
  });

  for (const rel of PUBLIC)
    it(`${rel} no menciona colecciones, módulos ni permisos de Integrantes`, () => {
      const text = read(rel);
      for (const word of MEMBERS_WORDS) expect(text.includes(word), word).toBe(false);
    });
});

describe("Integrantes no depende de Finanzas, SumUp ni escribe Calendario (#44–#46)", () => {
  const MEMBERS_CODE = [...files("lib/members"), ...files("components/members"), ...files("app/(private)/integrantes"), ...files("functions/members"), "lib/shared/members.ts"];

  it("hay código de Integrantes que revisar", () => {
    expect(MEMBERS_CODE.length).toBeGreaterThan(3);
  });

  for (const rel of MEMBERS_CODE)
    it(`${rel}: sin imports de finanzas/sumup/campañas/ofrendas ni de la preview`, () => {
      const imports = [...read(rel).matchAll(/(?:from\s+|require\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${rel} importa ${spec}`).not.toMatch(/finance|sumup|campaign|offering|tithe|suite-preview|finance-preview/);
      }
    });

  it("las Functions de Integrantes no escriben calendarEvents ni colecciones financieras", () => {
    for (const rel of files("functions/members")) {
      const text = read(rel);
      expect(text).not.toMatch(/financeTransactions|financeMonthlySummaries|sumupIntegrations|titheProfiles|calendarShareLinks/);
      // calendarEvents solo se LEE para validar el id (nunca set/update/delete/add).
      for (const m of text.matchAll(/calendarEvents[^\n]*/g)) expect(m[0]).not.toMatch(/\.(set|update|delete|add|create)\(/);
    }
  });
});

describe("Functions financieras: sin dependencia de Integrantes (#45)", () => {
  for (const rel of [...files("functions/sumup"), "functions/auth/require-finance-user.js"])
    it(`${rel} no importa código de Integrantes`, () => {
      const text = read(rel);
      expect(text).not.toMatch(/members/);
    });

  it("functions/index.js: los exports de Integrantes van al final y no tocan los handlers financieros", () => {
    const index = read("functions/index.js");
    const firstMembers = index.indexOf("members");
    expect(firstMembers).toBeGreaterThan(index.indexOf("exports.sumupSyncScheduled"));
    expect(firstMembers).toBeGreaterThan(index.indexOf("exports.calendarShareLinkManage"));
  });
});
