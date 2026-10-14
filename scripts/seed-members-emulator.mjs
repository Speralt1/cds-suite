/**
 * scripts/seed-members-emulator.mjs — Datos FICTICIOS de Integrantes ›
 * Consolidación V1 (doc 23) para revisar la UX contra los emuladores.
 *
 * SOLO EMULADORES: lo llama `runSeed` de seed-platform-calendar-emulator.mjs,
 * que ya exigió el entorno local (assertSeedEnvironment) antes de escribir.
 * `seedMembers` vuelve a verificar que el Admin SDK apunte al emulador.
 *
 * Cómo se arma: las personas, visitas, seguimientos y cambios se producen con
 * el MISMO servicio de las Functions (functions/members/service.js) sobre un
 * store en memoria con un reloj que avanza por una línea de tiempo relativa a
 * "hoy" (America/Santiago). Así el esquema, la proyección, las revisiones y la
 * auditoría son exactamente los de producción; luego se copian al emulador.
 *
 * Datos obviamente ficticios: apellidos "Prueba/Ejemplo/Ficticia/Muestra/Demo",
 * teléfonos +56 9 0000 00NN (no asignables) y correos @example.test.
 *
 * Cobertura de alertas (doc 23 §7): sin responsable (vacío, sin permiso,
 * inactivo), sin primer contacto > 48 h, seguimiento vencido, volvió, varios
 * días sin volver (> 21 d), posible duplicado por teléfono y por correo; todos
 * los estados, una persona integrante y una con "No contactar".
 *
 * Responsables sin permiso: `seed-lider-jovenes` (solo calendario) y
 * `seed-inactivo` (inactivo) se asignan como si hubieran tenido manage en ese
 * momento (en el store en memoria) y lo hubieran perdido después: así se ve la
 * alerta "Sin responsable" con datos reales de usuarios sembrados.
 *
 * Idempotente: requestIds fijos → ids fijos; re-correrlo borra y reescribe las
 * personas sembradas con todo su historial (también lo agregado desde la UI a
 * esas personas). Las personas creadas desde la UI no se tocan.
 */

import { createRequire } from "node:module";

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const { localToday, addDays } = requireFromFunctions("./shared/dates.js");
const { createMembersService, deterministicId } = requireFromFunctions("./members/service.js");
const { MEMBERS_COLLECTIONS } = requireFromFunctions("./shared/members.js");

/** Coordinadora que registra todo (v1 con members.consolidation.manage). */
export const SEED_MEMBERS_ACTOR = "seed-coord-consolidacion";
/** Responsables que "perdieron" el permiso después de ser asignados. */
export const SEED_MEMBERS_STALE_OWNERS = Object.freeze(["seed-lider-jovenes", "seed-inactivo"]);
/** Actividad del calendario sembrada que se usa como llegada/visita. */
export const SEED_MEMBERS_EVENT_ID = "seed-culto-dominical";

const phone = (n) => `+5690000${String(n).padStart(4, "0")}`;

/** Instante de un día local (≈ 11–12 h en Santiago, + `minutes`), nunca posterior a `nowMs`. */
function instantOf(ymd, minutes, nowMs) {
  return Math.min(Date.parse(`${ymd}T15:00:00Z`) + minutes * 60_000, nowMs);
}

/** Store en memoria con la interfaz de functions/members/firestore-store.js. */
function memoryStore(clock, users, events) {
  const cols = new Map();
  const col = (name) => {
    if (!cols.has(name)) cols.set(name, new Map());
    return cols.get(name);
  };
  for (const [uid, data] of Object.entries(users)) col("users").set(uid, structuredClone(data));
  for (const [id, data] of Object.entries(events)) col("calendarEvents").set(id, structuredClone(data));
  const read = (c, id) => (col(c).has(id) ? structuredClone(col(c).get(id)) : null);
  return {
    cols,
    getUser: async (uid) => read("users", uid),
    listUsers: async () => [...col("users").entries()].map(([uid, data]) => ({ uid, data: structuredClone(data) })),
    getCalendarEvent: async (id) => read("calendarEvents", id),
    findPeople: async (field, value, limit) =>
      [...col(MEMBERS_COLLECTIONS.people).entries()]
        .filter(([, d]) => d[field] === value)
        .slice(0, limit)
        .map(([id, data]) => ({ id, data: structuredClone(data) })),
    serverTimestamp: () => new Date(clock.now()),
    runTransaction: async (fn) => {
      const writes = [];
      const result = await fn({
        get: async (c, id) => read(c, id),
        create: (c, id, data) => {
          if (col(c).has(id)) throw new Error(`seed: ${c}/${id} ya existe`);
          writes.push([c, id, structuredClone(data), false]);
        },
        update: (c, id, data) => writes.push([c, id, structuredClone(data), true]),
      });
      for (const [c, id, data, merge] of writes) col(c).set(id, merge ? { ...col(c).get(id), ...data } : data);
      return result;
    },
  };
}

/**
 * Guion de la línea de tiempo. Cada persona: `create` (días atrás + payload) y
 * pasos posteriores. `d(n)` = fecha local n días atrás; `f(n)` = n días adelante.
 */
function script(today) {
  const d = (n) => addDays(today, -n);
  const f = (n) => addDays(today, n);
  return [
    {
      key: "01",
      note: "Por contactar · registrada hoy · sin responsable",
      create: { daysAgo: 0, fullName: "Valentina Prueba", phone: phone(1), email: "valentina.prueba@example.test", firstVisitDate: d(0), arrivalSource: "redes_sociales" },
      steps: [],
    },
    {
      key: "02",
      note: "Por contactar · sin primer contacto > 48 h",
      create: { daysAgo: 5, fullName: "Tomás Ejemplo", phone: phone(2), firstVisitDate: d(5), arrivalSource: "invitacion", invitedBy: "Hermana Rosa (ficticia)", followUpOwnerUid: SEED_MEMBERS_ACTOR },
      steps: [],
    },
    {
      key: "03",
      note: "En seguimiento · seguimiento vencido",
      create: { daysAgo: 20, fullName: "Camila Ficticia", phone: phone(3), email: "camila.ficticia@example.test", firstVisitDate: d(20), followUpOwnerUid: SEED_MEMBERS_ACTOR, visitNote: "Vino con una amiga." },
      steps: [
        { daysAgo: 18, followUp: { contactDate: d(18), type: "whatsapp", result: "contactado", nextAction: "Invitarla a la reunión de jóvenes", nextActionDate: d(3), applyStatus: "en_seguimiento" } },
      ],
    },
    {
      key: "04",
      note: "En seguimiento · volvió (visita reciente sin seguimiento posterior)",
      create: { daysAgo: 30, fullName: "Joaquín Muestra", phone: phone(4), email: "joaquin.muestra@example.test", firstVisitDate: d(30), followUpOwnerUid: SEED_MEMBERS_ACTOR },
      steps: [
        { daysAgo: 28, followUp: { contactDate: d(28), type: "llamada", result: "contactado", nextAction: "Llamar después del culto", nextActionDate: f(5), applyStatus: "en_seguimiento" } },
        { daysAgo: 2, visit: { date: d(2), note: "Llegó puntual al culto." } },
      ],
    },
    {
      key: "05",
      note: "En seguimiento · varios días sin volver (> 21 d)",
      create: { daysAgo: 40, fullName: "Fernanda Demo", phone: phone(5), firstVisitDate: d(40), arrivalSource: "paso_por_el_lugar", followUpOwnerUid: "seed-admin" },
      steps: [
        { daysAgo: 38, followUp: { contactDate: d(38), type: "presencial", result: "contactado", nextAction: "Invitar al desayuno", nextActionDate: f(6), applyStatus: "en_seguimiento" } },
      ],
    },
    {
      key: "06",
      note: "Integrándose · con visitas y seguimientos",
      create: { daysAgo: 60, fullName: "Ignacio Prueba", phone: phone(6), email: "ignacio.prueba@example.test", firstVisitDate: d(60), followUpOwnerUid: "seed-admin" },
      steps: [
        { daysAgo: 58, followUp: { contactDate: d(58), type: "whatsapp", result: "contactado", applyStatus: "en_seguimiento" } },
        { daysAgo: 45, visit: { date: d(45) } },
        { daysAgo: 30, status: { status: "integrandose" } },
        { daysAgo: 9, visit: { date: d(9) } },
        { daysAgo: 8, followUp: { contactDate: d(8), type: "llamada", result: "contactado", nextAction: "Presentarle el equipo de bienvenida", nextActionDate: f(10) } },
      ],
    },
    {
      key: "07",
      note: "Integrado · etapa integrante (misma persona)",
      create: { daysAgo: 120, fullName: "Rocío Ejemplo", phone: phone(7), email: "rocio.ejemplo@example.test", firstVisitDate: d(120), followUpOwnerUid: SEED_MEMBERS_ACTOR },
      steps: [
        { daysAgo: 118, followUp: { contactDate: d(118), type: "presencial", result: "contactado", applyStatus: "en_seguimiento" } },
        { daysAgo: 90, visit: { date: d(90) } },
        { daysAgo: 70, status: { status: "integrandose" } },
        { daysAgo: 14, status: { status: "integrado", confirmIntegrated: true } },
      ],
    },
    {
      key: "08",
      note: "Sin continuidad · se mudó",
      create: { daysAgo: 70, fullName: "Diego Ficticio", phone: phone(8), firstVisitDate: d(70), followUpOwnerUid: SEED_MEMBERS_ACTOR },
      steps: [
        { daysAgo: 66, followUp: { contactDate: d(66), type: "llamada", result: "sin_respuesta", nextAction: "Volver a llamar", nextActionDate: d(60) } },
        { daysAgo: 50, followUp: { contactDate: d(50), type: "whatsapp", result: "otro", note: "Contó que se cambia de ciudad." } },
        { daysAgo: 49, status: { status: "sin_continuidad", closedReason: "se_mudo" } },
      ],
    },
    {
      key: "09",
      note: "No contactar · sin continuidad (no desea contacto)",
      create: { daysAgo: 25, fullName: "Paula Muestra", phone: phone(9), email: "paula.muestra@example.test", firstVisitDate: d(25), followUpOwnerUid: SEED_MEMBERS_ACTOR },
      steps: [
        { daysAgo: 23, followUp: { contactDate: d(23), type: "whatsapp", result: "no_desea_contacto", applyStatus: "sin_continuidad", applyDoNotContact: true } },
      ],
    },
    {
      key: "10",
      note: "Posible duplicado por teléfono (mismo número que Tomás Ejemplo)",
      create: { daysAgo: 1, fullName: "Tomás Ejemplo Duplicado", phone: phone(2), firstVisitDate: d(1), followUpOwnerUid: SEED_MEMBERS_ACTOR },
      steps: [],
    },
    {
      key: "11",
      note: "Posible duplicado por correo (mismo correo que Camila Ficticia) · seguimiento pendiente",
      create: { daysAgo: 6, fullName: "Cami Ficticia", phone: phone(11), email: "camila.ficticia@example.test", firstVisitDate: d(6), followUpOwnerUid: SEED_MEMBERS_ACTOR },
      steps: [
        { daysAgo: 4, followUp: { contactDate: d(4), type: "whatsapp", result: "sin_respuesta", nextAction: "Escribirle de nuevo", nextActionDate: f(2) } },
      ],
    },
    {
      key: "12",
      note: "En seguimiento · responsable sin permiso de Consolidación (sin responsable)",
      create: { daysAgo: 15, fullName: "Benjamín Ejemplo", phone: phone(12), firstVisitDate: d(15), followUpOwnerUid: "seed-lider-jovenes" },
      steps: [
        { daysAgo: 13, followUp: { contactDate: d(13), type: "llamada", result: "contactado", nextAction: "Invitar al grupo de jóvenes", nextActionDate: f(3), applyStatus: "en_seguimiento" } },
      ],
    },
    {
      key: "13",
      note: "Por contactar · responsable inactivo (sin responsable) · sin primer contacto > 48 h",
      create: { daysAgo: 3, fullName: "Antonia Ficticia", phone: phone(13), email: "antonia.ficticia@example.test", firstVisitDate: d(3), followUpOwnerUid: "seed-inactivo" },
      steps: [],
    },
    {
      key: "14",
      note: "En seguimiento · llegó en una actividad del calendario · próxima acción hoy",
      create: { daysAgo: 10, fullName: "Lucas Muestra", phone: phone(14), firstVisitDate: d(10), calendarEventId: SEED_MEMBERS_EVENT_ID, arrivalSource: "actividad", followUpOwnerUid: SEED_MEMBERS_ACTOR },
      steps: [
        { daysAgo: 9, followUp: { contactDate: d(9), type: "presencial", result: "contactado", nextAction: "Confirmar asistencia del domingo", nextActionDate: f(0), applyStatus: "en_seguimiento" } },
        { daysAgo: 3, visit: { date: d(3), calendarEventId: SEED_MEMBERS_EVENT_ID } },
      ],
    },
  ];
}

/**
 * Construye todos los documentos con el servicio real (en memoria). Pura salvo
 * el reloj inyectado. `users`/`events`: [{ uid|id, data }] del seed principal.
 * @returns {Promise<{ today: string, people: Array<{id: string, data: object}>, visits: Array<{id: string, data: object}>, followUps: Array<{id: string, data: object}>, changes: Array<{id: string, data: object}>, notes: Record<string, string> }>}
 */
export async function buildMembersSeed({ nowMs, users, events }) {
  const today = localToday(nowMs);
  const userMap = Object.fromEntries(users.map((u) => [u.uid, u.data]));
  for (const uid of SEED_MEMBERS_STALE_OWNERS) {
    // Tenían manage cuando se les asignó (solo en memoria; el perfil sembrado no cambia).
    userMap[uid] = { ...userMap[uid], accessSchemaVersion: 1, active: true, baseRole: "standard", permissions: ["members.consolidation.manage"] };
  }
  const eventMap = Object.fromEntries(events.map((e) => [e.id, e.data]));
  let now = nowMs;
  const clock = { now: () => now };
  const store = memoryStore(clock, userMap, eventMap);
  const service = createMembersService({ store, clock, logger: { error: () => {} } });
  const actor = SEED_MEMBERS_ACTOR;
  const notes = {};

  for (const person of script(today)) {
    const { daysAgo, ...payload } = person.create;
    now = instantOf(addDays(today, -daysAgo), 0, nowMs);
    const created = await service.personCreate(actor, { requestId: `seed-members-${person.key}`, ...payload });
    const { personId } = created;
    notes[personId] = person.note;
    let revision = created.revision;
    let n = 0;
    for (const step of person.steps) {
      n += 1;
      now = instantOf(addDays(today, -step.daysAgo), n, nowMs);
      const requestId = `seed-members-${person.key}-${String(n).padStart(2, "0")}`;
      let res;
      if (step.visit) res = await service.visitCreate(actor, { requestId, personId, ...step.visit });
      else if (step.followUp) res = await service.followUpCreate(actor, { requestId, personId, ...step.followUp });
      else if (step.status) res = await service.statusChange(actor, { personId, expectedRevision: revision, ...step.status });
      else if (step.update) res = await service.personUpdate(actor, { personId, expectedRevision: revision, ...step.update });
      revision = res.revision;
    }
  }

  const dump = (name) => [...(store.cols.get(name) ?? new Map()).entries()].map(([id, data]) => ({ id, data }));
  return {
    today,
    people: dump(MEMBERS_COLLECTIONS.people),
    visits: dump(MEMBERS_COLLECTIONS.visits),
    followUps: dump(MEMBERS_COLLECTIONS.followUps),
    changes: dump(MEMBERS_COLLECTIONS.changes),
    notes,
  };
}

/** Ids de las personas sembradas (deterministas: actor + requestId fijo). */
export function seededPersonIds() {
  return Array.from({ length: 14 }, (_, i) => deterministicId(SEED_MEMBERS_ACTOR, "person", `seed-members-${String(i + 1).padStart(2, "0")}`));
}

/**
 * Escribe el seed en el emulador. Borra antes las personas sembradas y todo su
 * historial (en las 4 colecciones), luego escribe en lotes.
 * @param {{ db: FirebaseFirestore.Firestore, nowMs: number, users: Array<{uid: string, data: object}>, events: Array<{id: string, data: object}> }} deps
 */
export async function seedMembers({ db, nowMs, users, events }) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("seedMembers solo corre contra el emulador de Firestore.");
  const seed = await buildMembersSeed({ nowMs, users, events });
  const ids = seededPersonIds();

  const refs = ids.map((id) => db.doc(`${MEMBERS_COLLECTIONS.people}/${id}`));
  for (const name of [MEMBERS_COLLECTIONS.visits, MEMBERS_COLLECTIONS.followUps, MEMBERS_COLLECTIONS.changes]) {
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await db.collection(name).where("personId", "in", ids.slice(i, i + 30)).get();
      refs.push(...snap.docs.map((doc) => doc.ref));
    }
  }
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }

  const writes = [
    ...seed.people.map((x) => [MEMBERS_COLLECTIONS.people, x]),
    ...seed.visits.map((x) => [MEMBERS_COLLECTIONS.visits, x]),
    ...seed.followUps.map((x) => [MEMBERS_COLLECTIONS.followUps, x]),
    ...seed.changes.map((x) => [MEMBERS_COLLECTIONS.changes, x]),
  ];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [name, { id, data }] of writes.slice(i, i + 400)) batch.set(db.doc(`${name}/${id}`), data);
    await batch.commit();
  }

  return {
    people: seed.people.length,
    visits: seed.visits.length,
    followUps: seed.followUps.length,
    changes: seed.changes.length,
  };
}
