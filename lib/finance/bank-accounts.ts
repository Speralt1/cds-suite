// Escrituras de Banco y caja (doc 30). Cada operación es explícita, auditada y
// validada también por firestore.rules; nada se escribe automáticamente.
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import {
  validateBankAccountInput,
  validateReconciliationInput,
  validateTreasuryInput,
  type BankAccountInput,
  type ReconciliationInput,
  type TreasuryDirection,
  type TreasuryInput,
  type TreasuryType,
  type Ymd,
} from "./bank-model";

export interface BankAccountDoc extends BankAccountInput {
  id: string;
  revision: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
}

export interface BankAccountHistoryDoc extends BankAccountInput {
  id: string;
  revision: number;
  action: "created" | "updated";
  reason: string;
  actorUid: string;
  at: Timestamp;
}

export interface TreasuryTransferDoc {
  id: string;
  accountId: string;
  type: TreasuryType;
  direction: TreasuryDirection;
  amount: number;
  date: Ymd;
  note: string;
  reason: string;
  status: "active" | "voided";
  revision: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
  voidedBy?: string;
  voidedAt?: Timestamp;
  voidReason?: string;
}

export interface BankReconciliationDoc extends ReconciliationInput {
  id: string;
  difference: number;
  createdBy: string;
  createdAt: Timestamp;
}

/**
 * Crea o actualiza el saldo inicial. `expectedRevision` = revisión que la persona
 * vio (0 si la cuenta no existía): si cambió entretanto, se rechaza.
 */
export async function saveBankAccount(
  db: Firestore,
  uid: string,
  accountId: string,
  input: BankAccountInput,
  opts: { expectedRevision: number; reason: string; today: Ymd },
) {
  const isUpdate = opts.expectedRevision > 0;
  const problem = validateBankAccountInput(input, { today: opts.today, reason: opts.reason, isUpdate });
  if (problem) throw new Error(problem);
  const ref = doc(db, "bankAccounts", accountId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? (snap.data() as Omit<BankAccountDoc, "id">) : null;
    if ((current?.revision ?? 0) !== opts.expectedRevision)
      throw new Error("El saldo inicial cambió mientras lo editabas. Cierra el formulario y vuelve a abrirlo.");
    const revision = opts.expectedRevision + 1;
    const stamp = serverTimestamp();
    const data = {
      name: input.name.trim(),
      openingBalance: input.openingBalance,
      openingDate: input.openingDate,
      openingCash: input.openingCash,
      statementReference: input.statementReference.trim(),
    };
    tx.set(ref, {
      ...data,
      revision,
      createdBy: current?.createdBy ?? uid,
      createdAt: current?.createdAt ?? stamp,
      updatedBy: uid,
      updatedAt: stamp,
    });
    tx.set(doc(db, "bankAccounts", accountId, "history", String(revision)), {
      ...data,
      revision,
      action: revision === 1 ? "created" : "updated",
      reason: opts.reason.trim(),
      actorUid: uid,
      at: stamp,
    });
    return revision;
  });
}

export async function createTreasuryTransfer(
  db: Firestore,
  uid: string,
  input: TreasuryInput,
  opts: { today: Ymd; openingDate: Ymd | null },
) {
  const problem = validateTreasuryInput(input, opts);
  if (problem) throw new Error(problem);
  const ref = doc(collection(db, "treasuryTransfers"));
  const stamp = serverTimestamp();
  await setDoc(ref, {
    accountId: input.accountId,
    type: input.type,
    direction: input.direction,
    amount: input.amount,
    date: input.date,
    note: input.note.trim(),
    reason: input.reason.trim(),
    status: "active",
    revision: 1,
    createdBy: uid,
    createdAt: stamp,
    updatedBy: uid,
    updatedAt: stamp,
  });
  return ref.id;
}

export async function voidTreasuryTransfer(db: Firestore, uid: string, transfer: TreasuryTransferDoc, reason: string) {
  const text = reason.trim();
  if (text.length < 3 || text.length > 300) throw new Error("Escribe un motivo de anulación de 3 a 300 caracteres.");
  const ref = doc(db, "treasuryTransfers", transfer.id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.data() as TreasuryTransferDoc | undefined;
    if (!current || current.status !== "active" || current.revision !== transfer.revision)
      throw new Error("El movimiento cambió o ya fue anulado. Vuelve a abrir la lista.");
    const stamp = serverTimestamp();
    tx.update(ref, {
      status: "voided",
      revision: current.revision + 1,
      updatedBy: uid,
      updatedAt: stamp,
      voidedBy: uid,
      voidedAt: stamp,
      voidReason: text,
    });
  });
}

export async function createReconciliation(
  db: Firestore,
  uid: string,
  input: ReconciliationInput,
  opts: { today: Ymd; openingDate: Ymd | null },
) {
  const problem = validateReconciliationInput(input, opts);
  if (problem) throw new Error(problem);
  const ref = doc(collection(db, "bankReconciliations"));
  await setDoc(ref, {
    accountId: input.accountId,
    date: input.date,
    reportedBalance: input.reportedBalance,
    expectedBalance: input.expectedBalance,
    difference: input.reportedBalance - input.expectedBalance,
    estimateComplete: input.estimateComplete,
    openingRevision: input.openingRevision,
    note: input.note.trim(),
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
