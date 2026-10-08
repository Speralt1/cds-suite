// Firestore Rules expression budget (1000 expressions per evaluated document).
// Fails when a critical financial write is left with less than REQUIRED_MARGIN
// expressions of room for any writer profile (legacy or v1), at any of the
// documents of the commit (movement, monthly summary, tithe attribution).
// Method and harness: tests/rules/helpers/budget.ts. The padding only exists in
// the temporary rules loaded into the emulator, never in firestore.rules.
import type { Firestore } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import {
  BUDGET_OPS,
  calibrationGet,
  envFor,
  isDenied,
  paddedRules,
  readRules,
  seedBudget,
  WRITERS,
  type PadPoint,
} from "./helpers/budget";

const REQUIRED_MARGIN = 100; // expressions
const SOURCE = readRules();

async function allowed(op: () => Promise<unknown>) {
  try {
    await op();
    return true;
  } catch (e) {
    if (isDenied(e)) return false;
    throw e;
  }
}

describe("Presupuesto de expresiones de las escrituras financieras", () => {
  let termsFor100 = 0;

  it("calibración: costo de un término de relleno", async () => {
    let lo = 0;
    let hi = 1000;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const env = await envFor(paddedRules(SOURCE, mid));
      try {
        if (await allowed(() => calibrationGet(env))) lo = mid;
        else hi = mid;
      } finally {
        await env.cleanup();
      }
    }
    const costPerTerm = 1000 / (lo + 1);
    // A term is `request.auth.uid != 'pN' &&` (~7 expressions); guard against silent changes.
    expect(costPerTerm).toBeGreaterThan(5);
    expect(costPerTerm).toBeLessThan(9);
    termsFor100 = Math.ceil(REQUIRED_MARGIN / costPerTerm);
  });

  const POINTS: [PadPoint, string[] | null][] = [
    ["transaction", null],
    ["summary", null],
    ["attribution", ["tithe create (+attribution)", "tithe update amount", "tithe move to another period"]],
  ];

  it.each(POINTS)("con %s ≥ 100 expresiones libres: todas las operaciones críticas pasan (legacy y v1)", async (at, only) => {
    expect(termsFor100).toBeGreaterThan(0);
    const env = await envFor(paddedRules(SOURCE, termsFor100, at));
    const failures: string[] = [];
    try {
      await seedBudget(env);
      for (const [name, op] of Object.entries(BUDGET_OPS)) {
        if (only && !only.includes(name)) continue;
        for (const p of op.profiles) {
          const ok = await allowed(() => op.run(env.authenticatedContext(p).firestore() as unknown as Firestore, p));
          if (!ok) failures.push(`${name} · ${p}`);
        }
      }
    } finally {
      await env.cleanup();
    }
    expect(failures).toEqual([]);
  });

  it("los perfiles medidos incluyen legacy y v1 con permiso de registro", () => {
    expect(WRITERS).toEqual(expect.arrayContaining(["legacy-admin", "legacy-pastor", "legacy-finance", "v1-admin", "v1-records"]));
  });
});
