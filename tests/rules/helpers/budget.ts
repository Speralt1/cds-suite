// Expression-budget harness for Firestore Rules (emulator only, fictitious data).
//
// Firestore evaluates at most 1000 expressions per request. A financial
// client write is ONE commit request that writes the movement, its monthly
// summary(ies) and, for tithes, the attribution; every document's rule counts
// toward the same 1000. To measure how much room a request has left, a copy
// of the rules gets N padding terms injected at a point that is evaluated
// exactly once per request, and N is raised until the request is denied:
//
//   - finance commits: `providerOwnedFinanceTransaction(id)`, called once by
//     the financeTransactions create/update rule (one movement per commit);
//   - finance settings: `validFinanceSettings(d)`, called once by the
//     appSettings/finance update rule.
//
// Each padding term is `request.auth.uid != 'pN'`. Its cost in expressions is
// calibrated on an isolated `zzcal` rule that only evaluates the padding, so
// margins are reported in expressions (`terms × cost`), not in terms.
// The padding exists ONLY in the in-memory rules given to the emulator; it is
// never written to firestore.rules.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, Timestamp, type Firestore } from "firebase/firestore";
import { saveTransaction, voidTransaction } from "../../../lib/finance/transactions";
import { saveProfile } from "../../../lib/finance/profiles";
import { saveDailyCash } from "../../../lib/offerings/cash";
import { addFinanceCategory, initializeFinanceSettings } from "../../../lib/settings/finance-settings-client";
import type { FinanceTransaction, TransactionInput } from "../../../lib/finance/types";

export const EXPRESSION_LIMIT = 1000;

const PAD_FN = "zzBudgetPad";

function padFunctions(terms: number) {
  const chunks: string[] = [];
  for (let i = 0; i < terms; i += 40)
    chunks.push(Array.from({ length: Math.min(40, terms - i) }, (_, j) => `request.auth.uid != 'p${i + j}'`).join(" && "));
  const parts = chunks.map((c, k) => `    function ${PAD_FN}${k}() { return ${c}; }\n`).join("");
  const body = chunks.length ? chunks.map((_, k) => `${PAD_FN}${k}()`).join(" && ") : "true";
  return `${parts}    function ${PAD_FN}() { return ${body}; }\n`;
}

function inject(source: string, anchor: string, replacement: string) {
  if (source.split(anchor).length !== 2) throw new Error(`budget harness: anchor not found exactly once: ${anchor}`);
  return source.replace(anchor, replacement);
}

export type PadPoint = "transaction" | "summary" | "attribution";
/**
 * Rules with `terms` padding terms evaluated once in the rule of ONE document of a finance commit
 * (`at`: the movement, the monthly summary or the tithe attribution), plus the calibration rule.
 * If the limit were per request, every point would give the same margin; if it is per evaluated
 * document, each point measures that document's own room.
 */
export function paddedRules(source: string, terms: number, at: PadPoint = "transaction") {
  let r = inject(source, "    function signedIn()", padFunctions(terms) + "    function signedIn()");
  if (at === "transaction")
    r = inject(
      r,
      "function providerOwnedFinanceTransaction(id) { return id.matches('^sumup_.*'); }",
      `function providerOwnedFinanceTransaction(id) { return (${PAD_FN}() && false) || id.matches('^sumup_.*'); }`,
    );
  else if (at === "summary")
    r = inject(r, "      let change={'old':amounts(old,p),'next':amounts(next,p)};\n      return ", `      let change={'old':amounts(old,p),'next':amounts(next,p)};\n      return ${PAD_FN}() && `);
  else
    r = inject(r, "      return d.keys().hasOnly(['transactionId','profileId'", `      return ${PAD_FN}() && d.keys().hasOnly(['transactionId','profileId'`);
  r = inject(r, "function validFinanceSettings(d) {\n      return ", `function validFinanceSettings(d) {\n      return ${PAD_FN}() && `);
  r = inject(r, "    match /{document=**} {", `    match /zzcal/{id} { allow get: if ${PAD_FN}(); }\n    match /{document=**} {`);
  return r;
}

export function readRules(file = "firestore.rules") {
  return readFileSync(file, "utf8");
}

export async function envFor(rules: string): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({ projectId: "demo-cds-suite", firestore: { host: "127.0.0.1", port: 8080, rules } });
}

// ── Profiles ────────────────────────────────────────────────────────────────
const now = () => Timestamp.now();
function legacy(role: string, active = true) {
  return { displayName: role, email: `${role}@example.test`, role, active, createdAt: now() };
}
function v1(role: string, baseRole: string, permissions: string[], homeModule = "finance") {
  return {
    displayName: `v1 ${role}`, email: `v1-${role}@example.test`, role, active: true, createdAt: now(),
    baseRole, position: "", permissions, areaIds: [], homeModule, accessSchemaVersion: 1, updatedAt: now(), updatedBy: "seed",
  };
}
export const PROFILE_DOCS: Record<string, Record<string, unknown> | null> = {
  "legacy-admin": legacy("admin"),
  "legacy-pastor": legacy("pastor"),
  "legacy-finance": legacy("finance"),
  "legacy-leader": legacy("leader"),
  "v1-admin": v1("admin", "admin", []),
  "v1-records": v1("finance", "standard", ["finance.summary.read", "finance.details.read", "finance.records.manage", "calendar.read"]),
  "v1-readonly": v1("leader", "standard", ["finance.summary.read", "finance.details.read", "calendar.read"]),
  inactive: legacy("finance", false),
  "no-profile": null,
};
/** Profiles that may write finance records today (legacy) or by permission (v1). */
export const WRITERS = ["legacy-admin", "legacy-pastor", "legacy-finance", "v1-admin", "v1-records"];
export const SETTINGS_WRITERS = ["legacy-admin", "v1-admin"];

// ── Large, realistic data ────────────────────────────────────────────────────
const base: TransactionInput = { type: "income", amount: 10000, date: "2026-08-10", category: "Ofrendas", paymentMethod: "transfer", description: "Culto", note: "" };
const person = { type: "person" as const, displayName: "Persona", phone: "", email: "", members: "", active: true, pastoralContactAuthorized: true };
// Income categories stop at 98 so that "finance categories update" can still add one per settings writer.
const INCOME_CATEGORIES = 98;
const EXPENSE_CATEGORIES = 100;
export let LAST_INCOME = "";
export let LAST_EXPENSE = "";

/** Fills appSettings to 100/100 categories and both summaries (Aug, Sep) with every category and 31 days. */
async function heavy(db: Firestore) {
  const s = (await getDoc(doc(db, "appSettings", "finance"))).data()!;
  const extraI = Array.from({ length: INCOME_CATEGORIES - s.incomeCategoriesAll.length }, (_, i) => `Ingreso extra ${i}`);
  const extraE = Array.from({ length: EXPENSE_CATEGORIES - s.expenseCategoriesAll.length }, (_, i) => `Gasto extra ${i}`);
  LAST_INCOME = extraI[extraI.length - 1];
  LAST_EXPENSE = extraE[extraE.length - 1];
  const inc = [...s.incomeCategoriesAll, ...extraI];
  const exp = [...s.expenseCategoriesAll, ...extraE];
  await setDoc(doc(db, "appSettings", "finance"), { ...s, incomeCategoriesAll: inc, incomeCategoriesActive: inc, expenseCategoriesAll: exp, expenseCategoriesActive: exp });
  for (const p of ["2026-08", "2026-09"]) {
    const ref = doc(db, "financeMonthlySummaries", p);
    const sum = (await getDoc(ref)).data() ?? { incomeTotal: 0, expenseTotal: 0, titheTotal: 0, transactionCount: 0, incomeByCategory: {}, expenseByCategory: {}, dailyIncome: {}, dailyExpense: {} };
    const ibc: Record<string, number> = { ...sum.incomeByCategory };
    for (const c of inc) ibc[c] = (ibc[c] ?? 0) + 1000;
    const ebc: Record<string, number> = { ...sum.expenseByCategory };
    for (const c of exp) ebc[c] = (ebc[c] ?? 0) + 500;
    const di: Record<string, number> = { ...sum.dailyIncome };
    const de: Record<string, number> = { ...sum.dailyExpense };
    for (let d = 1; d <= 31; d++) { di[String(d)] = (di[String(d)] ?? 0) + 3000; de[String(d)] = (de[String(d)] ?? 0) + 1500; }
    // Keep every invariant: totals equal the maps' sums, counts consistent.
    const incomeTotal = Object.values(ibc).reduce((a, v) => a + v, 0);
    const expenseTotal = Object.values(ebc).reduce((a, v) => a + v, 0);
    await setDoc(ref, {
      ...sum,
      incomeByCategory: ibc, expenseByCategory: ebc, dailyIncome: di, dailyExpense: de,
      incomeTotal, expenseTotal, result: incomeTotal - expenseTotal,
      transactionCount: (sum.transactionCount ?? 0) + 400,
    });
  }
}

/** Seeds settings, per-profile movements to edit/void, tithe profile, and heavy data. Rules disabled. */
export async function seedBudget(env: RulesTestEnvironment, profiles = Object.keys(PROFILE_DOCS)) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (const p of profiles) if (PROFILE_DOCS[p]) await setDoc(doc(db, "users", p), PROFILE_DOCS[p]!);
    await setDoc(doc(db, "users", "seed"), legacy("finance"));
    await initializeFinanceSettings(db, "seed");
    await saveProfile(db, "seed", person, undefined, "tp1");
    for (const p of profiles) {
      await saveTransaction(db, "seed", `edit-${p}`, base);
      await saveTransaction(db, "seed", `cross-${p}`, base);
      await saveTransaction(db, "seed", `void-${p}`, base);
      await saveTransaction(db, "seed", `tithe-${p}`, { ...base, category: "Diezmos", description: "Diezmo" }, { profileId: "tp1", privateNote: "" });
      await saveTransaction(db, "seed", `tithecross-${p}`, { ...base, category: "Diezmos", description: "Diezmo" }, { profileId: "tp1", privateNote: "" });
      await saveDailyCash(db, "seed", p.length % 2 ? "offerings" : "cafeteria", `2026-08-${String(1 + (Object.keys(PROFILE_DOCS).indexOf(p) % 9)).padStart(2, "0")}`, 5000, "", undefined, []);
    }
    await heavy(db);
  });
}

async function tx(db: Firestore, id: string) {
  return { id, ...(await getDoc(doc(db, "financeTransactions", id))).data() } as FinanceTransaction;
}
function cashDate(p: string) {
  return `2026-08-${String(1 + (Object.keys(PROFILE_DOCS).indexOf(p) % 9)).padStart(2, "0")}`;
}
function cashArea(p: string) {
  return p.length % 2 ? "offerings" : "cafeteria";
}

export type BudgetOp = { profiles: string[]; run: (db: Firestore, uid: string) => Promise<unknown> };
/** Critical financial operations, run with the live client functions (full commits). */
export const BUDGET_OPS: Record<string, BudgetOp> = {
  "income create (existing month, 100 categories)": { profiles: WRITERS, run: (db, uid) => saveTransaction(db, uid, `inc-${uid}`, { ...base, category: LAST_INCOME }, { allowedCategories: [LAST_INCOME] }) },
  "expense create (existing month, 100 categories)": { profiles: WRITERS, run: (db, uid) => saveTransaction(db, uid, `exp-${uid}`, { ...base, type: "expense", category: LAST_EXPENSE, amount: 2000 }, { allowedCategories: [LAST_EXPENSE] }) },
  "income create (new month, no summary)": { profiles: WRITERS, run: (db, uid) => saveTransaction(db, uid, `new-${uid}`, { ...base, date: "2026-11-05" }) },
  "cash create (saveDailyCash)": { profiles: WRITERS, run: (db, uid) => saveDailyCash(db, uid, "offerings", `2026-08-${20 + Object.keys(PROFILE_DOCS).indexOf(uid)}`, 5000, "", undefined, []) },
  "cash update existing": { profiles: WRITERS, run: async (db, uid) => saveDailyCash(db, uid, cashArea(uid), cashDate(uid), 7000, "Corregido", await tx(db, `cash_${cashArea(uid)}_${cashDate(uid)}`), []) },
  "tithe create (+attribution)": { profiles: WRITERS, run: (db, uid) => saveTransaction(db, uid, `tc-${uid}`, { ...base, category: "Diezmos", description: "Diezmo" }, { profileId: "tp1", privateNote: "" }) },
  "tithe update amount": { profiles: WRITERS, run: async (db, uid) => saveTransaction(db, uid, `tithe-${uid}`, { ...base, category: "Diezmos", description: "Diezmo", amount: 12000 }, { existing: await tx(db, `tithe-${uid}`) }) },
  "tithe move to another period": { profiles: WRITERS, run: async (db, uid) => saveTransaction(db, uid, `tithecross-${uid}`, { ...base, category: "Diezmos", description: "Diezmo", date: "2026-09-02" }, { existing: await tx(db, `tithecross-${uid}`) }) },
  "edit (same period)": { profiles: WRITERS, run: async (db, uid) => saveTransaction(db, uid, `edit-${uid}`, { ...base, amount: 12000, category: LAST_INCOME }, { existing: await tx(db, `edit-${uid}`), allowedCategories: ["Ofrendas", LAST_INCOME] }) },
  "move to another period": { profiles: WRITERS, run: async (db, uid) => saveTransaction(db, uid, `cross-${uid}`, { ...base, date: "2026-09-03", category: LAST_INCOME }, { existing: await tx(db, `cross-${uid}`), allowedCategories: ["Ofrendas", LAST_INCOME] }) },
  "void": { profiles: WRITERS, run: async (db, uid) => voidTransaction(db, uid, await tx(db, `void-${uid}`), "Registro duplicado") },
  "finance categories update": { profiles: SETTINGS_WRITERS, run: (db, uid) => addFinanceCategory(db, uid, "income", `Nueva ${uid}`) },
};

/** Calibration: an isolated read whose rule evaluates only the padding. */
export async function calibrationGet(env: RulesTestEnvironment) {
  const db = env.authenticatedContext("legacy-admin").firestore() as unknown as Firestore;
  return getDoc(doc(db, "zzcal", "x"));
}

export function isDenied(error: unknown) {
  const code = (error as { code?: string }).code ?? "";
  return code === "permission-denied" || /PERMISSION_DENIED/.test(String(error));
}
