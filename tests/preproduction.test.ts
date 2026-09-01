import { describe, expect, it } from "vitest";
import { isValidProfileId, profileHref } from "@/lib/finance/profile-route";
import { MAX_PERIOD_RECORDS } from "@/lib/finance/constants";
import { capQueryLimit } from "@/lib/finance/query-limit";

describe("ruta estática de fichas", () => {
  it("conserva y codifica el ID como query param", () => {
    expect(profileHref("perfil con + símbolos")).toBe(
      "/finanzas/diezmos/perfil?id=perfil%20con%20%2B%20s%C3%ADmbolos",
    );
    expect(isValidProfileId("perfil con + símbolos")).toBe(true);
  });

  it.each([null, "", ".", "..", "carpeta/id"])(
    "rechaza un ID inválido: %s",
    (id) => expect(isValidProfileId(id)).toBe(false),
  );
});

describe("límite global de consultas", () => {
  it("nunca permite que Firestore reciba más de 10.000", () => {
    expect(capQueryLimit(MAX_PERIOD_RECORDS + 1)).toBe(MAX_PERIOD_RECORDS);
    expect(capQueryLimit(Number.POSITIVE_INFINITY)).toBe(MAX_PERIOD_RECORDS);
    expect(capQueryLimit(0)).toBe(1);
    expect(capQueryLimit(30.9)).toBe(30);
  });
});
