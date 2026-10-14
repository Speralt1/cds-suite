// @vitest-environment node
// lib/shared/names (doc 27): normalización, clave de identidad, similitud y grupos.
// Paridad con el CommonJS generado en functions/shared/names.js. Nombres ficticios.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as namesTs from "@/lib/shared/names";
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  duplicateGroups,
  editDistance,
  identityKey,
  IDENTITY_KEY_RE,
  nameSimilarity,
  normalizeName,
  similarProfiles,
} from "@/lib/shared/names";

const require = createRequire(import.meta.url);
const namesJs = require("../../functions/shared/names.js") as typeof namesTs;

const SAME = [
  "Juan Pérez",
  "juan perez",
  "JUAN PÉREZ",
  "Juan  Pérez",
  " Juan Pérez ",
  "Juán Pérez",
  "Juan Pérez.",
  "Juan\tPérez",
  "Juan-Pérez",
  "Juan, Pérez",
  "Juan´ Pérez",
  "Ｊｕａｎ Pérez", // ancho completo (NFKD)
  "Juan Pérez", // tilde combinada
];

describe("normalizeName / identityKey", () => {
  it.each(SAME)("«%s» → juan_perez", (raw) => {
    expect(normalizeName(raw)).toBe("juan perez");
    expect(identityKey(raw)).toBe("juan_perez");
  });

  it("ñ y letras especiales se pliegan a [a-z]", () => {
    expect(identityKey("Familia Muñoz Ñúñez")).toBe("familia_munoz_nunez");
    expect(identityKey("Ølsen Straße Æsir")).toBe("olsen_strasse_aesir");
  });

  it("puntuación como espacio", () => {
    expect(normalizeName("Pérez/Soto (hijos); Rojas:López_\"Ana\" 'Bea'")).toBe(
      "perez soto hijos rojas lopez ana bea",
    );
  });

  it.each([
    ["", ""],
    ["   ", ""],
    ["😀😀", ""],
    ["مرحبا", ""],
    ["שלום", ""],
    ["...", ""],
    ["__", ""],
    ["Juan 😀 Pérez", "juan_perez"],
    ["Ana ‏ Soto", "ana_soto"],
  ])("entrada difícil «%s» → «%s»", (raw, key) => {
    expect(identityKey(raw)).toBe(key);
  });

  it("no-string seguro", () => {
    expect(normalizeName(undefined)).toBe("");
    expect(identityKey(null)).toBe("");
    expect(identityKey(42)).toBe("");
  });

  it("siempre es un id de documento válido: [a-z0-9_], ≤ 120, sin '.', sin __x__", () => {
    const samples = [
      "a".repeat(300),
      `${"Juan ".repeat(40)}Pérez`,
      "x _ y",
      "__reservado__",
      "Familia 2 de Juan Pérez",
      ".",
      "..",
    ];
    for (const raw of samples) {
      const key = identityKey(raw);
      if (!key) continue;
      expect(key).toMatch(IDENTITY_KEY_RE);
      expect(key.length).toBeLessThanOrEqual(120);
      expect(key).not.toMatch(/^_|_$|__/);
      expect([".", ".."]).not.toContain(key);
    }
    expect(identityKey(`${"ab ".repeat(60)}`).endsWith("_")).toBe(false);
  });
});

describe("nameSimilarity / similarProfiles", () => {
  it("Damerau: transposición cuesta 1", () => {
    expect(editDistance("perez", "peerz")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "abc")).toBe(0);
  });

  it("Juan Pérez vs Juana Pérez: similar pero no exacto", () => {
    const s = nameSimilarity("Juan Pérez", "Juana Pérez");
    expect(s).toBeGreaterThanOrEqual(DEFAULT_SIMILARITY_THRESHOLD);
    expect(s).toBeLessThan(1);
    const [m] = similarProfiles("Juan Pérez", [{ id: "a", displayName: "Juana Pérez" }]);
    expect(m.reason).toBe("similar");
  });

  it("Ana Soto vs Pedro Rojas: no similar", () => {
    expect(nameSimilarity("Ana Soto", "Pedro Rojas")).toBeLessThan(0.5);
    expect(similarProfiles("Ana Soto", [{ id: "b", displayName: "Pedro Rojas" }])).toEqual([]);
  });

  it("mismo nombre normalizado = 1 y razón exact; orden invertido es similar", () => {
    expect(nameSimilarity("JUAN PÉREZ", "juan perez")).toBe(1);
    expect(nameSimilarity("Pérez Juan", "Juan Pérez")).toBeGreaterThanOrEqual(0.9);
    expect(nameSimilarity("Pérez Juan", "Juan Pérez")).toBeLessThan(1);
    expect(nameSimilarity("Juan Pérez", "Juan Pérez Soto")).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity("", "Juan")).toBe(0);
    expect(nameSimilarity("😀", "😀")).toBe(0);
  });

  it("homónimo distinguido (segundo apellido) cambia la clave: no es exacto", () => {
    expect(identityKey("Juan Pérez Soto")).not.toBe(identityKey("Juan Pérez"));
  });

  it("ranking: exactas primero, luego por similitud; excluye la ficha editada", () => {
    const profiles = [
      { id: "1", displayName: "Juana Pérez" },
      { id: "2", displayName: "juan perez" },
      { id: "3", displayName: "Pedro Rojas" },
      { id: "4", displayName: "Juan Pérez" },
    ];
    const r = similarProfiles("Juan Pérez", profiles, undefined, "4");
    expect(r.map((m) => [m.profile.id, m.reason])).toEqual([
      ["2", "exact"],
      ["1", "similar"],
    ]);
    expect(similarProfiles("😀", profiles)).toEqual([]);
  });

  it("duplicateGroups agrupa exactos y similares, sin falsos positivos", () => {
    const groups = duplicateGroups([
      { id: "1", displayName: "Juan Pérez" },
      { id: "2", displayName: "JUAN PÉREZ." },
      { id: "3", displayName: "Ana Soto" },
      { id: "4", displayName: "Ana Sotto" },
      { id: "5", displayName: "Pedro Rojas" },
      { id: "6", displayName: "😀" },
    ]);
    expect(groups.map((g) => [g.reason, g.profiles.map((p) => p.id).sort()])).toEqual([
      ["exact", ["1", "2"]],
      ["similar", ["3", "4"]],
    ]);
  });

  it("duplicateGroups con 500 fichas termina rápido (prefiltro por largo)", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: String(i), displayName: `Persona ${i} Apellido${i % 7}` }));
    const t = performance.now();
    duplicateGroups(many);
    expect(performance.now() - t).toBeLessThan(5000);
  });
});

describe("paridad TS ↔ functions/shared/names.js", () => {
  it("mismos resultados", () => {
    const inputs = [...SAME, "Juana Pérez", "Ana Soto", "😀", "", "Ølsen", "a".repeat(200)];
    for (const a of inputs) {
      expect(namesJs.normalizeName(a)).toBe(namesTs.normalizeName(a));
      expect(namesJs.identityKey(a)).toBe(namesTs.identityKey(a));
      for (const b of inputs.slice(0, 4)) expect(namesJs.nameSimilarity(a, b)).toBe(namesTs.nameSimilarity(a, b));
    }
  });
});
