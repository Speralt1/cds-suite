"use client";

// Acciones de Consolidación en sheets/dialogs (16b §9.6–9.8):
// Registrar visita, Registrar seguimiento, Cambiar estado, Asignar responsable
// y el sheet de acciones de una fila (móvil). Se abren desde cualquier pantalla
// con useMemberActions().open(kind, personId).
// Regla: ningún estado cambia sin confirmación explícita de quien guarda.

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CalendarPlus, Info, MessageCircle, MessageSquarePlus, RotateCcw, TriangleAlert, UserRound } from "lucide-react";
import {
  CLOSED_REASON_LABEL,
  FOLLOWUP_RESULT_LABEL,
  FOLLOWUP_TYPE_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  suggestReopenOnVisit,
  suggestStatusAfterFollowUp,
} from "@/lib/suite-preview/consolidation";
import { compareLocal } from "@/lib/suite-preview/dates";
import type { ClosedReason, ConsolidationStatus, FollowUpResult, FollowUpType, Person } from "@/lib/suite-preview/types";
import { shortDate } from "@/lib/finance-preview/format";
import { Callout, Sheet } from "@/components/finance-preview/ui";
import { arrivalOccurrences, dateEcho, firstName, personHref, relDay } from "./model";
import { useMembers } from "./use-members";
import { PersonStatusBadge, STATUS_VIS } from "./vocab";

export type SheetKind = "visit" | "followup" | "status" | "assign" | "actions";
export type FollowUpIntent = "agradecer" | "contactar" | "invitar" | "saludar";

interface Req {
  kind: SheetKind;
  personId: string;
  intent?: FollowUpIntent;
}

interface MemberActionsValue {
  open: (kind: SheetKind, personId: string, intent?: FollowUpIntent) => void;
}

const Ctx = createContext<MemberActionsValue | null>(null);

export function useMemberActions(): MemberActionsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMemberActions debe usarse dentro de MemberActions");
  return ctx;
}

const KINDS: SheetKind[] = ["visit", "followup", "status", "assign", "actions"];

/** Proveedor + host de los sheets de Consolidación. */
export function MemberActions({ children }: { children: React.ReactNode }) {
  const m = useMembers();
  const [req, setReq] = useState<Req | null>(null);
  const [last, setLast] = useState<Partial<Record<SheetKind, Req>>>({});
  const [seqs, setSeqs] = useState<Record<SheetKind, number>>({ visit: 0, followup: 0, status: 0, assign: 0, actions: 0 });

  const open = useCallback((kind: SheetKind, personId: string, intent?: FollowUpIntent) => {
    const r = { kind, personId, intent };
    setReq(r);
    setLast((l) => ({ ...l, [kind]: r }));
    setSeqs((s) => ({ ...s, [kind]: s[kind] + 1 }));
  }, []);

  // Cada sheet solo se limpia a sí mismo (permite encadenar Acciones → Visita).
  const closers = useMemo(
    () =>
      Object.fromEntries(KINDS.map((k) => [k, () => setReq((r) => (r?.kind === k ? null : r))])) as Record<SheetKind, () => void>,
    [],
  );
  const value = useMemo(() => ({ open }), [open]);
  const personOf = (k: SheetKind) => {
    const id = last[k]?.personId;
    return id ? m.state.persons.find((p) => p.id === id) ?? null : null;
  };
  const props = (k: SheetKind) => ({ open: req?.kind === k, onClose: closers[k] });

  const pv = personOf("visit");
  const pf = personOf("followup");
  const ps = personOf("status");
  const pa = personOf("assign");
  const pr = personOf("actions");

  return (
    <Ctx.Provider value={value}>
      {children}
      {pv && <VisitSheet key={`visit-${seqs.visit}`} {...props("visit")} person={pv} />}
      {pf && <FollowUpSheet key={`followup-${seqs.followup}`} {...props("followup")} person={pf} intent={last.followup?.intent} />}
      {ps && <StatusSheet key={`status-${seqs.status}`} {...props("status")} person={ps} />}
      {pa && <AssignSheet key={`assign-${seqs.assign}`} {...props("assign")} person={pa} />}
      {pr && <RowActionsSheet key={`actions-${seqs.actions}`} {...props("actions")} person={pr} onPick={(k) => open(k, pr.id)} />}
    </Ctx.Provider>
  );
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  person: Person;
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p className="fx-error" id={id} role="alert">
      <TriangleAlert size={14} aria-hidden="true" />
      {children}
    </p>
  );
}

/** Eco legible de una fecha bajo su input ("domingo 4 de octubre de 2026"). */
function DateEcho({ id, value }: { id: string; value: string }) {
  const text = dateEcho(value);
  if (!text) return null;
  return (
    <p className="sx-date-echo" id={id}>
      {text}
    </p>
  );
}

function Foot({ onCancel, submitLabel, form, cancelLabel = "Cancelar" }: { onCancel: () => void; submitLabel: string; form: string; cancelLabel?: string }) {
  return (
    <>
      <button type="button" className="fx-btn fx-btn-secondary" onClick={onCancel}>
        {cancelLabel}
      </button>
      <button type="submit" form={form} className="fx-btn fx-btn-primary">
        {submitLabel}
      </button>
    </>
  );
}

// ---------- Registrar visita ----------

function VisitSheet({ open, onClose, person }: SheetProps) {
  const m = useMembers();
  const [date, setDate] = useState(m.today);
  const [choice, setChoice] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const [note, setNote] = useState("");
  const [reopen, setReopen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sin calendar.read solo se ofrecen las actividades públicas del día.
  const canReadCalendar = m.eff.has("calendar.read");
  const occurrences = useMemo(
    () => arrivalOccurrences(m.state.events, date, m.now, canReadCalendar),
    [m.state.events, date, m.now, canReadCalendar],
  );
  const selected = choice ?? occurrences[0]?.eventId ?? "otra";
  const occ = occurrences.find((o) => o.eventId === selected);
  const label = occ ? occ.event.title : other.trim();
  const duplicate = m.state.visits.find(
    (v) =>
      v.personId === person.id &&
      !v.voided &&
      v.date === date &&
      (occ ? v.activityEventId === occ.eventId || v.activityLabel === occ.event.title : !!label && v.activityLabel === label),
  );
  const closed = suggestReopenOnVisit(person);
  const name = firstName(person.fullName);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || compareLocal(date, m.today) > 0) return setError("La visita no puede ser futura.");
    const res = m.dispatch(
      {
        type: "visit/register",
        input: {
          personId: person.id,
          date,
          ...(occ ? { activityEventId: occ.eventId } : {}),
          ...(label ? { activityLabel: label } : {}),
          ...(note.trim() ? { note } : {}),
        },
      },
      "Visita registrada",
    );
    if (!res.ok) return;
    if (closed && reopen)
      m.dispatch(
        { type: "person/changeStatus", personId: person.id, to: "en_seguimiento", reason: "Volvió a la iglesia: se reabrió el seguimiento" },
        "Visita registrada y seguimiento reabierto",
      );
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      labelId="sx-visit-title"
      title={`Registrar visita · ${person.fullName}`}
      footer={<Foot onCancel={onClose} submitLabel="Guardar visita" form="sx-visit-form" />}
    >
      <form id="sx-visit-form" className="sx-form" onSubmit={submit} noValidate>
        {closed && (
          <div className="sx-suggest">
            <p className="sx-suggest-title">
              <RotateCcw size={16} aria-hidden="true" /> {name} volvió. ¿Reabrir su seguimiento?
            </p>
            <p className="fx-help">Está en Sin continuidad. Su estado no cambia si no lo marcas.</p>
            <label className="sx-check">
              <input type="checkbox" checked={reopen} onChange={(e) => setReopen(e.target.checked)} />
              <span>
                Reabrir y pasar a <strong>En seguimiento</strong>
              </span>
            </label>
          </div>
        )}
        <div className="fx-field">
          <label htmlFor="sx-visit-date">Fecha</label>
          <input
            id="sx-visit-date"
            type="date"
            lang="es-CL"
            className="fx-input"
            value={date}
            max={m.today}
            aria-invalid={!!error}
            aria-describedby={error ? "sx-visit-date-error" : "sx-visit-date-echo"}
            onChange={(e) => {
              setDate(e.target.value);
              setChoice(null);
              setError(null);
            }}
          />
          {error ? <FieldError id="sx-visit-date-error">{error}</FieldError> : <DateEcho id="sx-visit-date-echo" value={date} />}
        </div>
        <div className="fx-field">
          <label htmlFor="sx-visit-activity">Actividad o servicio</label>
          <select id="sx-visit-activity" className="fx-select" value={selected} onChange={(e) => setChoice(e.target.value)}>
            {occurrences.map((o) => (
              <option key={o.key} value={o.eventId}>
                {o.event.title}
                {o.allDay ? " · todo el día" : o.startTime ? ` · ${o.startTime}` : ""}
              </option>
            ))}
            <option value="otra">Otra…</option>
          </select>
          {!occurrences.length && <p className="fx-help">No hay actividades en el calendario ese día. Escribe dónde vino.</p>}
        </div>
        {selected === "otra" && (
          <div className="fx-field">
            <label htmlFor="sx-visit-other">¿Dónde vino?</label>
            <input
              id="sx-visit-other"
              className="fx-input"
              value={other}
              maxLength={120}
              placeholder="Ej.: Reunión de jóvenes"
              onChange={(e) => setOther(e.target.value)}
            />
          </div>
        )}
        <div className="fx-field">
          <label htmlFor="sx-visit-note">Nota (opcional)</label>
          <textarea id="sx-visit-note" className="sx-textarea" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </div>
        {duplicate && (
          <Callout tone="info" icon={Info}>
            Ya hay una visita de {name} el {shortDate(date)}
            {duplicate.activityLabel ? ` en ${duplicate.activityLabel}` : ""}. Puedes guardarla igual.
          </Callout>
        )}
        <p className="fx-help sx-form-foot-note">Se agrega al historial; las visitas anteriores no cambian.</p>
      </form>
    </Sheet>
  );
}

// ---------- Registrar seguimiento ----------

const TYPES: FollowUpType[] = ["whatsapp", "llamada", "presencial", "otro"];
const RESULTS: FollowUpResult[] = ["contactado", "sin_respuesta", "numero_invalido", "no_desea_contacto", "otro"];
const NEXT_SUGGESTIONS = ["Invitar al culto del miércoles", "Llamar de nuevo", "Invitar a un grupo"];

/** Valor del select para "Sin asignar" cuando "" significa "no cambiar". */
const UNASSIGN = "__sin_asignar__";

const INTENT_HINT: Record<FollowUpIntent, string> = {
  agradecer: "Agradece su visita y cuéntale que es bienvenida.",
  contactar: "Primer contacto: preséntate y agradece su visita.",
  invitar: "Hace varios días que no viene: invítala de vuelta.",
  saludar: "Salúdala por su cumpleaños.",
};

function FollowUpSheet({ open, onClose, person, intent }: SheetProps & { intent?: FollowUpIntent }) {
  const m = useMembers();
  const v = m.views.get(person.id)!;
  const [date, setDate] = useState(m.today);
  const [type, setType] = useState<FollowUpType>("whatsapp");
  const [result, setResult] = useState<FollowUpResult | null>(null);
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextDate, setNextDate] = useState("");
  // Si el responsable actual perdió acceso, el select parte en "Elige un
  // responsable" y no se envía ownerUid salvo que se elija otro (se mantiene).
  const currentOwner = person.followUpOwnerUid ?? null;
  const ownerLost = !!currentOwner && !v.ownerValid;
  const lostOwnerName = ownerLost ? (m.state.users.find((u) => u.uid === currentOwner)?.displayName ?? null) : null;
  const [owner, setOwner] = useState(ownerLost ? "" : (currentOwner ?? ""));
  const [chkStatus, setChkStatus] = useState(true);
  const [chkDnc, setChkDnc] = useState(true);
  const [chkClose, setChkClose] = useState(true);
  const [errors, setErrors] = useState<{ date?: string; result?: string; nextDate?: string }>({});

  const suggestion = result ? suggestStatusAfterFollowUp(person, { result }, m.state.followUps) : {};
  const ownerOptions = m.owners;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!date || compareLocal(date, m.today) > 0) errs.date = "El seguimiento no puede ser futuro.";
    if (!result) errs.result = "Elige el resultado del contacto.";
    if (nextDate && date && compareLocal(nextDate, date) < 0) errs.nextDate = "La próxima acción no puede ser antes del seguimiento.";
    setErrors(errs);
    if (Object.keys(errs).length || !result) return;
    const sug = suggestion;
    // "" con responsable sin acceso = no tocar; UNASSIGN = dejar sin asignar.
    const pickedOwner = owner === UNASSIGN ? null : owner === "" ? (ownerLost ? currentOwner : null) : owner;
    const ownerChange = pickedOwner === currentOwner ? {} : { ownerUid: pickedOwner };
    const status =
      sug.status === "en_seguimiento" && chkStatus ? sug.status : sug.status === "sin_continuidad" && chkClose ? sug.status : undefined;
    const res = m.dispatch(
      {
        type: "followup/register",
        input: {
          personId: person.id,
          at: date === m.today ? m.now : `${date}T12:00`,
          type,
          result,
          ...(note.trim() ? { note } : {}),
          ...(nextAction.trim() ? { nextAction } : {}),
          ...(nextDate ? { nextActionDate: nextDate } : {}),
          ...ownerChange,
        },
        ...(status ? { confirmStatus: status } : {}),
        ...(status === "sin_continuidad" ? { confirmClosedReason: "no_desea_contacto" as ClosedReason } : {}),
        ...(sug.doNotContact && chkDnc ? { confirmDoNotContact: true } : {}),
      },
      status ? `Seguimiento registrado · estado: ${STATUS_LABEL[status]}` : "Seguimiento registrado",
    );
    if (res.ok) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      labelId="sx-followup-title"
      title={`Registrar seguimiento · ${person.fullName}`}
      subtitle={intent ? INTENT_HINT[intent] : undefined}
      footer={<Foot onCancel={onClose} submitLabel="Guardar seguimiento" form="sx-followup-form" />}
    >
      <form id="sx-followup-form" className="sx-form" onSubmit={submit} noValidate>
        {!person.doNotContact && (
          <button type="button" className="fx-btn fx-btn-secondary sx-btn-block" onClick={() => m.whatsapp(person)}>
            <MessageCircle size={16} aria-hidden="true" /> Abrir WhatsApp
          </button>
        )}
        <div className="fx-field">
          <label htmlFor="sx-fu-date">Fecha</label>
          <input
            id="sx-fu-date"
            type="date"
            lang="es-CL"
            className="fx-input"
            value={date}
            max={m.today}
            aria-invalid={!!errors.date}
            aria-describedby={errors.date ? "sx-fu-date-error" : "sx-fu-date-echo"}
            onChange={(e) => setDate(e.target.value)}
          />
          {errors.date ? <FieldError id="sx-fu-date-error">{errors.date}</FieldError> : <DateEcho id="sx-fu-date-echo" value={date} />}
        </div>
        <fieldset className="sx-fieldset">
          <legend>Tipo</legend>
          <div className="sx-choices is-4">
            {TYPES.map((t) => (
              <label key={t} className="sx-choice">
                <input type="radio" name="sx-fu-type" value={t} checked={type === t} onChange={() => setType(t)} />
                <span>{FOLLOWUP_TYPE_LABEL[t]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="sx-fieldset" aria-describedby={errors.result ? "sx-fu-result-error" : undefined}>
          <legend>Resultado</legend>
          <div className="sx-choices is-wrap">
            {RESULTS.map((r) => (
              <label key={r} className="sx-choice">
                <input
                  type="radio"
                  name="sx-fu-result"
                  value={r}
                  checked={result === r}
                  onChange={() => {
                    setResult(r);
                    setChkStatus(true);
                    setChkDnc(true);
                    setChkClose(true);
                    setErrors((x) => ({ ...x, result: undefined }));
                  }}
                />
                <span>{FOLLOWUP_RESULT_LABEL[r]}</span>
              </label>
            ))}
          </div>
          {errors.result && <FieldError id="sx-fu-result-error">{errors.result}</FieldError>}
        </fieldset>

        {(suggestion.status || suggestion.doNotContact) && (
          <div className="sx-suggest" aria-live="polite">
            <p className="sx-suggest-title">
              <Info size={16} aria-hidden="true" /> Sugerencia
            </p>
            {suggestion.status === "en_seguimiento" && (
              <label className="sx-check">
                <input type="checkbox" checked={chkStatus} onChange={(e) => setChkStatus(e.target.checked)} />
                <span>
                  Cambiar estado a <strong>En seguimiento</strong>
                </span>
              </label>
            )}
            {suggestion.doNotContact && (
              <label className="sx-check">
                <input type="checkbox" checked={chkDnc} onChange={(e) => setChkDnc(e.target.checked)} />
                <span>
                  Marcar <strong>No contactar</strong>
                </span>
              </label>
            )}
            {suggestion.status === "sin_continuidad" && (
              <label className="sx-check">
                <input type="checkbox" checked={chkClose} onChange={(e) => setChkClose(e.target.checked)} />
                <span>
                  Cerrar como <strong>Sin continuidad</strong> (motivo: no desea contacto)
                </span>
              </label>
            )}
            <p className="fx-help">Puedes desmarcarlo. Ningún estado cambia sin tu confirmación.</p>
          </div>
        )}

        <div className="fx-field">
          <label htmlFor="sx-fu-note">Nota</label>
          <textarea id="sx-fu-note" className="sx-textarea" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="fx-field">
          <label htmlFor="sx-fu-next">Próxima acción</label>
          <input
            id="sx-fu-next"
            className="fx-input"
            value={nextAction}
            maxLength={200}
            placeholder="Ej.: Llamar de nuevo"
            onChange={(e) => setNextAction(e.target.value)}
          />
          <div className="sx-chips" role="group" aria-label="Sugerencias de próxima acción">
            {NEXT_SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="sx-chip" aria-pressed={nextAction === s} onClick={() => setNextAction(s)}>
                {s}
              </button>
            ))}
          </div>
          {v.next && (
            <p className="fx-help">
              {nextAction.trim() ? "Reemplaza" : "Al guardar queda sin efecto"} la próxima acción actual: «{v.next.text}»
              {v.next.date ? ` (${shortDate(v.next.date)})` : ""}.
            </p>
          )}
        </div>
        <div className="sx-form-row">
          <div className="fx-field">
            <label htmlFor="sx-fu-next-date">Fecha de la próxima acción</label>
            <input
              id="sx-fu-next-date"
              type="date"
              lang="es-CL"
              className="fx-input"
              value={nextDate}
              min={date}
              aria-invalid={!!errors.nextDate}
              aria-describedby={errors.nextDate ? "sx-fu-next-date-error" : nextDate ? "sx-fu-next-date-echo" : undefined}
              onChange={(e) => setNextDate(e.target.value)}
            />
            {errors.nextDate ? (
              <FieldError id="sx-fu-next-date-error">{errors.nextDate}</FieldError>
            ) : (
              <DateEcho id="sx-fu-next-date-echo" value={nextDate} />
            )}
          </div>
          <div className="fx-field">
            <label htmlFor="sx-fu-owner">Responsable</label>
            <select
              id="sx-fu-owner"
              className="fx-select"
              value={owner}
              aria-describedby={ownerLost ? "sx-fu-owner-help" : undefined}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">{ownerLost ? "Elige un responsable" : "Sin asignar"}</option>
              {ownerLost && <option value={UNASSIGN}>Sin asignar</option>}
              {ownerOptions.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName}
                </option>
              ))}
            </select>
            {ownerLost && (
              <p id="sx-fu-owner-help" className="fx-help sx-owner-lost">
                <TriangleAlert size={14} aria-hidden="true" />
                <span>
                  El responsable actual ya no tiene acceso{lostOwnerName ? ` (${lostOwnerName})` : ""}. Si no eliges otro, el seguimiento se
                  guarda igual.
                </span>
              </p>
            )}
          </div>
        </div>
      </form>
    </Sheet>
  );
}

// ---------- Cambiar estado ----------

const STATUS_HELP: Record<ConsolidationStatus, string> = {
  por_contactar: "Aún no hay un primer contacto exitoso.",
  en_seguimiento: "Ya hubo contacto y se está acompañando.",
  integrandose: "Participa en un área o discipulado.",
  integrado: "Pasa a ser integrante de la iglesia.",
  sin_continuidad: "Se cierra el acompañamiento.",
};
const REASONS: ClosedReason[] = ["no_responde", "cambio_iglesia", "se_mudo", "no_desea_contacto", "otro"];

function StatusSheet({ open, onClose, person }: SheetProps) {
  const m = useMembers();
  const current = person.consolidationStatus;
  const reopening = current === "sin_continuidad";
  const [to, setTo] = useState<ConsolidationStatus | null>(reopening ? "en_seguimiento" : null);
  const [reason, setReason] = useState<ClosedReason | "">("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ to?: string; reason?: string }>({});
  const name = firstName(person.fullName);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!to) errs.to = "Elige el nuevo estado.";
    if (to === "sin_continuidad" && !reason) errs.reason = "Elige el motivo de Sin continuidad.";
    setErrors(errs);
    if (!to || Object.keys(errs).length) return;
    const text = note.trim() || (to === "sin_continuidad" && reason ? CLOSED_REASON_LABEL[reason] : reopening ? "Se reabrió el seguimiento" : undefined);
    const res = m.dispatch(
      {
        type: "person/changeStatus",
        personId: person.id,
        to,
        ...(text ? { reason: text } : {}),
        ...(to === "sin_continuidad" && reason ? { closedReason: reason } : {}),
      },
      reopening && to !== "sin_continuidad" ? "Seguimiento reabierto" : `Estado cambiado a ${STATUS_LABEL[to]}`,
    );
    if (res.ok) onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="center"
      labelId="sx-status-title"
      title={reopening ? `Reabrir seguimiento · ${person.fullName}` : `Cambiar estado · ${person.fullName}`}
      subtitle={
        <span className="sx-inline">
          Estado actual: <PersonStatusBadge status={current} />
        </span>
      }
      footer={
        <Foot
          onCancel={onClose}
          cancelLabel="Volver"
          form="sx-status-form"
          submitLabel={to === "integrado" ? "Confirmar: Integrado" : "Guardar cambio"}
        />
      }
    >
      <form id="sx-status-form" className="sx-form" onSubmit={submit} noValidate>
        <fieldset className="sx-fieldset" aria-describedby={errors.to ? "sx-status-error" : undefined}>
          <legend className="fx-sr">Nuevo estado</legend>
          <div className="sx-status-options">
            {STATUS_ORDER.map((s) => {
              const Icon = STATUS_VIS[s].icon;
              const isCurrent = s === current;
              return (
                <label key={s} className={`sx-status-option${isCurrent ? " is-current" : ""}`}>
                  <input
                    type="radio"
                    name="sx-status"
                    value={s}
                    checked={to === s}
                    disabled={isCurrent}
                    onChange={() => {
                      setTo(s);
                      setErrors({});
                    }}
                  />
                  <Icon size={16} aria-hidden="true" className={`sx-status-option-icon fx-tone-${STATUS_VIS[s].tone}`} />
                  <span className="sx-status-option-text">
                    <span className="sx-status-option-name">
                      {STATUS_LABEL[s]}
                      {reopening && s === "en_seguimiento" ? " (reabrir)" : ""}
                      {isCurrent ? " · estado actual" : ""}
                    </span>
                    <span className="fx-help">{STATUS_HELP[s]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.to && <FieldError id="sx-status-error">{errors.to}</FieldError>}
        </fieldset>

        {to === "sin_continuidad" && (
          <div className="fx-field">
            <label htmlFor="sx-status-reason">Motivo (obligatorio)</label>
            <select
              id="sx-status-reason"
              className="fx-select"
              value={reason}
              aria-required="true"
              aria-invalid={!!errors.reason}
              aria-describedby={errors.reason ? "sx-status-reason-error" : undefined}
              onChange={(e) => setReason(e.target.value as ClosedReason)}
            >
              <option value="">Elige un motivo</option>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {CLOSED_REASON_LABEL[r]}
                </option>
              ))}
            </select>
            {errors.reason && <FieldError id="sx-status-reason-error">{errors.reason}</FieldError>}
          </div>
        )}
        {to === "integrado" && (
          <Callout tone="info" icon={Info}>
            {name} pasará a ser integrante. Saldrá de las listas activas de Consolidación y conservará todo su historial.
          </Callout>
        )}
        {to === "integrandose" && (
          <Callout tone="info" icon={Info}>
            {name} sigue en Consolidación mientras se integra. El cambio queda en su historial.
          </Callout>
        )}
        {to && (
          <div className="fx-field">
            <label htmlFor="sx-status-note">Nota (opcional)</label>
            <textarea id="sx-status-note" className="sx-textarea" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
      </form>
    </Sheet>
  );
}

// ---------- Asignar responsable ----------

function AssignSheet({ open, onClose, person }: SheetProps) {
  const m = useMembers();
  const initial = person.followUpOwnerUid && m.owners.some((u) => u.uid === person.followUpOwnerUid) ? person.followUpOwnerUid : "";
  const [owner, setOwner] = useState(initial || (m.owners.some((u) => u.uid === m.profileId) ? m.profileId : ""));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = owner || null;
    if (target === person.followUpOwnerUid) return onClose();
    const res = m.dispatch({ type: "person/assignOwner", personId: person.id, ownerUid: target }, "Responsable asignado");
    if (res.ok) onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="center"
      labelId="sx-assign-title"
      title={`Asignar responsable · ${person.fullName}`}
      footer={<Foot onCancel={onClose} submitLabel="Guardar responsable" form="sx-assign-form" />}
    >
      <form id="sx-assign-form" className="sx-form" onSubmit={submit} noValidate>
        <div className="fx-field">
          <label htmlFor="sx-assign-owner">Responsable de seguimiento</label>
          <select id="sx-assign-owner" className="fx-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Sin asignar</option>
            {m.owners.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.displayName}
              </option>
            ))}
          </select>
          <p className="fx-help">Solo personas del equipo con acceso a Consolidación.</p>
        </div>
        {!owner && (
          <Callout tone="warning" icon={TriangleAlert}>
            Seguirá en Necesitan atención hasta que alguien la tome.
          </Callout>
        )}
      </form>
    </Sheet>
  );
}

// ---------- Acciones de una fila (móvil) ----------

function RowActionsSheet({ open, onClose, person, onPick }: SheetProps & { onPick: (k: SheetKind) => void }) {
  const m = useMembers();
  const v = m.views.get(person.id);
  const integrated = person.lifecycleStage === "integrante";
  return (
    <Sheet open={open} onClose={onClose} labelId="sx-row-actions-title" title={`Acciones para ${person.fullName}`}>
      <div className="sx-action-rows">
        {m.canManage && !integrated && (
          <>
            <button type="button" className="sx-action-row" onClick={() => onPick("visit")}>
              <CalendarPlus size={20} aria-hidden="true" /> Registrar visita
            </button>
            <button type="button" className="sx-action-row" onClick={() => onPick("followup")}>
              <MessageSquarePlus size={20} aria-hidden="true" /> Registrar seguimiento
            </button>
          </>
        )}
        {!person.doNotContact && (
          <button
            type="button"
            className="sx-action-row"
            onClick={() => {
              onClose();
              m.whatsapp(person);
            }}
          >
            <MessageCircle size={20} aria-hidden="true" /> Abrir WhatsApp
          </button>
        )}
        <Link href={m.hrefFor(personHref(person.id))} className="sx-action-row" onClick={onClose}>
          <UserRound size={20} aria-hidden="true" /> Ver ficha
        </Link>
      </div>
      {v?.next && (
        <p className="fx-help" style={{ marginTop: 12 }}>
          Próxima acción: {v.next.text}
          {v.next.date ? ` · ${relDay(v.next.date, m.today)}` : ""}
        </p>
      )}
      {person.doNotContact && <p className="fx-help" style={{ marginTop: 12 }}>Pidió no recibir contacto: no se muestra WhatsApp.</p>}
    </Sheet>
  );
}

