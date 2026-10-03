"use client";

// Diálogos de Calendario (16b §5.8–5.9, 18b §2.3): cancelar (con motivo; en
// series "Solo esta fecha" / "Toda la serie desde hoy"), eliminar (archiva,
// con motivo), publicar / dejar de publicar y una confirmación genérica.
// Errores en español (calendarErrorMessage); el diálogo no se cierra si falla.

import { useId, useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { isValidReason, REASON_MAX, REASON_MIN } from "@/lib/calendar/audit";
import { calendarErrorMessage } from "@/lib/calendar/errors";
import { archiveEvent, cancelEvent, cancelOccurrence, cancelSeriesFrom, setVisibility } from "@/lib/calendar/events-client";
import { dayLabel } from "@/lib/shared/dates";
import type { Occurrence, Ymd } from "@/lib/shared/types";
import { CalDialog, InlineNotice } from "./ui";

export const REASON_REQUIRED = "Escribe un motivo (entre 3 y 300 caracteres).";

function SaveError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <InlineNotice tone="danger" icon={TriangleAlert} role="alert">
      {message}
    </InlineNotice>
  );
}

export function CancelEventDialog({
  occurrence: o,
  today,
  canThisDate,
  canSeries,
  onClose,
  onDone,
}: {
  occurrence: Occurrence;
  today: Ymd;
  canThisDate: boolean;
  canSeries: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const ids = useId();
  const [scope, setScope] = useState<"date" | "series">(canThisDate ? "date" : "series");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = isValidReason(reason);
  const formId = `${ids}-cancel`;
  const reasonId = `${ids}-reason`;

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!ready) {
      setError(REASON_REQUIRED);
      document.getElementById(reasonId)?.focus();
      return;
    }
    setBusy(true);
    setSaveError("");
    try {
      if (!o.isRecurring) await cancelEvent(o.event, reason);
      else if (scope === "date") await cancelOccurrence(o.event, o.date, reason);
      else await cancelSeriesFrom(o.event, today, reason);
      onDone("Actividad cancelada.");
    } catch (e) {
      setSaveError(calendarErrorMessage(e, "save"));
      setBusy(false);
    }
  };

  return (
    <CalDialog
      variant="center"
      onClose={onClose}
      busy={busy}
      title={`Cancelar «${o.event.title}»`}
      footer={
        <div className="cal-dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>
            Volver
          </button>
          <button
            type="submit"
            form={formId}
            className="button-danger"
            disabled={busy}
            aria-disabled={!ready || undefined}
            aria-describedby={!ready ? `${reasonId}-help` : undefined}
          >
            {busy ? "Guardando…" : "Cancelar actividad"}
          </button>
        </div>
      }
    >
      <form id={formId} className="cal-form" noValidate onSubmit={submit}>
        {o.isRecurring && (
          <fieldset className="cal-fieldset">
            <legend className="cal-legend">¿Qué quieres cancelar?</legend>
            <div className="cal-radio-cards">
              <label className={`cal-radio-card ${scope === "date" ? "is-checked" : ""} ${canThisDate ? "" : "is-disabled"}`}>
                <input type="radio" name={`${ids}-scope`} checked={scope === "date"} disabled={!canThisDate} onChange={() => setScope("date")} />
                <span>
                  <strong>Solo esta fecha</strong>
                  <span className="cal-help">{canThisDate ? dayLabel(o.date) : `${dayLabel(o.date)} · ya pasó o ya está cancelada`}</span>
                </span>
              </label>
              <label className={`cal-radio-card ${scope === "series" ? "is-checked" : ""} ${canSeries ? "" : "is-disabled"}`}>
                <input type="radio" name={`${ids}-scope`} checked={scope === "series"} disabled={!canSeries} onChange={() => setScope("series")} />
                <span>
                  <strong>Toda la serie desde hoy</strong>
                  <span className="cal-help">Las fechas pasadas quedan como realizadas.</span>
                </span>
              </label>
            </div>
          </fieldset>
        )}
        <div className="cal-field">
          <label htmlFor={reasonId}>Motivo (obligatorio)</label>
          <textarea
            id={reasonId}
            className="cal-textarea"
            rows={3}
            maxLength={REASON_MAX}
            aria-required="true"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${reasonId}-err` : `${reasonId}-help`}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error && isValidReason(e.target.value)) setError(null);
            }}
          />
          <p className="cal-help" id={`${reasonId}-help`}>
            Solo lo ve el equipo. Mínimo {REASON_MIN} caracteres.
          </p>
          {error && (
            <p className="cal-field-error" id={`${reasonId}-err`} role="alert">
              <TriangleAlert size={14} aria-hidden="true" /> {error}
            </p>
          )}
        </div>
        <p className="cal-note">
          <Info size={14} aria-hidden="true" />
          <span>Seguirá visible como «Cancelada». En el calendario público se verá «Cancelada», sin el motivo.</span>
        </p>
        <SaveError message={saveError} />
      </form>
    </CalDialog>
  );
}

const ARCHIVE_REASONS = ["Creada por error", "Duplicada", "Otro"] as const;

function archiveReasonText(kind: string, note: string): string {
  return kind ? `${kind}${note.trim() ? `: ${note.trim()}` : ""}`.slice(0, REASON_MAX) : "";
}

function archiveReady(kind: string, note: string): boolean {
  return !!kind && (kind !== "Otro" || note.trim().length >= REASON_MIN) && isValidReason(archiveReasonText(kind, note));
}

export function ArchiveEventDialog({
  occurrence: o,
  onClose,
  onDone,
}: {
  occurrence: Occurrence;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const ids = useId();
  const [kind, setKind] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = archiveReady(kind, note);
  const formId = `${ids}-archive`;

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!kind) {
      setError("Elige el motivo.");
      document.getElementById(`${ids}-kind`)?.focus();
      return;
    }
    if (!ready) {
      setError("Cuéntanos el motivo en la nota (mínimo 3 caracteres).");
      document.getElementById(`${ids}-note`)?.focus();
      return;
    }
    setBusy(true);
    setSaveError("");
    try {
      await archiveEvent(o.event, archiveReasonText(kind, note));
      onDone("Actividad eliminada.");
    } catch (e) {
      setSaveError(calendarErrorMessage(e, "save"));
      setBusy(false);
    }
  };

  return (
    <CalDialog
      variant="center"
      onClose={onClose}
      busy={busy}
      title={`Eliminar «${o.event.title}»`}
      footer={
        <div className="cal-dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>
            Volver
          </button>
          <button type="submit" form={formId} className="button-danger" disabled={busy} aria-disabled={!ready || undefined}>
            {busy ? "Guardando…" : "Eliminar"}
          </button>
        </div>
      }
    >
      <form id={formId} className="cal-form" noValidate onSubmit={submit}>
        <p className="cal-dialog-text">
          Se quitará de todas las vistas, de los reportes y del calendario público. No se borra: queda guardada en el historial con el motivo.
        </p>
        {o.isRecurring && <p className="cal-dialog-text">Se eliminará toda la serie. Para quitar una sola fecha, usa «Cancelar».</p>}
        <div className="cal-field">
          <label htmlFor={`${ids}-kind`}>Motivo (obligatorio)</label>
          <select
            id={`${ids}-kind`}
            className="cal-select"
            value={kind}
            aria-required="true"
            aria-invalid={error && !kind ? true : undefined}
            aria-describedby={error ? `${ids}-err` : undefined}
            onChange={(e) => {
              setKind(e.target.value);
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
        <div className="cal-field">
          <label htmlFor={`${ids}-note`}>Nota {kind === "Otro" ? "(obligatoria)" : "(opcional)"}</label>
          <textarea
            id={`${ids}-note`}
            className="cal-textarea"
            rows={2}
            maxLength={200}
            value={note}
            aria-invalid={error && kind === "Otro" ? true : undefined}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
          />
          <p className="cal-help">Solo lo ve el equipo.</p>
        </div>
        {error && (
          <p className="cal-field-error" id={`${ids}-err`} role="alert">
            <TriangleAlert size={14} aria-hidden="true" /> {error}
          </p>
        )}
        <SaveError message={saveError} />
      </form>
    </CalDialog>
  );
}

/** Publicar o dejar de publicar, siempre con confirmación (18b §2.3). */
export function VisibilityDialog({
  occurrence: o,
  mode,
  onClose,
  onDone,
}: {
  occurrence: Occurrence;
  mode: "publish" | "unpublish";
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const publish = mode === "publish";

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setSaveError("");
    try {
      await setVisibility(o.event, publish ? "public" : "internal");
      onDone(publish ? "Actividad publicada." : "La actividad ya no es pública.");
    } catch (e) {
      setSaveError(calendarErrorMessage(e, "save"));
      setBusy(false);
    }
  };

  return (
    <CalDialog
      variant="center"
      onClose={onClose}
      busy={busy}
      title={publish ? `¿Publicar «${o.event.title}»?` : `¿Dejar de publicar «${o.event.title}»?`}
      footer={
        <div className="cal-dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>
            Volver
          </button>
          <button type="button" className="button-primary" onClick={confirm} disabled={busy}>
            {busy ? "Guardando…" : publish ? "Publicar" : "Dejar de publicar"}
          </button>
        </div>
      }
    >
      <div className="cal-form">
        {publish ? (
          <>
            <p className="cal-dialog-text">
              Aparecerá en el calendario compartido con su título, fecha, hora, lugar, descripción pública y áreas. Las notas internas y los
              motivos nunca se publican.
            </p>
            {o.isRecurring && <p className="cal-dialog-text">Se publicará toda la serie.</p>}
          </>
        ) : (
          <p className="cal-dialog-text">Dejará de verse en el calendario compartido. Seguirá visible para el equipo.</p>
        )}
        <SaveError message={saveError} />
      </div>
    </CalDialog>
  );
}

/** Confirmación genérica (generar enlace nuevo, desactivar, terminar sin copiar). */
export function ConfirmDialog({
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  destructive,
  busy,
}: {
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
}) {
  return (
    <CalDialog
      variant="center"
      onClose={onClose}
      busy={busy}
      title={title}
      footer={
        <div className="cal-dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>
            Volver
          </button>
          <button type="button" className={destructive ? "button-danger" : "button-primary"} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="cal-dialog-text">{body}</div>
    </CalDialog>
  );
}
