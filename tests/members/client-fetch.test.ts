// fetchPerson (revisión 24b F4): lectura puntual de membersPeople/{id} con getDoc.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  getDoc: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: { fake: true } }) }));
vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return { ...actual, doc: h.doc, getDoc: h.getDoc };
});

import { fetchPerson } from "@/lib/members/client";

beforeEach(() => {
  h.doc.mockClear();
  h.getDoc.mockReset();
});

describe("fetchPerson", () => {
  it("lee membersPeople/{id} con getDoc y mapea la persona", async () => {
    h.getDoc.mockResolvedValue({
      id: "p99",
      exists: () => true,
      data: () => ({ fullName: "Lucía Fuera", phoneE164: "+56955550199", revision: 7, consolidationStatus: "por_contactar" }),
    });
    const p = await fetchPerson("p99");
    expect(h.doc).toHaveBeenCalledWith({ fake: true }, "membersPeople", "p99");
    expect(h.getDoc).toHaveBeenCalledWith({ path: "membersPeople/p99" });
    expect(p).toMatchObject({ id: "p99", fullName: "Lucía Fuera", revision: 7, consolidationStatus: "por_contactar" });
  });

  it("documento inexistente → null", async () => {
    h.getDoc.mockResolvedValue({ id: "nadie", exists: () => false, data: () => undefined });
    await expect(fetchPerson("nadie")).resolves.toBeNull();
  });

  it("error de lectura → rechaza con el tipo de error", async () => {
    h.getDoc.mockRejectedValue({ code: "permission-denied" });
    await expect(fetchPerson("p1")).rejects.toBe("permission");
  });
});
