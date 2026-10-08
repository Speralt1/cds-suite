"use client";

import { useEffect, useId, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { getFirebaseServices } from "@/lib/firebase";
import { clp, errorMessage } from "@/lib/finance/formatters";
import type { FinanceTransaction } from "@/lib/finance/types";
import {
  CASH_DATE_MAX,
  CASH_DATE_MIN,
  cashDateIssue,
  findActiveDailyCash,
  previousCashServiceDate,
  saveDailyCash,
  sumUpCashForDay,
  type CashArea,
} from "@/lib/offerings/cash";
import { Modal, Notice } from "@/components/finance/shared";

const AREA_LABELS: Record<CashArea, string> = {
  offerings: "Ofrendas",
  cafeteria: "Cafetería",
};

const NO_SUMUP_CASH = { amount: 0, count: 0 };

// After this long without a server-confirmed snapshot, say so instead of an
// endless "Cargando…" (e.g. a captive portal while navigator.onLine is true).
const SLOW_LOAD_MS = 12000;

function cashDateLabel(date: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

// What the amount/note fields were initialized from. `identity` names the
// record being edited (area, date and active record id, or "new"); `baseline`
// is that record as it was read, and is what gets saved against, so a record
// that changed meanwhile is rejected by saveTransaction's revision check
// instead of being overwritten.
type CashDraft = {
  identity: string;
  baseline: FinanceTransaction | undefined;
  amount: string;
  note: string;
};

function draftFor(identity: string, existing: FinanceTransaction | undefined): CashDraft {
  return {
    identity,
    baseline: existing,
    amount: existing ? String(existing.amount) : "",
    note: existing?.note || "",
  };
}

// Extracted from offerings-page.tsx (Slice 6 §C1.1) so the Resumen and the
// day panel can open the same modal, with an area selector added on top.
// Saving behavior (saveDailyCash) is unchanged.
//
// State safety (R0E): callers pass `loading` until the transactions for the
// month of `date` come from a live, server-confirmed snapshot. Until then, and
// while the typed date is empty or invalid, the record fields are not shown
// and nothing can be saved. Once ready, the fields are (re)initialized
// whenever the record identity changes, so an amount or note never carries
// over across areas, dates or records.
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
  const sumUpWarningId = useId();
  const dateWarningId = useId();
  const dateIssueId = useId();
  const label = AREA_LABELS[area];

  // The raw input value. Only valid dates reach the parent (which queries by
  // the date's month), so clearing or mistyping the date never breaks the page.
  const [typedDate, setTypedDate] = useState(date);
  // Defensive: if the parent changes `date` on its own, show that date.
  const [typedFor, setTypedFor] = useState(date);
  if (typedFor !== date) {
    setTypedFor(date);
    setTypedDate(date);
  }
  const dateIssue = cashDateIssue(typedDate);
  const dateSettled = !dateIssue && typedDate === date;
  const ready = dateSettled && !loading && !loadError;

  const existing = ready
    ? findActiveDailyCash(allTransactionsForDay, area, date)
    : undefined;
  const sumUpCash = ready
    ? sumUpCashForDay(allTransactionsForDay, area, date)
    : NO_SUMUP_CASH;
  const suggestedDate = dateSettled ? previousCashServiceDate(date) : null;

  const identity = ready ? `${area}|${date}|${existing?.id ?? "new"}` : null;
  const [draft, setDraft] = useState<CashDraft | null>(null);
  if (identity && draft?.identity !== identity) {
    setDraft(draftFor(identity, existing));
  }
  const active = identity && draft?.identity === identity ? draft : null;
  const record = active?.baseline;
  const [busy, setBusy] = useState(false);
  // While saving, our own write may arrive as a new revision: not a conflict.
  const recordChanged =
    !busy && !!record && !!existing && existing.revision !== record.revision;

  const waitingFor = dateSettled && !ready && !loadError ? `${area}|${date}` : null;
  const [slowFor, setSlowFor] = useState<string | null>(null);
  useEffect(() => {
    if (!waitingFor) return;
    const timer = setTimeout(() => setSlowFor(waitingFor), SLOW_LOAD_MS);
    return () => {
      clearTimeout(timer);
      // Every new wait (another date, or a reload of the same one) starts over.
      setSlowFor(null);
    };
  }, [waitingFor]);
  const slow = !!waitingFor && slowFor === waitingFor;

  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const confirmKey = `${area}|${date}`;
  const dateConfirmed = !suggestedDate || confirmed === confirmKey;
  const canSave = !!active && !busy && dateConfirmed && !recordChanged;

  function changeDate(next: string) {
    setTypedDate(next);
    setConfirmed(null);
    setError("");
    if (!cashDateIssue(next)) onDateChange(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !active || !canSave) return;

    setBusy(true);
    setError("");

    try {
      await saveDailyCash(
        getFirebaseServices().db,
        user.uid,
        area,
        date,
        Number(active.amount),
        active.note,
        active.baseline,
        allTransactionsForDay,
      );
      onSaved?.(
        active.baseline
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
      title={`${active ? (record ? "Editar" : "Ingresar") : "Registrar"} efectivo · ${label}`}
      onClose={onClose}
      busy={busy}
    >
      <form className="finance-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Área
            <select
              value={area}
              onChange={(e) => {
                setConfirmed(null);
                setError("");
                onAreaChange(e.target.value as CashArea);
              }}
            >
              <option value="offerings">Ofrendas</option>
              <option value="cafeteria">Cafetería</option>
            </select>
          </label>

          <label>
            Fecha correspondiente
            <input
              type="date"
              min={CASH_DATE_MIN}
              max={CASH_DATE_MAX}
              value={typedDate}
              required
              aria-invalid={dateIssue ? true : undefined}
              aria-describedby={
                dateIssue ? dateIssueId : suggestedDate ? dateWarningId : undefined
              }
              onChange={(e) => changeDate(e.target.value)}
            />
            <span className="field-help">
              Puedes registrar hoy el efectivo de un día anterior.
            </span>
          </label>

          {dateIssue && (
            <p role="alert" className="notice error" id={dateIssueId}>
              {dateIssue}
            </p>
          )}

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
                  onClick={() => changeDate(suggestedDate)}
                >
                  Usar {cashDateLabel(suggestedDate)}
                </button>
                <label className="cash-date-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed === confirmKey}
                    onChange={(event) => setConfirmed(event.target.checked ? confirmKey : null)}
                  />
                  Confirmo que el efectivo corresponde al {cashDateLabel(date)}.
                </label>
              </div>
            </div>
          )}

          {!dateIssue && !active &&
            (loadError ? (
              <Notice error={loadError} />
            ) : (
              <p className="notice cash-loading" role="status">
                {slow
                  ? "Todavía no pudimos confirmar los datos con el servidor. Revisa tu conexión: no se guardará nada hasta confirmarlos. Puedes cancelar y volver a intentarlo."
                  : "Cargando el efectivo registrado para esta fecha…"}
              </p>
            ))}

          {active && (
            <>
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

              {recordChanged && existing && (
                <div className="notice-warning cash-date-warning" role="alert">
                  <TriangleAlert size={15} aria-hidden="true" />
                  <div className="cash-date-warning-content">
                    <p>
                      Este registro cambió mientras lo editabas (ahora{" "}
                      {clp(existing.amount)}). Carga los valores vigentes antes
                      de guardar.
                    </p>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setDraft(draftFor(active.identity, existing))}
                    >
                      Cargar valores vigentes
                    </button>
                  </div>
                </div>
              )}

              <label>
                Efectivo recaudado
                <input
                  required
                  data-autofocus
                  aria-describedby={sumUpCash.count > 0 ? sumUpWarningId : undefined}
                  inputMode="numeric"
                  pattern="[0-9]+"
                  value={active.amount}
                  placeholder="0"
                  onChange={(e) =>
                    setDraft({ ...active, amount: e.target.value.replace(/\D/g, "") })
                  }
                />
              </label>

              <label>
                Nota (opcional)
                <textarea
                  rows={2}
                  value={active.note}
                  maxLength={500}
                  placeholder={
                    area === "offerings"
                      ? "Ej. Servicio domingo AM"
                      : "Ej. Ventas domingo AM"
                  }
                  onChange={(e) => setDraft({ ...active, note: e.target.value })}
                />
              </label>

              <Notice error={error} />
            </>
          )}
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

          <button className="button-primary" disabled={!canSave}>
            {busy
              ? "Guardando…"
              : !active
                ? "Guardar efectivo"
                : record
                  ? "Actualizar efectivo"
                  : "Registrar efectivo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
