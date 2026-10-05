"use client";

import { useId, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { clp, errorMessage } from "@/lib/finance/formatters";
import type { FinanceTransaction } from "@/lib/finance/types";
import {
  findActiveDailyCash,
  previousCashServiceDate,
  saveDailyCash,
  sumUpCashForDay,
  type CashArea,
} from "@/lib/offerings/cash";
import { Modal, Notice } from "@/components/finance/shared";

const SUMUP_SPLIT_START_DATE = "2026-09-09";

const AREA_LABELS: Record<CashArea, string> = {
  offerings: "Ofrendas",
  cafeteria: "Cafetería",
};

function cashDateLabel(date: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

// Extracted from offerings-page.tsx (Slice 6 §C1.1) so the Resumen and the
// day panel can open the same modal, with an area selector added on top.
// Saving behavior (saveDailyCash) is unchanged.
export function CashModal({
  area,
  date,
  allTransactionsForDay,
  loading,
  loadError,
  onAreaChange,
  onDateChange,
  onClose,
  onSaved,
}: {
  area: CashArea;
  date: string;
  allTransactionsForDay: FinanceTransaction[];
  loading: boolean;
  loadError?: string;
  onAreaChange: (area: CashArea) => void;
  onDateChange: (date: string) => void;
  onClose: () => void;
  onSaved?: (message: string) => void;
}) {
  const { user } = useAuth();
  const existing = findActiveDailyCash(allTransactionsForDay, area, date);
  const sumUpCash = sumUpCashForDay(allTransactionsForDay, area, date);
  const sumUpWarningId = useId();
  const dateWarningId = useId();
  const suggestedDate = previousCashServiceDate(date);
  const label = AREA_LABELS[area];
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [note, setNote] = useState(existing?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || busy || loading || loadError || (suggestedDate && confirmedDate !== date)) return;

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
        <fieldset disabled={busy || loading || !!loadError}>
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
              aria-describedby={suggestedDate ? dateWarningId : undefined}
              onChange={(e) => {
                setConfirmedDate(null);
                onDateChange(e.target.value);
              }}
            />
            <span className="field-help">
              Puedes registrar hoy el efectivo de un día anterior.
            </span>
          </label>

          {suggestedDate && (
            <div className="notice-warning cash-date-warning" role="status" id={dateWarningId}>
              <TriangleAlert size={15} aria-hidden="true" />
              <div className="cash-date-warning-content">
                <p>
                  El {cashDateLabel(date)} no es miércoles ni domingo. Si estás registrando
                  efectivo después del servicio, la fecha de servicio anterior
                  más cercana es {cashDateLabel(suggestedDate)}.
                </p>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => {
                    setConfirmedDate(null);
                    onDateChange(suggestedDate);
                  }}
                >
                  Usar {cashDateLabel(suggestedDate)}
                </button>
                <label className="cash-date-confirm">
                  <input
                    type="checkbox"
                    checked={confirmedDate === date}
                    onChange={(event) => setConfirmedDate(event.target.checked ? date : null)}
                  />
                  Confirmo que el efectivo corresponde al {cashDateLabel(date)}.
                </label>
              </div>
            </div>
          )}

          <div className="notice success">
            <p>
              Se registrará como ingreso de {label} en efectivo
              correspondiente al {date} y se sumará automáticamente
              a Finanzas.
            </p>
          </div>

          {sumUpCash.count > 0 && (
            <p className="notice-warning" role="status" id={sumUpWarningId}>
              <TriangleAlert size={15} aria-hidden="true" />
              SumUp ya registró {clp(sumUpCash.amount)} en efectivo de{" "}
              {label} para este día. Ingresa aquí solo el efectivo que no se
              registró en SumUp, para no contarlo dos veces.
            </p>
          )}

          <label>
            Efectivo recaudado
            <input
              required
              data-autofocus
              aria-describedby={sumUpCash.count > 0 ? sumUpWarningId : undefined}
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

          <Notice error={loadError || error} />
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

          <button
            className="button-primary"
            disabled={busy || loading || !!loadError || Boolean(suggestedDate && confirmedDate !== date)}
          >
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
