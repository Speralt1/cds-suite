// Measures, per critical financial operation and profile, how many expressions
// remain before Firestore's 1000-expression limit (see tests/rules/helpers/budget.ts).
//   RULES_FILE  rules to measure (default firestore.rules)
//   OUT_FILE    JSON report path
//   MAX_TERMS / STEP  padding sweep (default 0..240 step 4)
import { writeFileSync } from "node:fs";
import type { Firestore } from "firebase/firestore";
import { expect, it } from "vitest";
import { BUDGET_OPS, calibrationGet, EXPRESSION_LIMIT, envFor, isDenied, paddedRules, readRules, seedBudget, type PadPoint } from "../rules/helpers/budget";

const SOURCE = readRules(process.env.RULES_FILE || "firestore.rules");
const MAX = Number(process.env.MAX_TERMS || 240);
const STEP = Number(process.env.STEP || 4);
const AT = (process.env.PAD_AT || "transaction") as PadPoint;   // transaction | summary | attribution
const ONLY = process.env.OPS ? process.env.OPS.split(";") : null; // optional op filter

async function calibrate() {
  let lo = 0, hi = 1000;
  const ok = async (n: number) => {
    const env = await envFor(paddedRules(SOURCE, n, AT));
    try { await calibrationGet(env); return true; } catch (e) { if (isDenied(e)) return false; throw e; } finally { await env.cleanup(); }
  };
  if (!(await ok(lo))) throw new Error("calibration denied at 0");
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await ok(mid)) lo = mid; else hi = mid; }
  return { maxTerms: lo, costPerTerm: EXPRESSION_LIMIT / (lo + 1) };
}

it("expression budget", async () => {
  const calibration = await calibrate();
  const pairs = Object.entries(BUDGET_OPS).filter(([op]) => !ONLY || ONLY.includes(op)).flatMap(([op, o]) => o.profiles.map((p) => ({ op, p })));
  const margin: Record<string, Record<string, number | string>> = {};
  const alive = new Set(pairs.map(({ op, p }) => `${op}|${p}`));
  for (let n = 0; n <= MAX && alive.size; n += STEP) {
    const env = await envFor(paddedRules(SOURCE, n, AT));
    try {
      await seedBudget(env);
      for (const { op, p } of pairs) {
        const key = `${op}|${p}`;
        if (!alive.has(key)) continue;
        margin[op] ??= {};
        try {
          await BUDGET_OPS[op].run(env.authenticatedContext(p).firestore() as unknown as Firestore, p);
          margin[op][p] = n;
        } catch (e) {
          alive.delete(key);
          if (n === 0) margin[op][p] = isDenied(e) ? "DENIED at 0" : `ERROR ${String((e as Error).message).slice(0, 80)}`;
          else if (!isDenied(e)) margin[op][p] = `ERROR at ${n}: ${String((e as Error).message).slice(0, 80)}`;
        }
      }
    } finally { await env.cleanup(); }
  }
  for (const key of alive) { const [op, p] = key.split("|"); margin[op][p] = `>=${MAX}`; }
  writeFileSync(process.env.OUT_FILE!, JSON.stringify({ rules: process.env.RULES_FILE || "firestore.rules", padAt: AT, step: STEP, calibration, margin }, null, 1));
  expect(Object.keys(margin).length).toBeGreaterThan(0);
});
