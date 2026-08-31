import {
  collection,
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { validateTransaction, reviseSummaries } from "./calculations";
import { parseDate } from "./formatters";
import type {
  FinanceTransaction,
  MonthlySummary,
  TransactionInput,
  TitheAttribution,
} from "./types";
export function newTransactionId(db: Firestore) {
  return doc(collection(db, "financeTransactions")).id;
}
// Stable ID + transaction read prevent duplicate creates; revision rejects stale edits.
export async function saveTransaction(
  db: Firestore,
  uid: string,
  id: string,
  input: TransactionInput,
  options: {
    existing?: FinanceTransaction;
    profileId?: string;
    privateNote?: string;
    voidReason?: string;
  } = {},
) {
  const tithe = options.existing?.source === "tithe" || !!options.profileId;
  validateTransaction(input, tithe);
  if (
    options.voidReason !== undefined &&
    (options.voidReason.trim().length < 3 || options.voidReason.length > 300)
  )
    throw new Error("Escribe un motivo de anulación de 3 a 300 caracteres.");
  const observed = new Map<string, string>();
  // Rules may evaluate a contended aggregate before Firestore reports ABORTED.
  // Retry only when a fresh, authorized server read proves that aggregate changed.
  // Every retry still runs the complete transaction under exactly the same rules.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await runTransaction(db, async (tx) => {
        observed.clear();
        const ref = doc(db, "financeTransactions", id);
        const snapshot = await tx.get(ref);
        const before = snapshot.exists()
          ? ({ id, ...snapshot.data() } as FinanceTransaction)
          : null;
        if (!options.existing && before)
          throw new Error(
            "Este movimiento ya fue registrado. Cierra el formulario y revisa el listado.",
          );
        if (
          options.existing &&
          (!before ||
            before.revision !== options.existing.revision ||
            before.status !== "active")
        )
          throw new Error(
            "El movimiento cambió o ya fue anulado. Cierra el formulario y vuelve a abrirlo.",
          );
        const date = parseDate(input.date);
        const stamp = serverTimestamp();
        const after = {
          ...before,
          ...input,
          description: tithe ? "Diezmo" : input.description.trim(),
          note: tithe ? "" : (input.note || "").trim(),
          id,
          date,
          period: input.date.slice(0, 7),
          day: String(Number(input.date.slice(8, 10))),
          source: tithe ? "tithe" : "general",
          status: options.voidReason ? "voided" : "active",
          revision: (before?.revision || 0) + 1,
          createdBy: before?.createdBy || uid,
          createdAt: before?.createdAt || stamp,
          updatedBy: uid,
          updatedAt: stamp,
          ...(options.voidReason
            ? {
                voidReason: options.voidReason.trim(),
                voidedBy: uid,
                voidedAt: stamp,
              }
            : {}),
        } as FinanceTransaction;
        const periods = [
          ...new Set(
            [before?.period, after.period].filter((p): p is string => !!p),
          ),
        ];
        const summaries: Record<string, MonthlySummary> = {};
        for (const period of periods) {
          const summary = await tx.get(
            doc(db, "financeMonthlySummaries", period),
          );
          observed.set(period, JSON.stringify(summary.data() ?? null));
          if (summary.exists())
            summaries[period] = {
              id: period,
              ...summary.data(),
            } as MonthlySummary;
        }
        let attribution: TitheAttribution | null = null;
        if (tithe) {
          const a = await tx.get(doc(db, "titheAttributions", id));
          attribution = a.exists() ? (a.data() as TitheAttribution) : null;
          const profile = await tx.get(
            doc(
              db,
              "titheProfiles",
              attribution?.profileId || options.profileId || "invalid",
            ),
          );
          if (!profile.exists() || (!before && profile.data().active !== true))
            throw new Error(
              "Selecciona una ficha activa para registrar el diezmo.",
            );
        }
        // Complete every read before the first write. Retried atomically on concurrency.
        for (const summary of reviseSummaries(summaries, before, after)) {
          const { id: period, ...data } = summary;
          tx.set(doc(db, "financeMonthlySummaries", period), {
            ...data,
            updatedAt: stamp,
            lastTransactionId: id,
          });
        }
        const data = { ...after } as Partial<FinanceTransaction>;
        delete data.id;
        tx.set(ref, data);
        if (tithe)
          tx.set(doc(db, "titheAttributions", id), {
            transactionId: id,
            profileId: attribution?.profileId || options.profileId,
            amount: after.amount,
            date: after.date,
            period: after.period,
            status: after.status,
            note: attribution?.note ?? options.privateNote ?? "",
            createdBy: attribution?.createdBy || uid,
            createdAt: attribution?.createdAt || stamp,
            updatedBy: uid,
            updatedAt: stamp,
          });
        return id;
      });
    } catch (error) {
      if (
        attempt === 3 ||
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "permission-denied"
        ) ||
        !observed.size
      )
        throw error;
      let changed = false;
      try {
        for (const [period, prior] of observed) {
          const current = await getDocFromServer(
            doc(db, "financeMonthlySummaries", period),
          );
          if (JSON.stringify(current.data() ?? null) !== prior) changed = true;
        }
      } catch {
        throw error;
      }
      if (!changed) throw error;
    }
  }
  throw new Error(
    "Hay mucha actividad simultánea. Intenta guardar nuevamente.",
  );
}
export function transactionInput(t: FinanceTransaction): TransactionInput {
  return {
    type: t.type,
    amount: t.amount,
    date: t.date.toDate().toISOString().slice(0, 10),
    category: t.category,
    paymentMethod: t.paymentMethod,
    description: t.description,
    note: t.note || "",
  };
}
export async function voidTransaction(
  db: Firestore,
  uid: string,
  t: FinanceTransaction,
  reason: string,
) {
  return saveTransaction(db, uid, t.id, transactionInput(t), {
    existing: t,
    voidReason: reason,
  });
}
