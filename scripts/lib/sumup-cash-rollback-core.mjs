/**
 * scripts/lib/sumup-cash-rollback-core.mjs
 *
 * Administrative rollback of ONE SumUp CASH ledger doc, for when the provider
 * cannot (or cannot yet) refund it. It is not a second accounting engine: it
 * runs inside the store's own `runLedgerTransaction` (the same primitive the
 * sync engine uses; functions/sumup/firestore-store.js in production, the
 * dry-run store or the in-memory store in tests) and computes the summary with
 * the Financial Core's own `core.summaryDelta` / `core.applySummaryDelta`.
 *
 * Effect (never a delete):
 *   - financeTransactions/{id}: status "voided", revision + 1, voidedBy/updatedBy
 *     = ROLLBACK_ACTOR, voidReason explaining the rollback.
 *   - financeMonthlySummaries/{period}: exact inverse of the import delta.
 *   - sumupIntegrations/{account}/transactions/{rawId}/versions: one version
 *     doc (action "void", reason "admin_rollback", full `before`).
 *
 * Why the void sticks: voidedBy is not "system:sumup", so on every later sync
 * classifyItem returns review/human_voided — the engine never reactivates it.
 * The pre-CASH engine (0d1bb0d) ignores CASH entirely, so it is inert there too.
 */

export const ROLLBACK_ACTOR = "admin:sumup-cash-rollback";
export const ROLLBACK_REASON = "admin_rollback";
export const ROLLBACK_VOID_REASON = "Rollback administrativo SumUp CASH Intake V1 (sin reembolso en SumUp)";

const FINANCE_ID = /^sumup_(offerings|cafeteria)_[A-Za-z0-9_-]+$/;
const CATEGORY = { offerings: "Ofrendas", cafeteria: "Cafetería" };

export class RollbackAbort extends Error {}

function abort(message) {
  throw new RollbackAbort(`ABORTADO: ${message}`);
}

/**
 * Validates the target BEFORE anything is written. Returns "rollback" or
 * "already" (idempotent no-op when this tool already voided it).
 *
 * @param {object|null} finance  current financeTransactions doc
 * @param {{financeId: string, account: string, localDate: string, amount: number}} expect
 */
export function checkExpect(expect) {
  const match = FINANCE_ID.exec(expect.financeId || "");
  if (!match) abort("el id no es un doc SumUp (sumup_{offerings|cafeteria}_…).");
  if (match[1] !== expect.account) abort("el id no pertenece a la cuenta indicada.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expect.localDate || "")) abort("fecha esperada inválida.");
  if (!Number.isInteger(expect.amount) || expect.amount <= 0) abort("monto esperado inválido.");
}

export function checkTarget(finance, expect) {
  checkExpect(expect);
  if (!finance) abort("el movimiento no existe.");

  const period = expect.localDate.slice(0, 7);
  const day = String(Number(expect.localDate.slice(8, 10)));
  const sameTarget =
    finance.type === "income" &&
    finance.paymentMethod === "cash" &&
    finance.createdBy === "system:sumup" &&
    finance.category === CATEGORY[expect.account] &&
    finance.period === period &&
    finance.day === day &&
    Number(finance.amount) === expect.amount;
  if (!sameTarget) abort("el movimiento no coincide con lo esperado (tipo, método cash, origen SumUp, categoría, fecha o monto).");

  if (finance.status === "voided") {
    if (finance.voidedBy === ROLLBACK_ACTOR) return "already";
    abort("el movimiento ya está anulado por otro actor; revisión humana.");
  }
  if (finance.status !== "active") abort(`estado inesperado: ${finance.status}.`);
  if (finance.updatedBy !== "system:sumup") abort("el movimiento fue modificado fuera del sync; revisión humana.");
  return "rollback";
}

/** The summary must contain the movement being reversed; never let it go negative. */
export function checkSummary(summary, finance) {
  if (!summary) abort(`no existe financeMonthlySummaries/${finance.period}.`);
  const amount = Number(finance.amount);
  if (Number(summary.incomeTotal || 0) < amount) abort("incomeTotal menor que el monto a revertir.");
  if (Number(summary.transactionCount || 0) < 1) abort("transactionCount es 0.");
  if (Number(summary.incomeByCategory?.[finance.category] || 0) < amount) abort("incomeByCategory no contiene el monto.");
  if (Number(summary.dailyIncome?.[finance.day] || 0) < amount) abort("dailyIncome no contiene el monto.");
}

/**
 * Builds the transaction body for store.runLedgerTransaction. Re-validates
 * INSIDE the transaction (fresh reads), so a concurrent change aborts it.
 *
 * @returns {(tx) => Promise<{outcome: "rolledBack"|"already", summaryBefore?: object, summaryAfter?: object}>}
 */
export function rollbackWork({ core, expect, now }) {
  // Cheap, I/O-free validation first: a malformed id never reaches Firestore.
  checkExpect(expect);
  return async (tx) => {
    const finance = await tx.getFinance();
    const state = checkTarget(finance, expect);
    if (state === "already") return { outcome: "already" };

    const summary = await tx.getSummary(finance.period);
    checkSummary(summary, finance);

    const before = { active: true, amount: Number(finance.amount), category: finance.category, day: finance.day };
    const after = { active: false, amount: 0, category: finance.category, day: finance.day };
    const summaryAfter = core.applySummaryDelta(summary, core.summaryDelta(before, after));

    tx.setSummary(finance.period, summaryAfter, expect.financeId);
    tx.setFinance({
      ...finance,
      status: "voided",
      revision: Number(finance.revision || 0) + 1,
      updatedBy: ROLLBACK_ACTOR,
      updatedAt: now,
      voidReason: ROLLBACK_VOID_REASON,
      voidedBy: ROLLBACK_ACTOR,
      voidedAt: now,
    });
    tx.addVersion({
      action: "void",
      reason: ROLLBACK_REASON,
      before: finance,
      afterAmount: 0,
      afterCategory: finance.category,
      afterPaymentMethod: finance.paymentMethod,
      runId: ROLLBACK_ACTOR,
      at: now,
    });
    return { outcome: "rolledBack", summaryBefore: summary, summaryAfter };
  };
}
