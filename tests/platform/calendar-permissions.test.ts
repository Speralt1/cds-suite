// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  actorFromUserDoc,
  canArchiveEvent,
  canCreateEvents,
  canManageEvent,
  canManageSeries,
  canPublishEvent,
  creatableAreas,
  myActivities,
  publishableAreas,
  validateEvent,
  validateSeriesPatch,
  type EventInput,
} from "@/lib/calendar/calendar";
import type { Area, CalendarEvent, Permission } from "@/lib/shared/types";

const TODAY = "2026-10-10";
const NOW = "2026-10-10T12:00";

const AREAS: Area[] = [
  { id: "jovenes", name: "Jóvenes", color: "azul", active: true },
  { id: "alabanza", name: "Alabanza", color: "verde", active: true },
  { id: "varones", name: "Varones", color: "cafe", active: false },
];

function v1(permissions: Permission[], areaIds: string[] = [], baseRole: "admin" | "standard" = "standard") {
  return actorFromUserDoc({ accessSchemaVersion: 1, active: true, baseRole, permissions, areaIds, role: "leader" });
}

const leader = v1(["calendar.events.manage_assigned"], ["jovenes", "varones"]);
const publisher = v1(["calendar.events.manage_assigned", "calendar.events.publish_assigned"], ["jovenes"]);
const publishOnly = v1(["calendar.events.publish_assigned"], ["jovenes"]);
const reader = v1(["calendar.read"]);
const pastor = actorFromUserDoc({ role: "pastor", active: true });
const admin = v1([], [], "admin");
const inactiveLeader = actorFromUserDoc({
  accessSchemaVersion: 1,
  active: false,
  baseRole: "standard",
  permissions: ["calendar.events.manage_all"],
  areaIds: ["jovenes"],
});

function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "e1",
    title: "Reunión de jóvenes",
    responsibleAreaId: "jovenes",
    participantAreaIds: [],
    startDate: "2026-10-20",
    endDate: "2026-10-20",
    allDay: false,
    startTime: "19:00",
    endTime: "21:00",
    location: "",
    publicDescription: "",
    internalNotes: "",
    visibility: "internal",
    status: "scheduled",
    recurrence: { freq: "none" },
    exceptions: [],
    lastDate: "2026-10-20",
    revision: 1,
    lastChangeId: "r1",
    createdBy: "u1",
    createdAt: null,
    updatedBy: "u1",
    updatedAt: null,
    ...over,
  };
}

function input(over: Partial<EventInput> = {}): EventInput {
  return {
    title: "Reunión",
    responsibleAreaId: "jovenes",
    participantAreaIds: [],
    startDate: "2026-10-20",
    endDate: "2026-10-20",
    allDay: false,
    startTime: "19:00",
    endTime: "21:00",
    location: "",
    publicDescription: "",
    internalNotes: "",
    visibility: "internal",
    recurrence: { freq: "none" },
    ...over,
  };
}

describe("canManageEvent", () => {
  it("manage_assigned gestiona actividades futuras de su área activa", () => {
    expect(canManageEvent(leader, ev(), AREAS, TODAY)).toBe(true);
  });
  it("ser área participante no da edición", () => {
    const e = ev({ responsibleAreaId: "alabanza", participantAreaIds: ["jovenes"] });
    expect(canManageEvent(leader, e, AREAS, TODAY)).toBe(false);
  });
  it("área ajena: no", () => {
    expect(canManageEvent(leader, ev({ responsibleAreaId: "alabanza" }), AREAS, TODAY)).toBe(false);
  });
  it("área inactiva (aunque esté asignada): no", () => {
    expect(canManageEvent(leader, ev({ responsibleAreaId: "varones" }), AREAS, TODAY)).toBe(false);
  });
  it("el pasado es solo lectura para manage_assigned, no para manage_all", () => {
    const past = ev({ startDate: "2026-10-01", endDate: "2026-10-01", lastDate: "2026-10-01" });
    expect(canManageEvent(leader, past, AREAS, TODAY)).toBe(false);
    expect(canManageEvent(pastor, past, AREAS, TODAY)).toBe(true);
    expect(canManageEvent(admin, past, AREAS, TODAY)).toBe(true);
  });
  it("manage_all (pastor legacy y admin) gestiona áreas ajenas e inactivas", () => {
    for (const a of [pastor, admin]) {
      expect(canManageEvent(a, ev({ responsibleAreaId: "alabanza" }), AREAS, TODAY)).toBe(true);
      expect(canManageEvent(a, ev({ responsibleAreaId: "varones" }), AREAS, TODAY)).toBe(true);
    }
  });
  it("sin permiso de gestión, inactivo o archivada: no", () => {
    expect(canManageEvent(reader, ev(), AREAS, TODAY)).toBe(false);
    expect(canManageEvent(inactiveLeader, ev(), AREAS, TODAY)).toBe(false);
    expect(canManageEvent(null, ev(), AREAS, TODAY)).toBe(false);
    expect(canManageEvent(admin, ev({ status: "archived" }), AREAS, TODAY)).toBe(false);
  });
  it("una simple cancelada queda en solo lectura (pero se puede archivar)", () => {
    const cancelled = ev({ status: "cancelled", cancelReason: "Lluvia" });
    expect(canManageEvent(admin, cancelled, AREAS, TODAY)).toBe(false);
    expect(canArchiveEvent(leader, cancelled, AREAS, TODAY)).toBe(true);
  });
  it("serie: una fecha pasada no se gestiona, una futura sí; serie cancelada solo manage_all", () => {
    const series = ev({ startDate: "2026-10-04", endDate: "2026-10-04", recurrence: { freq: "weekly", until: "2026-12-27" }, lastDate: "2026-12-27" });
    expect(canManageEvent(leader, series, AREAS, TODAY, "2026-10-04")).toBe(false);
    expect(canManageEvent(leader, series, AREAS, TODAY, "2026-10-11")).toBe(true);
    expect(canManageSeries(leader, series, AREAS, TODAY)).toBe(true);
    const cancelled = { ...series, seriesCancellation: { from: "2026-11-01", reason: "Fin", by: "u1", at: null } };
    expect(canManageSeries(leader, cancelled, AREAS, TODAY)).toBe(false);
    expect(canManageSeries(pastor, cancelled, AREAS, TODAY)).toBe(true);
  });
  it("archivar: manage_assigned no archiva lo que ya empezó", () => {
    const started = ev({ startDate: "2026-10-04", endDate: "2026-10-04", recurrence: { freq: "weekly", until: "2026-12-27" }, lastDate: "2026-12-27" });
    expect(canArchiveEvent(leader, started, AREAS, TODAY)).toBe(false);
    expect(canArchiveEvent(admin, started, AREAS, TODAY)).toBe(true);
    expect(canArchiveEvent(leader, ev(), AREAS, TODAY)).toBe(true);
  });
});

describe("canPublishEvent (publicar ≠ gestionar)", () => {
  it("publish_assigned en su área: sí", () => {
    expect(canPublishEvent(publisher, ev())).toBe(true);
  });
  it("publish_assigned en área ajena: no", () => {
    expect(canPublishEvent(publisher, ev({ responsibleAreaId: "alabanza" }))).toBe(false);
  });
  it("sin publish (aunque gestione): no", () => {
    expect(canPublishEvent(leader, ev())).toBe(false);
    expect(canPublishEvent(reader, ev())).toBe(false);
  });
  it("manage_all: sí, en cualquier área", () => {
    expect(canPublishEvent(pastor, ev({ responsibleAreaId: "alabanza" }))).toBe(true);
    expect(canPublishEvent(admin, ev({ responsibleAreaId: "varones" }))).toBe(true);
  });
});

describe("creatableAreas / publishableAreas", () => {
  it("manage_assigned: solo sus áreas activas", () => {
    expect(creatableAreas(leader, AREAS).map((a) => a.id)).toEqual(["jovenes"]);
    expect(canCreateEvents(leader, AREAS)).toBe(true);
  });
  it("manage_all: todas las activas, por nombre", () => {
    expect(creatableAreas(pastor, AREAS).map((a) => a.id)).toEqual(["alabanza", "jovenes"]);
  });
  it("sin gestión (solo lectura o solo publicar): ninguna", () => {
    expect(creatableAreas(reader, AREAS)).toEqual([]);
    expect(creatableAreas(publishOnly, AREAS)).toEqual([]);
    expect(canCreateEvents(reader, AREAS)).toBe(false);
  });
  it("publishableAreas: creatable ∩ publicar", () => {
    expect(publishableAreas(leader, AREAS)).toEqual([]);
    expect(publishableAreas(publisher, AREAS).map((a) => a.id)).toEqual(["jovenes"]);
    expect(publishableAreas(admin, AREAS).map((a) => a.id)).toEqual(["alabanza", "jovenes"]);
  });
});

describe("validateEvent", () => {
  const ctx = { areas: AREAS, today: TODAY };
  it("el líder solo elige sus áreas como responsable", () => {
    expect(validateEvent(input({ responsibleAreaId: "alabanza" }), { ...ctx, actor: leader }).responsibleAreaId).toBeTruthy();
    expect(validateEvent(input(), { ...ctx, actor: leader })).toEqual({});
  });
  it("Pública sin permiso de publicar es un error; con permiso no", () => {
    expect(validateEvent(input({ visibility: "public" }), { ...ctx, actor: leader }).visibility).toBeTruthy();
    expect(validateEvent(input({ visibility: "public" }), { ...ctx, actor: publisher })).toEqual({});
  });
  it("actividad ya pública: sin publicar solo cambian las notas internas", () => {
    const pub = ev({ visibility: "public" });
    const base = input({ title: pub.title, visibility: "public" });
    expect(validateEvent({ ...base, internalNotes: "Llevar sillas" }, { ...ctx, actor: leader, existing: pub })).toEqual({});
    expect(validateEvent({ ...base, title: "Otro" }, { ...ctx, actor: leader, existing: pub }).visibility).toBeTruthy();
  });
  it("no crea en fechas pasadas salvo manage_all", () => {
    const past = input({ startDate: "2026-10-01", endDate: "2026-10-01" });
    expect(validateEvent(past, { ...ctx, actor: leader }).startDate).toBeTruthy();
    expect(validateEvent(past, { ...ctx, actor: admin }).startDate).toBeUndefined();
  });
  it("recurrente exige hasta cuándo", () => {
    expect(validateEvent(input({ recurrence: { freq: "weekly" } }), { ...ctx, actor: leader }).recurrence).toBeTruthy();
  });
  it("serie iniciada: no cambia hora; sí la fecha final si queda ≥ hoy", () => {
    const series = ev({ startDate: "2026-10-04", endDate: "2026-10-04", recurrence: { freq: "weekly", until: "2026-12-27" }, lastDate: "2026-12-27" });
    const same = input({ title: series.title, startDate: "2026-10-04", endDate: "2026-10-04", recurrence: { freq: "weekly", until: "2026-12-27" } });
    expect(validateSeriesPatch(series, { ...same, startTime: "20:00" }, { ...ctx, actor: leader }).temporal).toBeTruthy();
    expect(validateSeriesPatch(series, { ...same, recurrence: { freq: "weekly", until: "2026-11-29" } }, { ...ctx, actor: leader })).toEqual({});
  });
});

describe("myActivities", () => {
  it("responsable editable, participante solo lectura", () => {
    const events = [ev(), ev({ id: "e2", responsibleAreaId: "alabanza", participantAreaIds: ["jovenes"] }), ev({ id: "e3", responsibleAreaId: "alabanza" })];
    const list = myActivities(leader, events, AREAS, TODAY, "2026-10-31", NOW);
    const rows = list.map((x) => [x.occurrence.eventId, x.role, x.readOnly]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(rows).toEqual([
      ["e1", "responsable", false],
      ["e2", "participante", true],
    ]);
  });
});
