"use client";

// EventFormSheet (16b §5.8, 18b §2.1–2.3): crear y editar (toda la serie).
// - Responsable: solo las áreas que puede gestionar (creatableAreas).
// - El color NO se elige: es el del área responsable.
// - Visibilidad según el permiso de publicar del área (publishableAreas).
// - Recurrencia V1: select con etiquetas calculadas + "Hasta" + resumen.
// - Serie o actividad ya iniciada: día, hora y frecuencia bloqueados.
// - Actividad ya pública sin permiso de publicar: solo notas internas (R10).
// Si el guardado falla, el formulario NO se cierra y conserva lo escrito.

import { useId, useMemo, useState } from "react";
import { ChevronDown, Globe, Info, Lock, Plus, Repeat, TriangleAlert, X } from "lucide-react";
import { areaById } from "@/lib/calendar/areas";
import {
  canPublishEvent,
  creatableAreas,
  isRecurring,
  isSeriesStarted,
  MAX_PARTICIPANT_AREAS,
  startedLockHelp,
  validateEvent,
  validateSeriesPatch,
  type CalendarActor,
  type EventErrors,
  type EventInput,
} from "@/lib/calendar/calendar";
import { CALENDAR_ERROR_MESSAGES, calendarErrorMessage } from "@/lib/calendar/errors";
import { createEvent, updateEvent } from "@/lib/calendar/events-client";
import { addMonthsClamped, compareLocal } from "@/lib/shared/dates";
import { monthlyOrdinalOptions } from "@/lib/shared/recurrence";
import type { Area, CalendarEvent, Visibility, Ymd } from "@/lib/shared/types";
import { AreaChip, AreaSwatch, areaCss } from "./area-badges";
import {
  longDateEcho,
  maxUntil,
  repeatOptions,
  repeatValueOf,
  ruleFromRepeat,
  seriesSummary,
  timeRangeEcho,
  type RepeatValue,
} from "./labels";
import { CalDialog, FieldError, InlineNotice } from "./ui";

interface FormState {
  responsibleAreaId: string;
  title: string;
  startDate: Ymd;
  allDay: boolean;
  startTime: string;
  endTime: string;
  multiDay: boolean;
  endDate: Ymd;
  location: string;
  repeat: RepeatValue;
  until: string;
  participants: string[];
  visibility: Visibility;
  publicDescription: string;
  internalNotes: string;
}

const FORM_ID = "cal-event-form";

function defaultUntil(start: Ymd): Ymd {
  return addMonthsClamped(start, 3);
}

function initialState(event: CalendarEvent | null, options: Area[], defaultDate: Ymd): FormState {
  if (event) {
    return {
      responsibleAreaId: event.responsibleAreaId,
      title: event.title,
      startDate: event.startDate,
      allDay: event.allDay,
      startTime: event.startTime ?? "",
      endTime: event.endTime ?? "",
      multiDay: event.endDate !== event.startDate,
      endDate: event.endDate,
      location: event.location ?? "",
      repeat: repeatValueOf(event.recurrence),
      until: event.recurrence.until ?? "",
      participants: [...event.participantAreaIds],
      visibility: event.visibility,
      publicDescription: event.publicDescription ?? "",
      internalNotes: event.internalNotes ?? "",
    };
  }
  return {
    responsibleAreaId: options[0]?.id ?? "",
    title: "",
    startDate: defaultDate,
    allDay: false,
    startTime: "19:00",
    endTime: "21:00",
    multiDay: false,
    endDate: defaultDate,
    location: "",
    repeat: "none",
    until: "",
    participants: [],
    visibility: "internal",
    publicDescription: "",
    internalNotes: "",
  };
}

export interface SavedInfo {
  id: string;
  startDate: Ymd;
  created: boolean;
}

export function EventFormSheet({
  event,
  defaultDate,
  actor,
  areas,
  today,
  offline,
  onClose,
  onSaved,
}: {
  /** null = actividad nueva. */
  event: CalendarEvent | null;
  defaultDate: Ymd;
  actor: CalendarActor | null;
  areas: readonly Area[];
  today: Ymd;
  offline: boolean;
  onClose: () => void;
  onSaved: (info: SavedInfo) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <CalDialog
      onClose={onClose}
      busy={busy}
      title={event ? "Editar actividad" : "Nueva actividad"}
      subtitle={event && isRecurring(event) ? "Los cambios se aplican a toda la serie." : undefined}
      footer={
        <div className="cal-form-foot">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="submit"
            form={FORM_ID}
            className="button-primary"
            disabled={busy}
            aria-disabled={offline || undefined}
          >
            {busy ? "Guardando…" : "Guardar actividad"}
          </button>
        </div>
      }
    >
      <EventForm
        event={event}
        defaultDate={defaultDate}
        actor={actor}
        areas={areas}
        today={today}
        offline={offline}
        onBusy={setBusy}
        onSaved={onSaved}
      />
    </CalDialog>
  );
}

function EventForm({
  event,
  defaultDate,
  actor,
  areas,
  today,
  offline,
  onBusy,
  onSaved,
}: {
  event: CalendarEvent | null;
  defaultDate: Ymd;
  actor: CalendarActor | null;
  areas: readonly Area[];
  today: Ymd;
  offline: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (info: SavedInfo) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const creatable = useMemo(() => creatableAreas(actor, areas), [actor, areas]);
  const options = useMemo(() => {
    if (!event) return creatable;
    const cur = areaById(areas, event.responsibleAreaId);
    return cur && !creatable.some((a) => a.id === cur.id) ? [cur, ...creatable] : creatable;
  }, [event, creatable, areas]);

  const [s, setS] = useState<FormState>(() => initialState(event, options, defaultDate));
  const [errors, setErrors] = useState<EventErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [visNotice, setVisNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const started = !!event && isSeriesStarted(event, today);
  const resp = areaById(areas, s.responsibleAreaId);
  const respName = resp?.name ?? "esta área";
  const canPublishResp = canPublishEvent(actor, { responsibleAreaId: s.responsibleAreaId });
  /** Actividad ya pública que este usuario no puede publicar: solo notas internas (R10). */
  const publicLocked = !!event && event.visibility === "public" && !canPublishEvent(actor, event);
  const temporalLocked = started || publicLocked;
  const repeatOpts = repeatOptions(s.startDate);
  const recurring = s.repeat !== "none";

  const buildInput = (st: FormState): EventInput => {
    if (temporalLocked && event) {
      const until = !publicLocked && isRecurring(event) && st.until ? st.until : event.recurrence.until;
      return {
        title: publicLocked ? event.title : st.title,
        responsibleAreaId: publicLocked ? event.responsibleAreaId : st.responsibleAreaId,
        participantAreaIds: publicLocked ? [...event.participantAreaIds] : st.participants,
        startDate: event.startDate,
        endDate: event.endDate,
        allDay: event.allDay,
        startTime: event.startTime,
        endTime: event.endTime,
        location: publicLocked ? event.location : st.location,
        publicDescription: publicLocked ? event.publicDescription : st.publicDescription,
        internalNotes: st.internalNotes,
        visibility: publicLocked ? event.visibility : st.visibility,
        recurrence: isRecurring(event) ? { ...event.recurrence, ...(until ? { until } : {}) } : event.recurrence,
      };
    }
    return {
      title: st.title,
      responsibleAreaId: st.responsibleAreaId,
      participantAreaIds: st.participants,
      startDate: st.startDate,
      endDate: st.multiDay ? st.endDate : st.startDate,
      allDay: st.allDay,
      startTime: st.allDay ? null : st.startTime || null,
      endTime: st.allDay ? null : st.endTime || null,
      location: st.location,
      publicDescription: st.publicDescription,
      internalNotes: st.internalNotes,
      visibility: st.visibility,
      recurrence: ruleFromRepeat(st.repeat, st.startDate, st.until || undefined),
    };
  };

  const validate = (st: FormState): EventErrors => {
    const input = buildInput(st);
    const ctx = { actor, areas, today };
    return event ? validateSeriesPatch(event, input, ctx) : validateEvent(input, ctx);
  };

  const update = (patch: Partial<FormState>) => {
    let next = { ...s, ...patch };
    if (patch.startDate && next.repeat.startsWith("monthly:")) {
      const ords: number[] = monthlyOrdinalOptions(next.startDate);
      if (!ords.includes(Number(next.repeat.split(":")[1]))) next = { ...next, repeat: `monthly:${ords[0]}` as RepeatValue };
    }
    if (patch.startDate && compareLocal(next.endDate, next.startDate) < 0) next = { ...next, endDate: next.startDate };
    if (patch.responsibleAreaId) {
      next = { ...next, participants: next.participants.filter((id) => id !== patch.responsibleAreaId) };
      const area = areaById(areas, patch.responsibleAreaId);
      if (next.visibility === "public" && !canPublishEvent(actor, { responsibleAreaId: patch.responsibleAreaId })) {
        next = { ...next, visibility: "internal" };
        setVisNotice(`Cambiamos la visibilidad a Solo equipo: no puedes publicar actividades de ${area?.name ?? "esa área"}.`);
      } else setVisNotice("");
    }
    if (patch.repeat && patch.repeat !== "none" && !next.until) next = { ...next, until: defaultUntil(next.startDate) };
    setS(next);
    if (submitted) setErrors(validate(next));
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    if (offline) {
      setSaveError(CALENDAR_ERROR_MESSAGES.offline);
      return;
    }
    setSubmitted(true);
    const errs = validate(s);
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`#${FORM_ID} [aria-invalid="true"], #${FORM_ID} .cal-form-lock-error`)?.focus();
      });
      return;
    }
    const input = buildInput(s);
    setSaving(true);
    onBusy(true);
    setSaveError("");
    try {
      if (event) {
        await updateEvent(event, input);
        onSaved({ id: event.id, startDate: input.startDate, created: false });
      } else {
        const id = await createEvent(input);
        onSaved({ id, startDate: input.startDate, created: true });
      }
    } catch (error) {
      setSaveError(calendarErrorMessage(error, "save"));
      setSaving(false);
      onBusy(false);
    }
  };

  const fid = (k: string) => `${uid}-${k}`;
  const err = (k: keyof EventErrors) => errors[k];
  const invalid = (k: keyof EventErrors, describedBy?: string) => ({
    "aria-invalid": err(k) ? (true as const) : undefined,
    "aria-describedby": [err(k) ? fid(`${k}-err`) : null, describedBy].filter(Boolean).join(" ") || undefined,
  });
  const echo = (id: string, text: string) =>
    text ? (
      <p className="cal-input-echo" id={fid(id)}>
        {text}
      </p>
    ) : null;
  const timeEcho = !s.allDay ? timeRangeEcho(s.startTime, s.endTime) : "";

  const summary = recurring && !temporalLocked ? seriesSummary(ruleFromRepeat(s.repeat, s.startDate, s.until || undefined), s.startDate) : null;
  const lockedSummary =
    temporalLocked && event && isRecurring(event)
      ? seriesSummary({ ...event.recurrence, until: (!publicLocked && s.until) || event.recurrence.until }, event.startDate)
      : null;

  const visHelpId = fid("vis-help");
  const publicDisabled = publicLocked || !canPublishResp;
  const visHelp = publicLocked
    ? "Esta actividad ya es pública: solo quien puede publicar (Pastor o Administración) cambia su título, fecha, lugar, áreas, descripción o visibilidad. Puedes editar las notas internas."
    : canPublishResp
      ? "Si eliges Pública, aparecerá en el calendario compartido. Las notas internas nunca se publican."
      : `Para publicar actividades de ${respName} necesitas el permiso «Publicar actividades de sus áreas». Puedes guardarla como Solo equipo y pedir a Pastor o Administración que la publique.`;

  return (
    <form id={FORM_ID} className="cal-form" noValidate onSubmit={submit}>
      {errors.temporal && (
        <p className="cal-field-error cal-form-lock-error" role="alert" tabIndex={-1}>
          <TriangleAlert size={14} aria-hidden="true" />
          {errors.temporal}
        </p>
      )}
      {publicLocked && (
        <InlineNotice tone="info" icon={Globe}>
          {visHelp}
        </InlineNotice>
      )}

      {/* 1. Área responsable */}
      <div className="cal-field">
        <label htmlFor={fid("resp")}>Área responsable *</label>
        {options.length === 1 && !event ? (
          <>
            <p className="cal-fixed-area" id={fid("resp")}>
              <AreaSwatch color={options[0].color} size={12} shape="square" /> {options[0].name}
            </p>
            <p className="cal-help">Es tu única área asignada.</p>
          </>
        ) : (
          <select
            id={fid("resp")}
            className="cal-select"
            value={s.responsibleAreaId}
            disabled={publicLocked}
            onChange={(e) => update({ responsibleAreaId: e.target.value })}
            {...invalid("responsibleAreaId")}
          >
            {!s.responsibleAreaId && <option value="">Elige un área</option>}
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.active ? "" : " (inactiva)"}
              </option>
            ))}
          </select>
        )}
        <FieldError id={fid("responsibleAreaId-err")} message={err("responsibleAreaId")} />
        {resp && (
          <p className="cal-color-preview">
            <span className="cal-help">Color:</span>
            <span className="cal-ev-chip cal-ev-chip-static" style={areaCss(resp.color)} aria-hidden="true">
              {!s.allDay && s.startTime && <span className="cal-ev-chip-time">{s.startTime}</span>}
              <span className="cal-ev-chip-title">{s.title.trim() || resp.name}</span>
            </span>
            <span className="cal-help">Lo define el área responsable.</span>
          </p>
        )}
      </div>

      {/* 2. Título */}
      <div className="cal-field">
        <label htmlFor={fid("title")}>Título *</label>
        <input
          id={fid("title")}
          className="cal-input"
          value={s.title}
          maxLength={120}
          autoComplete="off"
          disabled={publicLocked}
          onChange={(e) => update({ title: e.target.value })}
          {...invalid("title")}
        />
        {s.title.length >= 100 && <p className="cal-help cal-num">{s.title.length}/120</p>}
        <FieldError id={fid("title-err")} message={err("title")} />
      </div>

      {/* 3. Fecha y horas */}
      <fieldset className="cal-fieldset" disabled={temporalLocked}>
        <legend className="cal-legend">Fecha y hora</legend>
        {started && event && (
          <p className="cal-help cal-lock-help">
            <Info size={14} aria-hidden="true" /> {startedLockHelp(event)}
          </p>
        )}
        <div className="cal-form-row">
          <div className="cal-field">
            <label htmlFor={fid("date")}>Fecha *</label>
            <input
              id={fid("date")}
              type="date"
              lang="es-CL"
              className="cal-input"
              value={s.startDate}
              onChange={(e) => e.target.value && update({ startDate: e.target.value })}
              {...invalid("startDate", longDateEcho(s.startDate) ? fid("date-echo") : undefined)}
            />
            {echo("date-echo", longDateEcho(s.startDate))}
            <FieldError id={fid("startDate-err")} message={err("startDate")} />
          </div>
          <label className="cal-switch">
            <input type="checkbox" role="switch" checked={s.allDay} onChange={(e) => update({ allDay: e.target.checked })} />
            <span>Todo el día</span>
          </label>
        </div>
        {!s.allDay && (
          <div className="cal-form-row cal-form-row-2">
            <div className="cal-field">
              <label htmlFor={fid("start")}>Hora de inicio</label>
              <input
                id={fid("start")}
                type="time"
                lang="es-CL"
                className="cal-input"
                value={s.startTime}
                onChange={(e) => update({ startTime: e.target.value })}
                {...invalid("startTime", timeEcho ? fid("time-echo") : undefined)}
              />
              <FieldError id={fid("startTime-err")} message={err("startTime")} />
            </div>
            <div className="cal-field">
              <label htmlFor={fid("end")}>Hora de término</label>
              <input
                id={fid("end")}
                type="time"
                lang="es-CL"
                className="cal-input"
                value={s.endTime}
                onChange={(e) => update({ endTime: e.target.value })}
                {...invalid("endTime", timeEcho ? fid("time-echo") : undefined)}
              />
              <FieldError id={fid("endTime-err")} message={err("endTime")} />
            </div>
          </div>
        )}
        {echo("time-echo", timeEcho)}
        <label className="cal-check">
          <input
            type="checkbox"
            checked={s.multiDay}
            onChange={(e) => update({ multiDay: e.target.checked, endDate: e.target.checked ? s.endDate : s.startDate })}
          />
          <span>Termina otro día</span>
        </label>
        {s.multiDay && (
          <div className="cal-field">
            <label htmlFor={fid("endDate")}>Fecha de término</label>
            <input
              id={fid("endDate")}
              type="date"
              lang="es-CL"
              className="cal-input"
              min={s.startDate}
              value={s.endDate}
              onChange={(e) => e.target.value && update({ endDate: e.target.value })}
              {...invalid("endDate", longDateEcho(s.endDate) ? fid("endDate-echo") : undefined)}
            />
            {echo("endDate-echo", longDateEcho(s.endDate))}
            <FieldError id={fid("endDate-err")} message={err("endDate")} />
          </div>
        )}
      </fieldset>

      {/* 4. Lugar */}
      <div className="cal-field">
        <label htmlFor={fid("loc")}>Lugar</label>
        <input
          id={fid("loc")}
          className="cal-input"
          value={s.location}
          maxLength={120}
          disabled={publicLocked}
          onChange={(e) => update({ location: e.target.value })}
          {...invalid("location")}
        />
        <FieldError id={fid("location-err")} message={err("location")} />
      </div>

      {/* 5. Repetir */}
      <div className="cal-field cal-recurrence">
        <label htmlFor={fid("repeat")}>Repetir</label>
        <select
          id={fid("repeat")}
          className="cal-select"
          value={s.repeat}
          disabled={temporalLocked}
          onChange={(e) => update({ repeat: e.target.value as RepeatValue })}
        >
          {repeatOpts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {recurring && (
          <div className="cal-field cal-field-nested">
            <label htmlFor={fid("until")}>Hasta *</label>
            <input
              id={fid("until")}
              type="date"
              lang="es-CL"
              className="cal-input"
              min={started ? today : s.startDate}
              max={maxUntil(event && started ? event.startDate : s.startDate)}
              value={s.until}
              disabled={publicLocked}
              onChange={(e) => update({ until: e.target.value })}
              {...invalid("recurrence", longDateEcho(s.until) ? fid("until-echo") : undefined)}
            />
            {echo("until-echo", longDateEcho(s.until))}
            <p className="cal-help">Incluye esa fecha. Máximo 12 meses.</p>
          </div>
        )}
        <FieldError id={fid("recurrence-err")} message={err("recurrence")} />
        {(summary || lockedSummary) && (
          <p className="cal-recurrence-summary">
            <Repeat size={14} aria-hidden="true" /> {summary ?? lockedSummary}
          </p>
        )}
      </div>

      {/* 6. Áreas participantes */}
      <div className="cal-field">
        <span className="cal-label" id={fid("part-label")}>
          Áreas participantes
        </span>
        {s.participants.length > 0 && (
          <ul className="cal-chip-list" aria-labelledby={fid("part-label")}>
            {s.participants.map((id) => {
              const a = areaById(areas, id);
              if (!a) return null;
              return (
                <li key={id} className="cal-chip-removable">
                  <AreaChip area={a} />
                  {!publicLocked && (
                    <button
                      type="button"
                      className="cal-chip-x"
                      aria-label={`Quitar ${a.name}`}
                      onClick={() => update({ participants: s.participants.filter((x) => x !== id) })}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!publicLocked && (
          <button
            type="button"
            className="button-secondary cal-btn-sm cal-add-areas"
            aria-expanded={participantsOpen}
            aria-controls={fid("part-list")}
            onClick={() => setParticipantsOpen((v) => !v)}
          >
            <Plus size={14} aria-hidden="true" /> Agregar áreas <ChevronDown size={14} aria-hidden="true" className="cal-rotate" />
          </button>
        )}
        {participantsOpen && !publicLocked && (
          <fieldset className="cal-check-list" id={fid("part-list")}>
            <legend className="cal-sr">Elige las áreas participantes</legend>
            {areas
              .filter((a) => a.active && a.id !== s.responsibleAreaId)
              .map((a) => {
                const checked = s.participants.includes(a.id);
                const full = !checked && s.participants.length >= MAX_PARTICIPANT_AREAS;
                return (
                  <label key={a.id} className={`cal-check-row ${full ? "is-disabled" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={full}
                      onChange={(e) =>
                        update({ participants: e.target.checked ? [...s.participants, a.id] : s.participants.filter((x) => x !== a.id) })
                      }
                    />
                    <AreaSwatch color={a.color} size={12} shape="square" />
                    <span>{a.name}</span>
                  </label>
                );
              })}
          </fieldset>
        )}
        <p className="cal-help">Participar no da permiso para editar.</p>
        <FieldError id={fid("participantAreaIds-err")} message={err("participantAreaIds")} />
      </div>

      {/* 7. Visibilidad */}
      <fieldset className="cal-fieldset" aria-describedby={visHelpId}>
        <legend className="cal-legend">Visibilidad *</legend>
        <div className="cal-radio-cards">
          <label className={`cal-radio-card ${s.visibility === "internal" ? "is-checked" : ""} ${publicLocked ? "is-disabled" : ""}`}>
            <input
              type="radio"
              name={fid("vis")}
              value="internal"
              checked={s.visibility === "internal"}
              aria-disabled={publicLocked || undefined}
              aria-describedby={publicLocked ? visHelpId : undefined}
              onClick={(e) => publicLocked && e.preventDefault()}
              onChange={() => !publicLocked && update({ visibility: "internal" })}
            />
            <Lock size={16} aria-hidden="true" />
            <span>
              <strong>Solo equipo CDS</strong>
              <span className="cal-help">La ven usuarios con acceso al calendario.</span>
            </span>
          </label>
          <label className={`cal-radio-card ${s.visibility === "public" ? "is-checked" : ""} ${publicDisabled ? "is-disabled" : ""}`}>
            <input
              type="radio"
              name={fid("vis")}
              value="public"
              checked={s.visibility === "public"}
              aria-disabled={publicDisabled || undefined}
              aria-describedby={publicDisabled ? visHelpId : undefined}
              onClick={(e) => publicDisabled && e.preventDefault()}
              onChange={() => !publicDisabled && update({ visibility: "public" })}
            />
            {publicDisabled && !publicLocked ? <Lock size={14} aria-hidden="true" /> : <Globe size={16} aria-hidden="true" />}
            <span>
              <strong>Pública</strong>
              <span className="cal-help">También aparece en el calendario compartido.</span>
            </span>
          </label>
        </div>
        <p className={`cal-help ${publicDisabled ? "cal-help-locked" : ""}`} id={visHelpId}>
          {publicDisabled && <Info size={14} aria-hidden="true" />} {visHelp}
        </p>
        {visNotice && (
          <InlineNotice tone="info" icon={Info} role="status">
            {visNotice}
          </InlineNotice>
        )}
        <FieldError id={fid("visibility-err")} message={err("visibility")} />
      </fieldset>

      {/* 8. Descripción pública */}
      <div className="cal-field">
        <label htmlFor={fid("desc")}>Descripción pública</label>
        <textarea
          id={fid("desc")}
          className="cal-textarea"
          rows={4}
          maxLength={1000}
          value={s.publicDescription}
          disabled={publicLocked}
          onChange={(e) => update({ publicDescription: e.target.value })}
          {...invalid("publicDescription")}
        />
        <p className="cal-help">Visible para todos si la actividad es pública.</p>
        <FieldError id={fid("publicDescription-err")} message={err("publicDescription")} />
      </div>

      {/* 9. Notas internas */}
      <div className="cal-field">
        <label htmlFor={fid("notes")} className="cal-label-icon">
          <Lock size={13} aria-hidden="true" /> Notas internas
        </label>
        <textarea
          id={fid("notes")}
          className="cal-textarea"
          rows={3}
          maxLength={1000}
          value={s.internalNotes}
          onChange={(e) => update({ internalNotes: e.target.value })}
          {...invalid("internalNotes")}
        />
        <p className="cal-help">Nunca se publican. No escribas datos personales de integrantes.</p>
        <FieldError id={fid("internalNotes-err")} message={err("internalNotes")} />
      </div>

      {(saveError || offline) && (
        <InlineNotice tone={saveError ? "danger" : "warning"} icon={TriangleAlert} role={saveError ? "alert" : undefined}>
          {saveError || CALENDAR_ERROR_MESSAGES.offline}
        </InlineNotice>
      )}
    </form>
  );
}
