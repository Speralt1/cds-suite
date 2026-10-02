import { describe, expect, it } from "vitest";
import {
  agendaGroups,
  canArchiveEvent,
  canManageEvent,
  filterByAreas,
  monthGrid,
  myActivities,
  occurrencesInRange,
  sortOccurrences,
  validateEvent,
  weekRange,
} from "@/lib/suite-preview/calendar";
import { AREAS, DEMO_NOW, DEMO_TODAY, EVENTS, USERS } from "@/lib/suite-preview/fixtures";

const user = (uid: string) => USERS.find((u) => u.uid === uid)!;
const ev = (id: string) => EVENTS.find((e) => e.id === id)!;
const today = DEMO_TODAY;

describe("canManageEvent", () => {
  const lider = user("lider");
  it("Líder de Jóvenes: responsable sí; solo participante no; otra área no", () => {
    expect(canManageEvent(lider, ev("ev-jovenes"), AREAS, today, "2026-10-09")).toBe(true);
    expect(canManageEvent(lider, ev("ev-evangelismo"), AREAS, today)).toBe(false); // Jóvenes participa
    expect(canManageEvent(lider, ev("ev-culto"), AREAS, today, "2026-10-11")).toBe(false);
  });
  it("pasado no; área inactiva no; manage_all en pasado sí; archivada nunca", () => {
    expect(canManageEvent(lider, ev("ev-jovenes"), AREAS, today, "2026-10-02")).toBe(false);
    const inactive = AREAS.map((a) => (a.id === "jovenes" ? { ...a, active: false } : a));
    expect(canManageEvent(lider, ev("ev-jovenes"), inactive, today, "2026-10-09")).toBe(false);
    expect(canManageEvent(user("pastor"), ev("ev-jovenes"), AREAS, today, "2026-09-04")).toBe(true);
    expect(canManageEvent(user("admin"), ev("ev-archivada"), AREAS, today)).toBe(false);
    expect(canManageEvent(user("finanzas"), ev("ev-jovenes"), AREAS, today, "2026-10-09")).toBe(false);
  });
  it("manage_assigned no archiva actividades que ya empezaron", () => {
    expect(canArchiveEvent(lider, ev("ev-jovenes"), AREAS, today)).toBe(false);
    expect(canArchiveEvent(lider, ev("ev-campamento"), AREAS, today)).toBe(true);
    expect(canArchiveEvent(user("admin"), ev("ev-jovenes"), AREAS, today)).toBe(true);
  });
});

describe("vistas", () => {
  const month = occurrencesInRange(EVENTS, "2026-10-01", "2026-10-31", DEMO_NOW);
  it("archivadas fuera de todas las vistas; canceladas visibles", () => {
    expect(month.some((o) => o.eventId === "ev-archivada")).toBe(false);
    expect(month.find((o) => o.eventId === "ev-evangelismo")?.status).toBe("cancelada");
  });
  it("orden: por día, primero todo el día y después por hora", () => {
    const day = sortOccurrences(occurrencesInRange(EVENTS, "2026-10-17", "2026-10-17", DEMO_NOW));
    expect(day.map((o) => o.eventId)).toEqual(["ev-campamento", "ev-ensayo"]);
    const sunday = occurrencesInRange(EVENTS, "2026-10-04", "2026-10-04", DEMO_NOW).map((o) => o.eventId);
    expect(sunday).toEqual(["ev-culto", "ev-escuela"]);
  });
  it("filtro por área: responsable o participante, y solo responsable", () => {
    expect(new Set(filterByAreas(month, ["jovenes"]).map((o) => o.eventId))).toEqual(new Set(["ev-jovenes", "ev-campamento", "ev-evangelismo"]));
    expect(new Set(filterByAreas(month, ["jovenes"], true).map((o) => o.eventId))).toEqual(new Set(["ev-jovenes", "ev-campamento"]));
    expect(filterByAreas(month, [])).toHaveLength(month.length);
  });
  it("Mis actividades con bandera de solo lectura", () => {
    const mine = myActivities(user("lider"), EVENTS, AREAS, "2026-10-01", "2026-10-31", DEMO_NOW);
    const evang = mine.find((m) => m.occurrence.eventId === "ev-evangelismo")!;
    expect(evang).toMatchObject({ role: "participante", readOnly: true });
    const past = mine.find((m) => m.occurrence.key === "ev-jovenes@2026-10-02")!;
    expect(past).toMatchObject({ role: "responsable", readOnly: true });
    expect(mine.find((m) => m.occurrence.key === "ev-jovenes@2026-10-09")).toMatchObject({ readOnly: false });
  });
  it("grilla del mes lunes–domingo y semana", () => {
    const grid = monthGrid(2026, 10);
    expect(grid[0][0]).toEqual({ date: "2026-09-28", inMonth: false });
    expect(grid[0][6].date).toBe("2026-10-04");
    expect(grid.at(-1)!.at(-1)!.date).toBe("2026-11-01");
    expect(weekRange("2026-10-04")).toMatchObject({ from: "2026-09-28", to: "2026-10-04" });
  });
  it("agenda sin días vacíos y con etiqueta Hoy / Mañana", () => {
    const groups = agendaGroups(occurrencesInRange(EVENTS, "2026-10-04", "2026-10-06", DEMO_NOW), today);
    expect(groups.map((g) => g.label)).toEqual(["Hoy · domingo 4 de octubre", "Mañana · lunes 5 de octubre", "martes 6 de octubre"]);
  });
});

describe("validateEvent", () => {
  const lider = user("lider");
  const valid = { title: "Noche de jóvenes", responsibleAreaId: "jovenes", startDate: "2026-10-21", startTime: "20:00", endTime: "22:00" };
  it("acepta una actividad válida del Líder", () => {
    expect(validateEvent(valid, { profile: lider, areas: AREAS, today })).toEqual({});
  });
  it("rechaza responsable ajeno, fechas pasadas y horas inválidas", () => {
    expect(validateEvent({ ...valid, responsibleAreaId: "pastoral" }, { profile: lider, areas: AREAS, today }).responsibleAreaId).toBeTruthy();
    expect(validateEvent({ ...valid, startDate: "2026-10-01" }, { profile: lider, areas: AREAS, today }).startDate).toBeTruthy();
    expect(validateEvent({ ...valid, endTime: "19:00" }, { profile: lider, areas: AREAS, today }).endTime).toBeTruthy();
    expect(validateEvent({ ...valid, participantAreaIds: ["jovenes"] }, { profile: lider, areas: AREAS, today }).participantAreaIds).toBeTruthy();
    expect(validateEvent({ ...valid, title: " " }, { profile: lider, areas: AREAS, today }).title).toBeTruthy();
  });
});
