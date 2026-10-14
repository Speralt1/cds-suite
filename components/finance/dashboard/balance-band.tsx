// Resultado del período (Design Lock 28 §C1 "BalanceBand"): Ingresos − Gastos
// = Resultado como un libro contable. Solo presentación: todas las cifras
// llegan calculadas desde los resúmenes existentes.
import { ArrowDownLeft, ArrowUpRight, Clock, TriangleAlert } from "lucide-react";
import { clp, clpSigned } from "@/lib/finance/formatters";
import { variation } from "@/lib/finance/calculations";
import "./tokens.css";
import "./summary.css";

export interface BalanceBandPrevious {
  income: number;
  result: number;
  /** Nombre del período anterior en minúsculas: "septiembre", "2025". */
  label: string;
}

export interface BalanceBandProps {
  /** h3: "Resultado de octubre 2026" o "Resultado del sáb 3 oct". */
  title: string;
  income: number;
  expense: number;
  result: number;
  /** "Resultado del período" (mensual/anual) o "Resultado del día". */
  resultLabel?: string;
  /** Diezmos incluidos en los ingresos (subconjunto, nunca un hermano). */
  tithe?: number;
  /** Período anterior con movimientos; sin él no se muestran variaciones. */
  previous?: BalanceBandPrevious;
  /** Muestra "Comisión SumUp: pendiente de datos" en Gastos. */
  sumUpFeePending?: boolean;
  /** Chip "Sin gastos registrados. ¿Faltan egresos?" (solo con detalle). */
  showMissingExpenses?: boolean;
  /** Estado vacío: cifras neutras en $0 y esta nota. */
  emptyNote?: string;
}

// Static id: the leader's legacy and v1 summaries must render identical HTML
// (tests/platform/finance-parity-client), and useId would differ per root.
export const BALANCE_TITLE_ID = "fin-balance-title";
const TITLE_ID = BALANCE_TITLE_ID;

function pesos(value: number) {
  return `${Math.abs(Math.round(value)).toLocaleString("es-CL")} pesos`;
}

/** Resumen para lector de pantalla: "Ingresos 4.641.132 pesos menos gastos…". */
export function balanceSentence(income: number, expense: number, result: number) {
  const resultText =
    result < 0 ? `déficit de ${pesos(result)}` : pesos(result);
  return `Ingresos ${pesos(income)} menos gastos ${pesos(expense)}, resultado ${resultText}`;
}

function percentChange(current: number, previous: number) {
  const change = variation(current, previous);
  if (change === null) return null;
  const arrow = change >= 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(change).toLocaleString("es-CL", { maximumFractionDigits: 1 })} %`;
}

/** Variación del resultado en monto, nunca en % (la base puede ser negativa). */
export function resultChange(current: number, previous: number, label: string) {
  const diff = current - previous;
  if (diff === 0) return `Igual que ${label}`;
  return `${clp(Math.abs(diff))} ${diff > 0 ? "más" : "menos"} que ${label}`;
}

export function BalanceBand({
  title,
  income,
  expense,
  result,
  resultLabel = "Resultado del período",
  tithe,
  previous,
  sumUpFeePending = false,
  showMissingExpenses = false,
  emptyNote,
}: BalanceBandProps) {
  const empty = Boolean(emptyNote);
  const deficit = !empty && result < 0;
  const incomeChange = previous && !empty ? percentChange(income, previous.income) : null;
  return (
    <section className="fin-balance" aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID} className="fin-balance-title" tabIndex={-1}>
        {title}
      </h3>
      <p className="sr-only">{balanceSentence(income, expense, result)}</p>
      <dl className="fin-balance-dl">
        <div className="fin-balance-item is-income">
          <dt>
            <span className="fin-balance-icon is-income" aria-hidden="true">
              <ArrowDownLeft size={18} />
            </span>
            Ingresos
          </dt>
          <dd className={`fin-balance-amount${income > 0 ? " is-signed" : ""}`}>
            {clpSigned(income)}
          </dd>
          {tithe !== undefined && income > 0 && (
            <dd className="fin-balance-sub">Incluye diezmos {clp(tithe)}</dd>
          )}
          {incomeChange && previous && (
            <dd className="fin-balance-var">
              {incomeChange} vs. {previous.label}
            </dd>
          )}
        </div>
        <div className="fin-balance-item is-expense">
          <dt>
            <span className="fin-balance-icon is-expense" aria-hidden="true">
              <ArrowUpRight size={18} />
            </span>
            Gastos
          </dt>
          <dd className={`fin-balance-amount${expense > 0 ? " is-signed" : ""}`}>
            {clpSigned(-expense)}
          </dd>
          {showMissingExpenses && expense === 0 && income > 0 && (
            <dd className="fin-balance-chip">
              <TriangleAlert size={16} aria-hidden="true" />
              Sin gastos registrados. ¿Faltan egresos?
            </dd>
          )}
          {sumUpFeePending && (
            <dd className="fin-balance-sub">
              <span className="fin-balance-sub-pending">
                <Clock size={14} aria-hidden="true" />
                Comisión SumUp: pendiente de datos
              </span>
            </dd>
          )}
        </div>
        <div className={`fin-balance-item is-result${deficit ? " is-deficit" : ""}`}>
          <dt>
            {resultLabel}
            {deficit && <span className="fin-balance-deficit">Déficit</span>}
          </dt>
          <dd className="fin-balance-amount">{clpSigned(result, { plus: false })}</dd>
          <dd className="fin-balance-note">
            Ingresos menos gastos. No es dinero disponible.
          </dd>
          {previous && !empty && (
            <dd className="fin-balance-var">
              {resultChange(result, previous.result, previous.label)}
            </dd>
          )}
        </div>
      </dl>
      {emptyNote && <p className="fin-balance-empty">{emptyNote}</p>}
    </section>
  );
}

/** Cargando: misma caja con la altura final y `aria-busy`, sin ceros falsos. */
export function BalanceBandSkeleton({ title }: { title: string }) {
  return (
    <section className="fin-balance is-loading" aria-labelledby={TITLE_ID} aria-busy="true">
      <h3 id={TITLE_ID} className="fin-balance-title" tabIndex={-1}>
        {title}
      </h3>
      <p role="status" className="sr-only">
        Consultando información…
      </p>
      <div className="fin-balance-skeleton" aria-hidden="true">
        <span className="fin-skeleton" />
        <span className="fin-skeleton" />
        <span className="fin-skeleton" />
      </div>
    </section>
  );
}
