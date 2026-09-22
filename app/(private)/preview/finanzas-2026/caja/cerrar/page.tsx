"use client";

import { useMemo, useState } from "react";
import { TriangleAlert, CircleCheck, Paperclip } from "lucide-react";
import { MoneyAmount } from "@/components/preview2026/money-amount";
import { CASH_SESSIONS } from "@/components/preview2026/fixtures";

const SESSION = CASH_SESSIONS.find((c) => c.id === "caja-ofrendas-2026-09-21")!;
const EXPECTED = SESSION.fondo + SESSION.efectivoMovimientos; // $214.500

const REASONS = [
  "Faltante — vuelto entregado de más",
  "Sobrante — donación sin registrar",
  "Error de conteo",
  "Otro (detallar en la nota)",
];

/**
 * Flujo móvil de cierre de caja de Ofrendas (Design Lock §3).
 * El "esperado" es SIEMPRE texto calculado, nunca un input.
 * Estado 100% local (useState); sin persistencia ni Firestore.
 */
export default function Preview2026CerrarCajaPage() {
  // Ambos conteos ya fueron realizados (M. Soto y J. Pérez, ciego) antes de
  // llegar a esta pantalla; este incremento no modela su captura interactiva.
  const count1Confirmed = true;
  const count2Confirmed = true;
  const [countedInput, setCountedInput] = useState("210.000");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const counted = useMemo(() => {
    const digits = countedInput.replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  }, [countedInput]);

  const difference = counted - EXPECTED;
  const hasDifference = difference !== 0;
  const toDeposit = counted - SESSION.fondo;

  function handleCountedChange(raw: string) {
    const digits = raw.replace(/[^\d]/g, "");
    setCountedInput(digits ? new Intl.NumberFormat("es-CL").format(Number(digits)) : "");
  }

  const canClose = !hasDifference || reason.trim().length > 0;

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-4 text-xl font-medium">Cerrar caja · Ofrendas — dom 21</h1>

      <ol className="mb-4 flex flex-col gap-2 text-sm">
        <li className="flex items-center gap-2">
          <CircleCheck
            size={16}
            aria-hidden="true"
            style={{ color: count1Confirmed ? "var(--p26-success)" : "var(--p26-muted)" }}
          />
          Conteo 1 — {SESSION.count1?.by}
          {count1Confirmed ? " ✓" : ""}
        </li>
        <li className="flex items-center gap-2">
          <CircleCheck
            size={16}
            aria-hidden="true"
            style={{ color: count2Confirmed ? "var(--p26-success)" : "var(--p26-muted)" }}
          />
          Conteo 2 — {SESSION.count2?.by} (ciego)
          {count2Confirmed ? " ✓" : ""}
        </li>
      </ol>

      <div
        className="mb-4 flex flex-col gap-3 rounded-[var(--p26-radius-panel)] border p-4"
        style={{ borderColor: "var(--p26-line)" }}
      >
        <div className="flex items-baseline justify-between">
          <span>Esperado</span>
          {/* Texto calculado — NUNCA un input. Criterio de aceptación 6 del Gate §5. */}
          <span data-testid="p26-expected" aria-label={`Esperado ${EXPECTED} pesos, calculado, no editable`}>
            <MoneyAmount value={EXPECTED} basis="esperado" />
          </span>
        </div>
        <p className="text-xs text-[var(--p26-muted)]">
          Fondo ${new Intl.NumberFormat("es-CL").format(SESSION.fondo)} + Efectivo
          culto ${new Intl.NumberFormat("es-CL").format(SESSION.efectivoMovimientos)}
          {" "}({SESSION.movementCount} mov.)
        </p>

        <label className="flex flex-col gap-1 text-sm" htmlFor="p26-counted">
          Contado
          <input
            id="p26-counted"
            inputMode="numeric"
            value={`$ ${countedInput}`}
            onChange={(e) => handleCountedChange(e.target.value)}
            className="rounded-[var(--p26-radius-control)] border px-3 py-2"
            style={{ borderColor: "var(--p26-line-strong)", fontSize: "var(--p26-font-input)" }}
          />
        </label>

        <div
          className="flex items-center gap-2"
          role={hasDifference ? "alert" : undefined}
        >
          {hasDifference && (
            <TriangleAlert size={16} aria-hidden="true" style={{ color: "var(--p26-danger)" }} />
          )}
          <span>Diferencia</span>
          <MoneyAmount
            value={difference}
            ariaLabel={
              difference === 0
                ? "Sin diferencia"
                : `${difference < 0 ? "Faltante" : "Sobrante"} de ${Math.abs(difference)} pesos`
            }
          />
          {hasDifference && (
            <span className="text-xs text-[var(--p26-muted)]">
              {difference < 0 ? "Faltante" : "Sobrante"}
            </span>
          )}
        </div>

        {hasDifference && (
          <>
            <label className="flex flex-col gap-1 text-sm" htmlFor="p26-reason">
              Motivo (obligatorio)
              <select
                id="p26-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                className="rounded-[var(--p26-radius-control)] border px-3 py-2"
                style={{ borderColor: "var(--p26-line-strong)" }}
              >
                <option value="">Selecciona un motivo…</option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm" htmlFor="p26-note">
              Nota
              <textarea
                id="p26-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="rounded-[var(--p26-radius-control)] border px-3 py-2"
                style={{ borderColor: "var(--p26-line-strong)" }}
              />
            </label>
            {reason.trim().length === 0 && (
              <p role="alert" className="text-xs" style={{ color: "var(--p26-danger)" }}>
                Selecciona un motivo para poder cerrar con diferencia.
              </p>
            )}
            <button
              type="button"
              className="p26-button p26-button--secondary self-start"
            >
              <Paperclip size={14} aria-hidden="true" /> Adjuntar foto
            </button>
          </>
        )}
      </div>

      <div
        className="mb-4 flex items-center justify-between rounded-[var(--p26-radius-panel)] border p-4"
        style={{ borderColor: "var(--p26-line)" }}
      >
        <span>A depositar</span>
        <MoneyAmount value={toDeposit} ariaLabel={`A depositar ${toDeposit} pesos, contado menos fondo`} />
      </div>

      <button
        type="button"
        disabled={!canClose}
        className="p26-button p26-button--mobile-lg p26-button--primary w-full"
        style={{ height: 44 }}
        data-testid="p26-close-button"
      >
        {hasDifference ? "Cerrar con diferencia" : "Cerrar caja"}
      </button>
    </div>
  );
}
