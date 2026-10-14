// Saldo bancario estimado (doc 30). Cálculo PURO: sin Firebase, sin React y sin
// reloj (la fecha "hoy" llega como `asOf`). Nunca inventa un saldo: sin saldo
// inicial configurado no devuelve número; sin abonos SumUp marca el resultado
// como parcial.
//
//   banco  = saldo inicial (cartola, cierre de openingDate)
//          + ingresos por transferencia + abonos SumUp exitosos (neto)
//          + abonos no-ingreso + depósitos de caja
//          − gastos por transferencia o tarjeta − transferencias salientes no-gasto
//          − retiros a caja ± ajustes manuales
//   caja   = efectivo inicial (si existe) + ingresos en efectivo − gastos en efectivo
//          − depósitos al banco + retiros desde el banco
//
// Todo se cuenta desde el día SIGUIENTE a openingDate (ese día ya está en la
// cartola) hasta `asOf` inclusive, en fechas locales America/Santiago.
// Movimientos anulados nunca cuentan. El resultado contable del período NO es
// parte de esto: se muestra aparte.

import {
  isSafeAmount,
  isYmd,
  ledgerLocalDate,
  type TreasuryDirection,
  type TreasuryType,
  type Ymd,
} from "./bank-model";

export interface BankAccountConfig {
  openingBalance: number;
  openingDate: Ymd;
  openingCash: number | null;
}

/** Subconjunto de FinanceTransaction que necesita el cálculo. */
export interface BankLedgerRow {
  id: string;
  type: "income" | "expense";
  amount: number;
  paymentMethod: "cash" | "transfer" | "card" | "other";
  status: "active" | "voided";
  period: string;
  day: string;
  /** Opcional: se usa para no restar dos veces las comisiones SumUp (los abonos ya son netos). */
  category?: string;
}

/**
 * Categoría de gasto de las comisiones SumUp (FEE_CATEGORY del PR C). Los abonos
 * SumUp ya llegan netos de comisión: restar además ese gasto del banco lo
 * descontaría dos veces. Se excluye del banco y de la caja (doc 30 §5).
 */
export const SUMUP_FEE_CATEGORY = "Comisiones SumUp";

export interface TreasuryRow {
  id: string;
  accountId: string;
  type: TreasuryType;
  direction: TreasuryDirection;
  amount: number;
  date: Ymd;
  status: "active" | "voided";
}

export interface SumupPayout {
  id: string;
  /** Fecha local del abono en el banco. */
  payoutDate: Ymd;
  /** Monto neto abonado (CLP entero). */
  netPaid: number;
  fee: number | null;
  status: string;
}

export type SumupPayoutsInput =
  | { status: "unavailable"; reason: string }
  | {
      status: "available";
      payouts: SumupPayout[];
      /** Bruto de ventas con tarjeta aún no abonado (sin comisiones), o null si la fuente no lo entrega. */
      pendingDeposit: number | null;
      /** Primer día que cubre la fuente; si es posterior al día siguiente al corte, el banco queda parcial. */
      coverageFrom?: Ymd | null;
      /** Último día que cubre la fuente; si es anterior a asOf, el banco queda parcial. */
      coverageTo?: Ymd | null;
      /** Motivos de la fuente para considerar el saldo incompleto (p. ej. base indeterminada). */
      partialReasons?: string[];
      /** Avisos informativos de la fuente (p. ej. abonos en proceso o fallidos que no se suman). */
      warnings?: string[];
    };

export const PAYOUTS_NOT_CONNECTED: SumupPayoutsInput = {
  status: "unavailable",
  reason: "La conciliación de abonos SumUp todavía no está conectada.",
};

export type BalanceTarget = "bank" | "cash";
export type LineSource = "opening" | "ledger" | "sumup" | "treasury";

export interface BreakdownLine {
  key: string;
  target: BalanceTarget;
  label: string;
  detail: string;
  sign: 1 | -1;
  amount: number;
  count: number;
  source: LineSource;
  /** La fuente no está disponible: la línea no suma y el total es parcial. */
  missing?: boolean;
}

export type BankBalanceStatus = "unconfigured" | "partial" | "complete";

export interface BankBalanceResult {
  status: BankBalanceStatus;
  asOf: Ymd;
  openingDate: Ymd | null;
  /** null solo cuando status === "unconfigured". */
  bank: { estimated: number; lines: BreakdownLine[] } | null;
  cash: { amount: number; includesOpeningCash: boolean; lines: BreakdownLine[] } | null;
  /** Bruto pendiente de abono informado por SumUp (sin comisiones), o null si no se sabe. */
  sumupPending: number | null;
  incompleteReasons: string[];
  warnings: string[];
  counts: {
    voided: number;
    beforeCutoff: number;
    future: number;
    otherMethod: number;
    otherMethodAmount: number;
    cardIncome: number;
    invalid: number;
    sumupFees: number;
    payoutsSkipped: number;
  };
}

export interface BankBalanceInput {
  account: BankAccountConfig | null;
  ledger: readonly BankLedgerRow[];
  treasury: readonly TreasuryRow[];
  payouts: SumupPayoutsInput;
  asOf: Ymd;
  accountId?: string;
  ledgerTruncated?: boolean;
  treasuryTruncated?: boolean;
}

function addDay(value: Ymd): Ymd {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

class Acc {
  amount = 0;
  count = 0;
  add(v: number) {
    this.amount += v;
    this.count += 1;
  }
}

function safeSum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  if (!Number.isSafeInteger(total)) throw new Error("El saldo supera el límite seguro de cálculo.");
  return total === 0 ? 0 : total; // nunca "-0"
}

export function computeBankBalance(input: BankBalanceInput): BankBalanceResult {
  const { account, asOf } = input;
  const counts = {
    voided: 0,
    beforeCutoff: 0,
    future: 0,
    otherMethod: 0,
    otherMethodAmount: 0,
    cardIncome: 0,
    invalid: 0,
    sumupFees: 0,
    payoutsSkipped: 0,
  };
  const warnings: string[] = [];
  const incompleteReasons: string[] = [];
  const sumupPending =
    input.payouts.status === "available" &&
    input.payouts.pendingDeposit !== null &&
    isSafeAmount(input.payouts.pendingDeposit, { allowZero: true })
      ? input.payouts.pendingDeposit
      : null;

  const configured =
    !!account &&
    isYmd(account.openingDate) &&
    isSafeAmount(account.openingBalance, { allowNegative: true }) &&
    (account.openingCash === null || isSafeAmount(account.openingCash, { allowZero: true }));
  if (!configured || !account) {
    return {
      status: "unconfigured",
      asOf,
      openingDate: null,
      bank: null,
      cash: null,
      sumupPending,
      incompleteReasons: [
        account
          ? "El saldo inicial guardado no es válido. Un administrador debe revisarlo."
          : "Falta el saldo inicial de la cuenta (cartola a una fecha de corte).",
      ],
      warnings,
      counts,
    };
  }
  const cutoff = account.openingDate;
  const inWindow = (date: Ymd) => date > cutoff && date <= asOf;
  if (asOf < cutoff) warnings.push("La fecha de consulta es anterior a la fecha de corte: no hay movimientos que sumar.");

  // ── Libro (financeTransactions) ──
  const transferIncome = new Acc();
  const cashIncome = new Acc();
  const transferExpense = new Acc();
  const cardExpense = new Acc();
  const cashExpense = new Acc();
  const seen = new Set<string>();
  for (const row of input.ledger) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (row.status !== "active") {
      counts.voided++;
      continue;
    }
    const date = ledgerLocalDate(row.period, row.day);
    if (!date || !isSafeAmount(row.amount) || (row.type !== "income" && row.type !== "expense")) {
      counts.invalid++;
      continue;
    }
    if (date <= cutoff) {
      counts.beforeCutoff++;
      continue;
    }
    if (date > asOf) {
      counts.future++;
      continue;
    }
    const income = row.type === "income";
    if (!income && row.category === SUMUP_FEE_CATEGORY) {
      counts.sumupFees++;
      continue;
    }
    switch (row.paymentMethod) {
      case "transfer":
        (income ? transferIncome : transferExpense).add(row.amount);
        break;
      case "cash":
        (income ? cashIncome : cashExpense).add(row.amount);
        break;
      case "card":
        // Venta con tarjeta: llega al banco solo vía abono SumUp (neto). Gasto con tarjeta: sale del banco.
        if (income) counts.cardIncome++;
        else cardExpense.add(row.amount);
        break;
      default:
        counts.otherMethod++;
        counts.otherMethodAmount += row.amount;
    }
  }

  // ── Tesorería ──
  const t: Record<TreasuryType, Acc> = {
    cash_deposit: new Acc(),
    cash_withdrawal: new Acc(),
    outgoing_transfer: new Acc(),
    other_deposit: new Acc(),
    adjustment: new Acc(),
  };
  const adjustIn = new Acc();
  const adjustOut = new Acc();
  const tSeen = new Set<string>();
  for (const row of input.treasury) {
    if (tSeen.has(row.id)) continue;
    tSeen.add(row.id);
    if (input.accountId && row.accountId !== input.accountId) continue;
    if (row.status !== "active") {
      counts.voided++;
      continue;
    }
    if (!isYmd(row.date) || !isSafeAmount(row.amount) || !(row.type in t)) {
      counts.invalid++;
      continue;
    }
    if (row.date <= cutoff) {
      counts.beforeCutoff++;
      continue;
    }
    if (row.date > asOf) {
      counts.future++;
      continue;
    }
    if (row.type === "adjustment") {
      if (row.direction === "in") adjustIn.add(row.amount);
      else if (row.direction === "out") adjustOut.add(row.amount);
      else counts.invalid++;
    } else t[row.type].add(row.amount);
  }

  // ── Abonos SumUp ──
  const payoutsAcc = new Acc();
  let payoutsMissing = false;
  if (input.payouts.status === "unavailable") {
    payoutsMissing = true;
    incompleteReasons.push(`Faltan los abonos SumUp: ${input.payouts.reason}`);
  } else {
    const coverage = input.payouts.coverageFrom;
    if (coverage && isYmd(coverage) && coverage > addDay(cutoff)) {
      incompleteReasons.push(`Los abonos SumUp solo están disponibles desde el ${coverage}.`);
    }
    const coverageTo = input.payouts.coverageTo;
    if (coverageTo && isYmd(coverageTo) && coverageTo < asOf && asOf > cutoff) {
      incompleteReasons.push(`Los abonos SumUp solo están disponibles hasta el ${coverageTo}.`);
    }
    for (const reason of input.payouts.partialReasons ?? []) incompleteReasons.push(reason);
    for (const w of input.payouts.warnings ?? []) warnings.push(w);
    const pSeen = new Set<string>();
    for (const p of input.payouts.payouts) {
      // Sin id no se puede deduplicar: se cuenta (la fuente garantiza ids; el adaptador rechaza abonos sin id).
      if (p.id) {
        if (pSeen.has(p.id)) continue;
        pSeen.add(p.id);
      }
      if (String(p.status).toUpperCase() !== "SUCCESSFUL") {
        counts.payoutsSkipped++;
        continue;
      }
      if (!isYmd(p.payoutDate) || !isSafeAmount(p.netPaid, { allowZero: true })) {
        counts.invalid++;
        continue;
      }
      if (inWindow(p.payoutDate)) payoutsAcc.add(p.netPaid);
    }
  }

  if (input.ledgerTruncated)
    incompleteReasons.push("Se alcanzó el límite de movimientos consultados: el saldo puede estar incompleto.");
  if (input.treasuryTruncated)
    incompleteReasons.push("Se alcanzó el límite de movimientos de tesorería consultados.");
  if (counts.otherMethod)
    warnings.push(
      `${counts.otherMethod} movimiento(s) con método "Otro" no se cuentan ni en banco ni en caja.`,
    );
  if (counts.invalid) warnings.push(`${counts.invalid} registro(s) con datos no válidos se omitieron.`);
  if (counts.future) warnings.push(`${counts.future} movimiento(s) con fecha futura no se cuentan todavía.`);
  if (counts.payoutsSkipped)
    warnings.push(`${counts.payoutsSkipped} abono(s) SumUp no exitosos (en proceso, fallidos o desconocidos) no se suman.`);
  if (counts.sumupFees)
    warnings.push(
      `${counts.sumupFees} gasto(s) "${SUMUP_FEE_CATEGORY}" no se restan del banco: los abonos SumUp ya llegan netos de comisión.`,
    );

  const line = (
    key: string,
    target: BalanceTarget,
    label: string,
    detail: string,
    sign: 1 | -1,
    acc: Acc,
    source: LineSource,
    missing = false,
  ): BreakdownLine => ({ key, target, label, detail, sign, amount: acc.amount, count: acc.count, source, ...(missing ? { missing } : {}) });

  const opening = new Acc();
  opening.add(account.openingBalance);
  const bankLines: BreakdownLine[] = [
    line("opening", "bank", "Saldo inicial según cartola", `Al cierre del ${cutoff}.`, 1, opening, "opening"),
    line("transferIncome", "bank", "Ingresos por transferencia", "Diezmos, donaciones y otros ingresos recibidos por transferencia.", 1, transferIncome, "ledger"),
    line(
      "sumupPayouts",
      "bank",
      "Abonos SumUp recibidos (neto)",
      payoutsMissing
        ? "No disponible: las ventas con tarjeta no se cuentan hasta conocer su abono."
        : "Abonos exitosos de SumUp, ya descontadas sus comisiones.",
      1,
      payoutsAcc,
      "sumup",
      payoutsMissing,
    ),
    line("otherDeposit", "bank", "Abonos que no son ingreso", "Por ejemplo, traspasos desde otra cuenta propia.", 1, t.other_deposit, "treasury"),
    line("cashDeposit", "bank", "Depósitos de efectivo (caja → banco)", "Efectivo de la caja depositado en la cuenta.", 1, t.cash_deposit, "treasury"),
    line("transferExpense", "bank", "Gastos pagados por transferencia", "Salidas registradas con método Transferencia.", -1, transferExpense, "ledger"),
    line("cardExpense", "bank", "Gastos pagados con tarjeta", "Se asumen cargados a la cuenta (decisión pendiente si hay tarjeta de crédito).", -1, cardExpense, "ledger"),
    line("outgoingTransfer", "bank", "Transferencias salientes que no son gasto", "Por ejemplo, traspasos a otra cuenta propia.", -1, t.outgoing_transfer, "treasury"),
    line("cashWithdrawal", "bank", "Retiros a caja (banco → caja)", "Dinero sacado del banco para la caja.", -1, t.cash_withdrawal, "treasury"),
    line("adjustIn", "bank", "Ajustes manuales a favor", "Correcciones explícitas tras conciliar con la cartola.", 1, adjustIn, "treasury"),
    line("adjustOut", "bank", "Ajustes manuales en contra", "Correcciones explícitas tras conciliar con la cartola.", -1, adjustOut, "treasury"),
  ];
  const estimated = safeSum(bankLines.filter((l) => !l.missing).map((l) => l.sign * l.amount));

  const includesOpeningCash = account.openingCash !== null;
  const openingCash = new Acc();
  if (includesOpeningCash) openingCash.add(account.openingCash as number);
  const cashLines: BreakdownLine[] = [
    ...(includesOpeningCash
      ? [line("openingCash", "cash", "Efectivo inicial contado", `Al cierre del ${cutoff}.`, 1, openingCash, "opening")]
      : []),
    line("cashIncome", "cash", "Ingresos en efectivo", "Ofrendas, cafetería y diezmos en efectivo (incluye efectivo registrado en SumUp).", 1, cashIncome, "ledger"),
    line("cashExpense", "cash", "Gastos pagados en efectivo", "Salidas registradas con método Efectivo.", -1, cashExpense, "ledger"),
    line("cashToBank", "cash", "Depósitos al banco", "Efectivo que salió de la caja hacia la cuenta.", -1, t.cash_deposit, "treasury"),
    line("bankToCash", "cash", "Retiros desde el banco", "Dinero que entró a la caja desde la cuenta.", 1, t.cash_withdrawal, "treasury"),
  ];
  const cashAmount = safeSum(cashLines.map((l) => l.sign * l.amount));
  if (cashAmount < 0)
    warnings.push(
      "El efectivo registrado quedó negativo: probablemente falta registrar ingresos en efectivo, el efectivo inicial o hay depósitos duplicados.",
    );

  return {
    status: incompleteReasons.length ? "partial" : "complete",
    asOf,
    openingDate: cutoff,
    bank: { estimated, lines: bankLines },
    cash: { amount: cashAmount, includesOpeningCash, lines: cashLines },
    sumupPending,
    incompleteReasons,
    warnings,
    counts,
  };
}
