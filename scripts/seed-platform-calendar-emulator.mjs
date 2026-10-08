#!/usr/bin/env node
/**
 * scripts/seed-platform-calendar-emulator.mjs — Datos FICTICIOS para probar
 * Platform Core V1 + Calendario contra los emuladores (doc 18 §8, 18a §I).
 *
 * SOLO EMULADORES. Se niega a correr salvo que se cumplan todas:
 *   CDS_SEED_LOCAL=true · FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 ·
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 · proyecto demo-cds-suite
 *   (GCLOUD_PROJECT, por defecto demo-cds-suite).
 *
 * Usuarios (correos del dominio reservado @cds.test; ningún teléfono). La
 * contraseña de todas las cuentas es `PruebaCDS2026!`: es FICTICIA y solo
 * existe en el emulador de Auth local.
 *
 *   admin@cds.test           doc LEGACY role admin (prueba el fallback)
 *   pastor@cds.test          v1 Pastor (manage_all)
 *   finanzas@cds.test        doc LEGACY role finance
 *   lider.jovenes@cds.test   v1 Líder con áreas [jovenes]
 *   lider.sinarea@cds.test   v1 Líder sin áreas
 *   diacono.publica@cds.test v1 Diácono: manage_assigned + publish_assigned en [multimedia, varones]
 *   inactivo@cds.test        doc LEGACY role finance, active:false
 *   sinmodulos@cds.test      v1 activo SIN permisos ni áreas ("Aún no tienes módulos asignados")
 *
 * Áreas: 9 activas + Matrimonios inactiva (paleta cerrada). Actividades
 * relativas a "hoy" en America/Santiago, cada una con revision/lastChangeId y
 * sus changes/r{n} coherentes con firestore.rules. Los canarios de
 * SEED_CANARIES nunca deben salir en el calendario público.
 *
 * Enlace público: se crea con la MISMA lógica del callable
 * (functions/calendar/share-links.js + store Admin), así solo se guarda el
 * hash; el enlace en claro se imprime UNA vez.
 *
 * Finanzas: algunos movimientos FICTICIOS del mes anterior y del mes en curso
 * (hasta hoy), sin diezmos ni datos pastorales. Se escriben como
 * finanzas@cds.test con el helper productivo saveTransaction contra el emulador
 * (scripts/seed-platform-finance.ts), así pasan por firestore.rules igual que
 * la app y el resumen mensual queda encadenado. Ids fijos por mes: re-correr el
 * seed no los duplica ni los reescribe.
 *
 * Idempotente: ids fijos; re-correrlo resetea las cuentas, perfiles, áreas,
 * actividades (con su historial) y el enlace sembrados.
 */

import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const dates = requireFromFunctions("./shared/dates.js");
const { lastDateOf } = requireFromFunctions("./shared/calendar-core.js");
const { LEGACY_ROLE_ACCESS } = requireFromFunctions("./shared/access.js");

const { localToday, addDays, weekdayOf, nthWeekdayOfMonth, parseYmd, shiftMonth, ymd, daysInMonth } = dates;

export const SEED_PROJECT = "demo-cds-suite";
export const SEED_FIRESTORE_HOST = "127.0.0.1:8080";
export const SEED_AUTH_HOST = "127.0.0.1:9099";
/** Contraseña FICTICIA de todas las cuentas del emulador. */
export const SEED_PASSWORD = "PruebaCDS2026!";
export const SEED_FUNCTIONS_ORIGIN = "http://127.0.0.1:5001";
export const SEED_REGION = "southamerica-west1";

/**
 * Frases internas (naturales y únicas en el seed) que NUNCA deben aparecer en la
 * salida pública. Se ven como texto real en la app; los tests las buscan por
 * esta constante.
 */
export const SEED_CANARIES = Object.freeze({
  internalNote: "Las llaves del salón las tiene el hermano Ernesto",
  exceptionReason: "El grupo viaja al encuentro regional de Olmué",
  cancelReason: "Se suspende por el pronóstico de lluvia en la comuna",
  archiveReason: "Quedó registrada dos veces al copiar la semana",
  seriesReason: "Se fusiona con el culto de oración del miércoles",
});

export const ARCHIVED_TITLE = "Culto dominical (duplicado por error)";

const PERMS = {
  pastor: [...LEGACY_ROLE_ACCESS.pastor.permissions],
  leader: [...LEGACY_ROLE_ACCESS.leader.permissions],
  diacono: ["finance.summary.read", "calendar.read", "calendar.events.manage_assigned", "calendar.events.publish_assigned"],
};

/** Cuentas sembradas. `doc` = forma del documento users/{uid} (sin marcas de tiempo). */
export const SEED_USERS = Object.freeze([
  {
    uid: "seed-admin",
    email: "admin@cds.test",
    displayName: "Administración (prueba)",
    note: "legacy admin (fallback)",
    doc: { role: "admin", active: true },
  },
  {
    uid: "seed-pastor",
    email: "pastor@cds.test",
    displayName: "Daniel Herrera (prueba)",
    note: "v1 Pastor",
    doc: { role: "pastor", active: true, baseRole: "standard", position: "Pastor", permissions: PERMS.pastor, areaIds: ["pastoral"], homeModule: "finance" },
  },
  {
    uid: "seed-finanzas",
    email: "finanzas@cds.test",
    displayName: "Marcela Soto (prueba)",
    note: "legacy finance",
    doc: { role: "finance", active: true },
  },
  {
    uid: "seed-lider-jovenes",
    email: "lider.jovenes@cds.test",
    displayName: "Matías Contreras (prueba)",
    note: "v1 Líder · Jóvenes",
    doc: { role: "leader", active: true, baseRole: "standard", position: "Líder", permissions: PERMS.leader, areaIds: ["jovenes"], homeModule: "calendar" },
  },
  {
    uid: "seed-lider-sin-area",
    email: "lider.sinarea@cds.test",
    displayName: "Camila Rojas (prueba)",
    note: "v1 Líder sin áreas",
    doc: { role: "leader", active: true, baseRole: "standard", position: "Líder", permissions: PERMS.leader, areaIds: [], homeModule: "calendar" },
  },
  {
    uid: "seed-diacono-publica",
    email: "diacono.publica@cds.test",
    displayName: "Pedro Navarro (prueba)",
    note: "v1 Diácono · publica en Multimedia y Varones",
    doc: {
      role: "leader",
      active: true,
      baseRole: "standard",
      position: "Diácono",
      permissions: PERMS.diacono,
      areaIds: ["multimedia", "varones"],
      homeModule: "calendar",
    },
  },
  {
    uid: "seed-inactivo",
    email: "inactivo@cds.test",
    displayName: "Usuario inactivo (prueba)",
    note: "legacy finance inactivo",
    doc: { role: "finance", active: false },
  },
  {
    uid: "seed-sin-modulos",
    email: "sinmodulos@cds.test",
    displayName: "Javiera Muñoz (prueba)",
    note: "v1 activo sin módulos",
    doc: { role: "leader", active: true, baseRole: "standard", position: "Colaboradora", permissions: [], areaIds: [], homeModule: "calendar" },
  },
]);

export const SEED_AREAS = Object.freeze([
  { id: "pastoral", name: "Pastoral", color: "azul", description: "", active: true },
  { id: "alabanza", name: "Alabanza", color: "indigo", description: "", active: true },
  { id: "jovenes", name: "Jóvenes", color: "naranjo", description: "", active: true },
  { id: "ninos", name: "Niños", color: "ambar", description: "Escuela Dominical", active: true },
  { id: "damas", name: "Damas", color: "frambuesa", description: "", active: true },
  { id: "varones", name: "Varones", color: "cafe", description: "", active: true },
  { id: "intercesion", name: "Intercesión", color: "teal", description: "", active: true },
  { id: "multimedia", name: "Multimedia", color: "pizarra", description: "Sonido y transmisión", active: true },
  { id: "consolidacion", name: "Consolidación", color: "verde", description: "", active: true },
  { id: "matrimonios", name: "Matrimonios", color: "carmin", description: "", active: false },
]);

// ---------- Interlock ----------

export function assertSeedEnvironment(env = process.env) {
  const project = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || SEED_PROJECT;
  const problems = [];
  if (env.CDS_SEED_LOCAL !== "true") problems.push("CDS_SEED_LOCAL=true");
  if (env.FIRESTORE_EMULATOR_HOST !== SEED_FIRESTORE_HOST) problems.push(`FIRESTORE_EMULATOR_HOST=${SEED_FIRESTORE_HOST}`);
  if (env.FIREBASE_AUTH_EMULATOR_HOST !== SEED_AUTH_HOST) problems.push(`FIREBASE_AUTH_EMULATOR_HOST=${SEED_AUTH_HOST}`);
  if (project !== SEED_PROJECT) problems.push(`proyecto ${SEED_PROJECT} (recibido "${project}")`);
  if (problems.length) {
    throw new Error(`El seed solo corre contra los emuladores locales. Falta: ${problems.join(", ")}. Producción nunca está soportada.`);
  }
  return project;
}

// ---------- Fechas relativas ----------

const onOrBefore = (date, wd) => addDays(date, -((weekdayOf(date) - wd + 7) % 7));
const onOrAfter = (date, wd) => addDays(date, (wd - weekdayOf(date) + 7) % 7);
function nthWeekdayShifted(today, monthsDelta, wd, ord) {
  const { y, m } = parseYmd(today);
  const t = shiftMonth(y, m, monthsDelta);
  return nthWeekdayOfMonth(t.y, t.m, wd, ord);
}

// ---------- Auditoría (espejo de lib/calendar/audit.ts y de las reglas) ----------
// lib/calendar/audit.ts es TypeScript con alias "@/": este script (node puro) no
// lo puede importar. Una sola lista aquí, exportada, y una prueba de paridad
// (tests/platform/seed-platform-data.test.ts) la compara con AUDIT_VALUE_FIELDS y
// AUDIT_IGNORED_FIELDS de audit.ts; las reglas tienen su propia prueba de paridad.

export const SEED_AUDIT_IGNORED_FIELDS = Object.freeze(["revision", "lastChangeId", "updatedBy", "updatedAt", "lastDate"]);
export const SEED_AUDIT_VALUE_FIELDS = Object.freeze([
  "title",
  "responsibleAreaId",
  "participantAreaIds",
  "startDate",
  "endDate",
  "allDay",
  "startTime",
  "endTime",
  "location",
  "publicDescription",
  "visibility",
  "recurrence",
  "status",
]);
const AUDIT_IGNORED = new Set(SEED_AUDIT_IGNORED_FIELDS);
const AUDIT_VALUE_FIELDS = new Set(SEED_AUDIT_VALUE_FIELDS);

function sameValue(a, b) {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  return JSON.stringify(a) === JSON.stringify(b);
}

function changedFieldsOf(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => !AUDIT_IGNORED.has(k) && !sameValue(before[k], after[k])).sort();
}

function valueMap(state, fields) {
  const out = {};
  for (const f of fields) if (AUDIT_VALUE_FIELDS.has(f) && state[f] !== undefined) out[f] = state[f];
  return Object.keys(out).length ? out : null;
}

/**
 * Evento con su historial. `steps`: [{ actor, at, action, patch, reason?, scope?, occurrenceDate? }].
 * Devuelve { id, data, changes: [{ id, data }] } con revision/lastChangeId/changes coherentes.
 */
function eventWithHistory(id, content, { createdBy, createdAt }, steps = []) {
  let state = {
    title: content.title,
    responsibleAreaId: content.responsibleAreaId,
    participantAreaIds: content.participantAreaIds || [],
    startDate: content.startDate,
    endDate: content.endDate || content.startDate,
    allDay: content.allDay === true,
    startTime: content.allDay ? null : content.startTime,
    endTime: content.allDay ? null : (content.endTime ?? null),
    location: content.location || "",
    publicDescription: content.publicDescription || "",
    internalNotes: content.internalNotes || "",
    visibility: content.visibility,
    status: "scheduled",
    recurrence: content.recurrence || { freq: "none" },
    exceptions: [],
    revision: 1,
    lastChangeId: "r1",
    createdBy,
    createdAt,
    updatedBy: createdBy,
    updatedAt: createdAt,
  };
  state.lastDate = lastDateOf(state);
  const changes = [
    { id: "r1", data: { revision: 1, action: "created", actorUid: createdBy, at: createdAt, changedFields: [], before: null, after: null, reason: null } },
  ];
  for (const step of steps) {
    const revision = state.revision + 1;
    const next = { ...state, ...step.patch, revision, lastChangeId: `r${revision}`, updatedBy: step.actor, updatedAt: step.at };
    next.lastDate = lastDateOf(next);
    const fields = changedFieldsOf(state, next);
    const change = {
      revision,
      action: step.action,
      actorUid: step.actor,
      at: step.at,
      changedFields: fields,
      before: valueMap(state, fields),
      after: valueMap(next, fields),
      reason: step.reason ?? null,
    };
    if (step.scope) change.scope = step.scope;
    if (step.occurrenceDate) change.occurrenceDate = step.occurrenceDate;
    changes.push({ id: `r${revision}`, data: change });
    state = next;
  }
  return { id, data: state, changes };
}

/**
 * Datos del seed para un "hoy" (America/Santiago) y un instante dado. Pura.
 * Las marcas de tiempo son Date (Admin SDK las guarda como Timestamp).
 */
export function buildSeedData(today, nowMs) {
  const at = (daysAgo, hour = 10) => new Date(nowMs - daysAgo * 86400000 - (12 - hour) * 3600000);
  const created = (uid, daysAgo = 30) => ({ createdBy: uid, createdAt: at(daysAgo) });
  const weeks = (n) => n * 7;

  const users = SEED_USERS.map((u) => {
    const base = { displayName: u.displayName, email: u.email, role: u.doc.role, active: u.doc.active, createdAt: at(120) };
    if (!u.doc.baseRole) return { uid: u.uid, data: base };
    return {
      uid: u.uid,
      data: {
        ...base,
        baseRole: u.doc.baseRole,
        position: u.doc.position,
        permissions: [...u.doc.permissions],
        areaIds: [...u.doc.areaIds],
        homeModule: u.doc.homeModule,
        accessSchemaVersion: 1,
        updatedAt: at(20),
        updatedBy: "seed-admin",
      },
    };
  });

  const areas = SEED_AREAS.map((a) => ({
    id: a.id,
    data: {
      name: a.name,
      slug: a.id,
      color: a.color,
      description: a.description,
      active: a.active,
      createdAt: at(150),
      createdBy: "seed-admin",
      updatedAt: a.active ? at(150) : at(40),
      updatedBy: "seed-admin",
    },
  }));

  const sunday0 = addDays(onOrBefore(today, 0), -weeks(3));
  const saturday0 = addDays(onOrBefore(today, 6), -weeks(3));
  const thursday0 = addDays(onOrBefore(today, 4), -weeks(2));
  const tuesday0 = addDays(onOrBefore(today, 2), -weeks(2));
  const jovenesException = addDays(onOrAfter(addDays(today, 1), 6), 7);
  const damasCutFrom = onOrAfter(addDays(today, 21), 2);
  const ayunoStart = nthWeekdayShifted(today, -1, 6, 1);
  const vigiliaStart = nthWeekdayShifted(today, 0, 5, -1);
  const campStart = onOrAfter(addDays(today, 10), 5);
  const evangelismo = onOrAfter(addDays(today, 6), 6);
  const archivedDate = onOrAfter(addDays(today, 1), 0);

  const events = [
    eventWithHistory(
      "seed-culto-dominical",
      {
        title: "Culto dominical",
        responsibleAreaId: "pastoral",
        participantAreaIds: ["alabanza", "multimedia", "ninos"],
        startDate: sunday0,
        startTime: "11:00",
        endTime: "13:00",
        location: "Templo",
        publicDescription: "Culto de adoración y predicación. El primer domingo de cada mes celebramos la Santa Cena.",
        internalNotes: `Coordinar ujieres y recepción. ${SEED_CANARIES.internalNote}.`,
        visibility: "public",
        recurrence: { freq: "weekly", until: addDays(sunday0, weeks(22)) },
      },
      created("seed-pastor", 40),
    ),
    eventWithHistory(
      "seed-escuela-dominical",
      {
        title: "Escuela dominical",
        responsibleAreaId: "ninos",
        startDate: sunday0,
        startTime: "11:00",
        endTime: "12:30",
        location: "Sala de niños",
        publicDescription: "Clases bíblicas para niños de 3 a 12 años durante el culto.",
        visibility: "public",
        recurrence: { freq: "weekly", until: addDays(sunday0, weeks(22)) },
      },
      created("seed-pastor", 40),
    ),
    eventWithHistory(
      "seed-reunion-jovenes",
      {
        title: "Reunión de jóvenes",
        responsibleAreaId: "jovenes",
        participantAreaIds: ["alabanza"],
        startDate: saturday0,
        startTime: "19:00",
        endTime: "21:30",
        location: "Salón multiuso",
        publicDescription: "Alabanza, palabra y comunidad para jóvenes de 15 a 30 años.",
        visibility: "public",
        recurrence: { freq: "weekly", until: addDays(saturday0, weeks(22)) },
      },
      created("seed-pastor", 35),
      [
        {
          actor: "seed-lider-jovenes",
          at: at(2, 18),
          action: "cancelled",
          scope: "occurrence",
          occurrenceDate: jovenesException,
          reason: `${SEED_CANARIES.exceptionReason}.`,
          patch: {
            exceptions: [
              { date: jovenesException, type: "cancelled", reason: `${SEED_CANARIES.exceptionReason}.`, by: "seed-lider-jovenes" },
            ],
          },
        },
      ],
    ),
    eventWithHistory(
      "seed-ensayo-alabanza",
      {
        title: "Ensayo de alabanza",
        responsibleAreaId: "alabanza",
        participantAreaIds: ["multimedia"],
        startDate: thursday0,
        startTime: "20:00",
        endTime: "22:00",
        location: "Templo",
        internalNotes: `Repertorio en la carpeta del equipo. ${SEED_CANARIES.internalNote}.`,
        visibility: "internal",
        recurrence: { freq: "weekly", until: addDays(thursday0, weeks(22)) },
      },
      created("seed-pastor", 30),
    ),
    eventWithHistory(
      "seed-ayuno-congregacional",
      {
        title: "Ayuno congregacional",
        responsibleAreaId: "intercesion",
        startDate: ayunoStart,
        startTime: "10:00",
        endTime: "13:00",
        location: "Templo",
        publicDescription: "Mañana de ayuno y oración el primer sábado de cada mes.",
        visibility: "public",
        recurrence: {
          freq: "monthly",
          until: nthWeekdayShifted(ayunoStart, 5, 6, 1),
          monthly: { mode: "nth_weekday", weekday: 6, ordinal: 1 },
        },
      },
      created("seed-pastor", 45),
    ),
    eventWithHistory(
      "seed-vigilia",
      {
        title: "Vigilia",
        responsibleAreaId: "intercesion",
        startDate: vigiliaStart,
        endDate: addDays(vigiliaStart, 1),
        startTime: "22:00",
        endTime: "02:00",
        location: "Templo",
        publicDescription: "Noche de oración el último viernes de cada mes. Termina a las 02:00.",
        visibility: "public",
        recurrence: {
          freq: "monthly",
          until: nthWeekdayShifted(vigiliaStart, 5, 5, -1),
          monthly: { mode: "nth_weekday", weekday: 5, ordinal: -1 },
        },
      },
      created("seed-pastor", 25),
    ),
    eventWithHistory(
      "seed-campamento-jovenes",
      {
        title: "Campamento de jóvenes",
        responsibleAreaId: "jovenes",
        participantAreaIds: ["alabanza"],
        startDate: campStart,
        endDate: addDays(campStart, 2),
        allDay: true,
        location: "Parque recreativo (lugar ficticio)",
        publicDescription: "Tres días de encuentro, deporte y palabra. Inscripciones con el equipo de Jóvenes.",
        visibility: "public",
      },
      created("seed-pastor", 20),
    ),
    eventWithHistory(
      "seed-evangelismo-plaza",
      {
        title: "Evangelismo en la plaza",
        responsibleAreaId: "consolidacion",
        startDate: evangelismo,
        startTime: "16:00",
        endTime: "18:00",
        location: "Plaza de la comuna",
        publicDescription: "Salida evangelística con música y oración.",
        visibility: "public",
      },
      created("seed-pastor", 15),
      [
        {
          actor: "seed-pastor",
          at: at(1, 9),
          action: "cancelled",
          reason: `${SEED_CANARIES.cancelReason}.`,
          patch: { status: "cancelled", cancelReason: `${SEED_CANARIES.cancelReason}.` },
        },
      ],
    ),
    eventWithHistory(
      "seed-culto-duplicado",
      {
        title: ARCHIVED_TITLE,
        responsibleAreaId: "pastoral",
        startDate: archivedDate,
        startTime: "11:00",
        endTime: "13:00",
        location: "Templo",
        publicDescription: "Culto de adoración y predicación.",
        visibility: "public",
      },
      created("seed-pastor", 10),
      [
        {
          actor: "seed-pastor",
          at: at(9, 11),
          action: "archived",
          reason: `${SEED_CANARIES.archiveReason}.`,
          patch: { status: "archived", archivedAt: at(9, 11), archiveReason: `${SEED_CANARIES.archiveReason}.` },
        },
      ],
    ),
    eventWithHistory(
      "seed-planificacion-retiro",
      {
        title: "Planificación del retiro de jóvenes",
        responsibleAreaId: "jovenes",
        startDate: addDays(today, 4),
        startTime: "19:30",
        endTime: "21:00",
        location: "Sala 2",
        publicDescription: "Reunión abierta para preparar el retiro de verano.",
        internalNotes: `Revisar presupuesto con Finanzas. ${SEED_CANARIES.internalNote}.`,
        visibility: "internal",
      },
      created("seed-lider-jovenes", 3),
    ),
    eventWithHistory(
      "seed-desayuno-varones",
      {
        title: "Desayuno de varones",
        responsibleAreaId: "varones",
        participantAreaIds: ["multimedia"],
        startDate: onOrAfter(addDays(today, 14), 6),
        startTime: "09:00",
        endTime: "11:00",
        location: "Salón multiuso",
        publicDescription: "Desayuno y conversación para hombres de la iglesia.",
        visibility: "internal",
      },
      created("seed-diacono-publica", 4),
    ),
    eventWithHistory(
      "seed-reunion-damas",
      {
        title: "Reunión de damas",
        responsibleAreaId: "damas",
        startDate: tuesday0,
        startTime: "19:30",
        endTime: "21:00",
        location: "Sala 1",
        publicDescription: "Oración y estudio bíblico para mujeres.",
        visibility: "public",
        recurrence: { freq: "weekly", until: addDays(tuesday0, weeks(22)) },
      },
      created("seed-pastor", 30),
      [
        {
          actor: "seed-pastor",
          at: at(1, 15),
          action: "cancelled",
          scope: "series",
          occurrenceDate: damasCutFrom,
          reason: `${SEED_CANARIES.seriesReason}.`,
          patch: {
            seriesCancellation: {
              from: damasCutFrom,
              reason: `${SEED_CANARIES.seriesReason}.`,
              by: "seed-pastor",
              at: at(1, 15),
            },
          },
        },
      ],
    ),
    eventWithHistory(
      "seed-taller-matrimonios",
      {
        title: "Taller de matrimonios",
        responsibleAreaId: "matrimonios",
        startDate: onOrBefore(addDays(today, -60), 6),
        startTime: "10:00",
        endTime: "13:00",
        location: "Sala 1",
        visibility: "internal",
      },
      created("seed-pastor", 90),
    ),
  ];

  return { users, areas, events };
}

// ---------- Finanzas (movimientos ficticios) ----------

/** Cuenta que registra los movimientos del seed (legacy finance: finance.records.manage). */
export const SEED_FINANCE_UID = "seed-finanzas";

/**
 * Movimientos ficticios del mes anterior (completo) y del mes en curso (solo
 * fechas ≤ hoy). Pura. Ids `seed-fin-{yyyy-mm}-{n}`: estables por mes.
 * Categorías del catálogo base (activas por defecto); nunca Diezmos.
 */
export function buildFinanceSeed(today) {
  const { y, m, d: todayDay } = parseYmd(today);
  const prev = shiftMonth(y, m, -1);
  const months = [
    { y: prev.y, m: prev.m, maxDay: daysInMonth(prev.y, prev.m) },
    { y, m, maxDay: todayDay },
  ];
  const items = [];
  for (const mo of months) {
    const period = `${mo.y}-${String(mo.m).padStart(2, "0")}`;
    let n = 0;
    const add = (day, type, amount, category, paymentMethod, description) => {
      if (day < 1 || day > mo.maxDay) return;
      n += 1;
      items.push({
        id: `seed-fin-${period}-${String(n).padStart(2, "0")}`,
        input: { type, amount, date: ymd(mo.y, mo.m, day), category, paymentMethod, description, note: "" },
      });
    };
    // Ofrendas de cada domingo del mes
    const sundays = [];
    for (let day = 1; day <= daysInMonth(mo.y, mo.m); day++) if (weekdayOf(ymd(mo.y, mo.m, day)) === 0) sundays.push(day);
    const offerings = [186500, 212300, 174800, 228900, 195400];
    sundays.forEach((day, i) => add(day, "income", offerings[i % offerings.length], "Ofrendas", "cash", "Ofrenda culto dominical"));
    add(1, "income", 64200, "Ofrendas", "cash", "Ofrenda reunión de oración");
    add(3, "expense", 84600, "Servicios básicos", "transfer", "Cuenta de luz y agua del templo");
    add(6, "income", 150000, "Donaciones", "transfer", "Donación para el fondo de ayuda social");
    add(9, "expense", 42300, "Compras y materiales", "card", "Materiales para la escuela dominical");
    add(12, "income", 38700, "Cafetería", "cash", "Ventas de cafetería después del culto");
    add(16, "expense", 65000, "Mantención", "transfer", "Mantención del equipo de sonido");
    add(21, "expense", 30000, "Ministerio Jóvenes", "cash", "Colación de la reunión de jóvenes");
  }
  return items;
}

async function loadFinanceSeeder() {
  // Bajo vitest el import de TS lo resuelve Vite; en el CLI (node) se registra el
  // loader de tsx (como `node --import tsx`) y se importa el módulo TS.
  if (process.env.VITEST) return import("./seed-platform-finance.ts");
  // El repo no es "type": "module": los .ts cargan como CommonJS, así que hacen falta ambos loaders.
  (await import("tsx/esm/api")).register();
  (await import("tsx/cjs/api")).register();
  return import(new URL("./seed-platform-finance.ts", import.meta.url).href);
}

// ---------- Auth emulator (REST) ----------

async function authRequest(path, body) {
  const url = `http://${SEED_AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${SEED_PROJECT}/${path}`;
  const res = await fetch(url, {
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

// ---------- Escritura ----------

function loadAdmin() {
  const { initializeApp, getApps } = requireFromFunctions("firebase-admin/app");
  const { getFirestore } = requireFromFunctions("firebase-admin/firestore");
  const name = "cds-seed-platform-calendar";
  const app = getApps().find((a) => a.name === name) || initializeApp({ projectId: SEED_PROJECT }, name);
  return getFirestore(app);
}

/** Enlace público local: el token va en el fragmento (doc 20 §5), nunca en la query. */
export function publicUrlFor(token) {
  return `http://localhost:3000/calendario-publico#${token}`;
}

/** URL del feed en el emulador. El token se envía en el cuerpo de un POST, no en la URL. */
export function feedUrlFor() {
  return `${SEED_FUNCTIONS_ORIGIN}/${SEED_PROJECT}/${SEED_REGION}/calendarPublicFeed`;
}

/**
 * Siembra todo. Devuelve el token en claro (solo para quien llama: el CLI lo
 * imprime una vez; los tests lo usan sin imprimirlo).
 */
export async function runSeed({ env = process.env, now = Date.now() } = {}) {
  assertSeedEnvironment(env);
  const db = loadAdmin();
  const today = localToday(new Date(now));
  const data = buildSeedData(today, now);

  // Auth: cuentas con uid fijo (se borra cualquier cuenta previa con el mismo uid o correo).
  for (const u of SEED_USERS) await resetAuthUser(u);

  // Perfiles huérfanos de seeds anteriores con el mismo correo y otro uid.
  const seededUids = new Set(SEED_USERS.map((u) => u.uid));
  const orphans = await db.collection("users").where("email", "in", SEED_USERS.map((u) => u.email)).get();
  for (const doc of orphans.docs) if (!seededUids.has(doc.id)) await doc.ref.delete();

  // Actividades sembradas: se borran con su historial (también changes agregados desde la UI).
  for (const e of data.events) await db.recursiveDelete(db.doc(`calendarEvents/${e.id}`));

  const batch = db.batch();
  for (const u of data.users) batch.set(db.doc(`users/${u.uid}`), u.data);
  for (const a of data.areas) batch.set(db.doc(`areas/${a.id}`), a.data);
  for (const e of data.events) {
    batch.set(db.doc(`calendarEvents/${e.id}`), e.data);
    for (const c of e.changes) batch.set(db.doc(`calendarEvents/${e.id}/changes/${c.id}`), c.data);
  }
  await batch.commit();

  // Enlace público con la lógica del callable: solo queda el hash en Firestore.
  const { createCalendarStore, SHARE_LINK_PATH } = requireFromFunctions("./calendar/firestore-store.js");
  const { createShareLinkService } = requireFromFunctions("./calendar/share-links.js");
  await db.doc(SHARE_LINK_PATH).delete();
  const service = createShareLinkService({ store: createCalendarStore({ db }), clock: { now: () => Date.now() }, randomBytes: crypto.randomBytes });
  const { token } = await service.handle("seed-pastor", "create");

  // Finanzas: como cliente autenticado (reglas reales), después de sembrar los perfiles.
  const { seedFinanceMovements } = await loadFinanceSeeder();
  const finance = await seedFinanceMovements({
    financeUid: SEED_FINANCE_UID,
    items: buildFinanceSeed(today),
    firestoreHost: env.FIRESTORE_EMULATOR_HOST,
  });

  return {
    today,
    token,
    publicUrl: publicUrlFor(token),
    feedUrl: feedUrlFor(),
    counts: { users: data.users.length, areas: data.areas.length, events: data.events.length },
    finance,
  };
}

async function main() {
  try {
    assertSeedEnvironment(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const result = await runSeed();
  console.log(`Seed local listo (hoy en Santiago: ${result.today}) · ${result.counts.users} cuentas · ${result.counts.areas} áreas · ${result.counts.events} actividades`);
  console.log(`Cuentas del emulador (contraseña ficticia ${SEED_PASSWORD}):`);
  for (const u of SEED_USERS) console.log(`  ${u.email.padEnd(26)} ${u.note}`);
  console.log(`Finanzas: ${result.finance.created} movimientos ficticios nuevos (${result.finance.skipped} ya existían), registrados como finanzas@cds.test.`);
  console.log("Enlace del calendario público (solo local, se muestra una vez):");
  console.log(`  ${result.publicUrl}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(`Error en el seed: ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
