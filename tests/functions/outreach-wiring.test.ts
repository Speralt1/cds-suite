// @vitest-environment node
// Cableado estático de «Ve por los tuyos» (H3b): callables, opciones y puerta de cada grupo.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createOutreachCallableHandler, COORDINATOR_OPS, FOLLOWUP_OPS, TABLE_OPS, DECISION_OPS } = require("../../functions/outreach/service.js");
const ROOT = path.resolve(__dirname, "../..");
const indexJs = fs.readFileSync(path.join(ROOT, "functions/index.js"), "utf8");

const GROUPS = { outreachCoordinatorOp: "coordinator", outreachFollowupOp: "followup", outreachTableOp: "table", outreachDecisionOp: "decision" } as const;

describe("functions/index.js · Ve por los tuyos", () => {
  it.each(Object.entries(GROUPS))("exporta %s con la región y los límites de members*", (name, group) => {
    const re = new RegExp(
      `exports\\.${name} = onCall\\(\\s*\\{ region: REGION, timeoutSeconds: 20, memory: "256MiB", maxInstances: 5 \\},\\s*createOutreachCallableHandler\\(outreachService, "${group}"\\),\\s*\\);`,
    );
    expect(indexJs).toMatch(re);
  });
  it("va después de Integrantes y usa el store de Admin SDK", () => {
    expect(indexJs.indexOf("exports.outreachCoordinatorOp")).toBeGreaterThan(indexJs.indexOf("exports.membersOwnerOptions"));
    expect(indexJs).toContain("createOutreachStore({ db, FieldValue, FieldPath })");
  });
  it("no reutiliza el servicio ni las colecciones de Consolidación", () => {
    const src = fs.readFileSync(path.join(ROOT, "functions/outreach/service.js"), "utf8");
    expect(src).not.toMatch(/membersPeople|membersVisits|membersFollowUps|membersPersonChanges|members\/service/);
  });
});

describe("grupos de operaciones", () => {
  it("cada grupo tiene las operaciones acordadas, sin solaparse", () => {
    expect(COORDINATOR_OPS).toEqual([
      "editionCreate", "editionUpdate", "editionTransition", "teamSet", "tablesSet", "tableLinkIssue", "tableLinkRevoke",
      "importRegistrations", "confirmAbsences", "distributionPropose", "distributionConfirm", "reassign", "releaseAssignee", "stats",
      "reviewList", "reviewResolve", "teamCandidates", "tablesList",
    ]);
    expect(FOLLOWUP_OPS).toEqual(["contactRecord", "doNotContactSet"]);
    expect(Object.keys(TABLE_OPS)).toEqual(["search", "mark", "unmark", "addWalkIn"]);
    expect(DECISION_OPS).toEqual(["decisionRecord", "decisionList", "decisionStats"]);
  });
  it("la mesa no exige sesión pero sí token; los demás grupos exigen sesión", async () => {
    const called: unknown[][] = [];
    const service = new Proxy({}, { get: (_t, op) => async (...args: unknown[]) => void called.push([op, ...args]) });
    await createOutreachCallableHandler(service, "table")({ data: { op: "search", payload: { token: "t" } } });
    expect(called[0]).toEqual(["tableSearch", { token: "t" }]); // sin uid
    // aunque la mesa reciba una sesión, no se pasa al servicio
    await createOutreachCallableHandler(service, "table")({ auth: { uid: "u" }, data: { op: "mark", payload: {} } });
    expect(called[1]).toEqual(["tableMark", {}]);
    await createOutreachCallableHandler(service, "coordinator")({ data: { op: "stats", payload: {} } });
    expect(called[2]).toEqual(["stats", null, {}]);
    await createOutreachCallableHandler(service, "followup")({ auth: { uid: "u" }, data: { op: "contactRecord", payload: {} } });
    expect(called[3]).toEqual(["contactRecord", "u", {}]);
  });
  it("rechaza grupos y operaciones desconocidas", async () => {
    expect(() => createOutreachCallableHandler({}, "otro")).toThrow();
    for (const op of ["", "constructor", "__proto__", "tableSearch", undefined]) {
      await expect(createOutreachCallableHandler({}, "table")({ data: { op, payload: {} } })).rejects.toMatchObject({ code: "invalid-argument" });
    }
  });
});
