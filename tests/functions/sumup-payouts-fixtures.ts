// Fixtures FICTICIOS para la conciliación de abonos SumUp (doc 29). Ningún
// código, referencia ni monto individual corresponde a datos reales; solo los
// agregados del caso Cafetería (462.500 / 15.968 / 446.532) y del abono
// agrupado de Ofrendas (100.522 / 3.352 / 97.170) replican la evidencia.
import type { RawPayoutRow, SaleRecord, SumupAccount } from "@/lib/shared/sumup-payouts";

export function sale(account: SumupAccount, code: string, saleDate: string, gross: number, extra: Partial<SaleRecord> = {}): SaleRecord {
  const refunded = extra.refundedAmount ?? 0;
  return {
    account,
    transactionCode: code,
    saleDate,
    grossAmount: gross,
    refundedAmount: refunded,
    amountAfterRefunds: Math.max(0, gross - refunded),
    status: "SUCCESSFUL",
    paymentType: "POS",
    currency: "CLP",
    ...extra,
  };
}

export function row(code: string | null, net: number, fee: number | null, date: string, reference: string, extra: Partial<RawPayoutRow> = {}): RawPayoutRow {
  return {
    id: extra.id ?? `row-${code ?? "nocode"}-${date}`,
    amount: net,
    fee,
    currency: "CLP",
    date,
    reference,
    status: "SUCCESSFUL",
    transaction_code: code,
    type: "PAYOUT",
    ...extra,
  };
}

/** Reparte `totalFee` entre ventas (≈3,45 %), ajustando la última para cuadrar exacto. */
export function feesFor(grosses: number[], totalFee: number): number[] {
  const fees = grosses.map((g) => Math.round(g * 0.0345));
  const sum = fees.reduce((a, b) => a + b, 0);
  fees[fees.length - 1] += totalFee - sum;
  return fees;
}

/** Caso Cafetería: 88 ventas el domingo 2026-10-11, un abono el martes 2026-10-13. */
export function cafeteriaCase() {
  const cycle = [2500, 3000, 5000, 6000, 10000, 1500, 4000, 8000];
  const grosses = Array.from({ length: 88 }, (_, i) => cycle[i % cycle.length]);
  grosses[87] += 462_500 - grosses.reduce((a, b) => a + b, 0);
  const fees = feesFor(grosses, 15_968);
  const sales = grosses.map((g, i) => sale("cafeteria", `CAF${String(i).padStart(4, "0")}`, "2026-10-11", g));
  const rows = grosses.map((g, i) => row(`CAF${String(i).padStart(4, "0")}`, g - fees[i], fees[i], "2026-10-13", "FICT PID CAFE 0001", { id: `caf-row-${i}` }));
  return { sales, rows, grosses, fees };
}

/** Abono agrupado de Ofrendas: ventas del 10-10 (10) y 11-10 (13) en un abono del 13-10. */
export function groupedOfferingsCase() {
  const day10 = [5000, 3000, 2000, 10000, 1000, 2000, 4000, 3000, 5000, 6000]; // 41.000
  const day11 = [5000, 4000, 3000, 2000, 10000, 5000, 4522, 3000, 6000, 2000, 5000, 3000, 7000]; // 59.522
  const grosses = [...day10, ...day11];
  const fees = feesFor(grosses, 3_352);
  const sales = grosses.map((g, i) => sale("offerings", `OFR${String(i).padStart(4, "0")}`, i < day10.length ? "2026-10-10" : "2026-10-11", g));
  const rows = grosses.map((g, i) => row(`OFR${String(i).padStart(4, "0")}`, g - fees[i], fees[i], "2026-10-13", "FICT PID OFR 0001", { id: `ofr-row-${i}` }));
  return { sales, rows, day10, day11, fees };
}

export const OCT_WINDOW = { startDate: "2026-10-01", endDate: "2026-10-31" };
