"use client";
import { useId, useRef, useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { voidTransaction } from "@/lib/finance/transactions";
import { clp, dateLabel, errorMessage } from "@/lib/finance/formatters";
import { isSumUpTransaction } from "@/lib/finance/insights";
import { PAYMENT_METHODS } from "@/lib/finance/constants";
import type { MovementEntry } from "@/lib/finance/movement-groups";
import type { FinanceTransaction } from "@/lib/finance/types";
import { Modal, Notice, TypeIcon } from "../shared";
import { TransactionForm } from "../forms/transaction-form";

// El encabezado se dibuja una sola vez en TransactionTable; TransactionRow
// es la fila (usada por TransactionList y, en Movimientos, mezclada con
// SumUpGroupRow) y trae su propio estado de modal.
export function TransactionTable({
  actions = true,
  children,
}: {
  actions?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="transaction-table">
      <div className="transaction-head">
        <span>Fecha / Categoría</span>
        <span>Descripción / Método</span>
        <span>Monto / Estado</span>
        {actions && <span>Acciones</span>}
      </div>
      {children}
    </div>
  );
}

export function TransactionRow({
  t,
  onSaved = () => {},
  actions = true,
}: {
  t: FinanceTransaction;
  onSaved?: (s: string) => void;
  // true: acciones completas (Ver + Editar/Anular, o el candado SumUp).
  // "view-only": solo "Ver", sin editar ni anular (detalle de un grupo SumUp).
  // false: sin columna de acciones.
  actions?: boolean | "view-only";
  }) {
  const [selected, setSelected] = useState<"view" | "edit" | "void" | null>(
    null,
  );
  const sumUpImported = isSumUpTransaction(t.id, t.createdBy);
  return (
    <>
      <article
        key={t.id}
        className={`transaction-row ${t.status === "voided" ? "is-voided" : ""}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <TypeIcon income={t.type === "income"} />
          <div className="min-w-0">
            <p className="font-medium break-words">{t.category}</p>
            <p className="field-help">
              {dateLabel(t.date)} · {t.type === "income" ? "Entrada" : "Salida"}
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
            <button onClick={() => setSelected("view")}>Ver</button>
            {actions !== "view-only" && t.status === "active" && sumUpImported && (
              <span
                className="status-pill"
                title="Los movimientos importados se corrigen en SumUp; el sistema los actualiza automáticamente."
              >
                <Lock size={13} />
                SumUp · solo lectura
              </span>
            )}
            {actions !== "view-only" && t.status === "active" && !sumUpImported && (
              <>
                <button onClick={() => setSelected("edit")}>Editar</button>
                <button
                  className="text-danger"
                  onClick={() => setSelected("void")}
                >
                  Anular
                </button>
              </>
            )}
          </div>
        )}
      </article>
      {selected === "edit" && (
        <TransactionForm
          existing={t}
          onSaved={onSaved}
          onClose={() => setSelected(null)}
        />
      )}
      {selected === "view" && (
        <Modal title="Detalle del movimiento" onClose={() => setSelected(null)}>
          <div className="finance-form">
            <dl className="detail-grid">
              {[
                ["Monto", clp(t.amount)],
                ["Fecha", dateLabel(t.date)],
                ["Categoría", t.category],
                ["Descripción", t.description],
                ["Método", PAYMENT_METHODS[t.paymentMethod]],
                ["Nota", t.note || "Sin nota"],
                ["Estado", t.status === "active" ? "Activo" : "Anulado"],
                ["Creado por", t.createdBy],
                ["Creado el", dateLabel(t.createdAt)],
                ["Modificado por", t.updatedBy],
                ["Modificado el", dateLabel(t.updatedAt)],
                ...(t.status === "voided"
                  ? [
                      ["Motivo de anulación", t.voidReason || ""],
                      ["Anulado por", t.voidedBy || ""],
                      ["Anulado el", dateLabel(t.voidedAt)],
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
      {selected === "void" && (
        <VoidForm
          transaction={t}
          onClose={() => setSelected(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

export function SumUpGroupRow({
  group,
  onSaved = () => {},
}: {
  group: Extract<MovementEntry, { kind: "sumup-group" }>;
  onSaved?: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const isVoided = group.status === "voided";
  return (
    <>
      <article
        className={`transaction-row is-group ${isVoided ? "is-voided" : ""}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <TypeIcon income={group.type === "income"} />
          <div className="min-w-0">
            <p className="font-medium break-words">{group.label}</p>
            <p className="field-help">
              {dateLabel(group.date)} ·{" "}
              {group.type === "income" ? "Entrada" : "Salida"}
            </p>
          </div>
        </div>
        <div className="min-w-0">
          <p className="break-words">
            {group.count === 1 ? "1 pago" : `${group.count} pagos con tarjeta`}
          </p>
          <p className="field-help">Tarjeta · SumUp</p>
        </div>
        <div>
          <p className="font-semibold tabular-nums">{clp(group.amount)}</p>
          <span className={`status-pill ${isVoided ? "voided" : ""}`}>
            {isVoided ? "Anulado" : "Bruto"}
          </span>
        </div>
        <div className="transaction-actions">
          {!isVoided && (
            <span
              className="status-pill"
              title="Los movimientos importados se corrigen en SumUp; el sistema los actualiza automáticamente."
            >
              <Lock size={13} />
              SumUp · solo lectura
            </span>
          )}
          <button
            type="button"
            className="group-toggle"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown
              size={16}
              aria-hidden="true"
              className="group-toggle-chevron"
              style={{
                transform: open ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 150ms",
              }}
            />
            {open ? `Ocultar ${group.count} pagos` : `Ver ${group.count} pagos`}
          </button>
        </div>
      </article>
      {open && (
        <div id={detailId} className="transaction-group-detail">
          {group.items.map((t) => (
            <TransactionRow
              key={t.id}
              t={t}
              onSaved={onSaved}
              actions="view-only"
            />
          ))}
        </div>
      )}
    </>
  );
}

export function TransactionList({
  items,
  onSaved = () => {},
  actions = true,
}: {
  items: FinanceTransaction[];
  onSaved?: (s: string) => void;
  actions?: boolean;
}) {
  return (
    <TransactionTable actions={actions}>
      {items.map((t) => (
        <TransactionRow key={t.id} t={t} onSaved={onSaved} actions={actions} />
      ))}
    </TransactionTable>
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
