"use client";

// Slice 3a — reads sumupDailySettlement/{account}_{date}, the recommended
// per-day summary the payouts ingestion writes (docs/mission-2026/15-slice3a-sumup-fees-deposits-spec.md
// §Lectura desde el cliente). Never edits anything here: this module is
// read-only, same as lib/offerings/client.ts's useSumUpIntegration.

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase";
import { errorMessage } from "@/lib/finance/formatters";
import type { SumUpAccount } from "@/lib/offerings/client";

export interface SumUpDailySettlement {
  account: SumUpAccount;
  date: string; // YYYY-MM-DD, día de venta (Chile)
  bruto: number;
  reembolsado: number;
  comisionSumUp: number;
  liquidoEsperado: number;
  // null = todavía no hay payout vinculado ("por depositar"), nunca $0.
  depositado: number | null;
  references: Array<{ date: string | null; reference: string | null }>;
  txCount: number;
  txLinked: number;
  txPending: number;
  linkStatus: "pending" | "partial" | "complete";
  basis: "net" | "gross" | null;
}

/**
 * useMonthSettlements — every sumupDailySettlement row for BOTH accounts
 * whose sale day falls in [startDate, endDate] (inclusive, YYYY-MM-DD).
 * Keyed by `${account}_${date}` for O(1) lookup from the day panel / cards.
 *
 * `enabled` MUST be false for roles without detail access (leader): the
 * firestore.rules for sumupDailySettlement only allow details()
 * (admin/pastor/finance) to read it, so a leader session must never issue
 * this query at all — same pattern as useTransactions(period, details).
 */
const EMPTY_SETTLEMENTS_STATE = { data: new Map<string, SumUpDailySettlement>(), loading: false, error: "" };

export function useMonthSettlements(startDate: string, endDate: string, enabled = true) {
  const [state, setState] = useState<{
    data: Map<string, SumUpDailySettlement>;
    loading: boolean;
    error: string;
  }>({ data: new Map(), loading: enabled, error: "" });

  useEffect(() => {
    // Never call setState synchronously from the effect body when disabled —
    // the disabled case is served by the fixed EMPTY_SETTLEMENTS_STATE
    // constant below instead of touching state at all.
    if (!enabled) return undefined;
    const unsubscribe = onSnapshot(
      query(
        collection(getFirebaseServices().db, "sumupDailySettlement"),
        where("date", ">=", startDate),
        where("date", "<=", endDate),
      ),
      (snapshot) => {
        const map = new Map<string, SumUpDailySettlement>();
        snapshot.docs.forEach((item) => {
          const data = item.data() as SumUpDailySettlement;
          map.set(`${data.account}_${data.date}`, data);
        });
        setState({ data: map, loading: false, error: "" });
      },
      (error) => setState({ data: new Map(), loading: false, error: errorMessage(error) }),
    );
    return unsubscribe;
  }, [startDate, endDate, enabled]);

  return enabled ? state : EMPTY_SETTLEMENTS_STATE;
}

export type SettlementStatusCode = "por-depositar" | "pagado" | "diferencia" | "revision";

export interface SettlementStatusView {
  code: SettlementStatusCode;
  label: string;
}

const BUSINESS_DAYS_GRACE = 5;

function addBusinessDays(dateStr: string, businessDays: number) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  let added = 0;
  while (added < businessDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * settlementStatus — the 4 states from spec §UI "Estados", always meant to
 * be shown with icon + text (never color alone — see the caller). Naming
 * deliberately avoids "Conciliado": this only compares SumUp's own payout
 * amount against the expected liquid, it is NOT cross-checked against the
 * bank statement yet (spec's "Pendiente: Salvador tiene que comparar 1 o 2
 * depósitos contra la cartola del banco").
 *
 *   - "por-depositar" (Clock)       — no hay payout vinculado todavía.
 *   - "pagado"        (CircleCheck) — SumUp pagó exactamente el líquido esperado.
 *   - "diferencia"    (TriangleAlert) — diferencia > 0 y ya pasaron 5 días hábiles.
 *   - "revision"      (Flag)        — hay filas sumupPayouts en revisión
 *     (deducciones, sin transaction_code, base indeterminada) para el día.
 *     Esa señal vive en sumupPayouts, no en sumupDailySettlement, así que el
 *     llamador la decide pasando `hasReviewRows` cuando la tiene disponible.
 */
export function settlementStatus(
  daily: SumUpDailySettlement | undefined,
  todayStr: string,
  hasReviewRows = false,
): SettlementStatusView {
  if (hasReviewRows) {
    return { code: "revision", label: "Requiere revisión" };
  }
  if (!daily || daily.depositado === null) {
    return { code: "por-depositar", label: "Por depositar" };
  }
  const diff = daily.liquidoEsperado - daily.depositado;
  if (diff === 0) {
    return { code: "pagado", label: "Pagado por SumUp" };
  }
  const graceEnds = addBusinessDays(daily.date, BUSINESS_DAYS_GRACE);
  if (todayStr >= graceEnds) {
    return { code: "diferencia", label: "Diferencia con SumUp" };
  }
  return { code: "por-depositar", label: "Por depositar" };
}

export function sumUpAccountForCategory(category: string): SumUpAccount | null {
  if (category === "Ofrendas") return "offerings";
  if (category === "Cafetería") return "cafeteria";
  return null;
}

/** Sums comisionSumUp for both accounts across every settled day in range — used for the "Resumen mensual" line (spec: real amount from settlement even while the ledger switch is off). */
export function totalCommissionInRange(settlements: Map<string, SumUpDailySettlement>): number {
  let total = 0;
  for (const daily of settlements.values()) total += daily.comisionSumUp;
  return total;
}

export function hasAnySettlement(settlements: Map<string, SumUpDailySettlement>): boolean {
  return settlements.size > 0;
}
