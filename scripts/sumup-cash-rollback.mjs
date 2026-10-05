#!/usr/bin/env node
/**
 * scripts/sumup-cash-rollback.mjs
 *
 * Administrative fallback to reverse ONE imported SumUp CASH movement when
 * the provider refund is not available (SumUp CASH refundability is NOT
 * confirmed; see docs/mission-2026/22-sumup-cash-2026-10-04-audit.md).
 *
 * DRY-RUN BY DEFAULT. Never deletes. Scoped to exactly one movement: either
 * an explicit --finance-id, or the single active SumUp cash doc matching
 * --account + --date + --amount (aborts on 0 or more than 1 match). Every run
 * also re-checks type, method, origin, category, date, amount, status,
 * human edits and summary coverage, and aborts on anything unexpected.
 *
 * The logic lives in scripts/lib/sumup-cash-rollback-core.mjs and runs inside
 * the store's own runLedgerTransaction with core.summaryDelta — the same
 * primitives as the sync engine. Dry-run uses a read-only store (REST GET /
 * runQuery; writes stay in memory). Apply uses functions/sumup/firestore-store.js
 * and requires BOTH --apply and --confirm <exact finance id>.
 *
 * Expected scenario (Cafetería, 04/10/2026, CASH, CLP 163.500):
 *   node scripts/sumup-cash-rollback.mjs --account cafeteria --date 2026-10-04 --amount 163500
 *
 * Env: CDS_GCLOUD_ACCOUNT (gcloud account with read access, dry-run).
 * Apply uses Application Default Credentials with write access to the project.
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDryRunStore, summaryFieldDelta } from "./lib/sumup-dry-run-store.mjs";
import { createFirestoreReader } from "./lib/firestore-rest-reader.mjs";
import { RollbackAbort, rollbackWork } from "./lib/sumup-cash-rollback-core.mjs";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const core = require(resolve(__dirname, "../functions/sumup/core.js"));
const PROJECT_ID = "cds-administracion";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--account") args.account = argv[++i];
    else if (t === "--date") args.date = argv[++i];
    else if (t === "--amount") args.amount = Number(argv[++i]);
    else if (t === "--finance-id") args.financeId = argv[++i];
    else if (t === "--apply") args.apply = true;
    else if (t === "--confirm") args.confirm = argv[++i];
    else throw new Error(`Argumento desconocido: ${t}`);
  }
  if (!["offerings", "cafeteria"].includes(args.account)) throw new Error("--account offerings|cafeteria es obligatorio.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date || "")) throw new Error("--date YYYY-MM-DD es obligatorio.");
  if (!Number.isInteger(args.amount) || args.amount <= 0) throw new Error("--amount (CLP entero) es obligatorio.");
  if (args.date < core.SUMUP_CASH_START_DATE) throw new Error(`No hay CASH SumUp importado antes de ${core.SUMUP_CASH_START_DATE}.`);
  return args;
}

function gcloud(args) {
  const account = process.env.CDS_GCLOUD_ACCOUNT;
  return execFileSync("gcloud", [...args, ...(account ? ["--account", account] : [])], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function resolveFinanceId(reader, args) {
  const period = args.date.slice(0, 7);
  const day = String(Number(args.date.slice(8, 10)));
  const prefix = `sumup_${args.account}_`;
  const matches = (await reader.financeForPeriod(period)).filter(
    (t) =>
      t.id.startsWith(prefix) &&
      t.paymentMethod === "cash" &&
      t.status === "active" &&
      t.day === day &&
      Number(t.amount) === args.amount,
  );
  if (args.financeId) {
    if (!args.financeId.startsWith(prefix)) throw new RollbackAbort("ABORTADO: --finance-id no pertenece a la cuenta indicada.");
    return args.financeId;
  }
  if (matches.length !== 1) {
    throw new RollbackAbort(`ABORTADO: se esperaba exactamente 1 CASH SumUp activo para ${args.account} ${args.date} $${args.amount}; hay ${matches.length}.`);
  }
  return matches[0].id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reader = createFirestoreReader(gcloud(["auth", "print-access-token"]));
  const financeId = await resolveFinanceId(reader, args);
  const rawId = financeId.slice(`sumup_${args.account}_`.length);
  const expect = { financeId, account: args.account, localDate: args.date, amount: args.amount };
  const short = `…${financeId.slice(-6)}`;

  if (!args.apply) {
    const dry = createDryRunStore(reader);
    const result = await dry.store.runLedgerTransaction({ account: args.account, rawId, financeId }, rollbackWork({ core, expect, now: Date.now() }));
    console.log(`SumUp CASH rollback — DRY-RUN (sin escrituras) · objetivo ${short}`);
    if (result.outcome === "already") {
      console.log("Ya revertido por este procedimiento: no haría nada (idempotente).");
      return;
    }
    const w = dry.log.financeWrites[0];
    console.log(`Movimiento: ${w.before.status} rev ${w.before.revision} → ${w.after.status} rev ${w.after.revision} · voidedBy ${w.after.voidedBy}`);
    for (const s of dry.summaryChanges()) console.log(`Resumen ${s.period}: ${JSON.stringify(summaryFieldDelta(s.before, s.after))}`);
    console.log(`Versión a agregar: ${JSON.stringify(dry.log.versions[0])}`);
    console.log("Nada fue escrito. Para aplicar (solo con GO explícito):");
    console.log(`  node scripts/sumup-cash-rollback.mjs --account ${args.account} --date ${args.date} --amount ${args.amount} --apply --confirm <id completo>`);
    return;
  }

  if (args.confirm !== financeId) throw new RollbackAbort("ABORTADO: --confirm debe ser exactamente el id del movimiento resuelto.");
  const requireFromFunctions = createRequire(resolve(__dirname, "../functions/package.json"));
  const { initializeApp } = requireFromFunctions("firebase-admin/app");
  const { getFirestore, FieldValue, Timestamp } = requireFromFunctions("firebase-admin/firestore");
  const { createFirestoreStore } = require(resolve(__dirname, "../functions/sumup/firestore-store.js"));
  initializeApp({ projectId: PROJECT_ID });
  const store = createFirestoreStore({ db: getFirestore(), FieldValue, Timestamp });
  const result = await store.runLedgerTransaction({ account: args.account, rawId, financeId }, rollbackWork({ core, expect, now: Date.now() }));
  console.log(result.outcome === "already" ? `Ya revertido (${short}); sin cambios.` : `Revertido ${short}: anulado, resumen ajustado y versión registrada.`);
}

main().catch((error) => {
  console.error(error instanceof RollbackAbort ? error.message : `ERROR: ${error.message}`);
  process.exit(error instanceof RollbackAbort ? 3 : 1);
});
