"use client";

// EventFormSheet (16b §5.8): crear y editar ("Editar toda la serie").
// - Responsable: solo áreas que el perfil puede elegir (creatableAreas).
// - El color NO se elige: es el del área responsable (vista previa no seleccionable).
// - RecurrenceField con etiquetas calculadas desde la fecha de inicio.
// - En una serie ya iniciada, los campos temporales quedan bloqueados (16c §C.1).
// Guarda con dispatch(event/create | event/updateSeries): el store revalida todo.

import { useId, useMemo, useState } from "react";
import { ChevronDown, Globe, Lock, Plus, Repeat, TriangleAlert, X } from "lucide-react";
import { areaById, participantOptions } from "@/lib/suite-preview/areas";
import { creatableAreas, isSeriesStarted, TEMPORAL_LOCK_HELP, validateEvent, validateSeriesPatch, type EventErrors } from "@/lib/suite-preview/calendar";
import { DEMO_TODAY } from "@/lib/suite-preview/clock";
import { addMonthsClamped, compareLocal } from "@/lib/suite-preview/dates";
import { isRecurring, monthlyOrdinalOptions } from "@/lib/suite-preview/recurrence";
import type { Area, CalendarEvent, EventInput, Visibility, Ymd } from "@/lib/suite-preview/types";
import { ProposalPill, Sheet } from "@/components/finance-preview/ui";
import { AreaChip, AreaSwatch, areaStyle } from "../primitives";
import { useSuite } from "../provider";
import { maxUntil, repeatOptions, repeatValueOf, ruleFromRepeat, seriesSummary, type RepeatValue } from "./labels";

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

type FieldKey = keyof EventErrors;

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
    responsibleAreaId: options.length === 1 ? options[0].id : (options[0]?.id ?? ""),
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
    visibility: "team",
    publicDescription: "",
    internalNotes: "",
  };
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="sx-field-error" id={id} role="alert">
      <TriangleAlert size={14} aria-hidden="true" />
      {message}
    </p>
  );
}

export function EventFormSheet({
  open,
  onClose,
  event,
  defaultDate,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** null = actividad nueva. */
  event: CalendarEvent | null;
  defaultDate: Ymd;
  onSaved: (info: { id: string; startDate: Ymd }) => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      labelId="sx-event-form-title"
      title={event ? "Editar actividad" : "Nueva actividad"}
      subtitle={event && isRecurring(event) ? "Editar toda la serie" : undefined}
      footer={
        <div className="sx-cal-form-foot">
          <button type="button" className="fx-btn fx-btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="sx-event-form" className="fx-btn fx-btn-primary">
            Guardar actividad
          </button>
        </div>
      }
    >
      {open && <EventForm key={event?.id ?? "new"} event={event} defaultDate={defaultDate} onSaved={onSaved} />}
    </Sheet>
  );
}

function EventForm({ event, defaultDate, onSaved }: { event: CalendarEvent | null; defaultDate: Ymd; onSaved: (info: { id: string; startDate: Ymd }) => void }) {
  const { profile, state, dispatch } = useSuite();
  const uid = useId().replace(/:/g, "");
  const today = DEMO_TODAY;
  const areas = state.areas;
  const creatable = useMemo(() => (profile ? creatableAreas(profile, areas) : []), [profile, areas]);
  const options = useMemo(() => {
    if (!event) return creatable;
    const cur = areaById(areas, event.responsibleAreaId);
    return cur && !creatable.some((a) => a.id === cur.id) ? [cur, ...creatable] : creatable;
  }, [event, creatable, areas]);

  const [s, setS] = useState<FormState>(() => initialState(event, options, defaultDate));
  const [errors, setErrors] = useState<EventErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);

  const locked = !!event && isSeriesStarted(event, today);
  const resp = areaById(areas, s.responsibleAreaId);
  const repeatOpts = repeatOptions(s.startDate);
  const recurring = s.repeat !== "none";

  const buildInput = (st: FormState): EventInput => {
    if (locked && event) {
      return {
        title: st.title,
        responsibleAreaId: st.responsibleAreaId,
        participantAreaIds: st.participants,
        startDate: event.startDate,
        endDate: event.endDate,
        allDay: event.allDay,
        startTime: event.startTime,
        endTime: event.endTime,
        location: st.location,
        publicDescription: st.publicDescription,
        internalNotes: st.internalNotes,
        visibility: st.visibility,
        recurrence: isRecurring(event) ? { ...event.recurrence, ...(st.until ? { until: st.until } : {}) } : event.recurrence,
      };
    }
    return {
      title: st.title,
      responsibleAreaId: st.responsibleAreaId,
      participantAreaIds: st.participants,
      startDate: st.startDate,
      endDate: st.multiDay ? st.endDate : st.startDate,
      allDay: st.allDay,
      startTime: st.allDay ? undefined : st.startTime || undefined,
      endTime: st.allDay ? undefined : st.endTime || undefined,
      location: st.location,
      publicDescription: st.publicDescription,
      internalNotes: st.internalNotes,
      visibility: st.visibility,
      recurrence: ruleFromRepeat(st.repeat, st.startDate, st.until || undefined),
    };
  };

  const validate = (st: FormState): EventErrors => {
    if (!profile) return { title: "Perfil no válido." };
    const input = buildInput(st);
    const ctx = { profile, areas, today };
    const errs = event ? validateSeriesPatch(event, input, ctx) : validateEvent(input, ctx);
    if (st.repeat !== "none" && !st.until && !locked) errs.recurrence = "Indica hasta cuándo se repite.";
    if (!st.allDay && !st.startTime && !locked) errs.startTime = "Indica la hora de inicio o marca «Todo el día».";
    return errs;
  };

  const update = (patch: Partial<FormState>) => {
    let next = { ...s, ...patch };
    if (patch.startDate && next.repeat.startsWith("monthly:")) {
      const ords: number[] = monthlyOrdinalOptions(next.startDate);
      if (!ords.includes(Number(next.repeat.split(":")[1]))) next = { ...next, repeat: `monthly:${ords[0]}` as RepeatValue };
    }
    if (patch.startDate && compareLocal(next.endDate, next.startDate) < 0) next = { ...next, endDate: next.startDate };
    if (patch.responsibleAreaId) next = { ...next, participants: next.participants.filter((id) => id !== patch.responsibleAreaId) };
    if (patch.repeat && patch.repeat !== "none" && !next.until) next = { ...next, until: defaultUntil(next.startDate) };
    setS(next);
    if (submitted) setErrors(validate(next));
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setSubmitted(true);
    const errs = validate(s);
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>(`#sx-event-form [aria-invalid="true"], #sx-event-form .sx-cal-form-lock-error`);
        first?.focus();
      });
      return;
    }
    const input = buildInput(s);
    const result = event
      ? dispatch({ type: "event/updateSeries", id: event.id, patch: input }, "Actividad actualizada")
      : dispatch({ type: "event/create", input }, "Actividad creada");
    if (result.ok) onSaved({ id: event?.id ?? result.createdId ?? "", startDate: input.startDate });
  };

  const fid = (k: string) => `${uid}-${k}`;
  const err = (k: FieldKey) => errors[k];
  const invalid = (k: FieldKey) => ({
    "aria-invalid": err(k) ? (true as const) : undefined,
    "aria-describedby": err(k) ? fid(`${k}-err`) : undefined,
  });

  const summary = recurring && !locked ? seriesSummary(ruleFromRepeat(s.repeat, s.startDate, s.until || undefined), s.startDate) : null;
  const lockedSummary = locked && event && isRecurring(event) ? seriesSummary({ ...event.recurrence, until: s.until || event.recurrence.until }, event.startDate) : null;
  const dayNumber = Number(s.startDate.slice(8, 10)) || 1;

  return (
    <form id="sx-event-form" className="sx-cal-form" noValidate onSubmit={submit}>
      {errors.temporal && (
        <p className="sx-field-error sx-cal-form-lock-error" role="alert" tabIndex={-1}>
          <TriangleAlert size={14} aria-hidden="true" />
          {errors.temporal}
        </p>
      )}

      {/* 1. Área responsable */}
      <div className="sx-field">
        <label htmlFor={fid("resp")}>Área responsable *</label>
        {options.length === 1 && !event ? (
          <>
            <p className="sx-fixed-area" id={fid("resp")}>
              <AreaSwatch color={options[0].color} size={12} shape="square" /> {options[0].name}
            </p>
            <p className="fx-help">Es tu única área asignada.</p>
          </>
        ) : (
          <select
            id={fid("resp")}
            className="fx-select"
            value={s.responsibleAreaId}
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
          <p className="sx-color-preview">
            <span className="fx-help">Color:</span>
            <span className="sx-ev-chip sx-ev-chip-static" style={areaStyle(resp.color)} aria-hidden="true">
              {!s.allDay && s.startTime && <span className="sx-ev-chip-time">{s.startTime}</span>}
              <span className="sx-ev-chip-title">{s.title.trim() || resp.name}</span>
            </span>
            <span className="fx-help">Lo define el área responsable.</span>
          </p>
        )}
      </div>

      {/* 2. Título */}
      <div className="sx-field">
        <label htmlFor={fid("title")}>Título *</label>
        <input
          id={fid("title")}
          className="fx-input"
          value={s.title}
          maxLength={120}
          autoComplete="off"
          onChange={(e) => update({ title: e.target.value })}
          {...invalid("title")}
        />
        {s.title.length >= 100 && <p className="fx-help fx-num">{s.title.length}/120</p>}
        <FieldError id={fid("title-err")} message={err("title")} />
      </div>

      {/* 3. Fecha y horas */}
      <fieldset className="sx-cal-fieldset" disabled={locked}>
        <legend className="sx-legend">Fecha y hora</legend>
        {locked && <p className="fx-help sx-lock-help">{TEMPORAL_LOCK_HELP}</p>}
        <div className="sx-cal-form-row">
          <div className="sx-field">
            <label htmlFor={fid("date")}>Fecha *</label>
            <input id={fid("date")} type="date" className="fx-input" value={s.startDate} onChange={(e) => e.target.value && update({ startDate: e.target.value })} {...invalid("startDate")} />
            <FieldError id={fid("startDate-err")} message={err("startDate")} />
          </div>
          <label className="sx-switch">
            <input type="checkbox" role="switch" checked={s.allDay} onChange={(e) => update({ allDay: e.target.checked })} />
            <span>Todo el día</span>
          </label>
        </div>
        {!s.allDay && (
          <div className="sx-cal-form-row sx-cal-form-row-2">
            <div className="sx-field">
              <label htmlFor={fid("start")}>Hora de inicio</label>
              <input id={fid("start")} type="time" className="fx-input" value={s.startTime} onChange={(e) => update({ startTime: e.target.value })} {...invalid("startTime")} />
              <FieldError id={fid("startTime-err")} message={err("startTime")} />
            </div>
            <div className="sx-field">
              <label htmlFor={fid("end")}>Hora de término</label>
              <input id={fid("end")} type="time" className="fx-input" value={s.endTime} onChange={(e) => update({ endTime: e.target.value })} {...invalid("endTime")} />
              <FieldError id={fid("endTime-err")} message={err("endTime")} />
            </div>
          </div>
        )}
        <label className="sx-cal-check">
          <input type="checkbox" checked={s.multiDay} onChange={(e) => update({ multiDay: e.target.checked, endDate: e.target.checked ? s.endDate : s.startDate })} />
          <span>Termina otro día</span>
        </label>
        {s.multiDay && (
          <div className="sx-field">
            <label htmlFor={fid("endDate")}>Fecha de término</label>
            <input id={fid("endDate")} type="date" className="fx-input" min={s.startDate} value={s.endDate} onChange={(e) => e.target.value && update({ endDate: e.target.value })} {...invalid("endDate")} />
            <FieldError id={fid("endDate-err")} message={err("endDate")} />
          </div>
        )}
      </fieldset>

      {/* 4. Lugar */}
      <div className="sx-field">
        <label htmlFor={fid("loc")}>Lugar</label>
        <input id={fid("loc")} className="fx-input" value={s.location} maxLength={120} onChange={(e) => update({ location: e.target.value })} {...invalid("location")} />
        <FieldError id={fid("location-err")} message={err("location")} />
      </div>

      {/* 5. Repetir */}
      <div className="sx-field sx-recurrence">
        <label htmlFor={fid("repeat")}>Repetir</label>
        <select
          id={fid("repeat")}
          className="fx-select"
          value={s.repeat}
          disabled={locked}
          onChange={(e) => update({ repeat: e.target.value as RepeatValue })}
        >
          {repeatOpts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {locked && isRecurring(event!) && <p className="fx-help">{TEMPORAL_LOCK_HELP}</p>}
        {recurring && (
          <div className="sx-field sx-field-nested">
            <label htmlFor={fid("until")}>Hasta *</label>
            <input
              id={fid("until")}
              type="date"
              className="fx-input"
              min={locked ? today : s.startDate}
              max={maxUntil(locked && event ? event.startDate : s.startDate)}
              value={s.until}
              onChange={(e) => update({ until: e.target.value })}
              {...invalid("recurrence")}
            />
            <p className="fx-help">Incluye esa fecha. Máximo 12 meses.</p>
            <FieldError id={fid("recurrence-err")} message={err("recurrence")} />
          </div>
        )}
        {(summary || lockedSummary) && (
          <p className="sx-recurrence-summary">
            <Repeat size={14} aria-hidden="true" /> {summary ?? lockedSummary}
          </p>
        )}
        <details className="sx-more-repeat">
          <summary>
            <span>Más opciones de repetición</span> <ProposalPill />
          </summary>
          <div className="sx-more-repeat-body">
            <label className="sx-cal-check is-disabled">
              <input type="radio" disabled name={fid("future")} /> <span>El mismo día de cada mes (día {dayNumber})</span>
            </label>
            <label className="sx-cal-check is-disabled">
              <input type="radio" disabled name={fid("future")} /> <span>Personalizado</span>
            </label>
            <p className="fx-help">Llegará en una próxima versión.</p>
          </div>
        </details>
      </div>

      {/* 6. Áreas participantes */}
      <div className="sx-field">
        <span className="sx-label" id={fid("part-label")}>
          Áreas participantes
        </span>
        {s.participants.length > 0 && (
          <ul className="sx-chip-list" aria-labelledby={fid("part-label")}>
            {s.participants.map((id) => {
              const a = areaById(areas, id);
              if (!a) return null;
              return (
                <li key={id} className="sx-chip-removable">
                  <AreaChip area={a} />
                  <button type="button" className="sx-chip-x" aria-label={`Quitar ${a.name}`} onClick={() => update({ participants: s.participants.filter((x) => x !== id) })}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm sx-add-areas" aria-expanded={participantsOpen} aria-controls={fid("part-list")} onClick={() => setParticipantsOpen((v) => !v)}>
          <Plus size={14} aria-hidden="true" /> Agregar áreas <ChevronDown size={14} aria-hidden="true" className="sx-rotate" />
        </button>
        {participantsOpen && (
          <fieldset className="sx-check-list" id={fid("part-list")}>
            <legend className="fx-sr">Elige las áreas participantes</legend>
            {participantOptions(areas, s.responsibleAreaId).map((a) => {
              const checked = s.participants.includes(a.id);
              const full = !checked && s.participants.length >= 8;
              return (
                <label key={a.id} className={`sx-check-row ${full ? "is-disabled" : ""}`}>
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
        <p className="fx-help">Participar no da permiso para editar.</p>
        <FieldError id={fid("participantAreaIds-err")} message={err("participantAreaIds")} />
      </div>

      {/* 7. Visibilidad */}
      <fieldset className="sx-cal-fieldset">
        <legend className="sx-legend">Visibilidad *</legend>
        <div className="sx-radio-cards">
          <label className={`sx-radio-card ${s.visibility === "team" ? "is-checked" : ""}`}>
            <input type="radio" name={fid("vis")} checked={s.visibility === "team"} onChange={() => update({ visibility: "team" })} />
            <Lock size={16} aria-hidden="true" />
            <span>
              <strong>Solo equipo CDS</strong>
              <span className="fx-help">La ven usuarios con acceso al calendario.</span>
            </span>
          </label>
          <label className={`sx-radio-card ${s.visibility === "public" ? "is-checked" : ""}`}>
            <input type="radio" name={fid("vis")} checked={s.visibility === "public"} onChange={() => update({ visibility: "public" })} />
            <Globe size={16} aria-hidden="true" />
            <span>
              <strong>Pública</strong>
              <span className="fx-help">También aparece en el calendario compartido.</span>
            </span>
          </label>
        </div>
      </fieldset>

      {/* 8. Descripción pública */}
      <div className="sx-field">
        <label htmlFor={fid("desc")}>Descripción pública</label>
        <textarea id={fid("desc")} className="sx-cal-textarea" rows={4} maxLength={1000} value={s.publicDescription} onChange={(e) => update({ publicDescription: e.target.value })} {...invalid("publicDescription")} />
        <p className="fx-help">Visible para todos si la actividad es pública.</p>
        <FieldError id={fid("publicDescription-err")} message={err("publicDescription")} />
      </div>

      {/* 9. Notas internas */}
      <div className="sx-field">
        <label htmlFor={fid("notes")} className="sx-label-icon">
          <Lock size={13} aria-hidden="true" /> Notas internas
        </label>
        <textarea id={fid("notes")} className="sx-cal-textarea" rows={3} maxLength={1000} value={s.internalNotes} onChange={(e) => update({ internalNotes: e.target.value })} {...invalid("internalNotes")} />
        <p className="fx-help">Nunca se publican. No escribas datos personales de integrantes.</p>
        <FieldError id={fid("internalNotes-err")} message={err("internalNotes")} />
      </div>
    </form>
  );
}

function defaultUntil(start: Ymd): Ymd {
  // 3 meses por defecto (dentro del máximo de 12).
  return addMonthsClamped(start, 3);
}
