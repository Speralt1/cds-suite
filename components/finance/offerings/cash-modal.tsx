"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { errorMessage } from "@/lib/finance/formatters";
import type { FinanceTransaction } from "@/lib/finance/types";
import { findActiveDailyCash, saveDailyCash, type CashArea } from "@/lib/offerings/cash";
import { Modal, Notice } from "@/components/finance/shared";

const SUMUP_SPLIT_START_DATE = "2026-09-09";

const AREA_LABELS: Record<CashArea, string> = {
  offerings: "Ofrendas",
  cafeteria: "Cafetería",
};

// Extracted from offerings-page.tsx (Slice 6 §C1.1) so the Resumen and the
// day panel can open the same modal, with an area selector added on top.
// Saving behavior (saveDailyCash) is unchanged.
export function CashModal({
  area,
  date,
  allTransactionsForDay,
  loading,
  onAreaChange,
  onDateChange,
  onClose,
  onSaved,
}: {
  area: CashArea;
  date: string;
  allTransactionsForDay: FinanceTransaction[];
  loading: boolean;
  onAreaChange: (area: CashArea) => void;
  onDateChange: (date: string) => void;
  onClose: () => void;
  onSaved?: (message: string) => void;
}) {
  const { user } = useAuth();
  const existing = findActiveDailyCash(allTransactionsForDay, area, date);
  const label = AREA_LABELS[area];
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [note, setNote] = useState(existing?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || busy || loading) return;

    setBusy(true);
    setError("");

    try {
      await saveDailyCash(
        getFirebaseServices().db,
        user.uid,
        area,
        date,
        Number(amount),
        note,
        existing,
        allTransactionsForDay,
      );
      onSaved?.(
        existing
          ? "Efectivo actualizado correctamente"
          : "Efectivo registrado correctamente",
      );
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${existing ? "Editar" : "Ingresar"} efectivo · ${label}`}
      onClose={onClose}
      busy={busy}
    >
      <form className="finance-form" onSubmit={submit}>
        <fieldset disabled={busy || loading}>
          <label>
            Área
            <select
              value={area}
              onChange={(e) => onAreaChange(e.target.value as CashArea)}
            >
              <option value="offerings">Ofrendas</option>
              <option value="cafeteria">Cafetería</option>
            </select>
          </label>

          <label>
            Fecha correspondiente
            <input
              type="date"
              min={SUMUP_SPLIT_START_DATE}
              max="2099-12-31"
              value={date}
              required
              onChange={(e) => onDateChange(e.target.value)}
            />
            <span className="field-help">
              Puedes registrar hoy el efectivo de un día anterior.
            </span>
          </label>

          <div className="notice success">
            <p>
              Se registrará como ingreso de {label} en efectivo
              correspondiente al {date} y se sumará automáticamente
              a Finanzas.
            </p>
          </div>

          <label>
            Efectivo recaudado
            <input
              required
              data-autofocus
              inputMode="numeric"
              pattern="[0-9]+"
              value={amount}
              placeholder="0"
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            />
          </label>

          <label>
            Nota (opcional)
            <textarea
              rows={2}
              value={note}
              maxLength={500}
              placeholder={
                area === "offerings"
                  ? "Ej. Servicio domingo AM"
                  : "Ej. Ventas domingo AM"
              }
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <Notice error={error} />
        </fieldset>

        <div className="form-footer">
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>

          <button className="button-primary" disabled={busy || loading}>
            {busy
              ? "Guardando…"
              : existing
                ? "Actualizar efectivo"
                : "Registrar efectivo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
