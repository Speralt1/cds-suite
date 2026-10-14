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
 *     [--today YYYY-MM-DD] [--since ISO] [--format text|json] [--allow-empty]
 *
 * Salida: 0 = OK (solo INFORMATIVO), 1 = REVISAR, 2 = STOP (también entrada
 * inválida o cualquier error inesperado: falla cerrada).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatReport, publicFindings, runMonitor } from "./index.mjs";
import { isIso, isYmd } from "./lib/validate.mjs";

const USAGE =
  "Uso: run.mjs --snapshot <actual.json> [--baseline <b.json>] [--previous <p.json>] [--config <c.json>] [--today YYYY-MM-DD] [--since ISO] [--format text|json] [--allow-empty]";
const VALUE_FLAGS = new Set(["--snapshot", "--baseline", "--previous", "--config", "--today", "--since", "--format"]);
// Solo la CLI fija la fecha de referencia, la ventana y el modo vacío: la config no puede hacerlo en silencio.
const CLI_ONLY = ["today", "since", "now", "allowEmpty"];

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (flag === "--allow-empty") {
      args.allowEmpty = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new Error("argumento desconocido");
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`falta valor para ${flag}`);
    if (args[flag.slice(2)] !== undefined) throw new Error(`${flag} repetido`);
    args[flag.slice(2)] = value;
  }
  if (!args.snapshot) throw new Error("falta --snapshot");
  if (args.today !== undefined && !isYmd(args.today)) throw new Error("--today debe ser una fecha real YYYY-MM-DD");
  if (args.since !== undefined && !isIso(args.since)) throw new Error("--since debe ser un instante ISO con zona");
  if (args.format !== undefined && !["text", "json"].includes(args.format)) throw new Error("--format debe ser text o json");
  return args;
}

/** Lee JSON; el error es genérico para no repetir contenido del archivo. */
function readJson(path, flag) {
  let text;
  try {
    text = readFileSync(resolve(path), "utf8");
  } catch {
    throw new Error(`no se pudo leer el archivo de ${flag}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`el archivo de ${flag} no es JSON válido`);
  }
}

function execute(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    return { code: 2, output: `STOP: ${e instanceof Error ? e.message : "argumentos inválidos"}.\n${USAGE}` };
  }
  if (args.help) return { code: 0, output: USAGE };
  let snapshot;
  let config = {};
  try {
    snapshot = readJson(args.snapshot, "--snapshot");
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("el archivo de --snapshot no contiene un objeto");
    if (args.baseline) snapshot = { ...snapshot, baseline: readJson(args.baseline, "--baseline") };
    if (args.previous) snapshot = { ...snapshot, previous: readJson(args.previous, "--previous") };
    if (args.config) config = readJson(args.config, "--config");
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("el archivo de --config no contiene un objeto");
    const forbidden = CLI_ONLY.filter((k) => k in config);
    if (forbidden.length) throw new Error(`la config no puede fijar ${forbidden.join(", ")} (usar los flags de la CLI)`);
  } catch (e) {
    return { code: 2, output: `STOP: ${e instanceof Error ? e.message : "entrada inválida"}.` };
  }
  const result = runMonitor(snapshot, {
    ...config,
    ...(args.today ? { today: args.today } : {}),
    ...(args.since ? { since: args.since } : {}),
    ...(args.allowEmpty ? { allowEmpty: true } : {}),
  });
  const output =
    args.format === "json"
      ? JSON.stringify({ verdict: result.verdict, exitCode: result.exitCode, context: result.context, findings: publicFindings(result.findings) }, null, 2)
      : formatReport(result);
  return { code: result.exitCode, output };
}

/** Ejecuta la CLI y devuelve { code, output } (sin process.exit, para poder testearla). Nunca lanza. */
export function main(argv) {
  try {
    return execute(argv);
  } catch (e) {
    return { code: 2, output: `STOP: error interno del monitor (${e instanceof Error ? e.name : "desconocido"}).` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let code = 2;
  try {
    const r = main(process.argv.slice(2));
    code = r.code;
    console.log(r.output);
  } catch {
    console.error("STOP: error interno del monitor.");
  }
  process.exitCode = code;
}
