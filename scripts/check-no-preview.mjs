#!/usr/bin/env node
// Gate de la build productiva (doc 25 §2): revisa `out/` después de `npm run build`.
//
//   node scripts/check-no-preview.mjs [--out out]
//
// DEBE incluir: las rutas de Integrantes › Consolidación V1.
// DEBE excluir: /preview, fixtures y personas demo, providers/stores de la
// preview, el proyecto demo de los emuladores y los dominios ficticios.
// Exit 1 con la lista de problemas; no escribe nada.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_ROUTES = Object.freeze([
  "integrantes.html",
  "integrantes/consolidacion.html",
  "integrantes/consolidacion/atencion.html",
  "integrantes/consolidacion/personas.html",
  "integrantes/consolidacion/nueva.html",
  "integrantes/consolidacion/persona.html",
]);

/** Texto que nunca debe aparecer en la build productiva (código o HTML). */
export const FORBIDDEN_TEXT = Object.freeze([
  "demo-cds-suite", // proyecto de los emuladores
  "@cds.test", // usuarios ficticios de seeds/tests
  "@example.test", // personas ficticias del seed de Integrantes
  "PruebaCDS",
  "suite-preview", // componentes/lib de la preview (PR #3/#4)
  "finance-preview",
  "DEMO_NOW",
  "Simulación: se abriría WhatsApp", // WhatsApp simulado de la preview
  "Ver como", // simulador de perfiles de la preview
  "+56900000", // teléfonos ficticios del seed
]);

/** Campos sensibles excluidos de V1 (doc 23 §1/§3): no pueden viajar en el bundle. */
export const FORBIDDEN_FIELDS = Object.freeze(["faithConfession", "baptized", "birthDate", "initialNotes", "isMinor"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function checkOut(outDir) {
  const problems = [];
  if (!fs.existsSync(outDir)) return [`no existe ${path.relative(ROOT, outDir) || outDir}: corre npm run build`];
  const files = walk(outDir);
  const rel = files.map((f) => path.relative(outDir, f).split(path.sep).join("/"));

  for (const route of REQUIRED_ROUTES) if (!rel.includes(route)) problems.push(`falta la ruta productiva ${route}`);
  for (const r of rel) if (/(^|\/)preview(\/|\.html$)/.test(r)) problems.push(`ruta de preview en la build: ${r}`);

  for (let i = 0; i < files.length; i++) {
    if (!/\.(html|js|css|json|txt|webmanifest)$/.test(files[i])) continue;
    const text = fs.readFileSync(files[i], "utf8");
    for (const needle of FORBIDDEN_TEXT) if (text.includes(needle)) problems.push(`"${needle}" en ${rel[i]}`);
    for (const field of FORBIDDEN_FIELDS) if (new RegExp(`\\b${field}\\b`).test(text)) problems.push(`campo excluido "${field}" en ${rel[i]}`);
  }
  return problems;
}

/** Fuente: no debe existir app/preview ni imports de la preview en código productivo. */
export function checkSource() {
  const problems = [];
  for (const dir of ["app/preview", "app/(preview)", "components/suite-preview", "components/finance-preview", "lib/suite-preview", "lib/finance-preview"]) {
    if (fs.existsSync(path.join(ROOT, dir))) problems.push(`existe ${dir} en la rama productiva`);
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf("--out");
  const outDir = path.resolve(ROOT, i > -1 ? process.argv[i + 1] : "out");
  const problems = [...checkSource(), ...checkOut(outDir)];
  if (problems.length) {
    console.error(`check-no-preview: ${problems.length} problema(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`check-no-preview: OK (${REQUIRED_ROUTES.length} rutas de Integrantes presentes; sin preview, demo ni campos excluidos)`);
}
