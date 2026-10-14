"use client";

// Cliente del callable `sumupPayoutsReconciliation` (doc 29). Solo lectura:
// la Function no escribe nada y este cliente tampoco.

import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase";
import { errorCode, errorKey } from "@/lib/calendar/errors";
import type {
  AccountReconciliation,
  AccountTotals,
  AccountingDatePolicy,
  SettlementReason,
  SumupAccount,
} from "@/lib/shared/sumup-payouts";

export const PAYOUTS_CALLABLE = "sumupPayoutsReconciliation";

export type PayoutsAccountChoice = SumupAccount | "both";

export interface PayoutsRequest {
  account?: PayoutsAccountChoice;
  startDate: string;
  endDate: string;
}

export type PayoutsAccountResult =
  | ({ ok: true; errorClass: null; rowLimitReached: boolean } & AccountReconciliation)
  | { ok: false; account: SumupAccount; errorClass: string | null };

export interface PayoutsResponse {
  readOnly: true;
  period: { startDate: string; endDate: string };
  payoutFetch: { startDate: string; endDate: string } | null;
  asOfDate: string;
  policy: AccountingDatePolicy;
  differenceBusinessDays: number;
  accounts: PayoutsAccountResult[];
  totals: AccountTotals;
}

export async function requestPayoutsReconciliation(input: PayoutsRequest): Promise<PayoutsResponse> {
  const call = httpsCallable<PayoutsRequest, PayoutsResponse>(getFirebaseFunctions(), PAYOUTS_CALLABLE);
  const { data } = await call(input);
  if (!data || data.readOnly !== true || !Array.isArray(data.accounts)) {
    throw Object.assign(new Error("respuesta inesperada"), { code: "functions/internal" });
  }
  return data;
}

export type PayoutsErrorKind = "unavailable" | "permission" | "session" | "invalid";

/**
 * Error del callable → tipo. Todo lo que no sea permiso o rango inválido se
 * trata como "aún no disponible" (Function sin desplegar, red, interno): el
 * panel nunca rompe la página ni muestra códigos técnicos.
 */
export function payoutsErrorKind(error: unknown): PayoutsErrorKind {
  const code = errorCode(error);
  const key = errorKey(error);
  if (code === "unauthenticated" || key === "sumup-payouts/unauthenticated") return "session";
  if (code === "permission-denied" || key === "sumup-payouts/forbidden") return "permission";
  if (code === "invalid-argument") return "invalid";
  return "unavailable";
}

export const PAYOUTS_ERROR_MESSAGE: Readonly<Record<PayoutsErrorKind, string>> = {
  unavailable: "Conciliación SumUp aún no disponible. Los montos de arriba no cambian.",
  permission: "No tienes permiso para ver la conciliación SumUp.",
  session: "Tu sesión expiró. Vuelve a iniciar sesión para ver la conciliación SumUp.",
  invalid: "No pudimos consultar ese rango de fechas.",
};

/** Error de una cuenta (la otra puede venir bien). */
export function accountErrorMessage(errorClass: string | null): string {
  switch (errorClass) {
    case "config_error":
      return "Conciliación aún no disponible para esta cuenta (configuración pendiente).";
    case "emulator_offline":
      return "Entorno local: no se consulta SumUp.";
    case "auth_error":
    case "scope_missing":
      return "SumUp no autorizó la consulta de abonos.";
    case "rate_limited":
      return "SumUp pidió esperar. Intenta de nuevo en unos minutos.";
    case "timeout":
    case "provider_unavailable":
      return "SumUp no respondió a tiempo. Intenta de nuevo.";
    default:
      return "No pudimos consultar los abonos de SumUp.";
  }
}

export const SETTLEMENT_REASON_LABEL: Readonly<Record<SettlementReason, string>> = {
  basis_indeterminate: "aún no hay evidencia suficiente para confirmar la comisión",
  basis_gross: "SumUp informó montos brutos (inesperado)",
  deductions_present: "incluye descuentos de SumUp (devolución o contracargo)",
  unknown_row_type: "incluye movimientos de SumUp no reconocidos",
  rows_without_code: "hay abonos sin venta asociada",
  rows_not_found: "hay abonos de ventas no importadas",
  rows_other_account: "hay abonos de ventas de la otra cuenta",
  currency_issue: "moneda distinta de CLP",
  duplicate_conflict: "SumUp entregó la misma fila con datos distintos",
  sale_paid_twice: "una venta aparece abonada dos veces",
  fee_missing: "SumUp no informó la comisión",
  row_id_missing: "fila sin identificador",
  reference_missing: "abono sin referencia",
  date_invalid: "abono sin fecha válida",
  amount_mismatch: "un monto no cuadra con la venta",
  payout_failed: "SumUp informó el abono como fallido",
  payout_in_progress: "abono en proceso",
  status_unknown: "estado del abono desconocido",
  difference_within_term: "diferencia en espera de confirmación",
  difference_after_term: "diferencia sin resolver",
  refunds_before_payout: "incluye devoluciones anteriores al abono",
  payout_retried: "SumUp reintentó el abono y ese reintento fue exitoso",
  rounding: "ajustado por redondeo de SumUp",
};
