// Smoke real de scripts/migrate-access-v1.mjs contra el emulador: dry-run sobre
// los usuarios legacy del seed, --apply, idempotencia y acceso financiero
// idéntico verificado con firestore.rules. Solo `npm run test:emulator`.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LEGACY_ROLE_ACCESS, MIGRATION_ACTOR } from "@/lib/shared/access";
import { SEED_USERS } from "../../scripts/seed-platform-calendar-emulator.mjs";
import { emulatorEnv, seed } from "./helpers";

const V1_KEYS = [
  "accessSchemaVersion",
  "active",
  "areaIds",
  "baseRole",
  "createdAt",
  "displayName",
  "email",
  "homeModule",
  "permissions",
  "position",
  "role",
  "updatedAt",
  "updatedBy",
];

function migrate(...args: string[]) {
  const env = emulatorEnv();
  const res = spawnSync(process.execPath, ["scripts/migrate-access-v1.mjs", "--emulator", ...args], { env, encoding: "utf8", timeout: 60000 });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

function block(out: string, uid: string): string {
  const start = out.indexOf(`── ${uid} `);
  expect(start, `bloque de ${uid}`).toBeGreaterThanOrEqual(0);
  const next = out.indexOf("── ", start + 3);
  return out.slice(start, next === -1 ? undefined : next);
}

async function canRead(db: Firestore, path: string): Promise<boolean> {
  try {
    await getDocs(collection(db, path));
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "permission-denied") return false;
    throw error;
  }
}

describe("migración de acceso v1 contra el emulador", () => {
  let rules: RulesTestEnvironment;
  const db = (uid: string) => rules.authenticatedContext(uid).firestore() as unknown as Firestore;
  const adminDb = async (path: string) => {
    let data: Record<string, unknown> | undefined;
    await rules.withSecurityRulesDisabled(async (ctx) => {
      data = (await getDoc(doc(ctx.firestore() as unknown as Firestore, path))).data();
    });
    return data ?? {};
  };

  beforeAll(async () => {
    await seed();
    rules = await initializeTestEnvironment({
      projectId: "demo-cds-suite",
      firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") },
    });
  });

  afterAll(async () => {
    await rules?.cleanup();
  });

  it("se niega sin destino o con un proyecto que no es demo-", () => {
    const env = { ...emulatorEnv() };
    delete env.FIRESTORE_EMULATOR_HOST;
    const none = spawnSync(process.execPath, ["scripts/migrate-access-v1.mjs"], { env, encoding: "utf8" });
    expect(none.status).toBe(1);
    expect(none.stderr).toContain("Sin destino");
    const notDemo = spawnSync(process.execPath, ["scripts/migrate-access-v1.mjs", "--emulator", "--project", "cds-real"], { env, encoding: "utf8" });
    expect(notDemo.status).toBe(1);
    expect(notDemo.stderr).toContain('debe empezar con "demo-"');
  });

  it("acceso financiero de los legacy antes de migrar (línea base)", async () => {
    expect(await canRead(db("seed-finanzas"), "financeTransactions")).toBe(true);
    expect(await canRead(db("seed-finanzas"), "pastoralFollowups")).toBe(false);
    expect(await canRead(db("seed-admin"), "financeTransactions")).toBe(true);
    expect(await canRead(db("seed-inactivo"), "financeTransactions")).toBe(false);
  });

  it("dry-run imprime el plan esperado, sin correos en claro, y no escribe", async () => {
    const { code, out } = migrate();
    expect(code).toBe(0);
    expect(out).toContain("simulación (no escribe)");
    for (const u of SEED_USERS) expect(out).not.toContain(u.email);
    expect(out).toContain("a***@c***.test");

    const admin = block(out, "seed-admin");
    expect(admin).toMatch(/estado\s+migrate/);
    expect(admin).toMatch(/rol anterior\s+admin/);
    expect(admin).toMatch(/baseRole nuevo\s+admin/);
    expect(admin).toContain("settings.manage"); // efectivos: catálogo completo
    expect(admin).toMatch(/áreas\s+\[\]/);
    expect(admin).toContain(`updatedBy: (sin campo) → "${MIGRATION_ACTOR}"`);
    expect(admin).toContain("updatedAt: (sin campo) → serverTimestamp()");
    expect(admin).toContain("accessSchemaVersion: (sin campo) → 1");

    const fin = block(out, "seed-finanzas");
    expect(fin).toMatch(/estado\s+migrate/);
    expect(fin).toMatch(/baseRole nuevo\s+standard/);
    expect(fin).toContain(`permisos          ${LEGACY_ROLE_ACCESS.finance.permissions.join(", ")}`);
    expect(fin).toMatch(/módulo inicial\s+finance/);
    expect(fin).not.toContain("role:");

    const inactive = block(out, "seed-inactivo");
    expect(inactive).toMatch(/estado\s+migrate/);
    expect(inactive).toContain("Usuario inactivo");

    for (const uid of ["seed-pastor", "seed-lider-jovenes", "seed-lider-sin-area", "seed-diacono-publica", "seed-sin-modulos"]) {
      expect(block(out, uid)).toMatch(/estado\s+skip_already_v1/);
    }
    expect(out).toContain("migrar 3 · ya v1 5 · rol inválido 0");

    const after = await adminDb("users/seed-finanzas");
    expect(after.accessSchemaVersion).toBeUndefined();
    expect(Object.keys(after).sort()).toEqual(["active", "createdAt", "displayName", "email", "role"]);
  });

  it("--apply migra a v1 conservando role; es idempotente; el acceso financiero no cambia", async () => {
    const before = await adminDb("users/seed-finanzas");
    const first = migrate("--apply");
    expect(first.code).toBe(0);
    expect(first.out).toContain("Escritos: 3");

    for (const [uid, role] of [
      ["seed-admin", "admin"],
      ["seed-finanzas", "finance"],
      ["seed-inactivo", "finance"],
    ] as const) {
      const d = await adminDb(`users/${uid}`);
      expect(Object.keys(d).sort(), uid).toEqual(V1_KEYS);
      expect(d.role).toBe(role);
      expect(d.accessSchemaVersion).toBe(1);
      expect(d.baseRole).toBe(LEGACY_ROLE_ACCESS[role].baseRole);
      expect(d.permissions).toEqual(LEGACY_ROLE_ACCESS[role].permissions);
      expect(d.areaIds).toEqual([]);
      expect(d.homeModule).toBe(LEGACY_ROLE_ACCESS[role].homeModule);
      expect(d.updatedBy).toBe(MIGRATION_ACTOR);
      expect(typeof (d.updatedAt as { toMillis?: unknown })?.toMillis).toBe("function");
    }
    const fin = await adminDb("users/seed-finanzas");
    expect(fin.displayName).toBe(before.displayName);
    expect(fin.email).toBe(before.email);
    expect(fin.active).toBe(before.active);
    expect((fin.createdAt as { isEqual(o: unknown): boolean }).isEqual(before.createdAt)).toBe(true);
    // Los v1 sembrados no se tocan.
    expect((await adminDb("users/seed-pastor")).updatedBy).toBe("seed-admin");

    // Acceso por reglas, igual que antes de migrar.
    expect(await canRead(db("seed-finanzas"), "financeTransactions")).toBe(true);
    expect(await canRead(db("seed-finanzas"), "pastoralFollowups")).toBe(false);
    expect(await canRead(db("seed-admin"), "financeTransactions")).toBe(true);
    expect(await canRead(db("seed-inactivo"), "financeTransactions")).toBe(false);

    const second = migrate("--apply");
    expect(second.code).toBe(0);
    expect(second.out).toContain("migrar 0 · ya v1 8");
    expect(second.out).toContain("Escritos: 0");
  });
});
