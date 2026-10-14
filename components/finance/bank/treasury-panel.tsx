"use client";
// Movimientos de tesorería (doc 30): depósitos caja→banco, retiros banco→caja,
// traspasos no-gasto, abonos no-ingreso y ajustes manuales. NO son ingresos ni
// gastos: no tocan los resúmenes mensuales. Se registran con
// finance.records.manage y solo se anulan con motivo.
import { useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { useAccess } from "@/lib/auth/access-provider";
import { can } from "@/lib/shared/access";
import { getFirebaseServices } from "@/lib/firebase";
import { clp, errorMessage } from "@/lib/finance/formatters";
import { createTreasuryTransfer, voidTreasuryTransfer, type TreasuryTransferDoc } from "@/lib/finance/bank-accounts";
import { santiagoToday, useRecentTreasury } from "@/lib/finance/bank-hooks";
import {
  directionFor,
  parseClpInput,
  TREASURY_HELP,
  TREASURY_LABELS,
  TREASURY_TYPES,
  validateTreasuryInput,
  type TreasuryDirection,
  type TreasuryType,
  type Ymd,
} from "@/lib/finance/bank-model";
import { Notice } from "../shared";
import { ymdLabel } from "./bank-balance-card";
import { Field } from "./field";
import styles from "./bank-forms.module.css";

export interface AdjustmentDraft {
  direction: TreasuryDirection;
  amount: number;
  note: string;
}

function TransferRow({ t, canManage }: { t: TreasuryTransferDoc; canManage: boolean }) {
  const { user } = useAuth();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sign = t.direction === "in" ? "+" : "−";
  const effect =
    t.type === "cash_deposit"
      ? "Banco + · Caja −"
      : t.type === "cash_withdrawal"
        ? "Banco − · Caja +"
        : t.direction === "in"
          ? "Banco +"
          : "Banco −";

  async function confirmVoid(event: React.FormEvent) {
    event.preventDefault();
    if (!user || busy) return;
    setBusy(true);
    setError("");
    try {
      await voidTreasuryTransfer(getFirebaseServices().db, user.uid, t, reason);
      setVoiding(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <span>{TREASURY_LABELS[t.type]}</span>
        {t.status === "voided" ? (
          <span className={styles.pillVoided}>Anulado</span>
        ) : (
          <span className={styles.pill}>Activo</span>
        )}
        <p className={styles.rowMeta}>
          {ymdLabel(t.date)} · {effect}
          {t.reason ? ` · Motivo: ${t.reason}` : ""}
          {t.note ? ` · ${t.note}` : ""}
          {t.status === "voided" && t.voidReason ? ` · Anulado: ${t.voidReason}` : ""}
        </p>
      </div>
      <span className={styles.amount}>
        {sign} {clp(t.amount)}
      </span>
      {canManage && t.status === "active" && !voiding && (
        <button type="button" className="button-secondary" onClick={() => setVoiding(true)}>
          Anular
        </button>
      )}
      {voiding && (
        <form className={styles.voidForm} onSubmit={confirmVoid}>
          <Field label="Motivo de la anulación">
            {(p) => <input {...p} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} required minLength={3} />}
          </Field>
          <button className="button-primary" disabled={busy || reason.trim().length < 3}>
            {busy ? "Anulando…" : "Confirmar anulación"}
          </button>
          <button type="button" className="button-secondary" disabled={busy} onClick={() => setVoiding(false)}>
            Cancelar
          </button>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
        </form>
      )}
    </li>
  );
}

export function TreasuryTransfersPanel({
  accountId,
  openingDate,
  draft = null,
}: {
  accountId: string;
  openingDate: Ymd | null;
  /** Ajuste sugerido por una conciliación: solo rellena el formulario. */
  draft?: AdjustmentDraft | null;
}) {
  const { user } = useAuth();
  const access = useAccess();
  const canManage = can(access, "finance.records.manage");
  const recent = useRecentTreasury(can(access, "finance.details.read"));
  const today = santiagoToday();
  const [type, setType] = useState<TreasuryType>(draft ? "adjustment" : "cash_deposit");
  const [direction, setDirection] = useState<TreasuryDirection | "">(draft?.direction ?? "");
  const [amount, setAmount] = useState(draft ? String(draft.amount) : "");
  const [date, setDate] = useState<Ymd>(today);
  const [note, setNote] = useState(draft?.note ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const items = recent.data.filter((t) => t.accountId === accountId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || busy) return;
    setError("");
    setSuccess("");
    const parsed = parseClpInput(amount);
    const input = {
      accountId,
      type,
      direction: (directionFor(type, direction || undefined) ?? "") as TreasuryDirection,
      amount: parsed ?? NaN,
      date,
      note,
      reason,
    };
    const problem = validateTreasuryInput(input, { today, openingDate });
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await createTreasuryTransfer(getFirebaseServices().db, user.uid, input, { today, openingDate });
      setAmount("");
      setNote("");
      setReason("");
      setSuccess("Movimiento de tesorería registrado. No cambia el resultado contable.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="treasury-title">
      <h3 id="treasury-title" className={styles.heading}>
        Movimientos entre caja y banco
      </h3>
      <p className={styles.lead}>
        Depósitos, retiros, traspasos y ajustes. No son ingresos ni gastos: no cambian el resultado contable,
        solo dónde está el dinero. Para corregir uno, anúlalo con motivo y regístralo de nuevo.
      </p>
      {canManage ? (
        openingDate ? (
          <form className={styles.form} onSubmit={submit} noValidate>
            <Field label="Tipo de movimiento" help={TREASURY_HELP[type]} full>
              {(p) => (
                <select {...p} value={type} onChange={(e) => setType(e.target.value as TreasuryType)}>
                  {TREASURY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TREASURY_LABELS[t]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {type === "adjustment" && (
              <fieldset className={`${styles.radios} ${styles.full}`}>
                <legend>Efecto en el banco</legend>
                <label>
                  <input type="radio" name="direction" checked={direction === "in"} onChange={() => setDirection("in")} />
                  Suma al banco
                </label>
                <label>
                  <input type="radio" name="direction" checked={direction === "out"} onChange={() => setDirection("out")} />
                  Resta al banco
                </label>
              </fieldset>
            )}
            <Field label="Monto (CLP)">
              {(p) => <input {...p} inputMode="numeric" value={amount} placeholder="Ej. 150.000" onChange={(e) => setAmount(e.target.value)} />}
            </Field>
            <Field label="Fecha" help={`Posterior al corte (${ymdLabel(openingDate)}).`}>
              {(p) => <input {...p} type="date" value={date} min={openingDate} max={today} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label={type === "adjustment" ? "Motivo del ajuste (obligatorio, 10+ caracteres)" : "Motivo (opcional)"} full>
              {(p) => <input {...p} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}
            </Field>
            <Field label="Nota (opcional)" full>
              {(p) => <input {...p} value={note} maxLength={300} placeholder="Ej. N° de comprobante" onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <div className={`${styles.actions} ${styles.full}`}>
              <button className="button-primary" disabled={busy}>
                {busy ? "Guardando…" : "Registrar movimiento"}
              </button>
            </div>
          </form>
        ) : (
          <p className={styles.empty}>Primero un administrador debe configurar el saldo inicial de la cuenta.</p>
        )
      ) : (
        <p className={styles.empty}>Solo pueden registrar movimientos quienes gestionan registros financieros.</p>
      )}
      <Notice error={error || recent.error} success={success} />
      {recent.loading ? (
        <p className={styles.empty} role="status">
          Cargando movimientos…
        </p>
      ) : items.length ? (
        <ul className={styles.list} aria-label="Últimos movimientos de tesorería">
          {items.map((t) => (
            <TransferRow key={t.id} t={t} canManage={canManage} />
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>Aún no hay movimientos de tesorería registrados.</p>
      )}
    </section>
  );
}
