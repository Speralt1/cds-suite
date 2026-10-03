#!/usr/bin/env node
/**
 * scripts/dev-platform.mjs — Experiencia local en un comando (doc 18 §8, R8).
 *
 *   npm run dev:platform    emuladores (Auth + Firestore + Functions, proyecto
 *                           demo-cds-suite) → espera puertos y Functions →
 *                           seed ficticio → next dev con el entorno demo.
 *   npm run dev:emulators   (--next-only) solo next dev con el entorno demo,
 *                           contra emuladores ya levantados.
 *
 * El entorno demo se pasa como variables de proceso, que Next NO pisa con
 * .env.local (las variables ya presentes en process.env tienen prioridad), así
 * que .env.local (producción) queda intacto y sin efecto en esta sesión.
 *
 * Se niega a arrancar si algún puerto está ocupado. Ctrl+C detiene todos los
 * procesos hijos (y sus grupos: Java del emulador, workers de Functions).
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = (name) => path.join(ROOT, "node_modules", ".bin", name);

export const DEMO_PROJECT = "demo-cds-suite";

/** Variables públicas de Next para el entorno local (valores ficticios, no son credenciales). */
export const DEMO_PUBLIC_ENV = Object.freeze({
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: DEMO_PROJECT,
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS: "true",
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${DEMO_PROJECT}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${DEMO_PROJECT}.appspot.com`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000000000",
});

export const SEED_ENV = Object.freeze({
  CDS_SEED_LOCAL: "true",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  GCLOUD_PROJECT: DEMO_PROJECT,
});

const EMULATOR_PORTS = [8080, 9099, 5001, 4400, 4500, 9150];
const NEXT_PORT = 3000;
const FEED_PROBE = `http://127.0.0.1:5001/${DEMO_PROJECT}/southamerica-west1/calendarPublicFeed?t=probe`;

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    if (shuttingDown) throw new Error("detenido");
    await sleep(500);
  }
  throw new Error(`Tiempo de espera agotado: ${label}`);
}

const children = new Set();
let shuttingDown = false;

function pipeWithPrefix(stream, prefix, out) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) out.write(`${prefix} ${line}\n`);
  });
  stream.on("end", () => {
    if (buffer) out.write(`${prefix} ${buffer}\n`);
  });
}

function run(name, command, args, env, { persistent }) {
  const child = spawn(command, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const prefix = `[${name}]`;
  pipeWithPrefix(child.stdout, prefix, process.stdout);
  pipeWithPrefix(child.stderr, prefix, process.stderr);
  children.add(child);
  const exited = new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      children.delete(child);
      if (persistent && !shuttingDown) {
        console.error(`${prefix} terminó inesperadamente (${signal || code}). Deteniendo todo.`);
        void shutdown(1);
      }
      resolve(code ?? (signal ? 1 : 0));
    });
  });
  return { child, exited };
}

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* ya terminó */
    }
  }
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[dev] Deteniendo procesos…");
  for (const child of children) killGroup(child, "SIGINT");
  const deadline = Date.now() + 15000;
  while (children.size && Date.now() < deadline) await sleep(250);
  for (const child of children) killGroup(child, "SIGKILL");
  await sleep(300);
  console.log("[dev] Listo.");
  process.exit(code);
}

async function assertPortsFree(ports) {
  const busy = [];
  for (const port of ports) if (await portInUse(port)) busy.push(port);
  if (busy.length) {
    console.error(`[dev] Puertos ocupados: ${busy.join(", ")}. Detén lo que los usa (¿otros emuladores o next dev?) y vuelve a intentar.`);
    process.exit(1);
  }
}

function startNext() {
  const env = { ...process.env, ...DEMO_PUBLIC_ENV };
  delete env.NODE_ENV;
  console.log(`[dev] next dev con ${DEMO_PROJECT} y emuladores (sobrescribe .env.local sin modificarlo) → http://localhost:${NEXT_PORT}`);
  return run("next", BIN("next"), ["dev", "--webpack", "--port", String(NEXT_PORT)], env, { persistent: true });
}

async function main() {
  const nextOnly = process.argv.includes("--next-only");
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  if (nextOnly) {
    await assertPortsFree([NEXT_PORT]);
    const ready = (await portInUse(8080)) && (await portInUse(9099));
    if (!ready) console.warn("[dev] Aviso: no veo los emuladores en 8080/9099. Levántalos con `npm run emulators:platform`.");
    startNext();
    return;
  }

  await assertPortsFree([...EMULATOR_PORTS, NEXT_PORT]);
  console.log(`[dev] Levantando emuladores (auth, firestore, functions) · proyecto ${DEMO_PROJECT}`);
  run("emul", BIN("firebase"), ["emulators:start", "--only", "auth,firestore,functions", "--project", DEMO_PROJECT], { ...process.env }, { persistent: true });

  await waitFor(async () => (await portInUse(8080)) && (await portInUse(9099)) && (await portInUse(5001)), "puertos 8080/9099/5001", 120000);
  await waitFor(
    async () => {
      try {
        const res = await fetch(FEED_PROBE);
        return res.status === 404;
      } catch {
        return false;
      }
    },
    "Functions cargadas (calendarPublicFeed)",
    120000,
  );
  console.log("[dev] Emuladores listos. Sembrando datos ficticios…");

  const seed = run("seed", process.execPath, [path.join(ROOT, "scripts", "seed-platform-calendar-emulator.mjs")], { ...process.env, ...SEED_ENV }, { persistent: false });
  const seedCode = await seed.exited;
  if (seedCode !== 0) {
    console.error("[dev] El seed falló. Deteniendo todo.");
    await shutdown(1);
    return;
  }
  startNext();
  console.log("[dev] Ctrl+C detiene emuladores y Next.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`[dev] ${error && error.message ? error.message : error}`);
    void shutdown(1);
  });
}
