// Detector: resumen mensual vs ledger para TODOS los meses (A5 solo octubre + meses
// con escrituras en la ventana). 9 campos; cualquier diferencia → STOP (no reparar
// automáticamente). Claves en cero → INFORMATIVO (estructurales, sin efecto monetario).
import { LEVELS, MAP_FIELDS, aggregateLedger, cleanMap, differingFields, finding, zeroKeys } from "../lib/util.mjs";

export function detectSummaryLedgerMismatch(ctx) {
  const byPeriod = new Map();
  for (const t of ctx.snapshot.ledger) {
    if (!t.period) continue;
    if (!byPeriod.has(t.period)) byPeriod.set(t.period, []);
    byPeriod.get(t.period).push(t);
  }
  const summaries = ctx.snapshot.summaries;
  const periods = [...new Set([...byPeriod.keys(), ...Object.keys(summaries)])].sort();
  const findings = [];
  for (const period of periods) {
    const L = aggregateLedger(byPeriod.get(period) || []);
    const s = summaries[period];
    if (!s) {
      if (L.transactionCount > 0)
        findings.push(
          finding("SUMMARY_MISSING", LEVELS.STOP, `El mes ${period} tiene ${L.transactionCount} movimiento(s) activos pero no tiene resumen mensual.`, { period, ledgerCount: L.transactionCount, ledgerIncome: L.incomeTotal, ledgerExpense: L.expenseTotal }),
        );
      continue;
    }
    const bad = differingFields(s, L);
    if (bad.length) {
      const detail = Object.fromEntries(
        bad.map((f) => [f, MAP_FIELDS.includes(f) ? { summary: cleanMap(s[f], f), ledger: cleanMap(L[f], f) } : { summary: Number(s[f] || 0), ledger: L[f] }]),
      );
      findings.push(
        finding(
          "SUMMARY_LEDGER_MISMATCH",
          LEVELS.STOP,
          `Resumen ${period} no cuadra con el ledger activo en ${bad.length}/9 campo(s): ${bad.join(", ")}. No reparar automáticamente; investigar la escritura que lo descuadró.`,
          { period, fields: bad, detail },
        ),
      );
    }
    const zeros = MAP_FIELDS.flatMap((f) => zeroKeys(s[f]).map((k) => `${f}["${k}"]`));
    if (zeros.length)
      findings.push(
        finding("SUMMARY_ZERO_KEYS", LEVELS.INFO, `Resumen ${period}: clave(s) en cero ${zeros.join(", ")} (estructural, sin efecto monetario).`, { period, keys: zeros }),
      );
  }
  return findings;
}
