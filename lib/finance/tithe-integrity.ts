// Avisos de diezmo repetido (doc 27). Repetir diezmos en un mes es NORMAL: nada de esto bloquea.
import type { Firestore } from "firebase/firestore";
import { MONTHS } from "./constants";
import { isoDate } from "./formatters";
import { fetchMonthTithes, fetchTransactionMethods } from "./tithe-hooks";
import type { PaymentMethod, TitheAttribution } from "./types";

/** "2026-10" → "octubre de 2026". */
export function monthLabel(period: string) {
  const month = Number(period.slice(5, 7));
  return month >= 1 && month <= 12
    ? `${MONTHS[month - 1].toLowerCase()} de ${period.slice(0, 4)}`
    : period;
}

/** Cantidad, total y último (por fecha) de los diezmos activos recibidos. */
export function summarizeMonthTithes(items: readonly TitheAttribution[]) {
  const active = items.filter((a) => a.status === "active");
  let latest: TitheAttribution | undefined;
  for (const a of active)
    if (!latest || a.date.toMillis() > latest.date.toMillis()) latest = a;
  return {
    count: active.length,
    total: active.reduce((sum, a) => sum + a.amount, 0),
    latest,
  };
}

/** Diezmos activos con la misma fecha (AAAA-MM-DD) y el mismo monto. */
export function sameDateAndAmount(
  items: readonly TitheAttribution[],
  date: string,
  amount: number,
) {
  return items.filter(
    (a) =>
      a.status === "active" && a.amount === amount && isoDate(a.date) === date,
  );
}

/**
 * Aportes activos de la ficha con la MISMA fecha, monto y método de pago. Lee los diezmos del
 * mes (consulta acotada con índice existente) y, solo si hay candidatos de misma fecha y monto,
 * su método (documentId-in de ≤ 30 movimientos). Si la consulta falla devuelve [] (nunca bloquea).
 */
export async function findExactTitheMatches(
  db: Firestore,
  profileId: string,
  input: { date: string; amount: number; paymentMethod: PaymentMethod },
): Promise<TitheAttribution[]> {
  try {
    const month = await fetchMonthTithes(db, profileId, input.date.slice(0, 7));
    const candidates = sameDateAndAmount(month, input.date, input.amount);
    if (!candidates.length) return [];
    const methods = await fetchTransactionMethods(
      db,
      candidates.map((c) => c.transactionId),
    );
    return candidates.filter(
      (c) => methods[c.transactionId] === input.paymentMethod,
    );
  } catch {
    return [];
  }
}
