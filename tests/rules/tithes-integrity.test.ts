// Integridad de diezmos (doc 27): registro de identidad de fichas (titheProfileKeys) y
// diezmos repetidos / doble envío. Reglas reales + cliente real; solo emulador, datos ficticios.
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DuplicateProfileError,
  saveProfile,
} from "../../lib/finance/profiles";
import { saveTransaction } from "../../lib/finance/transactions";
import { findExactTitheMatches } from "../../lib/finance/tithe-integrity";
import type {
  ProfileInput,
  TitheProfile,
  TransactionInput,
} from "../../lib/finance/types";

let env: RulesTestEnvironment;
let db: Firestore;
const base: ProfileInput = {
  type: "person",
  displayName: "Juan Pérez",
  phone: "",
  email: "",
  members: "",
  active: true,
  pastoralContactAuthorized: false,
};
const tithe: TransactionInput = {
  type: "income",
  amount: 145000,
  date: "2026-10-02",
  category: "Diezmos",
  paymentMethod: "transfer",
  description: "Diezmo",
  note: "",
};
const dbFor = (uid: string) =>
  env.authenticatedContext(uid).firestore() as unknown as Firestore;
async function profileDoc(id: string) {
  const s = await getDoc(doc(db, "titheProfiles", id));
  return { id, ...s.data() } as TitheProfile;
}
async function keyDoc(key: string) {
  return (await getDoc(doc(db, "titheProfileKeys", key))).data();
}
/** Lo que escribe el cliente hoy desplegado (sin identityKey) al editar una ficha. */
function legacyClientWrite(p: TitheProfile, uid: string, patch: Partial<ProfileInput> = {}) {
  const input = { ...base, displayName: p.displayName, ...patch };
  return setDoc(doc(dbFor(uid), "titheProfiles", p.id), {
    ...input,
    searchName: input.displayName.toLowerCase(),
    createdBy: p.createdBy,
    createdAt: p.createdAt,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });
}
function profileData(uid: string, displayName: string, extra: Record<string, unknown> = {}) {
  return {
    ...base,
    displayName,
    searchName: displayName.toLowerCase(),
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-cds-suite",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const role of ["admin", "pastor", "finance", "leader", "inactive"])
      await setDoc(doc(ctx.firestore(), "users", role), {
        displayName: role,
        email: `${role}@example.test`,
        role: role === "inactive" ? "finance" : role,
        active: role !== "inactive",
        createdAt: Timestamp.now(),
      });
    await setDoc(doc(ctx.firestore(), "users", "v1-readonly"), {
      displayName: "v1 lectura",
      email: "v1-readonly@example.test",
      role: "leader",
      active: true,
      createdAt: Timestamp.now(),
      baseRole: "standard",
      position: "",
      permissions: ["finance.summary.read", "finance.details.read"],
      areaIds: [],
      homeModule: "finance",
      accessSchemaVersion: 1,
      updatedAt: Timestamp.now(),
      updatedBy: "seed",
    });
  });
  db = dbFor("finance");
});
afterAll(async () => await env?.cleanup());

describe("registro de identidad de fichas (titheProfileKeys)", () => {
  it("alta con clave: ficha + registro en la misma transacción", async () => {
    expect(await saveProfile(db, "finance", base, undefined, "p1")).toEqual({ id: "p1" });
    expect((await profileDoc("p1")).identityKey).toBe("juan_perez");
    expect(await keyDoc("juan_perez")).toMatchObject({ profileId: "p1", createdBy: "finance" });
  });

  it("nombre equivalente: el cliente lanza DuplicateProfileError y las reglas niegan el atajo", async () => {
    await saveProfile(db, "finance", base, undefined, "p1");
    const dup = saveProfile(db, "finance", { ...base, displayName: "  JUAN PÉREZ. " }, undefined, "p2");
    await expect(dup).rejects.toBeInstanceOf(DuplicateProfileError);
    await expect(dup).rejects.toMatchObject({ profileId: "p1", identityKey: "juan_perez" });
    expect((await getDoc(doc(db, "titheProfiles", "p2"))).exists()).toBe(false);
    // Saltándose el cliente: reescribir el registro existente es un update → denegado.
    const b = writeBatch(db);
    b.set(doc(db, "titheProfiles", "p2"), profileData("finance", "Juan Pérez", { identityKey: "juan_perez" }));
    b.set(doc(db, "titheProfileKeys", "juan_perez"), { profileId: "p2", createdBy: "finance", createdAt: serverTimestamp() });
    await assertFails(b.commit());
    // Ficha con clave sin tomar el registro → denegado.
    await assertFails(setDoc(doc(db, "titheProfiles", "p3"), profileData("finance", "Juan Pérez", { identityKey: "juan_perez" })));
  });

  it("altas concurrentes con el mismo nombre: exactamente una gana", async () => {
    const results = await Promise.allSettled([
      saveProfile(db, "finance", base, undefined, "c1"),
      saveProfile(dbFor("admin"), "admin", { ...base, displayName: "juan perez" }, undefined, "c2"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const winner = (ok[0] as PromiseFulfilledResult<{ id: string }>).value.id;
    expect((await keyDoc("juan_perez"))!.profileId).toBe(winner);
    const profiles = await getDocs(collection(db, "titheProfiles"));
    expect(profiles.docs.map((d) => d.id)).toEqual([winner]);
  });

  it("personas distintas con nombres parecidos no se bloquean", async () => {
    await saveProfile(db, "finance", base, undefined, "p1");
    await assertSucceeds(saveProfile(db, "finance", { ...base, displayName: "Juana Pérez" }, undefined, "p2"));
    await assertSucceeds(saveProfile(db, "finance", { ...base, displayName: "Juan Pérez Soto" }, undefined, "p3"));
    expect((await keyDoc("juana_perez"))!.profileId).toBe("p2");
    expect((await keyDoc("juan_perez_soto"))!.profileId).toBe("p3");
  });

  it("registro sin ficha correspondiente → denegado; datos inválidos → denegado", async () => {
    await assertFails(setDoc(doc(db, "titheProfileKeys", "ana_soto"), { profileId: "nadie", createdBy: "finance", createdAt: serverTimestamp() }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "titheProfiles", "legacy"), profileData("finance", "Ana Soto", { createdAt: Timestamp.now(), updatedAt: Timestamp.now() }));
    });
    // Ficha antigua sin clave, no escrita en el mismo commit → denegado.
    await assertFails(setDoc(doc(db, "titheProfileKeys", "ana_soto"), { profileId: "legacy", createdBy: "finance", createdAt: serverTimestamp() }));
    // Clave con formato inválido o auditoría falsa → denegado.
    const bad = writeBatch(db);
    bad.set(doc(db, "titheProfiles", "x1"), profileData("finance", "Ana Soto", { identityKey: "Ana Soto" }));
    bad.set(doc(db, "titheProfileKeys", "Ana Soto"), { profileId: "x1", createdBy: "finance", createdAt: serverTimestamp() });
    await assertFails(bad.commit());
    const forged = writeBatch(db);
    forged.set(doc(db, "titheProfiles", "x2"), profileData("finance", "Rosa Díaz", { identityKey: "rosa_diaz" }));
    forged.set(doc(db, "titheProfileKeys", "rosa_diaz"), { profileId: "x2", createdBy: "admin", createdAt: serverTimestamp() });
    await assertFails(forged.commit());
  });

  it("cambio de nombre mueve la clave (nueva creada, anterior borrada, mismo commit)", async () => {
    await saveProfile(db, "finance", base, undefined, "p1");
    await saveProfile(db, "finance", { ...base, displayName: "Juan Pérez Soto" }, await profileDoc("p1"));
    expect((await profileDoc("p1")).identityKey).toBe("juan_perez_soto");
    expect((await keyDoc("juan_perez_soto"))!.profileId).toBe("p1");
    expect(await keyDoc("juan_perez")).toBeUndefined();
    // El nombre liberado vuelve a estar disponible.
    await assertSucceeds(saveProfile(db, "finance", base, undefined, "p2"));
  });

  it("cambio de nombre sin borrar la clave anterior → denegado", async () => {
    await saveProfile(db, "finance", base, undefined, "p1");
    const p = await profileDoc("p1");
    const b = writeBatch(db);
    b.set(doc(db, "titheProfiles", "p1"), {
      ...profileData("finance", "Juan Pérez Soto", { identityKey: "juan_perez_soto" }),
      createdAt: p.createdAt,
    });
    b.set(doc(db, "titheProfileKeys", "juan_perez_soto"), { profileId: "p1", createdBy: "finance", createdAt: serverTimestamp() });
    await assertFails(b.commit());
  });

  it("cambio de nombre a una clave ocupada → denegado (cliente y reglas)", async () => {
    await saveProfile(db, "finance", base, undefined, "p1");
    await saveProfile(db, "finance", { ...base, displayName: "Pedro Rojas" }, undefined, "p2");
    await expect(
      saveProfile(db, "finance", { ...base, displayName: "Juan Perez" }, await profileDoc("p2")),
    ).rejects.toBeInstanceOf(DuplicateProfileError);
    const p2 = await profileDoc("p2");
    const b = writeBatch(db);
    b.set(doc(db, "titheProfiles", "p2"), { ...profileData("finance", "Juan Perez", { identityKey: "juan_perez" }), createdAt: p2.createdAt });
    b.delete(doc(db, "titheProfileKeys", "pedro_rojas"));
    await assertFails(b.commit());
    expect((await profileDoc("p2")).displayName).toBe("Pedro Rojas");
  });

  it("el registro es inmutable y no se borra mientras la ficha lo usa; las fichas no se borran", async () => {
    await saveProfile(db, "finance", base, undefined, "p1");
    await assertFails(updateDoc(doc(db, "titheProfileKeys", "juan_perez"), { profileId: "p9" }));
    await assertFails(deleteDoc(doc(db, "titheProfileKeys", "juan_perez")));
    await assertFails(deleteDoc(doc(dbFor("admin"), "titheProfiles", "p1")));
  });

  it("ficha antigua sin clave: se edita siempre; registra su clave si está libre", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const now = Timestamp.now();
      await setDoc(doc(ctx.firestore(), "titheProfiles", "old1"), profileData("finance", "Ana Soto", { createdAt: now, updatedAt: now }));
      await setDoc(doc(ctx.firestore(), "titheProfiles", "old2"), profileData("finance", "ANA SOTO", { createdAt: now, updatedAt: now }));
    });
    expect(await saveProfile(db, "finance", { ...base, displayName: "Ana Soto", phone: "+56 9 0000 0000" }, await profileDoc("old1"))).toEqual({ id: "old1" });
    expect((await profileDoc("old1")).identityKey).toBe("ana_soto");
    expect((await keyDoc("ana_soto"))!.profileId).toBe("old1");
    // La segunda ficha antigua con el mismo nombre se guarda SIN clave y avisa (nunca se bloquea).
    const r = await saveProfile(db, "finance", { ...base, displayName: "ANA SOTO", email: "ana@example.test" }, await profileDoc("old2"));
    expect(r).toEqual({ id: "old2", possibleDuplicateOf: "old1" });
    const old2 = await profileDoc("old2");
    expect(old2.email).toBe("ana@example.test");
    expect(old2).not.toHaveProperty("identityKey");
  });

  it("Fase 1: el cliente desplegado (sin identityKey) sigue creando y editando", async () => {
    await assertSucceeds(setDoc(doc(db, "titheProfiles", "legacy-new"), profileData("finance", "Rosa Díaz")));
    await saveProfile(db, "finance", base, undefined, "p1");
    // Reescribe una ficha con clave sin el campo: permitido; el registro sigue bloqueando el nombre.
    await assertSucceeds(legacyClientWrite(await profileDoc("p1"), "finance", { phone: "123" }));
    expect(await profileDoc("p1")).not.toHaveProperty("identityKey");
    expect((await keyDoc("juan_perez"))!.profileId).toBe("p1");
    await expect(saveProfile(db, "finance", base, undefined, "p2")).rejects.toBeInstanceOf(DuplicateProfileError);
    // El cliente nuevo vuelve a enlazar la clave que ya apunta a esta ficha.
    await saveProfile(db, "finance", { ...base, phone: "456" }, await profileDoc("p1"));
    expect((await profileDoc("p1")).identityKey).toBe("juan_perez");
  });

  it("gemelas antiguas: archivar una NO le entrega la clave; la activa la toma en su próxima edición", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const now = Timestamp.now();
      await setDoc(doc(ctx.firestore(), "titheProfiles", "L1"), profileData("finance", "Rosa Díaz", { createdAt: now, updatedAt: now }));
      await setDoc(doc(ctx.firestore(), "titheProfiles", "L2"), profileData("finance", "ROSA DIAZ", { createdAt: now, updatedAt: now }));
    });
    // Tesorería archiva L2 desde el panel (ruta normal saveProfile).
    await saveProfile(db, "finance", { ...base, displayName: "ROSA DIAZ", active: false }, await profileDoc("L2"));
    expect(await profileDoc("L2")).not.toHaveProperty("identityKey");
    expect(await keyDoc("rosa_diaz")).toBeUndefined();
    // La siguiente edición de la activa toma la clave, sin aviso de duplicado.
    expect(await saveProfile(db, "finance", { ...base, displayName: "Rosa Díaz", phone: "1" }, await profileDoc("L1"))).toEqual({ id: "L1" });
    expect((await profileDoc("L1")).identityKey).toBe("rosa_diaz");
    expect((await keyDoc("rosa_diaz"))!.profileId).toBe("L1");
  });

  it("gemelas antiguas: si la archivada ya tenía la clave, la cede a la activa (sin borrar nada)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const now = Timestamp.now();
      await setDoc(doc(ctx.firestore(), "titheProfiles", "L1"), profileData("finance", "Rosa Díaz", { createdAt: now, updatedAt: now }));
      await setDoc(doc(ctx.firestore(), "titheProfiles", "L2"), profileData("finance", "ROSA DIAZ", { createdAt: now, updatedAt: now }));
    });
    // L2 se editó primero estando activa (tomó la clave) y luego se archivó (la conserva).
    await saveProfile(db, "finance", { ...base, displayName: "ROSA DIAZ" }, await profileDoc("L2"));
    await saveProfile(db, "finance", { ...base, displayName: "ROSA DIAZ", active: false }, await profileDoc("L2"));
    expect((await keyDoc("rosa_diaz"))!.profileId).toBe("L2");
    const r = await saveProfile(db, "finance", { ...base, displayName: "Rosa Díaz", phone: "1" }, await profileDoc("L1"));
    expect(r).toEqual({ id: "L1", releasedFrom: "L2" });
    expect((await keyDoc("rosa_diaz"))!.profileId).toBe("L1");
    const l2 = await profileDoc("L2");
    expect(l2).not.toHaveProperty("identityKey");
    expect(l2).toMatchObject({ active: false, displayName: "ROSA DIAZ", updatedBy: "finance" });
    // Con la gemela ACTIVA dueña de la clave no hay cesión: solo aviso.
    await saveProfile(db, "finance", { ...base, displayName: "ROSA DIAZ", active: true }, l2);
    expect(await saveProfile(db, "finance", { ...base, displayName: "ROSA DIAZ", phone: "2" }, await profileDoc("L2"))).toEqual({ id: "L2", possibleDuplicateOf: "L1" });
    expect((await keyDoc("rosa_diaz"))!.profileId).toBe("L1");
  });

  it("ficha antigua RENOMBRADA hacia un nombre registrado por otra → DuplicateProfileError (no se tolera)", async () => {
    await saveProfile(db, "finance", base, undefined, "p1");
    await env.withSecurityRulesDisabled(async (ctx) => {
      const now = Timestamp.now();
      await setDoc(doc(ctx.firestore(), "titheProfiles", "old"), profileData("finance", "Pedro Rojas", { createdAt: now, updatedAt: now }));
    });
    await expect(
      saveProfile(db, "finance", { ...base, displayName: "JUAN PEREZ" }, await profileDoc("old")),
    ).rejects.toMatchObject({ name: "DuplicateProfileError", profileId: "p1" });
    expect((await profileDoc("old")).displayName).toBe("Pedro Rojas");
  });

  it("gemelas antiguas editadas a la vez: una toma la clave y la otra recibe el aviso (nunca permission-denied)", async () => {
    for (let round = 0; round < 3; round++) {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (ctx) => {
        const now = Timestamp.now();
        await setDoc(doc(ctx.firestore(), "users", "finance"), { displayName: "finance", email: "finance@example.test", role: "finance", active: true, createdAt: now });
        await setDoc(doc(ctx.firestore(), "users", "admin"), { displayName: "admin", email: "admin@example.test", role: "admin", active: true, createdAt: now });
        await setDoc(doc(ctx.firestore(), "titheProfiles", "T1"), profileData("finance", "Marta Gil", { createdAt: now, updatedAt: now }));
        await setDoc(doc(ctx.firestore(), "titheProfiles", "T2"), profileData("finance", "MARTA GIL", { createdAt: now, updatedAt: now }));
      });
      const [t1, t2] = [await profileDoc("T1"), await profileDoc("T2")];
      const results = await Promise.allSettled([
        saveProfile(db, "finance", { ...base, displayName: "Marta Gil", phone: "1" }, t1),
        saveProfile(dbFor("admin"), "admin", { ...base, displayName: "MARTA GIL", phone: "2" }, t2),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      const values = results.map((r) => (r as PromiseFulfilledResult<{ id: string; possibleDuplicateOf?: string }>).value);
      const owner = (await keyDoc("marta_gil"))!.profileId;
      const loser = values.find((v) => v.id !== owner)!;
      expect(loser.possibleDuplicateOf).toBe(owner);
      expect(values.find((v) => v.id === owner)).toEqual({ id: owner });
      expect((await profileDoc(loser.id)).phone).toBe(loser.id === "T1" ? "1" : "2");
    }
  });

  it("registro huérfano: un cambio de nombre del cliente anterior se limpia en la siguiente edición", async () => {
    await saveProfile(db, "finance", base, undefined, "A");
    // Cliente cacheado anterior: cambia el nombre y reescribe la ficha sin identityKey.
    await assertSucceeds(legacyClientWrite(await profileDoc("A"), "finance", { displayName: "Juan Pérez Soto" }));
    expect((await keyDoc("juan_perez"))!.profileId).toBe("A");
    await saveProfile(db, "finance", { ...base, displayName: "Juan Pérez Soto", phone: "9" }, await profileDoc("A"));
    expect((await profileDoc("A")).identityKey).toBe("juan_perez_soto");
    expect((await keyDoc("juan_perez_soto"))!.profileId).toBe("A");
    expect(await keyDoc("juan_perez")).toBeUndefined();
    await assertSucceeds(saveProfile(db, "finance", base, undefined, "B"));
  });

  it("archivar y reactivar no tocan el registro; la ficha archivada sigue reservando el nombre", async () => {
    await saveProfile(db, "finance", base, undefined, "p1");
    const created = (await getDoc(doc(db, "titheProfileKeys", "juan_perez"))).data()!;
    await saveProfile(db, "finance", { ...base, active: false }, await profileDoc("p1"));
    await expect(saveProfile(db, "finance", base, undefined, "p2")).rejects.toMatchObject({ profileId: "p1" });
    await saveProfile(db, "finance", { ...base, active: true }, await profileDoc("p1"));
    expect((await profileDoc("p1")).active).toBe(true);
    expect((await keyDoc("juan_perez"))!.createdAt.isEqual(created.createdAt)).toBe(true);
  });

  it("reintento de un alta ya confirmada (mismo id) es idempotente", async () => {
    await saveProfile(db, "finance", base, undefined, "p1");
    await expect(saveProfile(db, "finance", base, undefined, "p1")).resolves.toEqual({ id: "p1" });
    expect((await keyDoc("juan_perez"))!.profileId).toBe("p1");
  });

  it("nombre sin letras latinas: se guarda sin clave", async () => {
    await assertSucceeds(saveProfile(db, "finance", { ...base, displayName: "😀" }, undefined, "e1"));
    expect(await profileDoc("e1")).not.toHaveProperty("identityKey");
  });

  it("lectura del registro: mismos roles que las fichas; escritura solo con finance.records.manage", async () => {
    await saveProfile(db, "finance", base, undefined, "p1");
    for (const uid of ["admin", "pastor", "finance", "v1-readonly"])
      await assertSucceeds(getDoc(doc(dbFor(uid), "titheProfileKeys", "juan_perez")));
    for (const uid of ["leader", "inactive", "nobody"])
      await assertFails(getDoc(doc(dbFor(uid), "titheProfileKeys", "juan_perez")));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "titheProfileKeys", "juan_perez")));
    for (const uid of ["leader", "inactive", "v1-readonly"]) {
      const other = dbFor(uid);
      const b = writeBatch(other);
      b.set(doc(other, "titheProfiles", `z-${uid}`), profileData(uid, "Marta Gil", { identityKey: "marta_gil" }));
      b.set(doc(other, "titheProfileKeys", "marta_gil"), { profileId: `z-${uid}`, createdBy: uid, createdAt: serverTimestamp() });
      await assertFails(b.commit());
    }
  });
});

describe("diezmos repetidos y doble envío", () => {
  beforeEach(async () => {
    await saveProfile(db, "finance", base, undefined, "p1");
  });

  it("dos diezmos idénticos con ids distintos son válidos (repetir en el mes es normal)", async () => {
    await assertSucceeds(saveTransaction(db, "finance", "t1", tithe, { profileId: "p1" }));
    await assertSucceeds(saveTransaction(db, "finance", "t2", tithe, { profileId: "p1" }));
    const s = (await getDoc(doc(db, "financeMonthlySummaries", "2026-10"))).data()!;
    expect(s.transactionCount).toBe(2);
    expect(s.titheTotal).toBe(290000);
  });

  it("doble envío concurrente con el mismo id → UN movimiento, UNA atribución, resumen contado una vez", async () => {
    const results = await Promise.allSettled([
      saveTransaction(db, "finance", "same-id", tithe, { profileId: "p1" }),
      saveTransaction(db, "finance", "same-id", tithe, { profileId: "p1" }),
      saveTransaction(dbFor("finance"), "finance", "same-id", tithe, { profileId: "p1" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const txs = await getDocs(collection(db, "financeTransactions"));
    const attrs = await getDocs(collection(db, "titheAttributions"));
    expect(txs.docs.map((d) => d.id)).toEqual(["same-id"]);
    expect(attrs.docs.map((d) => d.id)).toEqual(["same-id"]);
    const s = (await getDoc(doc(db, "financeMonthlySummaries", "2026-10"))).data()!;
    expect(s.transactionCount).toBe(1);
    expect(s.titheTotal).toBe(145000);
    expect(s.incomeTotal).toBe(145000);
    // Reintento posterior del navegador con el mismo id: rechazado, nada cambia.
    await expect(saveTransaction(db, "finance", "same-id", tithe, { profileId: "p1" })).rejects.toThrow(/ya fue registrado/);
    expect((await getDoc(doc(db, "financeMonthlySummaries", "2026-10"))).data()!.transactionCount).toBe(1);
  });

  it("coincidencia exacta al guardar: se detecta aunque el mes tenga más de 20 diezmos", async () => {
    for (let d = 1; d <= 22; d++)
      await saveTransaction(db, "finance", `m${d}`, { ...tithe, amount: 1000 + d, date: `2026-10-${String(d + 3).padStart(2, "0")}` }, { profileId: "p1" });
    await saveTransaction(db, "finance", "target", { ...tithe, date: "2026-10-01" }, { profileId: "p1" });
    const found = await findExactTitheMatches(db, "p1", { date: "2026-10-01", amount: 145000, paymentMethod: "transfer" });
    expect(found.map((a) => a.id)).toEqual(["target"]);
    expect(await findExactTitheMatches(db, "p1", { date: "2026-10-01", amount: 145000, paymentMethod: "cash" })).toEqual([]);
    expect(await findExactTitheMatches(db, "p1", { date: "2026-10-01", amount: 1, paymentMethod: "transfer" })).toEqual([]);
  });

  it("no se atribuye a una ficha archivada", async () => {
    await saveProfile(db, "finance", { ...base, active: false }, await profileDoc("p1"));
    await expect(saveTransaction(db, "finance", "t3", tithe, { profileId: "p1" })).rejects.toThrow();
  });
});
