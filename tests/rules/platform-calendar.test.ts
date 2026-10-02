// Reglas de Calendario (18a §C.2–C.5/§D.3–D.4/§J.3): áreas, eventos, auditoría atómica,
// publicación separada de gestión, estados, bloqueo temporal y enlace público. Solo emulador.
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addDays,
  area,
  createEvent,
  createRulesEnv,
  createdChange,
  dbOf,
  eventData,
  readEvent,
  seedBase,
  seedEvent,
  TODAY,
  updateEvent,
} from "./helpers/platform-fixtures";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createRulesEnv();
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedBase(env);
});

const FUTURE = addDays(TODAY, 20);
const PAST = addDays(TODAY, -20);

function series(o: DocumentData = {}): DocumentData {
  return {
    title: "Culto de jóvenes",
    recurrence: { freq: "weekly", until: addDays(FUTURE, 56) },
    ...o,
  };
}

function newArea(actor: string, slug: string, o: DocumentData = {}) {
  return {
    name: "Niños",
    slug,
    color: "naranjo",
    description: "",
    active: true,
    createdAt: serverTimestamp(),
    createdBy: actor,
    updatedAt: serverTimestamp(),
    updatedBy: actor,
    ...o,
  };
}

// ── Áreas ──────────────────────────────────────────────────────────────────
describe("areas", () => {
  it("calendar.read lee áreas (incluidas inactivas); sin calendario, inactivo o anónimo no", async () => {
    for (const uid of ["v1-reader", "leader", "finance", "v1-leader-jovenes", "admin"]) {
      await assertSucceeds(getDoc(doc(dbOf(env, uid), "areas", "matrimonios")));
      await assertSucceeds(getDocs(collection(dbOf(env, uid), "areas")));
    }
    for (const uid of ["v1-none", "v1-inactive", "inactive", "missing"])
      await assertFails(getDocs(collection(dbOf(env, uid), "areas")));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "areas", "jovenes")));
  });

  it("settings.manage crea y edita áreas; líder y pastor (sin admin) no", async () => {
    await assertSucceeds(setDoc(doc(dbOf(env, "v1-admin"), "areas", "ninos"), newArea("v1-admin", "ninos")));
    await assertSucceeds(setDoc(doc(dbOf(env, "admin"), "areas", "ninos-2"), newArea("admin", "ninos-2")));
    await assertSucceeds(updateDoc(doc(dbOf(env, "v1-admin"), "areas", "jovenes"), {
      name: "Jóvenes CDS", color: "teal", description: "Ministerio juvenil", active: false,
      updatedAt: serverTimestamp(), updatedBy: "v1-admin",
    }));
    for (const uid of ["v1-leader-jovenes", "v1-publisher-jovenes", "pastor", "v1-manager-all", "finance", "inactive"]) {
      await assertFails(setDoc(doc(dbOf(env, uid), "areas", "otra"), newArea(uid, "otra")));
      await assertFails(updateDoc(doc(dbOf(env, uid), "areas", "jovenes"), {
        name: "Mía", updatedAt: serverTimestamp(), updatedBy: uid,
      }));
    }
  });

  it("validación: paleta cerrada, slug == id inmutable, textos, campos y auditoría", async () => {
    const admin = dbOf(env, "v1-admin");
    await assertFails(setDoc(doc(admin, "areas", "a1"), newArea("v1-admin", "a1", { color: "rojo" })));
    await assertFails(setDoc(doc(admin, "areas", "a2"), newArea("v1-admin", "otro-slug")));
    await assertFails(setDoc(doc(admin, "areas", "Jovenes"), newArea("v1-admin", "Jovenes")));
    await assertFails(setDoc(doc(admin, "areas", "a-"), newArea("v1-admin", "a-")));
    await assertFails(setDoc(doc(admin, "areas", "a3"), newArea("v1-admin", "a3", { name: "" })));
    await assertFails(setDoc(doc(admin, "areas", "a4"), newArea("v1-admin", "a4", { name: "x".repeat(41) })));
    await assertFails(setDoc(doc(admin, "areas", "a5"), newArea("v1-admin", "a5", { description: "x".repeat(201) })));
    await assertFails(setDoc(doc(admin, "areas", "a6"), newArea("v1-admin", "a6", { active: "si" })));
    await assertFails(setDoc(doc(admin, "areas", "a7"), newArea("v1-admin", "a7", { order: 1 })));
    await assertFails(setDoc(doc(admin, "areas", "a8"), newArea("v1-admin", "a8", { createdBy: "otro" })));
    await assertFails(setDoc(doc(admin, "areas", "a9"), newArea("v1-admin", "a9", { createdAt: Timestamp.now() })));
    // cambio de slug
    await assertFails(updateDoc(doc(admin, "areas", "jovenes"), {
      slug: "jovenes-cds", updatedAt: serverTimestamp(), updatedBy: "v1-admin",
    }));
    // auditoría inmutable
    await assertFails(updateDoc(doc(admin, "areas", "jovenes"), {
      createdBy: "v1-admin", updatedAt: serverTimestamp(), updatedBy: "v1-admin",
    }));
    await assertFails(updateDoc(doc(admin, "areas", "jovenes"), { name: "Sin auditoría" }));
  });

  it("nadie borra áreas, ni siquiera el admin", async () => {
    await assertFails(deleteDoc(doc(dbOf(env, "v1-admin"), "areas", "jovenes")));
    await assertFails(deleteDoc(doc(dbOf(env, "admin"), "areas", "matrimonios")));
  });
});

// ── Lectura de eventos ─────────────────────────────────────────────────────
describe("calendarEvents: lectura", () => {
  it("calendar.read (v1 o fallback legacy) lista y lee; sin permiso, inactivo o anónimo no", async () => {
    await seedEvent(env, "e1");
    for (const uid of ["v1-reader", "leader", "finance", "pastor", "admin", "v1-admin", "v1-leader", "v1-manager-all"]) {
      await assertSucceeds(getDoc(doc(dbOf(env, uid), "calendarEvents", "e1")));
      await assertSucceeds(getDocs(collection(dbOf(env, uid), "calendarEvents")));
    }
    for (const uid of ["v1-none", "v1-inactive", "inactive", "missing"]) {
      await assertFails(getDoc(doc(dbOf(env, uid), "calendarEvents", "e1")));
      await assertFails(getDocs(collection(dbOf(env, uid), "calendarEvents")));
    }
    await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), "calendarEvents")));
  });
});

// ── Crear ──────────────────────────────────────────────────────────────────
describe("calendarEvents: crear", () => {
  it("manage_assigned crea una actividad interna de su área con changes/r1 en el mismo lote", async () => {
    await assertSucceeds(createEvent(env, "v1-leader-jovenes", "e1"));
    const e = await readEvent(env, "e1");
    expect(e.revision).toBe(1);
    expect(e.lastChangeId).toBe("r1");
  });

  it("auditoría atómica: sin change, change de otro actor, acción incorrecta o change suelto fallan", async () => {
    await assertFails(createEvent(env, "v1-leader-jovenes", "e1", {}, null));
    await assertFails(createEvent(env, "v1-leader-jovenes", "e2", {}, { actorUid: "v1-publisher-jovenes" }));
    await assertFails(createEvent(env, "v1-leader-jovenes", "e3", {}, { action: "updated" }));
    await assertFails(createEvent(env, "v1-leader-jovenes", "e4", {}, { changedFields: ["title"] }));
    await assertFails(createEvent(env, "v1-leader-jovenes", "e5", {}, { at: Timestamp.now() }));
    await assertFails(createEvent(env, "v1-leader-jovenes", "e6", {}, { before: { title: "x" } }));
    // change suelto, sin evento
    const db = dbOf(env, "v1-leader-jovenes");
    await assertFails(setDoc(doc(db, "calendarEvents", "e7", "changes", "r1"), createdChange("v1-leader-jovenes")));
    // lastChangeId que no corresponde a la revisión
    await assertFails(createEvent(env, "v1-leader-jovenes", "e8", { lastChangeId: "r2" }));
  });

  it("no crea en un área ajena, ni como participante, ni con el responsable repetido en participantes", async () => {
    await assertFails(createEvent(env, "v1-leader-jovenes", "e1", { responsibleAreaId: "alabanza" }));
    await assertFails(createEvent(env, "v1-leader-jovenes", "e2", {
      responsibleAreaId: "alabanza", participantAreaIds: ["jovenes"],
    }));
    await assertFails(createEvent(env, "v1-leader-jovenes", "e3", { participantAreaIds: ["jovenes"] }));
    await assertFails(createEvent(env, "v1-leader-jovenes", "e4", { participantAreaIds: ["alabanza", "alabanza"] }));
    await assertFails(createEvent(env, "v1-leader-jovenes", "e5", {
      participantAreaIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
    }));
    await assertSucceeds(createEvent(env, "v1-leader-jovenes", "e6", { participantAreaIds: ["alabanza", "matrimonios"] }));
  });

  it("sin áreas, área inactiva, solo lectura, inactivo o sin permiso no crean", async () => {
    for (const uid of ["leader", "v1-leader", "v1-reader", "v1-none", "finance"])
      await assertFails(createEvent(env, uid, `e-${uid}`));
    await assertFails(createEvent(env, "v1-leader-matrimonios", "e-mat", { responsibleAreaId: "matrimonios" }));
    await assertFails(createEvent(env, "v1-inactive", "e-inactive"));
    await assertFails(createEvent(env, "inactive", "e-inactive2"));
  });

  it("manage_all (pastor legacy y v1) crea en cualquier área, también inactiva y en el pasado", async () => {
    await assertSucceeds(createEvent(env, "pastor", "e1", { responsibleAreaId: "alabanza" }));
    await assertSucceeds(createEvent(env, "v1-manager-all", "e2", { responsibleAreaId: "matrimonios" }));
    await assertSucceeds(createEvent(env, "pastor", "e3", { startDate: PAST, endDate: PAST }));
    await assertSucceeds(createEvent(env, "v1-admin", "e4", { responsibleAreaId: "alabanza" }));
    await assertFails(createEvent(env, "v1-leader-jovenes", "e5", { startDate: PAST, endDate: PAST }));
  });

  it("crear pública exige publicar: publish_assigned en su área o manage_all", async () => {
    await assertFails(createEvent(env, "v1-leader-jovenes", "e1", { visibility: "public" }));
    await assertSucceeds(createEvent(env, "v1-publisher-jovenes", "e2", { visibility: "public" }));
    await assertFails(createEvent(env, "v1-publisher-jovenes", "e3", { visibility: "public", responsibleAreaId: "alabanza" }));
    await assertSucceeds(createEvent(env, "pastor", "e4", { visibility: "public", responsibleAreaId: "alabanza" }));
    await assertSucceeds(createEvent(env, "v1-manager-all", "e5", { visibility: "public" }));
    await assertFails(createEvent(env, "v1-leader-jovenes", "e6", { visibility: "secret" }));
  });

  it("validación de campos, fechas y horas", async () => {
    const bad: DocumentData[] = [
      { title: "" },
      { title: "x".repeat(121) },
      { allDay: true },
      { allDay: false, startTime: null, endTime: null },
      { startTime: "25:00" },
      { startTime: "7:00" },
      { endTime: "18:00" },
      { startDate: FUTURE, endDate: addDays(FUTURE, -1) },
      { startDate: FUTURE, endDate: addDays(FUTURE, 32) },
      { startDate: "2026-13-01", endDate: "2026-13-01" },
      { startDate: "2026/12/01", endDate: "2026/12/01" },
      { location: "x".repeat(121) },
      { publicDescription: "x".repeat(1001) },
      { internalNotes: "x".repeat(1001) },
      { status: "cancelled", cancelReason: "Lluvia fuerte" },
      { status: "archived" },
      { revision: 2, lastChangeId: "r2" },
      { createdBy: "otro" },
      { updatedBy: "otro" },
      { createdAt: Timestamp.now() },
      { isFeatured: true },
      { cancelReason: "Motivo previo" },
      { exceptions: [{ date: FUTURE, type: "cancelled", reason: "Feriado", by: "v1-leader-jovenes" }] },
      { lastDate: addDays(FUTURE, 1) },
      { responsibleAreaId: "Jovenes" },
    ];
    for (const [i, o] of bad.entries())
      expect({ i, o, ok: await canWrite(() => createEvent(env, "v1-leader-jovenes", `bad-${i}`, o)) })
        .toEqual({ i, o, ok: false });
    // válidos: todo el día, sin hora de término, varios días
    await assertSucceeds(createEvent(env, "v1-leader-jovenes", "ok1", { allDay: true, startTime: null, endTime: null }));
    await assertSucceeds(createEvent(env, "v1-leader-jovenes", "ok2", { endTime: null }));
    await assertSucceeds(createEvent(env, "v1-leader-jovenes", "ok3", {
      endDate: addDays(FUTURE, 2), startTime: "18:00", endTime: "12:00",
    }));
  });

  it("recurrencia V1: válidas y negativas (>1 año, span 2 días, ordinal, lastDate, monthly)", async () => {
    const u = "v1-leader-jovenes";
    await assertSucceeds(createEvent(env, u, "s1", series()));
    await assertSucceeds(createEvent(env, u, "s2", series({ recurrence: { freq: "biweekly", until: addDays(FUTURE, 90) } })));
    await assertSucceeds(createEvent(env, u, "s3", series({
      recurrence: { freq: "monthly", until: addDays(FUTURE, 300), monthly: { mode: "nth_weekday", weekday: 0, ordinal: -1 } },
    })));
    // vigilia: span 1 día, lastDate = until + 1
    await assertSucceeds(createEvent(env, u, "s4", series({ endDate: addDays(FUTURE, 1), startTime: "22:00", endTime: "06:00" })));
    const bad: DocumentData[] = [
      series({ recurrence: { freq: "weekly" } }),
      series({ recurrence: { freq: "weekly", until: addDays(FUTURE, 400) } }),
      series({ recurrence: { freq: "weekly", until: addDays(FUTURE, -1) } }),
      series({ endDate: addDays(FUTURE, 2) }),
      series({ recurrence: { freq: "monthly", until: addDays(FUTURE, 60), monthly: { mode: "nth_weekday", weekday: 0, ordinal: 5 } } }),
      series({ recurrence: { freq: "monthly", until: addDays(FUTURE, 60), monthly: { mode: "nth_weekday", weekday: 7, ordinal: 1 } } }),
      series({ recurrence: { freq: "monthly", until: addDays(FUTURE, 60), monthly: { mode: "day_of_month", day: 5 } } }),
      series({ recurrence: { freq: "monthly", until: addDays(FUTURE, 60) } }),
      series({ recurrence: { freq: "weekly", until: addDays(FUTURE, 60), monthly: { mode: "nth_weekday", weekday: 0, ordinal: 1 } } }),
      series({ recurrence: { freq: "daily", until: addDays(FUTURE, 60) } }),
      series({ recurrence: { freq: "none", until: addDays(FUTURE, 60) } }),
      series({ lastDate: addDays(FUTURE, 55) }),
      series({ lastDate: addDays(FUTURE, 58) }),
    ];
    for (const [i, o] of bad.entries())
      expect({ i, ok: await canWrite(() => createEvent(env, u, `bad-${i}`, o)) }).toEqual({ i, ok: false });
  });
});

async function canWrite(op: () => Promise<unknown>) {
  try {
    await op();
    return true;
  } catch {
    return false;
  }
}

// ── Editar ─────────────────────────────────────────────────────────────────
describe("calendarEvents: editar", () => {
  beforeEach(async () => {
    await seedEvent(env, "own");                                                     // jovenes, interna
    await seedEvent(env, "foreign", { responsibleAreaId: "alabanza", title: "Ensayo" });
    await seedEvent(env, "shared", { responsibleAreaId: "alabanza", participantAreaIds: ["jovenes"] });
    await seedEvent(env, "pub", { visibility: "public", publicDescription: "Abierto a todos" });
  });

  it("el gestor del área edita su actividad (revision+1, change r2)", async () => {
    await assertSucceeds(updateEvent(env, "v1-leader-jovenes", "own", { title: "Reunión de jóvenes (nuevo horario)", startTime: "19:30" }));
    const e = await readEvent(env, "own");
    expect([e.revision, e.lastChangeId, e.updatedBy]).toEqual([2, "r2", "v1-leader-jovenes"]);
    expect(e.createdBy).toBe("seed");
  });

  it("auditoría del update: sin change, otro actor, acción o changedFields falsos, revisión saltada", async () => {
    const u = "v1-leader-jovenes";
    await assertFails(updateEvent(env, u, "own", { title: "A" }, { noChange: true }));
    await assertFails(updateEvent(env, u, "own", { title: "B" }, { actorUid: "v1-publisher-jovenes" }));
    await assertFails(updateEvent(env, u, "own", { title: "C" }, { action: "cancelled" }));
    await assertFails(updateEvent(env, u, "own", { title: "D" }, { changedFields: ["location"] }));
    await assertFails(updateEvent(env, u, "own", { title: "E" }, { changedFields: [] }));
    await assertFails(updateEvent(env, u, "own", { title: "F" }, { revisionStep: 2 }));
    await assertFails(updateEvent(env, u, "own", { internalNotes: "Llevar llaves" }, { change: { after: { internalNotes: "Llevar llaves" } } }));
    // internalNotes sí aparece en changedFields (sin valor)
    await assertSucceeds(updateEvent(env, u, "own", { internalNotes: "Llevar llaves" }));
    // un change no se puede crear para un evento que no se escribe en el mismo lote
    const db = dbOf(env, u);
    await assertFails(setDoc(doc(db, "calendarEvents", "own", "changes", "r3"), {
      ...createdChange(u, { revision: 3, action: "updated", changedFields: ["title"] }),
    }));
  });

  it("no edita actividades ajenas ni como área participante; no mueve el responsable a/desde un área ajena", async () => {
    const u = "v1-leader-jovenes";
    await assertFails(updateEvent(env, u, "foreign", { title: "Intruso" }));
    await assertFails(updateEvent(env, u, "shared", { title: "Soy participante" }));
    await assertFails(updateEvent(env, u, "shared", { internalNotes: "Soy participante" }));
    await assertFails(updateEvent(env, u, "own", { responsibleAreaId: "alabanza" }));
    await assertFails(updateEvent(env, u, "foreign", { responsibleAreaId: "jovenes" }));
    await assertFails(updateEvent(env, "v1-reader", "own", { title: "Lector" }));
    await assertFails(updateEvent(env, "leader", "own", { title: "Líder legacy sin áreas" }));
    // manage_all sí mueve
    await assertSucceeds(updateEvent(env, "pastor", "own", { responsibleAreaId: "alabanza" }));
  });

  it("inactivos no escriben nada", async () => {
    await assertFails(updateEvent(env, "v1-inactive", "own", { title: "Inactivo" }));
    await assertFails(updateEvent(env, "inactive", "own", { title: "Inactivo legacy" }));
    await assertFails(updateEvent(env, "v1-inactive", "own", { status: "archived", archivedAt: serverTimestamp(), archiveReason: "Ya no va" }));
  });

  it("publicar ≠ gestionar: voltear a pública exige publish_assigned del área o manage_all", async () => {
    await assertFails(updateEvent(env, "v1-leader-jovenes", "own", { visibility: "public" }));
    await assertSucceeds(updateEvent(env, "v1-publisher-jovenes", "own", { visibility: "public" }));
    await seedEvent(env, "own2");
    await assertSucceeds(updateEvent(env, "pastor", "own2", { visibility: "public" }));
    await seedEvent(env, "own3");
    await assertSucceeds(updateEvent(env, "v1-manager-all", "own3", { visibility: "public" }));
    // acción incorrecta para un cambio de visibilidad
    await seedEvent(env, "own4");
    await assertFails(updateEvent(env, "v1-publisher-jovenes", "own4", { visibility: "public" }, { action: "updated" }));
  });

  it("actividad pública: sin publicar no se editan campos públicos; sí notas internas y quitar publicación", async () => {
    const u = "v1-leader-jovenes";
    await assertFails(updateEvent(env, u, "pub", { title: "Cambio de título" }));
    await assertFails(updateEvent(env, u, "pub", { location: "Otro lugar" }));
    await assertFails(updateEvent(env, u, "pub", { publicDescription: "Otra descripción" }));
    await assertFails(updateEvent(env, u, "pub", { startTime: "20:00" }));
    await assertFails(updateEvent(env, u, "pub", { participantAreaIds: ["alabanza"] }));
    await assertSucceeds(updateEvent(env, u, "pub", { internalNotes: "Coordinar sonido" }));
    await assertSucceeds(updateEvent(env, "v1-publisher-jovenes", "pub", { title: "Título público nuevo" }));
    await assertSucceeds(updateEvent(env, u, "pub", { visibility: "internal" }));
  });

  it("cancelar actividad simple: con motivo sí; sin motivo, motivo corto o serie vía status no", async () => {
    const u = "v1-leader-jovenes";
    await assertFails(updateEvent(env, u, "own", { status: "cancelled" }));
    await assertFails(updateEvent(env, u, "own", { status: "cancelled", cancelReason: "no" }));
    await assertFails(updateEvent(env, u, "own", { status: "cancelled", cancelReason: "Lluvia", title: "Otro" }));
    await assertFails(updateEvent(env, u, "own", { status: "cancelled", cancelReason: "Lluvia" }, { action: "updated" }));
    await assertSucceeds(updateEvent(env, u, "own", { status: "cancelled", cancelReason: "Lluvia fuerte" }));
    // una cancelada no vuelve a programada ni se edita
    await assertFails(updateEvent(env, "pastor", "own", { status: "scheduled" }));
    await assertFails(updateEvent(env, "pastor", "own", { internalNotes: "x" }));
    // serie: no se cancela vía status
    await seedEvent(env, "ser", series());
    await assertFails(updateEvent(env, u, "ser", { status: "cancelled", cancelReason: "Fin de ciclo" }));
    await assertFails(updateEvent(env, "pastor", "ser", { status: "cancelled", cancelReason: "Fin de ciclo" }));
  });

  it("cancelar una ocurrencia (append) y la serie desde una fecha", async () => {
    const u = "v1-leader-jovenes";
    await seedEvent(env, "ser", series());
    const x = { date: addDays(FUTURE, 7), type: "cancelled", reason: "Feriado", by: u };
    await assertFails(updateEvent(env, u, "ser", { exceptions: [{ ...x, by: "otro" }] }));
    await assertFails(updateEvent(env, u, "ser", { exceptions: [{ ...x, reason: "" }] }));
    await assertFails(updateEvent(env, u, "ser", { exceptions: [{ ...x, date: PAST }] }));
    await assertFails(updateEvent(env, u, "ser", { exceptions: [{ ...x, extra: 1 }] }));
    await assertFails(updateEvent(env, u, "ser", { exceptions: [x] }, { action: "updated" }));
    await assertSucceeds(updateEvent(env, u, "ser", { exceptions: [x] }));
    // modificar una excepción existente o agregar dos a la vez
    await assertFails(updateEvent(env, u, "ser", { exceptions: [{ ...x, reason: "Otro motivo" }] }));
    const y = { ...x, date: addDays(FUTURE, 14) };
    const z = { ...x, date: addDays(FUTURE, 21) };
    await assertFails(updateEvent(env, u, "ser", { exceptions: [x, y, z] }));
    await assertSucceeds(updateEvent(env, u, "ser", { exceptions: [x, y] }));
    // cancelar la serie desde una fecha
    const sc = { from: addDays(FUTURE, 28), reason: "Fin del ciclo", by: u, at: serverTimestamp() };
    await assertFails(updateEvent(env, u, "ser", { seriesCancellation: { ...sc, from: PAST } }));
    await assertFails(updateEvent(env, u, "ser", { seriesCancellation: { ...sc, by: "otro" } }));
    await assertFails(updateEvent(env, u, "ser", { seriesCancellation: { ...sc, at: Timestamp.now() } }));
    await assertFails(updateEvent(env, u, "ser", { seriesCancellation: { ...sc, reason: "x" } }));
    await assertSucceeds(updateEvent(env, u, "ser", { seriesCancellation: sc }));
    // una sola vez
    await assertFails(updateEvent(env, u, "ser", { seriesCancellation: { ...sc, from: addDays(FUTURE, 35) } }));
    // excepciones en un evento no recurrente
    await assertFails(updateEvent(env, u, "own", { exceptions: [x] }));
  });

  it("archivar con motivo; sin motivo, con archivedAt falso o des-archivar no", async () => {
    const u = "v1-leader-jovenes";
    await assertFails(updateEvent(env, u, "own", { status: "archived", archivedAt: serverTimestamp() }));
    await assertFails(updateEvent(env, u, "own", { status: "archived", archivedAt: Timestamp.now(), archiveReason: "Duplicada" }));
    await assertFails(updateEvent(env, u, "own", { status: "archived", archivedAt: serverTimestamp(), archiveReason: "Duplicada" }, { action: "updated" }));
    await assertSucceeds(updateEvent(env, u, "own", { status: "archived", archivedAt: serverTimestamp(), archiveReason: "Duplicada" }));
    await assertFails(updateEvent(env, "v1-admin", "own", { status: "scheduled" }));
    await assertFails(updateEvent(env, "v1-admin", "own", { internalNotes: "x" }));
    // archivar una cancelada conserva el motivo de cancelación
    await seedEvent(env, "can", { status: "cancelled", cancelReason: "Lluvia fuerte" });
    await assertSucceeds(updateEvent(env, u, "can", { status: "archived", archivedAt: serverTimestamp(), archiveReason: "Limpieza" }));
  });

  it("editar fechas/horas/recurrencia revalida el grupo completo (vía la regla del change)", async () => {
    const u = "v1-leader-jovenes";
    await assertFails(updateEvent(env, u, "own", { endDate: addDays(FUTURE, -1) }));
    await assertFails(updateEvent(env, u, "own", { startTime: "25:00" }));
    await assertFails(updateEvent(env, u, "own", { allDay: true }));
    await assertFails(updateEvent(env, u, "own", { endTime: "18:00" }));
    await assertFails(updateEvent(env, u, "own", { lastDate: addDays(FUTURE, 3) }));
    await assertFails(updateEvent(env, u, "own", { recurrence: { freq: "weekly", until: addDays(FUTURE, 400) }, lastDate: addDays(FUTURE, 400) }));
    await assertFails(updateEvent(env, u, "own", { recurrence: { freq: "weekly", until: addDays(FUTURE, 30) } }));
    await assertSucceeds(updateEvent(env, u, "own", { allDay: true, startTime: null, endTime: null }));
    await assertSucceeds(updateEvent(env, u, "own", {
      recurrence: { freq: "weekly", until: addDays(FUTURE, 30) }, lastDate: addDays(FUTURE, 30),
    }));
    const e = await readEvent(env, "own");
    expect(e.revision).toBe(3);
  });

  it("presupuesto de expresiones: peor caso legítimo de crear y editar se permite", async () => {
    const u = "v1-publisher-multi";
    const vigil = {
      endDate: addDays(FUTURE, 1), startTime: "22:00", endTime: "06:00", visibility: "public",
      recurrence: { freq: "monthly", until: addDays(FUTURE, 330), monthly: { mode: "nth_weekday", weekday: 6, ordinal: -1 } },
    };
    const full = {
      title: "t".repeat(120), location: "l".repeat(120), publicDescription: "d".repeat(1000), internalNotes: "n".repeat(1000),
      participantAreaIds: ["area-3", "area-4", "area-5", "area-6", "area-7", "area-8", "area-9", "matrimonios"],
    };
    await assertSucceeds(createEvent(env, u, "worst", { ...vigil, ...full }));
    await assertSucceeds(updateEvent(env, u, "worst", {
      responsibleAreaId: "alabanza", title: "T".repeat(120), location: "L".repeat(120), publicDescription: "D".repeat(1000),
      internalNotes: "N".repeat(1000), participantAreaIds: ["area-3", "area-4", "area-5", "area-6", "area-7", "area-8", "area-9", "jovenes"],
      startTime: "21:00", endTime: "07:00", recurrence: { ...vigil.recurrence, until: addDays(FUTURE, 300) }, lastDate: addDays(FUTURE, 301),
    }));
    await assertSucceeds(updateEvent(env, u, "worst", {
      exceptions: [{ date: addDays(FUTURE, 28), type: "cancelled", reason: "r".repeat(300), by: u }],
    }));
  });

  it("createdBy/createdAt son inmutables; updatedAt/updatedBy los fija la regla", async () => {
    const u = "v1-leader-jovenes";
    await assertFails(updateEvent(env, u, "own", { createdBy: u }));
    await assertFails(updateEvent(env, u, "own", { createdAt: Timestamp.now() }));
    await assertFails(updateEvent(env, u, "own", { title: "X", updatedBy: "otro" }));
    await assertFails(updateEvent(env, u, "own", { title: "X", updatedAt: Timestamp.now() }));
  });

  it("nadie borra eventos ni su historial (incluido admin)", async () => {
    for (const uid of ["admin", "v1-admin", "pastor", "v1-leader-jovenes"]) {
      await assertFails(deleteDoc(doc(dbOf(env, uid), "calendarEvents", "own")));
      await assertFails(deleteDoc(doc(dbOf(env, uid), "calendarEvents", "own", "changes", "r1")));
    }
  });
});

// ── Pasado y series iniciadas ──────────────────────────────────────────────
describe("calendarEvents: pasado y series iniciadas", () => {
  beforeEach(async () => {
    await seedEvent(env, "past", { startDate: PAST, endDate: PAST });
    await seedEvent(env, "started", series({
      startDate: addDays(TODAY, -14), endDate: addDays(TODAY, -14), recurrence: { freq: "weekly", until: addDays(TODAY, 60) },
    }));
  });

  it("manage_assigned no edita actividades pasadas; manage_all edita campos no temporales", async () => {
    await assertFails(updateEvent(env, "v1-leader-jovenes", "past", { internalNotes: "Tarde" }));
    await assertSucceeds(updateEvent(env, "pastor", "past", { internalNotes: "Asistieron 40" }));
    await assertFails(updateEvent(env, "pastor", "past", { startDate: addDays(PAST, 1), endDate: addDays(PAST, 1), lastDate: addDays(PAST, 1) }));
  });

  it("serie iniciada: título y extender until sí; hora, día o frecuencia no (también admin); until pasado no", async () => {
    const u = "v1-leader-jovenes";
    await assertSucceeds(updateEvent(env, u, "started", { title: "Culto de jóvenes renovado" }));
    await assertSucceeds(updateEvent(env, u, "started", {
      recurrence: { freq: "weekly", until: addDays(TODAY, 90) }, lastDate: addDays(TODAY, 90),
    }));
    for (const uid of [u, "v1-admin", "pastor"]) {
      await assertFails(updateEvent(env, uid, "started", { startTime: "20:00" }));
      await assertFails(updateEvent(env, uid, "started", { startDate: addDays(TODAY, -13), endDate: addDays(TODAY, -13) }));
      await assertFails(updateEvent(env, uid, "started", {
        recurrence: { freq: "biweekly", until: addDays(TODAY, 90) }, lastDate: addDays(TODAY, 90),
      }));
      await assertFails(updateEvent(env, uid, "started", {
        recurrence: { freq: "weekly", until: addDays(TODAY, -3) }, lastDate: addDays(TODAY, -3),
      }));
    }
  });

  it("manage_assigned no archiva una actividad iniciada; manage_all sí", async () => {
    const archive = { status: "archived", archivedAt: serverTimestamp(), archiveReason: "Ya no corresponde" };
    await assertFails(updateEvent(env, "v1-leader-jovenes", "started", archive));
    await assertSucceeds(updateEvent(env, "pastor", "started", archive));
    await assertSucceeds(updateEvent(env, "v1-admin", "past", archive));
  });

  it("serie cancelada desde una fecha: solo manage_all la sigue editando", async () => {
    await seedEvent(env, "sc", series({
      seriesCancellation: { from: addDays(FUTURE, 28), reason: "Fin del ciclo", by: "seed", at: Timestamp.now() },
    }));
    await assertFails(updateEvent(env, "v1-leader-jovenes", "sc", { title: "Otro" }));
    await assertSucceeds(updateEvent(env, "v1-manager-all", "sc", { title: "Otro" }));
  });
});

// ── Historial (changes) ────────────────────────────────────────────────────
describe("calendarEvents/{id}/changes", () => {
  beforeEach(async () => {
    await seedEvent(env, "own");
    await seedEvent(env, "foreign", { responsibleAreaId: "alabanza" });
  });

  it("lo leen manage_all y quien gestiona el área responsable; calendar.read solo no", async () => {
    await assertSucceeds(getDoc(doc(dbOf(env, "v1-leader-jovenes"), "calendarEvents", "own", "changes", "r1")));
    await assertSucceeds(getDocs(collection(dbOf(env, "v1-leader-jovenes"), "calendarEvents", "own", "changes")));
    await assertSucceeds(getDocs(collection(dbOf(env, "pastor"), "calendarEvents", "foreign", "changes")));
    await assertSucceeds(getDocs(collection(dbOf(env, "v1-admin"), "calendarEvents", "foreign", "changes")));
    await assertFails(getDocs(collection(dbOf(env, "v1-leader-jovenes"), "calendarEvents", "foreign", "changes")));
    for (const uid of ["v1-reader", "leader", "finance", "v1-none", "v1-inactive"])
      await assertFails(getDocs(collection(dbOf(env, uid), "calendarEvents", "own", "changes")));
  });

  it("no se actualiza ni se borra un change (ni admin)", async () => {
    for (const uid of ["admin", "v1-admin", "v1-leader-jovenes"]) {
      const ref = doc(dbOf(env, uid), "calendarEvents", "own", "changes", "r1");
      await assertFails(updateDoc(ref, { reason: "Reescrito" }));
      await assertFails(setDoc(ref, createdChange(uid)));
      await assertFails(deleteDoc(ref));
    }
  });

  it("no se puede reescribir un change existente reutilizando su revisión", async () => {
    const u = "v1-leader-jovenes";
    const db = dbOf(env, u);
    const batch = writeBatch(db);
    batch.update(doc(db, "calendarEvents", "own"), {
      title: "Reescritura", revision: 1, lastChangeId: "r1", updatedBy: u, updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "calendarEvents", "own", "changes", "r1"), {
      ...createdChange(u, { action: "updated", changedFields: ["title"] }),
    });
    await assertFails(batch.commit());
  });
});

// ── Enlace público: sin acceso de cliente ──────────────────────────────────
describe("calendarShareLinks", () => {
  it("get, list, create, update y delete denegados para todos, incluido admin", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "calendarShareLinks", "public"), {
        tokenHash: "a".repeat(64), active: true, createdAt: Timestamp.now(), createdBy: "admin",
        rotation: 1, updatedAt: Timestamp.now(), updatedBy: "admin",
      });
    });
    for (const uid of ["admin", "v1-admin", "pastor", "v1-manager-all", "v1-leader-jovenes"]) {
      const db = dbOf(env, uid);
      await assertFails(getDoc(doc(db, "calendarShareLinks", "public")));
      await assertFails(getDocs(collection(db, "calendarShareLinks")));
      await assertFails(setDoc(doc(db, "calendarShareLinks", "other"), { tokenHash: "b".repeat(64), active: true }));
      await assertFails(updateDoc(doc(db, "calendarShareLinks", "public"), { tokenHash: "c".repeat(64) }));
      await assertFails(deleteDoc(doc(db, "calendarShareLinks", "public")));
    }
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "calendarShareLinks", "public")));
  });
});

// Uso explícito de eventData para documentar la forma completa del contrato (18a §C.3).
it("el documento de evento del contrato tiene exactamente las claves requeridas", () => {
  expect(Object.keys(eventData("u")).sort()).toEqual([
    "allDay", "createdAt", "createdBy", "endDate", "endTime", "exceptions", "internalNotes", "lastChangeId",
    "lastDate", "location", "participantAreaIds", "publicDescription", "recurrence", "responsibleAreaId",
    "revision", "startDate", "startTime", "status", "title", "updatedAt", "updatedBy", "visibility",
  ]);
  expect(area("x", "X", "azul").slug).toBe("x");
});
