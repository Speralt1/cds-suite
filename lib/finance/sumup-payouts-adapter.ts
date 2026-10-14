// Adaptador PURO de la respuesta de la callable `sumupPayoutsReconciliation`
// (PR C, docs/mission-2026/29) al insumo de abonos del saldo bancario (doc 30).
//
// Contrato de C (una ventana ≤ 35 días):
//   { readOnly, period: {startDate, endDate}, payoutFetch, salesRead, asOfDate,
//     policy, differenceBusinessDays,
//     accounts: [ { ok: true, account, basis: {basis, …}, settlements: [Settlement],
//                   pendingDays, pendingAmount, pendingSales, proposals, totals, rowStats }
//               | { ok: false, account, errorClass } ],
//     totals }
//   Settlement: { id, account, payoutDate: Ymd|null, statusClass, status, reasons[], netPaid, fee, inWindow, … }
//   statusClass ∈ successful | in_progress | failed | unknown
//   status      ∈ PENDIENTE | CONCILIADO | CON_DIFERENCIA | REQUIERE_REVISION
//
// Reglas (falla cerrado, nunca adivina un monto):
//  · Cualquier forma o vocabulario desconocido → "unavailable".
//  · Cualquier cuenta con ok:false → "unavailable" con su errorClass.
//  · Solo suman abonos statusClass === "successful" con payoutDate dentro de la
//    ventana que los devolvió; se deduplican por id entre ventanas.
//  · Los no exitosos se cuentan en avisos (no suman).
//  · basis "indeterminate" o un abono exitoso que requiere revisión por moneda o
//    monto → parcial (y ese abono no suma).
import { isSafeAmount, isYmd, type Ymd } from "./bank-model";
import type { SumupPayout, SumupPayoutsInput } from "./bank-balance";

const STATUS_CLASSES = ["successful", "in_progress", "failed", "unknown"] as const;
const STATUSES = ["PENDIENTE", "CONCILIADO", "CON_DIFERENCIA", "REQUIERE_REVISION"] as const;
const BASES = ["net", "gross", "indeterminate"] as const;
const ACCOUNTS = ["offerings", "cafeteria"] as const;
const ACCOUNT_LABEL: Record<string, string> = { offerings: "Ofrendas", cafeteria: "Cafetería" };
/** Motivos de C que hacen dudar del monto abonado. */
const AMOUNT_DOUBT_REASONS = ["currency_issue", "amount_mismatch"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

class Unavailable extends Error {}
function fail(reason: string): never {
  throw new Unavailable(reason);
}

interface WindowResult {
  startDate: Ymd;
  endDate: Ymd;
  payouts: SumupPayout[];
  pendingAmount: number;
  skipped: number;
  partial: string[];
}

function parseWindow(raw: unknown): WindowResult {
  if (!isObj(raw) || raw.readOnly !== true) fail("La respuesta de SumUp no tiene el formato esperado.");
  const period = raw.period;
  if (!isObj(period) || !isYmd(period.startDate) || !isYmd(period.endDate) || period.endDate < period.startDate)
    fail("La respuesta de SumUp no indica un período válido.");
  const startDate = period.startDate as Ymd;
  const endDate = period.endDate as Ymd;
  if (!Array.isArray(raw.accounts) || raw.accounts.length === 0) fail("La respuesta de SumUp no trae cuentas.");
  const out: WindowResult = { startDate, endDate, payouts: [], pendingAmount: 0, skipped: 0, partial: [] };
  for (const acc of raw.accounts) {
    if (!isObj(acc) || !oneOf(ACCOUNTS, acc.account)) fail("La respuesta de SumUp trae una cuenta desconocida.");
    const label = ACCOUNT_LABEL[acc.account as string];
    if (acc.ok !== true) {
      const errorClass = typeof acc.errorClass === "string" && acc.errorClass ? acc.errorClass : "desconocido";
      fail(`la cuenta ${label} no respondió (${errorClass}).`);
    }
    if (!isObj(acc.basis) || !oneOf(BASES, acc.basis.basis)) fail("La respuesta de SumUp trae una base de montos desconocida.");
    if (acc.basis.basis === "indeterminate")
      out.partial.push(`SumUp ${label}: no se pudo determinar si los abonos vienen netos o brutos.`);
    if (!Array.isArray(acc.settlements)) fail("La respuesta de SumUp no trae abonos.");
    for (const st of acc.settlements) {
      if (!isObj(st) || typeof st.id !== "string" || !st.id) fail("La respuesta de SumUp trae abonos sin identificador.");
      if (!oneOf(STATUS_CLASSES, st.statusClass) || !oneOf(STATUSES, st.status))
        fail("La respuesta de SumUp trae un estado de abono desconocido.");
      if (st.payoutDate !== null && !isYmd(st.payoutDate)) fail("La respuesta de SumUp trae una fecha de abono inválida.");
      if (st.statusClass !== "successful") {
        out.skipped++;
        continue;
      }
      if (st.payoutDate === null) {
        out.skipped++;
        continue;
      }
      const payoutDate = st.payoutDate as Ymd;
      // Solo la ventana dueña de la fecha de abono lo cuenta (las ventanas no se solapan).
      if (payoutDate < startDate || payoutDate > endDate) continue;
      const reasons = Array.isArray(st.reasons) ? st.reasons : [];
      if (st.status === "REQUIERE_REVISION" && reasons.some((r) => AMOUNT_DOUBT_REASONS.includes(String(r)))) {
        out.partial.push(`SumUp ${label}: un abono del ${payoutDate} requiere revisión (moneda o monto) y no se sumó.`);
        continue;
      }
      if (typeof st.netPaid !== "number" || !isSafeAmount(st.netPaid, { allowZero: true }))
        fail("La respuesta de SumUp trae un monto de abono inválido.");
      out.payouts.push({
        id: `${acc.account}:${st.id}`,
        payoutDate,
        netPaid: st.netPaid,
        fee: typeof st.fee === "number" ? st.fee : null,
        status: "SUCCESSFUL",
      });
    }
    if (typeof acc.pendingAmount !== "number" || !isSafeAmount(acc.pendingAmount, { allowZero: true }))
      fail("La respuesta de SumUp trae un monto pendiente inválido.");
    out.pendingAmount += acc.pendingAmount;
  }
  return out;
}

/**
 * Une una o varias ventanas (contiguas, ≤ 35 días cada una) en el insumo de
 * abonos de computeBankBalance. `asOf` = hoy (fecha local).
 */
export function adaptSumupReconciliationResponse(raw: unknown | unknown[], asOf?: Ymd): SumupPayoutsInput {
  const list = Array.isArray(raw) ? raw : [raw];
  if (!list.length) return { status: "unavailable", reason: "No se consultó ningún período de SumUp." };
  let windows: WindowResult[];
  try {
    windows = list.map(parseWindow);
  } catch (error) {
    if (error instanceof Unavailable) return { status: "unavailable", reason: error.message };
    throw error;
  }
  windows.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const partialReasons: string[] = [];
  const warnings: string[] = [];
  for (let i = 1; i < windows.length; i++) {
    const prevEnd = windows[i - 1].endDate;
    if (windows[i].startDate <= prevEnd) return { status: "unavailable", reason: "Los períodos consultados a SumUp se solapan." };
    const [y, m, d] = prevEnd.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    if (windows[i].startDate !== next) partialReasons.push(`Falta consultar a SumUp desde el ${next}.`);
  }
  const seen = new Set<string>();
  const payouts: SumupPayout[] = [];
  let pending = 0;
  let skipped = 0;
  for (const w of windows) {
    for (const p of w.payouts) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      payouts.push(p);
    }
    pending += w.pendingAmount;
    skipped += w.skipped;
    partialReasons.push(...w.partial);
  }
  if (skipped)
    warnings.push(`${skipped} abono(s) SumUp en proceso, fallidos o sin fecha no se suman al banco.`);
  const coverageFrom = windows[0].startDate;
  const coverageTo = windows[windows.length - 1].endDate;
  if (asOf && coverageFrom > asOf) partialReasons.push("El período consultado a SumUp empieza después de hoy.");
  return {
    status: "available",
    payouts,
    pendingDeposit: Number.isSafeInteger(pending) ? pending : null,
    coverageFrom,
    coverageTo,
    partialReasons: [...new Set(partialReasons)],
    warnings,
  };
}
