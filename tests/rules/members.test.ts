// Reglas de Integrantes › Consolidación V1 (doc 23 §4, doc 24). Solo emulador.
// Lectura: members.consolidation.read/manage explícito (v1) o admin. Escritura del cliente: nunca.
// Un usuario con Calendario o Finanzas pero sin Consolidación no puede saber cuántas personas
// existen, ni sus nombres, teléfonos, ids o alertas.
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MEMBERS_COLLECTIONS } from "../../lib/shared/members";
import { allowed, createRulesEnv, dbOf, P, seedBase, USERS, v1User } from "./helpers/platform-fixtures";

let env: RulesTestEnvironment;
const C = MEMBERS_COLLECTIONS;
const COLLECTIONS = [C.people, C.visits, C.followUps, C.changes] as const;
const PERSON = "p0000000000000000000001";

beforeAll(async () => {
  env = await createRulesEnv();
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedBase(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const at = Timestamp.fromDate(new Date("2026-10-04T15:00:00Z"));
    await setDoc(doc(db, C.people, PERSON), {
      fullName: "Persona Ficticia",
      phoneE164: "+56900000001",
      email: null,
      entryDate: "2026-10-04",
      firstVisitAt: "2026-10-04",
      lifecycleStage: "en_consolidacion",
      consolidationStatus: "por_contactar",
      doNotContact: false,
      revision: 1,
      createdAt: at,
      createdBy: "v1-members-manage",
      updatedAt: at,
      updatedBy: "v1-members-manage",
    });
    await setDoc(doc(db, C.visits, "v1"), { personId: PERSON, date: "2026-10-04", createdAt: at, createdBy: "x" });
    await setDoc(doc(db, C.followUps, "f1"), { personId: PERSON, contactDate: "2026-10-04", createdAt: at, createdBy: "x" });
    await setDoc(doc(db, C.changes, "c1"), { personId: PERSON, action: "person_created", at, actorUid: "x" });
  });
});

const ID_OF: Record<string, string> = { [C.people]: PERSON, [C.visits]: "v1", [C.followUps]: "f1", [C.changes]: "c1" };

async function canGet(uid: string, col: string) {
  return allowed(() => getDoc(doc(dbOf(env, uid), col, ID_OF[col])));
}
async function canList(uid: string, col: string) {
  return allowed(() => getDocs(collection(dbOf(env, uid), col)));
}

// Matriz completa de lectura (get y list) por perfil.
const READERS = ["admin", "v1-admin", "v1-members-read", "v1-members-manage"];
const NON_READERS = [
  "pastor", // legacy pastor: el fallback NO otorga Integrantes
  "finance",
  "leader",
  "inactive", // admin legacy inactivo
  "v1-pastor",
  "v1-finance",
  "v1-leader",
  "v1-reader", // solo calendar.read (#6)
  "v1-manager-all",
  "v1-finance-details", // solo finance.details.read (#7)
  "v1-none",
  "v1-inactive",
  "v1-members-inactive", // manage pero inactivo (#8)
];

describe("Integrantes: lectura", () => {
  for (const uid of READERS)
    it(`${uid} lee las 4 colecciones (get y list)`, async () => {
      for (const col of COLLECTIONS) {
        expect(await canGet(uid, col), `${uid} get ${col}`).toBe(true);
        expect(await canList(uid, col), `${uid} list ${col}`).toBe(true);
      }
    });

  for (const uid of NON_READERS)
    it(`${uid} no lee nada de Integrantes (ni get, ni list, ni conteo)`, async () => {
      for (const col of COLLECTIONS) {
        expect(await canGet(uid, col), `${uid} get ${col}`).toBe(false);
        expect(await canList(uid, col), `${uid} list ${col}`).toBe(false);
      }
      await assertFails(getCountFromServer(collection(dbOf(env, uid), C.people)));
      // Ni siquiera si un id existe: un id inventado también se niega.
      await assertFails(getDoc(doc(dbOf(env, uid), C.people, "no-existe")));
    });

  it("anónimo no lee nada", async () => {
    const db = env.unauthenticatedContext().firestore();
    for (const col of COLLECTIONS) {
      await assertFails(getDoc(doc(db, col, ID_OF[col])));
      await assertFails(getDocs(collection(db, col)));
    }
  });

  it("usuario autenticado sin documento users/{uid} no lee", async () => {
    for (const col of COLLECTIONS) {
      expect(await canGet("sin-doc", col)).toBe(false);
      expect(await canList("sin-doc", col)).toBe(false);
    }
  });

  it("las consultas reales de la UI funcionan con read (dashboard y ficha)", async () => {
    const db = dbOf(env, "v1-members-read");
    await assertSucceeds(getDocs(query(collection(db, C.people), orderBy("entryDate", "desc"), limit(1000))));
    await assertSucceeds(getDocs(query(collection(db, C.visits), where("personId", "==", PERSON), orderBy("createdAt", "desc"), limit(200))));
    await assertSucceeds(getDocs(query(collection(db, C.followUps), where("personId", "==", PERSON), orderBy("createdAt", "desc"), limit(200))));
    await assertSucceeds(getDocs(query(collection(db, C.changes), where("personId", "==", PERSON), orderBy("at", "desc"), limit(200))));
  });
});

describe("Integrantes: el cliente nunca escribe (#36)", () => {
  const WRITERS = ["admin", "v1-admin", "v1-members-manage", "v1-members-read", "pastor", "v1-reader"];
  for (const uid of WRITERS)
    it(`${uid}: create, update, set y delete directos se niegan en las 4 colecciones`, async () => {
      const db = dbOf(env, uid);
      for (const col of COLLECTIONS) {
        await assertFails(setDoc(doc(db, col, "nuevo"), { personId: PERSON, createdAt: serverTimestamp(), createdBy: uid }));
        await assertFails(addDoc(collection(db, col), { personId: PERSON }));
        await assertFails(updateDoc(doc(db, col, ID_OF[col]), { personId: PERSON }));
        await assertFails(setDoc(doc(db, col, ID_OF[col]), { personId: PERSON }, { merge: true }));
        await assertFails(deleteDoc(doc(db, col, ID_OF[col])));
      }
    });

  it("un manage no puede cambiar estado, responsable ni doNotContact desde el cliente", async () => {
    const ref = doc(dbOf(env, "v1-members-manage"), C.people, PERSON);
    await assertFails(updateDoc(ref, { consolidationStatus: "integrado" }));
    await assertFails(updateDoc(ref, { followUpOwnerUid: "v1-members-manage" }));
    await assertFails(updateDoc(ref, { doNotContact: true }));
  });
});

describe("Integrantes: otorgar y revocar permisos (Configuración › Usuarios)", () => {
  function v1Doc(actor: string, permissions: string[]) {
    return {
      displayName: "Usuario",
      role: "leader",
      active: true,
      baseRole: "standard",
      position: "Consolidación",
      permissions,
      areaIds: [],
      homeModule: "calendar",
      accessSchemaVersion: 1,
      updatedAt: serverTimestamp(),
      updatedBy: actor,
    };
  }

  it("el admin otorga read y manage, y los revoca", async () => {
    const ref = doc(dbOf(env, "v1-admin"), "users", "v1-reader");
    await assertSucceeds(updateDoc(ref, v1Doc("v1-admin", [P.calRead, P.memRead])));
    await assertSucceeds(updateDoc(ref, v1Doc("v1-admin", [P.calRead, P.memManage])));
    await assertSucceeds(updateDoc(ref, v1Doc("v1-admin", [P.calRead])));
  });

  it("el catálogo guardable completo (10 permisos) es válido; 11 o duplicados no", async () => {
    const ref = doc(dbOf(env, "v1-admin"), "users", "v1-reader");
    const all = [P.summary, P.details, P.records, P.pastoral, P.calRead, P.manageAssigned, P.manageAll, P.publish, P.memRead, P.memManage];
    await assertSucceeds(updateDoc(ref, { ...v1Doc("v1-admin", all), role: "pastor" }));
    await assertFails(updateDoc(ref, { ...v1Doc("v1-admin", [...all, "settings.manage"]), role: "pastor" }));
    await assertFails(updateDoc(ref, v1Doc("v1-admin", [P.memRead, P.memRead])));
    await assertFails(updateDoc(ref, v1Doc("v1-admin", ["members.everything"])));
  });

  it("un usuario con manage no se otorga permisos a sí mismo ni a otros", async () => {
    await assertFails(updateDoc(doc(dbOf(env, "v1-members-manage"), "users", "v1-members-manage"), v1Doc("v1-members-manage", [P.memManage, P.calRead])));
    await assertFails(updateDoc(doc(dbOf(env, "v1-members-manage"), "users", "v1-reader"), v1Doc("v1-members-manage", [P.memRead])));
  });

  it("al revocar, la lectura se pierde de inmediato", async () => {
    expect(await canGet("v1-members-read", C.people)).toBe(true);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", "v1-members-read"), v1User("v1-members-read", { role: "leader", permissions: [] }));
    });
    expect(await canGet("v1-members-read", C.people)).toBe(false);
  });
});

describe("Integrantes: aislamiento de otras colecciones", () => {
  it("nadie con Integrantes obtiene Finanzas ni Calendario por ello", async () => {
    for (const uid of ["v1-members-read", "v1-members-manage"]) {
      await assertFails(getDocs(collection(dbOf(env, uid), "financeTransactions")));
      await assertFails(getDocs(collection(dbOf(env, uid), "calendarEvents")));
      await assertFails(getDocs(collection(dbOf(env, uid), "users")));
      await assertFails(getDocs(collection(dbOf(env, uid), "calendarShareLinks")));
    }
  });

  it("los perfiles del fixture siguen siendo los esperados", () => {
    expect(USERS["v1-members-read"].permissions).toEqual([P.memRead]);
    expect(USERS.pastor.role).toBe("pastor");
  });

  it("las reglas no tienen allow read genérico para members* ni approved()", () => {
    const rules = readFileSync("firestore.rules", "utf8");
    const blocks = [...rules.matchAll(/match \/(members\w+)\/\{\w+\} \{([\s\S]*?)\n    \}/g)];
    expect(blocks.map((b) => b[1]).sort()).toEqual([C.changes, C.followUps, C.people, C.visits].sort());
    for (const [, , body] of blocks) {
      expect(body).toContain("allow get, list: if membersRead();");
      expect(body).toContain("allow create, update, delete: if false;");
      expect(body).not.toMatch(/signedIn\(\)|isActive\(\)|approved\(\)|financeSummaryRead|calendarRead/);
    }
  });
});
