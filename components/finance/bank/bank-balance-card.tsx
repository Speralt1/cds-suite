"use client";
// Tarjeta "Saldo bancario estimado" (doc 30). Autocontenida: el tech lead la
// monta en Resumen (reemplaza "Cantidad de movimientos"). Cuatro cifras
// separadas y nunca mezcladas:
//   1. Saldo bancario estimado   2. Efectivo registrado en caja
//   3. SumUp pendiente de abono  4. Resultado contable del período (prop)
// Sin saldo inicial no muestra ningún número de banco.
import Link from "next/link";
import { useState } from "react";
import { CircleAlert, Info, Landmark, TriangleAlert } from "lucide-react";
import { useAccess } from "@/lib/auth/access-provider";
import { can } from "@/lib/shared/access";
import { clp } from "@/lib/finance/formatters";
import { useBankBalance, type BankBalanceState } from "@/lib/finance/bank-hooks";
import type { BreakdownLine, SumupPayoutsInput } from "@/lib/finance/bank-balance";
import { DEFAULT_BANK_ACCOUNT_ID } from "@/lib/finance/bank-model";
import { Modal } from "../shared";
import styles from "./bank-balance.module.css";

export const BANK_SETTINGS_HREF = "/configuracion/finanzas#banco-y-caja";

export interface PeriodResultProp {
  /** Ej. "Octubre 2026". */
  label: string;
  value: number;
}

/** "2026-09-30" → "30-09-2026". */
export function ymdLabel(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "—";
  const [y, m, d] = value.split("-");
  return `${d}-${m}-${y}`;
}

function Money({ value, className = "" }: { value: number; className?: string }) {
  return (
    <p className={`${styles.value} ${value < 0 ? styles.negative : ""} ${className}`}>
      {clp(value)}
      {value < 0 && <span className="sr-only"> (negativo)</span>}
    </p>
  );
}

function Figure({
  label,
  primary = false,
  children,
  hint,
  testId,
}: {
  label: string;
  primary?: boolean;
  children: React.ReactNode;
  hint: string;
  testId: string;
}) {
  return (
    <section
      className={`${styles.figure} ${primary ? styles.figurePrimary : ""}`}
      aria-label={label}
      data-testid={testId}
    >
      <h4 className={styles.label}>{label}</h4>
      {children}
      <p className={styles.hint}>{hint}</p>
    </section>
  );
}

function Lines({ lines, totalLabel, total }: { lines: BreakdownLine[]; totalLabel: string; total: number }) {
  return (
    <div className={styles.lines} role="list">
      {lines.map((l) => (
        <div className={styles.line} role="listitem" key={l.key}>
          <span className={styles.sign} aria-label={l.sign > 0 ? "suma" : "resta"}>
            {l.sign > 0 ? "+" : "−"}
          </span>
          <span className={styles.lineLabel}>{l.label}</span>
          <span className={styles.lineAmount}>
            {l.missing ? "No disponible" : clp(l.amount)}
          </span>
          <span className={styles.lineDetail}>
            {l.detail}
            {!l.missing && l.source !== "opening" && ` ${l.count.toLocaleString("es-CL")} registro(s).`}
          </span>
        </div>
      ))}
      <div className={styles.lineTotal} role="listitem">
        <span className={styles.sign} aria-hidden="true">=</span>
        <span className={styles.lineLabel}>{totalLabel}</span>
        <span className={`${styles.lineAmount} ${total < 0 ? styles.negative : ""}`}>{clp(total)}</span>
      </div>
    </div>
  );
}

export function BankBalanceBreakdown({ state }: { state: BankBalanceState }) {
  const r = state.result;
  if (!r || !r.bank || !r.cash)
    return (
      <div className={styles.sheet}>
        <p className={styles.sheetIntro}>
          Sin saldo inicial no se puede calcular el saldo bancario: los registros de CDS Suite solo
          empiezan en agosto de 2026 y no existe una cartola de partida.
        </p>
      </div>
    );
  return (
    <div className={styles.sheet}>
      <p className={styles.formula}>
        Saldo estimado = saldo de la cartola al cierre del {ymdLabel(r.openingDate)} + lo que entró
        al banco − lo que salió del banco, con movimientos desde el día siguiente hasta el{" "}
        {ymdLabel(r.asOf)}. Los anulados no cuentan.
      </p>
      <section className={styles.sheetSection}>
        <h3>Banco</h3>
        <Lines lines={r.bank.lines} totalLabel="Saldo bancario estimado" total={r.bank.estimated} />
      </section>
      <section className={styles.sheetSection}>
        <h3>Caja (efectivo)</h3>
        {!r.cash.includesOpeningCash && (
          <p className={styles.sheetIntro}>
            No hay efectivo inicial contado: la caja muestra solo lo registrado desde la fecha de corte.
          </p>
        )}
        <Lines lines={r.cash.lines} totalLabel="Efectivo registrado en caja" total={r.cash.amount} />
      </section>
      <section className={styles.sheetSection}>
        <h3>Qué no entra en el saldo</h3>
        <p className={styles.sheetIntro}>
          Las ventas con tarjeta SumUp entran al banco solo cuando SumUp las abona (neto de comisión,
          a veces agrupadas). El resultado contable del período (ingresos − gastos) es otra cifra: no
          es dinero en el banco.
        </p>
      </section>
      {(r.incompleteReasons.length > 0 || r.warnings.length > 0) && (
        <section className={styles.sheetSection}>
          <h3>Avisos</h3>
          <ul className={styles.notes}>
            {[...r.incompleteReasons, ...r.warnings].map((w) => (
              <li className={styles.note} key={w}>
                <TriangleAlert size={14} aria-hidden="true" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Vista pura (sin datos): la usan la tarjeta y los tests tipo "story". */
export function BankBalanceView({
  state,
  canConfigure,
  periodResult = null,
  configureHref = BANK_SETTINGS_HREF,
}: {
  state: BankBalanceState;
  canConfigure: boolean;
  periodResult?: PeriodResultProp | null;
  configureHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const r = state.result;
  const partial = r?.status === "partial";
  const payoutsMissing = !!r?.bank?.lines.find((l) => l.key === "sumupPayouts")?.missing;

  return (
    <article className={styles.card} aria-labelledby="bank-balance-title" aria-busy={state.loading || undefined}>
      <div className={styles.header}>
        <div>
          <h3 id="bank-balance-title" className={styles.title}>
            Banco y caja
          </h3>
          <p className={styles.subtitle}>
            Cifras estimadas a partir de la cartola inicial y los registros. No reemplazan la cartola del banco.
          </p>
        </div>
        {r?.bank && (
          <button type="button" className={styles.textButton} onClick={() => setOpen(true)}>
            <Info size={16} aria-hidden="true" />
            ¿Cómo se calcula?
          </button>
        )}
      </div>

      {state.loading ? (
        <div className={styles.grid} role="status" aria-label="Cargando saldo bancario estimado">
          {[0, 1, 2, 3].map((i) => (
            <div className={styles.skeleton} key={i} />
          ))}
        </div>
      ) : state.error && !r ? (
        <p role="alert" className={styles.error}>
          <CircleAlert size={18} aria-hidden="true" />
          <span>No pudimos calcular el saldo estimado. {state.error}</span>
        </p>
      ) : (
        <>
          <div className={styles.grid}>
            <Figure
              testId="bank-figure"
              primary
              label="Saldo bancario estimado"
              hint={
                r?.bank
                  ? "Lo que debería haber en la cuenta según la cartola inicial y lo registrado después."
                  : "Se necesita el saldo de una cartola a una fecha de corte. Sin él no se muestra ningún monto."
              }
            >
              {r?.bank ? (
                <>
                  <Money value={r.bank.estimated} />
                  <div className={styles.badges}>
                    <span className={styles.badge}>Estimado</span>
                    <span className={styles.badgeInfo}>Corte {ymdLabel(r.openingDate)}</span>
                    {partial && (
                      <span className={styles.badgeWarn}>
                        <TriangleAlert size={12} aria-hidden="true" />
                        {payoutsMissing ? "Incompleto: faltan abonos SumUp" : "Incompleto"}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.valueMuted}>Saldo pendiente de configurar</p>
                  {canConfigure ? (
                    <div className={styles.actions}>
                      <Link className={styles.linkButton} href={configureHref}>
                        <Landmark size={16} aria-hidden="true" />
                        Configurar saldo inicial
                      </Link>
                    </div>
                  ) : (
                    <p className={styles.hint}>
                      Debe configurarlo un administrador en Configuración › Finanzas › Banco y caja.
                    </p>
                  )}
                </>
              )}
            </Figure>

            <Figure
              testId="cash-figure"
              label="Efectivo registrado en caja"
              hint={
                r?.cash
                  ? r.cash.includesOpeningCash
                    ? "Efectivo inicial contado + ingresos en efectivo − gastos en efectivo ± depósitos y retiros."
                    : `Solo lo registrado desde el ${ymdLabel(r.openingDate)}: ingresos en efectivo − gastos en efectivo ± depósitos y retiros. No es un arqueo.`
                  : "Se calcula desde la fecha de corte del saldo inicial."
              }
            >
              {r?.cash ? <Money value={r.cash.amount} /> : <p className={styles.valueMuted}>Sin fecha de corte</p>}
            </Figure>

            <Figure
              testId="sumup-figure"
              label="SumUp pendiente de abono"
              hint="Ventas con tarjeta que SumUp aún no deposita. Monto bruto: todavía no descuenta comisiones."
            >
              {r && r.sumupPending !== null ? (
                <Money value={r.sumupPending} />
              ) : (
                <p className={styles.valueMuted}>Sin dato de SumUp</p>
              )}
            </Figure>

            <Figure
              testId="result-figure"
              label={periodResult ? `Resultado contable · ${periodResult.label}` : "Resultado contable del período"}
              hint="Ingresos − gastos del período. Es una cifra contable: no es dinero en el banco."
            >
              {periodResult ? <Money value={periodResult.value} /> : <p className={styles.valueMuted}>—</p>}
            </Figure>
          </div>

          {(state.limitReached || (state.error && r)) && (
            <ul className={styles.notes}>
              {state.limitReached && (
                <li className={styles.note}>
                  <TriangleAlert size={14} aria-hidden="true" />
                  <span>Límite alcanzado: hay más movimientos de los que se consultaron; el saldo puede estar incompleto.</span>
                </li>
              )}
              {state.error && r && (
                <li className={styles.note}>
                  <TriangleAlert size={14} aria-hidden="true" />
                  <span>{state.error}</span>
                </li>
              )}
            </ul>
          )}
        </>
      )}

      {open && (
        <Modal title="¿Cómo se calcula?" onClose={() => setOpen(false)} size="wide">
          <BankBalanceBreakdown state={state} />
        </Modal>
      )}
    </article>
  );
}

/**
 * Tarjeta con datos. Solo para quien puede ver el detalle financiero
 * (finance.details.read); para el resto no renderiza nada.
 * `payouts`: resultado de la callable sumupPayoutsReconciliation (ver
 * parseSumupPayoutsResponse); si no se entrega, el saldo queda "incompleto".
 */
export function BankBalanceCard({
  accountId = DEFAULT_BANK_ACCOUNT_ID,
  periodResult = null,
  payouts,
}: {
  accountId?: string;
  periodResult?: PeriodResultProp | null;
  payouts?: SumupPayoutsInput;
}) {
  const access = useAccess();
  const allowed = can(access, "finance.details.read");
  const state = useBankBalance({ accountId, payouts, enabled: allowed });
  if (!allowed) return null;
  return <BankBalanceView state={state} canConfigure={can(access, "settings.manage")} periodResult={periodResult} />;
}
