// Reglas de Integrantes › Ve por los tuyos (doc 40 §3–§4). Solo emulador (demo-cds-suite).
// Lectura: permiso explícito members.outreach.* (v1) o admin; el responsable y recepción solo ven lo
// que las reglas les permiten Y las consultas deben llevar los mismos filtros. Escritura del cliente: nunca.
import { assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { allowed, createRulesEnv, dbOf, seedBase, v1User } from "./helpers/platform-fixtures";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createRulesEnv();
});
afterAll(async () => {
  await env?.cleanup();
});

const COORD = "members.outreach.coordinate";
const RECEPTION = "members.outreach.reception";
const FOLLOWUP = "members.outreach.followup_assigned";
const DECISIONS = "members.outreach.decisions";

const OUT_USERS = {
  "out-coord": v1User("out-coord", { role: "leader", permissions: [COORD] }),
  "out-reception": v1User("out-reception", { role: "leader", permissions: [RECEPTION] }),
  "out-a": v1User("out-a", { role: "leader", permissions: [FOLLOWUP] }),
  "out-b": v1User("out-b", { role: "leader", permissions: [FOLLOWUP] }),
  "out-a-inactive": v1User("out-a-inactive", { role: "leader", permissions: [FOLLOWUP], active: false }),
  "out-decisions": v1User("out-decisions", { role: "leader", permissions: [DECISIONS] }),
  "out-only-consolidation": v1User("out-only-consolidation", { role: "leader", permissions: ["members.consolidation.manage"] }),
  "target": v1User("target", { role: "leader", permissions: [] }),
};

const REGS = "outreachRegistrations";
const at = Timestamp.fromDate(new Date("2026-11-28T15:00:00Z"));
const reg = (assigneeUid: string | null, editionActive: boolean, receptionOpen: boolean) => ({
  editionId: "vplt-2026",
  fullName: "Invitado Ficticio",
  phoneE164: "+56900000001",
  assigneeUid,
  editionActive,
  receptionOpen,
  attendance: "sin_confirmar",
  tableNumber: null,
  followUp: { nextActionDate: "2026-11-30" },
});
const REG_IDS = { A: "rA", B: "rB", U: "rU", ARCH: "rArch", IA: "rIA" } as const;
const SUBS = ["contacts", "assignments", "consents", "changes"] as const;

beforeEach(async () => {
  await env.clearFirestore();
  await seedBase(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, data] of Object.entries(OUT_USERS)) await setDoc(doc(db, "users", uid), data);
    await setDoc(doc(db, REGS, REG_IDS.A), reg("out-a", true, false));
    await setDoc(doc(db, REGS, REG_IDS.B), reg("out-b", true, true));
    await setDoc(doc(db, REGS, REG_IDS.U), reg(null, true, false));
    await setDoc(doc(db, REGS, REG_IDS.ARCH), reg("out-a", false, false));
    await setDoc(doc(db, REGS, REG_IDS.IA), reg("out-a-inactive", true, false));
    for (const r of Object.values(REG_IDS))
      for (const s of SUBS) await setDoc(doc(db, REGS, r, s, "x1"), { at, actorUid: "x" });
    await setDoc(doc(db, "outreachEditions", "vplt-2026"), { title: "Ve por los tuyos 2026", state: "inscripcion" });
    await setDoc(doc(db, "outreachEditions", "vplt-2026", "team", "out-a"), { role: "responsable" });
    await setDoc(doc(db, "outreachEditions", "vplt-2026", "tables", "1"), { number: 1, linkActive: true });
    await setDoc(doc(db, "outreachEditions", "vplt-2026", "tableSecrets", "1"), { linkHash: "secreto" });
    await setDoc(doc(db, "outreachDecisions", REG_IDS.A), { value: "decision_ficticia", assigneeUid: "out-a" });
    await setDoc(doc(db, "outreachDecisions", REG_IDS.A, "history", "h1"), { at });
    for (const c of ["outreachIdentities", "outreachInbox", "outreachOutbox", "outreachAssignmentBatches", "outreachTableMarks"])
      await setDoc(doc(db, c, "x1"), { at });
  });
});

const get = (uid: string, ...path: [string, ...string[]]) =>
  allowed(() => getDoc(doc(dbOf(env, uid), path[0], ...path.slice(1))));
const list = (uid: string, ...path: [string, ...string[]]) =>
  allowed(() => getDocs(collection(dbOf(env, uid), path[0], ...path.slice(1))));

// Perfiles (id de usuario sembrado). Los legacy no tienen permisos outreach.
const ALL = [
  "v1-none", "pastor", "finance", "leader", "v1-members-read", "v1-members-manage", "out-only-consolidation",
  "out-coord", "out-reception", "out-a", "out-b", "out-a-inactive", "out-decisions", "v1-admin", "admin", "inactive",
];
const only = (...who: string[]) => Object.fromEntries(ALL.map((u) => [u, who.includes(u)]));
const ADMINS = ["v1-admin", "admin"];

describe("inscripciones: get por perfil", () => {
  const cases: [string, string, string[]][] = [
    ["de A", REG_IDS.A, ["out-coord", "out-a", ...ADMINS]],
    ["de B (receptionOpen)", REG_IDS.B, ["out-coord", "out-reception", "out-b", ...ADMINS]],
    ["sin asignar", REG_IDS.U, ["out-coord", ...ADMINS]],
    ["de edición archivada (editionActive false)", REG_IDS.ARCH, ["out-coord", ...ADMINS]],
    ["de A inactivo", REG_IDS.IA, ["out-coord", ...ADMINS]],
  ];
  for (const [name, id, who] of cases)
    it(`get ${name}`, async () => {
      const expected = only(...who);
      for (const uid of ALL) expect(await get(uid, REGS, id), `${uid} get ${name}`).toBe(expected[uid]);
    });

  it("anónimo no lee nada", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, REGS, REG_IDS.A)));
    await assertFails(getDocs(collection(db, REGS)));
  });
});

describe("inscripciones: list exige los filtros que prueban la regla", () => {
  const q = (uid: string, ...c: ReturnType<typeof where>[]) =>
    allowed(() => getDocs(query(collection(dbOf(env, uid), REGS), ...c)));

  it("coordinación y admin listan todo, sin filtros", async () => {
    for (const uid of ["out-coord", ...ADMINS]) expect(await q(uid)).toBe(true);
  });
  it("responsable: con assigneeUid == yo y editionActive == true permite; sin filtros o incompleto, no", async () => {
    const mine = [where("assigneeUid", "==", "out-a"), where("editionActive", "==", true)];
    expect(await q("out-a", ...mine)).toBe(true);
    expect(await q("out-a")).toBe(false);
    expect(await q("out-a", where("assigneeUid", "==", "out-a"))).toBe(false);
    expect(await q("out-a", where("editionActive", "==", true))).toBe(false);
    expect(await q("out-a", where("assigneeUid", "==", "out-a"), where("editionActive", "==", false))).toBe(false);
    // adivinar B: consultar con el uid de B
    expect(await q("out-a", where("assigneeUid", "==", "out-b"), where("editionActive", "==", true))).toBe(false);
    expect(await get("out-a", REGS, REG_IDS.B)).toBe(false);
    // inactivo con los filtros correctos: negado
    expect(await q("out-a-inactive", where("assigneeUid", "==", "out-a-inactive"), where("editionActive", "==", true))).toBe(false);
    // el resultado trae solo las suyas
    const snap = await getDocs(query(collection(dbOf(env, "out-a"), REGS), ...mine));
    expect(snap.docs.map((d) => d.id)).toEqual([REG_IDS.A]);
  });
  it("recepción: solo con receptionOpen == true; sin filtro, no", async () => {
    expect(await q("out-reception", where("receptionOpen", "==", true))).toBe(true);
    expect(await q("out-reception")).toBe(false);
    expect(await q("out-reception", where("receptionOpen", "==", false))).toBe(false);
    expect(await q("out-reception", where("assigneeUid", "==", "out-a"))).toBe(false);
  });
  it("sin permiso, consolidación, decisiones o legacy: ninguna consulta", async () => {
    for (const uid of ["v1-none", "pastor", "finance", "leader", "v1-members-read", "v1-members-manage", "out-only-consolidation", "out-decisions", "inactive"]) {
      expect(await q(uid), uid).toBe(false);
      expect(await q(uid, where("receptionOpen", "==", true)), uid).toBe(false);
      expect(await q(uid, where("assigneeUid", "==", uid), where("editionActive", "==", true)), uid).toBe(false);
    }
  });
  it("collection group de subcolecciones sin regla de grupo: denegado", async () => {
    await assertFails(getDocs(collectionGroup(dbOf(env, "out-coord"), "contacts")));
    await assertFails(getDocs(collectionGroup(dbOf(env, "out-a"), "contacts")));
  });
});

describe("subcolecciones de la inscripción", () => {
  for (const sub of ["contacts", "assignments", "consents"] as const)
    it(`${sub}: coordinación y admin siempre; responsable solo en lo suyo con edición activa`, async () => {
      const cases: [string, string[]][] = [
        [REG_IDS.A, ["out-coord", "out-a", ...ADMINS]],
        [REG_IDS.B, ["out-coord", "out-b", ...ADMINS]],
        [REG_IDS.U, ["out-coord", ...ADMINS]],
        [REG_IDS.ARCH, ["out-coord", ...ADMINS]],
        [REG_IDS.IA, ["out-coord", ...ADMINS]],
      ];
      for (const [id, who] of cases) {
        const expected = only(...who);
        for (const uid of ALL) {
          expect(await get(uid, REGS, id, sub, "x1"), `${uid} get ${id}/${sub}`).toBe(expected[uid]);
          expect(await list(uid, REGS, id, sub), `${uid} list ${id}/${sub}`).toBe(expected[uid]);
        }
      }
    });
  it("changes: solo coordinación y admin (ni el responsable de la inscripción)", async () => {
    const expected = only("out-coord", ...ADMINS);
    for (const id of [REG_IDS.A, REG_IDS.B])
      for (const uid of ALL) {
        expect(await get(uid, REGS, id, "changes", "x1"), `${uid} ${id}`).toBe(expected[uid]);
        expect(await list(uid, REGS, id, "changes"), `${uid} ${id}`).toBe(expected[uid]);
      }
  });
  it("recepción no lee ninguna subcolección", async () => {
    for (const s of SUBS) expect(await get("out-reception", REGS, REG_IDS.B, s, "x1")).toBe(false);
  });
});

describe("decisiones", () => {
  it("solo members.outreach.decisions o admin (coordinación y responsable NO)", async () => {
    const expected = only("out-decisions", ...ADMINS);
    for (const uid of ALL) {
      expect(await get(uid, "outreachDecisions", REG_IDS.A), `${uid} get`).toBe(expected[uid]);
      expect(await list(uid, "outreachDecisions"), `${uid} list`).toBe(expected[uid]);
      expect(await get(uid, "outreachDecisions", REG_IDS.A, "history", "h1"), `${uid} history`).toBe(expected[uid]);
      expect(await list(uid, "outreachDecisions", REG_IDS.A, "history"), `${uid} history list`).toBe(expected[uid]);
    }
  });
});

describe("otras colecciones", () => {
  it("identidades, bandeja de salida, lotes y marcas de mesa: coordinación y admin", async () => {
    const expected = only("out-coord", ...ADMINS);
    for (const c of ["outreachIdentities", "outreachOutbox", "outreachAssignmentBatches", "outreachTableMarks"])
      for (const uid of ALL) {
        expect(await get(uid, c, "x1"), `${uid} get ${c}`).toBe(expected[uid]);
        expect(await list(uid, c), `${uid} list ${c}`).toBe(expected[uid]);
      }
  });
  it("inbox (PII cruda) y tableSecrets: nadie desde el cliente, ni admin", async () => {
    for (const uid of ALL) {
      expect(await get(uid, "outreachInbox", "x1"), `${uid} inbox`).toBe(false);
      expect(await list(uid, "outreachInbox"), `${uid} inbox list`).toBe(false);
      expect(await get(uid, "outreachEditions", "vplt-2026", "tableSecrets", "1"), `${uid} secrets`).toBe(false);
      expect(await list(uid, "outreachEditions", "vplt-2026", "tableSecrets"), `${uid} secrets list`).toBe(false);
    }
  });
  it("ediciones, equipo y mesas: cualquier permiso outreach o admin; consolidación no", async () => {
    const expected = only("out-coord", "out-reception", "out-a", "out-b", "out-decisions", ...ADMINS);
    for (const uid of ALL) {
      expect(await get(uid, "outreachEditions", "vplt-2026"), `${uid} edición`).toBe(expected[uid]);
      expect(await list(uid, "outreachEditions"), `${uid} ediciones`).toBe(expected[uid]);
      expect(await get(uid, "outreachEditions", "vplt-2026", "team", "out-a"), `${uid} team`).toBe(expected[uid]);
      expect(await get(uid, "outreachEditions", "vplt-2026", "tables", "1"), `${uid} mesa`).toBe(expected[uid]);
      expect(await list(uid, "outreachEditions", "vplt-2026", "tables"), `${uid} mesas`).toBe(expected[uid]);
    }
  });
});

describe("aislamiento con Consolidación y escrituras", () => {
  it("perfiles outreach no leen members*; consolidation.read no da nada de outreach", async () => {
    for (const uid of ["out-coord", "out-reception", "out-a", "out-decisions"])
      for (const c of ["membersPeople", "membersVisits", "membersFollowUps", "membersPersonChanges"]) {
        expect(await list(uid, c), `${uid} ${c}`).toBe(false);
        expect(await get(uid, c, "p1"), `${uid} ${c} get`).toBe(false);
      }
    for (const uid of ["v1-members-read", "v1-members-manage", "out-only-consolidation"]) {
      expect(await list(uid, "outreachEditions")).toBe(false);
      expect(await list(uid, "outreachDecisions")).toBe(false);
      expect(await get(uid, REGS, REG_IDS.A)).toBe(false);
    }
  });

  const WRITE_TARGETS: [string, ...string[]][] = [
    ["outreachEditions", "vplt-2026"],
    ["outreachEditions", "vplt-2026", "team", "out-a"],
    ["outreachEditions", "vplt-2026", "tables", "1"],
    ["outreachEditions", "vplt-2026", "tableSecrets", "1"],
    [REGS, REG_IDS.A],
    [REGS, REG_IDS.A, "contacts", "x1"],
    [REGS, REG_IDS.A, "assignments", "x1"],
    [REGS, REG_IDS.A, "consents", "x1"],
    [REGS, REG_IDS.A, "changes", "x1"],
    ["outreachDecisions", REG_IDS.A],
    ["outreachDecisions", REG_IDS.A, "history", "h1"],
    ["outreachIdentities", "x1"],
    ["outreachInbox", "x1"],
    ["outreachOutbox", "x1"],
    ["outreachAssignmentBatches", "x1"],
    ["outreachTableMarks", "x1"],
  ];
  it("ningún perfil (ni admin) escribe nada: create, update ni delete, existente o nuevo", async () => {
    for (const uid of ALL) {
      const db = dbOf(env, uid);
      for (const path of WRITE_TARGETS) {
        const ref = doc(db, path[0], ...path.slice(1));
        await assertFails(setDoc(ref, { hack: true }));
        await assertFails(updateDoc(ref, { hack: true }));
        await assertFails(deleteDoc(ref));
        await assertFails(setDoc(doc(db, path[0], ...path.slice(1, -1), "nuevo"), { hack: true }));
      }
      await assertFails(addDoc(collection(db, REGS), { hack: true }));
    }
  });
});

describe("users: catálogo de 14 permisos guardables", () => {
  const CATALOG = [
    "finance.summary.read", "finance.details.read", "finance.records.manage", "finance.pastoral.manage",
    "calendar.read", "calendar.events.manage_assigned", "calendar.events.manage_all", "calendar.events.publish_assigned",
    "members.consolidation.read", "members.consolidation.manage",
    COORD, RECEPTION, FOLLOWUP, DECISIONS,
  ];
  const write = (permissions: string[], role = "pastor") =>
    allowed(() =>
      setDoc(doc(dbOf(env, "v1-admin"), "users", "target"), {
        displayName: "target",
        email: "target@cds.test",
        role,
        active: true,
        createdAt: OUT_USERS.target.createdAt,
        baseRole: "standard",
        position: "",
        permissions,
        areaIds: [],
        homeModule: "finance",
        accessSchemaVersion: 1,
        updatedAt: serverTimestamp(),
        updatedBy: "v1-admin",
      }),
    );
  it("14 permisos (catálogo completo guardable) permitido", async () => {
    expect(CATALOG).toHaveLength(14);
    expect(await write(CATALOG)).toBe(true);
  });
  it("permisos outreach sueltos permitidos (rol legacy derivado: leader)", async () => {
    expect(await write([FOLLOWUP], "leader")).toBe(true);
    expect(await write([COORD, DECISIONS], "leader")).toBe(true);
  });
  it("15 denegado (duplicado), settings.manage y desconocidos denegados", async () => {
    expect(await write([...CATALOG, CATALOG[0]])).toBe(false);
    expect(await write([...CATALOG, "settings.manage"])).toBe(false);
    expect(await write(["members.outreach.admin"], "leader")).toBe(false);
    expect(await write([FOLLOWUP, "inventado.permiso"], "leader")).toBe(false);
  });
  it("un no admin no puede darse permisos outreach", async () => {
    await assertFails(
      updateDoc(doc(dbOf(env, "out-a"), "users", "out-a"), { permissions: [FOLLOWUP, COORD] }),
    );
  });
});
