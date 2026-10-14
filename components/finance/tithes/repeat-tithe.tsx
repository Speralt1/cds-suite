"use client";
import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { PAYMENT_METHODS } from "@/lib/finance/constants";
import {
  clp,
  dateLabel,
  dateTimeLabel,
  shortReference,
} from "@/lib/finance/formatters";
import {
  MONTH_TITHES_LIMIT,
  useTransactionMethods,
} from "@/lib/finance/tithe-hooks";
import { monthLabel, summarizeMonthTithes } from "@/lib/finance/tithe-integrity";
import type { TitheAttribution } from "@/lib/finance/types";

function methodLabel(method: string | undefined) {
  if (method === undefined) return "…";
  return (
    PAYMENT_METHODS[method as keyof typeof PAYMENT_METHODS] || method || "—"
  );
}

/**
 * Aviso informativo: la ficha ya tiene diezmos activos en el mes de la fecha elegida.
 * Nunca bloquea. role="status" + aria-live="polite"; texto explícito (no solo color).
 */
export function RepeatTitheWarning({
  period,
  items,
}: {
  period: string;
  items: TitheAttribution[];
}) {
  const [open, setOpen] = useState(false);
  const [ackPeriod, setAckPeriod] = useState("");
  const listId = useId();
  // Método solo al expandir: documentId-in de ≤ 30 movimientos.
  const methods = useTransactionMethods(
    open ? items.map((a) => a.transactionId) : [],
  );
  const { count, total, latest } = summarizeMonthTithes(items);
  if (!count) return null;
  const capped = items.length >= MONTH_TITHES_LIMIT;
  const acknowledged = ackPeriod === period;
  return (
    <div
      role="status"
      aria-live="polite"
      className="notice-warning tithe-repeat-warning"
    >
      <AlertTriangle size={18} aria-hidden="true" />
      <div className="tithe-repeat-content">
        <p>
          <strong>Aviso:</strong> esta persona o familia ya registra{" "}
          {capped ? "al menos " : ""}
          {count} {count === 1 ? "diezmo" : "diezmos"} durante{" "}
          {monthLabel(period)} (total {clp(total)}).
          {latest && (
            <>
              {" "}
              Último: {dateLabel(latest.date)} · {clp(latest.amount)}.
            </>
          )}
        </p>
        {acknowledged && (
          <p>Puedes registrar otro diezmo de {monthLabel(period)}.</p>
        )}
        <div className="tithe-repeat-actions">
          <button
            type="button"
            className="button-secondary"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Ocultar aportes" : "Revisar aportes"}
          </button>
          {!acknowledged && (
            <button
              type="button"
              className="button-secondary"
              onClick={() => setAckPeriod(period)}
            >
              Registrar otro diezmo
            </button>
          )}
        </div>
        {open && (
          <ul id={listId} className="tithe-repeat-list">
            {items.map((a) => (
              <li key={a.id}>
                <span>{dateLabel(a.date)}</span>
                <span className="tabular-nums">{clp(a.amount)}</span>
                <span>{methodLabel(methods[a.transactionId])}</span>
                <span className="tx-reference">
                  {shortReference(a.transactionId)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Paso de confirmación cuando ya existe un aporte activo con la misma ficha, fecha, monto y
 * método. Semántica alertdialog; el foco va a "Volver y revisar" (opción segura) y Escape vuelve.
 */
export function DuplicateTitheConfirm({
  matches,
  methodLabelText,
  onBack,
  onConfirm,
}: {
  matches: TitheAttribution[];
  methodLabelText: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
  }, []);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="tithe-duplicate-confirm"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }
      }}
    >
      <h3 id={titleId}>
        <AlertTriangle size={20} aria-hidden="true" /> Encontramos un aporte
        con los mismos datos
      </h3>
      <div id={descId}>
        <p>
          Comprueba que no estés registrándolo dos veces. Ya hay{" "}
          {matches.length === 1
            ? "un diezmo activo"
            : `${matches.length} diezmos activos`}{" "}
          de esta ficha con la misma fecha, monto y método de pago:
        </p>
        <ul className="tithe-repeat-list">
          {matches.map((a) => (
            <li key={a.id}>
              <span>{dateLabel(a.date)}</span>
              <span className="tabular-nums">{clp(a.amount)}</span>
              <span>{methodLabelText}</span>
              <span>Registrado el {dateTimeLabel(a.createdAt)}</span>
              <span className="tx-reference">
                {shortReference(a.transactionId)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="form-footer">
        <button
          ref={backRef}
          type="button"
          className="button-secondary"
          onClick={onBack}
        >
          Volver y revisar
        </button>
        <button type="button" className="button-primary" onClick={onConfirm}>
          Sí, es otro aporte
        </button>
      </div>
    </div>
  );
}

export { methodLabel };
