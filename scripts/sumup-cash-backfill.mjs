#!/usr/bin/env node
/**
 * scripts/sumup-cash-backfill.mjs
 *
 * SumUp CASH Intake V1 — controlled backfill, DRY-RUN ONLY.
 *
 * Simulates, against REAL production data and WITHOUT writing anything, what
 * the deployed sync engine will do with SumUp CASH from SUMUP_CASH_START_DATE
 * (2026-10-04) on. It runs the production engine itself
 * (functions/sumup/engine.js runAccountSync) over a dry-run store
 * (scripts/lib/sumup-dry-run-store.mjs): reads go to production, writes stay
 * in memory. There is no second accounting implementation.
 *
 * Read-only by construction:
 *   - Firestore: only REST `GET documents/...` and `:runQuery` (both reads).
 *   - SumUp: only `GET /v2.1/merchants/{mc}/transactions/history`.
 *   - Secrets are read into memory (env var, else gcloud) and never printed.
 *
 * There is deliberately NO --apply. The apply step is the deployed engine:
 * once Functions are deployed, the next hourly incremental run (or the daily
 * 45-day sweep, or "Sincronizar ahora") imports exactly what this dry-run
 * shows, with the real lease, run record and transactions. See
 * docs/mission-2026/22-sumup-cash-2026-10-04-audit.md §C4.
 *
 * Usage:
 *   node scripts/sumup-cash-backfill.mjs [--account offerings|cafeteria|both]
 *     [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json out.json]
 *
 * Env (optional): CDS_GCLOUD_ACCOUNT (gcloud account with read access),
 * SUMUP_OFFERINGS_CONFIG / SUMUP_CAFETERIA_CONFIG (raw JSON secrets).
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDryRunStore, summaryFieldDelta } from "./lib/sumup-dry-run-store.mjs";
import { createFirestoreReader } from "./lib/firestore-rest-reader.mjs";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const core = require(resolve(__dirname, "../functions/sumup/core.js"));
const engine = require(resolve(__dirname, "../functions/sumup/engine.js"));

const PROJECT_ID = "cds-administracion";
const SECRET_NAME = { offerings: "SUMUP_OFFERINGS_CONFIG", cafeteria: "SUMUP_CAFETERIA_CONFIG" };
const HTTP_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { account: "both", since: core.SUMUP_CASH_START_DATE, until: null, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--account") args.account = argv[++i];
    else if (t === "--since") args.since = argv[++i];
    else if (t === "--until") args.until = argv[++i];
    else if (t === "--json") args.json = argv[++i];
    else if (t === "--apply") args.apply = true;
    else if (t === "--help" || t === "-h") args.help = true;
    else throw new Error(`Argumento desconocido: ${t}`);
  }
  return args;
}

const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ---------------------------------------------------------------------------
// America/Santiago local day -> UTC instants (no hand-written offsets)
// ---------------------------------------------------------------------------

function chileOffsetMinutes(utcMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (type) => Number(parts.find((p) => p.type === type).value);
  return Math.round((Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - utcMs) / 60000);
}

function chileLocalToUtcMs(date, h, m, s, ms) {
  const [y, mo, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, m, s, ms);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) guess = wall - chileOffsetMinutes(guess) * 60000;
  return guess;
}

// ---------------------------------------------------------------------------
// Credentials (never printed)
// ---------------------------------------------------------------------------

function gcloud(args) {
  const account = process.env.CDS_GCLOUD_ACCOUNT;
  return execFileSync("gcloud", [...args, ...(account ? ["--account", account] : [])], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function loadConfig(account) {
  const name = SECRET_NAME[account];
  const raw = process.env[name] || gcloud(["secrets", "versions", "access", "latest", "--secret", name, "--project", PROJECT_ID]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Never echo the input: JSON.parse errors quote it, and it is a secret.
    throw new Error(`El secreto ${name} no es JSON válido.`);
  }
  if (!parsed?.apiKey || !parsed?.merchantCode) throw new Error(`El secreto ${name} no tiene apiKey/merchantCode.`);
  return { apiKey: parsed.apiKey, merchantCode: parsed.merchantCode };
}

// ---------------------------------------------------------------------------
// SumUp — GET only, bounded window
// ---------------------------------------------------------------------------

function boundedFetchPage({ oldestIso, newestIso, onItems }) {
  return async ({ config, cursor }) => {
    const base = `https://api.sumup.com/v2.1/merchants/${encodeURIComponent(config.merchantCode)}/transactions/history`;
    const url = cursor
      ? cursor.startsWith("http")
        ? cursor
        : `${base}?${String(cursor).replace(/^\?/, "")}`
      : `${base}?${new URLSearchParams({ oldest_time: oldestIso, newest_time: newestIso, order: "ascending", limit: "100" })}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const err = new Error(`SumUp ${response.status}`);
      err.status = response.status;
      throw err;
    }
    const body = await response.json();
    const items = Array.isArray(body.items) ? body.items : [];
    onItems(items);
    const next = (body.links || []).find((l) => l.rel === "next");
    return { items, nextCursor: next?.href || null };
  };
}

// ---------------------------------------------------------------------------
// Dry-run per account
// ---------------------------------------------------------------------------

const MANUAL = (t) => !(String(t.id).startsWith("sumup_") || t.createdBy === "system:sumup");

async function dryRunAccount({ account, config, otherMerchantCode, reader, since, until }) {
  const oldestIso = new Date(chileLocalToUtcMs(since, 0, 0, 0, 0)).toISOString();
  const newestIso = new Date(chileLocalToUtcMs(until, 23, 59, 59, 999)).toISOString();
  const seen = [];
  const dry = createDryRunStore(reader);

  const result = await engine.runAccountSync({
    account,
    config,
    otherMerchantCode,
    trigger: "sweep",
    requestedBy: "dry-run:sumup-cash-backfill",
    // The bounded fetcher ignores changesSince; sweep mode keeps the
    // integration cursor/watermark untouched (and they only live in memory).
    sweep: true,
    fetchPage: boundedFetchPage({ oldestIso, newestIso, onItems: (items) => seen.push(...items) }),
    store: dry.store,
    clock: { now: () => Date.now() },
  });
  if (result.status !== "completed") {
    throw new Error(`Simulación ${account} terminó en estado ${result.status} (${result.errorClass || "sin clase"}).`);
  }

  // Classify what the engine did, per provider item, from the overlay log.
  // One entry per financeId: `before` from its FIRST write (did it exist in
  // production?) and `after` from its LAST write (final simulated state), so
  // an item the provider returns twice in the window is counted once.
  const writesById = new Map();
  for (const w of dry.log.financeWrites) {
    const prev = writesById.get(w.financeId);
    writesById.set(w.financeId, { before: prev ? prev.before : w.before, after: w.after });
  }
  const uniqueSeen = [...new Map(seen.map((item) => [String(item?.transaction_id || item?.id || ""), item])).values()];
  const reviewsByRaw = new Map(dry.log.rawWrites.filter((w) => w.review).map((w) => [w.rawId, w.reviewReason]));
  const byMethod = {};
  const cashDays = new Map();
  for (const item of uniqueSeen) {
    const n = core.normalizeItem(item, account);
    const key = n.paymentType || "∅";
    const bucket = (byMethod[key] ||= { found: 0, foundAmount: 0, toCreate: 0, toCreateAmount: 0, toUpdate: 0, toVoid: 0, alreadyPresent: 0, review: 0, ignored: 0 });
    bucket.found += 1;
    bucket.foundAmount += n.amount;
    const financeId = `sumup_${account}_${core.safeId(n.id)}`;
    const write = writesById.get(financeId);
    if (reviewsByRaw.has(core.safeId(n.id))) bucket.review += 1;
    else if (write && !write.before) {
      bucket.toCreate += 1;
      bucket.toCreateAmount += write.after.amount;
      if (n.isCash) {
        if (!cashDays.has(n.localDate)) cashDays.set(n.localDate, { count: 0, amount: 0 });
        const day = cashDays.get(n.localDate);
        day.count += 1;
        day.amount += write.after.amount;
      }
    } else if (write && write.after.status === "voided") bucket.toVoid += 1;
    else if (write) bucket.toUpdate += 1;
    else if (await dry.store.getFinanceBatch(account, [core.safeId(n.id)]).then((m) => m.size > 0)) bucket.alreadyPresent += 1;
    else bucket.ignored += 1;
  }

  // Manual cash coexisting on the days where SumUp CASH would be created:
  // flagged for human review BEFORE apply, never auto-resolved.
  const category = account === "offerings" ? "Ofrendas" : "Cafetería";
  const manualReview = [];
  for (const [localDate, cash] of cashDays) {
    const period = localDate.slice(0, 7);
    const day = String(Number(localDate.slice(8, 10)));
    const docs = await reader.financeForPeriod(period);
    const manual = docs.filter(
      (t) => MANUAL(t) && t.status === "active" && t.type === "income" && t.paymentMethod === "cash" && t.category === category && t.day === day,
    );
    manualReview.push({
      localDate,
      sumUpCashToCreate: cash,
      manualCash: { count: manual.length, amount: manual.reduce((s, t) => s + Number(t.amount || 0), 0) },
      verdict: manual.length ? "REQUIERE REVISIÓN antes del deploy" : "sin efectivo manual que pueda duplicar",
    });
  }

  return {
    account,
    window: { since, until, oldestIso, newestIso },
    counts: result.counts,
    byPaymentType: byMethod,
    manualReview,
    summaryDeltas: dry.summaryChanges().map(({ period, before, after }) => ({ period, delta: summaryFieldDelta(before, after), after })),
    writesSimulated: { finance: dry.log.financeWrites.length, raw: dry.log.rawWrites.length, summary: dry.log.summaryWrites.length },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("node scripts/sumup-cash-backfill.mjs [--account offerings|cafeteria|both] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json out.json]");
    return;
  }
  if (args.apply) {
    console.error(
      "--apply no existe en este script (V1). El apply es el engine desplegado: tras el deploy de Functions, la siguiente corrida horaria, el sweep diario o 'Sincronizar ahora' importan lo que muestra este dry-run. Ver doc 22 §C4.",
    );
    process.exit(2);
  }
  const todayLocal = core.datePartsChile(new Date().toISOString()).localDate;
  args.until ||= todayLocal;
  if (!isDate(args.since) || !isDate(args.until)) throw new Error("--since/--until deben ser YYYY-MM-DD.");
  if (args.since < core.SUMUP_CASH_START_DATE) {
    throw new Error(`Rechazado: --since ${args.since} es anterior a SUMUP_CASH_START_DATE ${core.SUMUP_CASH_START_DATE}.`);
  }
  if (args.until < args.since) throw new Error("--until es anterior a --since.");
  const accounts = args.account === "both" ? ["offerings", "cafeteria"] : [args.account];
  if (!accounts.every((a) => a in SECRET_NAME)) throw new Error("--account debe ser offerings, cafeteria o both.");

  const reader = createFirestoreReader(gcloud(["auth", "print-access-token"]));
  const configs = { offerings: loadConfig("offerings"), cafeteria: loadConfig("cafeteria") };

  const report = { mode: "DRY-RUN (sin escrituras)", cashStartDate: core.SUMUP_CASH_START_DATE, generatedAt: new Date().toISOString(), accounts: [] };
  for (const account of accounts) {
    const other = account === "offerings" ? "cafeteria" : "offerings";
    report.accounts.push(
      await dryRunAccount({ account, config: configs[account], otherMerchantCode: configs[other].merchantCode, reader, since: args.since, until: args.until }),
    );
  }

  const cash = report.accounts.map((a) => a.byPaymentType.CASH || { found: 0, foundAmount: 0, toCreate: 0, toCreateAmount: 0, alreadyPresent: 0, review: 0 });
  report.totals = {
    cashFound: cash.reduce((s, c) => s + c.found, 0),
    cashFoundAmount: cash.reduce((s, c) => s + c.foundAmount, 0),
    cashAlreadyPresent: cash.reduce((s, c) => s + c.alreadyPresent, 0),
    cashToCreate: cash.reduce((s, c) => s + c.toCreate, 0),
    cashToCreateAmount: cash.reduce((s, c) => s + c.toCreateAmount, 0),
    cashReview: cash.reduce((s, c) => s + c.review, 0),
    posChanges: report.accounts.reduce((s, a) => s + ((a.byPaymentType.POS?.toCreate || 0) + (a.byPaymentType.POS?.toUpdate || 0) + (a.byPaymentType.POS?.toVoid || 0)), 0),
    manualDaysToReview: report.accounts.reduce((s, a) => s + a.manualReview.filter((m) => m.manualCash.count > 0).length, 0),
  };

  const clp = (n) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);
  console.log(`SumUp CASH backfill — ${report.mode} · desde ${args.since} hasta ${args.until} (America/Santiago)`);
  for (const a of report.accounts) {
    console.log(`\n[${a.account}] ventana UTC ${a.window.oldestIso} → ${a.window.newestIso}`);
    for (const [pt, b] of Object.entries(a.byPaymentType)) {
      console.log(`  ${pt}: encontrados ${b.found} (${clp(b.foundAmount)}) · a crear ${b.toCreate} (${clp(b.toCreateAmount)}) · ya presentes ${b.alreadyPresent} · a actualizar ${b.toUpdate} · a anular ${b.toVoid} · revisión ${b.review} · ignorados ${b.ignored}`);
    }
    console.log(`  ignorados por razón: ${JSON.stringify(a.counts.ignored)}`);
    for (const m of a.manualReview) {
      console.log(`  ${m.localDate}: SumUp CASH a crear ${m.sumUpCashToCreate.count} (${clp(m.sumUpCashToCreate.amount)}) · efectivo manual ${m.manualCash.count} (${clp(m.manualCash.amount)}) → ${m.verdict}`);
    }
    for (const s of a.summaryDeltas) console.log(`  delta resumen ${s.period}: ${JSON.stringify(s.delta)}`);
  }
  const t = report.totals;
  console.log(
    `\nTOTAL CASH: encontrados ${t.cashFound} (${clp(t.cashFoundAmount)}) · ya presentes ${t.cashAlreadyPresent} · a crear ${t.cashToCreate} (${clp(t.cashToCreateAmount)}) · revisión ${t.cashReview} · días con efectivo manual a revisar ${t.manualDaysToReview} · cambios POS ${t.posChanges}`,
  );
  console.log("Nada fue escrito. Producción no cambió.");
  if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
