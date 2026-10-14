"use client";
// Configuración › Finanzas › Banco y caja (doc 30). El saldo inicial lo fija un
// administrador desde una cartola (con confirmación e historial inmutable).
// Debajo, los paneles de tesorería y conciliación (reutilizables en Finanzas).
import { useState } from "react";
import { History, Landmark } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { useAccess } from "@/lib/auth/access-provider";
import { can } from "@/lib/shared/access";
import { getFirebaseServices } from "@/lib/firebase";
import { clp, errorMessage } from "@/lib/finance/formatters";
import { saveBankAccount, type BankAccountDoc } from "@/lib/finance/bank-accounts";
import { santiagoToday, useBankAccount, useBankHistory } from "@/lib/finance/bank-hooks";
import { useSumupPayoutsForBank } from "@/lib/finance/sumup-payouts-client";
import {
  DEFAULT_BANK_ACCOUNT_ID,
  DEFAULT_BANK_ACCOUNT_NAME,
  parseClpInput,
  validateBankAccountInput,
  type BankAccountInput,
} from "@/lib/finance/bank-model";
import { Notice } from "@/components/finance/shared";
import { ymdLabel } from "@/components/finance/bank/bank-balance-card";
import { TreasuryTransfersPanel, type AdjustmentDraft } from "@/components/finance/bank/treasury-panel";
import { ReconciliationPanel } from "@/components/finance/bank/reconciliation-panel";
import { Field } from "@/components/finance/bank/field";
import styles from "@/components/finance/bank/bank-forms.module.css";

function OpeningBalanceForm({
  account,
  onDone,
}: {
  account: BankAccountDoc | null;
  onDone: (message: string) => void;
}) {
  const { user } = useAuth();
  const today = santiagoToday();
  const [name, setName] = useState(account?.name ?? DEFAULT_BANK_ACCOUNT_NAME);
  const [balance, setBalance] = useState(account ? String(account.openingBalance) : "");
  const [negativeOk, setNegativeOk] = useState((account?.openingBalance ?? 0) < 0);
  const [date, setDate] = useState(account?.openingDate ?? "");
  const [cash, setCash] = useState(account?.openingCash != null ? String(account.openingCash) : "");
  const [reference, setReference] = useState(account?.statementReference ?? "");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<BankAccountInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isUpdate = !!account;

  function prepare(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const openingBalance = parseClpInput(balance);
    const openingCash = cash.trim() ? parseClpInput(cash) : null;
    if (openingBalance === null) return setError("Ingresa el saldo de la cartola como un monto entero en pesos.");
    if (cash.trim() && openingCash === null) return setError("El efectivo inicial debe ser un monto entero en pesos.");
    if (openingBalance < 0 && !negativeOk)
      return setError("El saldo es negativo. Marca la casilla de sobregiro para confirmar que la cartola lo muestra así.");
    const input: BankAccountInput = { name, openingBalance, openingDate: date, openingCash, statementReference: reference };
    const problem = validateBankAccountInput(input, { today, reason, isUpdate });
    if (problem) return setError(problem);
    setReview(input);
  }

  async function confirm() {
    if (!user || !review || busy) return;
    setBusy(true);
    setError("");
    try {
      await saveBankAccount(getFirebaseServices().db, user.uid, DEFAULT_BANK_ACCOUNT_ID, review, {
        expectedRevision: account?.revision ?? 0,
        reason,
        today,
      });
      onDone(isUpdate ? "Saldo inicial actualizado. El cambio quedó en el historial." : "Saldo inicial configurado. Quedó registrado en el historial.");
    } catch (e) {
      setError(errorMessage(e));
      setReview(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className={styles.form} onSubmit={prepare} noValidate>
        <Field label="Nombre de la cuenta" full>
          {(p) => <input {...p} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={!!review} />}
        </Field>
        <Field label="Saldo según cartola (CLP)" help="Saldo disponible al cierre del día de corte, tal como aparece en la cartola.">
          {(p) => (
            <input
              {...p}
              inputMode="numeric"
              value={balance}
              placeholder="Ej. 1.250.000"
              onChange={(e) => setBalance(e.target.value)}
              disabled={!!review}
            />
          )}
        </Field>
        <Field label="Fecha de corte" help="Se cuentan los movimientos desde el día siguiente.">
          {(p) => <input {...p} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} disabled={!!review} />}
        </Field>
        {(parseClpInput(balance) ?? 0) < 0 && (
          <label className={`${styles.check} ${styles.full}`}>
            <input type="checkbox" checked={negativeOk} onChange={(e) => setNegativeOk(e.target.checked)} disabled={!!review} />
            La cartola muestra un saldo negativo (sobregiro o línea de crédito usada).
          </label>
        )}
        <Field label="Efectivo contado en caja ese día (opcional)" help="Si se deja vacío, la caja muestra solo lo registrado desde el corte.">
          {(p) => <input {...p} inputMode="numeric" value={cash} placeholder="Ej. 85.000" onChange={(e) => setCash(e.target.value)} disabled={!!review} />}
        </Field>
        <Field label="Referencia de la cartola (opcional)">
          {(p) => <input {...p} value={reference} maxLength={120} placeholder="Ej. Cartola N° 45" onChange={(e) => setReference(e.target.value)} disabled={!!review} />}
        </Field>
        {isUpdate && (
          <Field label="Motivo del cambio" full>
            {(p) => <input {...p} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} disabled={!!review} />}
          </Field>
        )}
        {!review && (
          <div className={`${styles.actions} ${styles.full}`}>
            <button className="button-primary">Revisar antes de guardar</button>
          </div>
        )}
      </form>
      {review && (
        <div className={styles.confirm} role="group" aria-label="Confirmar saldo inicial">
          <p>
            Vas a fijar el saldo de <strong>{review.name.trim()}</strong> en{" "}
            <strong>{clp(review.openingBalance)}</strong> al cierre del <strong>{ymdLabel(review.openingDate)}</strong>
            {review.openingCash !== null ? (
              <>
                {" "}y el efectivo en caja en <strong>{clp(review.openingCash)}</strong>
              </>
            ) : null}
            . El saldo estimado se recalculará desde el día siguiente. Este cambio queda en el historial.
          </p>
          <div className={styles.actions}>
            <button type="button" className="button-primary" disabled={busy} onClick={() => void confirm()}>
              {busy ? "Guardando…" : "Confirmar y guardar"}
            </button>
            <button type="button" className="button-secondary" disabled={busy} onClick={() => setReview(null)}>
              Volver a editar
            </button>
          </div>
        </div>
      )}
      <Notice error={error} />
    </>
  );
}

function OpeningBalanceSection() {
  const access = useAccess();
  const canSettings = can(access, "settings.manage");
  const account = useBankAccount(DEFAULT_BANK_ACCOUNT_ID, can(access, "finance.details.read"));
  const history = useBankHistory(DEFAULT_BANK_ACCOUNT_ID, can(access, "finance.details.read"));
  const [editing, setEditing] = useState(false);
  const [success, setSuccess] = useState("");
  const a = account.data;

  return (
    <section className={styles.panel} aria-labelledby="opening-title">
      <h3 id="opening-title" className={styles.heading}>
        <Landmark size={18} aria-hidden="true" className="mr-2 inline align-[-3px]" />
        Saldo inicial de la cuenta
      </h3>
      <p className={styles.lead}>
        CDS Suite no conoce el saldo del banco: solo registra movimientos desde agosto de 2026. Para estimarlo se
        necesita el saldo de una cartola a una fecha de corte. Nada se calcula ni se ajusta automáticamente.
      </p>
      {account.loading ? (
        <p className={styles.empty} role="status">
          Cargando…
        </p>
      ) : a ? (
        <dl className={styles.summary}>
          <div>
            <dt>Cuenta</dt>
            <dd>{a.name}</dd>
          </div>
          <div>
            <dt>Saldo según cartola</dt>
            <dd className={a.openingBalance < 0 ? styles.negative : ""}>{clp(a.openingBalance)}</dd>
          </div>
          <div>
            <dt>Fecha de corte</dt>
            <dd>{ymdLabel(a.openingDate)}</dd>
          </div>
          <div>
            <dt>Efectivo inicial</dt>
            <dd>{a.openingCash != null ? clp(a.openingCash) : "No informado"}</dd>
          </div>
          {a.statementReference && (
            <div>
              <dt>Referencia</dt>
              <dd>{a.statementReference}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className={styles.empty}>Saldo pendiente de configurar.</p>
      )}
      <Notice error={account.error || history.error} success={success} />
      {canSettings && !editing && !account.loading && (
        <div className={styles.actions} style={{ marginTop: 14 }}>
          <button
            type="button"
            className={a ? "button-secondary" : "button-primary"}
            onClick={() => {
              setSuccess("");
              setEditing(true);
            }}
          >
            {a ? "Cambiar saldo inicial" : "Configurar saldo inicial"}
          </button>
        </div>
      )}
      {canSettings && editing && (
        <OpeningBalanceForm
          key={a?.revision ?? 0}
          account={a}
          onDone={(message) => {
            setEditing(false);
            setSuccess(message);
          }}
        />
      )}
      {history.data.length > 0 && (
        <>
          <h4 className="mt-5 flex items-center gap-2 text-sm font-semibold">
            <History size={16} aria-hidden="true" />
            Historial de cambios
          </h4>
          <ul className={styles.list} aria-label="Historial del saldo inicial">
            {history.data.map((h) => (
              <li className={styles.row} key={h.id}>
                <div className={styles.rowMain}>
                  <span>
                    Revisión {h.revision} · {h.action === "created" ? "Configuración inicial" : "Cambio"}
                  </span>
                  <p className={styles.rowMeta}>
                    Corte {ymdLabel(h.openingDate)}
                    {h.openingCash != null ? ` · Efectivo ${clp(h.openingCash)}` : ""}
                    {h.statementReference ? ` · ${h.statementReference}` : ""}
                    {h.reason ? ` · Motivo: ${h.reason}` : ""}
                    {h.at?.toDate ? ` · ${h.at.toDate().toLocaleString("es-CL", { timeZone: "America/Santiago" })}` : ""}
                  </p>
                </div>
                <span className={`${styles.amount} ${h.openingBalance < 0 ? styles.negative : ""}`}>{clp(h.openingBalance)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Sección completa "Banco y caja" para Configuración › Finanzas. */
export function BankCashSettingsPanel() {
  const access = useAccess();
  const account = useBankAccount();
  const openingDate = account.data?.openingDate ?? null;
  // Abonos SumUp (callable de solo lectura del PR C); falla cerrado a "no disponible".
  const payouts = useSumupPayoutsForBank(openingDate, santiagoToday(), can(access, "finance.details.read"));
  const payoutsAvailable = payouts?.status === "available" && !(payouts.partialReasons?.length);
  const [draft, setDraft] = useState<{ id: number; value: AdjustmentDraft } | null>(null);
  return (
    <section id="banco-y-caja" className={styles.section} aria-labelledby="bank-cash-title">
      <div className="section-heading">
        <div>
          <h3 id="bank-cash-title" className="text-base leading-6 font-semibold text-ink">
            Banco y caja
          </h3>
          <p>Saldo inicial, movimientos entre caja y banco, y conciliación con la cartola.</p>
        </div>
      </div>
      <OpeningBalanceSection />
      <TreasuryTransfersPanel
        key={draft?.id ?? 0}
        accountId={DEFAULT_BANK_ACCOUNT_ID}
        openingDate={openingDate}
        draft={draft?.value ?? null}
        payoutsAvailable={payoutsAvailable}
      />
      <ReconciliationPanel
        accountId={DEFAULT_BANK_ACCOUNT_ID}
        payouts={payouts}
        onPrepareAdjustment={(value) => {
          setDraft((d) => ({ id: (d?.id ?? 0) + 1, value }));
          document.getElementById("treasury-title")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        }}
      />
    </section>
  );
}
