"use client";

// Registrar persona (16b §9.5) y Editar datos. Formulario de máx. 640 px con
// footer fijo en móvil. Teléfono normalizado a la vista (mismas reglas que el
// servidor), aviso de posible duplicado que NUNCA bloquea, aviso "solo
// adultos" y advertencia de datos sensibles en la observación.
// V1 sin fecha de nacimiento, edad, confesión de fe, bautismo ni notas iniciales.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { ArrowLeft, CalendarCheck, Check, Info, ShieldAlert, TriangleAlert, UserRound } from "lucide-react";
import { CalDialog, FieldError, InlineNotice } from "@/components/calendar/ui";
import { useToast } from "@/components/layout/notice";
import { useAuth } from "@/lib/auth/auth-provider";
import {
  ADULTS_ONLY_NOTICE,
  ARRIVAL_SOURCES,
  ARRIVAL_SOURCE_LABEL,
  MEMBERS_LIMITS,
  PHONE_HELP,
  STATUS_LABEL,
  formatPhone,
  normalizeEmail,
  normalizePhone,
  parsePersonCreate,
  parsePersonUpdate,
  type ArrivalSource,
  type PersonCreateRequest,
  type PersonUpdateRequest,
} from "@/lib/shared/members";
import { createPerson, fieldMessages, newRequestId, updatePerson, type DuplicateRef } from "@/lib/members/api";
import { duplicateCandidates, type DuplicateBy } from "@/lib/members/consolidation";
import type { Person } from "@/lib/members/types";
import { useMembers } from "@/lib/members/use-members";
import { PEOPLE_HREF, PRIVACY_NOTE, dateEcho, firstName, personHref, shortDate } from "./model";
import { ActivityField, FormError, MemberActions, NoteField, OfflineNotice, SubmitButton, useMemberActions, useWrite } from "./sheets";

// ---------- Posible duplicado ----------

function DuplicateNotice({
  matches,
  dismissed,
  onDismiss,
}: {
  matches: { person: Person; by: DuplicateBy[] }[];
  dismissed: boolean;
  onDismiss: () => void;
}) {
  const m = useMembers();
  const { open } = useMemberActions();
  if (!matches.length) return null;
  if (dismissed)
    return (
      <p className="mem-help mem-dup-dismissed" aria-live="polite">
        Marcada como otra persona. Quedará el aviso «posible duplicado» para revisarlo después.
      </p>
    );
  const byPhone = matches.some((x) => x.by.includes("telefono"));
  return (
    <div className="mem-dup" aria-live="polite" data-testid="duplicate-notice">
      <p className="mem-dup-title">
        <TriangleAlert size={16} aria-hidden="true" />
        Posible duplicado:{" "}
        {matches.length > 1
          ? `ya hay ${matches.length} personas con este ${byPhone ? "teléfono" : "correo"}`
          : `ya hay una persona con este ${byPhone ? "teléfono" : "correo"}`}
      </p>
      <p className="mem-help">Las familias suelen compartir teléfono: puedes guardar igual.</p>
      {matches.map(({ person }) => (
        <div key={person.id} className="mem-dup-person">
          <p className="mem-dup-line">
            <strong>{person.fullName}</strong> · ingresó {shortDate(person.entryDate)} · {STATUS_LABEL[person.consolidationStatus]}
          </p>
          <div className="mem-dup-actions">
            <Link href={personHref(person.id)} className="button-secondary mem-btn-sm">
              Ver ficha existente
            </Link>
            {m.canManage && (
              <button type="button" className="button-secondary mem-btn-sm" onClick={() => open("visit", person.id)}>
                Registrar visita a {firstName(person.fullName)}
              </button>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="button-ghost mem-btn-sm mem-dup-continue" onClick={onDismiss}>
        Es otra persona, continuar
      </button>
    </div>
  );
}

/** Ayuda del teléfono: cómo se guardará o qué revisar. */
function PhoneHelp({ id, phone, error }: { id: string; phone: string; error?: string }) {
  const res = phone.trim() ? normalizePhone(phone) : null;
  return (
    <div id={id} aria-live="polite">
      {res?.ok ? (
        <p className="mem-hint-ok">
          <Check size={14} aria-hidden="true" /> Se guardará como {formatPhone(res.e164)}
        </p>
      ) : error ? (
        <FieldError id={`${id}-error`} message={error} />
      ) : (
        <p className="mem-help">Ej.: 9 1234 5678. {PHONE_HELP}</p>
      )}
    </div>
  );
}

// ---------- Registrar persona ----------

interface Created {
  personId: string;
  duplicates: DuplicateRef[];
}

function PersonFormContent({ onAnother }: { onAnother: () => void }) {
  const m = useMembers();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [requestId] = useState(newRequestId);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [firstVisitDate, setFirstVisitDate] = useState(m.today);
  const [eventId, setEventId] = useState("");
  const [arrival, setArrival] = useState<ArrivalSource | "">("");
  const [invitedBy, setInvitedBy] = useState("");
  // null = sin tocar: se propone a quien registra si es responsable válido.
  const [ownerChoice, setOwnerChoice] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState<{ phone?: boolean; email?: boolean }>({});
  const [submitted, setSubmitted] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const write = useWrite();

  const me = user?.uid ?? null;
  const owner = ownerChoice ?? (me && m.owners?.some((o) => o.uid === me) ? me : "");

  const payload: PersonCreateRequest = {
    requestId,
    fullName: name,
    phone,
    email: email.trim() ? email : null,
    firstVisitDate,
    ...(m.canReadCalendar && eventId ? { calendarEventId: eventId } : {}),
    arrivalSource: arrival || null,
    invitedBy: invitedBy.trim() ? invitedBy : null,
    followUpOwnerUid: owner || null,
    visitNote: note.trim() ? note : null,
  };
  const parsed = parsePersonCreate(payload, m.today);
  const clientErrors = parsed.ok ? {} : fieldMessages(parsed.errors);
  const serverFields = write.error?.fields ?? {};
  const show = (k: string) =>
    (submitted || (k === "phone" && touched.phone) || (k === "email" && touched.email) ? clientErrors[k] : undefined) ?? serverFields[k];

  const matches = useMemo(() => duplicateCandidates({ phone, email }, m.persons), [phone, email, m.persons]);
  const dupKey = matches.map((x) => x.person.id).join(",");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!parsed.ok) {
      const order = ["fullName", "phone", "email", "firstVisitDate", "calendarEventId", "arrivalSource", "invitedBy", "followUpOwnerUid", "visitNote"];
      const first = order.find((k) => clientErrors[k]);
      if (first) document.getElementById(`mem-np-${first}`)?.focus();
      return;
    }
    const res = await write.run(() => createPerson(payload));
    if (!res.ok) return;
    toast(res.value.replay ? "La persona ya estaba registrada" : "Persona registrada");
    if (res.value.duplicates.length) setCreated({ personId: res.value.personId, duplicates: res.value.duplicates });
    else router.push(personHref(res.value.personId));
  };

  if (created) {
    const byId = new Map(m.persons.map((p) => [p.id, p] as const));
    return (
      <div className="mem-form-page">
        <section className="panel mem-panel mem-success" aria-labelledby="mem-np-done">
          <h2 className="mem-h2" id="mem-np-done">
            <Check size={18} aria-hidden="true" /> Persona registrada
          </h2>
          <div className="mem-dup">
            <p className="mem-dup-title">
              <TriangleAlert size={16} aria-hidden="true" /> Posible duplicado
            </p>
            <p className="mem-help">Quedó registrada igual. Revisa si es la misma persona:</p>
            <ul className="mem-dup-list">
              {created.duplicates.map((d) => {
                const p = byId.get(d.personId);
                return (
                  <li key={d.personId} className="mem-dup-line">
                    <Link className="mem-link" href={personHref(d.personId)}>
                      {p ? p.fullName : "Ver ficha"}
                    </Link>
                    {d.by.length ? ` · mismo ${d.by.map((b) => (b === "telefono" ? "teléfono" : "correo")).join(" y ")}` : ""}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="mem-form-foot is-static">
            <button type="button" className="button-secondary" onClick={onAnother}>
              Registrar otra persona
            </button>
            <Link href={personHref(created.personId)} className="button-primary">
              <UserRound size={16} aria-hidden="true" /> Ver ficha
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mem-form-page">
      <Link href={PEOPLE_HREF} className="mem-link mem-back">
        <ArrowLeft size={16} aria-hidden="true" /> Personas
      </Link>
      <header className="mem-form-header">
        <h2 className="mem-page-title">Registrar persona</h2>
        <p className="mem-subtitle">Registro de primer contacto. Los campos con * son obligatorios.</p>
      </header>
      <InlineNotice tone="info" icon={ShieldAlert}>
        {ADULTS_ONLY_NOTICE}
      </InlineNotice>
      <form className="mem-form mem-person-form" onSubmit={submit} noValidate aria-label="Registrar persona">
        <section className="panel mem-panel mem-form-section" aria-labelledby="mem-np-contact">
          <h3 className="mem-h2" id="mem-np-contact">
            Contacto
          </h3>
          <div className="mem-field">
            <label htmlFor="mem-np-fullName">Nombre completo *</label>
            <input
              id="mem-np-fullName"
              className="mem-input"
              value={name}
              maxLength={MEMBERS_LIMITS.fullName}
              autoComplete="off"
              aria-required="true"
              aria-invalid={!!show("fullName") || undefined}
              aria-describedby={show("fullName") ? "mem-np-fullName-error" : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            <FieldError id="mem-np-fullName-error" message={show("fullName")} />
          </div>
          <div className="mem-field">
            <label htmlFor="mem-np-phone">Teléfono *</label>
            <input
              id="mem-np-phone"
              className="mem-input"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              aria-required="true"
              aria-invalid={!!show("phone") || undefined}
              aria-describedby="mem-np-phone-help"
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
            />
            <PhoneHelp id="mem-np-phone-help" phone={phone} error={show("phone")} />
          </div>
          <div className="mem-field">
            <label htmlFor="mem-np-email">Correo</label>
            <input
              id="mem-np-email"
              className="mem-input"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              maxLength={MEMBERS_LIMITS.email}
              aria-invalid={!!show("email") || undefined}
              aria-describedby={show("email") ? "mem-np-email-error" : undefined}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            />
            <FieldError id="mem-np-email-error" message={show("email")} />
          </div>
          <DuplicateNotice matches={matches} dismissed={!!dupKey && dismissed === dupKey} onDismiss={() => setDismissed(dupKey)} />
        </section>

        <section className="panel mem-panel mem-form-section" aria-labelledby="mem-np-arrival">
          <h3 className="mem-h2" id="mem-np-arrival">
            Llegada
          </h3>
          <div className="mem-field">
            <label htmlFor="mem-np-firstVisitDate">Fecha de la primera visita *</label>
            <input
              id="mem-np-firstVisitDate"
              className="mem-input mem-input-date"
              type="date"
              lang="es-CL"
              value={firstVisitDate}
              max={m.today}
              aria-required="true"
              aria-invalid={!!show("firstVisitDate") || undefined}
              aria-describedby={show("firstVisitDate") ? "mem-np-firstVisitDate-error" : "mem-np-firstVisitDate-echo"}
              onChange={(e) => {
                setFirstVisitDate(e.target.value);
                setEventId("");
              }}
            />
            {show("firstVisitDate") ? (
              <FieldError id="mem-np-firstVisitDate-error" message={show("firstVisitDate")} />
            ) : (
              <p className="mem-date-echo" id="mem-np-firstVisitDate-echo">
                {dateEcho(firstVisitDate)}
              </p>
            )}
          </div>
          {m.canReadCalendar && (
            <ActivityField
              id="mem-np-calendarEventId"
              label="Llegó a (opcional)"
              date={firstVisitDate}
              now={m.now}
              value={eventId}
              onChange={setEventId}
              error={show("calendarEventId")}
            />
          )}
          <div className="mem-field">
            <label htmlFor="mem-np-arrivalSource">Cómo llegó (opcional)</label>
            <select
              id="mem-np-arrivalSource"
              className="mem-select"
              value={arrival}
              aria-invalid={!!show("arrivalSource") || undefined}
              onChange={(e) => setArrival(e.target.value as ArrivalSource | "")}
            >
              <option value="">No indicar</option>
              {ARRIVAL_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {ARRIVAL_SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="mem-field">
            <label htmlFor="mem-np-invitedBy">Invitado por (opcional)</label>
            <input
              id="mem-np-invitedBy"
              className="mem-input"
              value={invitedBy}
              maxLength={MEMBERS_LIMITS.invitedBy}
              autoComplete="off"
              aria-invalid={!!show("invitedBy") || undefined}
              aria-describedby={show("invitedBy") ? "mem-np-invitedBy-error" : undefined}
              onChange={(e) => setInvitedBy(e.target.value)}
            />
            <FieldError id="mem-np-invitedBy-error" message={show("invitedBy")} />
          </div>
        </section>

        <section className="panel mem-panel mem-form-section" aria-labelledby="mem-np-follow">
          <h3 className="mem-h2" id="mem-np-follow">
            Seguimiento
          </h3>
          <div className="mem-field">
            <label htmlFor="mem-np-followUpOwnerUid">Responsable de seguimiento</label>
            <select
              id="mem-np-followUpOwnerUid"
              className="mem-select"
              value={owner}
              disabled={!m.owners}
              aria-invalid={!!show("followUpOwnerUid") || undefined}
              onChange={(e) => setOwnerChoice(e.target.value)}
            >
              <option value="">Sin responsable</option>
              {(m.owners ?? []).map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName}
                </option>
              ))}
            </select>
            {!m.owners ? (
              <p className="mem-help">{m.ownersLoading ? "Cargando responsables…" : "No pudimos cargar los responsables. Puedes asignarlo después."}</p>
            ) : (
              !owner && <p className="mem-hint-warn">Aparecerá en Necesitan atención hasta que alguien la tome.</p>
            )}
            <FieldError id="mem-np-followUpOwnerUid-error" message={show("followUpOwnerUid")} />
          </div>
          <NoteField
            id="mem-np-visitNote"
            label="Observación de la primera visita (opcional)"
            value={note}
            onChange={setNote}
            max={MEMBERS_LIMITS.note}
            error={show("visitNote")}
          />
        </section>

        <div className="mem-entry-row">
          <CalendarCheck size={16} aria-hidden="true" />
          <p>
            <strong>Fecha de ingreso:</strong> hoy, {dateEcho(m.today)} · Se registra automáticamente.
          </p>
        </div>
        {matches.length > 0 && dismissed !== dupKey && (
          <InlineNotice tone="info" icon={Info}>
            Hay un posible duplicado más arriba. Guardar sigue disponible: se marcará para revisarlo después.
          </InlineNotice>
        )}
        {!m.online && <OfflineNotice />}
        <FormError error={write.error} />

        <div className="mem-form-foot">
          <Link href={PEOPLE_HREF} className="button-secondary">
            Cancelar
          </Link>
          <SubmitButton submitting={write.submitting} disabled={!m.online} label="Guardar persona" />
        </div>
      </form>
      <p className="mem-help mem-page-note">{PRIVACY_NOTE}</p>
    </div>
  );
}

export function NewPersonScreen() {
  const [formKey, setFormKey] = useState(0);
  return (
    <MemberActions>
      <PersonFormContent key={formKey} onAnother={() => setFormKey((k) => k + 1)} />
    </MemberActions>
  );
}

// ---------- Editar datos ----------

/** Edición de datos operacionales (nombre, teléfono, correo, cómo llegó, invitado por). */
export function EditPersonSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const m = useMembers();
  const { toast } = useToast();
  const uid = useId();
  const formId = `mem-edit-form${uid}`;
  const [name, setName] = useState(person.fullName);
  const [phone, setPhone] = useState(person.phoneE164 ? formatPhone(person.phoneE164) : "");
  const [email, setEmail] = useState(person.email ?? "");
  const [arrival, setArrival] = useState<ArrivalSource | "">(person.arrivalSource ?? "");
  const [invitedBy, setInvitedBy] = useState(person.invitedBy ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const write = useWrite();

  const matches = useMemo(() => duplicateCandidates({ phone, email }, m.persons, person.id), [phone, email, m.persons, person.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const req: PersonUpdateRequest = { personId: person.id, expectedRevision: person.revision };
    const cleanName = name.replace(/\s+/g, " ").trim();
    if (cleanName !== person.fullName) req.fullName = name;
    const ph = normalizePhone(phone);
    if (!ph.ok || ph.e164 !== person.phoneE164) req.phone = phone;
    const em = email.trim() ? normalizeEmail(email) : null;
    if (em === null ? person.email !== null : !em.ok || em.value !== person.email) req.email = email.trim() ? email : null;
    if ((arrival || null) !== person.arrivalSource) req.arrivalSource = arrival || null;
    const cleanInvited = invitedBy.replace(/\s+/g, " ").trim() || null;
    if (cleanInvited !== person.invitedBy) req.invitedBy = cleanInvited;
    if (Object.keys(req).length === 2) return onClose();
    const parsed = parsePersonUpdate(req);
    if (!parsed.ok) {
      setErrors(fieldMessages(parsed.errors));
      return;
    }
    setErrors({});
    const res = await write.run(() => updatePerson(req));
    if (!res.ok) return;
    toast("Datos actualizados");
    onClose();
  };

  const serverFields = write.error?.fields ?? {};
  const err = (k: string) => errors[k] ?? serverFields[k];

  return (
    <CalDialog
      title={`Editar datos · ${person.fullName}`}
      onClose={onClose}
      busy={write.submitting}
      footer={
        <div className="mem-foot">
          <button type="button" className="button-secondary" onClick={onClose} disabled={write.submitting}>
            Cancelar
          </button>
          <SubmitButton form={formId} submitting={write.submitting} disabled={!m.online} label="Guardar cambios" />
        </div>
      }
    >
      <form id={formId} className="mem-form" onSubmit={submit} noValidate>
        <div className="mem-field">
          <label htmlFor="mem-edit-fullName">Nombre completo *</label>
          <input
            id="mem-edit-fullName"
            className="mem-input"
            value={name}
            maxLength={MEMBERS_LIMITS.fullName}
            autoComplete="off"
            aria-required="true"
            aria-invalid={!!err("fullName") || undefined}
            aria-describedby={err("fullName") ? "mem-edit-fullName-error" : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          <FieldError id="mem-edit-fullName-error" message={err("fullName")} />
        </div>
        <div className="mem-field">
          <label htmlFor="mem-edit-phone">Teléfono *</label>
          <input
            id="mem-edit-phone"
            className="mem-input"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            aria-required="true"
            aria-invalid={!!err("phone") || undefined}
            aria-describedby="mem-edit-phone-help"
            onChange={(e) => setPhone(e.target.value)}
          />
          <PhoneHelp id="mem-edit-phone-help" phone={phone} error={err("phone")} />
        </div>
        <div className="mem-field">
          <label htmlFor="mem-edit-email">Correo</label>
          <input
            id="mem-edit-email"
            className="mem-input"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            maxLength={MEMBERS_LIMITS.email}
            aria-invalid={!!err("email") || undefined}
            aria-describedby={err("email") ? "mem-edit-email-error" : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
          <FieldError id="mem-edit-email-error" message={err("email")} />
        </div>
        {matches.length > 0 && (
          <InlineNotice tone="warning" icon={TriangleAlert} role="status">
            Posible duplicado: {matches.map((x) => x.person.fullName).join(", ")} tiene el mismo{" "}
            {matches.some((x) => x.by.includes("telefono")) ? "teléfono" : "correo"}. Puedes guardar igual.
          </InlineNotice>
        )}
        <div className="mem-field">
          <label htmlFor="mem-edit-arrivalSource">Cómo llegó</label>
          <select
            id="mem-edit-arrivalSource"
            className="mem-select"
            value={arrival}
            onChange={(e) => setArrival(e.target.value as ArrivalSource | "")}
          >
            <option value="">No indicar</option>
            {ARRIVAL_SOURCES.map((s) => (
              <option key={s} value={s}>
                {ARRIVAL_SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="mem-field">
          <label htmlFor="mem-edit-invitedBy">Invitado por</label>
          <input
            id="mem-edit-invitedBy"
            className="mem-input"
            value={invitedBy}
            maxLength={MEMBERS_LIMITS.invitedBy}
            autoComplete="off"
            aria-invalid={!!err("invitedBy") || undefined}
            onChange={(e) => setInvitedBy(e.target.value)}
          />
          <FieldError id="mem-edit-invitedBy-error" message={err("invitedBy")} />
        </div>
        <p className="mem-help">El responsable y «No contactar» se cambian desde la ficha.</p>
        {!m.online && <OfflineNotice />}
        <FormError error={write.error} />
      </form>
    </CalDialog>
  );
}
