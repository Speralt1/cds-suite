import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AREA_COLOR_DISPLAY_ORDER,
  AREA_COLORS,
  AREA_ERRORS,
  AREA_PALETTE,
  AREA_SLUG_PATTERN,
  areaUsage,
  areaVar,
  eventColor,
  freeColors,
  selectableAreas,
  slugify,
  sortAreas,
  uniqueAreaSlug,
  validateArea,
  type Area,
} from "@/lib/calendar/areas";

const fs = vi.hoisted(() => ({
  existing: new Set<string>(),
  sets: [] as { path: string; data: Record<string, unknown> }[],
  updates: [] as { path: string; data: Record<string, unknown> }[],
}));

vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: {} }) }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: () => "SERVER_TS",
  doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}`, id }),
  updateDoc: vi.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
    fs.updates.push({ path: ref.path, data });
  }),
  runTransaction: vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      get: async (ref: { id: string }) => ({ exists: () => fs.existing.has(ref.id) }),
      set: (ref: { path: string }, data: Record<string, unknown>) => fs.sets.push({ path: ref.path, data }),
    }),
  ),
}));

const area = (id: string, name: string, color: Area["color"], active = true): Area => ({
  id,
  name,
  color,
  active,
  slug: id,
  description: "",
});

const AREAS: Area[] = [
  area("jovenes", "Jóvenes", "azul"),
  area("alabanza", "Alabanza", "verde"),
  area("matrimonios", "Matrimonios", "carmin", false),
];

describe("paleta de áreas", () => {
  it("tiene exactamente los 24 colores cerrados con nombre en español y tonos hex", () => {
    expect(Object.keys(AREA_PALETTE).sort()).toEqual([...AREA_COLORS].sort());
    expect(AREA_COLORS).toHaveLength(24);
    const labels = new Set<string>();
    for (const color of AREA_COLORS) {
      expect(color).toMatch(/^[a-z]+$/);
      const tone = AREA_PALETTE[color];
      expect(tone.label).toMatch(/^[A-ZÁÉÍÓÚÑ]/);
      labels.add(tone.label);
      for (const part of [tone.swatch, tone.ink, tone.soft]) expect(part).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(labels.size).toBe(24);
    expect(AREA_PALETTE.teal.label).toBe("Verde azulado");
    expect(AREA_PALETTE.carmin.label).toBe("Carmín");
    expect(AREA_PALETTE.petroleo.label).toBe("Petróleo");
  });

  it("conserva los 10 colores originales: mismas claves, orden y tonos (datos guardados)", () => {
    expect(AREA_COLORS.slice(0, 10)).toEqual(["azul", "indigo", "naranjo", "ambar", "frambuesa", "cafe", "teal", "pizarra", "verde", "carmin"]);
    expect(AREA_PALETTE.azul).toEqual({ label: "Azul", swatch: "#2f6fb0", ink: "#245a8f", soft: "#e6eef7" });
    expect(AREA_PALETTE.indigo).toEqual({ label: "Índigo", swatch: "#5b5fc7", ink: "#464aa6", soft: "#ebebf8" });
    expect(AREA_PALETTE.naranjo).toEqual({ label: "Naranjo", swatch: "#c4561d", ink: "#a3461a", soft: "#f8ebe3" });
    expect(AREA_PALETTE.ambar).toEqual({ label: "Ámbar", swatch: "#a06a00", ink: "#7d5300", soft: "#f5eedf" });
    expect(AREA_PALETTE.frambuesa).toEqual({ label: "Frambuesa", swatch: "#b03a8a", ink: "#8f2e70", soft: "#f5e7f1" });
    expect(AREA_PALETTE.cafe).toEqual({ label: "Café", swatch: "#8a5a3c", ink: "#6e4529", soft: "#f1ebe7" });
    expect(AREA_PALETTE.teal).toEqual({ label: "Verde azulado", swatch: "#1f7f86", ink: "#17646a", soft: "#e3f0f1" });
    expect(AREA_PALETTE.pizarra).toEqual({ label: "Pizarra", swatch: "#5e6b78", ink: "#4a5560", soft: "#edeff1" });
    expect(AREA_PALETTE.verde).toEqual({ label: "Verde", swatch: "#3d8a3f", ink: "#2e6e30", soft: "#e7f1e7" });
    expect(AREA_PALETTE.carmin).toEqual({ label: "Carmín", swatch: "#b83a4b", ink: "#962d3c", soft: "#f6e7e9" });
  });

  it("cumple contraste WCAG: swatch ≥3:1 sobre blanco; tinta ≥4,5:1 sobre blanco y sobre su fondo suave", () => {
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const color of AREA_COLORS) {
      const { swatch, ink, soft } = AREA_PALETTE[color];
      expect(ratio(swatch, "#ffffff"), `${color} swatch`).toBeGreaterThanOrEqual(3);
      expect(ratio(ink, "#ffffff"), `${color} ink`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(ink, soft), `${color} ink/soft`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("orden de presentación: los 24 colores por tono, sin repetir, con Pizarra al final", () => {
    expect([...AREA_COLOR_DISPLAY_ORDER].sort()).toEqual([...AREA_COLORS].sort());
    expect(new Set(AREA_COLOR_DISPLAY_ORDER).size).toBe(24);
    expect(AREA_COLOR_DISPLAY_ORDER[0]).toBe("carmin");
    expect(AREA_COLOR_DISPLAY_ORDER.at(-1)).toBe("pizarra");
  });

  it("expone tokens CSS con respaldo hex", () => {
    expect(areaVar("azul", "ink")).toBe("var(--area-azul-ink, #245a8f)");
  });
});

describe("slug", () => {
  it("normaliza tildes, símbolos y espacios", () => {
    expect(slugify("  Jóvenes Adultos!! ")).toBe("jovenes-adultos");
    expect(slugify("Niños & Pre-adolescentes")).toBe("ninos-pre-adolescentes");
    expect(slugify("¡¡!!")).toBe("");
  });

  it("agrega sufijo -2, -3… cuando el slug ya existe", () => {
    expect(uniqueAreaSlug("Jóvenes", [])).toBe("jovenes");
    expect(uniqueAreaSlug("Jóvenes", ["jovenes"])).toBe("jovenes-2");
    expect(uniqueAreaSlug("JOVENES", ["jovenes", "jovenes-2"])).toBe("jovenes-3");
    expect(uniqueAreaSlug("¡!", [])).toBe("area");
  });

  it("siempre cumple el patrón de las reglas y ≤40, incluso con sufijo", () => {
    const long = "Ministerio de alabanza y adoración congregacional de los domingos";
    const base = uniqueAreaSlug(long, []);
    const next = uniqueAreaSlug(long, [base]);
    for (const slug of [base, next]) {
      expect(slug.length).toBeLessThanOrEqual(40);
      expect(slug).toMatch(AREA_SLUG_PATTERN);
    }
    expect(next.endsWith("-2")).toBe(true);
  });
});

describe("validateArea", () => {
  it("exige nombre de 1 a 40", () => {
    expect(validateArea({ name: "  ", color: "ambar" }, AREAS).name).toBe(AREA_ERRORS.nameRequired);
    expect(validateArea({ name: "x".repeat(41), color: "ambar" }, AREAS).name).toBe(AREA_ERRORS.nameTooLong);
    expect(validateArea({ name: "Niños", color: "ambar" }, AREAS)).toEqual({});
  });

  it("nombre único entre activas, sin distinguir mayúsculas ni tildes", () => {
    expect(validateArea({ name: "jovenes", color: "ambar" }, AREAS).name).toBe(AREA_ERRORS.nameTaken);
    expect(validateArea({ name: " ALABANZA ", color: "ambar" }, AREAS).name).toBe(AREA_ERRORS.nameTaken);
    // Matrimonios está inactiva: su nombre no bloquea.
    expect(validateArea({ name: "Matrimonios", color: "ambar" }, AREAS).name).toBeUndefined();
    // Editarse a sí misma no choca.
    expect(validateArea({ id: "jovenes", name: "Jóvenes", color: "azul" }, AREAS)).toEqual({});
  });

  it("color único entre activas; una inactiva puede conservar el suyo", () => {
    expect(validateArea({ name: "Niños", color: "azul" }, AREAS).color).toBe(AREA_ERRORS.colorTaken);
    expect(validateArea({ name: "Niños", color: "carmin" }, AREAS).color).toBeUndefined();
    expect(validateArea({ name: "Niños", color: "" }, AREAS).color).toBe(AREA_ERRORS.colorRequired);
    const conflict = [...AREAS, area("ninos", "Niños", "carmin")];
    // Matrimonios (inactiva) edita su descripción sin cambiar color: válido.
    expect(validateArea({ id: "matrimonios", name: "Matrimonios", color: "carmin" }, conflict)).toEqual({});
    // Pero reactivarla con ese color no.
    expect(validateArea({ id: "matrimonios", name: "Matrimonios", color: "carmin", active: true }, conflict).color).toBe(
      AREA_ERRORS.colorTaken,
    );
  });

  it("descripción ≤200", () => {
    expect(validateArea({ name: "Niños", color: "ambar", description: "x".repeat(201) }, AREAS).description).toBe(
      AREA_ERRORS.descriptionTooLong,
    );
  });
});

describe("freeColors / selectableAreas / orden", () => {
  it("excluye los colores de las áreas activas (salvo la que se edita)", () => {
    const free = freeColors(AREAS);
    expect(free).not.toContain("azul");
    expect(free).not.toContain("verde");
    expect(free).toContain("carmin");
    expect(free).toHaveLength(22);
    // En el orden de presentación (por tono), no en el de almacenamiento.
    expect(free).toEqual(AREA_COLOR_DISPLAY_ORDER.filter((c) => c !== "azul" && c !== "verde"));
    expect(freeColors(AREAS, "jovenes")).toContain("azul");
  });

  it("ordena por nombre y conserva inactivas ya elegidas", () => {
    expect(sortAreas(AREAS).map((a) => a.id)).toEqual(["alabanza", "jovenes", "matrimonios"]);
    expect(selectableAreas(AREAS).map((a) => a.id)).toEqual(["alabanza", "jovenes"]);
    expect(selectableAreas(AREAS, ["matrimonios"]).map((a) => a.id)).toEqual(["alabanza", "jovenes", "matrimonios"]);
  });
});

describe("eventColor", () => {
  it("es siempre el del área responsable (los participantes no influyen)", () => {
    const c = eventColor({ responsibleAreaId: "alabanza" }, AREAS);
    expect(c.color).toBe("verde");
    expect(c.swatch).toBe(AREA_PALETTE.verde.swatch);
    const withParticipants = { responsibleAreaId: "jovenes", participantAreaIds: ["alabanza"] };
    expect(eventColor(withParticipants, AREAS).color).toBe("azul");
  });

  it("usa pizarra si el área no existe", () => {
    expect(eventColor({ responsibleAreaId: "borrada" }, AREAS).color).toBe("pizarra");
  });
});

describe("areaUsage", () => {
  it("cuenta responsable y participante, sin archivadas", () => {
    const events = [
      { responsibleAreaId: "jovenes", participantAreaIds: [], status: "scheduled" as const },
      { responsibleAreaId: "jovenes", participantAreaIds: [], status: "archived" as const },
      { responsibleAreaId: "alabanza", participantAreaIds: ["jovenes"], status: "cancelled" as const },
    ];
    expect(areaUsage("jovenes", events)).toEqual({ responsible: 1, participant: 1 });
  });
});

describe("areas-client (escrituras con auditoría)", () => {
  beforeEach(() => {
    fs.existing.clear();
    fs.sets.length = 0;
    fs.updates.length = 0;
  });

  it("crea con slug = id, campos exactos y auditoría", async () => {
    const { createArea } = await import("@/lib/calendar/areas-client");
    const id = await createArea({} as never, "admin-1", { name: "  Niños  ", description: " Escuela ", color: "ambar" }, AREAS);
    expect(id).toBe("ninos");
    expect(fs.sets).toEqual([
      {
        path: "areas/ninos",
        data: {
          name: "Niños",
          slug: "ninos",
          color: "ambar",
          description: "Escuela",
          active: true,
          createdAt: "SERVER_TS",
          createdBy: "admin-1",
          updatedAt: "SERVER_TS",
          updatedBy: "admin-1",
        },
      },
    ]);
  });

  it("si el slug ya existe en el servidor prueba el siguiente sufijo", async () => {
    const { createArea } = await import("@/lib/calendar/areas-client");
    fs.existing.add("ninos");
    const id = await createArea({} as never, "admin-1", { name: "Niños", description: "", color: "ambar" }, AREAS);
    expect(id).toBe("ninos-2");
    expect(fs.sets[0].data.slug).toBe("ninos-2");
  });

  it("rechaza color o nombre en uso sin escribir", async () => {
    const { createArea, AreaValidationError } = await import("@/lib/calendar/areas-client");
    await expect(
      createArea({} as never, "admin-1", { name: "Otra", description: "", color: "azul" }, AREAS),
    ).rejects.toBeInstanceOf(AreaValidationError);
    expect(fs.sets).toHaveLength(0);
  });

  it("editar no cambia el slug y desactivar solo toca estado y auditoría", async () => {
    const { updateArea, setAreaActive } = await import("@/lib/calendar/areas-client");
    await updateArea({} as never, "admin-1", "jovenes", { name: "Jóvenes CDS", description: "", color: "indigo" }, AREAS);
    expect(fs.updates[0]).toEqual({
      path: "areas/jovenes",
      data: {
        name: "Jóvenes CDS",
        description: "",
        color: "indigo",
        active: true,
        updatedAt: "SERVER_TS",
        updatedBy: "admin-1",
      },
    });
    await setAreaActive({} as never, "admin-1", AREAS[0], false, AREAS);
    expect(fs.updates[1]).toEqual({
      path: "areas/jovenes",
      data: { active: false, updatedAt: "SERVER_TS", updatedBy: "admin-1" },
    });
  });
});
