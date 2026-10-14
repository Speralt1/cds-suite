// @vitest-environment node
// Saldo bancario estimado (doc 30): cálculo puro con datos ficticios.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeBankBalance,
  PAYOUTS_NOT_CONNECTED,
  SUMUP_FEE_CATEGORY,
  type BankAccountConfig,
  type BankBalanceInput,
  type BankLedgerRow,
  type SumupPayout,
  type SumupPayoutsInput,
  type TreasuryRow,
} from "@/lib/finance/bank-balance";
import {
  directionFor,
  isYmd,
  ledgerLocalDate,
  parseClpInput,
  validateBankAccountInput,
  validateReconciliationInput,
  validateTreasuryInput,
} from "@/lib/finance/bank-model";

const ACCOUNT: BankAccountConfig = { openingBalance: 1_000_000, openingDate: "2026-09-30", openingCash: null };
const NO_PAYOUTS: SumupPayoutsInput = { status: "available", payouts: [], pendingDeposit: null };

let n = 0;
function tx(o: Partial<BankLedgerRow> & { date?: string } = {}): BankLedgerRow {
  const date = o.date ?? "2026-10-05";
  const { date: _date, ...rest } = o;
  void _date;
  return {
    id: `t${++n}`,
    type: "income",
    amount: 10_000,
    paymentMethod: "transfer",
    status: "active",
    period: date.slice(0, 7),
    day: String(Number(date.slice(8, 10))),
    ...rest,
  };
}
function tr(o: Partial<TreasuryRow> = {}): TreasuryRow {
  return { id: `r${++n}`, accountId: "main", type: "cash_deposit", direction: "in", amount: 5_000, date: "2026-10-05", status: "active", ...o };
}
function payout(o: Partial<SumupPayout> = {}): SumupPayout {
  return { id: `p${++n}`, payoutDate: "2026-10-06", netPaid: 9_500, fee: 500, status: "SUCCESSFUL", ...o };
}
function run(o: Partial<BankBalanceInput> = {}) {
  return computeBankBalance({
    account: ACCOUNT,
    ledger: [],
    treasury: [],
    payouts: NO_PAYOUTS,
    asOf: "2026-10-13",
    accountId: "main",
    ...o,
  });
}
const bankLine = (r: ReturnType<typeof run>, key: string) => r.bank!.lines.find((l) => l.key === key)!;
const cashLine = (r: ReturnType<typeof run>, key: string) => r.cash!.lines.find((l) => l.key === key)!;

describe("computeBankBalance", () => {
  it("sin saldo inicial: unconfigured y nunca devuelve un número de banco ni de caja", () => {
    const r = run({ account: null, ledger: [tx({ amount: 50_000 })] });
    expect(r.status).toBe("unconfigured");
    expect(r.bank).toBeNull();
    expect(r.cash).toBeNull();
    expect(r.openingDate).toBeNull();
    expect(r.incompleteReasons[0]).toMatch(/Falta el saldo inicial/);
  });

  it("saldo inicial guardado inválido también es unconfigured", () => {
    const r = run({ account: { openingBalance: 1.5, openingDate: "2026-09-30", openingCash: null } });
    expect(r.status).toBe("unconfigured");
    expect(r.bank).toBeNull();
    expect(run({ account: { ...ACCOUNT, openingDate: "2026-02-30" } }).status).toBe("unconfigured");
  });

  it("configurado sin movimientos: banco = saldo inicial, complete con abonos disponibles", () => {
    const r = run();
    expect(r.status).toBe("complete");
    expect(r.bank!.estimated).toBe(1_000_000);
    expect(r.cash!.amount).toBe(0);
    expect(r.cash!.includesOpeningCash).toBe(false);
    expect(r.openingDate).toBe("2026-09-30");
  });

  it("separa transferencias (banco) de efectivo (caja)", () => {
    const r = run({
      ledger: [
        tx({ paymentMethod: "transfer", amount: 100_000 }),
        tx({ paymentMethod: "cash", amount: 40_000 }),
        tx({ type: "expense", paymentMethod: "transfer", amount: 30_000 }),
        tx({ type: "expense", paymentMethod: "cash", amount: 7_000 }),
      ],
    });
    expect(r.bank!.estimated).toBe(1_000_000 + 100_000 - 30_000);
    expect(r.cash!.amount).toBe(40_000 - 7_000);
    expect(bankLine(r, "transferIncome")).toMatchObject({ amount: 100_000, count: 1, sign: 1 });
    expect(bankLine(r, "transferExpense")).toMatchObject({ amount: 30_000, count: 1, sign: -1 });
    expect(cashLine(r, "cashIncome").amount).toBe(40_000);
    expect(cashLine(r, "cashExpense").amount).toBe(7_000);
  });

  it("las ventas con tarjeta no suman al banco hasta su abono", () => {
    const r = run({ ledger: [tx({ paymentMethod: "card", amount: 80_000 })] });
    expect(r.bank!.estimated).toBe(1_000_000);
    expect(r.cash!.amount).toBe(0);
    expect(r.counts.cardIncome).toBe(1);
  });

  it("un gasto con tarjeta se descuenta del banco", () => {
    const r = run({ ledger: [tx({ type: "expense", paymentMethod: "card", amount: 12_000 })] });
    expect(r.bank!.estimated).toBe(988_000);
    expect(bankLine(r, "cardExpense")).toMatchObject({ amount: 12_000, sign: -1 });
  });

  it("abonos SumUp: después del corte se incluyen; el día de corte o antes no", () => {
    const r = run({
      payouts: {
        status: "available",
        pendingDeposit: 3_000,
        payouts: [
          payout({ payoutDate: "2026-10-01", netPaid: 9_000 }),
          payout({ payoutDate: "2026-09-30", netPaid: 50_000 }),
          payout({ payoutDate: "2026-09-29", netPaid: 70_000 }),
        ],
      },
    });
    expect(bankLine(r, "sumupPayouts")).toMatchObject({ amount: 9_000, count: 1 });
    expect(r.bank!.estimated).toBe(1_009_000);
    expect(r.sumupPending).toBe(3_000);
  });

  it("solo cuentan abonos SUCCESSFUL y se ignoran abonos duplicados", () => {
    const r = run({
      payouts: {
        status: "available",
        pendingDeposit: null,
        payouts: [
          payout({ id: "a", netPaid: 1_000 }),
          payout({ id: "a", netPaid: 1_000 }),
          payout({ id: "b", netPaid: 2_000, status: "PENDING" }),
          payout({ id: "c", netPaid: 4_000, status: "FAILED" }),
          payout({ id: "d", netPaid: 8_000, status: "successful" }),
        ],
      },
    });
    expect(bankLine(r, "sumupPayouts")).toMatchObject({ amount: 9_000, count: 2 });
  });

  it("un abono agrupado (varios días de ventas) se cuenta una vez y completo en su fecha", () => {
    const r = run({
      ledger: [
        tx({ paymentMethod: "card", amount: 30_000, date: "2026-10-03" }),
        tx({ paymentMethod: "card", amount: 20_000, date: "2026-10-04" }),
      ],
      payouts: { status: "available", pendingDeposit: 0, payouts: [payout({ payoutDate: "2026-10-06", netPaid: 48_500 })] },
    });
    expect(r.bank!.estimated).toBe(1_048_500);
    expect(r.sumupPending).toBe(0);
  });

  it("abonos no disponibles: parcial, la línea queda marcada como faltante y no suma", () => {
    const r = run({ payouts: PAYOUTS_NOT_CONNECTED, ledger: [tx({ amount: 5_000 })] });
    expect(r.status).toBe("partial");
    expect(r.bank!.estimated).toBe(1_005_000);
    expect(bankLine(r, "sumupPayouts").missing).toBe(true);
    expect(r.incompleteReasons.join(" ")).toMatch(/Faltan los abonos SumUp/);
    expect(r.sumupPending).toBeNull();
  });

  it("cobertura de abonos posterior al día siguiente del corte: parcial", () => {
    const r = run({ payouts: { status: "available", pendingDeposit: null, payouts: [], coverageFrom: "2026-10-05" } });
    expect(r.status).toBe("partial");
    expect(run({ payouts: { status: "available", pendingDeposit: null, payouts: [], coverageFrom: "2026-10-01" } }).status).toBe("complete");
  });

  it("los movimientos anulados no cuentan en ningún lado", () => {
    const r = run({
      ledger: [tx({ amount: 100_000, status: "voided" }), tx({ paymentMethod: "cash", status: "voided" })],
      treasury: [tr({ status: "voided" }), tr({ type: "adjustment", direction: "in", status: "voided" })],
      payouts: { status: "available", pendingDeposit: null, payouts: [] },
    });
    expect(r.bank!.estimated).toBe(1_000_000);
    expect(r.cash!.amount).toBe(0);
    expect(r.counts.voided).toBe(4);
  });

  it("depósitos y retiros mueven dinero entre caja y banco sin cambiar el total", () => {
    const base = run({ ledger: [tx({ paymentMethod: "cash", amount: 60_000 })] });
    const r = run({
      ledger: [tx({ paymentMethod: "cash", amount: 60_000 })],
      treasury: [tr({ type: "cash_deposit", amount: 50_000 }), tr({ type: "cash_withdrawal", direction: "out", amount: 10_000 })],
    });
    expect(r.bank!.estimated).toBe(1_000_000 + 50_000 - 10_000);
    expect(r.cash!.amount).toBe(60_000 - 50_000 + 10_000);
    expect(r.bank!.estimated + r.cash!.amount).toBe(base.bank!.estimated + base.cash!.amount);
  });

  it("transferencias no-gasto y abonos no-ingreso solo tocan el banco", () => {
    const r = run({
      treasury: [tr({ type: "outgoing_transfer", direction: "out", amount: 200_000 }), tr({ type: "other_deposit", direction: "in", amount: 30_000 })],
    });
    expect(r.bank!.estimated).toBe(830_000);
    expect(r.cash!.amount).toBe(0);
  });

  it("ajustes manuales suman o restan según su sentido", () => {
    const r = run({
      treasury: [tr({ type: "adjustment", direction: "in", amount: 1_500 }), tr({ type: "adjustment", direction: "out", amount: 4_000 })],
    });
    expect(r.bank!.estimated).toBe(997_500);
    expect(bankLine(r, "adjustIn").amount).toBe(1_500);
    expect(bankLine(r, "adjustOut").amount).toBe(4_000);
  });

  it("los movimientos de tesorería de otra cuenta se ignoran", () => {
    const r = run({ treasury: [tr({ accountId: "otra", type: "other_deposit", amount: 99_000 })] });
    expect(r.bank!.estimated).toBe(1_000_000);
  });

  it("saldo inicial negativo (sobregiro) y saldo resultante cero o negativo", () => {
    const neg = run({ account: { ...ACCOUNT, openingBalance: -50_000 }, ledger: [tx({ amount: 50_000 })] });
    expect(neg.bank!.estimated).toBe(0);
    const below = run({ account: { ...ACCOUNT, openingBalance: 0 }, ledger: [tx({ type: "expense", amount: 20_000 })] });
    expect(below.bank!.estimated).toBe(-20_000);
  });

  it("caja negativa genera advertencia honesta", () => {
    const r = run({ treasury: [tr({ type: "cash_deposit", amount: 10_000 })] });
    expect(r.cash!.amount).toBe(-10_000);
    expect(r.warnings.join(" ")).toMatch(/efectivo registrado quedó negativo/);
  });

  it("efectivo inicial opcional se suma a la caja", () => {
    const r = run({ account: { ...ACCOUNT, openingCash: 25_000 }, ledger: [tx({ paymentMethod: "cash", amount: 5_000 })] });
    expect(r.cash!.amount).toBe(30_000);
    expect(r.cash!.includesOpeningCash).toBe(true);
    expect(r.cash!.lines[0].key).toBe("openingCash");
  });

  it("límites de fecha: el día de corte se excluye, el día siguiente y asOf se incluyen, el futuro no", () => {
    const r = run({
      ledger: [
        tx({ amount: 1, date: "2026-09-30" }),
        tx({ amount: 10, date: "2026-10-01" }),
        tx({ amount: 100, date: "2026-10-13" }),
        tx({ amount: 1_000, date: "2026-10-14" }),
      ],
      treasury: [tr({ date: "2026-09-30", type: "other_deposit", amount: 7 }), tr({ date: "2026-10-14", type: "other_deposit", amount: 9 })],
    });
    expect(r.bank!.estimated).toBe(1_000_110);
    expect(r.counts.beforeCutoff).toBe(2);
    expect(r.counts.future).toBe(2);
    expect(r.warnings.join(" ")).toMatch(/fecha futura/);
  });

  it("usa la fecha local (period + day) y no el instante UTC: SumUp de 23:30 del día de corte no cuenta", () => {
    // Venta en efectivo a las 23:30 de Santiago del 30-09 (02:30Z del 01-10): period 2026-09, day 30.
    const r = run({ ledger: [{ id: "sumup_cash", type: "income", amount: 5_000, paymentMethod: "cash", status: "active", period: "2026-09", day: "30" }] });
    expect(r.cash!.amount).toBe(0);
    expect(r.counts.beforeCutoff).toBe(1);
  });

  it("método Otro no cuenta y se advierte; datos inválidos se omiten", () => {
    const r = run({
      ledger: [
        tx({ paymentMethod: "other", amount: 3_000 }),
        { ...tx(), amount: 10.5 },
        { ...tx(), day: "31", period: "2026-09" },
        tx({ amount: 2_000 }),
        { ...tx({ amount: 2_000 }), id: "dup" },
        { ...tx({ amount: 2_000 }), id: "dup" },
      ],
    });
    expect(r.counts.otherMethod).toBe(1);
    expect(r.counts.otherMethodAmount).toBe(3_000);
    expect(r.counts.invalid).toBe(2);
    expect(r.bank!.estimated).toBe(1_004_000);
    expect(r.warnings.join(" ")).toMatch(/método "Otro"/);
  });

  it("resultado truncado se reporta como parcial", () => {
    expect(run({ ledgerTruncated: true }).status).toBe("partial");
    expect(run({ treasuryTruncated: true }).incompleteReasons.join(" ")).toMatch(/límite/);
  });

  it("las líneas del banco cuadran con el total (desglose ¿Cómo se calcula?)", () => {
    const r = run({
      ledger: [tx({ amount: 3_000 }), tx({ type: "expense", paymentMethod: "card", amount: 1_000 })],
      treasury: [tr({ type: "adjustment", direction: "out", amount: 500 })],
      payouts: { status: "available", pendingDeposit: null, payouts: [payout({ netPaid: 700 })] },
    });
    const sum = r.bank!.lines.reduce((s, l) => s + l.sign * l.amount, 0);
    expect(sum).toBe(r.bank!.estimated);
    expect(r.bank!.estimated).toBe(1_000_000 + 3_000 + 700 - 1_000 - 500);
  });

  it("el módulo es puro: sin Firebase, React ni reloj", () => {
    for (const file of ["lib/finance/bank-balance.ts", "lib/finance/bank-model.ts"]) {
      const src = fs.readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
      expect(src).not.toMatch(/firebase/i);
      expect(src).not.toMatch(/from "react"/);
      expect(src).not.toMatch(/Date\.now|new Date\(\)/);
    }
  });
});

describe("computeBankBalance: abonos SumUp y comisiones (revisión Atlas)", () => {
  it("las comisiones SumUp no se restan del banco ni de la caja (los abonos ya son netos)", () => {
    const r = run({
      ledger: [
        tx({ type: "expense", paymentMethod: "transfer", amount: 300, category: SUMUP_FEE_CATEGORY }),
        tx({ type: "expense", paymentMethod: "card", amount: 200, category: SUMUP_FEE_CATEGORY }),
        tx({ type: "expense", paymentMethod: "cash", amount: 100, category: SUMUP_FEE_CATEGORY }),
        tx({ type: "expense", paymentMethod: "transfer", amount: 1_000, category: "Servicios básicos" }),
      ],
    });
    expect(r.bank!.estimated).toBe(999_000);
    expect(r.cash!.amount).toBe(0);
    expect(r.counts.sumupFees).toBe(3);
    expect(r.warnings.join(" ")).toMatch(/ya llegan netos de comisión/);
  });

  it("abonos no exitosos se cuentan en avisos, nunca suman en silencio", () => {
    const r = run({
      payouts: { status: "available", pendingDeposit: null, payouts: [payout({ status: "PENDING" }), payout({ status: "FAILED" }), payout({ netPaid: 100 })] },
    });
    expect(r.counts.payoutsSkipped).toBe(2);
    expect(bankLine(r, "sumupPayouts").amount).toBe(100);
    expect(r.warnings.join(" ")).toMatch(/2 abono\(s\) SumUp no exitosos/);
  });

  it("abonos sin id no se deduplican entre sí", () => {
    const r = run({ payouts: { status: "available", pendingDeposit: null, payouts: [payout({ id: "", netPaid: 10 }), payout({ id: "", netPaid: 10 })] } });
    expect(bankLine(r, "sumupPayouts")).toMatchObject({ amount: 20, count: 2 });
  });

  it("cobertura que empieza después de hoy o termina antes de hoy: parcial", () => {
    expect(run({ payouts: { status: "available", pendingDeposit: null, payouts: [], coverageFrom: "2026-10-20" } }).status).toBe("partial");
    const r = run({ payouts: { status: "available", pendingDeposit: null, payouts: [], coverageFrom: "2026-10-01", coverageTo: "2026-10-10" } });
    expect(r.status).toBe("partial");
    expect(r.incompleteReasons.join(" ")).toMatch(/hasta el 2026-10-10/);
    expect(run({ payouts: { status: "available", pendingDeposit: null, payouts: [], coverageFrom: "2026-10-01", coverageTo: "2026-10-13" } }).status).toBe("complete");
  });

  it("los motivos parciales y avisos de la fuente se propagan", () => {
    const r = run({ payouts: { status: "available", pendingDeposit: 0, payouts: [], partialReasons: ["base indeterminada"], warnings: ["aviso"] } });
    expect(r.status).toBe("partial");
    expect(r.incompleteReasons).toContain("base indeterminada");
    expect(r.warnings).toContain("aviso");
  });

  it("un total cero nunca es -0", () => {
    const r = run({ account: { ...ACCOUNT, openingBalance: -5 }, ledger: [tx({ amount: 5 })] });
    expect(Object.is(r.bank!.estimated, 0)).toBe(true);
    expect(Object.is(parseClpInput("-0"), 0)).toBe(true);
  });
});

describe("validaciones del modelo", () => {
  const today = "2026-10-13";
  it("isYmd y ledgerLocalDate", () => {
    expect(isYmd("2026-02-29")).toBe(false);
    expect(isYmd("2028-02-29")).toBe(true);
    expect(ledgerLocalDate("2026-10", "5")).toBe("2026-10-05");
    expect(ledgerLocalDate("2026-02", "30")).toBeNull();
    expect(ledgerLocalDate("2026-10", "05")).toBeNull();
  });
  it("parseClpInput", () => {
    expect(parseClpInput("1.250.000")).toBe(1_250_000);
    expect(parseClpInput("$ -35000")).toBe(-35_000);
    expect(parseClpInput("12,5")).toBeNull();
    expect(parseClpInput("1.25")).toBeNull();
    expect(parseClpInput("")).toBeNull();
  });
  it("directionFor fija el sentido salvo para ajustes", () => {
    expect(directionFor("cash_deposit", "out")).toBe("in");
    expect(directionFor("cash_withdrawal")).toBe("out");
    expect(directionFor("adjustment")).toBeNull();
    expect(directionFor("adjustment", "out")).toBe("out");
  });
  it("saldo inicial", () => {
    const ok = { name: "Cuenta", openingBalance: -5_000, openingDate: "2026-09-30", openingCash: null, statementReference: "" };
    expect(validateBankAccountInput(ok, { today })).toBeNull();
    expect(validateBankAccountInput({ ...ok, openingDate: "2026-10-14" }, { today })).toMatch(/futuro/);
    expect(validateBankAccountInput({ ...ok, openingDate: today }, { today })).toMatch(/anterior a hoy/);
    expect(validateBankAccountInput({ ...ok, openingDate: "2019-12-31" }, { today })).toMatch(/2020/);
    expect(validateBankAccountInput({ ...ok, openingBalance: 1.5 }, { today })).toMatch(/entero/);
    expect(validateBankAccountInput({ ...ok, openingCash: -1 }, { today })).toMatch(/efectivo inicial/);
    expect(validateBankAccountInput(ok, { today, isUpdate: true, reason: "" })).toMatch(/motivo/);
    expect(validateBankAccountInput(ok, { today, isUpdate: true, reason: "Cartola corregida" })).toBeNull();
  });
  it("movimientos de tesorería", () => {
    const ok = { accountId: "main", type: "cash_deposit" as const, direction: "in" as const, amount: 1_000, date: "2026-10-05", note: "", reason: "" };
    const o = { today, openingDate: "2026-09-30" };
    expect(validateTreasuryInput(ok, o)).toBeNull();
    expect(validateTreasuryInput({ ...ok, direction: "out" }, o)).toMatch(/ajuste/);
    expect(validateTreasuryInput({ ...ok, date: "2026-09-30" }, o)).toMatch(/posterior/);
    expect(validateTreasuryInput({ ...ok, date: "2026-10-14" }, o)).toMatch(/futuro/);
    expect(validateTreasuryInput({ ...ok, amount: 0 }, o)).toMatch(/mayor que cero/);
    expect(validateTreasuryInput(ok, { today, openingDate: null })).toMatch(/saldo inicial/);
    expect(validateTreasuryInput({ ...ok, type: "adjustment", direction: "out", reason: "corto" }, o)).toMatch(/10 caracteres/);
    expect(validateTreasuryInput({ ...ok, type: "adjustment", direction: "out", reason: "Comisión bancaria de octubre" }, o)).toBeNull();
  });
  it("conciliación", () => {
    const ok = { accountId: "main", date: "2026-10-13", reportedBalance: 10, expectedBalance: 12, estimateComplete: false, openingRevision: 1, note: "" };
    expect(validateReconciliationInput(ok, { today, openingDate: "2026-09-30" })).toBeNull();
    expect(validateReconciliationInput(ok, { today, openingDate: null })).toMatch(/saldo inicial/);
    expect(validateReconciliationInput({ ...ok, date: "2026-09-01" }, { today, openingDate: "2026-09-30" })).toMatch(/anterior/);
  });
});
