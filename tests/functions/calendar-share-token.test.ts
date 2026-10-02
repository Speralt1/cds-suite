// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const shareToken = require("../../functions/calendar/share-token.js");

describe("token del enlace público", () => {
  it("32 bytes aleatorios en base64url = 43 caracteres válidos", () => {
    const token = shareToken.generateShareToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(shareToken.SHARE_TOKEN_RE);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(shareToken.isWellFormedShareToken(token)).toBe(true);
  });

  it("1000 tokens únicos", () => {
    const set = new Set(Array.from({ length: 1000 }, () => shareToken.generateShareToken()));
    expect(set.size).toBe(1000);
  });

  it("usa randomBytes inyectado (32 bytes) y rechaza otro tamaño", () => {
    const sizes: number[] = [];
    const token = shareToken.generateShareToken((n: number) => {
      sizes.push(n);
      return Buffer.alloc(n, 0xff);
    });
    expect(sizes).toEqual([32]);
    expect(token).toBe("_".repeat(42) + "8");
    expect(() => shareToken.generateShareToken(() => Buffer.alloc(16))).toThrow();
  });

  it("hash SHA-256 en hex (vector conocido)", () => {
    expect(shareToken.hashShareToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(shareToken.hashShareToken("abc")).toHaveLength(64);
    expect(shareToken.hashShareToken("a".repeat(43))).not.toBe(shareToken.hashShareToken("b".repeat(43)));
  });

  it("SHARE_TOKEN_RE: exactamente 43 caracteres [A-Za-z0-9_-]", () => {
    const re: RegExp = shareToken.SHARE_TOKEN_RE;
    expect(re.test("a".repeat(43))).toBe(true);
    expect(re.test(`${"A".repeat(40)}-_9`)).toBe(true);
    expect(re.test("a".repeat(42))).toBe(false);
    expect(re.test("a".repeat(44))).toBe(false);
    expect(re.test(`${"a".repeat(42)}=`)).toBe(false);
    expect(re.test(`${"a".repeat(42)}+`)).toBe(false);
    expect(re.test(`${"a".repeat(42)}/`)).toBe(false);
    expect(shareToken.isWellFormedShareToken(["a".repeat(43)])).toBe(false);
    expect(shareToken.isWellFormedShareToken(undefined)).toBe(false);
  });
});
