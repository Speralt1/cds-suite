// The expression-budget optimizations of firestore.rules must not change any
// decision. Each optimized helper is compared, inside the emulator, with the
// original formulation over edge cases (temporary test rules only).
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, deleteDoc, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ORIGINAL = `
    function zzOrigMapValid(before,after,change,kind,field) {
      let a=change.old[field]; let b=change.next[field];
      let removed=change.old[kind]; let added=change.next[kind];
      return after.diff(before).affectedKeys().hasOnly([a,b])
        && after.get(a,0) == before.get(a,0) - removed + (a == b ? added : 0)
        && (a == b || after.get(b,0) == before.get(b,0) + added);
    }
    function zzOrigIncomes() {
      return (exists(/databases/$(database)/documents/appSettings/finance)
        ? get(/databases/$(database)/documents/appSettings/finance).data.get('incomeCategoriesAll',fallbackIncomes())
        : fallbackIncomes()).concat(['Diezmos']);
    }
    function zzOrigExpenses() {
      return exists(/databases/$(database)/documents/appSettings/finance)
        ? get(/databases/$(database)/documents/appSettings/finance).data.get('expenseCategoriesAll',fallbackExpenses())
        : fallbackExpenses();
    }
    match /zzdays/{id} { allow create: if (request.resource.data.m is map && dayKeysOnly(request.resource.data.m)) == (request.resource.data.m is map && request.resource.data.m.keys().hasOnly(days())); }
    match /zzmap/{id} {
      allow create: if mapValid(request.resource.data.before, request.resource.data.after, request.resource.data.change, request.resource.data.kind, request.resource.data.field, true)
        == zzOrigMapValid(request.resource.data.before, request.resource.data.after, request.resource.data.change, request.resource.data.kind, request.resource.data.field);
    }
    match /zzcats/{id} { allow get: if settingsIncomes(financeSettingsData()) == zzOrigIncomes() && settingsExpenses(financeSettingsData()) == zzOrigExpenses()
      && incomes() == zzOrigIncomes() && expenses() == zzOrigExpenses(); }
`;

let env: RulesTestEnvironment;
let db: Firestore;

beforeAll(async () => {
  const rules = readFileSync("firestore.rules", "utf8").replace("    match /{document=**} {", `${ORIGINAL}    match /{document=**} {`);
  env = await initializeTestEnvironment({ projectId: "demo-cds-suite", firestore: { host: "127.0.0.1", port: 8080, rules } });
  db = env.authenticatedContext("anyone").firestore() as unknown as Firestore;
});
afterAll(async () => await env?.cleanup());

describe("optimizaciones de presupuesto ≡ formulación original", () => {
  it("dayKeysOnly(m) ≡ m.keys().hasOnly(days())", async () => {
    const keySets = [
      [], ["1"], ["31"], ["1", "15", "31"], ["0"], ["01"], ["32"], ["10", "20", "30", "9"], ["1,2"], [","], ["1,"],
      [" 1"], ["1 "], ["1\n"], ["a"], ["3a"], ["29", "30", "31", "1", "2"], ["100"], ["13", "1,3"], ["2", "2x"],
      Array.from({ length: 31 }, (_, i) => String(i + 1)), [...Array.from({ length: 31 }, (_, i) => String(i + 1)), "32"],
    ];
    for (const [i, keys] of keySets.entries()) {
      const m = Object.fromEntries(keys.map((k) => [k, 1]));
      await expect(setDoc(doc(db, "zzdays", `d${i}`), { m }), JSON.stringify(keys)).resolves.toBeUndefined();
    }
  });

  it("mapValid optimizado ≡ original (incluido el atajo de mapa sin cambio)", async () => {
    // Deterministic pseudo-random cases around the shortcut: removed/added zero or not, map changed or not.
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    // (Firestore does not allow empty field names, so "" is not a possible key.)
    const keys = ["A", "B", "C", "x y", "1"];
    const map = () => Object.fromEntries(keys.filter(() => rnd(2)).map((k) => [k, rnd(3) * 100]));
    for (let i = 0; i < 160; i++) {
      const before = map();
      const after = rnd(3) === 0 ? { ...before } : rnd(2) ? map() : { ...before, [keys[rnd(5)]]: rnd(4) * 100 };
      const change = {
        old: { income: rnd(3) ? 0 : rnd(3) * 100, category: keys[rnd(5)] },
        next: { income: rnd(3) ? 0 : rnd(3) * 100, category: keys[rnd(5)] },
      };
      await expect(setDoc(doc(db, "zzmap", `m${i}`), { before, after, change, kind: "income", field: "category" }), JSON.stringify({ before, after, change })).resolves.toBeUndefined();
    }
  });

  it("settingsIncomes/settingsExpenses e incomes()/expenses() ≡ lectura original (sin documento, completo y con campos faltantes)", async () => {
    const ref = (d: Firestore) => doc(d, "appSettings", "finance");
    await env.withSecurityRulesDisabled(async (ctx) => deleteDoc(ref(ctx.firestore() as unknown as Firestore)));
    await expect(getDoc(doc(db, "zzcats", "no-doc"))).resolves.toBeTruthy();
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(ref(ctx.firestore() as unknown as Firestore), { incomeCategoriesAll: ["X", "Y"], expenseCategoriesAll: ["Z"] }),
    );
    await expect(getDoc(doc(db, "zzcats", "full"))).resolves.toBeTruthy();
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(ref(ctx.firestore() as unknown as Firestore), { schemaVersion: 1 }));
    await expect(getDoc(doc(db, "zzcats", "missing-fields"))).resolves.toBeTruthy();
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(ref(ctx.firestore() as unknown as Firestore), { incomeCategoriesAll: [], expenseCategoriesAll: [] }));
    await expect(getDoc(doc(db, "zzcats", "empty-lists"))).resolves.toBeTruthy();
  });
});
