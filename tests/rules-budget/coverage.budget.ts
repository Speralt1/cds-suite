// Runs ONE critical operation on a fresh emulator database and saves the
// emulator's rule coverage report (per-expression evaluation counts).
//   RULES_FILE, OP, PROFILE, OUT_FILE
import { writeFileSync } from "node:fs";
import type { Firestore } from "firebase/firestore";
import { expect, it } from "vitest";
import { BUDGET_OPS, envFor, readRules, seedBudget } from "../rules/helpers/budget";

it.skipIf(!process.env.OP)("coverage of one operation", async () => {
  const env = await envFor(readRules(process.env.RULES_FILE || "firestore.rules"));
  try {
    await seedBudget(env);
    const before = await (await fetch("http://127.0.0.1:8080/emulator/v1/projects/demo-cds-suite:ruleCoverage")).json();
    const p = process.env.PROFILE || "legacy-finance";
    await BUDGET_OPS[process.env.OP!].run(env.authenticatedContext(p).firestore() as unknown as Firestore, p);
    const after = await (await fetch("http://127.0.0.1:8080/emulator/v1/projects/demo-cds-suite:ruleCoverage")).json();
    writeFileSync(process.env.OUT_FILE!, JSON.stringify({ before, after }));
    expect(after).toBeTruthy();
  } finally { await env.cleanup(); }
});
