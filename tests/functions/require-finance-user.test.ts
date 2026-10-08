// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createRequireFinanceUser, isFinanceUserDoc } = require("../../functions/auth/require-finance-user.js");

/** Regla anterior de functions/index.js (referencia para la equivalencia). */
function legacyAllowed(doc: Record<string, unknown> | null): boolean {
  return !!doc && doc.active === true && ["admin", "pastor", "finance"].includes(doc.role as string);
}

const LEGACY_DOCS: Record<string, Record<string, unknown> | null> = {
  admin: { role: "admin", active: true },
  pastor: { role: "pastor", active: true },
  finance: { role: "finance", active: true },
  leader: { role: "leader", active: true },
  "admin inactivo": { role: "admin", active: false },
  "finance inactivo": { role: "finance", active: false },
  "active no booleano": { role: "finance", active: "true" },
  "rol inválido": { role: "member", active: true },
  "sin rol": { active: true },
  inexistente: null,
};

describe("requireFinanceUser con el modelo compartido", () => {
  it.each(Object.entries(LEGACY_DOCS))("legacy %s: mismo resultado que la regla anterior", (_, doc) => {
    expect(isFinanceUserDoc(doc)).toBe(legacyAllowed(doc));
  });

  it("tabla explícita: admin/pastor/finance sí; leader, inactivo e inexistente no", () => {
    expect(isFinanceUserDoc(LEGACY_DOCS.admin)).toBe(true);
    expect(isFinanceUserDoc(LEGACY_DOCS.pastor)).toBe(true);
    expect(isFinanceUserDoc(LEGACY_DOCS.finance)).toBe(true);
    expect(isFinanceUserDoc(LEGACY_DOCS.leader)).toBe(false);
    expect(isFinanceUserDoc(LEGACY_DOCS["admin inactivo"])).toBe(false);
    expect(isFinanceUserDoc(null)).toBe(false);
  });

  it("v1: decide finance.records.manage (no el rol guardado)", () => {
    const v1 = (over: Record<string, unknown>) => ({ accessSchemaVersion: 1, active: true, baseRole: "standard", permissions: [], ...over });
    expect(isFinanceUserDoc(v1({ role: "leader", permissions: ["finance.records.manage"] }))).toBe(true);
    expect(isFinanceUserDoc(v1({ role: "finance", permissions: ["finance.details.read"] }))).toBe(false);
    expect(isFinanceUserDoc(v1({ role: "admin", baseRole: "admin" }))).toBe(true);
    expect(isFinanceUserDoc(v1({ role: "admin", baseRole: "admin", active: false }))).toBe(false);
  });

  it("flujo HTTP: sin Bearer → UNAUTHENTICATED; sin permiso → FORBIDDEN; con permiso → uid", async () => {
    const docs: Record<string, Record<string, unknown> | null> = { "u-fin": LEGACY_DOCS.finance, "u-lead": LEGACY_DOCS.leader };
    const verified: string[] = [];
    const requireFinanceUser = createRequireFinanceUser({
      verifyIdToken: async (token: string) => {
        verified.push(token);
        return { uid: token.replace("tok-", "") };
      },
      getUserDoc: async (uid: string) => docs[uid] ?? null,
    });
    const req = (authorization?: string) => ({ get: (name: string) => (name === "authorization" ? authorization : undefined) });
    await expect(requireFinanceUser(req())).rejects.toThrow("UNAUTHENTICATED");
    await expect(requireFinanceUser(req("Basic abc"))).rejects.toThrow("UNAUTHENTICATED");
    await expect(requireFinanceUser(req("Bearer tok-u-lead"))).rejects.toThrow("FORBIDDEN");
    await expect(requireFinanceUser(req("Bearer tok-u-nadie"))).rejects.toThrow("FORBIDDEN");
    await expect(requireFinanceUser(req("bearer tok-u-fin"))).resolves.toBe("u-fin");
    expect(verified).toEqual(["tok-u-lead", "tok-u-nadie", "tok-u-fin"]);
  });
});
