// Reglas de Calendario, ciclo 1 de correcciones (Atlas M1/B1/B4): valores reales en before/after
// del historial, inicio al pasado al editar (manage_assigned) y área responsable existente
// (manage_all). Incluye la prueba de que los planes productivos de lib/calendar/audit.ts pasan
// las reglas tal cual. Solo emulador (demo-cds-suite).
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, writeBatch, type DocumentData } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUDIT_VALUE_FIELDS,
  planArchive,
  planCancelEvent,
  planCancelOccurrence,
  planCancelSeriesFrom,
  planUpdate,
  planVisibility,
  type UpdatePlan,
} from "../../lib/calendar/audit";
import type { EventInput } from "../../lib/calendar/calendar";
import type { CalendarEventDoc } from "../../lib/shared/types";
import {
  addDays,
  createEvent,
  createRulesEnv,
  dbOf,
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
const U = "v1-leader-jovenes";

/** assertSucceeds con etiqueta: el mensaje dice qué escritura legítima se negó. */
async function ok(op: Promise<unknown>, label = "") {
  try {
    await op;
  } catch (error) {
    throw new Error(`se negó una escritura legítima ${label}: ${String(error).slice(0, 300)}`);
  }
}

function series(o: DocumentData = {}): DocumentData {
  return { title: "Culto de jóvenes", recurrence: { freq: "weekly", until: addDays(FUTURE, 56) }, ...o };
}

// ── A1: before/after con los valores reales del evento ─────────────────────
describe("historial: before/after deben ser los valores reales", () => {
  beforeEach(async () => {
    await seedEvent(env, "own");
    await seedEvent(env, "ser", series());
  });

  it("valores falsos o nulos con changedFields no vacío → fail; los reales → ok", async () => {
    const t = { title: "Nuevo título" };
    await assertFails(updateEvent(env, U, "own", t, { change: { after: null } }));
    await assertFails(updateEvent(env, U, "own", t, { change: { before: null } }));
    await assertFails(updateEvent(env, U, "own", t, { change: { before: null, after: null } }));
    await assertFails(updateEvent(env, U, "own", t, { change: { after: { title: "Otro título" } } }));
    await assertFails(updateEvent(env, U, "own", t, { change: { before: { title: "Título inventado" } } }));
    await assertFails(updateEvent(env, U, "own", t, { change: { after: {} } }));
    await assertFails(updateEvent(env, U, "own", t, { change: { after: "Nuevo título" } }));
    await assertSucceeds(updateEvent(env, U, "own", t));
  });

  it("cada grupo de valor se compara: fecha, hora, visibilidad, estado, área, recurrencia, participantes", async () => {
    const d = addDays(FUTURE, 2);
    const moveDay = { startDate: d, endDate: d, lastDate: d };
    await assertFails(updateEvent(env, U, "own", moveDay, { change: { after: { startDate: addDays(d, 1), endDate: d } } }));
    await assertFails(updateEvent(env, U, "own", moveDay, { change: { before: { startDate: d, endDate: FUTURE } } }));
    await assertFails(updateEvent(env, U, "own", { startTime: "20:00" }, { change: { after: { startTime: "21:00" } } }));
    await assertFails(updateEvent(env, U, "own", { startTime: "20:00" }, { change: { before: { startTime: null } } }));
    await assertFails(updateEvent(env, "v1-publisher-jovenes", "own", { visibility: "public" }, {
      change: { before: { visibility: "public" }, after: { visibility: "public" } },
    }));
    await assertFails(updateEvent(env, U, "own", { status: "cancelled", cancelReason: "Lluvia fuerte" }, {
      change: { after: { status: "scheduled" } },
    }));
    await assertFails(updateEvent(env, "pastor", "own", { responsibleAreaId: "alabanza" }, {
      change: { before: { responsibleAreaId: "alabanza" } },
    }));
    await assertFails(updateEvent(env, U, "own", { participantAreaIds: ["alabanza"] }, {
      change: { after: { participantAreaIds: ["matrimonios"] } },
    }));
    await assertFails(updateEvent(env, U, "ser", {
      recurrence: { freq: "weekly", until: addDays(FUTURE, 70) }, lastDate: addDays(FUTURE, 70),
    }, { change: { after: { recurrence: { freq: "weekly", until: addDays(FUTURE, 77) } } } }));
    // los mismos cambios con valores reales sí
    await ok(updateEvent(env, U, "own", moveDay), "moveDay");
    await ok(updateEvent(env, U, "own", { startTime: "20:00" }), "startTime");
    await ok(updateEvent(env, U, "own", { participantAreaIds: ["alabanza"] }), "participants");
    await ok(updateEvent(env, U, "ser", {
      recurrence: { freq: "weekly", until: addDays(FUTURE, 70) }, lastDate: addDays(FUTURE, 70),
    }));
    await ok(updateEvent(env, "pastor", "own", { responsibleAreaId: "matrimonios" }), "área");
  });

  it("cancelar y archivar registran el estado real; sin valores → fail", async () => {
    await assertFails(updateEvent(env, U, "own", { status: "cancelled", cancelReason: "Lluvia fuerte" }, {
      change: { before: null, after: null },
    }));
    await assertSucceeds(updateEvent(env, U, "own", { status: "cancelled", cancelReason: "Lluvia fuerte" }));
    const archive = { status: "archived", archivedAt: serverTimestamp(), archiveReason: "Limpieza" };
    await assertFails(updateEvent(env, U, "own", archive, { change: { after: { status: "cancelled" } } }));
    await assertFails(updateEvent(env, U, "own", archive, { change: { before: null, after: null } }));
    await assertSucceeds(updateEvent(env, U, "own", archive));
  });

  it("sin campos de valor (notas internas, excepciones, cancelar serie) before/after son null", async () => {
    await assertFails(updateEvent(env, U, "own", { internalNotes: "Llevar llaves" }, { change: { before: {}, after: {} } }));
    await assertFails(updateEvent(env, U, "own", { internalNotes: "Llevar llaves" }, { change: { after: { title: "Reunión de jóvenes" } } }));
    await assertSucceeds(updateEvent(env, U, "own", { internalNotes: "Llevar llaves" }));
    const x = { date: addDays(FUTURE, 7), type: "cancelled", reason: "Feriado", by: U };
    await assertFails(updateEvent(env, U, "ser", { exceptions: [x] }, { change: { after: { status: "scheduled" } } }));
    await assertSucceeds(updateEvent(env, U, "ser", { exceptions: [x] }));
    const sc = { from: addDays(FUTURE, 28), reason: "Fin del ciclo", by: U, at: serverTimestamp() };
    await assertFails(updateEvent(env, U, "ser", { seriesCancellation: sc }, { change: { before: { status: "scheduled" }, after: { status: "scheduled" } } }));
    await assertSucceeds(updateEvent(env, U, "ser", { seriesCancellation: sc }));
  });

  it("los planes productivos de lib/calendar/audit.ts pasan las reglas tal cual", async () => {
    const ctx = () => ({ actorUid: U, now: serverTimestamp() });
    const current = async (id: string) => ({ ...(await readEvent(env, id)), id }) as unknown as CalendarEventDoc & { id: string };
    const commit = async (id: string, plan: UpdatePlan) => {
      const db = dbOf(env, U);
      const batch = writeBatch(db);
      batch.update(doc(db, "calendarEvents", id), plan.patch as DocumentData);
      batch.set(doc(db, "calendarEvents", id, "changes", plan.changeId), plan.change as unknown as DocumentData);
      return batch.commit();
    };
    const inputOf = (e: CalendarEventDoc, o: Partial<EventInput> = {}): EventInput => ({
      title: e.title, responsibleAreaId: e.responsibleAreaId, participantAreaIds: e.participantAreaIds,
      startDate: e.startDate, endDate: e.endDate, allDay: e.allDay, startTime: e.startTime, endTime: e.endTime,
      location: e.location, publicDescription: e.publicDescription, internalNotes: e.internalNotes,
      visibility: e.visibility, recurrence: e.recurrence, ...o,
    });

    let e = await current("own");
    const moved = addDays(FUTURE, 3);
    const edit = planUpdate(e, inputOf(e, { title: "Reunión renovada", startDate: moved, endDate: moved, startTime: "18:30", internalNotes: "Nota" }), ctx());
    expect(edit.change.after).toMatchObject({ title: "Reunión renovada", startDate: moved, startTime: "18:30" });
    await assertSucceeds(commit("own", edit));
    e = await current("own");
    await assertSucceeds(commit("own", planCancelEvent(e, "Se suspende por lluvia", ctx())));
    e = await current("own");
    await assertSucceeds(commit("own", planArchive(e, "Ya no corresponde", ctx())));

    await seedEvent(env, "pubme");
    const p = await current("pubme");
    const pub = planVisibility(p, "public", { actorUid: "v1-publisher-jovenes", now: serverTimestamp() });
    const db = dbOf(env, "v1-publisher-jovenes");
    const batch = writeBatch(db);
    batch.update(doc(db, "calendarEvents", "pubme"), pub.patch as DocumentData);
    batch.set(doc(db, "calendarEvents", "pubme", "changes", pub.changeId), pub.change as unknown as DocumentData);
    await assertSucceeds(batch.commit());

    let s = await current("ser");
    await assertSucceeds(commit("ser", planCancelOccurrence(s, addDays(FUTURE, 7), "Feriado nacional", ctx())));
    s = await current("ser");
    await assertSucceeds(commit("ser", planCancelSeriesFrom(s, addDays(FUTURE, 28), "Fin del ciclo", ctx())));
  });

  it("peor caso de presupuesto con manage_all: todos los campos de valor cambian a la vez", async () => {
    await seedEvent(env, "big", series({ participantAreaIds: ["alabanza"] }));
    const until = addDays(FUTURE, 300);
    await assertSucceeds(updateEvent(env, "v1-manager-all", "big", {
      title: "T".repeat(120), responsibleAreaId: "matrimonios",
      participantAreaIds: ["area-3", "area-4", "area-5", "area-6", "area-7", "area-8", "area-9", "jovenes"],
      startDate: addDays(FUTURE, 1), endDate: addDays(FUTURE, 2), allDay: false, startTime: "22:00", endTime: "06:00",
      location: "L".repeat(120), publicDescription: "D".repeat(1000), internalNotes: "N".repeat(1000), visibility: "public",
      recurrence: { freq: "monthly", until, monthly: { mode: "nth_weekday", weekday: 6, ordinal: -1 } }, lastDate: addDays(until, 1),
    }));
  });
});

// ── A2: manage_assigned no mueve el inicio al pasado al editar ──────────────
describe("editar: inicio al pasado", () => {
  beforeEach(async () => {
    await seedEvent(env, "own");
  });

  it("manage_assigned no mueve startDate al pasado; manage_all sí; a otra fecha futura sí", async () => {
    const toPast = { startDate: PAST, endDate: PAST, lastDate: PAST };
    await assertFails(updateEvent(env, U, "own", toPast));
    await assertFails(updateEvent(env, "v1-publisher-jovenes", "own", toPast));
    const later = addDays(FUTURE, 5);
    await assertSucceeds(updateEvent(env, U, "own", { startDate: later, endDate: later, lastDate: later }));
    await assertSucceeds(updateEvent(env, "pastor", "own", toPast));
  });
});

// ── A3: el área responsable debe existir (también para manage_all) ──────────
describe("área responsable inexistente", () => {
  it("crear con un área que no existe → fail (manage_all legacy, v1 y admin)", async () => {
    for (const [uid, id] of [["pastor", "a1"], ["v1-manager-all", "a2"], ["v1-admin", "a3"], ["admin", "a4"]] as const)
      await assertFails(createEvent(env, uid, id, { responsibleAreaId: "no-existe" }));
    await assertFails(createEvent(env, U, "a5", { responsibleAreaId: "no-existe" }));
    // inactiva pero existente: manage_all sí
    await assertSucceeds(createEvent(env, "pastor", "a6", { responsibleAreaId: "matrimonios" }));
  });

  it("cambiar el área responsable a una inexistente → fail; a una existente → ok", async () => {
    await seedEvent(env, "own");
    for (const uid of ["pastor", "v1-manager-all", "v1-admin"])
      await assertFails(updateEvent(env, uid, "own", { responsibleAreaId: "no-existe" }));
    // sin cambiar el área, manage_all edita aunque el área ya no exista
    await seedEvent(env, "orphan", { responsibleAreaId: "area-borrada" });
    await assertSucceeds(updateEvent(env, "pastor", "orphan", { title: "Sigue editable" }));
    await assertSucceeds(updateEvent(env, "pastor", "own", { responsibleAreaId: "alabanza" }));
  });
});

// ── Paridad de texto: auditValueFields() ≡ AUDIT_VALUE_FIELDS ───────────────
it("auditValueFields() de las reglas coincide con AUDIT_VALUE_FIELDS de lib/calendar/audit.ts", () => {
  const rules = readFileSync("firestore.rules", "utf8");
  const m = rules.match(/function auditValueFields\(\) \{ return \[([^\]]*)\]; \}/);
  expect(m).not.toBeNull();
  const list = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  expect(list).toEqual([...AUDIT_VALUE_FIELDS]);
  expect(list).not.toContain("internalNotes");
});
