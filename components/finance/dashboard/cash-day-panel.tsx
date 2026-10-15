// Panel del día del calendario de caja (Design Lock 28 §C2 "Panel del día").
// Mismo contenido en línea (≥52rem) o dentro del diálogo (modo apilado).
import { useId, type Ref } from "react";
import { Banknote, ChevronLeft, ChevronRight, CircleDashed, Clock3 } from "lucide-react";
import { clp } from "@/lib/finance/formatters";
import {
  CASH_AREAS,
  dayWarnings,
  isSumUpTransaction,
  type CashAreaLabel,
  type DayStatus,
} from "@/lib/finance/insights";
import { MONTHS } from "@/lib/finance/constants";
import type { FinanceTransaction } from "@/lib/finance/types";
import type { CashArea } from "@/lib/offerings/cash";
import "./tokens.css";
import "./cash-calendar.css";

export const AREA_TO_KEY: Record<string, CashArea> = {
  Ofrendas: "offerings",
  Cafetería: "cafeteria",
};

/** "sábado 3 de octubre" (minúsculas, para aria-label y frases). */
export function longDayLabel(date: string) {
  const [, month, day] = date.split("-").map(Number);
  const weekday = new Date(`${date}T12:00:00.000Z`).toLocaleDateString("es-CL", {
    weekday: "long",
    timeZone: "UTC",
  });
  return `${weekday} ${day} de ${MONTHS[month - 1].toLowerCase()}`;
}

export function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "sáb 3 oct". */
export function dateLabelShort(date: string) {
  const [, month, day] = date.split("-").map(Number);
  const weekday = new Date(`${date}T12:00:00.000Z`).toLocaleDateString("es-CL", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${weekday} ${day} ${MONTHS[month - 1].slice(0, 3).toLowerCase()}`;
}

/** Encabezado del día: "Sábado 3 de octubre · Culto". */
export function dayTitle(date: string, status?: DayStatus) {
  return `${capitalize(longDayLabel(date))}${status?.isWorshipDay ? " · Culto" : ""}`;
}

export function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString("es-CL")} ${count === 1 ? one : many}`;
}

// "Ingresos del día" (§D "Panel del día" / §C1.5): rows for Ofrendas,
// Cafetería, Diezmos, SumUp histórico sin separar and Otros ingresos, split
// into SumUp / Efectivo / Depósitos / Total. Zero rows are hidden.
// Depósitos = paymentMethod "transfer" only (R2.5). A card charge that did not
// come from SumUp, or method "other", is NOT a deposit: it goes to
// `otherMethods`, which the table shows ("Otros medios") only when non-zero.
export function dayBreakdown(transactions: FinanceTransaction[], date: string) {
  const period = date.slice(0, 7);
  const day = String(Number(date.slice(8, 10)));
  const dayTx = transactions.filter(
    (t) => t.status === "active" && t.period === period && t.day === day,
  );
  const definitions: [string, (t: FinanceTransaction) => boolean][] = [
    ["Ofrendas", (t) => t.type === "income" && t.category === "Ofrendas"],
    ["Cafetería", (t) => t.type === "income" && t.category === "Cafetería"],
    ["Diezmos", (t) => t.type === "income" && t.source === "tithe"],
    [
      "SumUp histórico sin separar",
      (t) => t.type === "income" && t.category === "SumUp histórico sin separar",
    ],
    [
      "Otros ingresos",
      (t) =>
        t.type === "income" &&
        t.source !== "tithe" &&
        !["Ofrendas", "Cafetería", "SumUp histórico sin separar"].includes(t.category),
    ],
  ];
  const rows = definitions
    .map(([label, match]) => {
      const items = dayTx.filter(match);
      const sumUp = items
        .filter((t) => t.paymentMethod === "card" && isSumUpTransaction(t.id, t.createdBy))
        .reduce((s, t) => s + t.amount, 0);
      const cash = items
        .filter((t) => t.paymentMethod === "cash")
        .reduce((s, t) => s + t.amount, 0);
      const deposits = items
        .filter((t) => t.paymentMethod === "transfer")
        .reduce((s, t) => s + t.amount, 0);
      const otherMethods = items
        .filter(
          (t) =>
            t.paymentMethod !== "cash" &&
            t.paymentMethod !== "transfer" &&
            !(t.paymentMethod === "card" && isSumUpTransaction(t.id, t.createdBy)),
        )
        .reduce((s, t) => s + t.amount, 0);
      return { label, sumUp, cash, deposits, otherMethods, total: sumUp + cash + deposits + otherMethods };
    })
    .filter((row) => row.total > 0);
  const expenses = dayTx
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const sum = (key: "sumUp" | "cash" | "deposits" | "otherMethods") => rows.reduce((s, r) => s + r[key], 0);
  const totals = { sumUp: sum("sumUp"), cash: sum("cash"), deposits: sum("deposits"), otherMethods: sum("otherMethods") };
  const totalIncome = rows.reduce((s, r) => s + r.total, 0);
  return { rows, totals, expenses, totalIncome, showOtherMethods: totals.otherMethods > 0 };
}

// "Efectivo por área" (R2.5). One row per area with a state:
//  - "registered": cash of the area > 0 that day (aggregated amount);
//  - "pending": SumUp > 0 and cash == 0 (same rule/guards as
//    `dayStatus().pendingCashAreas`: on/after SPLIT and up to today);
//  - a single "no-records" row when the worship day has no Ofrendas/Cafetería.
// Areas without any of these states get no row. `show` follows the handoff:
// only when the day has Ofrendas/Cafetería activity or is a worship day.
export type CashAreaRow =
  | { kind: "registered"; area: CashAreaLabel; cash: number }
  | { kind: "pending"; area: CashAreaLabel }
  | { kind: "no-records" };

export function cashAreaRows(
  transactions: FinanceTransaction[],
  date: string,
  status?: DayStatus,
): { show: boolean; rows: CashAreaRow[] } {
  const period = date.slice(0, 7);
  const day = String(Number(date.slice(8, 10)));
  const areaIncome = transactions.filter(
    (t) =>
      t.status === "active" &&
      t.type === "income" &&
      t.period === period &&
      t.day === day &&
      (CASH_AREAS as readonly string[]).includes(t.category),
  );
  const rows: CashAreaRow[] = [];
  for (const area of CASH_AREAS) {
    const cash = areaIncome
      .filter((t) => t.category === area && t.paymentMethod === "cash")
      .reduce((s, t) => s + t.amount, 0);
    if (cash > 0) rows.push({ kind: "registered", area, cash });
    else if (status?.pendingCashAreas.includes(area)) rows.push({ kind: "pending", area });
  }
  if (status?.noRecords) rows.push({ kind: "no-records" });
  const show = (areaIncome.length > 0 || !!status?.isWorshipDay) && rows.length > 0;
  return { show, rows };
}

export interface WarningNavigation {
  /** Posición (1-based) del día seleccionado entre los días pendientes; null si no es uno. */
  position: number | null;
  /** Cantidad de días pendientes del mes. */
  total: number;
  onPrevious?: () => void;
  onNext?: () => void;
}

export interface CashDayPanelProps {
  date: string;
  status?: DayStatus;
  transactions: FinanceTransaction[];
  /** Solo con finance.records.manage: abre el CashModal con área y fecha. */
  onRegisterCash?: (area: CashArea) => void;
  /** false dentro del diálogo (el título del diálogo ya nombra el día). */
  showHeading?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  navigation?: WarningNavigation;
  variant?: "card" | "plain";
}

function RegisterCashButtons({
  areas,
  onRegisterCash,
}: {
  areas: readonly CashAreaLabel[];
  onRegisterCash: (area: CashArea) => void;
}) {
  return (
    <div className="fin-day-actions">
      {areas.map((area) => (
        <button
          key={area}
          type="button"
          className="button-secondary"
          onClick={() => onRegisterCash(AREA_TO_KEY[area])}
        >
          <Banknote size={16} aria-hidden="true" />
          Registrar efectivo · {area}
        </button>
      ))}
    </div>
  );
}

function CashAreaItem({
  row,
  onRegisterCash,
}: {
  row: CashAreaRow;
  onRegisterCash?: (area: CashArea) => void;
}) {
  if (row.kind === "registered")
    return (
      <li className="fin-area-row is-registered">
        <Banknote size={16} aria-hidden="true" />
        <div className="fin-area-body">
          <p className="fin-area-line">
            <span className="fin-area-name">{row.area}</span>
            <span className="fin-area-sep" aria-hidden="true">·</span>
            <span className="fin-area-state">Efectivo registrado</span>
            <span className="fin-area-amount">{clp(row.cash)}</span>
          </p>
        </div>
      </li>
    );
  if (row.kind === "pending")
    return (
      <li className="fin-area-row is-pending">
        <Clock3 size={16} aria-hidden="true" />
        <div className="fin-area-body">
          <p className="fin-area-line">
            <span className="fin-area-name">{row.area}</span>
            <span className="fin-area-sep" aria-hidden="true">·</span>
            <span className="fin-area-state">Efectivo pendiente de confirmar</span>
          </p>
          <p className="fin-area-sub">SumUp registró ventas. El efectivo aún no se ha registrado.</p>
          {onRegisterCash && <RegisterCashButtons areas={[row.area]} onRegisterCash={onRegisterCash} />}
        </div>
      </li>
    );
  return (
    <li className="fin-area-row is-empty">
      <CircleDashed size={16} aria-hidden="true" />
      <div className="fin-area-body">
        <p className="fin-area-line">Sin registros de Ofrendas ni Cafetería</p>
        {onRegisterCash && <RegisterCashButtons areas={CASH_AREAS} onRegisterCash={onRegisterCash} />}
      </div>
    </li>
  );
}

export function CashDayPanel({
  date,
  status,
  transactions,
  onRegisterCash,
  showHeading = true,
  headingRef,
  navigation,
  variant = "card",
}: CashDayPanelProps) {
  const areasTitleId = useId();
  const summaryTitleId = useId();
  const { rows, totals, expenses, totalIncome, showOtherMethods } = dayBreakdown(transactions, date);
  const areas = cashAreaRows(transactions, date, status);
  const pending = status ? dayWarnings(status, transactions).length : 0;
  const hasMovements = rows.length > 0 || expenses > 0;
  const actionable = areas.rows.some((row) => row.kind !== "registered");
  const title = dayTitle(date, status);
  const announcement = `${capitalize(longDayLabel(date))}: ${
    pending ? plural(pending, "pendiente", "pendientes") : "sin pendientes"
  }`;
  const cell = (label: string, value: number, extra = "") => (
    <td data-label={label} className={[extra, value ? "" : "is-zero"].filter(Boolean).join(" ") || undefined}>
      {value ? clp(value) : "—"}
    </td>
  );
  const methodCells = (values: { sumUp: number; cash: number; deposits: number; otherMethods: number }) => (
    <>
      {cell("SumUp", values.sumUp, "is-method")}
      {cell("Efectivo", values.cash, "is-method")}
      {cell("Depósitos", values.deposits, "is-method")}
      {showOtherMethods && cell("Otros medios", values.otherMethods, "is-method")}
    </>
  );
  return (
    <div className={`fin-day-panel${variant === "plain" ? " is-plain" : ""}`}>
      {showHeading && (
        <div className="fin-day-head">
          <h3 className="fin-day-title" ref={headingRef} tabIndex={-1}>
            {title}
          </h3>
          {status?.isToday && <span className="fin-day-today">Hoy</span>}
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {areas.show && (
        <section className="fin-day-section" aria-labelledby={areasTitleId}>
          <h4 id={areasTitleId} className="fin-day-section-title">Efectivo por área</h4>
          <ul className="fin-area-list">
            {areas.rows.map((row) => (
              <CashAreaItem
                key={row.kind === "no-records" ? row.kind : `${row.kind}-${row.area}`}
                row={row}
                onRegisterCash={onRegisterCash}
              />
            ))}
          </ul>
          {!onRegisterCash && actionable && (
            <p className="fin-readonly-note">
              Puedes revisar este día, pero no registrar movimientos.
            </p>
          )}
        </section>
      )}

      <section className="fin-day-section" aria-labelledby={summaryTitleId}>
        <h4 id={summaryTitleId} className="fin-day-section-title">Resumen del día</h4>
        {rows.length ? (
          <table className="fin-day-table">
            <caption>Montos SumUp en bruto, antes de comisión.</caption>
            <thead>
              <tr>
                <th scope="col">Fuente</th>
                <th scope="col">SumUp</th>
                <th scope="col">Efectivo</th>
                <th scope="col">Depósitos</th>
                {showOtherMethods && <th scope="col">Otros medios</th>}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {methodCells(row)}
                  <td data-label="Total" className="is-total is-strong">
                    {clp(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total del día</th>
                {methodCells(totals)}
                <td data-label="Total" className="is-total is-strong">
                  {clp(totalIncome)}
                </td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className="fin-day-empty">
            {status?.isFuture
              ? "Día futuro: aún no hay registros."
              : hasMovements
                ? "Sin ingresos este día."
                : "Sin movimientos activos este día."}
          </p>
        )}
        {expenses > 0 && <p className="fin-day-expenses">Gastos del día: {clp(expenses)}</p>}
      </section>

      {navigation && navigation.total > 0 && (
        <nav className="fin-day-nav" aria-label="Días pendientes del mes">
          {/* aria-disabled (not disabled): at the first/last pending day the
              button keeps the focus instead of dropping it to <body>. */}
          <button type="button" onClick={navigation.onPrevious} aria-disabled={!navigation.onPrevious}>
            <ChevronLeft size={16} aria-hidden="true" />
            Día pendiente anterior
          </button>
          <span className="fin-day-nav-count">
            {navigation.position
              ? `${navigation.position} de ${navigation.total}`
              : plural(navigation.total, "día pendiente", "días pendientes")}
            {navigation.position ? <span className="sr-only"> días pendientes</span> : null}
          </span>
          <button type="button" onClick={navigation.onNext} aria-disabled={!navigation.onNext}>
            Siguiente día pendiente
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}
