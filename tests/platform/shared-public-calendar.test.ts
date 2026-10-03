// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CHURCH_NAME,
  PUBLIC_AREA_KEYS,
  PUBLIC_CALENDAR_KEYS,
  PUBLIC_EVENT_KEYS,
  buildPublicCalendar,
  fnv1a64,
  isSeriesCutOccurrence,
  publicRange,
  publicRecurrenceLabel,
  sortPublicEvents,
  toPublicEvent,
} from "@/lib/shared/public-calendar";
import { expandRecurrence } from "@/lib/shared/recurrence";
import type { PublicArea, PublicCalendar } from "@/lib/shared/types";
import { AREAS, CANARIES, EVENTS, NOW, TODAY, event } from "./public-calendar-fixtures";

const build = (events = EVENTS, areas = AREAS): PublicCalendar => buildPublicCalendar({ events, areas, today: TODAY, now: NOW });

describe("lista blanca exacta", () => {
  const cal = build();

  it("claves exactas en profundidad", () => {
    expect(Object.keys(cal).sort()).toEqual([...PUBLIC_CALENDAR_KEYS].sort());
    expect(Object.keys(cal.range).sort()).toEqual(["from", "to"]);
    const checkArea = (a: PublicArea) => expect(Object.keys(a).sort()).toEqual([...PUBLIC_AREA_KEYS].sort());
    cal.areas.forEach(checkArea);
    expect(cal.events.length).toBeGreaterThan(20);
    for (const e of cal.events) {
      expect(Object.keys(e).sort()).toEqual([...PUBLIC_EVENT_KEYS].sort());
      checkArea(e.responsibleArea);
      e.participantAreas.forEach(checkArea);
      expect(e.id).toMatch(/^pe_[0-9a-f]{16}$/);
      expect(["scheduled", "cancelled"]).toContain(e.status);
    }
    expect(new Set(cal.events.map((e) => e.id)).size).toBe(cal.events.length);
    expect(cal.churchName).toBe(CHURCH_NAME);
    expect(cal.timeZone).toBe("America/Santiago");
  });

  it("ningún canario, correo, uid ni id interno en el JSON", () => {
    const json = JSON.stringify(cal);
    for (const c of Object.values(CANARIES)) expect(json, c).not.toContain(c);
    expect(json).not.toContain("@");
    expect(json).not.toMatch(/"ev-[a-z]/);
    expect(json).not.toContain("settings.manage");
    expect(json).not.toContain("realized");
  });

  it("internas, archivadas, fuera de rango y con fechas rotas quedan fuera", () => {
    const titles = new Set(cal.events.map((e) => e.title));
    expect(titles.has("Fuera de rango")).toBe(false);
    expect(titles.has("Muy antiguo")).toBe(false);
    expect(titles.has("Fecha rota")).toBe(false);
    expect(cal.areas.map((a) => a.slug)).not.toContain("matrimonios");
  });

  it("cancelada: solo el estado, sin motivo; excepción y serie cancelada igual", () => {
    const evang = cal.events.find((e) => e.title === "Evangelismo en la plaza")!;
    expect(evang.status).toBe("cancelled");
    expect(cal.events.find((e) => e.title === "Culto dominical" && e.startDate === "2026-10-18")?.status).toBe("cancelled");
    expect(cal.events.find((e) => e.title === "Culto dominical" && e.startDate === "2026-10-25")?.status).toBe("scheduled");
    const oracion = cal.events.filter((e) => e.title === "Oración de los martes");
    expect(oracion.filter((e) => e.startDate >= "2026-10-13").every((e) => e.status === "cancelled")).toBe(true);
    expect(oracion.filter((e) => e.startDate < "2026-10-13").every((e) => e.status === "scheduled")).toBe(true);
    // pasada (realizada internamente) sale "scheduled": "Realizada" no se publica
    expect(cal.events.find((e) => e.title === "Culto dominical" && e.startDate === "2026-09-06")?.status).toBe("scheduled");
  });

  it("vacíos → null; áreas participantes inexistentes se omiten; todo el día sin horas", () => {
    const escuela = cal.events.find((e) => e.title === "Escuela dominical")!;
    expect(escuela.location).toBeNull();
    expect(escuela.publicDescription).toBeNull();
    const culto = cal.events.find((e) => e.title === "Culto dominical")!;
    expect(culto.responsibleArea).toEqual({ slug: "alabanza", name: "Alabanza", color: "verde" });
    expect(culto.participantAreas.map((a) => a.slug)).toEqual(["jovenes", "antigua"]);
    const vigilia = cal.events.find((e) => e.title === "Vigilia")!;
    expect(vigilia).toMatchObject({ startDate: "2026-10-30", endDate: "2026-10-31", startTime: "22:00", endTime: "02:00" });
  });

  it("encabezado: solo áreas activas usadas por actividades publicadas, por nombre", () => {
    expect(cal.areas).toEqual([
      { slug: "alabanza", name: "Alabanza", color: "verde" },
      { slug: "intercesion", name: "Intercesión", color: "indigo" },
      { slug: "jovenes", name: "Jóvenes", color: "azul" },
    ]);
  });

  it("toPublicEvent nunca copia campos que no están en la lista (aunque vengan con tipos raros)", () => {
    const weird = event({
      id: "ev-raro",
      location: { toString: () => CANARIES.extra } as unknown as string,
      publicDescription: 42 as unknown as string,
      responsibleAreaId: "sin-area",
    });
    const [o] = expandRecurrence(weird, "2026-10-01", "2026-10-31", NOW);
    const pub = toPublicEvent(o, weird, new Map());
    expect(pub.location).toBeNull();
    expect(pub.publicDescription).toBeNull();
    expect(pub.responsibleArea).toEqual({ slug: "sin-area", name: "sin-area", color: "pizarra" });
    expect(JSON.stringify(pub)).not.toContain(CANARIES.extra);
  });
});

describe("rango y orden", () => {
  it("publicRange: primer día del mes anterior → último día de hoy + 6 meses", () => {
    expect(publicRange("2026-10-04")).toEqual({ from: "2026-09-01", to: "2027-04-30" });
    expect(publicRange("2027-01-31")).toEqual({ from: "2026-12-01", to: "2027-07-31" });
    expect(publicRange("2026-08-31")).toEqual({ from: "2026-07-01", to: "2027-02-28" });
    const cal = build();
    expect(cal.range).toEqual({ from: "2026-09-01", to: "2027-04-30" });
    expect(cal.events.every((e) => e.endDate >= "2026-09-01" && e.startDate <= "2027-04-30")).toBe(true);
  });

  it("orden: mismo comparador que el resto (todo el día, hora, área, título) y estable", () => {
    const cal = build();
    const sunday = cal.events.filter((e) => e.startDate === "2026-10-04").map((e) => e.title);
    expect(sunday).toEqual(["Escuela dominical", "Culto dominical"]);
    expect(sortPublicEvents([...cal.events].reverse()).map((e) => e.id)).toEqual(cal.events.map((e) => e.id));
    for (let i = 1; i < cal.events.length; i++) expect(cal.events[i - 1].startDate <= cal.events[i].startDate).toBe(true);
  });

  it("es determinista (mismo input → mismo JSON)", () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build([...EVENTS].reverse(), [...AREAS].reverse())));
  });
});

describe("recurrenceLabel público", () => {
  const culto = EVENTS[0];
  const cancelFrom = (from: string) => ({ ...culto, seriesCancellation: { from, reason: "Motivo interno", by: "u-admin", at: null } });

  it("solo día, frecuencia y fecha final", () => {
    const cal = build();
    expect(cal.events.find((e) => e.title === "Culto dominical")!.recurrenceLabel).toBe("Se repite cada domingo hasta el 28 feb 2027");
    expect(cal.events.find((e) => e.title === "Evangelismo en la plaza")!.recurrenceLabel).toBeNull();
    expect(cal.events.find((e) => e.title === "Vigilia")!.recurrenceLabel).toBe("El último viernes de cada mes hasta el 26 feb 2027");
  });

  it("con la serie cancelada se repite hasta el día anterior a `from`", () => {
    expect(publicRecurrenceLabel(cancelFrom("2026-10-11"))).toBe("Se repite cada domingo hasta el 10 oct 2026");
    expect(publicRecurrenceLabel({ ...cancelFrom("2026-12-31"), recurrence: { freq: "weekly", until: "2026-11-29" } })).toBe(
      "Se repite cada domingo hasta el 29 nov 2026",
    );
    expect(publicRecurrenceLabel(cancelFrom(culto.startDate))).toBeNull();
    expect(publicRecurrenceLabel(culto)).toBe("Se repite cada domingo hasta el 28 feb 2027");
    const cal = build(EVENTS.map((e) => (e.id === "ev-culto" ? cancelFrom("2026-10-11") : e)));
    const cultos = cal.events.filter((e) => e.title === "Culto dominical");
    expect(new Set(cultos.map((e) => e.recurrenceLabel))).toEqual(new Set(["Se repite cada domingo hasta el 10 oct 2026"]));
    expect(JSON.stringify(cal)).not.toContain("Motivo interno");
  });
});

describe("fnv1a64", () => {
  it("vectores conocidos de FNV-1a 64", () => {
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64("abc")).toBe("e71fa2190541574b");
  });
});

describe("serie cancelada desde una fecha: el feed público no muestra lo que queda después del corte", () => {
  const oracion = EVENTS.find((e) => e.id === "ev-oracion")!;
  const withOracion = (over: Record<string, unknown>) =>
    build(EVENTS.map((e) => (e.id === "ev-oracion" ? ({ ...e, ...over } as typeof e) : e)));
  const titled = (cal: PublicCalendar, title: string) => cal.events.filter((e) => e.title === title);

  it("las ocurrencias desde `from` desaparecen; las anteriores siguen programadas; el área sigue en el encabezado", () => {
    const list = titled(build(), "Oración de los martes");
    expect(list.map((e) => e.startDate)).toEqual(["2026-09-29", "2026-10-06"]);
    expect(list.every((e) => e.status === "scheduled")).toBe(true);
    expect(build().areas.map((a) => a.slug)).toContain("intercesion");
  });

  it("una fecha cancelada sola (excepción) sí se publica como Cancelada, antes o después del corte", () => {
    const x = (date: string) => ({ date, type: "cancelled", reason: CANARIES.exceptionReason, by: CANARIES.uid });
    const cal = withOracion({ exceptions: [x("2026-10-06"), x("2026-10-20")] });
    const list = titled(cal, "Oración de los martes");
    expect(list.map((e) => [e.startDate, e.status])).toEqual([
      ["2026-09-29", "scheduled"],
      ["2026-10-06", "cancelled"],
      ["2026-10-20", "cancelled"],
    ]);
    expect(JSON.stringify(cal)).not.toContain(CANARIES.exceptionReason);
  });

  it("serie cortada desde su inicio → no aparece, y su área sale del encabezado si nadie más la usa", () => {
    const cal = build([
      { ...oracion, seriesCancellation: { from: oracion.startDate, reason: "x", by: "u", at: null } },
    ] as typeof EVENTS);
    expect(cal.events).toEqual([]);
    expect(cal.areas).toEqual([]);
  });

  it("actividades simples canceladas siguen saliendo como Cancelada (no les aplica el corte)", () => {
    expect(build().events.find((e) => e.title === "Evangelismo en la plaza")?.status).toBe("cancelled");
  });

  it("la vista interna no cambia: expandRecurrence sigue entregando las canceladas por la serie", () => {
    const occ = expandRecurrence(oracion, "2026-09-01", "2026-12-31", NOW);
    const cut = occ.filter((o) => o.date >= "2026-10-13");
    expect(cut.length).toBe(12);
    expect(cut.every((o) => o.status === "cancelled")).toBe(true);
    expect(cut.every((o) => isSeriesCutOccurrence(o))).toBe(true);
    expect(occ.filter((o) => o.date < "2026-10-13").some((o) => isSeriesCutOccurrence(o))).toBe(false);
  });
});
