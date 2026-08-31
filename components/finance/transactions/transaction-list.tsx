"use client";
import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { voidTransaction } from "@/lib/finance/transactions";
import { clp, dateLabel, errorMessage } from "@/lib/finance/formatters";
import { PAYMENT_METHODS } from "@/lib/finance/constants";
import type { FinanceTransaction } from "@/lib/finance/types";
import { Modal, Notice, TypeIcon } from "../shared";
import { TransactionForm } from "../forms/transaction-form";
export function TransactionList({
  items,
  onSaved = () => {},
  actions = true,
}: {
  items: FinanceTransaction[];
  onSaved?: (s: string) => void;
  actions?: boolean;
}) {
  const [selected, setSelected] = useState<{
    t: FinanceTransaction;
    action: "view" | "edit" | "void";
  } | null>(null);
  return (
    <>
      <div className="transaction-table">
        <div className="transaction-head">
          <span>Fecha / Categoría</span>
          <span>Descripción / Método</span>
          <span>Monto / Estado</span>
          {actions && <span>Acciones</span>}
        </div>
        {items.map((t) => (
          <article
            key={t.id}
            className={`transaction-row ${t.status === "voided" ? "is-voided" : ""}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <TypeIcon income={t.type === "income"} />
              <div className="min-w-0">
                <p className="font-medium break-words">{t.category}</p>
                <p className="field-help">
                  {dateLabel(t.date)} ·{" "}
                  {t.type === "income" ? "Entrada" : "Salida"}
                </p>
              </div>
            </div>
            <div className="min-w-0">
              <p className="break-words">
                {t.source === "tithe" ? "Diezmo" : t.description}
              </p>
              <p className="field-help">{PAYMENT_METHODS[t.paymentMethod]}</p>
            </div>
            <div>
              <p className="font-semibold tabular-nums">{clp(t.amount)}</p>
              <span
                className={`status-pill ${t.status === "voided" ? "voided" : ""}`}
              >
                {t.status === "voided" ? "Anulado" : "Activo"}
              </span>
            </div>
            {actions && (
              <div className="transaction-actions">
                <button onClick={() => setSelected({ t, action: "view" })}>
                  Ver
                </button>
                {t.status === "active" && (
                  <>
                    <button onClick={() => setSelected({ t, action: "edit" })}>
                      Editar
                    </button>
                    <button
                      className="text-danger"
                      onClick={() => setSelected({ t, action: "void" })}
                    >
                      Anular
                    </button>
                  </>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {selected?.action === "edit" && (
        <TransactionForm
          existing={selected.t}
          onSaved={onSaved}
          onClose={() => setSelected(null)}
        />
      )}{" "}
      {selected?.action === "view" && (
        <Modal title="Detalle del movimiento" onClose={() => setSelected(null)}>
          <div className="finance-form">
            <dl className="detail-grid">
              {[
                ["Monto", clp(selected.t.amount)],
                ["Fecha", dateLabel(selected.t.date)],
                ["Categoría", selected.t.category],
                ["Descripción", selected.t.description],
                ["Método", PAYMENT_METHODS[selected.t.paymentMethod]],
                ["Nota", selected.t.note || "Sin nota"],
                [
                  "Estado",
                  selected.t.status === "active" ? "Activo" : "Anulado",
                ],
                ["Creado por", selected.t.createdBy],
                ["Creado el", dateLabel(selected.t.createdAt)],
                ["Modificado por", selected.t.updatedBy],
                ["Modificado el", dateLabel(selected.t.updatedAt)],
                ...(selected.t.status === "voided"
                  ? [
                      ["Motivo de anulación", selected.t.voidReason || ""],
                      ["Anulado por", selected.t.voidedBy || ""],
                      ["Anulado el", dateLabel(selected.t.voidedAt)],
                    ]
                  : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Modal>
      )}
      {selected?.action === "void" && (
        <VoidForm
          transaction={selected.t}
          onClose={() => setSelected(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
function VoidForm({
  transaction,
  onClose,
  onSaved,
}: {
  transaction: FinanceTransaction;
  onClose: () => void;
  onSaved: (s: string) => void;
}) {
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current || !user) return;
    lock.current = true;
    setBusy(true);
    try {
      await voidTransaction(
        getFirebaseServices().db,
        user.uid,
        transaction,
        reason,
      );
      onSaved("Movimiento anulado correctamente");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title="Anular movimiento" onClose={onClose} busy={busy}>
      <form className="finance-form" onSubmit={submit}>
        <p className="mb-5 text-sm text-muted">
          Se descontará {clp(transaction.amount)} de los totales. El registro y
          su auditoría se conservarán; esta acción no se puede revertir.
        </p>
        <label>
          Motivo de anulación
          <textarea
            autoFocus
            data-autofocus
            required
            minLength={3}
            maxLength={300}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </label>
        <Notice error={error} />
        <div className="form-footer">
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="button-primary danger-button" disabled={busy}>
            {busy ? "Anulando…" : "Confirmar anulación"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
