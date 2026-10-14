#!/usr/bin/env node
/**
 * scripts/ops/finance-monitor/run.mjs
 *
 * Monitor financiero A6 (doc 31) — CLI delgada. SOLO lee archivos JSON locales:
 * no usa red, no llama a Firestore ni a SumUp y no escribe nada.
 * La recolección de snapshots de producción es un paso PRIVADO fuera del repo.
 *
 * Uso:
 *   node scripts/ops/finance-monitor/run.mjs --snapshot actual.json
 *     [--baseline baseline.json] [--previous previo.json] [--config config.json]
 *     [--today YYYY-MM-DD] [--since ISO] [--format text|json]
 *
 * Salida: 0 = OK (solo INFORMATIVO), 1 = REVISAR, 2 = STOP (también entrada inválida).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LEVELS, exitCodeOf, formatReport, publicFindings, runMonitor } from "./index.mjs";

const USAGE = "Uso: run.mjs --snapshot <actual.json> [--baseline <b.json>] [--previous <p.json>] [--config <c.json>] [--today YYYY-MM-DD] [--since ISO] [--format text|json]";
const FLAGS = new Set(["--snapshot", "--baseline", "--previous", "--config", "--today", "--since", "--format"]);

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (!FLAGS.has(flag)) throw new Error(`argumento desconocido: ${flag}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`falta valor para ${flag}`);
    args[flag.slice(2)] = value;
  }
  if (!args.snapshot) throw new Error("falta --snapshot");
  if (args.today && !/^\d{4}-\d{2}-\d{2}$/.test(args.today)) throw new Error("--today debe ser YYYY-MM-DD");
  if (args.format && !["text", "json"].includes(args.format)) throw new Error("--format debe ser text o json");
  return args;
}

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));

/** Ejecuta la CLI y devuelve { code, output } (sin process.exit, para poder testearla). */
export function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    return { code: 2, output: `${e instanceof Error ? e.message : e}\n${USAGE}` };
  }
  if (args.help) return { code: 0, output: USAGE };
  let snapshot;
  let config = {};
  try {
    snapshot = readJson(args.snapshot);
    if (args.baseline) snapshot = { ...snapshot, baseline: readJson(args.baseline) };
    if (args.previous) snapshot = { ...snapshot, previous: readJson(args.previous) };
    if (args.config) config = readJson(args.config);
  } catch (e) {
    return { code: 2, output: `STOP: no se pudo leer la entrada (${e instanceof Error ? e.message : e}).` };
  }
  const result = runMonitor(snapshot, { ...config, ...(args.today ? { today: args.today } : {}), ...(args.since ? { since: args.since } : {}) });
  const inputs = [
    `ledger ${Array.isArray(snapshot.ledger) ? snapshot.ledger.length : 0} movimiento(s)`,
    `resúmenes ${Object.keys(snapshot.summaries || {}).length}`,
    `baseline ${snapshot.baseline ? "sí" : "no"}`,
    `snapshot previo ${snapshot.previous ? "sí" : "no"}`,
    `SumUp ${snapshot.sumup ? `${(snapshot.sumup.sales || []).length} venta(s), ${(snapshot.sumup.payouts || []).length} fila(s) de payout` : "no"}`,
  ].join(" · ");
  const output =
    args.format === "json"
      ? JSON.stringify({ verdict: result.verdict, exitCode: result.exitCode, context: result.context, findings: publicFindings(result.findings) }, null, 2)
      : formatReport(result, { inputs, timeZone: config.timeZone });
  return { code: exitCodeOf(result.verdict), output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, output } = main(process.argv.slice(2));
  (code === 2 && !output.includes(LEVELS.STOP) ? console.error : console.log)(output);
  process.exitCode = code;
}
