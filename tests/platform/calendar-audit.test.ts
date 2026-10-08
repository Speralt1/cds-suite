// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AUDIT_IGNORED_FIELDS,
  buildChange,
  changedFields,
  planArchive,
  planCancelEvent,
  planCancelOccurrence,
  planCancelSeriesFrom,
  planCreate,
  planUpdate,
  planVisibility,
  type UpdatePlan,
} from "@/lib/calendar/audit";
import type { EventInput } from "@/lib/calendar/calendar";
import type { CalendarEvent } from "@/lib/shared/types";

/** Centinela de serverTimestamp(): el mismo objeto en evento y change. */
const NOW = { sentinel: "serverTimestamp" };
const CTX = { actorUid: "uid-lider", now: NOW };
const CREATED_AT = { seconds: 1 };

const INPUT: EventInput = {
  title: "  Reunión de jóvenes  ",
  responsibleAreaId: "jovenes",
  participantAreaIds: ["alabanza"],
  startDate: "2026-10-20",
  endDate: "2026-10-20",
  allDay: false,
  startTime: "19:00",
  endTime: "21:00",
  location: "Templo",
  publicDescription: "Para todos",
  internalNotes: "Llevar sillas",
  visibility: "internal",
  recurrence: { freq: "none" },
};

function stored(over: Partial<CalendarEvent> = {}): CalendarEvent {
  const { data } = planCreate(INPUT, { actorUid: "uid-creador", now: CREATED_AT });
  return { ...data, id: "ev1", ...over };
}

const SERIES = stored({
  startDate: "2026-10-04",
  endDate: "2026-10-04",
  recurrence: { freq: "weekly", until: "2026-12-27" },
  lastDate: "2026-12-27",
  revision: 3,
  lastChangeId: "r3",
});

/** Lo que exige `changeEventLinked`/`changeDiffOk` de las reglas sobre un plan de actualización. */
function expectRuleShape(before: CalendarEvent, plan: UpdatePlan) {
  const { change, next, patch, changeId } = plan;
  expect(next.revision).toBe(before.revision + 1);
  expect(next.lastChangeId).toBe(`r${before.revision + 1}`);
  expect(changeId).toBe(next.lastChangeId);
  expect(patch.updatedBy).toBe(CTX.actorUid);
  expect(patch.updatedAt).toBe(NOW);
  expect(patch).not.toHaveProperty("createdBy");
  expect(patch).not.toHaveProperty("createdAt");
  expect(next.createdAt).toBe(before.createdAt);
  expect(change.revision).toBe(next.revision);
  expect(change.actorUid).toBe(CTX.actorUid);
  expect(change.at).toBe(NOW);
  // changedFields == affectedKeys − {revision, lastChangeId, updatedBy, updatedAt, lastDate}
  const { id: _id, ...prev } = before;
  void _id;
  expect(new Set(change.changedFields)).toEqual(new Set(changedFields(prev, next)));
  for (const f of AUDIT_IGNORED_FIELDS) expect(change.changedFields).not.toContain(f);
  // before/after ⊆ changedFields y nunca internalNotes
  for (const m of [change.before, change.after]) {
    if (!m) continue;
    for (const k of Object.keys(m)) expect(change.changedFields).toContain(k);
    expect(m).not.toHaveProperty("internalNotes");
  }
  expect(change.changedFields.length).toBeLessThanOrEqual(30);
  if (change.reason !== null) expect(change.reason.length).toBeGreaterThanOrEqual(3);
}

describe("planCreate / created", () => {
  it("revision 1, r1, auditoría y change vacío", () => {
    const plan = planCreate(INPUT, CTX);
    expect(plan.data).toMatchObject({
      title: "Reunión de jóvenes",
      status: "scheduled",
      exceptions: [],
      lastDate: "2026-10-20",
      revision: 1,
      lastChangeId: "r1",
      createdBy: "uid-lider",
      createdAt: NOW,
      updatedBy: "uid-lider",
      updatedAt: NOW,
    });
    expect(plan.changeId).toBe("r1");
    expect(plan.change).toEqual({
      revision: 1,
      action: "created",
      actorUid: "uid-lider",
      at: NOW,
      changedFields: [],
      before: null,
      after: null,
      reason: null,
    });
    expect(Object.values(plan.data)).not.toContain(undefined);
  });
  it("lastDate de una serie = until (+ span)", () => {
    const plan = planCreate({ ...INPUT, recurrence: { freq: "weekly", until: "2026-12-27" } }, CTX);
    expect(plan.data.lastDate).toBe("2026-12-27");
  });
});

describe("planUpdate", () => {
  it("updated: solo los campos cambiados, con valores (sin internalNotes)", () => {
    const before = stored();
    const plan = planUpdate(before, { ...INPUT, title: "Reunión general", internalNotes: "Otra nota" }, CTX);
    expect(plan.change.action).toBe("updated");
    expect(plan.change.changedFields).toEqual(["internalNotes", "title"]);
    expect(plan.change.before).toEqual({ title: "Reunión de jóvenes" });
    expect(plan.change.after).toEqual({ title: "Reunión general" });
    expect(plan.change.reason).toBeNull();
    expect(Object.keys(plan.patch).sort()).toEqual(["internalNotes", "lastChangeId", "revision", "title", "updatedAt", "updatedBy"]);
    expectRuleShape(before, plan);
  });
  it("solo notas internas: changedFields las nombra y before/after quedan null", () => {
    const before = stored();
    const plan = planUpdate(before, { ...INPUT, internalNotes: "Nueva" }, CTX);
    expect(plan.change.changedFields).toEqual(["internalNotes"]);
    expect(plan.change.before).toBeNull();
    expect(plan.change.after).toBeNull();
    expectRuleShape(before, plan);
  });
  it("recurrence_updated (y lastDate fuera de changedFields)", () => {
    const plan = planUpdate(SERIES, { ...INPUT, startDate: "2026-10-04", endDate: "2026-10-04", recurrence: { freq: "weekly", until: "2026-11-29" } }, CTX);
    expect(plan.change.action).toBe("recurrence_updated");
    expect(plan.patch.lastDate).toBe("2026-11-29");
    expect(plan.change.changedFields).toEqual(["recurrence"]);
    expect(plan.change.after).toEqual({ recurrence: { freq: "weekly", until: "2026-11-29" } });
    expectRuleShape(SERIES, plan);
  });
  it("visibility_changed manda sobre recurrence_updated", () => {
    const plan = planUpdate(stored(), { ...INPUT, visibility: "public", recurrence: { freq: "weekly", until: "2026-12-20" } }, CTX);
    expect(plan.change.action).toBe("visibility_changed");
  });
});

describe("planVisibility", () => {
  it("publicar y dejar de publicar", () => {
    const before = stored();
    const pub = planVisibility(before, "public", CTX);
    expect(pub.change).toMatchObject({ action: "visibility_changed", changedFields: ["visibility"], before: { visibility: "internal" }, after: { visibility: "public" } });
    expectRuleShape(before, pub);
    const unpub = planVisibility(stored({ visibility: "public" }), "internal", CTX);
    expect(unpub.change.after).toEqual({ visibility: "internal" });
  });
});

describe("cancelaciones y archivo", () => {
  it("cancelar actividad simple: status + motivo", () => {
    const before = stored();
    const plan = planCancelEvent(before, "  Lluvia intensa ", CTX);
    expect(plan.patch).toMatchObject({ status: "cancelled", cancelReason: "Lluvia intensa" });
    expect(plan.change).toMatchObject({
      action: "cancelled",
      scope: "event",
      changedFields: ["cancelReason", "status"],
      before: { status: "scheduled" },
      after: { status: "cancelled" },
      reason: "Lluvia intensa",
    });
    expectRuleShape(before, plan);
  });
  it("cancelar solo una fecha: una excepción al final, sin valores en before/after", () => {
    const plan = planCancelOccurrence(SERIES, "2026-10-18", "Feriado", CTX);
    expect(plan.patch.exceptions).toEqual([{ date: "2026-10-18", type: "cancelled", reason: "Feriado", by: "uid-lider" }]);
    expect(plan.change).toMatchObject({
      action: "cancelled",
      scope: "occurrence",
      occurrenceDate: "2026-10-18",
      changedFields: ["exceptions"],
      before: null,
      after: null,
      reason: "Feriado",
    });
    expectRuleShape(SERIES, plan);
  });
  it("cancelar la serie desde hoy", () => {
    const plan = planCancelSeriesFrom(SERIES, "2026-10-10", "Se termina el ciclo", CTX);
    expect(plan.patch.seriesCancellation).toEqual({ from: "2026-10-10", reason: "Se termina el ciclo", by: "uid-lider", at: NOW });
    expect(plan.change).toMatchObject({ action: "cancelled", scope: "series", changedFields: ["seriesCancellation"], before: null, after: null });
    expectRuleShape(SERIES, plan);
  });
  it("archivar: status, archivedAt (= now) y motivo", () => {
    const before = stored({ revision: 2, lastChangeId: "r2" });
    const plan = planArchive(before, "Duplicada", CTX);
    expect(plan.patch).toMatchObject({ status: "archived", archivedAt: NOW, archiveReason: "Duplicada", revision: 3, lastChangeId: "r3" });
    expect(plan.change).toMatchObject({
      action: "archived",
      changedFields: ["archiveReason", "archivedAt", "status"],
      before: { status: "scheduled" },
      after: { status: "archived" },
      reason: "Duplicada",
    });
    expectRuleShape(before, plan);
  });
  it("archivar una cancelada conserva cancelReason fuera del diff", () => {
    const before = stored({ status: "cancelled", cancelReason: "Lluvia" });
    const plan = planArchive(before, "Creada por error", CTX);
    expect(plan.change.changedFields).not.toContain("cancelReason");
    expect(plan.change.before).toEqual({ status: "cancelled" });
  });
});

describe("buildChange", () => {
  it("internalNotes nunca aparece con valor aunque cambie junto a otros campos", () => {
    const before = stored();
    const { id: _id, ...prev } = before;
    void _id;
    const next = { ...prev, internalNotes: "secreto", location: "Salón", revision: 2, lastChangeId: "r2", updatedAt: NOW, updatedBy: "uid-lider" };
    const change = buildChange(prev, next, CTX);
    expect(change.changedFields).toEqual(["internalNotes", "location"]);
    expect(JSON.stringify(change)).not.toContain("secreto");
  });
});
