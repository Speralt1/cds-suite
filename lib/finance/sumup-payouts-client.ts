"use client";
// Abonos SumUp para el saldo bancario (doc 30 §10.5). Llama a la callable de
// solo lectura `sumupPayoutsReconciliation` (PR C) en ventanas de ≤ 35 días
// desde el día siguiente al corte hasta hoy y adapta la respuesta. Falla
// cerrado: si la función no existe, no responde o trae algo desconocido, el
// saldo queda "parcial: faltan abonos SumUp". Nunca escribe nada.
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "../firebase";
import { addDays } from "../shared/dates";
import { adaptSumupReconciliationResponse } from "./sumup-payouts-adapter";
import type { SumupPayoutsInput } from "./bank-balance";
import type { Ymd } from "./bank-model";

export const SUMUP_RECONCILIATION_CALLABLE = "sumupPayoutsReconciliation";
/** MAX_WINDOW_DAYS de C. */
export const SUMUP_WINDOW_DAYS = 35;
/** Tope de ventanas por consulta (~1 año); más allá el saldo queda parcial. */
export const SUMUP_MAX_WINDOWS = 11;
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface PayoutWindow {
  startDate: Ymd;
  endDate: Ymd;
}

/** Ventanas contiguas de ≤ 35 días desde openingDate+1 hasta today; las más recientes si exceden el tope. */
export function payoutWindows(openingDate: Ymd, today: Ymd, max = SUMUP_MAX_WINDOWS): PayoutWindow[] {
  const first = addDays(openingDate, 1);
  if (first > today) return [];
  const windows: PayoutWindow[] = [];
  let start = first;
  while (start <= today) {
    const end = addDays(start, SUMUP_WINDOW_DAYS - 1);
    windows.push({ startDate: start, endDate: end < today ? end : today });
    start = addDays(start, SUMUP_WINDOW_DAYS);
  }
  return windows.slice(-max);
}

export type ReconciliationCall = (input: { account: "both"; startDate: Ymd; endDate: Ymd }) => Promise<unknown>;

/** Ventanas en paralelo como máximo (la Function de C tiene maxInstances 3). */
export const SUMUP_WINDOW_CONCURRENCY = 2;

export async function fetchSumupPayoutsForBank(
  call: ReconciliationCall,
  openingDate: Ymd,
  today: Ymd,
  concurrency = SUMUP_WINDOW_CONCURRENCY,
): Promise<SumupPayoutsInput> {
  const windows = payoutWindows(openingDate, today);
  if (!windows.length) return { status: "available", payouts: [], pendingDeposit: null, coverageFrom: null, coverageTo: null };
  const responses: unknown[] = new Array(windows.length);
  let next = 0;
  let failure: unknown = null;
  async function worker() {
    while (failure === null && next < windows.length) {
      const i = next++;
      try {
        responses[i] = await call({ account: "both", ...windows[i] });
      } catch (error) {
        failure = error ?? new Error("unavailable");
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, windows.length)) }, worker));
  if (failure !== null) {
    const code = typeof failure === "object" && "code" in (failure as object) ? String((failure as { code: unknown }).code) : "";
    return {
      status: "unavailable",
      reason: `la consulta de abonos SumUp no está disponible${code ? ` (${code.replace(/^functions\//, "")})` : ""}.`,
    };
  }
  return adaptSumupReconciliationResponse(responses, today);
}

const cache = new Map<string, { at: number; promise: Promise<SumupPayoutsInput> }>();

function realCall(): ReconciliationCall {
  const fn = httpsCallable(getFirebaseFunctions(), SUMUP_RECONCILIATION_CALLABLE);
  return async (input) => (await fn(input)).data;
}

/** Para tests. */
export function clearSumupPayoutsCache() {
  cache.clear();
}

/**
 * Abonos SumUp desde el corte. Devuelve null mientras carga. Sin fecha de corte
 * o deshabilitado no consulta nada.
 */
export function useSumupPayoutsForBank(openingDate: Ymd | null, today: Ymd, enabled = true): SumupPayoutsInput | null {
  const key = openingDate && enabled ? `${openingDate}|${today}` : "";
  const [state, setState] = useState<{ key: string; value: SumupPayoutsInput } | null>(null);
  useEffect(() => {
    if (!key || !openingDate) return;
    let active = true;
    let entry = cache.get(key);
    if (!entry || Date.now() - entry.at > CACHE_TTL_MS) {
      let call: ReconciliationCall;
      try {
        call = realCall();
      } catch {
        call = () => Promise.reject(new Error("unavailable"));
      }
      entry = { at: Date.now(), promise: fetchSumupPayoutsForBank(call, openingDate, today) };
      cache.set(key, entry);
    }
    entry.promise
      .catch((): SumupPayoutsInput => ({ status: "unavailable", reason: "la consulta de abonos SumUp falló." }))
      .then((value) => {
        if (active) setState({ key, value });
      });
    return () => {
      active = false;
    };
  }, [key, openingDate, today]);
  if (!key) return { status: "unavailable", reason: "no hay fecha de corte configurada." };
  return state?.key === key ? state.value : null;
}

