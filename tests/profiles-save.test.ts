// @vitest-environment node
// saveProfile (doc 27) con un Firestore en memoria y fallos guionizados: caminos que el
// emulador no reproduce de forma determinista (permission-denied por una carrera de altas del
// registro, fallo de la cesión desde una gemela archivada). Datos ficticios.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase/firestore";
import type { ProfileInput, TitheProfile } from "@/lib/finance/types";

type Data = Record<string, unknown>;
const fake = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>>(),
  /** Se ejecuta antes de aplicar cada commit; puede lanzar o modificar el store. */
  beforeCommit: [] as ((writes: [string, Record<string, unknown> | null][]) => void)[],
  commits: 0,
}));

vi.mock("firebase/firestore", () => {
  const stamp = { isEqual: (o: unknown) => o === stamp, __stamp: true };
  return {
    collection: (_db: unknown, name: string) => ({ name }),
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/"), id: path[path.length - 1] ?? "auto" }),
    query: (col: { name: string }, ...cs: { field?: string; value?: unknown }[]) => ({ col: col.name, cs }),
    where: (field: string, _op: string, value: unknown) => ({ field, value }),
    limit: () => ({}),
    serverTimestamp: () => stamp,
    getDocs: async (q: { col: string; cs: { field?: string; value?: unknown }[] }) => {
      const w = q.cs.find((c) => c.field);
      const docs = [...fake.store.entries()]
        .filter(([p, d]) => p.startsWith(`${q.col}/`) && (!w || d[w.field!] === w.value))
        .map(([p, d]) => ({ id: p.split("/")[1], data: () => d }));
      return { docs };
    },
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const writes: [string, Record<string, unknown> | null][] = [];
      const tx = {
        get: async (ref: { path: string }) => {
          const d = fake.store.get(ref.path);
          return { exists: () => !!d, data: () => (d ? { ...d } : undefined), id: ref.path };
        },
        set: (ref: { path: string }, data: Record<string, unknown>) => writes.push([ref.path, data]),
        delete: (ref: { path: string }) => writes.push([ref.path, null]),
      };
      const result = await fn(tx);
      const hook = fake.beforeCommit.shift();
      hook?.(writes);
      for (const [p, d] of writes) {
        if (d === null) fake.store.delete(p);
        else fake.store.set(p, d);
      }
      fake.commits++;
      return result;
    },
  };
});

const { saveProfile } = await import("@/lib/finance/profiles");

const db = {} as Firestore;
const T0 = { isEqual: (o: unknown) => o === T0 };
function legacy(id: string, displayName: string, extra: Data = {}) {
  const p = {
    type: "person",
    displayName,
    searchName: displayName.toLowerCase(),
    phone: "",
    email: "",
    members: "",
    active: true,
    pastoralContactAuthorized: false,
    createdAt: T0,
    createdBy: "u",
    updatedAt: T0,
    updatedBy: "u",
    ...extra,
  };
  fake.store.set(`titheProfiles/${id}`, p);
  return { id, ...p } as unknown as TitheProfile;
}
const input = (displayName: string, extra: Partial<ProfileInput> = {}): ProfileInput => ({
  type: "person",
  displayName,
  phone: "",
  email: "",
  members: "",
  active: true,
  pastoralContactAuthorized: false,
  ...extra,
});
const denied = () => Object.assign(new Error("PERMISSION_DENIED"), { code: "permission-denied" });

beforeEach(() => {
  fake.store.clear();
  fake.beforeCommit.length = 0;
  fake.commits = 0;
});

describe("saveProfile · carrera al registrar la clave (MINOR-B)", () => {
  it("si otra gemela registró la clave a la vez, reintenta y devuelve el aviso (no permission-denied)", async () => {
    const t2 = legacy("T2", "MARTA GIL");
    legacy("T1", "Marta Gil");
    // Entre la lectura y el commit, T1 registra la clave; las reglas niegan nuestro "alta".
    fake.beforeCommit.push(() => {
      fake.store.set("titheProfileKeys/marta_gil", { profileId: "T1" });
      throw denied();
    });
    const r = await saveProfile(db, "u", input("MARTA GIL", { phone: "2" }), t2);
    expect(r).toEqual({ id: "T2", possibleDuplicateOf: "T1" });
    expect(fake.store.get("titheProfiles/T2")).toMatchObject({ phone: "2" });
    expect(fake.store.get("titheProfiles/T2")).not.toHaveProperty("identityKey");
  });

  it("en un alta, la carrera perdida termina en DuplicateProfileError", async () => {
    fake.beforeCommit.push(() => {
      fake.store.set("titheProfileKeys/marta_gil", { profileId: "T1" });
      throw denied();
    });
    await expect(saveProfile(db, "u", input("Marta Gil"), undefined, "new")).rejects.toMatchObject({
      name: "DuplicateProfileError",
      profileId: "T1",
    });
  });

  it("un permission-denied sin alta de clave no se reintenta", async () => {
    const t1 = legacy("T1", "Marta Gil", { identityKey: "marta_gil" });
    fake.store.set("titheProfileKeys/marta_gil", { profileId: "T1" });
    fake.beforeCommit.push(() => {
      throw denied();
    });
    await expect(saveProfile(db, "u", input("Marta Gil", { phone: "9" }), t1)).rejects.toMatchObject({ code: "permission-denied" });
    expect(fake.commits).toBe(0);
  });

  it("solo un reintento: un segundo permission-denied se propaga", async () => {
    const t2 = legacy("T2", "Marta Gil");
    fake.beforeCommit.push(() => {
      throw denied();
    }, () => {
      throw denied();
    });
    await expect(saveProfile(db, "u", input("Marta Gil"), t2)).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("saveProfile · cesión desde gemela archivada (MINOR-A)", () => {
  function twins() {
    legacy("L2", "ROSA DIAZ", { active: false, identityKey: "rosa_diaz" });
    fake.store.set("titheProfileKeys/rosa_diaz", { profileId: "L2" });
    return legacy("L1", "Rosa Díaz");
  }

  it("cesión correcta: la activa toma la clave y se informa releasedFrom", async () => {
    const r = await saveProfile(db, "u", input("Rosa Díaz", { phone: "1" }), twins());
    expect(r).toEqual({ id: "L1", releasedFrom: "L2" });
    expect(fake.store.get("titheProfileKeys/rosa_diaz")).toMatchObject({ profileId: "L1" });
    expect(fake.store.get("titheProfiles/L2")).not.toHaveProperty("identityKey");
  });

  it("si la cesión falla, igual se guarda la edición (sin clave, con aviso): nunca bloquea", async () => {
    const l1 = twins();
    fake.beforeCommit.push(() => {
      throw denied();
    });
    const r = await saveProfile(db, "u", input("Rosa Díaz", { phone: "1" }), l1);
    expect(r).toEqual({ id: "L1", possibleDuplicateOf: "L2" });
    expect(fake.store.get("titheProfiles/L1")).toMatchObject({ phone: "1" });
    expect(fake.store.get("titheProfileKeys/rosa_diaz")).toMatchObject({ profileId: "L2" });
  });
});

describe("saveProfile · cambio de nombre de una ficha antigua (MINOR-C)", () => {
  it("renombrar hacia un nombre registrado por otra ficha se rechaza", async () => {
    fake.store.set("titheProfileKeys/juan_perez", { profileId: "p1" });
    const old = legacy("old", "Pedro Rojas");
    await expect(saveProfile(db, "u", input("Juan Pérez"), old)).rejects.toMatchObject({
      name: "DuplicateProfileError",
      profileId: "p1",
    });
    expect(fake.store.get("titheProfiles/old")).toMatchObject({ displayName: "Pedro Rojas" });
  });

  it("conservar el mismo nombre sigue siendo solo un aviso", async () => {
    fake.store.set("titheProfileKeys/juan_perez", { profileId: "p1" });
    const old = legacy("old", "JUAN PEREZ");
    await expect(saveProfile(db, "u", input("JUAN PEREZ", { phone: "3" }), old)).resolves.toEqual({
      id: "old",
      possibleDuplicateOf: "p1",
    });
  });
});
