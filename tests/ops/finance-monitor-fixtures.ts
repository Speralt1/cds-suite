// Fixtures sintéticos del monitor A6 (doc 31): ids inventados, nombres ficticios, sin PII.
import { runMonitor, type Finding, type LedgerRow, type MonitorOptions, type Snapshot } from "../../scripts/ops/finance-monitor/index.mjs";
import { aggregateLedger } from "../../scripts/ops/finance-monitor/lib/util.mjs";

export const TAKEN_AT = "2026-10-13T15:00:00Z"; // hoy 2026-10-13 en America/Santiago
export const BASELINE_AT = "2026-10-01T12:00:00Z";
export const PREVIOUS_AT = "2026-10-12T15:00:00Z";
export const HUMAN = "uid-tesoreria-0001";

let seq = 0;
/** Movimiento; por defecto se crea el mismo día de su fecha contable (sin atraso). */
export const row = (p: Partial<LedgerRow> = {}): LedgerRow => {
  seq++;
  const at = `${p.period ?? "2026-10"}-${String(p.day ?? "5").padStart(2, "0")}T15:00:00Z`;
  return {
    id: `tx${String(seq).padStart(4, "0")}aaaaaa${seq}`,
    type: "income",
    amount: 10000,
    category: "Ofrendas",
    paymentMethod: "transfer",
    period: "2026-10",
    day: "5",
    source: "general",
    status: "active",
    revision: 1,
    createdBy: HUMAN,
    updatedBy: HUMAN,
    createTime: at,
    updateTime: at,
    ...p,
  };
};
export const nextSeq = () => ++seq;

export const summariesOf = (ledger: LedgerRow[]) => {
  const out: Record<string, ReturnType<typeof aggregateLedger>> = {};
  for (const period of new Set(ledger.map((t) => t.period))) out[period] = aggregateLedger(ledger.filter((t) => t.period === period) as never);
  return out;
};

export const EMPTY_SUMUP = { sales: [], payouts: [], feeExpenses: [], feeProposals: [] };

/**
 * Snapshot con cobertura completa por defecto: baseline vacío (sin meses), snapshot
 * previo = filas creadas antes de `previousAt` y SumUp vacío. Pasar `null` para quitar
 * una entrada y probar la cobertura parcial.
 */
export const snap = (ledger: LedgerRow[], extra: Partial<Snapshot> = {}, previousAt = PREVIOUS_AT): Snapshot => ({
  takenAt: TAKEN_AT,
  ledger,
  attributions: [],
  profiles: [],
  summaries: summariesOf(ledger),
  baseline: { takenAt: BASELINE_AT, months: {} },
  previous: { takenAt: previousAt, ledger: ledger.filter((t) => !t.createTime || t.createTime <= previousAt).map((t) => ({ ...t })) },
  ...extra,
  sumup: extra.sumup === null ? null : { ...EMPTY_SUMUP, ...(extra.sumup || {}) },
});

/** Baseline de meses tomado de los resúmenes (antes de los cambios). */
export const baselineOf = (ledger: LedgerRow[], periods: string[], withLedger = false) => {
  const s = summariesOf(ledger);
  return {
    takenAt: BASELINE_AT,
    months: Object.fromEntries(periods.map((p) => [p, s[p] ?? aggregateLedger([])])),
    ...(withLedger ? { ledger: ledger.map((t) => ({ ...t })) } : {}),
  };
};

/** Atribuye cada diezmo a un perfil (1:1). */
export const attribute = (rows: LedgerRow[], profileId: string) =>
  rows.map((t, i) => ({ id: `at-${t.id}-${i}`, transactionId: t.id, profileId, amount: t.amount, status: "active" }));

export const run = (s: Snapshot | unknown, opts: MonitorOptions = {}) => runMonitor(s, opts);
export const codes = (fs: Finding[]) => fs.map((f) => `${f.code}:${f.level}`);
export const byCode = (fs: Finding[], code: string) => fs.filter((f) => f.code === code);
