import { describe, expect, it } from "vitest";
import { AREAS, DEMO_NOW, DEMO_TODAY, EVENTS, LEAK_CANARIES, LEAK_STRINGS, SHARE_LINK, USERS } from "@/lib/suite-preview/fixtures";
import { PUBLIC_AREA_KEYS, PUBLIC_CALENDAR_KEYS, PUBLIC_EVENT_KEYS, previewShareHref, productionShareUrl, resolvePublicCalendar, sortPublicEvents } from "@/lib/suite-preview/share";
import { applyAction, initialSuiteState } from "@/lib/suite-preview/store";
import type { PublicArea } from "@/lib/suite-preview/types";

const resolve = (presentedToken: string | null, link = SHARE_LINK, events = EVENTS) =>
  resolvePublicCalendar({ link, events, areas: AREAS, presentedToken, today: DEMO_TODAY, now: DEMO_NOW });

describe("calendario compartido sanitizado", () => {
  const cal = resolve("demo")!;

  it("claves exactas en profundidad (lista blanca)", () => {
    expect(Object.keys(cal).sort()).toEqual([...PUBLIC_CALENDAR_KEYS].sort());
    const checkArea = (a: PublicArea) => expect(Object.keys(a).sort()).toEqual([...PUBLIC_AREA_KEYS].sort());
    cal.areas.forEach(checkArea);
    expect(cal.events.length).toBeGreaterThan(50);
    for (const e of cal.events) {
      expect(Object.keys(e).sort()).toEqual([...PUBLIC_EVENT_KEYS].sort());
      checkArea(e.responsibleArea);
      e.participantAreas.forEach(checkArea);
      expect(e.id).toMatch(/^pe_[0-9a-f]{8}$/);
      expect(["programada", "cancelada"]).toContain(e.status);
    }
  });

  it("no contiene canarios, correos, uids, teléfonos ni nombres", () => {
    const json = JSON.stringify(cal);
    for (const s of LEAK_STRINGS) expect(json, s).not.toContain(s);
    for (const c of Object.values(LEAK_CANARIES)) expect(json).not.toContain(c);
    expect(json).not.toContain("@");
    expect(json).not.toMatch(/"ev-[a-z]/);
    // uids de usuarios (salvo "consolidacion", que coincide con el slug público del área)
    const slugs = new Set(AREAS.map((a) => a.id));
    for (const u of USERS.filter((x) => !slugs.has(x.uid))) expect(json).not.toContain(`"${u.uid}"`);
  });

  it("sin actividades de equipo ni archivadas; la cancelada va sin motivo", () => {
    const titles = new Set(cal.events.map((e) => e.title));
    expect(titles.has("Ensayo de alabanza")).toBe(false);
    expect(titles.has("Reunión de líderes")).toBe(false);
    const evang = cal.events.find((e) => e.title === "Evangelismo en la plaza")!;
    expect(evang.status).toBe("cancelada");
    expect(cal.events.find((e) => e.title === "Reunión de jóvenes" && e.startDate === "2026-10-16")?.status).toBe("cancelada");
  });

  it("rango: mes anterior a hoy + 6 meses; áreas del encabezado con actividades públicas", () => {
    expect(cal.range).toEqual({ from: "2026-09-01", to: "2027-04-30" });
    expect(cal.events.every((e) => e.startDate >= "2026-08-31" && e.startDate <= "2027-04-30")).toBe(true);
    expect(cal.areas.map((a) => a.slug)).not.toContain("matrimonios");
  });

  it("token inválido, regenerado o desactivado → null; el nuevo resuelve", () => {
    expect(resolve("otro")).toBeNull();
    expect(resolve(null)).toBeNull();
    const admin = "admin";
    const s1 = applyAction(initialSuiteState(), { type: "share/regenerate", by: admin });
    expect(s1.ok).toBe(true);
    const link = s1.state.shareLink;
    expect(link.token).not.toBe("demo");
    expect(resolve("demo", link)).toBeNull();
    expect(resolve(link.token, link)).not.toBeNull();
    const off = applyAction(s1.state, { type: "share/deactivate", by: admin }).state.shareLink;
    expect(resolve(link.token, off)).toBeNull();
    const on = applyAction({ ...s1.state, shareLink: off }, { type: "share/activate", by: admin }).state.shareLink;
    expect(on.token).not.toBe(link.token);
    expect(resolve(link.token, on)).toBeNull();
    expect(resolve(on.token, on)).not.toBeNull();
    expect(previewShareHref(on.token)).toBe(`/preview/calendario/compartir/demo?t=${on.token}`);
    expect(previewShareHref("demo")).toBe("/preview/calendario/compartir/demo");
  });

  it("solo manage_all administra el enlace", () => {
    expect(applyAction(initialSuiteState(), { type: "share/regenerate", by: "lider" }).ok).toBe(false);
  });
});

describe("proyección pública · correcciones ciclo 1", () => {
  const cal = resolve("demo")!;

  it("C6: recurrenceLabel público solo con día, frecuencia y fecha final", () => {
    const culto = cal.events.find((e) => e.title === "Culto dominical")!;
    expect(culto.recurrenceLabel).toBe("Se repite cada domingo hasta el 28 feb 2027");
    const single = cal.events.find((e) => e.title === "Evangelismo en la plaza")!;
    expect(single.recurrenceLabel).toBeNull();
    for (const e of cal.events) {
      if (e.recurrenceLabel !== null) expect(e.recurrenceLabel).toMatch(/^(Se repite cada|Cada 2 semanas|El (primer|segundo|tercer|cuarto|último)|Cada mes)/);
    }
  });

  it("C5: dentro del día, mismo orden que el resto (hora, luego nombre del área)", () => {
    const sunday = cal.events.filter((e) => e.startDate === "2026-10-04").map((e) => e.title);
    expect(sunday.indexOf("Escuela dominical")).toBeLessThan(sunday.indexOf("Culto dominical"));
    const sorted = sortPublicEvents([...cal.events].reverse());
    expect(sorted.map((e) => e.id)).toEqual(cal.events.map((e) => e.id));
  });

  it("C9: la URL con formato de producción usa un dominio neutro reservado", () => {
    expect(productionShareUrl("demo")).toBe("https://suite.casadesalvacion.example/calendario/compartir/demo");
    expect(productionShareUrl("demo")).not.toMatch(/web\.app|firebaseapp|cds-administracion/);
  });
});
