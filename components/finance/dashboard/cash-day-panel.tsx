// Panel del día del calendario de caja (Design Lock 28 §C2 "Panel del día").
// Mismo contenido en línea (≥52rem) o dentro del diálogo (modo apilado).
import type { Ref } from "react";
import { Banknote, ChevronLeft, ChevronRight, CircleDashed, TriangleAlert } from "lucide-react";
import { clp } from "@/lib/finance/formatters";
import {
  dayWarnings,
  isSumUpTransaction,
  type DayStatus,
  type DayWarning,
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
// into SumUp bruto / Efectivo / Otros / Total. Zero rows are hidden.
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
      const other = items
        .filter(
          (t) =>
            t.paymentMethod !== "cash" &&
            !(t.paymentMethod === "card" && isSumUpTransaction(t.id, t.createdBy)),
        )
        .reduce((s, t) => s + t.amount, 0);
      return { label, sumUp, cash, other, total: sumUp + cash + other };
    })
    .filter((row) => row.total > 0);
  const expenses = dayTx
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const totalIncome = rows.reduce((s, r) => s + r.total, 0);
  return { rows, expenses, totalIncome };
}

export interface WarningNavigation {
  /** Posición (1-based) del día seleccionado entre los días con advertencias; null si no es uno. */
  position: number | null;
  /** Cantidad de días del mes con advertencias. */
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
  /** Vista Diario de la fecha. Sin él, "Revisar movimientos" enlaza a la lista de abajo. */
  onReviewMovements?: () => void;
  /** false dentro del diálogo (el título del diálogo ya nombra el día). */
  showHeading?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  navigation?: WarningNavigation;
  variant?: "card" | "plain";
}

const MOVEMENTS_ANCHOR = "#fin-movements";

function ReviewAction({ onReview, label }: { onReview?: () => void; label: string }) {
  return onReview ? (
    <button type="button" className="button-secondary" onClick={onReview}>
      {label}
    </button>
  ) : (
    <a className="button-secondary" href={MOVEMENTS_ANCHOR}>
      {label}
    </a>
  );
}

function WarningCard({
  warning,
  onRegisterCash,
  onReviewMovements,
}: {
  warning: DayWarning;
  onRegisterCash?: (area: CashArea) => void;
  onReviewMovements?: () => void;
}) {
  const missing = warning.kind === "missing-cash";
  const shown = warning.transactions.slice(0, 3);
  const registerAreas = missing && warning.area ? [warning.area] : ["Ofrendas", "Cafetería"];
  return (
    <li className="fin-warning-card">
      <p className="fin-warning-type">
        {missing ? (
          <TriangleAlert size={16} aria-hidden="true" />
        ) : (
          <CircleDashed size={16} aria-hidden="true" />
        )}
        {warning.label}
      </p>
      <p className="fin-warning-cause">
        <span className="fin-warning-label">Causa</span>
        {missing
          ? `SumUp registró ${clp(warning.sumUpAmount)} en ${warning.area} este día, pero no hay efectivo de ${warning.area} registrado.`
          : "Es día de culto y no hay ingresos de Ofrendas ni de Cafetería registrados."}
      </p>
      {shown.length > 0 && (
        <div>
          <span className="fin-warning-label">Movimientos asociados</span>
          <ul className="fin-warning-movs">
            {shown.map((t) => (
              <li key={t.id}>
                <span>{t.description || t.category}</span>
                <span>{clp(t.amount)}</span>
              </li>
            ))}
          </ul>
          {warning.transactions.length > shown.length &&
            (onReviewMovements ? (
              <button type="button" className="fin-warning-link" onClick={onReviewMovements}>
                Ver los {warning.transactions.length} movimientos
              </button>
            ) : (
              <a className="fin-warning-link" href={MOVEMENTS_ANCHOR}>
                Ver los {warning.transactions.length} movimientos
              </a>
            ))}
        </div>
      )}
      <p>
        <span className="sr-only">Estado: </span>
        <span className="fin-warning-state">Pendiente</span>
      </p>
      <div className="fin-warning-actions">
        {onRegisterCash &&
          registerAreas.map((area) => (
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
        <ReviewAction onReview={onReviewMovements} label="Revisar movimientos" />
      </div>
      {!onRegisterCash && (
        <p className="fin-readonly-note">
          Puedes revisar este día, pero no registrar movimientos.
        </p>
      )}
    </li>
  );
}

export function CashDayPanel({
  date,
  status,
  transactions,
  onRegisterCash,
  onReviewMovements,
  showHeading = true,
  headingRef,
  navigation,
  variant = "card",
}: CashDayPanelProps) {
  const { rows, expenses, totalIncome } = dayBreakdown(transactions, date);
  const warnings = status ? dayWarnings(status, transactions) : [];
  const title = dayTitle(date, status);
  const announcement = `${capitalize(longDayLabel(date))}: ${
    warnings.length ? plural(warnings.length, "advertencia", "advertencias") : "sin advertencias"
  }`;
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

      {warnings.length > 0 && (
        <section className="fin-day-section" aria-label={`Advertencias (${warnings.length})`}>
          <h4 className="fin-day-section-title">Advertencias ({warnings.length})</h4>
          <ul className="fin-warning-list">
            {warnings.map((warning) => (
              <WarningCard
                key={`${warning.kind}-${warning.area || ""}`}
                warning={warning}
                onRegisterCash={onRegisterCash}
                onReviewMovements={onReviewMovements}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="fin-day-section" aria-label="Ingresos del día">
        <h4 className="fin-day-section-title">Ingresos del día</h4>
        {rows.length ? (
          <table className="fin-day-table">
            <thead>
              <tr>
                <th scope="col">Fuente</th>
                <th scope="col">SumUp bruto</th>
                <th scope="col">Efectivo</th>
                <th scope="col">Otros</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td data-label="SumUp bruto">{row.sumUp ? clp(row.sumUp) : "—"}</td>
                  <td data-label="Efectivo">{row.cash ? clp(row.cash) : "—"}</td>
                  <td data-label="Otros">{row.other ? clp(row.other) : "—"}</td>
                  <td data-label="Total" className="is-strong">
                    {clp(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Gastos</th>
                <td colSpan={3} className="is-blank" />
                <td>{clp(expenses)}</td>
              </tr>
              <tr>
                <th scope="row">Total ingresos del día</th>
                <td colSpan={3} className="is-blank" />
                <td className="is-strong">{clp(totalIncome)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className="fin-day-empty">
            {status?.isFuture ? "Día futuro: aún no hay registros." : "Sin movimientos activos este día."}
          </p>
        )}
        {onReviewMovements && warnings.length === 0 && (
          <div className="fin-warning-actions mt-3">
            <ReviewAction onReview={onReviewMovements} label="Ver movimientos del día" />
          </div>
        )}
      </section>

      {navigation && navigation.total > 0 && (
        <nav className="fin-day-nav" aria-label="Advertencias del mes">
          <button type="button" onClick={navigation.onPrevious} disabled={!navigation.onPrevious}>
            <ChevronLeft size={16} aria-hidden="true" />
            Advertencia anterior
          </button>
          <span className="fin-day-nav-count">
            {navigation.position
              ? `${navigation.position} de ${navigation.total}`
              : plural(navigation.total, "día con advertencias", "días con advertencias")}
            {navigation.position ? <span className="sr-only"> días con advertencias</span> : null}
          </span>
          <button type="button" onClick={navigation.onNext} disabled={!navigation.onNext}>
            Siguiente advertencia
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}
