#!/usr/bin/env node
/**
 * scripts/verify-functions-package.mjs
 *
 * Builds the Functions source archive EXACTLY as `firebase deploy --only
 * functions` would (repo-pinned firebase-tools: same config normalization,
 * same `prepareFunctionsUpload`, same ignore handling), WITHOUT deploying or
 * contacting Google: packaging is a purely local step of the deploy.
 *
 * It prints only the archive's file NAMES (never contents), fails if any
 * secret/local file or node_modules made it in, or if a required source file
 * is missing, and deletes the temporary archive.
 *
 * Usage: node scripts/verify-functions-package.mjs [--config firebase.json]
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lib = (p) => require(resolve(projectDir, "node_modules/firebase-tools/lib", p));
const { version } = require(resolve(projectDir, "node_modules/firebase-tools/package.json"));
const projectConfig = lib("functions/projectConfig.js");
const { prepareFunctionsUpload } = lib("deploy/functions/prepareFunctionsUpload.js");

const configArg = process.argv.indexOf("--config");
const configPath = resolve(projectDir, configArg > -1 ? process.argv[configArg + 1] : "firebase.json");
const firebaseJson = JSON.parse(readFileSync(configPath, "utf8"));

// Same steps as node_modules/firebase-tools/lib/deploy/functions/prepare.js.
const normalized = projectConfig.normalizeAndValidate(firebaseJson.functions);
const localCfg = projectConfig.requireLocal(projectConfig.configForCodebase(normalized, "default"), "remote");
const sourceDir = resolve(projectDir, localCfg.source);

// Every function here is gcfv2 (onRequest/onSchedule from firebase-functions/v2)
// -> zip export, no additional sources, no runtime config.
const packaged = await prepareFunctionsUpload(projectDir, sourceDir, { ...localCfg, ignore: localCfg.ignore && [...localCfg.ignore] }, [], undefined, {
  exportType: "zip",
});

let names;
try {
  names = execFileSync("unzip", ["-Z1", packaged.pathToSource], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .sort();
} finally {
  rmSync(packaged.pathToSource, { force: true });
}

const forbidden = names.filter((n) => /(^|\/)\.secret\.local$/.test(n) || /\.local$/.test(n) || /(^|\/)\.env/.test(n) || n.startsWith("node_modules/"));
const required = ["index.js", "package.json", "package-lock.json", "sumup/core.js", "sumup/engine.js", "sumup/firestore-store.js"];
const missing = required.filter((r) => !names.includes(r));

console.log(`firebase-tools ${version} · config ${configPath.replace(projectDir + "/", "")}`);
console.log(`functions.ignore: ${JSON.stringify(localCfg.ignore ?? null)}${localCfg.ignore ? "" : " (CLI default: node_modules, .git)"}`);
console.log(`archive entries (${names.length}): ${names.join(", ")}`);
console.log(`forbidden entries: ${forbidden.length ? forbidden.join(", ") : "none"}`);
console.log(`missing required: ${missing.length ? missing.join(", ") : "none"}`);
console.log(`temporary archive deleted: ${packaged.pathToSource.split("/").pop()}`);
if (forbidden.length || missing.length) {
  console.log("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
