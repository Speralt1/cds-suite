// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareDayOrder, lastDateOf, occurrencesInRange, sortOccurrences } from "@/lib/shared/calendar-core";
import {
  addDays,
  addMonthsClamped,
  daysBetween,
  isValidTime,
  isValidYmd,
  localNow,
  localToday,
  nthWeekdayOfMonth,
  weekdayOf,
} from "@/lib/shared/dates";
import {
  MAX_OCCURRENCES,
  candidateDates,
  eventSpan,
  expandRecurrence,
  isOccurrenceDate,
  monthlyOrdinalOptions,
  occurrenceEnd,
  recurrenceDetailText,
  recurrenceSummary,
  validateRecurrence,
} from "@/lib/shared/recurrence";
import type { Area, CalendarEvent } from "@/lib/shared/types";

const NOW = "2026-10-04T12:00";

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "t",
    title: "Prueba",
    responsibleAreaId: "jovenes",
    participantAreaIds: [],
    startDate: "2026-10-06",
    endDate: "2026-10-06",
    allDay: false,
    startTime: "19:00",
    endTime: "20:00",
    location: "",
    publicDescription: "",
    internalNotes: "",
    visibility: "public",
    status: "scheduled",
    recurrence: { freq: "weekly", until: "2026-10-27" },
    exceptions: [],
    lastDate: "2026-10-27",
    revision: 1,
    lastChangeId: "r1",
    createdBy: "u-admin",
    createdAt: null,
    updatedBy: "u-admin",
    updatedAt: null,
    ...over,
  };
}

const ayuno = event({
  id: "ev-ayuno",
  startDate: "2026-10-03",
  endDate: "2026-10-03",
  startTime: "10:00",
  endTime: "13:00",
  recurrence: { freq: "monthly", until: "2027-03-06", monthly: { mode: "nth_weekday", weekday: 6, ordinal: 1 } },
});
const vigilia = event({
  id: "ev-vigilia",
  startDate: "2026-10-30",
  endDate: "2026-10-31",
  startTime: "22:00",
  endTime: "02:00",
  recurrence: { freq: "monthly", until: "2027-02-26", monthly: { mode: "nth_weekday", weekday: 5, ordinal: -1 } },
});
const varones = event({
  id: "ev-varones",
  startDate: "2026-10-10",
  endDate: "2026-10-10",
  startTime: "09:00",
  endTime: "11:00",
  recurrence: { freq: "monthly", until: "2027-03-13", monthly: { mode: "nth_weekday", weekday: 6, ordinal: 2 } },
});
const campamento = event({
  id: "ev-campamento",
  startDate: "2026-10-17",
  endDate: "2026-10-18",
  allDay: true,
  startTime: null,
  endTime: null,
  recurrence: { freq: "none" },
});
const jovenes = event({
  id: "ev-jovenes",
  startDate: "2026-10-02",
  endDate: "2026-10-02",
  startTime: "20:00",
  endTime: "22:00",
  recurrence: { freq: "weekly", until: "2027-01-29" },
  exceptions: [{ date: "2026-10-16", type: "cancelled", reason: "Motivo interno", by: "u-lider" }],
});

const dates = (e: CalendarEvent, from = "2026-08-01", to = "2027-12-31", now = NOW) =>
  expandRecurrence(e, from, to, now).map((o) => o.date);

describe("dates", () => {
  it("validación y aritmética de fechas locales", () => {
    expect(isValidYmd("2027-02-29")).toBe(false);
    expect(isValidYmd("2028-02-29")).toBe(true);
    expect(isValidYmd("2026-13-01")).toBe(false);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2027-03-28", "2027-04-11")).toBe(14);
    expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
    expect(weekdayOf("2026-10-04")).toBe(0);
    expect(nthWeekdayOfMonth(2027, 4, 0, 1)).toBe("2027-04-04");
    expect(nthWeekdayOfMonth(2027, 9, 0, 1)).toBe("2027-09-05");
    expect(nthWeekdayOfMonth(2026, 10, 5, -1)).toBe("2026-10-30");
  });

  it("localNow/localToday con instante inyectado (America/Santiago, cruces de DST 2027)", () => {
    expect(localNow(new Date("2026-10-02T12:00:00Z"))).toBe("2026-10-02T09:00");
    expect(localNow(Date.parse("2026-10-02T12:00:00Z"))).toBe("2026-10-02T09:00");
    // fin del horario de verano: domingo 4-abr-2027 00:00 (-03) → sábado 23:00 (-04)
    expect(localNow(new Date("2027-04-03T15:00:00Z"))).toBe("2027-04-03T12:00");
    expect(localNow(new Date("2027-04-04T02:59:00Z"))).toBe("2027-04-03T23:59");
    expect(localNow(new Date("2027-04-04T03:00:00Z"))).toBe("2027-04-03T23:00");
    expect(localNow(new Date("2027-04-04T15:00:00Z"))).toBe("2027-04-04T11:00");
    // inicio del horario de verano: domingo 5-sep-2027 00:00 (-04) → 01:00 (-03)
    expect(localNow(new Date("2027-09-04T15:00:00Z"))).toBe("2027-09-04T11:00");
    expect(localNow(new Date("2027-09-05T04:00:00Z"))).toBe("2027-09-05T01:00");
    expect(localNow(new Date("2027-09-05T15:00:00Z"))).toBe("2027-09-05T12:00");
    // cambio de día local vs UTC
    expect(localToday(new Date("2026-10-01T02:30:00Z"))).toBe("2026-09-30");
    expect(localToday(new Date("2026-10-01T02:30:00Z"), "UTC")).toBe("2026-10-01");
  });
});

describe("expansión de recurrencias (port PR #4, fechas verificadas)", () => {
  it("semanal con until inclusivo", () => {
    expect(dates(event())).toEqual(["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]);
  });

  it("quincenal con until inclusivo y cruce de mes", () => {
    expect(dates(event({ recurrence: { freq: "biweekly", until: "2026-11-17" } }))).toEqual([
      "2026-10-06",
      "2026-10-20",
      "2026-11-03",
      "2026-11-17",
    ]);
  });

  it("mensual 1.er sábado (cruce de año)", () => {
    expect(dates(ayuno)).toEqual(["2026-10-03", "2026-11-07", "2026-12-05", "2027-01-02", "2027-02-06", "2027-03-06"]);
  });

  it("mensual último viernes (ordinal -1, vigilia)", () => {
    expect(dates(vigilia)).toEqual(["2026-10-30", "2026-11-27", "2026-12-25", "2027-01-29", "2027-02-26"]);
  });

  it("mensual 2.º sábado y último lunes de febrero", () => {
    expect(dates(varones)).toEqual(["2026-10-10", "2026-11-14", "2026-12-12", "2027-01-09", "2027-02-13", "2027-03-13"]);
    const feb = event({
      startDate: "2027-02-22",
      endDate: "2027-02-22",
      recurrence: { freq: "monthly", until: "2027-04-30", monthly: { mode: "nth_weekday", weekday: 1, ordinal: -1 } },
    });
    expect(dates(feb)).toEqual(["2027-02-22", "2027-03-29", "2027-04-26"]);
  });

  it("opciones de ordinal al crear y textos", () => {
    expect(monthlyOrdinalOptions("2026-11-28")).toEqual([4, -1]);
    expect(monthlyOrdinalOptions("2026-10-30")).toEqual([-1]);
    expect(monthlyOrdinalOptions("2026-10-03")).toEqual([1]);
    expect(recurrenceSummary(ayuno)).toBe("Cada mes, el primer sábado, hasta el 06-03-2027");
    expect(recurrenceDetailText(ayuno)).toBe("El primer sábado de cada mes hasta el 6 mar 2027");
    expect(recurrenceDetailText(event())).toBe("Se repite cada martes hasta el 27 oct 2026");
    expect(recurrenceDetailText(event({ recurrence: { freq: "biweekly", until: "2026-11-17" } }))).toBe(
      "Cada 2 semanas, los martes, hasta el 17 nov 2026",
    );
    expect(recurrenceDetailText(campamento)).toBeNull();
  });

  it("una excepción cancela solo esa fecha (con su motivo interno)", () => {
    const occ = expandRecurrence(jovenes, "2026-10-09", "2026-10-23", NOW);
    expect(occ.map((o) => `${o.date}:${o.status}`)).toEqual([
      "2026-10-09:scheduled",
      "2026-10-16:cancelled",
      "2026-10-23:scheduled",
    ]);
    expect(occ[1].cancelReason).toBe("Motivo interno");
    expect(occ[0].cancelReason).toBeNull();
    expect(isOccurrenceDate(jovenes, "2026-10-16")).toBe(true);
    expect(isOccurrenceDate(jovenes, "2026-10-17")).toBe(false);
  });

  it("seriesCancellation: pasadas realizadas, desde `from` canceladas", () => {
    const e = event({
      startDate: "2026-09-29",
      endDate: "2026-09-29",
      seriesCancellation: { from: "2026-10-04", reason: "x", by: "u-admin", at: null },
    });
    expect(expandRecurrence(e, "2026-09-01", "2026-10-31", NOW).map((o) => o.status)).toEqual([
      "realized",
      "cancelled",
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
  });

  it("simple cancelada: la ocurrencia queda cancelled con su motivo", () => {
    const e = event({ recurrence: { freq: "none" }, status: "cancelled", cancelReason: "Lluvia" });
    const [o] = expandRecurrence(e, "2026-10-01", "2026-10-31", NOW);
    expect(o.status).toBe("cancelled");
    expect(o.cancelReason).toBe("Lluvia");
  });

  it("vigilia 22:00–02:00 aparece en la consulta del día siguiente; el campamento en ambos días", () => {
    expect(dates(vigilia, "2026-10-31", "2026-10-31")).toEqual(["2026-10-30"]);
    expect(eventSpan(vigilia)).toBe(1);
    expect(occurrenceEnd(vigilia, "2026-10-30")).toBe("2026-10-31T02:00");
    expect(dates(campamento, "2026-10-18", "2026-10-18")).toEqual(["2026-10-17"]);
    expect(dates(campamento, "2026-10-17", "2026-10-17")).toEqual(["2026-10-17"]);
    expect(dates(campamento, "2026-10-19", "2026-10-30")).toEqual([]);
    const [camp] = expandRecurrence(campamento, "2026-10-17", "2026-10-17", NOW);
    expect(camp).toMatchObject({ endDate: "2026-10-18", allDay: true, startTime: null, endTime: null });
  });

  it("realizada derivada en el borde de `now`", () => {
    const at = (endTime: string) =>
      expandRecurrence(
        event({ startDate: "2026-10-04", endDate: "2026-10-04", startTime: "11:00", endTime, recurrence: { freq: "none" } }),
        "2026-10-04",
        "2026-10-04",
        "2026-10-04T13:30",
      )[0].status;
    expect(at("13:00")).toBe("realized");
    expect(at("13:30")).toBe("scheduled");
  });

  it("DST: una serie dominical 11:00 que cruza el 4-abr-2027 y el 5-sep-2027 conserva la hora de pared", () => {
    const culto = event({
      startDate: "2027-03-28",
      endDate: "2027-03-28",
      startTime: "11:00",
      endTime: "13:00",
      recurrence: { freq: "weekly", until: "2027-09-12" },
    });
    const april = expandRecurrence(culto, "2027-03-28", "2027-04-11", NOW);
    expect(april.map((o) => `${o.date} ${o.startTime}-${o.endTime}`)).toEqual([
      "2027-03-28 11:00-13:00",
      "2027-04-04 11:00-13:00",
      "2027-04-11 11:00-13:00",
    ]);
    const september = expandRecurrence(culto, "2027-08-29", "2027-09-12", NOW);
    expect(september.map((o) => `${o.date} ${o.startTime}`)).toEqual(["2027-08-29 11:00", "2027-09-05 11:00", "2027-09-12 11:00"]);
    // todas las fechas siguen siendo domingo
    expect(expandRecurrence(culto, "2027-03-01", "2027-09-30", NOW).every((o) => weekdayOf(o.date) === 0)).toBe(true);
    // y una serie de martes que cruza abril (port PR #4)
    const tuesday = event({ startDate: "2027-03-30", endDate: "2027-03-30", recurrence: { freq: "weekly", until: "2027-04-13" } });
    expect(expandRecurrence(tuesday, "2027-03-01", "2027-04-30", NOW).map((o) => `${o.date} ${o.startTime}`)).toEqual([
      "2027-03-30 19:00",
      "2027-04-06 19:00",
      "2027-04-13 19:00",
    ]);
  });

  it("las archivadas no generan ocurrencias", () => {
    expect(dates(event({ status: "archived" }))).toEqual([]);
  });
});

describe("validateRecurrence (límites V1)", () => {
  it("until obligatorio, posterior, ≤ 12 meses, regla mensual coherente y span ≤ 1", () => {
    expect(validateRecurrence({ freq: "none" }, "2026-10-06", "2026-10-20")).toEqual([]);
    expect(validateRecurrence({ freq: "weekly" }, "2026-10-06", "2026-10-06")[0]).toMatch(/hasta cuándo/);
    expect(validateRecurrence({ freq: "weekly", until: "2026-10-01" }, "2026-10-06", "2026-10-06")[0]).toMatch(/posterior/);
    expect(validateRecurrence({ freq: "weekly", until: "2027-10-07" }, "2026-10-06", "2026-10-06")[0]).toMatch(/12 meses/);
    expect(validateRecurrence({ freq: "weekly", until: "2027-10-06" }, "2026-10-06", "2026-10-06")).toEqual([]);
    expect(validateRecurrence({ freq: "weekly", until: "2026-12-01" }, "2026-10-17", "2026-10-19")[0]).toMatch(/varios días/);
    expect(validateRecurrence({ freq: "weekly", until: "2026-12-01" }, "2026-10-30", "2026-10-31")).toEqual([]);
    expect(
      validateRecurrence(
        { freq: "monthly", until: "2027-01-01", monthly: { mode: "nth_weekday", weekday: 6, ordinal: 2 } },
        "2026-10-03",
        "2026-10-03",
      )[0],
    ).toMatch(/no cumple/);
    expect(validateRecurrence({ freq: "monthly", until: "2027-01-01" }, "2026-10-03", "2026-10-03")[0]).toMatch(/día del mes/);
    expect(validateRecurrence({ freq: "daily" as never, until: "2027-01-01" }, "2026-10-03", "2026-10-03")[0]).toMatch(/frecuencia/);
  });

  it("una serie semanal de 12 meses queda bajo 60 fechas", () => {
    const n = candidateDates(
      { startDate: "2026-10-06", endDate: "2026-10-06", recurrence: { freq: "weekly", until: "2027-10-06" } },
      "2026-10-06",
      "2027-10-06",
    ).length;
    expect(n).toBe(53);
    expect(n).toBeLessThanOrEqual(MAX_OCCURRENCES);
  });
});

describe("calendar-core", () => {
  it("lastDateOf: none → endDate; recurrente → until + span", () => {
    expect(lastDateOf(campamento)).toBe("2026-10-18");
    expect(lastDateOf(event())).toBe("2026-10-27");
    expect(lastDateOf(vigilia)).toBe("2027-02-27");
  });

  it("orden único: todo el día primero, luego hora, área y título", () => {
    const areas: Area[] = [
      { id: "jovenes", name: "Jóvenes", color: "azul", active: true },
      { id: "alabanza", name: "Alabanza", color: "verde", active: true },
    ];
    const a = event({ id: "a", title: "Zeta", startDate: "2026-10-10", endDate: "2026-10-10", startTime: "10:00", recurrence: { freq: "none" } });
    const b = event({
      id: "b",
      title: "Alfa",
      responsibleAreaId: "alabanza",
      startDate: "2026-10-10",
      endDate: "2026-10-10",
      startTime: "10:00",
      recurrence: { freq: "none" },
    });
    const c = event({ id: "c", title: "Día", startDate: "2026-10-10", endDate: "2026-10-10", allDay: true, startTime: null, endTime: null, recurrence: { freq: "none" } });
    const d = event({ id: "d", title: "Temprano", startDate: "2026-10-10", endDate: "2026-10-10", startTime: "08:00", recurrence: { freq: "none" } });
    const list = occurrencesInRange([a, b, c, d], "2026-10-10", "2026-10-10", NOW, areas);
    expect(list.map((o) => o.eventId)).toEqual(["c", "d", "b", "a"]);
    expect(sortOccurrences([...list].reverse(), areas).map((o) => o.eventId)).toEqual(["c", "d", "b", "a"]);
    expect(
      compareDayOrder(
        { date: "2026-10-09", allDay: false, startTime: "23:00", areaName: "", title: "" },
        { date: "2026-10-10", allDay: true, areaName: "", title: "" },
      ),
    ).toBeLessThan(0);
  });
});
