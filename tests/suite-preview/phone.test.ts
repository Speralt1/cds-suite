import { describe, expect, it } from "vitest";
import { formatPhone, normalizeEmail, normalizePhone, waLink } from "@/lib/suite-preview/phone";

describe("normalizePhone", () => {
  it("formas equivalentes del mismo celular chileno", () => {
    for (const raw of ["+56 9 1234 5678", "912345678", "56912345678", "(+56) 9-1234-5678", "0912345678", "0056912345678", "9.1234.5678"])
      expect(normalizePhone(raw), raw).toMatchObject({ ok: true, e164: "+56912345678", isChile: true });
  });
  it("8 dígitos, fijo y extranjero", () => {
    expect(normalizePhone("12345678")).toMatchObject({ ok: true, e164: "+56912345678" });
    expect(normalizePhone("221234567")).toMatchObject({ ok: true, e164: "+56221234567" });
    expect(normalizePhone("022 123 4567")).toMatchObject({ ok: true, e164: "+56221234567" });
    expect(normalizePhone("+58 412 1234567")).toMatchObject({ ok: true, e164: "+584121234567", isChile: false });
  });
  it("inválidos", () => {
    expect(normalizePhone("  ")).toEqual({ ok: false, reason: "empty" });
    for (const raw of ["123", "1234567890123456", "+56 9 1234 567", "9abc12345", "+1234567"]) expect(normalizePhone(raw).ok, raw).toBe(false);
  });
});

describe("formato, WhatsApp y correo", () => {
  it("formato visible", () => {
    expect(formatPhone("+56912345678")).toBe("+56 9 1234 5678");
    expect(formatPhone("+56212345678")).toBe("+56 2 1234 5678");
    expect(formatPhone("+56322123456")).toBe("+56 32 212 3456");
    expect(formatPhone("+584121234567", " +58 412  123 4567 ")).toBe("+58 412 123 4567");
  });
  it("waLink sin texto prellenado", () => {
    expect(waLink("+56912345678")).toBe("https://wa.me/56912345678");
  });
  it("normalizeEmail", () => {
    expect(normalizeEmail("  Ana.Torres@Demo.Invalid ")).toEqual({ ok: true, value: "ana.torres@demo.invalid" });
    expect(normalizeEmail("sin-arroba")).toEqual({ ok: false });
    expect(normalizeEmail(`${"a".repeat(160)}@x.cl`)).toEqual({ ok: false });
  });
});
