"use client";
import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import {
  saveTransaction,
  newTransactionId,
  transactionInput,
} from "@/lib/finance/transactions";
import {
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
} from "@/lib/finance/constants";
import { clp, errorMessage, today } from "@/lib/finance/formatters";
import type {
  FinanceTransaction,
  TransactionInput,
  TransactionType,
  PaymentMethod,
  TitheProfile,
} from "@/lib/finance/types";
import { Modal, Notice } from "../shared";
export function TransactionForm({
  existing,
  profile,
  onClose,
  onSaved,
}: {
  existing?: FinanceTransaction;
  profile?: TitheProfile;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const tithe = existing?.source === "tithe" || !!profile;
  const { user } = useAuth();
  const [id] = useState(
    () => existing?.id || newTransactionId(getFirebaseServices().db),
  );
  const [input, setInput] = useState<TransactionInput>(() =>
    existing
      ? transactionInput(existing)
      : {
          type: "income",
          amount: 0,
          date: today(),
          category: tithe ? "Diezmos" : INCOME_CATEGORIES[0],
          paymentMethod: "cash",
          description: tithe ? "Diezmo" : "",
          note: "",
        },
  );
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const update = (key: keyof TransactionInput, value: string) =>
    setInput({ ...input, [key]: value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current || !user) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!/^\d+$/.test(amount))
        throw new Error(
          "Ingresa el monto en pesos enteros, sin puntos ni decimales.",
        );
      await saveTransaction(
        getFirebaseServices().db,
        user.uid,
        id,
        { ...input, amount: Number(amount) },
        {
          existing,
          profileId: profile?.id,
          privateNote: tithe ? input.note : undefined,
        },
      );
      onSaved(
        existing
          ? "Movimiento actualizado correctamente"
          : tithe
            ? "Diezmo registrado correctamente"
            : "Movimiento registrado correctamente",
      );
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        existing
          ? "Editar movimiento"
          : tithe
            ? "Registrar diezmo"
            : "Registrar movimiento"
      }
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={save} className="finance-form">
        <fieldset disabled={busy}>
          {profile && (
            <p className="notice success">
              {profile.displayName} ·{" "}
              {profile.type === "family" ? "Familia" : "Persona"}
            </p>
          )}
          {!tithe && (
            <fieldset className="mb-5">
              <legend>¿Qué quieres registrar?</legend>
              <div className="segmented mt-2">
                {(["income", "expense"] as TransactionType[]).map((type) => (
                  <button
                    type="button"
                    key={type}
                    aria-pressed={input.type === type}
                    onClick={() =>
                      setInput({
                        ...input,
                        type,
                        category:
                          type === "income"
                            ? INCOME_CATEGORIES[0]
                            : EXPENSE_CATEGORIES[0],
                      })
                    }
                  >
                    {type === "income" ? "Entrada" : "Salida"}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <label>
            Monto CLP
            <input
              autoFocus
              data-autofocus
              className="amount-input"
              inputMode="numeric"
              maxLength={13}
              pattern="[0-9]+"
              placeholder="0"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-describedby="amount-help"
            />
            <span id="amount-help" className="field-help">
              {amount && /^\d+$/.test(amount)
                ? clp(Number(amount))
                : "Pesos enteros, sin puntos ni decimales."}
            </span>
          </label>
          <div className="form-grid">
            <label>
              Fecha
              <input
                type="date"
                min="2000-01-01"
                max="2099-12-31"
                value={input.date}
                required
                onChange={(e) => update("date", e.target.value)}
              />
            </label>
            <label>
              Método de pago
              <select
                value={input.paymentMethod}
                onChange={(e) =>
                  update("paymentMethod", e.target.value as PaymentMethod)
                }
              >
                {Object.entries(PAYMENT_METHODS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!tithe && (
            <>
              <label>
                Categoría
                <select
                  required
                  value={input.category}
                  onChange={(e) => update("category", e.target.value)}
                >
                  {(input.type === "income"
                    ? INCOME_CATEGORIES
                    : EXPENSE_CATEGORIES
                  ).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Descripción
                <input
                  value={input.description}
                  maxLength={200}
                  required
                  placeholder="Ej. Ofrenda culto del domingo"
                  onChange={(e) => update("description", e.target.value)}
                />
              </label>
            </>
          )}
          {!(tithe && existing) && (
            <label>
              {tithe ? "Nota privada (opcional)" : "Nota (opcional)"}
              <textarea
                value={input.note}
                maxLength={1000}
                rows={2}
                onChange={(e) => update("note", e.target.value)}
              />
            </label>
          )}
          <Notice error={error} />
        </fieldset>
        <div className="form-footer">
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="button-primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
