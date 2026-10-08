// `--summary` de scripts/migrate-access-v1.mjs contra el emulador (doc 20 §10):
// el dry-run que se correrá en producción imprime solo conteos, no escribe y no
// expone uid, nombre ni correo (ni enmascarado). Solo `npm run test:emulator`.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED_USERS } from "../../scripts/seed-platform-calendar-emulator.mjs";
import { emulatorEnv, seed } from "./helpers";

function migrate(...args: string[]) {
  const res = spawnSync(process.execPath, ["scripts/migrate-access-v1.mjs", "--emulator", ...args], {
    env: emulatorEnv(),
    encoding: "utf8",
    timeout: 60000,
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

function expectNoPersonalData(text: string) {
  for (const u of SEED_USERS) {
    expect(text).not.toContain(u.uid);
    expect(text).not.toContain(u.email);
    expect(text).not.toContain(u.displayName);
  }
  expect(text).not.toContain("@");
  expect(text).not.toContain("***");
}

describe("migración --summary contra el emulador", () => {
  let rules: RulesTestEnvironment;
  let dir = "";

  beforeAll(async () => {
    await seed();
    rules = await initializeTestEnvironment({
      projectId: "demo-cds-suite",
      firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") },
    });
    dir = mkdtempSync(path.join(tmpdir(), "cds-migrate-summary-"));
  });

  afterAll(async () => {
    await rules?.cleanup();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("imprime solo el agregado, sin datos personales, y no escribe", async () => {
    const { code, out } = migrate("--summary");
    expect(code).toBe(0);
    expect(out).toContain("simulación (no escribe)");
    expect(out).toContain("Resumen agregado (sin datos personales)");
    expect(out).toMatch(/total\s+8/);
    expect(out).toContain("migrar 3 · ya v1 5 · rol inválido 0");
    expect(out).toMatch(/activos sin ningún módulo\s+1/); // sinmodulos@cds.test
    expect(out).toMatch(/activos que requieren áreas\s+[1-9]/); // al menos el líder sin áreas
    expect(out).toMatch(/v1 con riesgo de rollback\s+[1-9]/); // al menos el v1 sin finanzas
    expect(out).toMatch(/v1 con role incoherente\s+0/); // el seed escribe role derivado
    expect(out).not.toContain("── ");
    expectNoPersonalData(out);

    let data: Record<string, unknown> | undefined;
    await rules.withSecurityRulesDisabled(async (ctx) => {
      data = (await getDoc(doc(ctx.firestore() as unknown as Firestore, "users/seed-finanzas"))).data();
    });
    expect(data?.accessSchemaVersion).toBeUndefined();
  });

  it("con --json el archivo lleva solo el agregado (sin filas por usuario)", () => {
    const file = path.join(dir, "summary.json");
    const { code } = migrate("--summary", "--json", file);
    expect(code).toBe(0);
    const text = readFileSync(file, "utf8");
    const json = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(["aggregate", "apply", "failed", "mode", "project", "summary", "written"]);
    expect(json.apply).toBe(false);
    expectNoPersonalData(text);
  });
});
