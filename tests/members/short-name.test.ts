// Nombre corto de responsables en listas (UX 18/10/2026). Datos ficticios.
import { describe, expect, it } from "vitest";
import { shortName } from "@/components/members/model";

describe("shortName", () => {
  it("nombre + inicial del apellido; ignora palabras que no empiezan con letra", () => {
    expect(shortName("Ana Torres")).toBe("Ana T.");
    expect(shortName("  Ana   Ñuñez  ")).toBe("Ana Ñ.");
    expect(shortName("Administración (prueba)")).toBe("Administración");
    expect(shortName("Pastor")).toBe("Pastor");
  });
});
