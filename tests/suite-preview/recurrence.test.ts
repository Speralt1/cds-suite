import { describe, expect, it } from "vitest";
import { validateSeriesPatch } from "@/lib/suite-preview/calendar";
import { AREAS, DEMO_NOW, EVENTS, USERS } from "@/lib/suite-preview/fixtures";
import { expandRecurrence, isOccurrenceDate, monthlyOrdinalOptions, recurrenceSummary, validateRecurrence } from "@/lib/suite-preview/recurrence";
import type { CalendarEvent } from "@/lib/suite-preview/types";

const ev = (id: string) => EVENTS.find((e) => e.id === id)!;
const dates = (e: CalendarEvent, from = "2026-08-01", to = "2027-12-31", now = DEMO_NOW) => expandRecurrence(e, from, to, now).map((o) => o.date);
const base: CalendarEvent = {
  id: "t",
  title: "Prueba",
  responsibleAreaId: "jovenes",
  participantAreaIds: [],
  startDate: "2026-10-06",
  endDate: "2026-10-06",
  allDay: false,
  startTime: "19:00",
  endTime: "20:00",
  visibility: "public",
  status: "programada",
  recurrence: { freq: "weekly", until: "2026-10-27" },
  exceptions: [],
  createdBy: "admin",
  createdAt: "2026-10-01T10:00",
  revision: 1,
};

describe("expansión de recurrencias", () => {
  it("semanal con until inclusivo", () => {
    expect(dates(base)).toEqual(["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]);
  });

  it("quincenal con until inclusivo y cruce de mes", () => {
    expect(dates({ ...base, recurrence: { freq: "biweekly", until: "2026-11-17" } })).toEqual([
      "2026-10-06",
      "2026-10-20",
      "2026-11-03",
      "2026-11-17",
    ]);
  });

  it("mensual 1.er sábado (fechas verificadas, cruce de año)", () => {
    expect(dates(ev("ev-ayuno"))).toEqual(["2026-10-03", "2026-11-07", "2026-12-05", "2027-01-02", "2027-02-06", "2027-03-06"]);
  });

  it("mensual último viernes (vigilia)", () => {
    expect(dates(ev("ev-vigilia"))).toEqual(["2026-10-30", "2026-11-27", "2026-12-25", "2027-01-29", "2027-02-26"]);
  });

  it("mensual 2.º sábado y febrero", () => {
    expect(dates(ev("ev-varones"))).toEqual(["2026-10-10", "2026-11-14", "2026-12-12", "2027-01-09", "2027-02-13", "2027-03-13"]);
    const feb = { ...base, startDate: "2027-02-22", endDate: "2027-02-22", recurrence: { freq: "monthly" as const, until: "2027-04-30", monthly: { mode: "nth_weekday" as const, weekday: 1, ordinal: -1 as const } } };
    expect(dates(feb)).toEqual(["2027-02-22", "2027-03-29", "2027-04-26"]);
  });

  it("opciones de ordinal al crear", () => {
    expect(monthlyOrdinalOptions("2026-11-28")).toEqual([4, -1]);
    expect(monthlyOrdinalOptions("2026-10-30")).toEqual([-1]);
    expect(monthlyOrdinalOptions("2026-10-03")).toEqual([1]);
    expect(recurrenceSummary(ev("ev-ayuno"))).toBe("Cada mes, el primer sábado, hasta el 06-03-2027");
  });

  it("valida until, 12 meses, 60 fechas y varios días", () => {
    expect(validateRecurrence({ freq: "weekly" }, "2026-10-06", "2026-10-06")[0]).toMatch(/hasta cuándo/);
    expect(validateRecurrence({ freq: "weekly", until: "2026-10-01" }, "2026-10-06", "2026-10-06")[0]).toMatch(/posterior/);
    expect(validateRecurrence({ freq: "weekly", until: "2027-10-07" }, "2026-10-06", "2026-10-06")[0]).toMatch(/12 meses/);
    expect(validateRecurrence({ freq: "weekly", until: "2027-10-06" }, "2026-10-06", "2026-10-06")).toEqual([]);
    expect(validateRecurrence({ freq: "weekly", until: "2026-12-01" }, "2026-10-17", "2026-10-19")[0]).toMatch(/varios días/);
    expect(validateRecurrence({ freq: "monthly", until: "2027-01-01", monthly: { mode: "nth_weekday", weekday: 6, ordinal: 2 } }, "2026-10-03", "2026-10-03")[0]).toMatch(/no cumple/);
  });

  it("una excepción cancela solo esa fecha", () => {
    const occ = expandRecurrence(ev("ev-jovenes"), "2026-10-09", "2026-10-23", DEMO_NOW);
    expect(occ.map((o) => `${o.date}:${o.status}`)).toEqual(["2026-10-09:programada", "2026-10-16:cancelada", "2026-10-23:programada"]);
    expect(isOccurrenceDate(ev("ev-jovenes"), "2026-10-16")).toBe(true);
    expect(isOccurrenceDate(ev("ev-jovenes"), "2026-10-17")).toBe(false);
  });

  it("seriesCancellation: pasadas realizadas, futuras canceladas", () => {
    const e = { ...base, startDate: "2026-09-29", endDate: "2026-09-29", seriesCancellation: { from: "2026-10-04", reason: "x", by: "admin", at: DEMO_NOW } };
    expect(expandRecurrence(e, "2026-09-01", "2026-10-31", DEMO_NOW).map((o) => o.status)).toEqual(["realizada", "cancelada", "cancelada", "cancelada", "cancelada"]);
  });

  it("la vigilia 22:00–02:00 aparece en la consulta del día siguiente; el campamento en ambos días", () => {
    expect(dates(ev("ev-vigilia"), "2026-10-31", "2026-10-31")).toEqual(["2026-10-30"]);
    expect(dates(ev("ev-campamento"), "2026-10-18", "2026-10-18")).toEqual(["2026-10-17"]);
    expect(dates(ev("ev-campamento"), "2026-10-17", "2026-10-17")).toEqual(["2026-10-17"]);
    expect(dates(ev("ev-campamento"), "2026-10-19", "2026-10-30")).toEqual([]);
  });

  it("realizada derivada en el borde de DEMO_NOW", () => {
    const at = (endTime: string) => expandRecurrence({ ...base, startDate: "2026-10-04", endDate: "2026-10-04", startTime: "11:00", endTime, recurrence: { freq: "none" } }, "2026-10-04", "2026-10-04", "2026-10-04T13:30")[0].status;
    expect(at("13:00")).toBe("realizada");
    expect(at("13:30")).toBe("programada");
  });

  it("una serie que cruza abril de 2027 conserva la hora de pared", () => {
    const e = { ...base, startDate: "2027-03-30", endDate: "2027-03-30", recurrence: { freq: "weekly" as const, until: "2027-04-13" } };
    const occ = expandRecurrence(e, "2027-03-01", "2027-04-30", DEMO_NOW);
    expect(occ.map((o) => `${o.date} ${o.startTime}`)).toEqual(["2027-03-30 19:00", "2027-04-06 19:00", "2027-04-13 19:00"]);
  });

  it("las archivadas no generan ocurrencias", () => {
    expect(dates(ev("ev-archivada"))).toEqual([]);
  });

  it("editar una serie ya iniciada bloquea los campos temporales", () => {
    const admin = USERS.find((u) => u.uid === "admin")!;
    const ctx = { profile: admin, areas: AREAS, today: "2026-10-04" };
    expect(validateSeriesPatch(ev("ev-culto"), { startTime: "10:00" }, ctx).temporal).toMatch(/Esta y las siguientes/);
    expect(validateSeriesPatch(ev("ev-culto"), { title: "Culto de domingo", recurrence: { freq: "weekly", until: "2027-01-31" } }, ctx)).toEqual({});
    expect(validateSeriesPatch(ev("ev-culto"), { recurrence: { freq: "weekly", until: "2026-10-01" } }, ctx).recurrence).toMatch(/pasado/);
    // una serie que no empezó se puede editar completa
    expect(validateSeriesPatch(ev("ev-vigilia"), { startTime: "21:00" }, ctx)).toEqual({});
  });
});
