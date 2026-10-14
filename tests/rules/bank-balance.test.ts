// Reglas de Banco y caja (doc 30): bankAccounts (+ historial inmutable),
// treasuryTransfers y bankReconciliations. Solo emulador, datos ficticios.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
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
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createReconciliation,
  createTreasuryTransfer,
  saveBankAccount,
  voidTreasuryTransfer,
  type TreasuryTransferDoc,
} from "../../lib/finance/bank-accounts";
import type { BankAccountInput, TreasuryInput } from "../../lib/finance/bank-model";
import { addDays, allowed, createRulesEnv, dbOf, P, seedBase, TODAY, USERS, v1User } from "./helpers/platform-fixtures";

let env: RulesTestEnvironment;

const EXTRA: Record<string, DocumentData> = {
  "v1-details": v1User("v1-details", { role: "leader", permissions: [P.summary, P.details] }),
  "v1-records": v1User("v1-records", { role: "finance", permissions: [P.records] }),
};
const CUTOFF = addDays(TODAY, -10);
const ACCOUNT: BankAccountInput = {
  name: "Cuenta corriente principal",
  openingBalance: 1_250_000,
  openingDate: CUTOFF,
  openingCash: null,
  statementReference: "Cartola N° 123",
};
const SEED_TS = Timestamp.fromDate(new Date("2026-09-01T12:00:00Z"));

function seededAccount(o: DocumentData = {}) {
  return {
    ...ACCOUNT,
    revision: 1,
    createdBy: "admin",
    createdAt: SEED_TS,
    updatedBy: "admin",
    updatedAt: SEED_TS,
    ...o,
  };
}
function transferInput(o: Partial<TreasuryInput> = {}): TreasuryInput {
  return {
    accountId: "main",
    type: "cash_deposit",
    direction: "in",
    amount: 50_000,
    date: addDays(TODAY, -2),
    note: "",
    reason: "",
    ...o,
  };
}
function rawTransfer(uid: string, o: DocumentData = {}) {
  return {
    ...transferInput(),
    status: "active",
    revision: 1,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    ...o,
  };
}
function rawReconciliation(uid: string, o: DocumentData = {}) {
  return {
    accountId: "main",
    date: TODAY,
    reportedBalance: 1_000_000,
    expectedBalance: 1_010_000,
    difference: -10_000,
    estimateComplete: false,
    openingRevision: 1,
    note: "",
    createdBy: uid,
    createdAt: serverTimestamp(),
    ...o,
  };
}
const opts = { today: TODAY, openingDate: CUTOFF };

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
    for (const [uid, data] of Object.entries(EXTRA)) await setDoc(doc(db, "users", uid), data);
  });
});

async function seedAccount(o: DocumentData = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "bankAccounts", "main"), seededAccount(o));
    await setDoc(doc(ctx.firestore(), "bankAccounts", "main", "history", "1"), {
      ...ACCOUNT,
      revision: 1,
      action: "created",
      reason: "",
      actorUid: "admin",
      at: SEED_TS,
    });
  });
}
async function seedTransfer(id: string, o: DocumentData = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "treasuryTransfers", id), {
      ...rawTransfer("finance"),
      createdAt: SEED_TS,
      updatedAt: SEED_TS,
      ...o,
    });
  });
}
async function readAs<T = DocumentData>(path: string): Promise<T | undefined> {
  let out: T | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = (await getDoc(doc(ctx.firestore(), path))).data() as T | undefined;
  });
  return out;
}

const READERS = ["admin", "pastor", "finance", "v1-admin", "v1-pastor", "v1-finance", "v1-details", "v1-records"];
const NON_READERS = ["leader", "inactive", "v1-leader", "v1-none", "v1-inactive", "v1-reader", "ghost"];
const SETTINGS = ["admin", "v1-admin"];
const NOT_SETTINGS = ["pastor", "finance", "v1-pastor", "v1-finance", "v1-records", "v1-details", "leader", "inactive", "v1-inactive", "ghost"];
const RECORDS = ["admin", "pastor", "finance", "v1-admin", "v1-pastor", "v1-finance", "v1-records"];
const NOT_RECORDS = ["leader", "inactive", "v1-leader", "v1-details", "v1-none", "v1-inactive", "ghost"];

describe("bankAccounts: lectura", () => {
  beforeEach(() => seedAccount());
  it.each(READERS)("%s puede leer la cuenta, su historial, tesorería y conciliaciones", async (uid) => {
    const db = dbOf(env, uid);
    expect(await allowed(() => getDoc(doc(db, "bankAccounts", "main")))).toBe(true);
    expect(await allowed(() => getDocs(collection(db, "bankAccounts", "main", "history")))).toBe(true);
    expect(await allowed(() => getDocs(collection(db, "treasuryTransfers")))).toBe(true);
    expect(await allowed(() => getDocs(collection(db, "bankReconciliations")))).toBe(true);
  });
  it.each(NON_READERS)("%s no puede leer nada de banco y caja", async (uid) => {
    const db = dbOf(env, uid);
    expect(await allowed(() => getDoc(doc(db, "bankAccounts", "main")))).toBe(false);
    expect(await allowed(() => getDocs(collection(db, "bankAccounts", "main", "history")))).toBe(false);
    expect(await allowed(() => getDocs(collection(db, "treasuryTransfers")))).toBe(false);
    expect(await allowed(() => getDocs(collection(db, "bankReconciliations")))).toBe(false);
  });
  it("anónimo no puede leer", async () => {
    const db = env.unauthenticatedContext().firestore() as unknown as Firestore;
    expect(await allowed(() => getDoc(doc(db, "bankAccounts", "main")))).toBe(false);
    expect(await allowed(() => getDocs(collection(db, "treasuryTransfers")))).toBe(false);
  });
});

describe("bankAccounts: saldo inicial (solo administración) con historial en el mismo lote", () => {
  it.each(SETTINGS)("%s crea el saldo inicial y su historial r1", async (uid) => {
    const db = dbOf(env, uid);
    await expect(saveBankAccount(db, uid, "main", ACCOUNT, { expectedRevision: 0, reason: "", today: TODAY })).resolves.toBe(1);
    const a = await readAs("bankAccounts/main");
    const h = await readAs("bankAccounts/main/history/1");
    expect(a).toMatchObject({ openingBalance: 1_250_000, openingDate: CUTOFF, revision: 1, createdBy: uid });
    expect(h).toMatchObject({ action: "created", revision: 1, openingBalance: 1_250_000, actorUid: uid });
  });
  it.each(NOT_SETTINGS)("%s no puede crear el saldo inicial", async (uid) => {
    const db = dbOf(env, uid);
    expect(await allowed(() => saveBankAccount(db, uid, "main", ACCOUNT, { expectedRevision: 0, reason: "", today: TODAY }))).toBe(false);
  });
  it("anónimo no puede crear", async () => {
    const db = env.unauthenticatedContext().firestore() as unknown as Firestore;
    expect(await allowed(() => saveBankAccount(db, "anon", "main", ACCOUNT, { expectedRevision: 0, reason: "", today: TODAY }))).toBe(false);
  });
  it("actualiza con motivo, revisión +1, historial r2 y auditoría inmutable", async () => {
    await seedAccount();
    const db = dbOf(env, "admin");
    await saveBankAccount(db, "admin", "main", { ...ACCOUNT, openingBalance: -20_000, openingCash: 35_000 }, {
      expectedRevision: 1,
      reason: "Cartola corregida por el banco",
      today: TODAY,
    });
    const a = await readAs("bankAccounts/main");
    expect(a).toMatchObject({ openingBalance: -20_000, openingCash: 35_000, revision: 2, createdAt: SEED_TS });
    expect(await readAs("bankAccounts/main/history/2")).toMatchObject({ action: "updated", reason: "Cartola corregida por el banco" });
    expect(await readAs("bankAccounts/main/history/1")).toMatchObject({ revision: 1 });
  });
  it("la cuenta sin historial en el mismo lote se rechaza (crear y actualizar)", async () => {
    const db = dbOf(env, "admin");
    const raw = { ...ACCOUNT, revision: 1, createdBy: "admin", createdAt: serverTimestamp(), updatedBy: "admin", updatedAt: serverTimestamp() };
    expect(await allowed(() => setDoc(doc(db, "bankAccounts", "main"), raw))).toBe(false);
    await seedAccount();
    expect(await allowed(() => updateDoc(doc(db, "bankAccounts", "main"), { openingBalance: 1, revision: 2, updatedBy: "admin", updatedAt: serverTimestamp() }))).toBe(false);
  });
  it("el historial suelto, distinto de la cuenta o con revisión que ya existe se rechaza", async () => {
    await seedAccount();
    const db = dbOf(env, "admin");
    const hist = { ...ACCOUNT, revision: 2, action: "updated", reason: "Motivo válido", actorUid: "admin", at: serverTimestamp() };
    expect(await allowed(() => setDoc(doc(db, "bankAccounts", "main", "history", "2"), hist))).toBe(false);
    // Lote con historial que no coincide con la cuenta.
    const batch = writeBatch(db);
    batch.update(doc(db, "bankAccounts", "main"), { openingBalance: 5, revision: 2, updatedBy: "admin", updatedAt: serverTimestamp() });
    batch.set(doc(db, "bankAccounts", "main", "history", "2"), { ...hist, openingBalance: 6 });
    expect(await allowed(() => batch.commit())).toBe(false);
    // Lote que reutiliza la revisión 1 (historial ya existe).
    const b2 = writeBatch(db);
    b2.update(doc(db, "bankAccounts", "main"), { openingBalance: 5, updatedBy: "admin", updatedAt: serverTimestamp() });
    b2.set(doc(db, "bankAccounts", "main", "history", "1"), { ...hist, revision: 1, action: "created", openingBalance: 5 });
    expect(await allowed(() => b2.commit())).toBe(false);
  });
  it("actualizar sin motivo se rechaza en reglas (historial r≥2 exige 3+ caracteres)", async () => {
    await seedAccount();
    const db = dbOf(env, "admin");
    const batch = writeBatch(db);
    batch.update(doc(db, "bankAccounts", "main"), { openingBalance: 5, revision: 2, updatedBy: "admin", updatedAt: serverTimestamp() });
    batch.set(doc(db, "bankAccounts", "main", "history", "2"), { ...ACCOUNT, openingBalance: 5, revision: 2, action: "updated", reason: "", actorUid: "admin", at: serverTimestamp() });
    expect(await allowed(() => batch.commit())).toBe(false);
  });
  it("revisión desactualizada: el cliente la rechaza", async () => {
    await seedAccount({ revision: 3 });
    await expect(
      saveBankAccount(dbOf(env, "admin"), "admin", "main", ACCOUNT, { expectedRevision: 1, reason: "Corrección", today: TODAY }),
    ).rejects.toThrow(/cambió/);
  });
  it.each([
    ["fecha de corte futura", { openingDate: addDays(TODAY, 3) }],
    ["fecha anterior a 2020", { openingDate: "2019-12-31" }],
    ["fecha mal formada", { openingDate: "2026-9-1" }],
    ["monto decimal", { openingBalance: 10.5 }],
    ["monto fuera de rango", { openingBalance: 1_000_000_000_001 }],
    ["efectivo inicial negativo", { openingCash: -1 }],
    ["clave extra", { extra: true }],
    ["nombre vacío", { name: "" }],
  ])("datos inválidos: %s", async (_label, patch) => {
    const db = dbOf(env, "admin");
    const batch = writeBatch(db);
    const data = { ...ACCOUNT, ...patch };
    batch.set(doc(db, "bankAccounts", "main"), { ...data, revision: 1, createdBy: "admin", createdAt: serverTimestamp(), updatedBy: "admin", updatedAt: serverTimestamp() });
    const { extra: _e, ...histData } = data as DocumentData;
    void _e;
    batch.set(doc(db, "bankAccounts", "main", "history", "1"), { ...histData, revision: 1, action: "created", reason: "", actorUid: "admin", at: serverTimestamp() });
    expect(await allowed(() => batch.commit())).toBe(false);
  });
  it("id de cuenta inválido se rechaza", async () => {
    expect(await allowed(() => saveBankAccount(dbOf(env, "admin"), "admin", "Main Cuenta", ACCOUNT, { expectedRevision: 0, reason: "", today: TODAY }))).toBe(false);
  });
  it("nadie borra cuentas ni edita/borra historial", async () => {
    await seedAccount();
    const db = dbOf(env, "admin");
    expect(await allowed(() => deleteDoc(doc(db, "bankAccounts", "main")))).toBe(false);
    expect(await allowed(() => deleteDoc(doc(db, "bankAccounts", "main", "history", "1")))).toBe(false);
    expect(await allowed(() => updateDoc(doc(db, "bankAccounts", "main", "history", "1"), { reason: "cambiado" }))).toBe(false);
  });
});

describe("treasuryTransfers", () => {
  beforeEach(() => seedAccount());
  it.each(RECORDS)("%s registra un depósito de caja", async (uid) => {
    const id = await createTreasuryTransfer(dbOf(env, uid), uid, transferInput(), opts);
    expect(await readAs(`treasuryTransfers/${id}`)).toMatchObject({ type: "cash_deposit", direction: "in", status: "active", revision: 1, createdBy: uid });
  });
  it.each(NOT_RECORDS)("%s no puede registrar", async (uid) => {
    expect(await allowed(() => createTreasuryTransfer(dbOf(env, uid), uid, transferInput(), opts))).toBe(false);
  });
  it("registra los cinco tipos válidos", async () => {
    const db = dbOf(env, "finance");
    for (const t of [
      transferInput({ type: "cash_withdrawal", direction: "out" }),
      transferInput({ type: "outgoing_transfer", direction: "out" }),
      transferInput({ type: "other_deposit", direction: "in" }),
      transferInput({ type: "adjustment", direction: "out", reason: "Comisión mantención de cuenta" }),
      transferInput({ type: "adjustment", direction: "in", reason: "Intereses abonados por el banco" }),
    ])
      expect(await allowed(() => createTreasuryTransfer(db, "finance", t, opts))).toBe(true);
  });
  it.each([
    ["sentido incoherente", { direction: "out" }],
    ["ajuste con motivo corto", { type: "adjustment", direction: "in", reason: "corto" }],
    ["monto cero", { amount: 0 }],
    ["monto decimal", { amount: 10.5 }],
    ["fecha del corte", { date: CUTOFF }],
    ["fecha futura", { date: addDays(TODAY, 3) }],
    ["cuenta inexistente", { accountId: "otra" }],
    ["tipo desconocido", { type: "income" }],
    ["estado anulado al crear", { status: "voided" }],
    ["revisión distinta de 1", { revision: 2 }],
    ["auditoría ajena", { createdBy: "otro" }],
    ["clave extra", { category: "Ofrendas" }],
  ])("rechaza: %s", async (_label, patch) => {
    const db = dbOf(env, "finance");
    expect(await allowed(() => setDoc(doc(collection(db, "treasuryTransfers")), rawTransfer("finance", patch)))).toBe(false);
  });
  it("solo se anula con motivo; no se edita, no se reactiva ni se borra", async () => {
    await seedTransfer("t1");
    const db = dbOf(env, "finance");
    const t = { id: "t1", ...(await readAs<TreasuryTransferDoc>("treasuryTransfers/t1")) } as TreasuryTransferDoc;
    expect(await allowed(() => updateDoc(doc(db, "treasuryTransfers", "t1"), { amount: 1, revision: 2, updatedBy: "finance", updatedAt: serverTimestamp() }))).toBe(false);
    expect(await allowed(() => updateDoc(doc(db, "treasuryTransfers", "t1"), {
      status: "voided", revision: 2, updatedBy: "finance", updatedAt: serverTimestamp(), voidedBy: "finance", voidedAt: serverTimestamp(), voidReason: "",
    }))).toBe(false);
    await voidTreasuryTransfer(db, "finance", t, "Depósito duplicado");
    expect(await readAs("treasuryTransfers/t1")).toMatchObject({ status: "voided", revision: 2, voidReason: "Depósito duplicado", voidedBy: "finance" });
    expect(await allowed(() => updateDoc(doc(db, "treasuryTransfers", "t1"), { status: "active", revision: 3, updatedBy: "finance", updatedAt: serverTimestamp() }))).toBe(false);
    expect(await allowed(() => deleteDoc(doc(db, "treasuryTransfers", "t1")))).toBe(false);
  });
  it.each(NOT_RECORDS.filter((u) => u !== "ghost"))("%s no puede anular", async (uid) => {
    await seedTransfer("t2");
    const db = dbOf(env, uid);
    expect(await allowed(() => updateDoc(doc(db, "treasuryTransfers", "t2"), {
      status: "voided", revision: 2, updatedBy: uid, updatedAt: serverTimestamp(), voidedBy: uid, voidedAt: serverTimestamp(), voidReason: "Duplicado",
    }))).toBe(false);
  });
  it("sin saldo inicial configurado no se registra tesorería", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => deleteDoc(doc(ctx.firestore(), "bankAccounts", "main")));
    expect(await allowed(() => setDoc(doc(collection(dbOf(env, "admin"), "treasuryTransfers")), rawTransfer("admin")))).toBe(false);
  });
});

describe("bankReconciliations (solo creación, nunca ajusta)", () => {
  beforeEach(() => seedAccount());
  it.each(RECORDS)("%s registra una conciliación", async (uid) => {
    const id = await createReconciliation(dbOf(env, uid), uid, {
      accountId: "main", date: TODAY, reportedBalance: 1_000_000, expectedBalance: 1_010_000, estimateComplete: false, openingRevision: 1, note: "",
    }, opts);
    expect(await readAs(`bankReconciliations/${id}`)).toMatchObject({ difference: -10_000, createdBy: uid });
  });
  it.each(NOT_RECORDS)("%s no puede conciliar", async (uid) => {
    expect(await allowed(() => setDoc(doc(collection(dbOf(env, uid), "bankReconciliations")), rawReconciliation(uid)))).toBe(false);
  });
  it.each([
    ["diferencia mal calculada", { difference: 0 }],
    ["fecha anterior al corte", { date: addDays(CUTOFF, -1) }],
    ["fecha futura", { date: addDays(TODAY, 3) }],
    ["cuenta inexistente", { accountId: "otra" }],
    ["saldo decimal", { reportedBalance: 1.5, difference: 1.5 - 1_010_000 }],
    ["clave extra", { adjustmentId: "x" }],
  ])("rechaza: %s", async (_label, patch) => {
    expect(await allowed(() => setDoc(doc(collection(dbOf(env, "finance"), "bankReconciliations")), rawReconciliation("finance", patch)))).toBe(false);
  });
  it("no se edita ni se borra", async () => {
    const db = dbOf(env, "admin");
    const ref = doc(collection(db, "bankReconciliations"));
    await setDoc(ref, rawReconciliation("admin"));
    expect(await allowed(() => updateDoc(ref, { note: "otra" }))).toBe(false);
    expect(await allowed(() => deleteDoc(ref))).toBe(false);
  });
  it("conciliar no crea ajustes ni movimientos", async () => {
    await createReconciliation(dbOf(env, "finance"), "finance", {
      accountId: "main", date: TODAY, reportedBalance: 1, expectedBalance: 2, estimateComplete: true, openingRevision: 1, note: "",
    }, opts);
    let n = -1;
    await env.withSecurityRulesDisabled(async (ctx) => {
      n = (await getDocs(collection(ctx.firestore(), "treasuryTransfers"))).size;
    });
    expect(n).toBe(0);
  });
});

it("los perfiles del test existen (sanity)", () => {
  expect(Object.keys(USERS)).toEqual(expect.arrayContaining(["admin", "v1-admin", "v1-inactive"]));
});
