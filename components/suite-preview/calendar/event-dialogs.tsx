"use client";

// Diálogos de Calendario (16b §5.8–5.9): cancelar (con motivo; en series
// "Solo esta fecha" / "Toda la serie desde hoy"), eliminar (archiva, con motivo),
// "Editar actividad repetida" y una confirmación genérica.

import { useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { dayLabel } from "@/lib/suite-preview/dates";
import type { Occurrence } from "@/lib/suite-preview/types";
import { ProposalPill, Sheet } from "@/components/finance-preview/ui";
import { useSuite } from "../provider";

const REASON_MIN = 3;
const REASON_MAX = 300;
export const REASON_REQUIRED = "Escribe un motivo (entre 3 y 300 caracteres).";

function validReason(r: string) {
  const t = r.trim();
  return t.length >= REASON_MIN && t.length <= REASON_MAX;
}

export function CancelEventDialog({
  occurrence,
  open,
  onClose,
  onDone,
  canThisDate,
  canSeries,
}: {
  occurrence: Occurrence | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  canThisDate: boolean;
  canSeries: boolean;
}) {
  // El botón destructivo queda deshabilitado (aria-disabled) hasta que el motivo
  // sea válido; la clave evita arrastrar el estado a otra ocurrencia.
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const ready = !!occurrence && readyKey === occurrence.key;
  const close = () => {
    setReadyKey(null);
    onClose();
  };
  return (
    <Sheet
      open={open && !!occurrence}
      onClose={close}
      variant="center"
      labelId="sx-cancel-title"
      title={occurrence ? `Cancelar «${occurrence.event.title}»` : ""}
      footer={
        <div className="sx-dialog-foot">
          <button type="button" className="fx-btn fx-btn-secondary" onClick={close}>
            Volver
          </button>
          <button
            type="submit"
            form="sx-cancel-form"
            className="fx-btn fx-btn-danger"
            aria-disabled={!ready || undefined}
            aria-describedby={!ready ? "sx-cancel-reason-help" : undefined}
          >
            Cancelar actividad
          </button>
        </div>
      }
    >
      {open && occurrence && (
        <CancelForm
          key={occurrence.key}
          o={occurrence}
          onDone={() => {
            setReadyKey(null);
            onDone();
          }}
          onReadyChange={(v) => setReadyKey(v ? occurrence.key : null)}
          canThisDate={canThisDate}
          canSeries={canSeries}
        />
      )}
    </Sheet>
  );
}

function CancelForm({
  o,
  onDone,
  onReadyChange,
  canThisDate,
  canSeries,
}: {
  o: Occurrence;
  onDone: () => void;
  onReadyChange: (ready: boolean) => void;
  canThisDate: boolean;
  canSeries: boolean;
}) {
  const { dispatch } = useSuite();
  const [scope, setScope] = useState<"date" | "series">(canThisDate ? "date" : "series");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validReason(reason)) {
      setError(REASON_REQUIRED);
      document.getElementById("sx-cancel-reason")?.focus();
      return;
    }
    const r = reason.trim();
    const result = !o.isRecurring
      ? dispatch({ type: "event/cancel", id: o.eventId, reason: r }, "Actividad cancelada")
      : scope === "date"
        ? dispatch({ type: "event/cancelOccurrence", id: o.eventId, date: o.date, reason: r }, "Fecha cancelada")
        : dispatch({ type: "event/cancelSeriesFrom", id: o.eventId, reason: r }, "Serie cancelada desde hoy");
    if (result.ok) onDone();
    else setError(result.error);
  };

  return (
    <form id="sx-cancel-form" className="sx-cal-form" noValidate onSubmit={submit}>
      {o.isRecurring && (
        <fieldset className="sx-cal-fieldset">
          <legend className="sx-legend">¿Qué quieres cancelar?</legend>
          <div className="sx-radio-cards">
            <label className={`sx-radio-card ${scope === "date" ? "is-checked" : ""} ${canThisDate ? "" : "is-disabled"}`}>
              <input type="radio" name="sx-cancel-scope" checked={scope === "date"} disabled={!canThisDate} onChange={() => setScope("date")} />
              <span>
                <strong>Solo esta fecha</strong>
                <span className="fx-help">{canThisDate ? dayLabel(o.date) : `${dayLabel(o.date)} · ya pasó o ya está cancelada`}</span>
              </span>
            </label>
            <label className={`sx-radio-card ${scope === "series" ? "is-checked" : ""} ${canSeries ? "" : "is-disabled"}`}>
              <input type="radio" name="sx-cancel-scope" checked={scope === "series"} disabled={!canSeries} onChange={() => setScope("series")} />
              <span>
                <strong>Toda la serie desde hoy</strong>
                <span className="fx-help">Las fechas pasadas quedan como realizadas.</span>
              </span>
            </label>
          </div>
        </fieldset>
      )}
      <div className="sx-field">
        <label htmlFor="sx-cancel-reason">Motivo (obligatorio)</label>
        <textarea
          id="sx-cancel-reason"
          className="sx-cal-textarea"
          rows={3}
          maxLength={REASON_MAX}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "sx-cancel-reason-err" : "sx-cancel-reason-help"}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setTouched(true);
            onReadyChange(validReason(e.target.value));
            if (error && validReason(e.target.value)) setError(null);
          }}
          onBlur={() => {
            if (touched && !validReason(reason)) setError(REASON_REQUIRED);
          }}
        />
        <p className="fx-help" id="sx-cancel-reason-help">
          Solo lo ve el equipo. Mínimo 3 caracteres.
        </p>
        {error && (
          <p className="sx-field-error" id="sx-cancel-reason-err" role="alert">
            <TriangleAlert size={14} aria-hidden="true" /> {error}
          </p>
        )}
      </div>
      <p className="sx-note">
        <Info size={14} aria-hidden="true" />
        <span>Seguirá visible como «Cancelada». En el calendario público se verá «Cancelada», sin el motivo.</span>
      </p>
    </form>
  );
}

const ARCHIVE_REASONS = ["Creada por error", "Duplicada", "Otro"] as const;

export function ArchiveEventDialog({
  occurrence,
  open,
  onClose,
  onDone,
}: {
  occurrence: Occurrence | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const ready = !!occurrence && readyKey === occurrence.key;
  const close = () => {
    setReadyKey(null);
    onClose();
  };
  return (
    <Sheet
      open={open && !!occurrence}
      onClose={close}
      variant="center"
      labelId="sx-archive-title"
      title={occurrence ? `Eliminar «${occurrence.event.title}»` : ""}
      footer={
        <div className="sx-dialog-foot">
          <button type="button" className="fx-btn fx-btn-secondary" onClick={close}>
            Volver
          </button>
          <button type="submit" form="sx-archive-form" className="fx-btn fx-btn-danger" aria-disabled={!ready || undefined}>
            Eliminar
          </button>
        </div>
      }
    >
      {open && occurrence && (
        <ArchiveForm
          key={occurrence.key}
          o={occurrence}
          onDone={() => {
            setReadyKey(null);
            onDone();
          }}
          onReadyChange={(v) => setReadyKey(v ? occurrence.key : null)}
        />
      )}
    </Sheet>
  );
}

function archiveReady(kind: string, note: string): boolean {
  return !!kind && (kind !== "Otro" || note.trim().length >= REASON_MIN);
}

function ArchiveForm({ o, onDone, onReadyChange }: { o: Occurrence; onDone: () => void; onReadyChange: (ready: boolean) => void }) {
  const { dispatch } = useSuite();
  const [kind, setKind] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reasonText = kind ? `${kind}${note.trim() ? `: ${note.trim()}` : ""}` : "";
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!kind) {
      setError("Elige el motivo.");
      document.getElementById("sx-archive-kind")?.focus();
      return;
    }
    if (kind === "Otro" && note.trim().length < REASON_MIN) {
      setError("Cuéntanos el motivo en la nota (mínimo 3 caracteres).");
      document.getElementById("sx-archive-note")?.focus();
      return;
    }
    const result = dispatch({ type: "event/archive", id: o.eventId, reason: reasonText.slice(0, REASON_MAX) }, "Actividad eliminada");
    if (result.ok) onDone();
    else setError(result.error);
  };

  return (
    <form id="sx-archive-form" className="sx-cal-form" noValidate onSubmit={submit}>
      <p className="sx-dialog-text">
        Se quitará de todas las vistas, de los reportes y del calendario público. No se borra: queda guardada en el historial con el motivo.
      </p>
      {o.isRecurring && <p className="sx-dialog-text">Se eliminará toda la serie. Para quitar una sola fecha, usa «Cancelar».</p>}
      <div className="sx-field">
        <label htmlFor="sx-archive-kind">Motivo (obligatorio)</label>
        <select
          id="sx-archive-kind"
          className="fx-select"
          value={kind}
          aria-required="true"
          aria-invalid={error && !kind ? true : undefined}
          aria-describedby={error ? "sx-archive-err" : undefined}
          onChange={(e) => {
            setKind(e.target.value);
            onReadyChange(archiveReady(e.target.value, note));
            setError(null);
          }}
        >
          <option value="">Elige un motivo</option>
          {ARCHIVE_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div className="sx-field">
        <label htmlFor="sx-archive-note">Nota {kind === "Otro" ? "(obligatoria)" : "(opcional)"}</label>
        <textarea
          id="sx-archive-note"
          className="sx-cal-textarea"
          rows={2}
          maxLength={200}
          value={note}
          aria-invalid={error && kind === "Otro" ? true : undefined}
          onChange={(e) => {
            setNote(e.target.value);
            onReadyChange(archiveReady(kind, e.target.value));
            setError(null);
          }}
          onBlur={() => {
            if (kind === "Otro" && note.trim().length < REASON_MIN) setError("Cuéntanos el motivo en la nota (mínimo 3 caracteres).");
          }}
        />
        <p className="fx-help">Solo lo ve el equipo.</p>
      </div>
      {error && (
        <p className="sx-field-error" id="sx-archive-err" role="alert">
          <TriangleAlert size={14} aria-hidden="true" /> {error}
        </p>
      )}
    </form>
  );
}

/** "Editar actividad repetida": solo "Toda la serie" entra en la preview. */
export function EditRecurringDialog({ open, onClose, onContinue }: { open: boolean; onClose: () => void; onContinue: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="center"
      labelId="sx-edit-choice-title"
      title="Editar actividad repetida"
      footer={
        <div className="sx-dialog-foot">
          <button type="button" className="fx-btn fx-btn-secondary" onClick={onClose}>
            Volver
          </button>
          <button type="button" className="fx-btn fx-btn-primary" onClick={onContinue}>
            Continuar
          </button>
        </div>
      }
    >
      <fieldset className="sx-cal-fieldset">
        <legend className="fx-sr">¿Qué quieres editar?</legend>
        <div className="sx-radio-cards">
          <label className="sx-radio-card is-checked">
            <input type="radio" name="sx-edit-scope" defaultChecked />
            <span>
              <strong>Toda la serie</strong>
              <span className="fx-help">Cambia todas las fechas de la actividad.</span>
            </span>
          </label>
          <label className="sx-radio-card is-disabled">
            <input type="radio" name="sx-edit-scope" disabled />
            <span>
              <strong>
                Solo esta fecha <ProposalPill />
              </strong>
              <span className="fx-help">Llegará en una próxima versión.</span>
            </span>
          </label>
          <label className="sx-radio-card is-disabled">
            <input type="radio" name="sx-edit-scope" disabled />
            <span>
              <strong>
                Esta y las siguientes <ProposalPill />
              </strong>
              <span className="fx-help">Llegará en una próxima versión.</span>
            </span>
          </label>
        </div>
      </fieldset>
    </Sheet>
  );
}

/** Confirmación genérica (Regenerar / Desactivar enlace). */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  destructive,
  labelId,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  labelId: string;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="center"
      labelId={labelId}
      title={title}
      footer={
        <div className="sx-dialog-foot">
          <button type="button" className="fx-btn fx-btn-secondary" onClick={onClose}>
            Volver
          </button>
          <button type="button" className={`fx-btn ${destructive ? "fx-btn-danger" : "fx-btn-primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="sx-dialog-text">{body}</div>
    </Sheet>
  );
}
