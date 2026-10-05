"use client";

// Acciones de Consolidación en sheets/diálogos (16b §9.6–9.8): Registrar
// visita, Registrar seguimiento, Cambiar estado / Reabrir, Asignar
// responsable, No contactar y el sheet de acciones de una fila (móvil). Se
// abren desde cualquier pantalla con useMemberActions().open(kind, personId).
//
// Reglas de producción:
// - nada cambia en silencio: cada sugerencia se confirma explícitamente;
// - sin actualizaciones optimistas: el toast aparece cuando el callable
//   resuelve y onSnapshot refresca los datos;
// - un requestId por formulario abierto, reutilizado en cada reintento;
// - expectedRevision = revisión de la persona (conflicto → pedir recargar);
// - la intención de cada diálogo (valor objetivo, estado de origen) se congela
//   al abrir: si otra persona cambia ese dato mientras está abierto, se muestra
//   el conflicto en vez de invertir la acción.

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BellOff,
  CalendarPlus,
  Info,
  Loader2,
  MessageCircle,
  MessageSquarePlus,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
  UserRound,
  WifiOff,
} from "lucide-react";
import { CalDialog, FieldError, InlineNotice } from "@/components/calendar/ui";
import { useToast } from "@/components/layout/notice";
import { useCalendarEvents } from "@/lib/calendar/events-client";
import { occurrencesInRange } from "@/lib/shared/calendar-core";
import { isValidYmd } from "@/lib/shared/dates";
import {
  CLOSED_REASONS,
  CLOSED_REASON_LABEL,
  CONSOLIDATION_STATUSES,
  FOLLOW_UP_RESULTS,
  FOLLOW_UP_RESULT_LABEL,
  FOLLOW_UP_TYPES,
  FOLLOW_UP_TYPE_LABEL,
  MEMBERS_ERROR_KEYS,
  MEMBERS_LIMITS,
  SENSITIVE_NOTE_WARNING,
  STATUS_LABEL,
  checkTransition,
  parseFollowUpCreate,
  parseStatusChange,
  parseVisitCreate,
  suggestAfterFollowUp,
  suggestReopenOnVisit,
  whatsappLink,
  type ClosedReason,
  type ConsolidationStatus,
  type FollowUpCreateRequest,
  type FollowUpResult,
  type FollowUpType,
  type StatusChangeRequest,
  type VisitCreateRequest,
} from "@/lib/shared/members";
import {
  MEMBERS_CONFLICT_TEXT,
  MembersApiError,
  changeStatus,
  createFollowUp,
  createVisit,
  fieldMessages,
  newRequestId,
  toMembersError,
  updatePerson,
} from "@/lib/members/api";
import { useMembers } from "@/lib/members/use-members";
import type { LocalDateTime, Person, Ymd } from "@/lib/members/types";
import { dateEcho, firstName, personHref, relDay, shortDate } from "./model";
import { PersonStatusBadge, STATUS_VIS } from "./vocab";

export type SheetKind = "visit" | "followup" | "status" | "assign" | "dnc" | "actions";
export type FollowUpIntent = "agradecer" | "contactar" | "invitar";

interface Req {
  kind: SheetKind;
  personId: string;
  intent?: FollowUpIntent;
  seq: number;
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

/** Proveedor + host de los sheets (solo se monta el abierto). */
export function MemberActions({ children }: { children: React.ReactNode }) {
  const m = useMembers();
  const [req, setReq] = useState<Req | null>(null);
  const seq = useRef(0);
  const open = useCallback((kind: SheetKind, personId: string, intent?: FollowUpIntent) => {
    seq.current += 1;
    setReq({ kind, personId, intent, seq: seq.current });
  }, []);
  const close = useCallback(() => setReq(null), []);
  const value = useMemo(() => ({ open }), [open]);
  // La persona se lee en vivo: revisión y proyección actuales (también si se
  // leyó aparte, fuera del límite de la lista).
  const person = req ? (m.viewOf(req.personId)?.person ?? null) : null;
  const manageable = m.canManage && !!person;
  return (
    <Ctx.Provider value={value}>
      {children}
      {req && person && (
        <>
          {req.kind === "visit" && manageable && <VisitSheet key={req.seq} person={person} onClose={close} />}
          {req.kind === "followup" && manageable && <FollowUpSheet key={req.seq} person={person} intent={req.intent} onClose={close} />}
          {req.kind === "status" && manageable && <StatusSheet key={req.seq} person={person} onClose={close} />}
          {req.kind === "assign" && manageable && <AssignSheet key={req.seq} person={person} onClose={close} />}
          {req.kind === "dnc" && manageable && <DoNotContactSheet key={req.seq} person={person} onClose={close} />}
          {req.kind === "actions" && (
            <RowActionsSheet key={req.seq} person={person} onClose={close} onPick={(k) => open(k, person.id)} />
          )}
        </>
      )}
    </Ctx.Provider>
  );
}

interface SheetProps {
  person: Person;
  onClose: () => void;
}

// ---------- Piezas compartidas de formulario ----------

/**
 * Envío único: bloquea el doble submit y traduce el error del callable.
 * `error` es null solo si se ignoró el envío por haber otro en curso.
 */
export function useWrite() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MembersApiError | null>(null);
  const busy = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: MembersApiError | null }> => {
    if (busy.current) return { ok: false, error: null };
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      const error = toMembersError(e);
      setError(error);
      return { ok: false, error };
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }, []);
  return { submitting, error, setError, run };
}

/** Recarga la página (conflicto de revisión). */
export function reloadPage() {
  window.location.reload();
}

/** Conflicto detectado en el cliente: el dato que el diálogo iba a cambiar ya cambió en vivo. */
export const LOCAL_CONFLICT = new MembersApiError(MEMBERS_ERROR_KEYS.conflict, "conflict", MEMBERS_CONFLICT_TEXT);

/** Error general del formulario; el conflicto ofrece recargar. */
export function FormError({ error }: { error: MembersApiError | null }) {
  if (!error) return null;
  return (
    <InlineNotice tone="danger" icon={TriangleAlert} role="alert">
      <p>{error.message}</p>
      {error.kind === "conflict" && (
        <button type="button" className="button-secondary mem-notice-btn" onClick={reloadPage}>
          <RefreshCw size={16} aria-hidden="true" /> Recargar
        </button>
      )}
    </InlineNotice>
  );
}

export function DoNotContactNotice() {
  return (
    <InlineNotice tone="warning" icon={BellOff} role="status">
      Esta persona pidió no ser contactada.
    </InlineNotice>
  );
}

export function OfflineNotice() {
  return (
    <InlineNotice tone="warning" icon={WifiOff} role="status">
      Sin conexión. Para guardar necesitas conexión.
    </InlineNotice>
  );
}

export function SubmitButton({
  form,
  submitting,
  disabled,
  label,
  busyLabel = "Guardando…",
}: {
  form?: string;
  submitting: boolean;
  disabled?: boolean;
  label: string;
  busyLabel?: string;
}) {
  return (
    <button type="submit" form={form} className="button-primary mem-submit" disabled={submitting || disabled} aria-busy={submitting || undefined}>
      {submitting && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
      {submitting ? busyLabel : label}
    </button>
  );
}

function Foot({
  onCancel,
  submitLabel,
  form,
  submitting,
  disabled,
  cancelLabel = "Cancelar",
}: {
  onCancel: () => void;
  submitLabel: string;
  form: string;
  submitting: boolean;
  disabled?: boolean;
  cancelLabel?: string;
}) {
  return (
    <div className="mem-foot">
      <button type="button" className="button-secondary" onClick={onCancel} disabled={submitting}>
        {cancelLabel}
      </button>
      <SubmitButton form={form} submitting={submitting} disabled={disabled} label={submitLabel} />
    </div>
  );
}

/** Nota operacional breve: maxLength, contador visible y advertencia de datos sensibles. */
export function NoteField({
  id,
  label,
  value,
  onChange,
  max,
  error,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  error?: string;
  required?: boolean;
}) {
  const help = `${id}-help`;
  const err = `${id}-error`;
  return (
    <div className="mem-field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="mem-textarea"
        value={value}
        maxLength={max}
        rows={3}
        aria-required={required || undefined}
        aria-invalid={!!error || undefined}
        aria-describedby={`${help}${error ? ` ${err}` : ""}`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="mem-note-help" id={help}>
        <span className="mem-sensitive">
          <Info size={14} aria-hidden="true" />
          {SENSITIVE_NOTE_WARNING}
        </span>
        <span className="mem-counter" aria-live="polite">
          {value.length}/{max}
        </span>
      </p>
      <FieldError id={err} message={error} />
    </div>
  );
}

function DateEcho({ id, value }: { id: string; value: string }) {
  const text = dateEcho(value);
  if (!text) return null;
  return (
    <p className="mem-date-echo" id={id}>
      {text}
    </p>
  );
}

/** Enlace real a WhatsApp (wa.me, sin texto prellenado). Oculto con "No contactar" o teléfono inválido. */
export function WhatsAppLink({
  person,
  className = "button-secondary",
  label = "WhatsApp",
  iconSize = 16,
}: {
  person: Pick<Person, "phoneE164" | "doNotContact" | "fullName">;
  className?: string;
  label?: string;
  iconSize?: number;
}) {
  const href = whatsappLink(person);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={`${label}: ${person.fullName} (se abre en otra pestaña)`}
    >
      <MessageCircle size={iconSize} aria-hidden="true" /> {label}
    </a>
  );
}

/**
 * Actividad del calendario (opcional). Solo se monta con calendar.read: lista
 * las actividades no canceladas de esa fecha. Nunca se elige sola.
 */
export function ActivityField({
  id,
  date,
  now,
  value,
  onChange,
  error,
  label = "Actividad (opcional)",
}: {
  id: string;
  date: Ymd;
  now: LocalDateTime;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  label?: string;
}) {
  const valid = isValidYmd(date);
  const { events, loading, error: loadError } = useCalendarEvents(valid ? date : "");
  const occurrences = useMemo(
    () => (valid ? occurrencesInRange(events, date, date, now).filter((o) => o.status !== "cancelled") : []),
    [events, date, now, valid],
  );
  const available = occurrences.some((o) => o.eventId === value);
  // Un id que ya no está entre las opciones (actividad cancelada, otra fecha)
  // se limpia: con «Sin actividad» a la vista nunca se envía un id oculto.
  const stale = !!value && !(valid && loading) && !available;
  useEffect(() => {
    if (stale) onChange("");
  }, [stale, onChange]);
  const help = `${id}-help`;
  return (
    <div className="mem-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="mem-select"
        value={available ? value : ""}
        aria-describedby={help}
        aria-invalid={!!error || undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Sin actividad</option>
        {occurrences.map((o) => (
          <option key={o.key} value={o.eventId}>
            {o.event.title}
            {o.allDay ? " · todo el día" : o.startTime ? ` · ${o.startTime}` : ""}
          </option>
        ))}
      </select>
      <p className="mem-help" id={help}>
        {valid && loading
          ? "Cargando actividades de ese día…"
          : loadError
            ? "No pudimos cargar las actividades. Puedes guardar sin actividad."
            : valid && !occurrences.length
              ? "No hay actividades en el calendario ese día. Basta con la fecha."
              : "Opcional. Basta con la fecha."}
      </p>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

// ---------- Registrar visita ----------

function VisitSheet({ person, onClose }: SheetProps) {
  const m = useMembers();
  const { toast } = useToast();
  const uid = useId();
  const formId = `mem-visit-form${uid}`;
  const [requestId] = useState(newRequestId);
  const [date, setDate] = useState(m.today);
  const [eventId, setEventId] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reopenOffer, setReopenOffer] = useState<{ revision: number | null } | null>(null);
  const write = useWrite();
  const reopen = useWrite();
  const name = firstName(person.fullName);
  const closed = suggestReopenOnVisit(person);
  const sameDay = person.projection.lastVisitDate === date || person.projection.firstVisitDate === date;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: VisitCreateRequest = {
      requestId,
      personId: person.id,
      date,
      ...(m.canReadCalendar && eventId ? { calendarEventId: eventId } : {}),
      ...(note.trim() ? { note } : {}),
    };
    const parsed = parseVisitCreate(payload, m.today);
    if (!parsed.ok) {
      setErrors(fieldMessages(parsed.errors));
      return;
    }
    setErrors({});
    const res = await write.run(() => createVisit(payload));
    if (!res.ok) return;
    toast(res.value.replay ? "La visita ya estaba registrada" : "Visita registrada");
    if (res.value.suggestReopen) setReopenOffer({ revision: res.value.revision });
    else onClose();
  };

  // write.error con campos del servidor → errores por campo.
  const serverFields = write.error?.fields ?? {};
  const fieldError = (k: string) => errors[k] ?? serverFields[k];

  if (reopenOffer) {
    const doReopen = async () => {
      const res = await reopen.run(() =>
        changeStatus({
          personId: person.id,
          expectedRevision: reopenOffer.revision ?? person.revision,
          status: "en_seguimiento",
        }),
      );
      if (!res.ok) return;
      toast("Seguimiento reabierto");
      onClose();
    };
    return (
      <CalDialog
        title={`Visita registrada · ${person.fullName}`}
        onClose={onClose}
        busy={reopen.submitting}
        footer={
          <div className="mem-foot">
            <button type="button" className="button-secondary" onClick={onClose} disabled={reopen.submitting}>
              Ahora no
            </button>
            <button
              type="button"
              className="button-primary mem-submit"
              onClick={doReopen}
              disabled={reopen.submitting || !m.online}
              aria-busy={reopen.submitting || undefined}
            >
              {reopen.submitting && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {reopen.submitting ? "Guardando…" : "Reabrir seguimiento"}
            </button>
          </div>
        }
      >
        <div className="mem-form">
          <div className="mem-suggest" role="status">
            <p className="mem-suggest-title">
              <RotateCcw size={16} aria-hidden="true" /> Esta persona volvió. ¿Reabrir seguimiento?
            </p>
            <p className="mem-help">
              {name} está en Sin continuidad. Si reabres, pasa a <strong>En seguimiento</strong>. Si no, su estado no cambia.
            </p>
          </div>
          {!m.online && <OfflineNotice />}
          <FormError error={reopen.error} />
        </div>
      </CalDialog>
    );
  }

  return (
    <CalDialog
      title={`Registrar visita · ${person.fullName}`}
      onClose={onClose}
      busy={write.submitting}
      footer={<Foot onCancel={onClose} submitLabel="Guardar visita" form={formId} submitting={write.submitting} disabled={!m.online} />}
    >
      <form id={formId} className="mem-form" onSubmit={submit} noValidate>
        {person.doNotContact && <DoNotContactNotice />}
        {closed && (
          <InlineNotice tone="info" icon={RotateCcw}>
            {name} está en Sin continuidad. Al guardar la visita podrás reabrir su seguimiento.
          </InlineNotice>
        )}
        <div className="mem-field">
          <label htmlFor="mem-visit-date">Fecha</label>
          <input
            id="mem-visit-date"
            type="date"
            lang="es-CL"
            className="mem-input mem-input-date"
            value={date}
            max={m.today}
            required
            aria-invalid={!!fieldError("date") || undefined}
            aria-describedby={fieldError("date") ? "mem-visit-date-error" : "mem-visit-date-echo"}
            onChange={(e) => {
              setDate(e.target.value);
              setEventId("");
            }}
          />
          {fieldError("date") ? (
            <FieldError id="mem-visit-date-error" message={fieldError("date")} />
          ) : (
            <DateEcho id="mem-visit-date-echo" value={date} />
          )}
        </div>
        {m.canReadCalendar && (
          <ActivityField
            id="mem-visit-activity"
            label="Actividad o servicio (opcional)"
            date={date}
            now={m.now}
            value={eventId}
            onChange={setEventId}
            error={fieldError("calendarEventId")}
          />
        )}
        <NoteField
          id="mem-visit-note"
          label="Observación (opcional)"
          value={note}
          onChange={setNote}
          max={MEMBERS_LIMITS.note}
          error={fieldError("note")}
        />
        {sameDay && (
          <InlineNotice tone="warning" icon={Info} role="status">
            Ya hay una visita registrada el {shortDate(date)}. ¿Registrar otra?
          </InlineNotice>
        )}
        <p className="mem-help">Se agrega al historial; las visitas anteriores no cambian.</p>
        {!m.online && <OfflineNotice />}
        <FormError error={write.error} />
      </form>
    </CalDialog>
  );
}

// ---------- Registrar seguimiento ----------

const NEXT_SUGGESTIONS = ["Invitar al culto del domingo", "Llamar de nuevo", "Invitar a un grupo"];

const INTENT_HINT: Record<FollowUpIntent, string> = {
  agradecer: "Agradece su visita y cuéntale que es bienvenida.",
  contactar: "Primer contacto: preséntate y agradece su visita.",
  invitar: "Hace varios días que no viene: invítala de vuelta.",
};

function FollowUpSheet({ person, intent, onClose }: SheetProps & { intent?: FollowUpIntent }) {
  const m = useMembers();
  const { toast } = useToast();
  const uid = useId();
  const formId = `mem-followup-form${uid}`;
  const v = m.viewOf(person.id);
  // Se renueva solo tras `suggestion-mismatch` (el servidor no escribió nada).
  const [requestId, setRequestId] = useState(newRequestId);
  // Tras un intento con este requestId, un reintento puede ser un replay de una
  // escritura ya confirmada: las casillas de la sugerencia quedan fijas.
  const [attempted, setAttempted] = useState(false);
  const [date, setDate] = useState(m.today);
  const [type, setType] = useState<FollowUpType>("whatsapp");
  const [result, setResult] = useState<FollowUpResult | null>(null);
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextDate, setNextDate] = useState("");
  const currentOwner = person.followUpOwnerUid;
  const ownerLost = !!currentOwner && !!m.owners && !m.owners.some((o) => o.uid === currentOwner);
  const [owner, setOwner] = useState(currentOwner && !ownerLost ? currentOwner : "");
  // Solo un responsable de la lista; vacío = no se envía y el servidor usa el de la persona.
  const ownerValue = owner && m.owners?.some((o) => o.uid === owner) ? owner : "";
  const [chkStatus, setChkStatus] = useState(true);
  const [chkDnc, setChkDnc] = useState(true);
  const [chkClose, setChkClose] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const write = useWrite();

  const suggestion = result
    ? suggestAfterFollowUp(
        {
          lifecycleStage: person.lifecycleStage,
          consolidationStatus: person.consolidationStatus,
          doNotContact: person.doNotContact,
          firstContactDate: person.projection.firstContactDate,
        },
        result,
      )
    : null;
  const suggestsFollow = suggestion?.status === "en_seguimiento";
  const suggestsClose = suggestion?.status === "sin_continuidad";
  const suggestsDnc = !!suggestion?.doNotContact;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const applyStatus: ConsolidationStatus | null =
      suggestsFollow && chkStatus ? "en_seguimiento" : suggestsClose && chkClose ? "sin_continuidad" : null;
    const payload: FollowUpCreateRequest = {
      requestId,
      personId: person.id,
      contactDate: date,
      type,
      result: result as FollowUpResult,
      note: note.trim() ? note : null,
      nextAction: nextAction.trim() ? nextAction : null,
      nextActionDate: nextDate || null,
      // Sin elección (o sin lista de responsables) no se envía: el servidor usa el de la persona.
      ...(m.owners && ownerValue ? { ownerUid: ownerValue } : {}),
      ...(applyStatus ? { applyStatus } : {}),
      ...(suggestsDnc && chkDnc ? { applyDoNotContact: true } : {}),
    };
    const parsed = parseFollowUpCreate(result ? payload : { ...payload, result: undefined }, m.today);
    if (!parsed.ok) {
      setErrors(fieldMessages(parsed.errors));
      return;
    }
    setErrors({});
    setAttempted(true);
    const res = await write.run(() => createFollowUp(payload));
    if (!res.ok) {
      if (res.error?.kind === "suggestion_mismatch") {
        // Nada se escribió: la sugerencia se recalcula sola desde la persona en
        // vivo y se vuelve a proponer marcada, con un requestId nuevo.
        setChkStatus(true);
        setChkDnc(true);
        setChkClose(true);
        setRequestId(newRequestId());
        setAttempted(false);
      }
      // Cualquier otro error: las casillas quedan exactamente como estaban.
      return;
    }
    const { replay, applied } = res.value;
    if (replay) toast("Seguimiento registrado.");
    else {
      // Solo se informa lo que el servidor confirma haber aplicado.
      const parts = ["Seguimiento registrado"];
      if (applied?.status) parts.push(`estado: ${STATUS_LABEL[applied.status]}`);
      if (applied?.doNotContact) parts.push("No contactar");
      toast(parts.join(" · "));
    }
    onClose();
  };

  const serverFields = write.error?.fields ?? {};
  const fieldError = (k: string) => errors[k] ?? serverFields[k];

  return (
    <CalDialog
      title={`Registrar seguimiento · ${person.fullName}`}
      subtitle={intent ? INTENT_HINT[intent] : undefined}
      onClose={onClose}
      busy={write.submitting}
      footer={<Foot onCancel={onClose} submitLabel="Guardar seguimiento" form={formId} submitting={write.submitting} disabled={!m.online} />}
    >
      <form id={formId} className="mem-form" onSubmit={submit} noValidate>
        {person.doNotContact && <DoNotContactNotice />}
        <WhatsAppLink person={person} className="button-secondary mem-btn-block" label="Abrir WhatsApp" />
        <div className="mem-field">
          <label htmlFor="mem-fu-date">Fecha del contacto</label>
          <input
            id="mem-fu-date"
            type="date"
            lang="es-CL"
            className="mem-input mem-input-date"
            value={date}
            max={m.today}
            aria-invalid={!!fieldError("contactDate") || undefined}
            aria-describedby={fieldError("contactDate") ? "mem-fu-date-error" : "mem-fu-date-echo"}
            onChange={(e) => setDate(e.target.value)}
          />
          {fieldError("contactDate") ? (
            <FieldError id="mem-fu-date-error" message={fieldError("contactDate")} />
          ) : (
            <DateEcho id="mem-fu-date-echo" value={date} />
          )}
        </div>
        <fieldset className="mem-fieldset">
          <legend>Tipo</legend>
          <div className="mem-choices is-4">
            {FOLLOW_UP_TYPES.map((t) => (
              <label key={t} className="mem-choice">
                <input type="radio" name="mem-fu-type" value={t} checked={type === t} onChange={() => setType(t)} />
                <span>{FOLLOW_UP_TYPE_LABEL[t]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="mem-fieldset" aria-describedby={fieldError("result") ? "mem-fu-result-error" : undefined}>
          <legend>Resultado</legend>
          <div className="mem-choices is-wrap">
            {FOLLOW_UP_RESULTS.map((r) => (
              <label key={r} className="mem-choice">
                <input
                  type="radio"
                  name="mem-fu-result"
                  value={r}
                  checked={result === r}
                  onChange={() => {
                    setResult(r);
                    if (!attempted) {
                      setChkStatus(true);
                      setChkDnc(true);
                      setChkClose(true);
                    }
                    setErrors((x) => ({ ...x, result: "" }));
                  }}
                />
                <span>{FOLLOW_UP_RESULT_LABEL[r]}</span>
              </label>
            ))}
          </div>
          <FieldError id="mem-fu-result-error" message={fieldError("result") || undefined} />
        </fieldset>

        {(suggestion?.status || suggestsDnc) && (
          <div className="mem-suggest" aria-live="polite">
            <p className="mem-suggest-title">
              <Info size={16} aria-hidden="true" /> Sugerencia
            </p>
            {suggestsFollow && (
              <label className="mem-check">
                <input
                  type="checkbox"
                  checked={chkStatus}
                  disabled={attempted}
                  aria-describedby={attempted ? "mem-fu-suggest-lock" : undefined}
                  onChange={(e) => setChkStatus(e.target.checked)}
                />
                <span>
                  Cambiar estado a <strong>En seguimiento</strong>
                </span>
              </label>
            )}
            {suggestsDnc && (
              <label className="mem-check">
                <input
                  type="checkbox"
                  checked={chkDnc}
                  disabled={attempted}
                  aria-describedby={attempted ? "mem-fu-suggest-lock" : undefined}
                  onChange={(e) => setChkDnc(e.target.checked)}
                />
                <span>
                  Marcar <strong>No contactar</strong>
                </span>
              </label>
            )}
            {suggestsClose && (
              <label className="mem-check">
                <input
                  type="checkbox"
                  checked={chkClose}
                  disabled={attempted}
                  aria-describedby={attempted ? "mem-fu-suggest-lock" : undefined}
                  onChange={(e) => setChkClose(e.target.checked)}
                />
                <span>
                  Cerrar como <strong>Sin continuidad</strong> (motivo: no desea contacto)
                </span>
              </label>
            )}
            {attempted ? (
              <p className="mem-help" id="mem-fu-suggest-lock">
                Para cambiar esta opción, cierra y vuelve a abrir el formulario.
              </p>
            ) : (
              <p className="mem-help">Puedes desmarcarlo. Ningún estado cambia sin tu confirmación.</p>
            )}
          </div>
        )}

        <NoteField id="mem-fu-note" label="Observación (opcional)" value={note} onChange={setNote} max={MEMBERS_LIMITS.note} error={fieldError("note")} />
        <div className="mem-field">
          <label htmlFor="mem-fu-next">Próxima acción</label>
          <input
            id="mem-fu-next"
            className="mem-input"
            value={nextAction}
            maxLength={MEMBERS_LIMITS.nextAction}
            placeholder="Ej.: Llamar de nuevo"
            aria-invalid={!!fieldError("nextAction") || undefined}
            aria-describedby={`mem-fu-next-help${fieldError("nextAction") ? " mem-fu-next-error" : ""}`}
            onChange={(e) => setNextAction(e.target.value)}
          />
          <p className="mem-note-help" id="mem-fu-next-help">
            <span>Opcional.</span>
            <span className="mem-counter" aria-live="polite">
              {nextAction.length}/{MEMBERS_LIMITS.nextAction}
            </span>
          </p>
          <div className="mem-chips" role="group" aria-label="Sugerencias de próxima acción">
            {NEXT_SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="mem-chip" aria-pressed={nextAction === s} onClick={() => setNextAction(s)}>
                {s}
              </button>
            ))}
          </div>
          <FieldError id="mem-fu-next-error" message={fieldError("nextAction")} />
          {v?.next && (
            <p className="mem-help">
              {nextAction.trim() ? "Reemplaza" : "Al guardar queda sin efecto"} la próxima acción actual: «{v.next.text}»
              {v.next.date ? ` (${shortDate(v.next.date)})` : ""}.
            </p>
          )}
        </div>
        <div className="mem-form-row">
          <div className="mem-field">
            <label htmlFor="mem-fu-next-date">Fecha de la próxima acción</label>
            <input
              id="mem-fu-next-date"
              type="date"
              lang="es-CL"
              className="mem-input"
              value={nextDate}
              min={date}
              aria-invalid={!!fieldError("nextActionDate") || undefined}
              aria-describedby={fieldError("nextActionDate") ? "mem-fu-next-date-error" : nextDate ? "mem-fu-next-date-echo" : undefined}
              onChange={(e) => setNextDate(e.target.value)}
            />
            {fieldError("nextActionDate") ? (
              <FieldError id="mem-fu-next-date-error" message={fieldError("nextActionDate")} />
            ) : (
              <DateEcho id="mem-fu-next-date-echo" value={nextDate} />
            )}
          </div>
          <div className="mem-field">
            <label htmlFor="mem-fu-owner">Responsable de la próxima acción</label>
            <select
              id="mem-fu-owner"
              className="mem-select"
              value={ownerValue}
              disabled={!m.owners}
              aria-describedby={ownerLost || !m.owners ? "mem-fu-owner-help" : undefined}
              aria-invalid={!!fieldError("ownerUid") || undefined}
              onChange={(e) => setOwner(e.target.value)}
            >
              {/* Sin «Sin responsable»: el servidor usa el responsable de la persona. */}
              {!ownerValue && <option value="">Elige un responsable</option>}
              {(m.owners ?? []).map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName}
                </option>
              ))}
            </select>
            {ownerLost && (
              <p id="mem-fu-owner-help" className="mem-help mem-owner-lost">
                <TriangleAlert size={14} aria-hidden="true" />
                <span>El responsable actual ya no tiene acceso. Si no eliges otro, el seguimiento se guarda igual.</span>
              </p>
            )}
            {!m.owners && (
              <p id="mem-fu-owner-help" className="mem-help">
                {m.ownersLoading ? "Cargando responsables…" : "No pudimos cargar los responsables: se usará el de la persona."}
              </p>
            )}
            <FieldError id="mem-fu-owner-error" message={fieldError("ownerUid")} />
          </div>
        </div>
        {!m.online && <OfflineNotice />}
        <FormError error={write.error} />
      </form>
    </CalDialog>
  );
}

// ---------- Cambiar estado / Reabrir ----------

const STATUS_HELP: Record<ConsolidationStatus, string> = {
  por_contactar: "Aún no hay un primer contacto exitoso.",
  en_seguimiento: "Ya hubo contacto y se está acompañando.",
  integrandose: "Participa en un área o discipulado.",
  integrado: "Pasa a ser integrante de la iglesia.",
  sin_continuidad: "Se cierra el acompañamiento.",
};

function StatusSheet({ person, onClose }: SheetProps) {
  const m = useMembers();
  const { toast } = useToast();
  const uid = useId();
  const formId = `mem-status-form${uid}`;
  // Estado de origen congelado al abrir: las opciones y la intención no cambian
  // si otra persona cambia el estado mientras el diálogo está abierto.
  const [base] = useState(() => ({ consolidationStatus: person.consolidationStatus, lifecycleStage: person.lifecycleStage }));
  const current = base.consolidationStatus;
  const drifted = person.consolidationStatus !== base.consolidationStatus || person.lifecycleStage !== base.lifecycleStage;
  const reopening = current === "sin_continuidad";
  const options = CONSOLIDATION_STATUSES.filter((s) => s === current || checkTransition(base, s).ok);
  const [to, setTo] = useState<ConsolidationStatus | null>(reopening ? "en_seguimiento" : null);
  const [reason, setReason] = useState<ClosedReason | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const write = useWrite();
  const name = firstName(person.fullName);

  const request = (): StatusChangeRequest | null => {
    if (!to) return null;
    return {
      personId: person.id,
      expectedRevision: person.revision,
      status: to,
      ...(to === "sin_continuidad" ? { closedReason: reason || null, ...(reasonNote.trim() ? { reasonNote } : {}) } : {}),
      ...(to === "integrado" ? { confirmIntegrated: true } : {}),
    };
  };

  const send = async (req: StatusChangeRequest) => {
    if (drifted) {
      setConfirming(false);
      return;
    }
    const res = await write.run(() => changeStatus(req));
    if (!res.ok) {
      setConfirming(false);
      return;
    }
    toast(reopening && req.status === "en_seguimiento" ? "Seguimiento reabierto" : `Estado cambiado a ${STATUS_LABEL[req.status]}`);
    onClose();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const req = request();
    if (!req) {
      setErrors({ status: "Elige el nuevo estado." });
      return;
    }
    const parsed = parseStatusChange(req);
    if (!parsed.ok) {
      setErrors(fieldMessages(parsed.errors));
      return;
    }
    setErrors({});
    if (drifted) return;
    // Integrado: confirmación explícita en un diálogo aparte.
    if (req.status === "integrado") {
      setConfirming(true);
      return;
    }
    void send(req);
  };

  const fieldError = (k: string) => errors[k] || undefined;

  return (
    <CalDialog
      variant="center"
      title={reopening ? `Reabrir seguimiento · ${person.fullName}` : `Cambiar estado · ${person.fullName}`}
      subtitle={
        <span className="mem-inline">
          Estado actual: <PersonStatusBadge status={current} />
        </span>
      }
      onClose={onClose}
      busy={write.submitting}
      footer={
        <Foot
          onCancel={onClose}
          cancelLabel="Volver"
          form={formId}
          submitLabel="Guardar cambio"
          submitting={write.submitting}
          disabled={!m.online || drifted}
        />
      }
    >
      <form id={formId} className="mem-form" onSubmit={submit} noValidate>
        <fieldset className="mem-fieldset" aria-describedby={fieldError("status") ? "mem-status-error" : undefined}>
          <legend className="mem-sr">Nuevo estado</legend>
          <div className="mem-status-options">
            {options.map((s) => {
              const Icon = STATUS_VIS[s].icon;
              const isCurrent = s === current;
              return (
                <label key={s} className={`mem-status-option${isCurrent ? " is-current" : ""}`}>
                  <input
                    type="radio"
                    name="mem-status"
                    value={s}
                    checked={to === s}
                    disabled={isCurrent}
                    onChange={() => {
                      setTo(s);
                      setErrors({});
                    }}
                  />
                  <Icon size={16} aria-hidden="true" className={`mem-ink-${STATUS_VIS[s].tone}`} />
                  <span className="mem-status-option-text">
                    <span className="mem-status-option-name">
                      {STATUS_LABEL[s]}
                      {reopening && s === "en_seguimiento" ? " (reabrir)" : ""}
                      {isCurrent ? " · estado actual" : ""}
                    </span>
                    <span className="mem-help">{STATUS_HELP[s]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <FieldError id="mem-status-error" message={fieldError("status")} />
        </fieldset>

        {to === "sin_continuidad" && (
          <>
            <div className="mem-field">
              <label htmlFor="mem-status-reason">Motivo (obligatorio)</label>
              <select
                id="mem-status-reason"
                className="mem-select"
                value={reason}
                aria-required="true"
                aria-invalid={!!fieldError("closedReason") || undefined}
                aria-describedby={fieldError("closedReason") ? "mem-status-reason-error" : undefined}
                onChange={(e) => setReason(e.target.value as ClosedReason)}
              >
                <option value="">Elige un motivo</option>
                {CLOSED_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {CLOSED_REASON_LABEL[r]}
                  </option>
                ))}
              </select>
              <FieldError id="mem-status-reason-error" message={fieldError("closedReason")} />
            </div>
            <NoteField
              id="mem-status-note"
              label={reason === "otro" ? "Motivo (obligatorio con «Otro»)" : "Detalle del motivo (opcional)"}
              value={reasonNote}
              onChange={setReasonNote}
              max={MEMBERS_LIMITS.closedReasonNote}
              required={reason === "otro"}
              error={fieldError("reasonNote")}
            />
          </>
        )}
        {to === "integrado" && (
          <InlineNotice tone="info" icon={Info}>
            {name} pasará a ser integrante. Saldrá de las listas activas de Consolidación y conservará todo su historial.
          </InlineNotice>
        )}
        {to === "integrandose" && (
          <InlineNotice tone="info" icon={Info}>
            {name} sigue en Consolidación mientras se integra. El cambio queda en su historial.
          </InlineNotice>
        )}
        {!m.online && <OfflineNotice />}
        <FormError error={drifted ? LOCAL_CONFLICT : write.error} />
      </form>
      {confirming && (
        <CalDialog
          variant="center"
          title="¿Confirmar Integrado?"
          onClose={() => setConfirming(false)}
          busy={write.submitting}
          footer={
            <div className="mem-foot">
              <button type="button" className="button-secondary" onClick={() => setConfirming(false)} disabled={write.submitting}>
                Volver
              </button>
              <button
                type="button"
                className="button-primary mem-submit"
                disabled={write.submitting || !m.online || drifted}
                aria-busy={write.submitting || undefined}
                onClick={() => {
                  const req = request();
                  if (req) void send(req);
                }}
              >
                {write.submitting && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {write.submitting ? "Guardando…" : "Confirmar: Integrado"}
              </button>
            </div>
          }
        >
          <p className="mem-dialog-text">
            {person.fullName} pasará a ser <strong>integrante</strong>. Es la misma persona: su ficha y su historial se conservan.{" "}
            <strong>En esta versión no se puede deshacer.</strong>
          </p>
        </CalDialog>
      )}
    </CalDialog>
  );
}

// ---------- Asignar responsable ----------

function AssignSheet({ person, onClose }: SheetProps) {
  const m = useMembers();
  const { toast } = useToast();
  const uid = useId();
  const formId = `mem-assign-form${uid}`;
  const owners = m.owners;
  // Responsable de origen congelado al abrir: si cambia en vivo, conflicto.
  const [baseOwner] = useState(person.followUpOwnerUid);
  const drifted = person.followUpOwnerUid !== baseOwner;
  const valid = !!baseOwner && !!owners?.some((u) => u.uid === baseOwner);
  const [owner, setOwner] = useState(valid ? (baseOwner as string) : "");
  const write = useWrite();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (drifted) return;
    const target = owner || null;
    if (target === baseOwner) return onClose();
    const res = await write.run(() =>
      updatePerson({ personId: person.id, expectedRevision: person.revision, followUpOwnerUid: target }),
    );
    if (!res.ok) return;
    toast(target ? "Responsable asignado" : "Responsable quitado");
    onClose();
  };

  return (
    <CalDialog
      variant="center"
      title={`Asignar responsable · ${person.fullName}`}
      onClose={onClose}
      busy={write.submitting}
      footer={
        <Foot
          onCancel={onClose}
          submitLabel="Guardar responsable"
          form={formId}
          submitting={write.submitting}
          disabled={!m.online || !owners || drifted}
        />
      }
    >
      <form id={formId} className="mem-form" onSubmit={submit} noValidate>
        {owners ? (
          <div className="mem-field">
            <label htmlFor="mem-assign-owner">Responsable de seguimiento</label>
            <select
              id="mem-assign-owner"
              className="mem-select"
              value={owner}
              aria-invalid={!!write.error?.fields.followUpOwnerUid || undefined}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">Sin responsable</option>
              {owners.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName}
                </option>
              ))}
            </select>
            <p className="mem-help">Solo personas del equipo con acceso para gestionar Consolidación.</p>
          </div>
        ) : m.ownersLoading ? (
          <p className="mem-help" role="status">
            Cargando responsables…
          </p>
        ) : (
          <InlineNotice tone="danger" icon={TriangleAlert} role="alert">
            <p>No pudimos cargar la lista de responsables.</p>
            <button type="button" className="button-secondary mem-notice-btn" onClick={m.retryOwners}>
              <RefreshCw size={16} aria-hidden="true" /> Reintentar
            </button>
          </InlineNotice>
        )}
        {owners && !owner && (
          <InlineNotice tone="warning" icon={TriangleAlert}>
            Seguirá en Necesitan atención hasta que alguien la tome.
          </InlineNotice>
        )}
        {!m.online && <OfflineNotice />}
        <FormError error={drifted ? LOCAL_CONFLICT : write.error} />
      </form>
    </CalDialog>
  );
}

// ---------- No contactar ----------

function DoNotContactSheet({ person, onClose }: SheetProps) {
  const m = useMembers();
  const { toast } = useToast();
  const uid = useId();
  const formId = `mem-dnc-form${uid}`;
  // Intención congelada al abrir: si «No contactar» cambia en vivo, conflicto
  // (nunca se invierte la acción que eligió quien abrió el diálogo).
  const [marking] = useState(!person.doNotContact);
  const drifted = person.doNotContact === marking;
  const write = useWrite();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (drifted) return;
    const res = await write.run(() => updatePerson({ personId: person.id, expectedRevision: person.revision, doNotContact: marking }));
    if (!res.ok) return;
    toast(marking ? "Marcada como No contactar" : "Se quitó No contactar");
    onClose();
  };

  return (
    <CalDialog
      variant="center"
      title={`${marking ? "Marcar No contactar" : "Quitar No contactar"} · ${person.fullName}`}
      onClose={onClose}
      busy={write.submitting}
      footer={
        <Foot
          onCancel={onClose}
          submitLabel={marking ? "Marcar No contactar" : "Quitar No contactar"}
          form={formId}
          submitting={write.submitting}
          disabled={!m.online || drifted}
        />
      }
    >
      <form id={formId} className="mem-form" onSubmit={submit} noValidate>
        <p className="mem-dialog-text">
          {marking
            ? "Úsalo cuando la persona pidió no recibir contacto. Se ocultan WhatsApp y las alertas (salvo posibles duplicados). Su historial se conserva."
            : "Volverán a mostrarse WhatsApp y las alertas de seguimiento."}
        </p>
        {!m.online && <OfflineNotice />}
        <FormError error={drifted ? LOCAL_CONFLICT : write.error} />
      </form>
    </CalDialog>
  );
}

// ---------- Acciones de una fila (móvil) ----------

function RowActionsSheet({ person, onClose, onPick }: SheetProps & { onPick: (k: SheetKind) => void }) {
  const m = useMembers();
  const v = m.viewOf(person.id);
  const integrated = person.lifecycleStage === "integrante";
  return (
    <CalDialog title={`Acciones para ${person.fullName}`} onClose={onClose}>
      <div className="mem-action-rows">
        {m.canManage && !integrated && (
          <button type="button" className="mem-action-row" onClick={() => onPick("followup")}>
            <MessageSquarePlus size={20} aria-hidden="true" /> Registrar seguimiento
          </button>
        )}
        {m.canManage && (
          <button type="button" className="mem-action-row" onClick={() => onPick("visit")}>
            <CalendarPlus size={20} aria-hidden="true" /> Registrar visita
          </button>
        )}
        <WhatsAppLink person={person} className="mem-action-row" label="Abrir WhatsApp" iconSize={20} />
        <Link href={personHref(person.id)} className="mem-action-row" onClick={onClose}>
          <UserRound size={20} aria-hidden="true" /> Ver ficha
        </Link>
      </div>
      {v?.next && (
        <p className="mem-help mem-mt">
          Próxima acción: {v.next.text}
          {v.next.date ? ` · ${relDay(v.next.date, m.today)}` : ""}
        </p>
      )}
      {person.doNotContact && <p className="mem-help mem-mt">Pidió no recibir contacto: no se muestra WhatsApp.</p>}
    </CalDialog>
  );
}
