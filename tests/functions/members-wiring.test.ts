// @vitest-environment node
// Cableado estático de Consolidación V1: callables en functions/index.js e
// índices compuestos del doc 23 §10.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MEMBERS_CALLABLES } from "@/lib/shared/members";

const ROOT = path.resolve(__dirname, "../..");
const indexJs = fs.readFileSync(path.join(ROOT, "functions/index.js"), "utf8");
const indexes = JSON.parse(fs.readFileSync(path.join(ROOT, "firestore.indexes.json"), "utf8"));

describe("functions/index.js · Integrantes", () => {
  it("exporta los 6 callables con los nombres del modelo compartido, región y límites del doc 23", () => {
    const methods = Object.entries(MEMBERS_CALLABLES);
    expect(methods).toHaveLength(6);
    for (const [method, name] of methods) {
      const re = new RegExp(
        `exports\\.${name} = onCall\\(\\s*\\{ region: REGION, timeoutSeconds: 20, memory: "256MiB", maxInstances: 5 \\},\\s*createMembersCallableHandler\\(membersService, "${method}"\\),\\s*\\);`,
      );
      expect(indexJs, name).toMatch(re);
    }
  });

  it("el bloque de Integrantes va al final, después del calendario", () => {
    expect(indexJs.indexOf("exports.membersPersonCreate")).toBeGreaterThan(indexJs.indexOf("exports.calendarShareLinkManage"));
    expect(indexJs).toContain("createMembersStore({ db, FieldValue })");
  });
});

describe("firestore.indexes.json · Integrantes (doc 23 §10)", () => {
  type Index = { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order: string }[] };
  const members = (indexes.indexes as Index[]).filter((i) => i.collectionGroup.startsWith("members"));

  it("exactamente los 3 índices compuestos del historial de la ficha", () => {
    expect(members).toEqual([
      { collectionGroup: "membersVisits", queryScope: "COLLECTION", fields: [{ fieldPath: "personId", order: "ASCENDING" }, { fieldPath: "createdAt", order: "DESCENDING" }] },
      { collectionGroup: "membersFollowUps", queryScope: "COLLECTION", fields: [{ fieldPath: "personId", order: "ASCENDING" }, { fieldPath: "createdAt", order: "DESCENDING" }] },
      { collectionGroup: "membersPersonChanges", queryScope: "COLLECTION", fields: [{ fieldPath: "personId", order: "ASCENDING" }, { fieldPath: "at", order: "DESCENDING" }] },
    ]);
  });
});
