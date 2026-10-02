import { describe, expect, it } from "vitest";
import { AREA_PALETTE, eventColor, freeColors, selectableAreas, validateArea } from "@/lib/suite-preview/areas";
import { creatableAreas } from "@/lib/suite-preview/calendar";
import { AREAS, EVENTS, USERS } from "@/lib/suite-preview/fixtures";
import { AREA_COLORS } from "@/lib/suite-preview/types";

const user = (uid: string) => USERS.find((u) => u.uid === uid)!;

describe("colores por área", () => {
  it("la paleta tiene 10 colores con swatch, ink y soft", () => {
    expect(Object.keys(AREA_PALETTE)).toEqual([...AREA_COLORS]);
    for (const c of AREA_COLORS) expect(AREA_PALETTE[c]).toMatchObject({ swatch: expect.stringMatching(/^#/), ink: expect.any(String), soft: expect.any(String) });
  });

  it("el color de una actividad es siempre el de su área responsable", () => {
    for (const e of EVENTS) {
      const area = AREAS.find((a) => a.id === e.responsibleAreaId)!;
      expect(eventColor(e, AREAS).color).toBe(area.color);
      // los participantes nunca lo cambian
      expect(eventColor({ ...e, participantAreaIds: ["matrimonios", "damas"] } as typeof e, AREAS).color).toBe(area.color);
    }
  });

  it("un área inactiva no se ofrece al crear, pero sus actividades conservan nombre y color", () => {
    expect(selectableAreas(user("admin"), AREAS).map((a) => a.id)).not.toContain("matrimonios");
    const ev = { ...EVENTS[0], responsibleAreaId: "matrimonios" };
    expect(eventColor(ev, AREAS)).toMatchObject({ color: "carmin", swatch: AREA_PALETTE.carmin.swatch });
  });

  it("el Líder solo puede elegir sus áreas activas como responsable", () => {
    expect(creatableAreas(user("lider"), AREAS).map((a) => a.id)).toEqual(["jovenes"]);
    expect(creatableAreas(user("diacono"), AREAS).map((a) => a.id)).toEqual(["varones", "multimedia"]);
    expect(creatableAreas(user("finanzas"), AREAS)).toEqual([]);
  });

  it("color único entre las activas y nombre único sin distinguir mayúsculas", () => {
    expect(freeColors(AREAS)).toEqual(["carmin"]);
    expect(validateArea({ name: "Nueva", color: "azul" }, AREAS).color).toMatch(/otra área activa/);
    expect(validateArea({ name: "jóvenes", color: "carmin" }, AREAS).name).toMatch(/Ya existe/);
    expect(validateArea({ name: "Matrimonios jóvenes", color: "carmin" }, AREAS)).toEqual({});
    expect(validateArea({ id: "pastoral", name: "Pastoral", color: "azul" }, AREAS)).toEqual({});
  });
});
