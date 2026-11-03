import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
vi.mock("firebase/functions", () => ({ httpsCallable: () => call }));
vi.mock("@/lib/firebase", () => ({ getFirebaseFunctions: () => ({}), getFirebaseServices: () => ({ db: {} }) }));

import { distributionConfirm, reviewList, teamCandidates, tablesList, toOutreachError } from "@/lib/outreach/client";

beforeEach(() => call.mockReset());

describe("contratos del cliente con el backend", () => {
  it("teamCandidates lee {candidates}", async () => {
    call.mockResolvedValue({ data: { candidates: [{ uid: "u1", displayName: "Ana" }] } });
    expect(await teamCandidates("vplt-2026")).toEqual([{ uid: "u1", displayName: "Ana" }]);
  });
  it("tablesList lee {tables}", async () => {
    call.mockResolvedValue({ data: { tables: [{ number: 2, leaderUid: "u1", leaderName: "Ana", hasLink: true, linkRevoked: false, linkIssuedAt: null }, { number: 1 }] } });
    const t = await tablesList("vplt-2026");
    expect(t.map((x) => x.number)).toEqual([1, 2]);
    expect(t[1]).toMatchObject({ leaderName: "Ana", hasLink: true });
  });
  it("reviewList lee {items}", async () => {
    call.mockResolvedValue({ data: { items: [{ id: "a", issue: "dup", createdAt: null }] } });
    expect((await reviewList("vplt-2026"))[0]).toMatchObject({ id: "a", createdAt: null });
  });
  it("distributionConfirm envía notes solo si hay", async () => {
    call.mockResolvedValue({ data: { batchId: "b", applied: 1, alreadyApplied: 0, conflicts: [] } });
    await distributionConfirm("e", "b");
    expect(call).toHaveBeenLastCalledWith({ op: "distributionConfirm", payload: { editionId: "e", batchId: "b" } });
    await distributionConfirm("e", "b", [{ registrationId: "r", note: "x" }]);
    expect(call.mock.lastCall![0].payload.notes).toHaveLength(1);
  });
  it("conflicto por tope se traduce al español", () => {
    const e = toOutreachError({ code: "functions/aborted", message: "outreach/conflict", details: { reason: "tope" } });
    expect(e.message).toBe("Superaría el tope de 20. Agrega una nota que lo justifique.");
    expect(toOutreachError({ code: "functions/aborted", message: "outreach/conflict" }).message).toMatch(/Alguien cambió/);
  });
});
