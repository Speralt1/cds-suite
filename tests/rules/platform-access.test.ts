// Reglas de acceso de Platform Core V1 (18a §B/§C.1/§D.1–D.2/§J.3): fallback legacy,
// paridad financiera v1 ↔ legacy, escalada de privilegios en users. Solo emulador.
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saveTransaction } from "../../lib/finance/transactions";
import { addFollowup, saveProfile } from "../../lib/finance/profiles";
import type { TransactionInput } from "../../lib/finance/types";
import { LEGACY_ROLE_ACCESS } from "../../lib/shared/access";
import {
  FALLBACK_EXPENSE_CATEGORIES,
  FALLBACK_INCOME_CATEGORIES,
} from "../../lib/settings/finance-settings";
import {
  allowed,
  createRulesEnv,
  dbOf,
  LEGACY_PERMS,
  P,
  seedBase,
  USERS,
} from "./helpers/platform-fixtures";

let env: RulesTestEnvironment;

const input: TransactionInput = {
  type: "income",
  amount: 10000,
  date: "2026-08-10",
  category: "Ofrendas",
  paymentMethod: "cash",
  description: "Culto domingo",
  note: "",
};

beforeAll(async () => {
  env = await createRulesEnv();
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedBase(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    await setDoc(doc(db, "financeTransactions", "seed-tx"), { type: "income", amount: 1000, period: "2026-07" });
    await setDoc(doc(db, "financeMonthlySummaries", "2026-07"), { incomeTotal: 1000, updatedAt: now });
    await setDoc(doc(db, "pastoralFollowups", "seed-note"), { profileId: "p", note: "x" });
    await setDoc(doc(db, "titheProfiles", "seed-profile"), { displayName: "x" });
    await setDoc(doc(db, "appSettings", "finance"), { schemaVersion: 1 });
    await setDoc(doc(db, "sumupSyncRuns", "seed-run"), { ok: true });
    await setDoc(doc(db, "fundraisingCampaigns", "seed-campaign"), { slug: "seed-campaign" });
  });
});

/** Actualización v1 completa (lo que escribe la UI nueva), salvo createdAt/email. */
function v1Patch(actor: string, o: DocumentData = {}): DocumentData {
  return {
    displayName: "Usuario",
    role: "leader",
    active: true,
    baseRole: "standard",
    position: "Líder",
    permissions: LEGACY_PERMS.leader,
    areaIds: ["jovenes"],
    homeModule: "calendar",
    accessSchemaVersion: 1,
    updatedAt: serverTimestamp(),
    updatedBy: actor,
    ...o,
  };
}

function newV1User(actor: string, uid: string, o: DocumentData = {}): DocumentData {
  return {
    email: `${uid}@cds.test`,
    createdAt: serverTimestamp(),
    ...v1Patch(actor, { displayName: uid }),
    ...o,
  };
}

// ── 1. Paridad financiera: v1 ≡ legacy, bit a bit ──────────────────────────
const READ_OPS: Record<string, (uid: string) => Promise<unknown>> = {
  "financeTransactions get": (u) => getDoc(doc(dbOf(env, u), "financeTransactions", "seed-tx")),
  "financeTransactions list": (u) => getDocs(collection(dbOf(env, u), "financeTransactions")),
  "financeMonthlySummaries get": (u) => getDoc(doc(dbOf(env, u), "financeMonthlySummaries", "2026-07")),
  "pastoralFollowups get": (u) => getDoc(doc(dbOf(env, u), "pastoralFollowups", "seed-note")),
  "titheProfiles get": (u) => getDoc(doc(dbOf(env, u), "titheProfiles", "seed-profile")),
  "appSettings get": (u) => getDoc(doc(dbOf(env, u), "appSettings", "finance")),
  "sumupSyncRuns get": (u) => getDoc(doc(dbOf(env, u), "sumupSyncRuns", "seed-run")),
  "fundraisingCampaigns get": (u) => getDoc(doc(dbOf(env, u), "fundraisingCampaigns", "seed-campaign")),
  "users list": (u) => getDocs(collection(dbOf(env, u), "users")),
  "users get ajeno": (u) => getDoc(doc(dbOf(env, u), "users", "v1-none")),
};

// Resultado esperado hoy (18a §B.3) para cada operación y rol legacy.
const EXPECTED: Record<string, Record<string, boolean>> = {
  admin: Object.fromEntries(Object.keys(READ_OPS).map((k) => [k, true])),
  pastor: Object.fromEntries(Object.keys(READ_OPS).map((k) => [k, !k.startsWith("users")])),
  finance: Object.fromEntries(
    Object.keys(READ_OPS).map((k) => [k, !k.startsWith("users") && !k.startsWith("pastoral")]),
  ),
  leader: Object.fromEntries(
    Object.keys(READ_OPS).map((k) => [k, k === "financeMonthlySummaries get"]),
  ),
  inactive: Object.fromEntries(Object.keys(READ_OPS).map((k) => [k, false])),
};

const PAIRS: [string, string][] = [
  ["admin", "v1-admin"],
  ["pastor", "v1-pastor"],
  ["finance", "v1-finance"],
  ["leader", "v1-leader"],
  ["leader", "v1-leader-jovenes"],
  ["inactive", "v1-inactive"],
];

describe("Paridad financiera v1 ↔ legacy", () => {
  it.each(PAIRS)("lecturas: %s (legacy) ≡ %s (v1) ≡ comportamiento actual", async (legacy, v1) => {
    const got: Record<string, [boolean, boolean]> = {};
    for (const [name, op] of Object.entries(READ_OPS))
      got[name] = [await allowed(() => op(legacy)), await allowed(() => op(v1))];
    for (const [name, [l, v]] of Object.entries(got)) {
      expect({ op: name, legacy: l }).toEqual({ op: name, legacy: EXPECTED[legacy][name] });
      expect({ op: name, v1: v }).toEqual({ op: name, v1: l });
    }
  });

  it.each(PAIRS)("escritura de movimientos: %s (legacy) ≡ %s (v1)", async (legacy, v1) => {
    const l = await allowed(() => saveTransaction(dbOf(env, legacy), legacy, "tx-legacy", input));
    const v = await allowed(() => saveTransaction(dbOf(env, v1), v1, "tx-v1", input));
    expect(l).toBe(["admin", "pastor", "finance"].includes(legacy));
    expect(v).toBe(l);
  });

  it.each(PAIRS)("seguimiento pastoral: %s (legacy) ≡ %s (v1)", async (legacy, v1) => {
    await saveProfile(dbOf(env, "finance"), "finance", {
      type: "person",
      displayName: "Persona de prueba",
      phone: "",
      email: "",
      members: "",
      active: true,
      pastoralContactAuthorized: true,
    }, undefined, "person");
    const note = { date: "2026-08-10", note: "Acompañamiento", status: "pending" as const, nextFollowUpDate: "" };
    const l = await allowed(() => addFollowup(dbOf(env, legacy), legacy, "person", note, "n-legacy"));
    const v = await allowed(() => addFollowup(dbOf(env, v1), v1, "person", note, "n-v1"));
    expect(l).toBe(["admin", "pastor"].includes(legacy));
    expect(v).toBe(l);
  });

  it("appSettings: solo admin (legacy o v1) escribe; v1-pastor y v1-finance no", async () => {
    const settings = (uid: string) => ({
      schemaVersion: 1,
      incomeCategoriesAll: FALLBACK_INCOME_CATEGORIES,
      incomeCategoriesActive: FALLBACK_INCOME_CATEGORIES,
      expenseCategoriesAll: FALLBACK_EXPENSE_CATEGORIES,
      expenseCategoriesActive: FALLBACK_EXPENSE_CATEGORIES,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    await env.withSecurityRulesDisabled(async (ctx) => deleteDoc(doc(ctx.firestore(), "appSettings", "finance")));
    await assertSucceeds(setDoc(doc(dbOf(env, "v1-admin"), "appSettings", "finance"), settings("v1-admin")));
    for (const uid of ["v1-pastor", "v1-finance", "v1-leader-jovenes", "pastor", "inactive", "v1-inactive"])
      await assertFails(setDoc(doc(dbOf(env, uid), "appSettings", "finance"), settings(uid)));
  });

  it("un usuario v1 solo con calendar.read no ve nada de Finanzas", async () => {
    for (const [name, op] of Object.entries(READ_OPS))
      expect({ op: name, ok: await allowed(() => op("v1-reader")) }).toEqual({ op: name, ok: false });
    await assertFails(saveTransaction(dbOf(env, "v1-reader"), "v1-reader", "tx", input));
  });

  it("settings.manage guardado en permissions (vía Admin SDK) no otorga nada", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", "forged"), {
        ...USERS["v1-none"],
        displayName: "forged",
        permissions: ["settings.manage"],
      });
    });
    await assertFails(getDocs(collection(dbOf(env, "forged"), "users")));
    await assertFails(getDoc(doc(dbOf(env, "forged"), "financeMonthlySummaries", "2026-07")));
  });

  it("anónimo y usuario sin documento no acceden", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "financeMonthlySummaries", "2026-07")));
    await assertFails(getDoc(doc(dbOf(env, "missing"), "financeMonthlySummaries", "2026-07")));
    await assertFails(getDoc(doc(dbOf(env, "missing"), "areas", "jovenes")));
  });
});

// ── 2. users/{uid}: forma v1, escalada, IDOR, auto-protección ───────────────
describe("users v1", () => {
  it("el admin (legacy y v1) crea un usuario v1 y promueve un legacy a v1", async () => {
    await assertSucceeds(setDoc(doc(dbOf(env, "v1-admin"), "users", "nuevo"), newV1User("v1-admin", "nuevo")));
    await assertSucceeds(setDoc(doc(dbOf(env, "admin"), "users", "nuevo2"), newV1User("admin", "nuevo2")));
    // promoción legacy → v1 (leader con área)
    await assertSucceeds(updateDoc(doc(dbOf(env, "admin"), "users", "leader"), v1Patch("admin")));
    // promoción del pastor con el mapeo exacto
    await assertSucceeds(updateDoc(doc(dbOf(env, "v1-admin"), "users", "pastor"), v1Patch("v1-admin", {
      role: "pastor", position: "Pastor", permissions: LEGACY_PERMS.pastor, areaIds: [], homeModule: "finance",
    })));
    // edición v1 → v1 (agrega publicar)
    await assertSucceeds(updateDoc(doc(dbOf(env, "v1-admin"), "users", "v1-leader-jovenes"), v1Patch("v1-admin", {
      permissions: [...LEGACY_PERMS.leader, P.publish],
    })));
    // desactivar escribe el payload v1 completo
    await assertSucceeds(updateDoc(doc(dbOf(env, "v1-admin"), "users", "v1-finance"), v1Patch("v1-admin", {
      role: "finance", permissions: LEGACY_PERMS.finance, areaIds: [], homeModule: "finance", active: false,
    })));
  });

  it("la edición legacy del admin sigue funcionando (comportamiento existente)", async () => {
    await assertSucceeds(updateDoc(doc(dbOf(env, "admin"), "users", "finance"), {
      displayName: "Finanzas actualizado", role: "leader", active: false,
    }));
    await assertSucceeds(setDoc(doc(dbOf(env, "admin"), "users", "legacy-new"), {
      displayName: "Nuevo", email: "nuevo@cds.test", role: "finance", active: true, createdAt: serverTimestamp(),
    }));
  });

  it("un líder no puede editar sus propios permisos, áreas, rol base, rol ni módulo inicial", async () => {
    const me = "v1-leader-jovenes";
    const ref = doc(dbOf(env, me), "users", me);
    const meta = { updatedAt: serverTimestamp(), updatedBy: me };
    await assertFails(updateDoc(ref, { permissions: [...LEGACY_PERMS.leader, P.manageAll], ...meta }));
    await assertFails(updateDoc(ref, { areaIds: ["jovenes", "alabanza"], ...meta }));
    await assertFails(updateDoc(ref, { baseRole: "admin", role: "admin", ...meta }));
    await assertFails(updateDoc(ref, { role: "pastor", ...meta }));
    await assertFails(updateDoc(ref, { homeModule: "finance", ...meta }));
    await assertFails(updateDoc(ref, v1Patch(me, { permissions: [...LEGACY_PERMS.leader, P.publish] })));
    // legacy
    await assertFails(updateDoc(doc(dbOf(env, "leader"), "users", "leader"), { role: "admin" }));
    await assertFails(updateDoc(doc(dbOf(env, "leader"), "users", "leader"), v1Patch("leader", { baseRole: "admin", role: "admin", permissions: [] })));
    // pastor (manage_all + finanzas) tampoco administra usuarios
    await assertFails(updateDoc(doc(dbOf(env, "v1-pastor"), "users", "v1-pastor"), v1Patch("v1-pastor", { baseRole: "admin", role: "admin", permissions: [] })));
  });

  it("IDOR: un líder no lee, no lista ni edita a otros usuarios; sí lee su propio doc", async () => {
    const leader = dbOf(env, "v1-leader-jovenes");
    await assertSucceeds(getDoc(doc(leader, "users", "v1-leader-jovenes")));
    await assertFails(getDoc(doc(leader, "users", "v1-finance")));
    await assertFails(getDoc(doc(leader, "users", "admin")));
    await assertFails(getDocs(collection(leader, "users")));
    await assertFails(updateDoc(doc(leader, "users", "v1-leader"), v1Patch("v1-leader-jovenes")));
    await assertFails(setDoc(doc(leader, "users", "intruso"), newV1User("v1-leader-jovenes", "intruso")));
    await assertFails(getDoc(doc(dbOf(env, "leader"), "users", "pastor")));
    await assertFails(getDocs(collection(dbOf(env, "pastor"), "users")));
    // el inactivo lee su propio doc (pantalla de cuenta desactivada) pero no administra
    await assertSucceeds(getDoc(doc(dbOf(env, "inactive"), "users", "inactive")));
    await assertFails(getDocs(collection(dbOf(env, "inactive"), "users")));
    await assertFails(updateDoc(doc(dbOf(env, "inactive"), "users", "leader"), v1Patch("inactive")));
  });

  it("asignación masiva: campos desconocidos se rechazan (v1 y legacy)", async () => {
    const admin = dbOf(env, "v1-admin");
    await assertFails(updateDoc(doc(admin, "users", "leader"), v1Patch("v1-admin", { isSuperAdmin: true })));
    await assertFails(updateDoc(doc(admin, "users", "finance"), { isSuperAdmin: true }));
    await assertFails(setDoc(doc(admin, "users", "x"), newV1User("v1-admin", "x", { customClaims: { admin: true } })));
  });

  it("permissions: settings.manage, desconocidos, duplicados y exceso se rechazan", async () => {
    const ref = doc(dbOf(env, "v1-admin"), "users", "leader");
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { permissions: [...LEGACY_PERMS.leader, "settings.manage"] })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { permissions: [...LEGACY_PERMS.leader, "finance.everything"] })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { permissions: [P.calRead, P.calRead] })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { permissions: "calendar.read" })));
    await assertFails(setDoc(doc(dbOf(env, "v1-admin"), "users", "y"), newV1User("v1-admin", "y", {
      baseRole: "admin", role: "admin", permissions: ["settings.manage"],
    })));
  });

  it("areaIds, homeModule, position y accessSchemaVersion se validan", async () => {
    const ref = doc(dbOf(env, "v1-admin"), "users", "leader");
    const many = Array.from({ length: 21 }, (_, i) => `area-${i}`);
    await assertSucceeds(updateDoc(ref, v1Patch("v1-admin", { areaIds: many.slice(0, 20) })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { areaIds: many })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { areaIds: [123] })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { areaIds: ["Jóvenes"] })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { areaIds: ["jovenes", "jovenes"] })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { homeModule: "reports" })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { homeModule: "settings" })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { position: "x".repeat(61) })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { accessSchemaVersion: 2 })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { baseRole: "superadmin" })));
  });

  it("role debe ser coherente con baseRole y con deriveLegacyRole", async () => {
    const ref = doc(dbOf(env, "v1-admin"), "users", "leader");
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { baseRole: "admin", role: "pastor", permissions: LEGACY_PERMS.pastor })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { baseRole: "standard", role: "admin" })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { role: "finance", permissions: LEGACY_PERMS.pastor })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { role: "leader", permissions: LEGACY_PERMS.finance })));
    await assertFails(updateDoc(ref, v1Patch("v1-admin", { role: "pastor", permissions: LEGACY_PERMS.leader })));
    // coherentes
    await assertSucceeds(updateDoc(ref, v1Patch("v1-admin", { role: "finance", permissions: [P.records] })));
    await assertSucceeds(updateDoc(ref, v1Patch("v1-admin", { role: "leader", permissions: [P.pastoral, P.calRead] })));
    await assertSucceeds(updateDoc(ref, v1Patch("v1-admin", { baseRole: "admin", role: "admin", permissions: [] })));
  });

  it("auditoría v1: updatedAt == request.time y updatedBy == actor; sin downgrade a legacy", async () => {
    const admin = dbOf(env, "v1-admin");
    await assertFails(updateDoc(doc(admin, "users", "leader"), v1Patch("v1-admin", { updatedAt: Timestamp.now() })));
    await assertFails(updateDoc(doc(admin, "users", "leader"), v1Patch("v1-admin", { updatedBy: "otro" })));
    // downgrade v1 → legacy
    const stored = USERS["v1-finance"];
    await assertFails(setDoc(doc(admin, "users", "v1-finance"), {
      displayName: stored.displayName, email: stored.email, role: "finance", active: true, createdAt: stored.createdAt,
    }));
  });

  it("createdAt y email son inmutables", async () => {
    const admin = dbOf(env, "v1-admin");
    await assertFails(updateDoc(doc(admin, "users", "v1-finance"), v1Patch("v1-admin", {
      role: "finance", permissions: LEGACY_PERMS.finance, createdAt: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")),
    })));
    await assertFails(updateDoc(doc(admin, "users", "v1-finance"), v1Patch("v1-admin", {
      role: "finance", permissions: LEGACY_PERMS.finance, email: "otro@cds.test",
    })));
    await assertFails(updateDoc(doc(dbOf(env, "admin"), "users", "finance"), { email: "otro@cds.test" }));
  });

  it("auto-protección: el admin no se degrada ni se desactiva (legacy y v1)", async () => {
    const v1 = doc(dbOf(env, "v1-admin"), "users", "v1-admin");
    const adminPatch = { baseRole: "admin", role: "admin", permissions: [], areaIds: [], homeModule: "finance" };
    await assertSucceeds(updateDoc(v1, v1Patch("v1-admin", { ...adminPatch, displayName: "Admin v1" })));
    await assertFails(updateDoc(v1, v1Patch("v1-admin", { baseRole: "standard", role: "pastor", permissions: LEGACY_PERMS.pastor })));
    await assertFails(updateDoc(v1, v1Patch("v1-admin", { ...adminPatch, active: false })));
    const legacy = doc(dbOf(env, "admin"), "users", "admin");
    await assertFails(updateDoc(legacy, { role: "finance" }));
    await assertFails(updateDoc(legacy, { active: false }));
    await assertFails(updateDoc(legacy, v1Patch("admin", { role: "pastor", permissions: LEGACY_PERMS.pastor })));
    await assertSucceeds(updateDoc(legacy, v1Patch("admin", adminPatch)));
    // un admin sí puede degradar a OTRO admin (queda él como admin)
    await assertSucceeds(updateDoc(doc(dbOf(env, "admin"), "users", "v1-admin"), v1Patch("admin", {
      role: "pastor", permissions: LEGACY_PERMS.pastor, areaIds: [], homeModule: "finance",
    })));
  });

  it("nadie borra usuarios", async () => {
    await assertFails(deleteDoc(doc(dbOf(env, "admin"), "users", "leader")));
    await assertFails(deleteDoc(doc(dbOf(env, "v1-admin"), "users", "v1-leader")));
  });
});

// ── 3. Paridad del texto de las reglas: helpers con literal ≡ implicants() ──
describe("firestore.rules: tablas de acceso", () => {
  const rules = readFileSync("firestore.rules", "utf8");
  const list = (src: string) => [...src.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const body = (name: string) => {
    const m = rules.match(new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n?\\s*\\}\\n`));
    if (!m) throw new Error(`no existe ${name}()`);
    return m[1];
  };
  const implicants: Record<string, string[]> = {};
  for (const m of body("implicants").matchAll(/'([^']+)':\s*\[([^\]]*)\]/g)) implicants[m[1]] = list(m[2]);

  it("implicants() es el cierre de IMPLIES (18a §B.2)", () => {
    expect(implicants).toEqual({
      [P.summary]: [P.summary, P.details, P.records, P.pastoral],
      [P.details]: [P.details, P.records, P.pastoral],
      [P.records]: [P.records],
      [P.pastoral]: [P.pastoral],
      [P.calRead]: [P.calRead, P.manageAssigned, P.manageAll, P.publish],
      [P.manageAssigned]: [P.manageAssigned, P.manageAll],
      [P.manageAll]: [P.manageAll],
      [P.publish]: [P.publish],
      "settings.manage": [],
    });
  });

  // gate(ps, legacyRoles): ps = implicants()[p]; legacyRoles = admin + roles legacy cuyo
  // legacyPermissions() corta ps. Así la evaluación rápida ≡ can(p) con la tabla canónica.
  const ROLE_ORDER = ["admin", "pastor", "finance", "leader"] as const;
  const legacyHolders = (ps: string[]) =>
    ROLE_ORDER.filter((r) => r === "admin" || (LEGACY_PERMS[r as keyof typeof LEGACY_PERMS] ?? []).some((x) => ps.includes(x)));
  const gates = (fn: string) =>
    [...body(fn).matchAll(/gate\(\[([^\]]*)\], \[([^\]]*)\]\)/g)].map((m) => ({ ps: list(m[1]), roles: list(m[2]) }));

  it.each([
    ["financeSummaryRead", P.summary],
    ["financeDetailsRead", P.details],
    ["financeRecordsManage", P.records],
    ["financePastoralManage", P.pastoral],
    ["calendarRead", P.calRead],
    ["calendarManageAll", P.manageAll],
    ["settingsManage", "settings.manage"],
  ])("%s() ≡ can('%s') (implicantes y roles legacy)", (fn, perm) => {
    const g = gates(fn);
    expect(g).toHaveLength(1);
    expect(g[0].ps).toEqual(implicants[perm]);
    expect(g[0].roles).toEqual(legacyHolders(implicants[perm]));
  });

  it("por área (solo v1, legacy no tiene áreas): managedAreasOf/publishAreaOf usan los implicantes", () => {
    const perms = (fn: string) => {
      const m = body(fn).match(/u\.permissions\.hasAny\(\[([^\]]*)\]\)/);
      if (!m) throw new Error(`${fn} sin permissions.hasAny`);
      return list(m[1]);
    };
    expect(perms("managedAreasOf")).toEqual(implicants[P.manageAssigned]);
    expect(perms("publishAreaOf")).toEqual(implicants[P.publish]);
    expect(body("calendarManageAssigned")).toContain("calendarManageAll()");
    expect(body("manageAllOf")).toContain(`gateProfile(u, ['${P.manageAll}'], ['admin','pastor'])`);
  });

  it("legacyPermissions() coincide con LEGACY_ROLE_ACCESS (18a §B.2)", () => {
    const src = body("legacyPermissions");
    const table: Record<string, string[]> = {};
    for (const m of src.matchAll(/r == '(\w+)' \? \[([^\]]*)\]/g)) table[m[1]] = list(m[2]);
    expect(table).toEqual(LEGACY_PERMS);
  });

  it("legacyPermissions() coincide con LEGACY_ROLE_ACCESS importado de lib/shared (fuente única)", () => {
    const src = body("legacyPermissions");
    const table: Record<string, string[]> = {};
    for (const m of src.matchAll(/r == '(\w+)' \? \[([^\]]*)\]/g)) table[m[1]] = list(m[2]);
    // admin no figura en la tabla: lo resuelve isAdminUser() (permisos vacíos + baseRole admin).
    expect(LEGACY_ROLE_ACCESS.admin).toMatchObject({ baseRole: "admin", permissions: [] });
    const expected = Object.fromEntries(
      Object.entries(LEGACY_ROLE_ACCESS)
        .filter(([role]) => role !== "admin")
        .map(([role, access]) => [role, [...access.permissions]]),
    );
    expect(table).toEqual(expected);
  });

  it("el catálogo almacenable no incluye settings.manage", () => {
    const catalog = list(body("permissionCatalogNoSettings"));
    expect(catalog).toEqual([P.summary, P.details, P.records, P.pastoral, P.calRead, P.manageAssigned, P.manageAll, P.publish]);
  });

  it("ya no quedan los helpers financieros por rol", () => {
    for (const legacy of ["details()", "pastoral()", "approved()", "role()"])
      expect(rules.includes(` ${legacy}`)).toBe(false);
  });
});
