#!/usr/bin/env node
/**
 * scripts/seed-outreach-emulator.mjs — «Ve por los tuyos» FICTICIO para revisar la UX local.
 *
 * SOLO EMULADORES (mismo interlock que el seed de plataforma). Usa el servicio real
 * de las Functions (functions/outreach/service.js) con el store Admin, así que
 * esquema, auditoría, enlaces de mesa e importación son los de producción.
 *
 * Crea: coordinacion.evento@cds.test (coordinación + consolidación lectura),
 * mesa01..mesa35@cds.test (seguimiento asignado), edición vplt-2026 (evento 2026-11-28,
 * estado «evento»), equipo, 35 mesas con enlace emitido y ~300 inscripciones ficticias
 * importadas con la operación real (teléfonos +56900000xxx, correos @example.test).
 *
 * Idempotente: borra la edición vplt-2026 (y sus inscripciones/decisiones/lotes) y la rehace.
 * Uso: `npm run seed:outreach` (o automático en `npm run dev:platform`).
 */

import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { SEED_AUTH_HOST, SEED_PASSWORD, SEED_PROJECT, assertSeedEnvironment } from "./seed-platform-calendar-emulator.mjs";

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));

export const OUTREACH_EDITION = "vplt-2026";
export const OUTREACH_EVENT_DATE = "2026-11-28";
export const COORDINATOR = Object.freeze({ uid: "seed-coord-evento", email: "coordinacion.evento@cds.test", displayName: "Coordinación del evento (prueba)" });
export const TABLE_COUNT = 35;
export const leaderOf = (n) => {
  const s = String(n).padStart(2, "0");
  return { uid: `seed-mesa${s}`, email: `mesa${s}@cds.test`, displayName: `Líder de mesa ${s} (prueba)` };
};
export const tableUrlFor = (editionId, number, token) => `http://localhost:3000/mesa#${editionId}.${number}.${token}`;

async function loadFixtures() {
  if (process.env.VITEST) return import("../lib/outreach/sim/fixtures.ts");
  (await import("tsx/esm/api")).register();
  (await import("tsx/cjs/api")).register();
  return import(new URL("../lib/outreach/sim/fixtures.ts", import.meta.url).href);
}

async function authRequest(path, body) {
  const res = await fetch(`http://${SEED_AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${SEED_PROJECT}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Auth emulator ${path}: ${json?.error?.message || res.status}`);
  return json;
}

async function resetAuthUser(u) {
  const found = await authRequest("accounts:lookup", { localId: [u.uid], email: [u.email] });
  for (const existing of found.users || []) await authRequest("accounts:delete", { localId: existing.localId });
  await authRequest("accounts", { localId: u.uid, email: u.email, password: SEED_PASSWORD, displayName: u.displayName, emailVerified: true });
}

function loadAdmin() {
  const { initializeApp, getApps } = requireFromFunctions("firebase-admin/app");
  const fs = requireFromFunctions("firebase-admin/firestore");
  const name = "cds-seed-outreach";
  const app = getApps().find((a) => a.name === name) || initializeApp({ projectId: SEED_PROJECT }, name);
  return { db: fs.getFirestore(app), FieldValue: fs.FieldValue, FieldPath: fs.FieldPath };
}

const v1 = (permissions, extra) => ({ accessSchemaVersion: 1, role: "leader", active: true, baseRole: "standard", position: "Líder", permissions, areaIds: [], homeModule: "calendar", ...extra });

export async function seedOutreach({ env = process.env, count = 300 } = {}) {
  assertSeedEnvironment(env);
  const { db, FieldValue, FieldPath } = loadAdmin();
  const { simRegistrations } = await loadFixtures();
  const { createOutreachService } = requireFromFunctions("./outreach/service.js");
  const { createOutreachStore } = requireFromFunctions("./outreach/firestore-store.js");
  const service = createOutreachService({ store: createOutreachStore({ db, FieldValue, FieldPath }), clock: { now: () => Date.now() }, randomBytes: crypto.randomBytes });

  const leaders = Array.from({ length: TABLE_COUNT }, (_, i) => leaderOf(i + 1));
  const accounts = [COORDINATOR, ...leaders];
  for (const u of accounts) await resetAuthUser(u);
  await db.doc(`users/${COORDINATOR.uid}`).set(v1(["members.outreach.coordinate", "members.consolidation.read"], { email: COORDINATOR.email, displayName: COORDINATOR.displayName, position: "Coordinación" }));
  for (const u of leaders) await db.doc(`users/${u.uid}`).set(v1(["members.outreach.followup_assigned"], { email: u.email, displayName: u.displayName }));

  // Reinicio de la edición ficticia.
  await db.recursiveDelete(db.doc(`outreachEditions/${OUTREACH_EDITION}`));
  for (const col of ["outreachRegistrations", "outreachDecisions", "outreachAssignmentBatches", "outreachInbox", "outreachOutbox", "outreachTableMarks"]) {
    const snap = await db.collection(col).where("editionId", "==", OUTREACH_EDITION).get();
    for (const d of snap.docs) await db.recursiveDelete(d.ref);
  }

  await service.editionCreate(COORDINATOR.uid, { year: 2026, eventDate: OUTREACH_EVENT_DATE, maxPerOwner: 20 });
  await service.teamSet(COORDINATOR.uid, {
    editionId: OUTREACH_EDITION,
    members: [{ uid: COORDINATOR.uid, roles: ["coordinacion"] }, ...leaders.map((u) => ({ uid: u.uid, roles: ["responsable"] }))],
  });
  await service.tablesSet(COORDINATOR.uid, { editionId: OUTREACH_EDITION, tables: leaders.map((u, i) => ({ number: i + 1, leaderUid: u.uid })) });
  let rev = 1;
  rev = (await service.editionTransition(COORDINATOR.uid, { editionId: OUTREACH_EDITION, to: "inscripcion", expectedRevision: rev })).revision;

  const sim = simRegistrations({ count, editionId: OUTREACH_EDITION });
  const rows = sim.map((r, i) => ({
    externalId: r.externalRef.id,
    sourceRevision: r.externalRef.sourceRevision,
    editionYear: 2026,
    fullName: r.fullName,
    phone: r.phoneE164,
    email: r.email,
    invitedByName: r.invitedByName,
    adultConfirmed: true,
    consents: r.consents.map((c) => ({ purpose: c.purpose, textVersion: c.textVersion, grantedAt: c.grantedAt })),
    cancelled: false,
    attendedAt: i % 5 === 0 ? null : "2026-11-28T19:40",
  }));
  let imported = 0;
  for (let i = 0; i < rows.length; i += 1000) imported += (await service.importRegistrations(COORDINATOR.uid, { editionId: OUTREACH_EDITION, rows: rows.slice(i, i + 1000) })).report.created;
  await service.editionTransition(COORDINATOR.uid, { editionId: OUTREACH_EDITION, to: "evento", expectedRevision: rev });

  const urls = [];
  for (let n = 1; n <= TABLE_COUNT; n += 1) {
    const { token } = await service.tableLinkIssue(COORDINATOR.uid, { editionId: OUTREACH_EDITION, number: n });
    urls.push(tableUrlFor(OUTREACH_EDITION, n, token));
  }
  return { accounts: accounts.length, imported, tableUrls: urls };
}

async function main() {
  try {
    assertSeedEnvironment(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const r = await seedOutreach();
  console.log(`Ve por los tuyos (ficticio): edición ${OUTREACH_EDITION} · ${r.accounts} cuentas · ${r.imported} inscripciones · ${r.tableUrls.length} mesas.`);
  console.log(`Coordinación: ${COORDINATOR.email} · líderes: mesa01..mesa${TABLE_COUNT}@cds.test · contraseña ficticia ${SEED_PASSWORD}`);
  console.log("Enlaces de mesa (solo local, se muestran una vez; el enlace solo vale de noche el día del evento en producción, aquí depende del reloj):");
  for (const u of r.tableUrls) console.log(`  ${u}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(`Error en el seed de Ve por los tuyos: ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
