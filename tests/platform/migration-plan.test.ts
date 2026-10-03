// @vitest-environment node
// CLI de la migración (scripts/migrate-access-v1.mjs): interlocks puros,
// diff exacto y salida sin correos en claro. El planner en sí está cubierto
// en shared-access.test.ts.
import { describe, expect, it } from "vitest";
import { MIGRATION_ACTOR, planAccessMigration } from "@/lib/shared/access";
import {
  MigrationUsageError,
  fieldDiff,
  formatRow,
  parseMigrationArgs,
  summarize,
} from "../../scripts/migrate-access-v1.mjs";

const EMU = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" };

describe("parseMigrationArgs: interlocks", () => {
  it("sin destino → error", () => {
    expect(() => parseMigrationArgs([], {})).toThrow(MigrationUsageError);
    expect(() => parseMigrationArgs(["--apply"], {})).toThrow(/Sin destino/);
  });

  it("emulador: FIRESTORE_EMULATOR_HOST seteado + proyecto demo- (por defecto demo-cds-suite); dry run por defecto", () => {
    const p = parseMigrationArgs([], EMU);
    expect(p).toMatchObject({ mode: "emulator", project: "demo-cds-suite", emulatorHost: "127.0.0.1:8080", apply: false, pastorHome: "finance" });
    expect(parseMigrationArgs(["--emulator"], {})).toMatchObject({ mode: "emulator", emulatorHost: "127.0.0.1:8080" });
    expect(parseMigrationArgs([], { ...EMU, GCLOUD_PROJECT: "demo-otro" }).project).toBe("demo-otro");
  });

  it("emulador con proyecto que no es demo- → error (ambiguo)", () => {
    expect(() => parseMigrationArgs(["--project", "cds-administracion"], EMU)).toThrow(/demo-/);
    expect(() => parseMigrationArgs(["--emulator"], { GCLOUD_PROJECT: "cds-administracion" })).toThrow(/demo-/);
  });

  it("--apply en el emulador no exige confirmación ni TTY", () => {
    expect(parseMigrationArgs(["--emulator", "--apply"], {})).toMatchObject({ apply: true, requiresTty: false });
  });

  it("proyecto real: dry run con --project explícito; --apply exige --confirm idéntico, la variable y una TTY", () => {
    expect(parseMigrationArgs(["--project", "cds-x"], {})).toMatchObject({ mode: "project", project: "cds-x", apply: false, requiresTty: false });
    expect(() => parseMigrationArgs(["--project", "cds-x", "--apply"], {})).toThrow(/--confirm cds-x/);
    expect(() => parseMigrationArgs(["--project", "cds-x", "--apply", "--confirm", "cds-y"], {})).toThrow(/--confirm cds-x/);
    expect(() => parseMigrationArgs(["--project", "cds-x", "--apply", "--confirm", "cds-x"], {})).toThrow(/CDS_ALLOW_PRODUCTION_MIGRATION/);
    expect(
      parseMigrationArgs(["--project", "cds-x", "--apply", "--confirm", "cds-x"], { CDS_ALLOW_PRODUCTION_MIGRATION: "cds-x" }),
    ).toMatchObject({ mode: "project", apply: true, requiresTty: true });
  });

  it("--pastor-home solo finance|calendar; argumentos desconocidos o sin valor → error", () => {
    expect(parseMigrationArgs(["--pastor-home", "calendar"], EMU).pastorHome).toBe("calendar");
    expect(() => parseMigrationArgs(["--pastor-home", "reports"], EMU)).toThrow(/pastor-home/);
    expect(() => parseMigrationArgs(["--force"], EMU)).toThrow(/desconocido/);
    expect(() => parseMigrationArgs(["--project"], EMU)).toThrow(/Falta el valor/);
    expect(parseMigrationArgs(["--only", "u1", "--json", "out.json"], EMU)).toMatchObject({ only: "u1", json: "out.json" });
  });
});

describe("diff y salida", () => {
  const legacy = { displayName: "Ana Pérez", email: "ana.perez@ejemplo.cl", role: "finance", active: true };

  it("el diff lista exactamente los campos del planner + updatedAt (serverTimestamp); nunca role/email/active/createdAt", () => {
    const row = planAccessMigration("u1", legacy, { pastorHome: "finance" });
    const diff = fieldDiff(row, legacy);
    expect(diff.map((d) => d.field).sort()).toEqual(
      ["accessSchemaVersion", "areaIds", "baseRole", "homeModule", "permissions", "position", "updatedAt", "updatedBy"].sort(),
    );
    expect(diff.find((d) => d.field === "updatedBy")?.after).toBe(JSON.stringify(MIGRATION_ACTOR));
    expect(diff.find((d) => d.field === "updatedAt")?.after).toBe("serverTimestamp()");
    expect(diff.find((d) => d.field === "areaIds")?.after).toBe("[]");
    expect(diff.find((d) => d.field === "baseRole")?.before).toBe("(sin campo)");
  });

  it("v1 o rol inválido → sin diff", () => {
    const v1 = { ...legacy, accessSchemaVersion: 1, areaIds: ["jovenes"] };
    expect(fieldDiff(planAccessMigration("u", v1, { pastorHome: "finance" }), v1)).toEqual([]);
    const bad = { ...legacy, role: "member" };
    expect(fieldDiff(planAccessMigration("u", bad, { pastorHome: "finance" }), bad)).toEqual([]);
  });

  it("la salida enmascara el correo y muestra estado, permisos efectivos, áreas y advertencias", () => {
    const leader = { ...legacy, role: "leader", active: false };
    const row = planAccessMigration("u-lider", leader, { pastorHome: "finance" });
    const text = formatRow(row, fieldDiff(row, leader));
    expect(text).not.toContain("ana.perez@ejemplo.cl");
    expect(text).toContain("a***@e***.cl");
    expect(text).toMatch(/estado\s+migrate/);
    // Inactivo: sin permisos efectivos hasta reactivarlo.
    expect(text).toMatch(/efectivos\s+—/);
    const active = { ...leader, active: true };
    const activeRow = planAccessMigration("u-lider", active, { pastorHome: "finance" });
    expect(formatRow(activeRow, fieldDiff(activeRow, active))).toMatch(
      /efectivos\s+finance.summary.read, calendar.read, calendar.events.manage_assigned/,
    );
    expect(text).toMatch(/áreas\s+\[\]/);
    expect(text).toContain("Líder sin áreas");
    expect(text).toContain("Usuario inactivo");
  });

  it("summarize cuenta por estado", () => {
    const rows = [
      planAccessMigration("a", legacy, { pastorHome: "finance" }),
      planAccessMigration("b", { ...legacy, accessSchemaVersion: 1 }, { pastorHome: "finance" }),
      planAccessMigration("c", { ...legacy, role: "x" }, { pastorHome: "finance" }),
    ];
    expect(summarize(rows)).toEqual({ total: 3, migrate: 1, skip_already_v1: 1, skip_invalid_role: 1 });
  });
});
