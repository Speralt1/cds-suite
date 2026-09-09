"use client";
import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { deleteObject, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  saveTransaction,
  newTransactionId,
  transactionInput,
} from "@/lib/finance/transactions";
import { PAYMENT_METHODS } from "@/lib/finance/constants";
import {
  categoriesForTransaction,
  FALLBACK_INCOME_CATEGORIES,
} from "@/lib/settings/finance-settings";
import { useFinanceSettings } from "@/lib/settings/finance-settings-client";
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
  const settings = useFinanceSettings();
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
          category: tithe ? "Diezmos" : FALLBACK_INCOME_CATEGORIES[0],
          paymentMethod: "cash",
          description: tithe ? "Diezmo" : "",
          note: "",
        },
  );
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const categoryOptions = categoriesForTransaction(
    settings.data,
    input.type,
    existing?.type === input.type ? existing.category : undefined,
  );
  const update = (key: keyof TransactionInput, value: string) =>
    setInput({ ...input, [key]: value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current || !user) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const services = getFirebaseServices();
    const receiptPath = `tithe-receipts/${id}/receipt`;
    let receiptUploaded = false;

    try {
      if (!/^\d+$/.test(amount))
        throw new Error(
          "Ingresa el monto en pesos enteros, sin puntos ni decimales.",
        );

      if (receipt && tithe && !existing) {
        if (receipt.size > 10 * 1024 * 1024) {
          throw new Error(
            "El comprobante puede pesar como máximo 10 MB.",
          );
        }

        const receiptType =
          receipt.type ||
          (receipt.name.toLowerCase().endsWith(".pdf")
            ? "application/pdf"
            : "");

        if (
          !receiptType.startsWith("image/") &&
          receiptType !== "application/pdf"
        ) {
          throw new Error(
            "El comprobante debe ser una imagen o un PDF.",
          );
        }

        await uploadBytes(
          storageRef(services.storage, receiptPath),
          receipt,
          {
            contentType: receiptType,
            customMetadata: {
              originalName: receipt.name,
            },
          },
        );

        receiptUploaded = true;
      }

      await saveTransaction(
        services.db,
        user.uid,
        id,
        { ...input, amount: Number(amount) },
        {
          existing,
          profileId: profile?.id,
          privateNote: tithe ? input.note : undefined,
          allowedCategories: categoryOptions,
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
      if (receiptUploaded) {
        await deleteObject(
          storageRef(services.storage, receiptPath),
        ).catch(() => {});
      }

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
                        category: categoriesForTransaction(
                          settings.data,
                          type,
                        )[0],
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
                className={tithe ? "tithe-payment-select" : undefined}
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
                  {categoryOptions.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                {settings.error && (
                  <span className="field-help text-danger">
                    No se pudo confirmar la configuración. Se mantienen las
                    categorías compatibles de respaldo.
                  </span>
                )}
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

          {tithe && !existing && (
            <label className="tithe-receipt-field">
              Comprobante (opcional)
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) =>
                  setReceipt(e.target.files?.[0] || null)
                }
              />
              <span className="field-help">
                Foto o PDF · máximo 10 MB. Solo visible para
                Administración, Pastor y Finanzas.
              </span>
              {receipt && (
                <span className="field-help tithe-receipt-selected">
                  Archivo seleccionado: {receipt.name}
                </span>
              )}
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
