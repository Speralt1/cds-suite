#!/usr/bin/env node
/**
 * scripts/sumup-payouts-probe.mjs
 *
 * G9 — SumUp payouts probe (READ-ONLY). Salvador runs this locally from the
 * Terminal. It never deploys anything and never writes to Firestore.
 *
 * It answers, for a date range and one or both SumUp accounts:
 *   - what does GET /v1.0/merchants/{merchantCode}/payouts actually return
 *     (row types, statuses, ids);
 *   - is `amount` net or gross of `fee` (Atlas's vote rule, see
 *     scripts/lib/payouts-probe-core.mjs);
 *   - how many payout rows link to an imported transaction by
 *     transaction_code, and how many don't;
 *   - a day-of-sale and a per-payout rollup Salvador can check against the
 *     bank statement.
 *
 * See docs/mission-2026/14-g9-payouts-probe.md for prerequisites and how to
 * read the report.
 *
 * Usage:
 *   node scripts/sumup-payouts-probe.mjs --start 2026-09-01 --end 2026-09-30 \
 *     [--account offerings|cafeteria|both] [--out docs/mission-2026/g9-probe-report.md]
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  maskApiKey,
  detectBasisVote,
  aggregateBasisVotes,
  buildTransactionIndex,
  linkPayoutRow,
  computeIdUniqueness,
  tallyByField,
  aggregateByDay,
  aggregateByPayout,
  computeAccountTotals,
  buildDepositsList,
} from "./lib/payouts-probe-core.mjs";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// firebase-admin lives in functions/node_modules (see functions/package.json).
// We resolve it from there instead of adding a new dependency at the repo root.
// Anchoring on functions/package.json is what lets the modular subpath exports
// ("firebase-admin/app", "firebase-admin/firestore") resolve — an absolute path
// into node_modules bypasses the package's `exports` map and fails.
const requireFromFunctions = createRequire(resolve(__dirname, "../functions/package.json"));
const { initializeApp, getApps } = requireFromFunctions("firebase-admin/app");
const { getFirestore, Timestamp } = requireFromFunctions("firebase-admin/firestore");

const PROJECT_ID = "cds-administracion";
const ACCOUNTS = ["offerings", "cafeteria"];
const SECRET_NAME = { offerings: "SUMUP_OFFERINGS_CONFIG", cafeteria: "SUMUP_CAFETERIA_CONFIG" };
const HTTP_TIMEOUT_MS = 20_000;

// Reuses the same Chile-timezone day math the sync Function already uses and
// has tests for, instead of re-deriving it here.
const core = require(resolve(__dirname, "../functions/sumup/core.js"));

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { account: "both", out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--start") args.start = argv[++i];
    else if (token === "--end") args.end = argv[++i];
    else if (token === "--account") args.account = argv[++i];
    else if (token === "--out") args.out = argv[++i];
    else if (token === "--help" || token === "-h") args.help = true;
  }
  return args;
}

function printUsage() {
  console.log(
    [
      "Uso:",
      "  node scripts/sumup-payouts-probe.mjs --start YYYY-MM-DD --end YYYY-MM-DD [opciones]",
      "",
      "Opciones:",
      "  --account offerings|cafeteria|both   (default: both)",
      "  --out <ruta.md>                      guarda el reporte además de imprimirlo",
      "",
      "Solo lectura: no escribe en Firestore ni hace deploy.",
    ].join("\n"),
  );
}

function isValidDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ---------------------------------------------------------------------------
// Read-only Firestore guard
// ---------------------------------------------------------------------------

const FORBIDDEN_METHODS = new Set([
  "set",
  "update",
  "delete",
  "add",
  "create",
  "commit",
  "runTransaction",
  "batch",
  "bulkWriter",
]);

/**
 * readOnly — wraps a Firestore CollectionReference/Query in a Proxy that
 * throws if anything tries to call a write method on it or on anything it
 * returns (where/orderBy/limit chains stay wrapped). This script must never
 * write to Firestore; this guard makes that a thrown error, not a promise.
 */
function readOnly(target) {
  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === "string" && FORBIDDEN_METHODS.has(prop)) {
        throw new Error(
          `GUARDIA DE SOLO LECTURA: '${prop}' está prohibido en sumup-payouts-probe.mjs (G9 es solo lectura).`,
        );
      }
      const value = Reflect.get(obj, prop, obj);
      if (typeof value === "function") {
        return (...args) => {
          const result = value.apply(obj, args);
          if (result && typeof result === "object" && typeof result.get === "function") {
            return readOnly(result);
          }
          return result;
        };
      }
      return value;
    },
  });
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * loadAccountConfig — env var first (SUMUP_OFFERINGS_CONFIG /
 * SUMUP_CAFETERIA_CONFIG as raw JSON), else `firebase functions:secrets:access`.
 * The parsed apiKey is NEVER logged, written to the report, or returned in
 * any form other than masked.
 */
function loadAccountConfig(account) {
  const envName = SECRET_NAME[account];
  const fromEnv = process.env[envName];
  let raw = fromEnv;
  let source = "env";

  if (!raw) {
    // The repo's firebase-tools via npx, not a global `firebase` binary: the
    // global one on this machine is x86_64 on an arm64 Mac and fails EBADARCH.
    source = "npx firebase functions:secrets:access";
    try {
      raw = execFileSync(
        "npx",
        ["firebase", "functions:secrets:access", envName, "--project", PROJECT_ID],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: resolve(__dirname, "..") },
      ).trim();
    } catch (error) {
      throw new Error(
        `No se pudo leer el secreto ${envName} con el Firebase CLI del repo. ¿Corriste 'firebase login' y tenés permisos en el proyecto ${PROJECT_ID}? Detalle: ${error.message}`,
      );
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`El secreto ${envName} (fuente: ${source}) no es JSON válido.`);
  }

  const { apiKey, merchantCode } = parsed || {};
  if (!apiKey || !merchantCode) {
    throw new Error(`El secreto ${envName} no tiene apiKey/merchantCode.`);
  }
  return { apiKey, merchantCode, source };
}

// ---------------------------------------------------------------------------
// SumUp payouts API (read-only: GET only)
// ---------------------------------------------------------------------------

/**
 * fetchPayouts — GET /v1.0/merchants/{merchantCode}/payouts. Read-only by
 * construction: this is the only HTTP call this script ever makes, and it is
 * a GET.
 */
async function fetchPayouts({ apiKey, merchantCode }, { start, end }) {
  const params = new URLSearchParams({
    start_date: start,
    end_date: end,
    limit: "9999",
    order: "asc",
  });
  const url = `https://api.sumup.com/v1.0/merchants/${encodeURIComponent(merchantCode)}/payouts?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`SumUp payouts: timeout tras ${HTTP_TIMEOUT_MS / 1000}s.`);
    }
    throw new Error(`SumUp payouts: error de red — ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `SumUp payouts respondió ${response.status}: la API key no tiene scope payouts.read (o es inválida) para merchant ${merchantCode}.`,
    );
  }
  if (response.status === 429) {
    throw new Error("SumUp payouts respondió 429: rate limited. Reintentá en unos minutos.");
  }
  if (response.status >= 500) {
    const body = await response.text().catch(() => "");
    throw new Error(`SumUp payouts respondió ${response.status} (error del proveedor). ${body.slice(0, 300)}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`SumUp payouts respondió ${response.status}. ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("SumUp payouts: respuesta inesperada (se esperaba un array de filas).");
  }
  return data;
}

// ---------------------------------------------------------------------------
// Firestore reads (read-only)
// ---------------------------------------------------------------------------

function initFirestore() {
  if (!getApps().length) {
    initializeApp({ projectId: PROJECT_ID });
  }
  return getFirestore();
}

/**
 * fetchImportedTransactions — reads sumupIntegrations/{account}/transactions
 * padded by one day on each side of [start, end] (Firestore query is in UTC
 * instants; Chile's offset is at most 4h so one day of padding is safe),
 * then filters to the exact Chile-local day using core.datePartsChile — the
 * same day math the sync Function already uses.
 */
async function fetchImportedTransactions(db, account, { start, end }) {
  const startPadded = new Date(`${start}T00:00:00Z`);
  startPadded.setUTCDate(startPadded.getUTCDate() - 1);
  const endPadded = new Date(`${end}T00:00:00Z`);
  endPadded.setUTCDate(endPadded.getUTCDate() + 2);

  const col = readOnly(db.collection(`sumupIntegrations/${account}/transactions`));
  const snap = await col
    .where("timestamp", ">=", Timestamp.fromDate(startPadded))
    .where("timestamp", "<", Timestamp.fromDate(endPadded))
    .get();

  const out = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data?.timestamp?.toDate) continue;
    const iso = data.timestamp.toDate().toISOString();
    const parts = core.datePartsChile(iso);
    if (parts.localDate < start || parts.localDate > end) continue;
    out.push({
      id: doc.id,
      transactionCode: data.transactionCode || "",
      grossAmount: Number(data.grossAmount || 0),
      refundedAmount: Number(data.refundedAmount || 0),
      feeAmount: data.feeAmount ?? null,
      status: data.status || "",
      localDate: parts.localDate,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function clp(value) {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(Math.round(Number(value || 0)));
}

function fmtTally(tally) {
  const entries = Object.entries(tally);
  if (entries.length === 0) return "(ninguna)";
  return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
}

function buildAccountSection(account, { rows, transactions, index }) {
  const idUniqueness = computeIdUniqueness(rows);
  const typeTally = tallyByField(rows, "type");
  const statusTally = tallyByField(rows, "status");

  const linkResults = rows.map((row) => ({ row, link: linkPayoutRow(row, account, index) }));
  const linked = linkResults.filter((r) => r.link.status === "linked");
  const notFound = linkResults.filter((r) => r.link.status === "not_found");
  const otherAccount = linkResults.filter((r) => r.link.status === "other_account");
  const noCode = linkResults.filter((r) => r.link.status === "no_code");

  // Only PAYOUT-type rows carry a per-transaction commission we can vote
  // with; deduction rows don't map 1:1 to a single gross/refunded pair.
  const payoutLinked = linked.filter((r) => r.row.type === "PAYOUT");
  const votes = payoutLinked.map(({ row, link }) => {
    const { vote } = detectBasisVote({
      payoutAmount: row.amount,
      payoutFee: row.fee,
      gross: link.tx.grossAmount,
      refunded: link.tx.refundedAmount,
    });
    return vote;
  });
  const basisResult = aggregateBasisVotes(votes);

  // rows-by-transactionCode for this account's PAYOUT-type rows, for the
  // day-of-sale rollup.
  const linkedRowsByCode = new Map();
  for (const { row, link } of payoutLinked) {
    const code = link.transactionCode;
    if (!linkedRowsByCode.has(code)) linkedRowsByCode.set(code, []);
    linkedRowsByCode.get(code).push(row);
  }

  const dayAggregates = aggregateByDay(transactions, linkedRowsByCode, basisResult.basis);
  const totals = computeAccountTotals(dayAggregates);
  const { payouts: payoutGroups, rowsInReview } = aggregateByPayout(rows);
  const deposits = buildDepositsList(payoutGroups);

  const pct = (n) => (rows.length > 0 ? ((n / rows.length) * 100).toFixed(1) : "0.0");

  const lines = [];
  lines.push(`## Cuenta: ${account}`);
  lines.push("");
  lines.push(`- Filas de payouts en el rango: **${rows.length}**`);
  lines.push(`- Por type: ${fmtTally(typeTally)}`);
  lines.push(`- Por status: ${fmtTally(statusTally)}`);
  lines.push(
    `- IDs únicos: ${idUniqueness.uniqueIds} / ${idUniqueness.totalRows} (duplicados: ${idUniqueness.duplicateIds}) — pares (id, transaction_code) únicos: ${idUniqueness.uniquePairs} (duplicados: ${idUniqueness.duplicatePairs})`,
  );
  lines.push(
    `- Vinculación: linked ${linked.length} (${pct(linked.length)}%) · not_found ${notFound.length} (${pct(notFound.length)}%) · otra cuenta ${otherAccount.length} (${pct(otherAccount.length)}%) · sin transaction_code ${noCode.length} (${pct(noCode.length)}%)`,
  );
  lines.push(
    `- Base detectada (solo filas PAYOUT vinculadas): **${basisResult.basis}**${basisResult.reason ? ` (${basisResult.reason})` : ""} — votos: net ${basisResult.tally.net}, gross ${basisResult.tally.gross}, ambiguos ${basisResult.tally.ambiguous}, mismatch ${basisResult.tally.mismatch}`,
  );
  lines.push("");

  lines.push("### Por día de venta");
  lines.push("");
  lines.push("| Día | n pagos | Bruto | Reembolsado | Comisión (Σfee) | Líquido | Pagado según base | Payout(s) vinculado(s) |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---|");
  for (const d of dayAggregates) {
    const refs = d.payoutRefs.map((r) => `${r.reference || "(sin ref)"} · ${r.date || "?"}`).join("; ") || "(sin vincular)";
    const pagado = d.pagadoSegunBase === null ? "N/D" : clp(d.pagadoSegunBase);
    lines.push(
      `| ${d.day} | ${d.n} | ${clp(d.bruto)} | ${clp(d.reembolsado)} | ${clp(d.comision)} | ${clp(d.liquido)} | ${pagado} | ${refs}${d.pendientes > 0 ? ` — **${d.pendientes} sin payout (revisar)**` : ""} |`,
    );
  }
  lines.push("");

  lines.push("### Por payout (reference/date)");
  lines.push("");
  lines.push("| Reference | Fecha | Monto pagado | Comisión | n transacciones | Filas por type |");
  lines.push("|---|---|---:|---:|---:|---|");
  for (const p of payoutGroups) {
    lines.push(
      `| ${p.reference || "(sin reference)"} | ${p.date || "?"} | ${clp(p.montoPagado)} | ${clp(p.comision)} | ${p.nTransacciones} | ${fmtTally(p.typeTally)} |`,
    );
  }
  lines.push("");
  if (rowsInReview.length > 0) {
    lines.push(`**Filas en revisión (sin reference): ${rowsInReview.length}**`);
    lines.push("");
  }

  lines.push("### Totales del rango");
  lines.push("");
  lines.push(
    `- Bruto: **${clp(totals.bruto)}** · Reembolsado: **${clp(totals.reembolsado)}** · Comisión: **${clp(totals.comision)}** · Líquido: **${clp(totals.liquido)}**`,
  );
  lines.push(
    `- % comisión efectiva: ${totals.pctComisionEfectiva === null ? "N/D (bruto 0)" : `${totals.pctComisionEfectiva.toFixed(2)}%`}`,
  );
  lines.push("");

  return { markdown: lines.join("\n"), deposits, account };
}

function buildDepositsSection(accountSections) {
  const lines = ["## Para validar contra el banco", "", "Depósitos esperados (comparar contra la cartola):", ""];
  lines.push("| Cuenta | Fecha | Reference | Monto neto pagado |");
  lines.push("|---|---|---|---:|");
  for (const { account, deposits } of accountSections) {
    for (const d of deposits) {
      lines.push(`| ${account} | ${d.date || "?"} | ${d.reference || "(sin reference)"} | ${clp(d.montoNeto)} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.start || !args.end) {
    printUsage();
    process.exit(args.help ? 0 : 1);
    return;
  }
  if (!isValidDate(args.start) || !isValidDate(args.end)) {
    console.error("Error: --start y --end deben ser YYYY-MM-DD.");
    process.exit(1);
    return;
  }
  const requestedAccounts = args.account === "both" ? ACCOUNTS : [args.account];
  for (const a of requestedAccounts) {
    if (!ACCOUNTS.includes(a)) {
      console.error(`Error: --account inválido '${a}'. Usa offerings, cafeteria o both.`);
      process.exit(1);
      return;
    }
  }

  console.log(`G9 · SumUp payouts probe (SOLO LECTURA) — rango ${args.start} a ${args.end}`);
  console.log(`Cuentas: ${requestedAccounts.join(", ")}`);
  console.log("");

  // Credentials — never logged beyond a masked form.
  const configs = {};
  for (const account of requestedAccounts) {
    const cfg = loadAccountConfig(account);
    configs[account] = cfg;
    console.log(`[${account}] credencial cargada (${cfg.source}) — apiKey: ${maskApiKey(cfg.apiKey)}, merchant: ${cfg.merchantCode}`);
  }
  console.log("");

  // Firestore — always read BOTH accounts' imported transactions so
  // cross-account links (a payout row whose code belongs to the other
  // account) can be detected even when only one account was requested.
  const db = initFirestore();
  console.log("Leyendo transacciones importadas desde Firestore (solo lectura)…");
  const transactionsByAccount = {};
  for (const account of ACCOUNTS) {
    transactionsByAccount[account] = await fetchImportedTransactions(db, account, { start: args.start, end: args.end });
    console.log(`  sumupIntegrations/${account}/transactions en rango: ${transactionsByAccount[account].length}`);
  }
  const index = buildTransactionIndex(transactionsByAccount);
  console.log("");

  const accountSections = [];
  for (const account of requestedAccounts) {
    console.log(`Consultando GET /v1.0/merchants/{merchantCode}/payouts para ${account}…`);
    const rows = await fetchPayouts(configs[account], { start: args.start, end: args.end });
    console.log(`  filas recibidas: ${rows.length}`);
    accountSections.push(
      buildAccountSection(account, { rows, transactions: transactionsByAccount[account], index }),
    );
  }
  console.log("");

  const reportLines = [
    `# G9 — Reporte de probe de payouts SumUp (solo lectura)`,
    "",
    `Rango: ${args.start} a ${args.end} · Cuentas: ${requestedAccounts.join(", ")} · Generado: ${new Date().toISOString()}`,
    "",
    "Este reporte es una LECTURA de investigación (G9). No representa el libro contable ni cambia ningún dato. No confirma todavía si `amount` es neto o bruto de forma global — eso se decide por cuenta según los votos de abajo, y solo si hay evidencia suficiente.",
    "",
    ...accountSections.map((s) => s.markdown),
    buildDepositsSection(accountSections),
  ];
  const report = reportLines.join("\n");

  console.log(report);

  if (args.out) {
    const outPath = resolve(process.cwd(), args.out);
    await writeFile(outPath, report, "utf8");
    console.log(`\nReporte guardado en: ${outPath}`);
  }
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
