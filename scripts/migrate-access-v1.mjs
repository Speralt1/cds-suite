#!/usr/bin/env node
/**
 * scripts/migrate-access-v1.mjs — Migración de `users/{uid}` al modelo de
 * acceso v1 (doc 18 §3, 18a §H).
 *
 * DRY RUN por defecto: imprime el plan por usuario y no escribe nada.
 * `--apply` escribe (role se conserva; accessSchemaVersion 1; updatedAt =
 * serverTimestamp; updatedBy = "system:migrate-access-v1"). Idempotente: los
 * documentos que ya son v1 se saltan (no pisa ediciones de un admin).
 *
 * Uso:
 *   node scripts/migrate-access-v1.mjs --emulator [--apply] [--pastor-home finance|calendar] [--only <uid>] [--json out.json] [--summary]
 *   node scripts/migrate-access-v1.mjs --project <id> [--summary] [--apply --confirm <id>]
 *
 * `--summary` (doc 20 §10): imprime SOLO conteos agregados, sin uid, nombre ni
 * correo de nadie. Con `--json`, el archivo también lleva solo el agregado.
 * Es el modo para revisar el dry-run de producción sin exponer datos personales.
 *
 * Interlocks:
 *   - Emulador: FIRESTORE_EMULATOR_HOST seteado (o `--emulator`, que lo fija en
 *     127.0.0.1:8080) y proyecto `demo-*` (por defecto demo-cds-suite).
 *   - Sin emulador: exige `--project <id>` explícito. `--apply` contra un
 *     proyecto que no es emulador exige además `--confirm <id>` idéntico,
 *     `CDS_ALLOW_PRODUCTION_MIGRATION=<id>` y una TTY interactiva donde se
 *     vuelve a escribir el id.
 *   - Nunca imprime correos en claro (solo `s***@g***.com`).
 *
 * Planner: functions/shared/access.js (compilado desde lib/shared/access.ts).
 * Admin SDK: functions/node_modules (sin dependencias nuevas en la raíz).
 *
 * Códigos de salida: 0 ok · 1 uso/interlock · 2 hay roles inválidos · 3 error al escribir.
 */

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const {
  planAccessMigration,
  MIGRATION_ACTOR,
  LEGACY_ROLE_ACCESS,
  isLegacyRole,
  effectivePermissions,
  modulesForPermissions,
  deriveLegacyRole,
} = requireFromFunctions("./shared/access.js");

export const DEFAULT_EMULATOR_PROJECT = "demo-cds-suite";
export const DEFAULT_FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
export const BATCH_LIMIT = 400;

export const USAGE = `Uso:
  node scripts/migrate-access-v1.mjs --emulator [--apply] [--pastor-home finance|calendar] [--only <uid>] [--json out.json] [--summary]
  node scripts/migrate-access-v1.mjs --project <id> [--summary] [--apply --confirm <id>]

Por defecto es una simulación (dry run): no escribe nada.
--summary imprime solo conteos agregados (sin uid, nombre ni correo).`;

export class MigrationUsageError extends Error {}

/**
 * Lee argv + env y decide destino y modo. Pura: no toca process ni red.
 * @param {string[]} argv argumentos (sin node ni el script)
 * @param {Record<string, string|undefined>} env
 */
export function parseMigrationArgs(argv, env = {}) {
  const opts = {
    emulatorFlag: false,
    project: null,
    apply: false,
    confirm: null,
    pastorHome: "finance",
    only: null,
    json: null,
    summary: false,
    help: false,
  };
  const takeValue = (i, flag) => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new MigrationUsageError(`Falta el valor de ${flag}`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--emulator":
        opts.emulatorFlag = true;
        break;
      case "--apply":
        opts.apply = true;
        break;
      case "--summary":
        opts.summary = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--project":
        opts.project = takeValue(i, arg);
        i++;
        break;
      case "--confirm":
        opts.confirm = takeValue(i, arg);
        i++;
        break;
      case "--pastor-home":
        opts.pastorHome = takeValue(i, arg);
        i++;
        break;
      case "--only":
        opts.only = takeValue(i, arg);
        i++;
        break;
      case "--json":
        opts.json = takeValue(i, arg);
        i++;
        break;
      default:
        throw new MigrationUsageError(`Argumento desconocido: ${arg}`);
    }
  }
  if (opts.help) return { ...opts, mode: "help" };
  if (opts.pastorHome !== "finance" && opts.pastorHome !== "calendar") {
    throw new MigrationUsageError("--pastor-home debe ser finance o calendar");
  }

  const envHost = typeof env.FIRESTORE_EMULATOR_HOST === "string" && env.FIRESTORE_EMULATOR_HOST.trim() ? env.FIRESTORE_EMULATOR_HOST.trim() : null;

  // Destino emulador: --emulator o FIRESTORE_EMULATOR_HOST ya seteado.
  if (opts.emulatorFlag || envHost) {
    const project = opts.project || env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || DEFAULT_EMULATOR_PROJECT;
    if (!project.startsWith("demo-")) {
      throw new MigrationUsageError(
        `Con el emulador el proyecto debe empezar con "demo-" (recibido "${project}"). ` +
          "Si querías un proyecto real, quita FIRESTORE_EMULATOR_HOST y usa --project.",
      );
    }
    return { ...opts, mode: "emulator", project, emulatorHost: envHost || DEFAULT_FIRESTORE_EMULATOR_HOST, requiresTty: false };
  }

  // Destino real: solo con --project explícito.
  if (!opts.project) {
    throw new MigrationUsageError("Sin destino: usa --emulator (con proyecto demo-) o --project <id> explícito.");
  }
  if (opts.apply) {
    if (opts.confirm !== opts.project) {
      throw new MigrationUsageError(`--apply sobre "${opts.project}" exige --confirm ${opts.project} escrito exactamente.`);
    }
    if (env.CDS_ALLOW_PRODUCTION_MIGRATION !== opts.project) {
      throw new MigrationUsageError(`--apply sobre "${opts.project}" exige CDS_ALLOW_PRODUCTION_MIGRATION=${opts.project}.`);
    }
  }
  return { ...opts, mode: "project", emulatorHost: null, requiresTty: opts.apply };
}

// ---------- Presentación ----------

function fmtValue(value) {
  if (value === undefined) return "(sin campo)";
  if (value === null) return "null";
  if (value && typeof value === "object" && typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

/** Diff exacto que se escribiría: [{ field, before, after }]. `updatedAt` = serverTimestamp. */
export function fieldDiff(row, doc) {
  if (row.status !== "migrate") return [];
  const out = Object.entries(row.changes).map(([field, after]) => ({ field, before: fmtValue(doc[field]), after: fmtValue(after) }));
  out.push({ field: "updatedAt", before: fmtValue(doc.updatedAt), after: "serverTimestamp()" });
  return out;
}

export function formatRow(row, diff) {
  const list = (v) => (v && v.length ? v.join(", ") : "—");
  const lines = [
    `── ${row.uid} ─────────────────────────────`,
    `  nombre            ${row.displayName || "—"}`,
    `  correo            ${row.emailMasked || "—"}`,
    `  rol anterior      ${row.oldRole ?? "(sin rol)"}`,
    `  estado            ${row.status}`,
  ];
  if (row.status === "migrate") {
    lines.push(
      `  baseRole nuevo    ${row.baseRole}`,
      `  cargo             ${row.position}`,
      `  permisos          ${list(row.permissions)}`,
      `  efectivos         ${list(row.effective)}`,
      `  módulo inicial    ${row.homeModule}`,
    );
  }
  lines.push(`  áreas             [${row.areaIds.join(", ")}]`);
  for (const w of row.warnings) lines.push(`  advertencia       ${w}`);
  if (diff.length) {
    lines.push("  cambios:");
    for (const d of diff) lines.push(`    ${d.field}: ${d.before} → ${d.after}`);
  }
  return lines.join("\n");
}

export function summarize(rows) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  return { total: rows.length, migrate: count("migrate"), skip_already_v1: count("skip_already_v1"), skip_invalid_role: count("skip_invalid_role") };
}

// ---------- Agregado sin datos personales (--summary) ----------

const FINANCE_PREFIX = "finance.";
const MEMBERS_PREFIX = "members.";
const AREA_SCOPED = ["calendar.events.manage_assigned", "calendar.events.publish_assigned"];

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

/**
 * Agregado del plan, sin uid, nombre ni correo (doc 20 §10). Para cada usuario
 * usa el estado que tendría DESPUÉS de la migración (el plan para los legacy,
 * el documento tal cual para los que ya son v1).
 *
 * - `withoutModules`: activos que no verían ningún módulo.
 * - `needsAreas`: activos con un permiso por área (gestionar o publicar), sin
 *   `manage_all` y sin áreas.
 * - `rollbackRisk`: v1 activos cuyo `role` legacy da en las reglas anteriores
 *   permisos financieros que su perfil v1 no tiene (caveat de rollback, doc 20 §14).
 * - `incoherent`: v1 (activos o no) cuyo `role` no es el derivado de baseRole +
 *   permisos. Las reglas lo impiden desde la app; solo aparece por una edición
 *   manual en la consola o con Admin SDK, y rompe la equivalencia con Storage.
 * - `consolidation` (doc 23 §9, doc 25): quién vería Integrantes DESPUÉS de la
 *   migración. La migración nunca otorga members.*: solo admin (implícito) y
 *   grants explícitos ya guardados en perfiles v1.
 *   - `adminImplicit`: activos con rol base admin;
 *   - `explicitRead` / `explicitManage`: activos no admin con el permiso guardado
 *     (read sin manage / manage);
 *   - `inactiveWithGrant`: inactivos con algún members.* guardado (no acceden);
 *   - `legacyWithout`: legacy no admin que se migran y NO obtienen Integrantes.
 * @param {{ row: object, doc: Record<string, unknown> }[]} entries
 */
export function aggregateReport(entries) {
  const report = {
    total: entries.length,
    byStatus: { migrate: 0, skip_already_v1: 0, skip_invalid_role: 0 },
    byOldRole: {},
    active: 0,
    inactive: 0,
    byHomeModule: {},
    warnings: {},
    withoutModules: 0,
    needsAreas: 0,
    rollbackRisk: 0,
    incoherent: 0,
    consolidation: { adminImplicit: 0, explicitRead: 0, explicitManage: 0, inactiveWithGrant: 0, legacyWithout: 0 },
  };
  for (const { row, doc } of entries) {
    bump(report.byStatus, row.status);
    // Un rol fuera del catálogo se agrupa: su texto podría ser cualquier cosa.
    bump(report.byOldRole, row.oldRole === null ? "(sin rol)" : isLegacyRole(row.oldRole) ? row.oldRole : "(rol inválido)");
    const active = doc.active === true;
    if (active) report.active++;
    else report.inactive++;
    for (const w of row.warnings) bump(report.warnings, w.startsWith("Rol no válido") ? "Rol no válido" : w);
    if (row.status === "skip_invalid_role") continue;

    if (row.status === "skip_already_v1") {
      const perms = Array.isArray(doc.permissions) ? doc.permissions : [];
      const baseRole = doc.baseRole === "admin" ? "admin" : "standard";
      if (doc.role !== deriveLegacyRole(baseRole, perms)) report.incoherent++;
    }
    const after = row.status === "migrate" ? { ...doc, ...row.changes } : doc;
    const eff = effectivePermissions(after);
    const stored = after.accessSchemaVersion === 1 && Array.isArray(after.permissions) ? after.permissions : [];
    const isAdmin = (after.accessSchemaVersion === 1 ? after.baseRole : after.role) === "admin";
    const c = report.consolidation;
    if (!active && stored.some((p) => typeof p === "string" && p.startsWith(MEMBERS_PREFIX))) c.inactiveWithGrant++;
    if (active && isAdmin) c.adminImplicit++;
    else if (active && stored.includes("members.consolidation.manage")) c.explicitManage++;
    else if (active && stored.includes("members.consolidation.read")) c.explicitRead++;
    if (row.status === "migrate" && !isAdmin && !eff.has("members.consolidation.read")) c.legacyWithout++;
    bump(report.byHomeModule, row.status === "migrate" ? row.homeModule : typeof doc.homeModule === "string" ? doc.homeModule : "(sin módulo inicial)");
    if (!active) continue;
    if (modulesForPermissions(eff).length === 0) report.withoutModules++;
    const areas = Array.isArray(after.areaIds) ? after.areaIds : [];
    // manage_all implica manage_assigned pero no necesita áreas.
    if (areas.length === 0 && !eff.has("calendar.events.manage_all") && AREA_SCOPED.some((p) => eff.has(p))) report.needsAreas++;
    if (row.status === "skip_already_v1" && isLegacyRole(doc.role)) {
      const legacyFinance = LEGACY_ROLE_ACCESS[doc.role].permissions.filter((p) => p.startsWith(FINANCE_PREFIX));
      const grantsMore = doc.role === "admin" ? !eff.has("settings.manage") : legacyFinance.some((p) => !eff.has(p));
      if (grantsMore) report.rollbackRisk++;
    }
  }
  return report;
}

export function formatAggregate(report) {
  const pairs = (obj) => {
    const keys = Object.keys(obj).sort();
    return keys.length ? keys.map((k) => `${k}: ${obj[k]}`).join(" · ") : "—";
  };
  return [
    "Resumen agregado (sin datos personales)",
    `  total                         ${report.total}`,
    `  por estado                    migrar ${report.byStatus.migrate} · ya v1 ${report.byStatus.skip_already_v1} · rol inválido ${report.byStatus.skip_invalid_role}`,
    `  por rol anterior              ${pairs(report.byOldRole)}`,
    `  activos / inactivos           ${report.active} / ${report.inactive}`,
    `  módulo inicial                ${pairs(report.byHomeModule)}`,
    `  advertencias                  ${pairs(report.warnings)}`,
    `  activos sin ningún módulo     ${report.withoutModules}`,
    `  activos que requieren áreas   ${report.needsAreas}`,
    `  v1 con riesgo de rollback     ${report.rollbackRisk}`,
    `  v1 con role incoherente       ${report.incoherent}`,
    "Integrantes › Consolidación (la migración no otorga members.*)",
    `  admin (implícito, activos)    ${report.consolidation.adminImplicit}`,
    `  consolidation.read explícito  ${report.consolidation.explicitRead}`,
    `  consolidation.manage explícito ${report.consolidation.explicitManage}`,
    `  inactivos con permiso guardado ${report.consolidation.inactiveWithGrant}`,
    `  legacy que NO obtienen acceso ${report.consolidation.legacyWithout}`,
  ].join("\n");
}

// ---------- Ejecución ----------

async function confirmOnTty(project) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new MigrationUsageError("--apply sobre un proyecto real exige una terminal interactiva (TTY).");
  }
  console.log(`\nRecomendación: respalda antes con  gcloud firestore export gs://<bucket>/backup-${new Date().toISOString().slice(0, 10)} --project ${project}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const typed = (await rl.question(`Escribe el id del proyecto (${project}) para escribir los cambios: `)).trim();
    if (typed !== project) throw new MigrationUsageError("El id escrito no coincide. No se escribió nada.");
  } finally {
    rl.close();
  }
}

function loadAdmin(project, emulatorHost) {
  if (emulatorHost) process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;
  const { initializeApp, getApps } = requireFromFunctions("firebase-admin/app");
  const { getFirestore, FieldValue } = requireFromFunctions("firebase-admin/firestore");
  const name = "cds-migrate-access-v1";
  const app = getApps().find((a) => a.name === name) || initializeApp({ projectId: project }, name);
  return { db: getFirestore(app), FieldValue };
}

/**
 * Corre la migración con opciones ya parseadas. Devuelve { rows, summary, written, failed }.
 * @param {ReturnType<typeof parseMigrationArgs>} parsed
 */
export async function runMigration(parsed, { log = console.log } = {}) {
  const { db, FieldValue } = loadAdmin(parsed.project, parsed.emulatorHost);
  const destino = parsed.mode === "emulator" ? `emulador ${parsed.emulatorHost} · proyecto ${parsed.project}` : `PROYECTO REAL ${parsed.project}`;
  log(`Migración de acceso v1 · ${destino} · ${parsed.apply ? "APLICAR" : "simulación (no escribe)"} · pastor → ${parsed.pastorHome}`);

  let snaps;
  if (parsed.only) {
    const snap = await db.doc(`users/${parsed.only}`).get();
    snaps = snap.exists ? [snap] : [];
  } else {
    snaps = (await db.collection("users").get()).docs;
  }
  snaps.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const entries = snaps.map((snap) => {
    const data = snap.data() || {};
    const row = planAccessMigration(snap.id, data, { pastorHome: parsed.pastorHome });
    return { snap, doc: data, row, diff: fieldDiff(row, data) };
  });
  if (!parsed.summary) for (const e of entries) log(formatRow(e.row, e.diff));

  const summary = summarize(entries.map((e) => e.row));
  const aggregate = aggregateReport(entries);
  if (parsed.summary) log(formatAggregate(aggregate));
  else
    log(
      `\nResumen: ${summary.total} usuarios · migrar ${summary.migrate} · ya v1 ${summary.skip_already_v1} · rol inválido ${summary.skip_invalid_role}`,
    );

  let written = 0;
  const failed = [];
  if (parsed.apply) {
    if (parsed.requiresTty) await confirmOnTty(parsed.project);
    const pending = entries.filter((e) => e.row.status === "migrate");
    for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
      const chunk = pending.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      for (const { snap, row } of chunk) {
        // Precondición: si alguien editó el documento después de leerlo, el lote falla y se reporta.
        batch.update(snap.ref, { ...row.changes, updatedBy: MIGRATION_ACTOR, updatedAt: FieldValue.serverTimestamp() }, { lastUpdateTime: snap.updateTime });
      }
      try {
        await batch.commit();
        written += chunk.length;
      } catch (error) {
        const reason = error && error.code !== undefined ? `código ${error.code}` : "error";
        for (const { row } of chunk) failed.push({ uid: row.uid, reason });
      }
    }
    const failedDetail = parsed.summary ? "" : ` (${failed.map((f) => `${f.uid}: ${f.reason}`).join("; ")})`;
    log(`Escritos: ${written}${failed.length ? ` · fallidos: ${failed.length}${failedDetail}` : ""}`);
  } else {
    log("Simulación: no se escribió nada. Usa --apply para escribir.");
  }

  const rows = entries.map((e) => ({ ...e.row, diff: e.diff }));
  if (parsed.json) {
    const payload = parsed.summary
      ? { project: parsed.project, mode: parsed.mode, apply: parsed.apply, summary, aggregate, written, failed: failed.length }
      : { project: parsed.project, mode: parsed.mode, apply: parsed.apply, summary, written, failed, rows };
    writeFileSync(parsed.json, `${JSON.stringify(payload, null, 2)}\n`);
    log(`Reporte JSON: ${parsed.json}`);
  }
  return { rows, summary, aggregate, written, failed };
}

async function main() {
  let parsed;
  try {
    parsed = parseMigrationArgs(process.argv.slice(2), process.env);
  } catch (error) {
    if (error instanceof MigrationUsageError) {
      console.error(`Error: ${error.message}\n\n${USAGE}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  if (parsed.mode === "help") {
    console.log(USAGE);
    return;
  }
  try {
    const { summary, failed } = await runMigration(parsed);
    if (failed.length) process.exitCode = 3;
    else if (summary.skip_invalid_role > 0) process.exitCode = 2;
  } catch (error) {
    if (error instanceof MigrationUsageError) {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.error(`Error: ${error && error.message ? error.message : error}`);
    process.exitCode = 3;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
  // Admin SDK deja conexiones gRPC abiertas: salir explícitamente.
  process.exit(process.exitCode ?? 0);
}
