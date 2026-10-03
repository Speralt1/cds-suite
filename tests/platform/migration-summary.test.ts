// @vitest-environment node
// `--summary` de scripts/migrate-access-v1.mjs (doc 20 §10): agregado sin datos
// personales para revisar el dry-run de producción, y detector del caveat de
// rollback (doc 20 §14).
import { describe, expect, it } from "vitest";
import { planAccessMigration } from "@/lib/shared/access";
import { aggregateReport, formatAggregate, parseMigrationArgs } from "../../scripts/migrate-access-v1.mjs";

const EMU = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" };

type Doc = Record<string, unknown>;
const v1 = (role: string, permissions: string[], extra: Doc = {}): Doc => ({
  role,
  active: true,
  accessSchemaVersion: 1,
  baseRole: "standard",
  position: "Líder",
  permissions,
  areaIds: [],
  homeModule: "calendar",
  ...extra,
});

const DOCS: [string, Doc][] = [
  ["u-admin", { displayName: "Ana Admin", email: "ana.admin@ejemplo.cl", role: "admin", active: true }],
  ["u-pastor", { displayName: "Pablo Pastor", email: "pablo@ejemplo.cl", role: "pastor", active: true }],
  ["u-fin", { displayName: "Fernanda Finanzas", email: "fer@ejemplo.cl", role: "finance", active: true }],
  ["u-lider", { displayName: "Luis Líder", email: "luis@ejemplo.cl", role: "leader", active: true }],
  ["u-lider-off", { displayName: "Laura Inactiva", email: "laura@ejemplo.cl", role: "leader", active: false }],
  ["u-raro", { displayName: "Rita Rara", email: "rita@ejemplo.cl", role: "superuser", active: true }],
  // v1 sin finanzas: su role derivado (leader) da el resumen en las reglas legacy → riesgo de rollback
  ["u-v1-cal", { displayName: "Carla Calendario", email: "carla@ejemplo.cl", ...v1("leader", ["calendar.read"]) }],
  // v1 sin ningún permiso: sin módulos y con riesgo de rollback
  ["u-v1-nada", { displayName: "Nadia Nada", email: "nadia@ejemplo.cl", ...v1("leader", []) }],
  // v1 líder igual al legacy, con áreas: sin riesgo
  ["u-v1-ok", { displayName: "Óscar Ok", email: "oscar@ejemplo.cl", ...v1("leader", ["finance.summary.read", "calendar.read", "calendar.events.manage_assigned"], { areaIds: ["jovenes"] }) }],
  // v1 que publica sin áreas: requiere asignación
  ["u-v1-pub", { displayName: "Pía Publica", email: "pia@ejemplo.cl", ...v1("leader", ["finance.summary.read", "calendar.events.publish_assigned"]) }],
  // v1 admin: sin riesgo
  ["u-v1-admin", { displayName: "Alba Admin", email: "alba@ejemplo.cl", ...v1("admin", [], { baseRole: "admin", homeModule: "finance" }) }],
];

const entries = DOCS.map(([uid, doc]) => ({ row: planAccessMigration(uid, doc, { pastorHome: "finance" }), doc }));

describe("parseMigrationArgs --summary", () => {
  it("se acepta con el emulador y con un proyecto real (sigue siendo dry run)", () => {
    expect(parseMigrationArgs(["--summary"], EMU)).toMatchObject({ summary: true, apply: false, mode: "emulator" });
    expect(parseMigrationArgs(["--project", "cds-x", "--summary"], {})).toMatchObject({ summary: true, apply: false, mode: "project", requiresTty: false });
    expect(parseMigrationArgs([], EMU).summary).toBe(false);
  });
});

describe("aggregateReport", () => {
  const report = aggregateReport(entries);

  it("conteos por estado, rol anterior, actividad y módulo inicial", () => {
    expect(report.total).toBe(11);
    expect(report.byStatus).toEqual({ migrate: 5, skip_already_v1: 5, skip_invalid_role: 1 });
    expect(report.byOldRole).toEqual({ admin: 2, pastor: 1, finance: 1, leader: 6, "(rol inválido)": 1 });
    expect(report.active).toBe(10);
    expect(report.inactive).toBe(1);
    expect(report.byHomeModule).toEqual({ finance: 4, calendar: 6 });
  });

  it("advertencias agrupadas por tipo, sin el valor del rol inválido", () => {
    expect(Object.keys(report.warnings).sort()).toEqual(
      ["Líder sin áreas: solo verá el calendario hasta que se le asignen", "Rol no válido", "Usuario inactivo: no tendrá acceso hasta que se reactive"].sort(),
    );
    expect(report.warnings["Rol no válido"]).toBe(1);
  });

  it("activos sin módulos, que requieren áreas y con riesgo de rollback", () => {
    expect(report.withoutModules).toBe(1); // u-v1-nada (la inactiva no cuenta)
    expect(report.needsAreas).toBe(2); // u-lider (migrado sin áreas) y u-v1-pub; manage_all (pastor, admin) no las necesita
    expect(report.rollbackRisk).toBe(2); // u-v1-cal, u-v1-nada
  });

  it("un v1 inactivo no cuenta como riesgo (ni legacy ni v1 le dan acceso)", () => {
    const off = aggregateReport([{ row: planAccessMigration("x", v1("leader", [], { active: false }), { pastorHome: "finance" }), doc: v1("leader", [], { active: false }) }]);
    expect(off.rollbackRisk).toBe(0);
    expect(off.withoutModules).toBe(0);
  });
});

describe("formatAggregate", () => {
  it("no contiene uid, nombre ni correo (ni enmascarado)", () => {
    const text = formatAggregate(aggregateReport(entries));
    for (const [uid, doc] of DOCS) {
      expect(text).not.toContain(uid);
      expect(text).not.toContain(String(doc.displayName));
      expect(text).not.toContain(String(doc.email));
    }
    expect(text).not.toContain("@");
    expect(text).not.toContain("superuser");
    expect(text).toContain("v1 con riesgo de rollback     2");
  });
});
