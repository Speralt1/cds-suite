#!/usr/bin/env node
// Compila lib/shared/*.ts (TS puro, fuente única) a CommonJS en functions/shared/*.js.
//
//   node scripts/build-shared.mjs           → escribe functions/shared/*.js
//   node scripts/build-shared.mjs --check   → exit 1 si algún archivo falta, difiere o sobra (no escribe)
//
// El JS generado se commitea. tests/functions/shared-build.test.ts verifica la
// frescura y el predeploy de Functions corre --check.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SHARED_SRC_DIR = path.join(ROOT, "lib", "shared");
export const SHARED_OUT_DIR = path.join(ROOT, "functions", "shared");
export const SHARED_FILES = Object.freeze([
  "types",
  "access",
  "dates",
  "recurrence",
  "calendar-core",
  "public-calendar",
  "share-token-format",
  "members",
]);

export const generatedHeader = (name) =>
  `// GENERADO por scripts/build-shared.mjs desde lib/shared/${name}.ts — NO EDITAR.\n`;

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: false,
  removeComments: false,
  isolatedModules: true,
  newLine: ts.NewLineKind.LineFeed,
};

/** Transpila un archivo TS (contenido) a CommonJS con el header de generado. */
export function compileShared(name, source) {
  const result = ts.transpileModule(source, {
    compilerOptions: COMPILER_OPTIONS,
    fileName: `${name}.ts`,
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    const text = errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n");
    throw new Error(`build-shared: ${name}.ts no compila:\n${text}`);
  }
  return generatedHeader(name) + result.outputText;
}

/** Salida esperada en memoria: Map<"x.js", contenido>. */
export function buildSharedOutputs() {
  const out = new Map();
  for (const name of SHARED_FILES) {
    const source = fs.readFileSync(path.join(SHARED_SRC_DIR, `${name}.ts`), "utf8");
    out.set(`${name}.js`, compileShared(name, source));
  }
  return out;
}

/** Diferencias entre lo esperado y lo que hay en functions/shared. */
export function checkSharedOutputs() {
  const expected = buildSharedOutputs();
  const problems = [];
  for (const [file, content] of expected) {
    const target = path.join(SHARED_OUT_DIR, file);
    if (!fs.existsSync(target)) problems.push(`falta functions/shared/${file}`);
    else if (fs.readFileSync(target, "utf8") !== content) problems.push(`desactualizado functions/shared/${file}`);
  }
  if (fs.existsSync(SHARED_OUT_DIR)) {
    for (const file of fs.readdirSync(SHARED_OUT_DIR)) {
      if (file.endsWith(".js") && !expected.has(file)) problems.push(`sobra functions/shared/${file}`);
    }
  }
  return problems;
}

function writeSharedOutputs() {
  fs.mkdirSync(SHARED_OUT_DIR, { recursive: true });
  const expected = buildSharedOutputs();
  for (const [file, content] of expected) fs.writeFileSync(path.join(SHARED_OUT_DIR, file), content);
  return [...expected.keys()];
}

function main(argv) {
  if (argv.includes("--check")) {
    const problems = checkSharedOutputs();
    if (problems.length) {
      console.error("functions/shared no coincide con lib/shared. Corre `npm run build:shared` y commitea el resultado:");
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`functions/shared al día (${SHARED_FILES.length} archivos).`);
    return;
  }
  const written = writeSharedOutputs();
  console.log(`functions/shared generado: ${written.join(", ")}`);
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) main(process.argv.slice(2));
