// Selectores puros del preview: toda cifra visible sale de aquí, para que
// Hoy, Movimientos y Reportes no puedan contradecirse.

import { clp, clpAbs, dayMonth, daysBetween, monthLabel, percent, shortDate, weekdayOf } from "./format";
import {
  CAMPAIGN_SUBMISSIONS,
  CAMPAIGNS,
  CASH_SESSIONS,
  DEMO_TODAY,
  DEPOSITS,
  DETAIL_FROM,
  INTEGRATIONS,
  MONTH_HISTORY,
  PAYOUTS,
  TRANSACTIONS,
} from "./fixtures";
import {
  SOURCE,
  SPLIT_DATE,
  type BankDeposit,
  type CashSession,
  type DemoTransaction,
  type PaymentMethod,
  type Payout,
  type ReconciliationState,
} from "./types";

// ---------- Período ----------

export type Period = { view: "month"; year: number; month: number } | { view: "year"; year: number };

export const DEFAULT_PERIOD: Period = { view: "month", year: 2026, month: 10 };

export function periodKey(p: Period) {
  return p.view === "year" ? String(p.year) : `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function periodTitle(p: Period) {
  return p.view === "year" ? `Año ${p.year}` : monthLabel(periodKey(p));
}

export function parsePeriod(value: string | null | undefined): Period {
  if (value && /^\d{4}$/.test(value)) return { view: "year", year: Number(value) };
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    if (month >= 1 && month <= 12 && AVAILABLE_MONTHS.includes(value)) return { view: "month", year, month };
  }
  return DEFAULT_PERIOD;
}

/** Meses con datos (no se ofrecen 100 años vacíos). */
export const AVAILABLE_MONTHS: string[] = [
  ...MONTH_HISTORY.map((m) => m.period),
  "2026-09",
  "2026-10",
];

export function shiftMonth(p: Period, delta: number): Period | null {
  if (p.view !== "month") return null;
  const idx = AVAILABLE_MONTHS.indexOf(periodKey(p));
  const next = AVAILABLE_MONTHS[idx + delta];
  if (!next) return null;
  const [year, month] = next.split("-").map(Number);
  return { view: "month", year, month };
}

export function previousPeriod(p: Period): Period | null {
  if (p.view === "year") return null;
  return shiftMonth(p, -1);
}

/** Rango legible del período: "1–4 oct" si el mes está en curso. */
export function periodRangeNote(p: Period) {
  if (p.view === "month" && periodKey(p) === DEMO_TODAY.slice(0, 7))
    return `1–${Number(DEMO_TODAY.slice(8, 10))} ${dayMonth(DEMO_TODAY).split(" ")[1]} · mes en curso`;
  if (p.view === "year" && String(p.year) === DEMO_TODAY.slice(0, 4))
    return `ene–${dayMonth(DEMO_TODAY).split(" ")[1]} · año en curso`;
  return null;
}

// ---------- Movimientos ----------

export const isActive = (t: DemoTransaction) => t.status === "active";
export const isSumUp = (t: DemoTransaction) => t.origin === "sumup";

export function transactionsIn(p: Period, items: readonly DemoTransaction[] = TRANSACTIONS) {
  const key = periodKey(p);
  return items.filter((t) => t.date.startsWith(key));
}

export function hasDetail(p: Period) {
  return p.view === "month" ? periodKey(p) >= DETAIL_FROM : false;
}

// ---------- Resumen del período (una sola fuente de verdad) ----------

export interface PeriodSummary {
  income: number;
  expense: number;
  result: number;
  count: number;
  voidedCount: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  incomeByMethod: Record<PaymentMethod, number>;
  /** Total SumUp bruto activo del período (todas las cuentas). */
  sumUpGross: number;
  /** Desglose SumUp por cuenta: nunca se suma sin etiqueta. */
  sumUpByAccount: { ofrendas: number; cafeteria: number; legacy: number };
  tithes: number;
}

const emptyMethods = (): Record<PaymentMethod, number> => ({ cash: 0, transfer: 0, card: 0, other: 0 });

export function summarize(items: readonly DemoTransaction[]): PeriodSummary {
  const s: PeriodSummary = {
    income: 0,
    expense: 0,
    result: 0,
    count: 0,
    voidedCount: 0,
    incomeByCategory: {},
    expenseByCategory: {},
    incomeByMethod: emptyMethods(),
    sumUpGross: 0,
    sumUpByAccount: { ofrendas: 0, cafeteria: 0, legacy: 0 },
    tithes: 0,
  };
  for (const t of items) {
    if (!isActive(t)) {
      s.voidedCount += 1;
      continue; // lo anulado no suma
    }
    s.count += 1;
    if (t.type === "income") {
      s.income += t.amount;
      s.incomeByCategory[t.category] = (s.incomeByCategory[t.category] ?? 0) + t.amount;
      s.incomeByMethod[t.method] += t.amount;
      if (t.category === SOURCE.diezmos) s.tithes += t.amount;
      if (isSumUp(t)) {
        s.sumUpGross += t.amount;
        s.sumUpByAccount[t.account ?? "legacy"] += t.amount;
      }
    } else {
      s.expense += t.amount;
      s.expenseByCategory[t.category] = (s.expenseByCategory[t.category] ?? 0) + t.amount;
    }
  }
  s.result = s.income - s.expense;
  return s;
}

function fromHistory(period: string): PeriodSummary | null {
  const m = MONTH_HISTORY.find((h) => h.period === period);
  if (!m) return null;
  const income = Object.values(m.incomeByCategory).reduce((a, b) => a + b, 0);
  const expense = Object.values(m.expenseByCategory).reduce((a, b) => a + b, 0);
  const legacy = m.incomeByCategory[SOURCE.legacy] ?? 0;
  return {
    income,
    expense,
    result: income - expense,
    count: m.count,
    voidedCount: 0,
    incomeByCategory: { ...m.incomeByCategory },
    expenseByCategory: { ...m.expenseByCategory },
    incomeByMethod: { ...m.incomeByMethod },
    sumUpGross: legacy,
    sumUpByAccount: { ofrendas: 0, cafeteria: 0, legacy },
    tithes: m.incomeByCategory[SOURCE.diezmos] ?? 0,
  };
}

function mergeSummaries(parts: PeriodSummary[]): PeriodSummary {
  const out = summarize([]);
  for (const p of parts) {
    out.income += p.income;
    out.expense += p.expense;
    out.count += p.count;
    out.voidedCount += p.voidedCount;
    out.sumUpGross += p.sumUpGross;
    out.tithes += p.tithes;
    for (const [k, v] of Object.entries(p.incomeByCategory)) out.incomeByCategory[k] = (out.incomeByCategory[k] ?? 0) + v;
    for (const [k, v] of Object.entries(p.expenseByCategory)) out.expenseByCategory[k] = (out.expenseByCategory[k] ?? 0) + v;
    for (const k of Object.keys(out.incomeByMethod) as PaymentMethod[]) out.incomeByMethod[k] += p.incomeByMethod[k];
    for (const k of ["ofrendas", "cafeteria", "legacy"] as const) out.sumUpByAccount[k] += p.sumUpByAccount[k];
  }
  out.result = out.income - out.expense;
  return out;
}

export function monthSummary(period: string): PeriodSummary {
  if (period >= DETAIL_FROM) return summarize(TRANSACTIONS.filter((t) => t.date.startsWith(period)));
  return fromHistory(period) ?? summarize([]);
}

export function periodSummary(p: Period): PeriodSummary {
  if (p.view === "month") return monthSummary(periodKey(p));
  return mergeSummaries(AVAILABLE_MONTHS.filter((m) => m.startsWith(String(p.year))).map(monthSummary));
}

// ---------- Métricas principales (máx. 3) ----------

export interface Metric {
  id: "income" | "expense" | "result";
  label: string;
  value: number;
  previous: number | null;
  /** Texto de la base de comparación: "vs agosto 2026", "vs 1–4 sep". */
  comparisonLabel?: string;
  /** La comparación existe pero no es homogénea (p. ej. diezmos no registrados antes). */
  comparabilityNote?: string;
  composition: string;
  note?: string;
}

/** Nombre visible de una categoría según el tipo: "Cafetería" como gasto son insumos, no ventas. */
export function categoryLabel(category: string, type: "income" | "expense") {
  return type === "expense" && category === SOURCE.cafeteria ? "Insumos de Cafetería" : category;
}

/** Diezmos (desde sep 2026) y gastos (desde el 24-09-2026) se registran en CDS
 *  hace poco: si la base casi no los tiene, la comparación no es homogénea. */
export function comparabilityNote(p: Period, metric: "income" | "expense" | "result" = "income"): string | undefined {
  const prevP = previousPeriod(p);
  if (!prevP) return undefined;
  const s = periodSummary(p);
  const base = comparisonBase(p);
  const prev = base?.summary ?? periodSummary(prevP);
  const baseLabel = base?.label.replace(/^vs /, "") ?? periodTitle(prevP).toLocaleLowerCase("es");
  const tithesGap = s.tithes > 0 && prev.tithes < s.tithes * 0.2;
  const expenseGap = s.expense > 0 && prev.expense < s.expense * 0.2;
  const missing =
    metric === "income" ? (tithesGap ? ["diezmos"] : []) :
    metric === "expense" ? (expenseGap ? ["gastos"] : []) :
    [...(tithesGap ? ["diezmos"] : []), ...(expenseGap ? ["gastos"] : [])];
  if (!missing.length) return undefined;
  return `No homogénea: en ${baseLabel} casi no se registraban ${missing.join(" ni ")} en CDS.`;
}

/** Base de comparación de las métricas.
 *  Mes cerrado → mes anterior completo. Mes en curso → mismo rango de días del
 *  mes anterior ("vs 1–4 sep"), solo si ese mes tiene detalle por día. */
export function comparisonBase(p: Period): { summary: PeriodSummary; label: string } | null {
  const prevP = previousPeriod(p);
  if (!prevP || prevP.view !== "month") return null;
  const prevKey = periodKey(prevP);
  if (periodRangeNote(p) === null) {
    return { summary: periodSummary(prevP), label: `vs ${periodTitle(prevP).toLocaleLowerCase("es")}` };
  }
  if (prevKey < DETAIL_FROM) return null;
  const lastDay = DEMO_TODAY.slice(8, 10);
  const items = TRANSACTIONS.filter((t) => t.date.startsWith(prevKey) && t.date.slice(8, 10) <= lastDay);
  return {
    summary: summarize(items),
    label: `vs 1–${Number(lastDay)} ${monthLabel(prevKey).slice(0, 3).toLocaleLowerCase("es")}`,
  };
}

export function headlineMetrics(p: Period): Metric[] {
  const s = periodSummary(p);
  const base = comparisonBase(p);
  const topExpense = Object.entries(s.expenseByCategory).sort((a, b) => b[1] - a[1])[0];
  const note = (m: "income" | "expense" | "result") => (base ? comparabilityNote(p, m) : undefined);
  const expenseCount = p.view === "month" && hasDetail(p)
    ? transactionsIn(p).filter((t) => isActive(t) && t.type === "expense").length
    : null;
  return [
    {
      id: "income",
      label: "Ingresos registrados",
      value: s.income,
      previous: base?.summary.income ?? null,
      comparisonLabel: base?.label,
      comparabilityNote: note("income"),
      composition: s.tithes
        ? `Incluye diezmos ${clp(s.tithes)} (${percent(s.tithes, s.income)})`
        : "Sin diezmos registrados en el período",
      note: s.sumUpGross ? `SumUp en bruto ${clp(s.sumUpGross)}` : undefined,
    },
    {
      id: "expense",
      label: "Gastos registrados",
      value: s.expense,
      previous: base?.summary.expense ?? null,
      comparisonLabel: base?.label,
      comparabilityNote: note("expense"),
      composition: topExpense
        ? `${expenseCount !== null ? `${expenseCount} gastos · ` : ""}mayor: ${categoryLabel(topExpense[0], "expense")} ${clp(topExpense[1])}`
        : "No se registraron gastos en el período. ¿Faltan egresos?",
    },
    {
      id: "result",
      label: "Resultado del período",
      value: s.result,
      previous: base?.summary.result ?? null,
      comparisonLabel: base?.label,
      comparabilityNote: note("result"),
      composition: "Ingresos − gastos. No representa el saldo bancario.",
      note: s.sumUpGross ? "Aún no descuenta la comisión SumUp." : undefined,
    },
  ];
}

// ---------- Desgloses ----------

export const SOURCE_ORDER = [
  SOURCE.diezmos,
  SOURCE.ofrendas,
  SOURCE.cafeteria,
  SOURCE.legacy,
  SOURCE.donaciones,
  SOURCE.actividades,
  SOURCE.otros,
] as const;

export interface BreakdownRow {
  key: string;
  label: string;
  amount: number;
  share: string;
  hint?: string;
}

export function incomeBySource(p: Period): { rows: BreakdownRow[]; total: number } {
  const s = periodSummary(p);
  const rows = Object.entries(s.incomeByCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, amount]) => ({
      key,
      label: key,
      amount,
      share: percent(amount, s.income),
      hint:
        key === SOURCE.legacy
          ? "Tarjeta SumUp anterior al 09/09/2026: no se atribuye a Ofrendas ni Cafetería"
          : key === SOURCE.cafeteria
            ? "Ventas (tarjeta en bruto + efectivo)"
            : key === SOURCE.ofrendas
              ? "Donaciones del culto (tarjeta en bruto + efectivo)"
              : key === SOURCE.donaciones
                ? "Aportes fuera del culto; no son ofrendas"
                : undefined,
    }));
  return { rows, total: s.income };
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  other: "Otro",
};

export function incomeByMethod(p: Period) {
  const s = periodSummary(p);
  const otherCard = s.incomeByMethod.card - s.sumUpGross;
  const rows: BreakdownRow[] = [
    { key: "cash", label: "Efectivo", amount: s.incomeByMethod.cash, share: percent(s.incomeByMethod.cash, s.income) },
    {
      key: "sumup",
      label: "Tarjeta SumUp · bruto",
      amount: s.sumUpGross,
      share: percent(s.sumUpGross, s.income),
      hint: [
        s.sumUpByAccount.ofrendas ? `Ofrendas ${clp(s.sumUpByAccount.ofrendas)}` : null,
        s.sumUpByAccount.cafeteria ? `Cafetería ${clp(s.sumUpByAccount.cafeteria)}` : null,
        s.sumUpByAccount.legacy ? `Histórico sin separar ${clp(s.sumUpByAccount.legacy)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    ...(otherCard > 0
      ? [{ key: "card-other", label: "Tarjeta · otra", amount: otherCard, share: percent(otherCard, s.income) }]
      : []),
    { key: "transfer", label: "Transferencia", amount: s.incomeByMethod.transfer, share: percent(s.incomeByMethod.transfer, s.income) },
    ...(s.incomeByMethod.other > 0
      ? [{ key: "other", label: "Otro", amount: s.incomeByMethod.other, share: percent(s.incomeByMethod.other, s.income) }]
      : []),
  ].filter((r) => r.amount > 0);
  return { rows, total: s.income };
}

export function expenseByCategory(p: Period) {
  const s = periodSummary(p);
  return Object.entries(s.expenseByCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([key, amount]) => ({ key, label: categoryLabel(key, "expense"), amount, share: percent(amount, s.expense) }));
}

// ---------- Series para gráficos ----------

export interface MonthPoint {
  period: string;
  label: string;
  income: number;
  expense: number;
  result: number;
  partial: boolean;
}

export function monthlySeries(lastN = 10, until?: string): MonthPoint[] {
  const months = until ? AVAILABLE_MONTHS.filter((m) => m <= until) : AVAILABLE_MONTHS;
  return months.slice(-lastN).map((period) => {
    const s = monthSummary(period);
    return {
      period,
      label: monthLabel(period).slice(0, 3),
      income: s.income,
      expense: s.expense,
      result: s.result,
      partial: period === DEMO_TODAY.slice(0, 7),
    };
  });
}

/** Días de culto (miércoles y domingo) hasta hoy. */
export function isWorshipDay(iso: string) {
  const w = weekdayOf(iso);
  return w === 3 || w === 0;
}

export function datesOfMonth(period: string) {
  const [y, m] = period.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${period}-${String(i + 1).padStart(2, "0")}`);
}

export interface WorshipPoint {
  date: string;
  label: string;
  ofrendas: number;
  cafeteria: number;
  legacy: number;
  inProgress: boolean;
}

/** Últimos N días de culto con ingresos de Ofrendas/Cafetería por área (nunca sumadas). */
export function worshipSeries(n = 8, until: string = DEMO_TODAY): WorshipPoint[] {
  const dates = [...datesOfMonth("2026-09"), ...datesOfMonth("2026-10")].filter(
    (d) => d <= DEMO_TODAY && d <= until && isWorshipDay(d),
  );
  return dates.slice(-n).map((date) => {
    const day = TRANSACTIONS.filter((t) => t.date === date && isActive(t) && t.type === "income");
    const sum = (cat: string) => day.filter((t) => t.category === cat).reduce((a, t) => a + t.amount, 0);
    return {
      date,
      label: shortDate(date),
      ofrendas: sum(SOURCE.ofrendas),
      cafeteria: sum(SOURCE.cafeteria),
      legacy: sum(SOURCE.legacy),
      inProgress: date === DEMO_TODAY,
    };
  });
}

// ---------- Estado de días (Falta efectivo / Sin registros) ----------

export type AreaKey = "ofrendas" | "cafeteria";
const AREA_CATEGORY: Record<AreaKey, string> = { ofrendas: SOURCE.ofrendas, cafeteria: SOURCE.cafeteria };
export const AREA_LABEL: Record<AreaKey, string> = { ofrendas: "Ofrendas", cafeteria: "Cafetería" };

export interface DayStatus {
  date: string;
  worship: boolean;
  income: number;
  missingCash: { area: AreaKey; sumUp: number }[];
  noRecords: boolean;
}

/** Un área "falta efectivo" si, desde el 09/09 y hasta hoy, tiene SumUp > 0 y no tiene efectivo.
 *  Misma regla que producción (lib/finance/insights.ts#dayStatus), incluido hoy. */
export function dayStatus(date: string, items: readonly DemoTransaction[] = TRANSACTIONS): DayStatus {
  const day = items.filter((t) => t.date === date && isActive(t));
  const missingCash: DayStatus["missingCash"] = [];
  if (date >= SPLIT_DATE && date <= DEMO_TODAY) {
    for (const area of ["ofrendas", "cafeteria"] as const) {
      const cat = AREA_CATEGORY[area];
      const sumUp = day.filter((t) => isSumUp(t) && t.category === cat).reduce((a, t) => a + t.amount, 0);
      const cash = day.filter((t) => t.method === "cash" && t.category === cat).length;
      if (sumUp > 0 && cash === 0) missingCash.push({ area, sumUp });
    }
  }
  const worship = isWorshipDay(date);
  return {
    date,
    worship,
    income: day.filter((t) => t.type === "income").reduce((a, t) => a + t.amount, 0),
    missingCash,
    noRecords: worship && date < DEMO_TODAY && day.length === 0,
  };
}

/** Estado del efectivo de un área en un día, para TODAS las pantallas:
 *  el culto en curso (hoy) es "por registrar", nunca "falta efectivo". */
export type AreaCashStatus = "missing" | "today" | "noRecords" | "recorded" | "preSplit" | "none";

export function areaCashStatus(date: string, area: AreaKey, st: DayStatus = dayStatus(date)): AreaCashStatus {
  const missing = st.missingCash.some((m) => m.area === area);
  if (date === DEMO_TODAY) return "today";
  if (missing) return "missing";
  if (st.noRecords) return "noRecords";
  if (date < SPLIT_DATE) return "preSplit";
  const cat = AREA_CATEGORY[area];
  const hasCash = TRANSACTIONS.some((t) => t.date === date && isActive(t) && t.category === cat && t.method === "cash");
  return hasCash ? "recorded" : "none";
}

// ---------- Caja (Propuesta) ----------

export function sessionCounted(s: CashSession) {
  return s.counts.length ? s.counts[s.counts.length - 1].amount : null;
}

/** Ofrendas: diferencia entre conteos (no hay "esperado"). Cafetería: contado − esperado. */
export function sessionDifference(s: CashSession): number | null {
  if (s.area === "ofrendas") {
    if (s.counts.length < 2) return null;
    return s.counts[1].amount - s.counts[0].amount;
  }
  const counted = sessionCounted(s);
  if (counted === null || s.expected === undefined) return null;
  return counted - s.expected;
}

/** Efectivo a depositar = contado − fondo inicial. */
export function sessionToDeposit(s: CashSession): number | null {
  const counted = sessionCounted(s);
  if (counted === null) return null;
  return counted - (s.float ?? 0);
}

/** Una diferencia distinta de cero exige motivo (≥ 3 caracteres) para cerrar. */
export function canCloseWithDifference(difference: number, reason: string) {
  return difference === 0 || reason.trim().length >= 3;
}

export function pendingDeposits(): CashSession[] {
  return CASH_SESSIONS.filter(
    (s) => (s.state === "closed-balanced" || s.state === "closed-difference") && !s.depositId,
  );
}

// ---------- Conciliación (Propuesta) ----------

export function depositsOf(p: Payout): BankDeposit[] {
  return DEPOSITS.filter((d) => p.depositIds.includes(d.id));
}

/** Líquido esperado SOLO si la comisión real existe. Si no, null (no se inventa). */
export function payoutNet(p: Payout): number | null {
  return p.fee === null ? null : p.gross - p.refunds - p.fee;
}

export function reconciliationState(p: Payout): ReconciliationState {
  const net = payoutNet(p);
  const deposited = depositsOf(p).reduce((a, d) => a + d.amount, 0);
  if (net === null || deposited === 0) return "pending";
  if (deposited === net) return "reconciled";
  if (deposited < net * 0.75) return "partial";
  return "difference";
}

export function payoutGap(p: Payout): number | null {
  const net = payoutNet(p);
  if (net === null) return null;
  return depositsOf(p).reduce((a, d) => a + d.amount, 0) - net;
}

export const unlinkedDeposits = () => DEPOSITS.filter((d) => !d.linkedTo);

// ---------- Acciones por fila ----------

export type RowAction = "ver" | "editar" | "anular" | "reclasificar" | "revisar";

/** SumUp es solo lectura: nunca Editar ni Anular. */
export function rowActions(t: DemoTransaction): RowAction[] {
  if (t.status === "voided") return ["ver"];
  if (isSumUp(t)) return ["ver", "reclasificar", "revisar"];
  return ["ver", "editar", "anular"];
}

// ---------- Agrupación de Movimientos ----------

export type MovementEntry =
  | { kind: "single"; key: string; tx: DemoTransaction }
  | {
      kind: "group";
      key: string;
      date: string;
      category: string;
      status: "active" | "voided";
      items: DemoTransaction[];
      amount: number;
      label: string;
    };

const GROUP_ORDER = [SOURCE.ofrendas, SOURCE.cafeteria, SOURCE.legacy] as string[];

/** Pagos SumUp agrupados por día × categoría × estado; el resto, fila individual.
 *  Determinista y conserva la suma de montos. */
export function groupMovements(items: readonly DemoTransaction[]): MovementEntry[] {
  const groups = new Map<string, Extract<MovementEntry, { kind: "group" }>>();
  const singles: MovementEntry[] = [];
  for (const t of items) {
    if (!isSumUp(t)) {
      singles.push({ kind: "single", key: t.id, tx: t });
      continue;
    }
    const key = `g|${t.date}|${t.category}|${t.status}`;
    const g = groups.get(key) ?? {
      kind: "group" as const,
      key,
      date: t.date,
      category: t.category,
      status: t.status,
      items: [],
      amount: 0,
      label:
        t.status === "voided"
          ? `SumUp · ${t.category} · anulados o reembolsados`
          : `SumUp · ${t.category}`,
    };
    g.items.push(t);
    g.amount += t.amount;
    groups.set(key, g);
  }
  const rank = (e: MovementEntry) => {
    if (e.kind === "single") return 10;
    const i = GROUP_ORDER.indexOf(e.category);
    return (e.status === "voided" ? 5 : 0) + (i === -1 ? 3 : i);
  };
  const dateOf = (e: MovementEntry) => (e.kind === "single" ? e.tx.date : e.date);
  const timeOf = (e: MovementEntry) => (e.kind === "single" ? e.tx.time : "");
  return [...groups.values(), ...singles].sort(
    (a, b) =>
      dateOf(b).localeCompare(dateOf(a)) ||
      rank(a) - rank(b) ||
      timeOf(b).localeCompare(timeOf(a)) ||
      a.key.localeCompare(b.key),
  );
}

export interface MovementFilters {
  q: string;
  type: "all" | "income" | "expense";
  source: string; // "all" o categoría
  method: "all" | PaymentMethod;
  status: "all" | "active" | "voided";
}

export const NO_FILTERS: MovementFilters = { q: "", type: "all", source: "all", method: "all", status: "all" };

export function filterMovements(items: readonly DemoTransaction[], f: MovementFilters) {
  const q = f.q.trim().toLocaleLowerCase("es");
  return items.filter(
    (t) =>
      (f.type === "all" || t.type === f.type) &&
      (f.source === "all" || t.category === f.source) &&
      (f.method === "all" || t.method === f.method) &&
      (f.status === "all" || t.status === f.status) &&
      (!q ||
        `${t.description} ${t.category} ${isSumUp(t) ? "sumup" : ""} ${shortDate(t.date)} ${t.amount} ${clp(t.amount)}`
          .toLocaleLowerCase("es")
          .includes(q)),
  );
}

/** Franja de totales que responde al filtro activo (solo activos suman). */
export function totalsStrip(items: readonly DemoTransaction[]) {
  const s = summarize(items);
  return { income: s.income, expense: s.expense, net: s.result, count: s.count, voided: s.voidedCount };
}

// ---------- Atención ----------

export type AttentionGroup =
  | "integration"
  | "records"
  | "duplicate"
  | "link"
  | "difference"
  | "refund"
  | "deposit"
  | "approve";

export const ATTENTION_GROUP_LABEL: Record<AttentionGroup, string> = {
  integration: "Integraciones",
  records: "Completar registros",
  duplicate: "Posibles duplicados",
  link: "Vincular",
  difference: "Explicar diferencias",
  refund: "Devoluciones",
  deposit: "Depositar",
  approve: "Aprobar",
};

export interface AttentionItem {
  id: string;
  group: AttentionGroup;
  title: string;
  detail: string;
  amount?: number;
  date: string;
  ageDays: number;
  overdue: boolean;
  cta: string;
  href: string;
  /** Depende de un concepto que hoy no existe en CDS. */
  proposal: boolean;
  tone: "danger" | "warning" | "info" | "neutral";
}

export function attentionItems(): AttentionItem[] {
  const out: AttentionItem[] = [];
  const age = (d: string) => Math.max(0, daysBetween(d, DEMO_TODAY));

  for (const i of INTEGRATIONS.filter((x) => x.state === "error")) {
    out.push({
      id: `int-${i.id}`,
      group: "integration",
      title: `${i.name} no está sincronizando`,
      detail: `Último dato a las ${i.lastSuccessAt.slice(11, 16)}. Reintentamos cada hora.`,
      date: i.lastSuccessAt.slice(0, 10),
      ageDays: 0,
      overdue: false,
      cta: "Reintentar",
      href: "/preview/finanzas-2026/configuracion",
      proposal: false,
      tone: "danger",
    });
  }

  for (const date of [...datesOfMonth("2026-09"), ...datesOfMonth("2026-10")].filter((d) => d <= DEMO_TODAY)) {
    const st = dayStatus(date);
    for (const m of st.missingCash) {
      const today = date === DEMO_TODAY;
      out.push({
        id: `cash-${date}-${m.area}`,
        group: "records",
        title: today ? `Efectivo por registrar · ${AREA_LABEL[m.area]}` : `Falta efectivo · ${AREA_LABEL[m.area]}`,
        detail: today
          ? `Culto en curso: SumUp ${clp(m.sumUp)} en bruto; registra el efectivo al terminar.`
          : `${shortDate(date)}: SumUp ${clp(m.sumUp)} en bruto y ningún efectivo registrado.`,
        amount: m.sumUp,
        date,
        ageDays: age(date),
        overdue: age(date) > 2,
        cta: "Registrar efectivo",
        href: `/preview/finanzas-2026/${m.area === "ofrendas" ? "ofrendas" : "cafeteria"}`,
        proposal: false,
        tone: today ? "info" : "warning",
      });
    }
    if (st.noRecords) {
      out.push({
        id: `none-${date}`,
        group: "records",
        title: "Culto sin registros",
        detail: `${shortDate(date)}: no hay ingresos ni gastos registrados ese día de culto.`,
        date,
        ageDays: age(date),
        overdue: age(date) > 2,
        cta: "Ver día",
        href: "/preview/finanzas-2026/movimientos",
        proposal: false,
        tone: "warning",
      });
    }
  }

  for (const t of TRANSACTIONS.filter((x) => x.possibleDuplicateOf && isActive(x))) {
    out.push({
      id: `dup-${t.id}`,
      group: "duplicate",
      title: `Diezmo de ${clp(t.amount)} registrado dos veces`,
      detail: `Mismo monto, ficha y día (${shortDate(t.date)}), por dos personas distintas.`,
      amount: t.amount,
      date: t.date,
      ageDays: age(t.date),
      overdue: false,
      cta: "Revisar",
      href: "/preview/finanzas-2026/movimientos",
      proposal: true,
      tone: "warning",
    });
  }

  for (const d of unlinkedDeposits()) {
    out.push({
      id: `link-${d.id}`,
      group: "link",
      title: `Depósito de ${clp(d.amount)} sin origen`,
      detail: `${shortDate(d.date)} · ${d.description}. Vincúlalo a un payout o a una caja.`,
      amount: d.amount,
      date: d.date,
      ageDays: age(d.date),
      overdue: age(d.date) > 3,
      cta: "Vincular",
      href: "/preview/finanzas-2026/conciliacion",
      proposal: true,
      tone: "info",
    });
  }

  for (const p of PAYOUTS.filter((x) => reconciliationState(x) === "difference")) {
    const gap = payoutGap(p) ?? 0;
    out.push({
      id: `diff-${p.id}`,
      group: "difference",
      title: `Payout ${AREA_LABEL[p.account]} del ${dayMonth(p.date)} con diferencia`,
      detail: `Llegaron ${clpAbs(gap)} ${gap < 0 ? "menos" : "más"} de lo esperado (comisión de ejemplo).`,
      amount: gap,
      date: p.date,
      ageDays: age(p.date),
      overdue: age(p.date) > 3,
      cta: "Explicar",
      href: "/preview/finanzas-2026/conciliacion",
      proposal: true,
      tone: "danger",
    });
  }

  for (const s of CASH_SESSIONS.filter((x) => x.state === "reopened")) {
    out.push({
      id: `refund-${s.id}`,
      group: "refund",
      title: `Reembolso posterior al cierre · ${AREA_LABEL[s.area]}`,
      detail: `${shortDate(s.date)}: ${s.reopenReason ?? "caja reabierta"}`,
      date: s.date,
      ageDays: age(s.date),
      overdue: false,
      cta: "Revisar caja",
      href: "/preview/finanzas-2026/caja",
      proposal: true,
      tone: "info",
    });
  }

  for (const s of pendingDeposits()) {
    const amount = sessionToDeposit(s) ?? 0;
    out.push({
      id: `dep-${s.id}`,
      group: "deposit",
      title: `Depositar efectivo de ${AREA_LABEL[s.area]}`,
      detail: `Caja del ${shortDate(s.date)} cerrada; el efectivo aún no se deposita.`,
      amount,
      date: s.date,
      ageDays: age(s.date),
      overdue: age(s.date) > 3,
      cta: "Registrar depósito",
      href: "/preview/finanzas-2026/caja",
      proposal: true,
      tone: "warning",
    });
  }

  const pending = CAMPAIGN_SUBMISSIONS.filter((c) => c.status === "pending");
  if (pending.length) {
    const camp = CAMPAIGNS.find((c) => c.id === pending[0].campaignId);
    const oldest = pending.map((c) => c.date).sort()[0];
    out.push({
      id: "approve-campaign",
      group: "approve",
      title: `${pending.length} aportes de campaña por revisar`,
      detail: `${camp?.name ?? "Campaña"} · enviados desde la página pública.`,
      amount: pending.reduce((a, c) => a + c.amount, 0),
      date: oldest,
      ageDays: age(oldest),
      overdue: false,
      cta: "Revisar aportes",
      href: "/preview/finanzas-2026/campanas",
      proposal: false,
      tone: "neutral",
    });
  }

  const order: AttentionGroup[] = ["integration", "records", "duplicate", "link", "difference", "refund", "deposit", "approve"];
  return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.ageDays - a.ageDays);
}

// ---------- Reportes ----------

export function reportNarrative(p: Period) {
  const s = periodSummary(p);
  const sources = incomeBySource(p).rows;
  const prevP = previousPeriod(p);
  const prev = prevP ? periodSummary(prevP) : null;
  const parts: string[] = [];
  const incomeCount = hasDetail(p) ? transactionsIn(p).filter((t) => isActive(t) && t.type === "income").length : null;
  parts.push(
    `En ${periodTitle(p).toLocaleLowerCase("es")} se registraron ingresos por ${clp(s.income)}${
      incomeCount !== null ? ` en ${incomeCount.toLocaleString("es-CL")} movimientos de ingreso` : ""
    }.`,
  );
  if (sources.length) {
    const [first, ...rest] = sources;
    parts.push(
      `La mayor fuente fue ${first.label} (${clp(first.amount)} · ${first.share})${
        rest.length ? `, seguida de ${rest.slice(0, 3).map((r) => `${r.label} (${r.share})`).join(", ")}` : ""
      }.`,
    );
  }
  if (s.sumUpGross) parts.push(`La tarjeta SumUp suma ${clp(s.sumUpGross)} en bruto; la comisión aún no está disponible.`);
  parts.push(
    s.expense
      ? `Los gastos registrados fueron ${clp(s.expense)} y el resultado del período es ${clp(s.result)}.`
      : "No se registraron gastos en el período.",
  );
  if (prev && prev.income && periodRangeNote(p) === null) {
    const diff = ((s.income - prev.income) / prev.income) * 100;
    const caveat = comparabilityNote(p);
    parts.push(
      caveat
        ? `Frente a ${periodTitle(prevP!).toLocaleLowerCase("es")} los ingresos ${diff >= 0 ? "subieron" : "bajaron"} un ${Math.abs(diff).toLocaleString("es-CL", { maximumFractionDigits: 1 })} %, pero la comparación no es homogénea: ese mes casi no se registraban diezmos ni gastos en CDS.`
        : `Frente a ${periodTitle(prevP!).toLocaleLowerCase("es")}, los ingresos ${diff >= 0 ? "subieron" : "bajaron"} un ${Math.abs(diff).toLocaleString("es-CL", { maximumFractionDigits: 1 })} %.`,
    );
  }
  return parts.join(" ");
}

export interface ReportAlert {
  tone: "review" | "info";
  text: string;
}

export function reportAlerts(p: Period): ReportAlert[] {
  const s = periodSummary(p);
  const alerts: ReportAlert[] = [];
  if (p.view === "month" && hasDetail(p)) {
    for (const date of datesOfMonth(periodKey(p)).filter((d) => d <= DEMO_TODAY)) {
      const st = dayStatus(date);
      for (const m of st.missingCash)
        alerts.push(
          date === DEMO_TODAY
            ? { tone: "info", text: `Culto en curso (${dayMonth(date)}): efectivo de ${AREA_LABEL[m.area]} por registrar; SumUp ${clp(m.sumUp)} en bruto.` }
            : { tone: "review", text: `Falta efectivo · ${AREA_LABEL[m.area]} — ${dayMonth(date)}: SumUp ${clp(m.sumUp)} en bruto, sin efectivo registrado.` },
        );
      if (st.noRecords) alerts.push({ tone: "review", text: `Sin registros — ${dayMonth(date)} (día de culto).` });
    }
  }
  if (s.income > 0 && s.expense === 0)
    alerts.push({ tone: "review", text: "No se registraron gastos en el período — verificar si faltan egresos." });
  if (s.sumUpGross > 0)
    alerts.push({ tone: "info", text: "Los montos SumUp están en bruto: la comisión aún no está disponible, por lo que lo depositado será menor." });
  if (s.sumUpByAccount.legacy > 0)
    alerts.push({ tone: "info", text: `SumUp histórico sin separar: ${clp(s.sumUpByAccount.legacy)}. No se atribuye a Ofrendas ni Cafetería.` });
  return alerts;
}

/** Áreas por día de culto en un mes (tabla de Reportes / Ofrendas / Cafetería). */
export function worshipDaysTable(period: string) {
  return datesOfMonth(period)
    .filter((d) => d <= DEMO_TODAY)
    .map((date) => {
      const day = TRANSACTIONS.filter((t) => t.date === date && isActive(t) && t.type === "income");
      const sum = (cat: string, card: boolean) =>
        day
          .filter((t) => t.category === cat && (card ? isSumUp(t) : t.method === "cash"))
          .reduce((a, t) => a + t.amount, 0);
      return {
        date,
        worship: isWorshipDay(date),
        ofrSumUp: sum(SOURCE.ofrendas, true),
        ofrCash: sum(SOURCE.ofrendas, false),
        cafSumUp: sum(SOURCE.cafeteria, true),
        cafCash: sum(SOURCE.cafeteria, false),
        legacy: sum(SOURCE.legacy, true),
        tithes: day.filter((t) => t.category === SOURCE.diezmos).reduce((a, t) => a + t.amount, 0),
        status: dayStatus(date),
      };
    })
    .filter((r) => r.worship || r.ofrSumUp + r.ofrCash + r.cafSumUp + r.cafCash + r.legacy > 0)
    .reverse();
}

/** Total del libro: las campañas son un libro aparte y nunca entran aquí. */
export function campaignTotals() {
  return CAMPAIGNS.map((c) => ({
    ...c,
    percent: c.goal ? Math.round((c.verified / c.goal) * 100) : 0,
    progress: c.goal ? Math.min(100, Math.round((c.verified / c.goal) * 100)) : 0,
    pending: CAMPAIGN_SUBMISSIONS.filter((s) => s.campaignId === c.id && s.status === "pending"),
  }));
}
