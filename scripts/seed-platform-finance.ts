/**
 * scripts/seed-platform-finance.ts — Movimientos financieros FICTICIOS para el
 * seed local (lo carga scripts/seed-platform-calendar-emulator.mjs).
 *
 * Escribe como un cliente autenticado contra el emulador (la cuenta de
 * finanzas del seed) con el helper productivo saveTransaction, así que pasa
 * por firestore.rules exactamente como la app: resumen mensual encadenado,
 * categorías activas y auditoría. SOLO emulador: proyecto demo-cds-suite y
 * host 127.0.0.1:8080; se niega en cualquier otro caso.
 *
 * Idempotente: ids fijos por mes; un id ya registrado se omite (no se
 * reescribe ni se borra nada: los resúmenes mensuales son acumulativos).
 */
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import { saveTransaction } from "../lib/finance/transactions";
import type { TransactionInput } from "../lib/finance/types";

export interface FinanceSeedItem {
  id: string;
  input: TransactionInput;
}

const PROJECT = "demo-cds-suite";
const HOST = "127.0.0.1";
const PORT = 8080;

export async function seedFinanceMovements(opts: {
  financeUid: string;
  items: readonly FinanceSeedItem[];
  firestoreHost?: string;
}): Promise<{ created: number; skipped: number }> {
  if ((opts.firestoreHost ?? `${HOST}:${PORT}`) !== `${HOST}:${PORT}`)
    throw new Error("El seed de finanzas solo corre contra el emulador local de Firestore.");
  const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: HOST, port: PORT } });
  let created = 0;
  let skipped = 0;
  try {
    const db = env.authenticatedContext(opts.financeUid).firestore() as unknown as Firestore;
    for (const item of opts.items) {
      try {
        await saveTransaction(db, opts.financeUid, item.id, item.input);
        created++;
      } catch (error) {
        if (error instanceof Error && error.message.includes("ya fue registrado")) skipped++;
        else throw error;
      }
    }
  } finally {
    await env.cleanup();
  }
  return { created, skipped };
}
