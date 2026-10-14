"use client";
// Conciliación (doc 30): Tesorería anota el saldo que ve en el banco; la app
// muestra el saldo estimado a esa fecha y la diferencia. Se guarda como foto
// (solo creación). NUNCA crea ajustes: si la diferencia está confirmada, la
// persona debe registrar explícitamente un ajuste manual.
import { useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { useAccess } from "@/lib/auth/access-provider";
import { can } from "@/lib/shared/access";
import { getFirebaseServices } from "@/lib/firebase";
import { clp, errorMessage } from "@/lib/finance/formatters";
import { createReconciliation } from "@/lib/finance/bank-accounts";
import { santiagoToday, useBankBalance, useRecentReconciliations } from "@/lib/finance/bank-hooks";
import type { SumupPayoutsInput } from "@/lib/finance/bank-balance";
import { parseClpInput, validateReconciliationInput, type Ymd } from "@/lib/finance/bank-model";
import { Notice } from "../shared";
import { ymdLabel } from "./bank-balance-card";
import { Field } from "./field";
import type { AdjustmentDraft } from "./treasury-panel";
import styles from "./bank-forms.module.css";

export function ReconciliationPanel({
  accountId,
  payouts,
  onPrepareAdjustment,
}: {
  accountId: string;
  payouts?: SumupPayoutsInput;
  /** Rellena (no envía) el formulario de ajuste manual. */
  onPrepareAdjustment?: (draft: AdjustmentDraft) => void;
}) {
  const { user } = useAuth();
  const access = useAccess();
  const canRead = can(access, "finance.details.read");
  const canManage = can(access, "finance.records.manage");
  const today = santiagoToday();
  const [date, setDate] = useState<Ymd>(today);
  const [reported, setReported] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ difference: number; date: Ymd } | null>(null);
  const estimate = useBankBalance({ accountId, payouts, asOf: date, enabled: canRead });
  const recent = useRecentReconciliations(canRead);
  const items = recent.data.filter((r) => r.accountId === accountId);

  const r = estimate.result;
  const expected = r?.bank?.estimated ?? null;
  const reportedValue = parseClpInput(reported);
  const difference = expected !== null && reportedValue !== null ? reportedValue - expected : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || busy || !estimate.account || expected === null) return;
    setError("");
    setSaved(null);
    const input = {
      accountId,
      date,
      reportedBalance: reportedValue ?? NaN,
      expectedBalance: expected,
      estimateComplete: r?.status === "complete",
      openingRevision: estimate.account.revision,
      note,
    };
    const problem = validateReconciliationInput(input, { today, openingDate: r?.openingDate ?? null });
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await createReconciliation(getFirebaseServices().db, user.uid, input, { today, openingDate: r?.openingDate ?? null });
      setSaved({ difference: input.reportedBalance - expected, date });
      setReported("");
      setNote("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="reconciliation-title">
      <h3 id="reconciliation-title" className={styles.heading}>
        Conciliar con el banco
      </h3>
      <p className={styles.lead}>
        Anota el saldo que muestra el banco para una fecha y compáralo con el estimado. Registrar una conciliación no
        cambia ningún saldo ni crea ajustes.
      </p>
      {!canManage ? (
        <p className={styles.empty}>Solo pueden conciliar quienes gestionan registros financieros.</p>
      ) : estimate.loading ? (
        <p className={styles.empty} role="status">
          Calculando saldo estimado…
        </p>
      ) : !r?.bank ? (
        <p className={styles.empty}>Primero un administrador debe configurar el saldo inicial de la cuenta.</p>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <Field label="Fecha del saldo del banco">
            {(p) => <input {...p} type="date" value={date} min={r.openingDate ?? undefined} max={today} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label="Saldo que muestra el banco (CLP)" help="Puede ser negativo si la cuenta está en sobregiro.">
            {(p) => <input {...p} inputMode="numeric" value={reported} placeholder="Ej. 1.250.000" onChange={(e) => setReported(e.target.value)} />}
          </Field>
          <dl className={`${styles.result} ${styles.full}`} aria-live="polite">
            <div>
              <dt>Saldo estimado al {ymdLabel(date)}</dt>
              <dd className={expected !== null && expected < 0 ? styles.negative : ""}>{expected !== null ? clp(expected) : "—"}</dd>
            </div>
            <div>
              <dt>Saldo del banco</dt>
              <dd>{reportedValue !== null ? clp(reportedValue) : "—"}</dd>
            </div>
            <div>
              <dt>Diferencia (banco − estimado)</dt>
              <dd>
                {difference === null ? "—" : difference === 0 ? "Sin diferencia" : `${difference > 0 ? "+" : "−"} ${clp(Math.abs(difference))}`}
              </dd>
            </div>
          </dl>
          {r.status === "partial" && (
            <p className={`${styles.help} ${styles.full}`} role="note">
              El estimado está incompleto ({r.incompleteReasons.join(" ")}). La diferencia puede deberse a eso: revisa
              antes de ajustar.
            </p>
          )}
          <Field label="Nota (opcional)" full>
            {(p) => <input {...p} value={note} maxLength={500} placeholder="Ej. Cartola web al cierre del día" onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <div className={`${styles.actions} ${styles.full}`}>
            <button className="button-primary" disabled={busy || reportedValue === null}>
              {busy ? "Guardando…" : "Guardar conciliación"}
            </button>
          </div>
        </form>
      )}
      <Notice error={error || estimate.error || recent.error} />
      {saved && (
        <div className={styles.confirm} role="status">
          {saved.difference === 0 ? (
            <p>Conciliación guardada: el saldo del banco coincide con el estimado.</p>
          ) : (
            <>
              <p>
                Conciliación guardada con una diferencia de{" "}
                <strong>
                  {saved.difference > 0 ? "+" : "−"} {clp(Math.abs(saved.difference))}
                </strong>
                . No se creó ningún ajuste.
              </p>
              <p>
                Si confirmaste la diferencia con la cartola (comisiones, intereses, un abono o gasto sin registrar),
                registra el movimiento que falta o un ajuste manual con su motivo.
              </p>
              {onPrepareAdjustment && (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() =>
                      onPrepareAdjustment({
                        direction: saved.difference > 0 ? "in" : "out",
                        amount: Math.abs(saved.difference),
                        note: `Conciliación del ${ymdLabel(saved.date)}`,
                      })
                    }
                  >
                    Preparar ajuste manual
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {items.length > 0 && (
        <ul className={styles.list} aria-label="Conciliaciones anteriores">
          {items.map((c) => (
            <li className={styles.row} key={c.id}>
              <div className={styles.rowMain}>
                <span>Conciliación del {ymdLabel(c.date)}</span>
                {!c.estimateComplete && <span className={styles.pillVoided}>Estimado incompleto</span>}
                <p className={styles.rowMeta}>
                  Banco {clp(c.reportedBalance)} · Estimado {clp(c.expectedBalance)}
                  {c.note ? ` · ${c.note}` : ""}
                </p>
              </div>
              <span className={`${styles.amount} ${c.difference < 0 ? styles.negative : ""}`}>
                {c.difference === 0 ? "Sin diferencia" : `${c.difference > 0 ? "+" : "−"} ${clp(Math.abs(c.difference))}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
