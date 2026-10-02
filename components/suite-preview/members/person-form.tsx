"use client";

// Nueva persona (16b §9.5): página de formulario, máx. 640 px, footer fijo en
// móvil. Teléfono normalizado a la vista, tri-estado explícito y aviso de
// posible duplicado que NUNCA bloquea.

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarCheck, Check, Info, TriangleAlert } from "lucide-react";
import { occurrencesInRange } from "@/lib/suite-preview/calendar";
import { STATUS_LABEL, TRISTATE_LABEL, ageAt, duplicateCandidates, validatePerson } from "@/lib/suite-preview/consolidation";
import { normalizePhone } from "@/lib/suite-preview/phone";
import type { Person, TriState } from "@/lib/suite-preview/types";
import { longDate, shortDate } from "@/lib/finance-preview/format";
import { Callout } from "@/components/finance-preview/ui";
import { PageHeader } from "../primitives";
import { C_BASE, firstName, personHref } from "./model";
import { MemberActions, useMemberActions } from "./sheets";
import { useMembers } from "./use-members";

const TRI: TriState[] = ["si", "no", "sin_informacion"];

function TriStateField({ name, legend, value, onChange }: { name: string; legend: string; value: TriState; onChange: (v: TriState) => void }) {
  return (
    <fieldset className="sx-fieldset sx-tri">
      <legend>{legend}</legend>
      <div className="sx-choices is-3">
        {TRI.map((t) => (
          <label key={t} className="sx-choice">
            <input type="radio" name={name} value={t} checked={value === t} onChange={() => onChange(t)} />
            <span>{TRISTATE_LABEL[t]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function DuplicateNotice({
  matches,
  dismissed,
  onDismiss,
}: {
  matches: { person: Person; by: ("telefono" | "correo")[] }[];
  dismissed: boolean;
  onDismiss: () => void;
}) {
  const m = useMembers();
  const { open } = useMemberActions();
  if (!matches.length) return null;
  if (dismissed)
    return (
      <p className="fx-help sx-dup-dismissed" aria-live="polite">
        Marcada como otra persona. Quedará el aviso «posible duplicado» para revisarlo después.
      </p>
    );
  const byPhone = matches.some((x) => x.by.includes("telefono"));
  return (
    <div className="sx-dup" aria-live="polite" data-testid="duplicate-notice">
      <p className="sx-dup-title">
        <TriangleAlert size={16} aria-hidden="true" />
        {matches.length > 1
          ? `Ya hay ${matches.length} personas con este ${byPhone ? "teléfono" : "correo"}`
          : `Ya hay una persona con este ${byPhone ? "teléfono" : "correo"}`}
      </p>
      <p className="fx-help">Las familias suelen compartir teléfono: puedes guardar igual.</p>
      {matches.map(({ person }) => (
        <div key={person.id} className="sx-dup-person">
          <p className="sx-dup-line">
            <strong>{person.fullName}</strong> · ingresó {shortDate(person.entryDate)} · {STATUS_LABEL[person.consolidationStatus]}
          </p>
          <div className="sx-dup-actions">
            <Link href={m.hrefFor(personHref(person.id))} className="fx-btn fx-btn-secondary fx-btn-sm">
              Ver ficha existente
            </Link>
            {m.canManage && person.lifecycleStage === "en_consolidacion" && (
              <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={() => open("visit", person.id)}>
                Registrar visita a {firstName(person.fullName)}
              </button>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="fx-btn fx-btn-ghost fx-btn-sm sx-dup-continue" onClick={onDismiss}>
        Es otra persona, continuar
      </button>
    </div>
  );
}

function PersonFormContent() {
  const m = useMembers();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birth, setBirth] = useState("");
  const [faith, setFaith] = useState<TriState>("sin_informacion");
  const [baptized, setBaptized] = useState<TriState>("sin_informacion");
  const defaultOwner = m.owners.some((u) => u.uid === m.profileId) ? m.profileId : "";
  const [owner, setOwner] = useState(defaultOwner);
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState<{ phone?: boolean; email?: boolean; birth?: boolean }>({});
  const [checked, setChecked] = useState<{ phone: string; email: string }>({ phone: "", email: "" });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // "Llegó a": actividades del calendario de hoy; por defecto la más cercana a la hora actual.
  const today = m.today;
  const nowTime = m.now.slice(11, 16);
  const occurrences = useMemo(
    () =>
      occurrencesInRange(m.state.events, today, today, m.now)
        .filter((o) => o.status !== "cancelada")
        .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "")),
    [m.state.events, today, m.now],
  );
  const nearest = useMemo(() => {
    const toMin = (t?: string) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : 720);
    const now = toMin(nowTime);
    return [...occurrences].sort((a, b) => Math.abs(toMin(a.startTime) - now) - Math.abs(toMin(b.startTime) - now))[0];
  }, [occurrences, nowTime]);
  const [arrived, setArrived] = useState<string>(nearest?.eventId ?? "");
  const [arrivedOther, setArrivedOther] = useState("");

  const phoneResult = phone.trim() ? normalizePhone(phone) : null;
  const errors = validatePerson({ fullName: name, phone, email: email || undefined, birthDate: birth || undefined, initialNotes: notes }, today);
  const showErr = (k: keyof typeof errors) => (submitted || (k !== "fullName" && touched[k as "phone" | "email"])) && errors[k];
  const age = birth && !errors.birthDate ? ageAt(birth, today) : null;
  const matches = duplicateCandidates({ phone: checked.phone, email: checked.email }, m.state.persons);
  const dupKey = matches.map((x) => x.person.id).join(",");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setChecked({ phone, email });
    const first = (["fullName", "phone", "email", "birthDate", "initialNotes"] as const).find((k) => errors[k]);
    if (first) {
      const idMap = { fullName: "sx-np-name", phone: "sx-np-phone", email: "sx-np-email", birthDate: "sx-np-birth", initialNotes: "sx-np-notes" };
      formRef.current?.querySelector<HTMLElement>(`#${idMap[first]}`)?.focus();
      return;
    }
    const occ = occurrences.find((o) => o.eventId === arrived);
    const res = m.dispatch(
      {
        type: "person/create",
        input: {
          fullName: name,
          phone,
          ...(email.trim() ? { email } : {}),
          ...(birth ? { birthDate: birth } : {}),
          faithConfession: faith,
          baptized,
          ...(notes.trim() ? { initialNotes: notes } : {}),
          followUpOwnerUid: owner || null,
          ...(occ ? { arrivedEventId: occ.eventId, arrivedLabel: occ.event.title } : {}),
          ...(arrived === "otra" && arrivedOther.trim() ? { arrivedLabel: arrivedOther.trim() } : {}),
        },
      },
      "Persona registrada",
    );
    if (res.ok && res.createdId) m.navigate(m.hrefFor(personHref(res.createdId)));
  };

  return (
    <div className="sx-form-page">
      <Link href={m.hrefFor(`${C_BASE}/personas`)} className="fx-link sx-back">
        <ArrowLeft size={16} aria-hidden="true" /> Personas
      </Link>
      <PageHeader title="Nueva persona" subtitle="Registro de primer contacto. Los campos con * son obligatorios." />
      <form ref={formRef} className="sx-form sx-person-form" onSubmit={submit} noValidate aria-label="Nueva persona">
        <section className="fx-panel sx-form-section" aria-labelledby="sx-np-contact">
          <h2 className="fx-h2" id="sx-np-contact">
            Contacto
          </h2>
          <div className="fx-field">
            <label htmlFor="sx-np-name">Nombre completo *</label>
            <input
              id="sx-np-name"
              className="fx-input"
              value={name}
              maxLength={120}
              autoComplete="off"
              aria-required="true"
              aria-invalid={!!showErr("fullName")}
              aria-describedby={showErr("fullName") ? "sx-np-name-error" : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {showErr("fullName") && (
              <p className="fx-error" id="sx-np-name-error" role="alert">
                <TriangleAlert size={14} aria-hidden="true" /> {errors.fullName}
              </p>
            )}
          </div>
          <div className="fx-field">
            <label htmlFor="sx-np-phone">Teléfono *</label>
            <input
              id="sx-np-phone"
              className="fx-input"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              aria-required="true"
              aria-invalid={!!showErr("phone")}
              aria-describedby="sx-np-phone-help"
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => {
                setTouched((t) => ({ ...t, phone: true }));
                setChecked((c) => ({ ...c, phone }));
              }}
            />
            <div id="sx-np-phone-help" aria-live="polite">
              {phoneResult?.ok ? (
                <p className="sx-hint-ok">
                  <Check size={14} aria-hidden="true" /> Se guardará como {phoneResult.display}
                </p>
              ) : showErr("phone") ? (
                <p className="fx-error" role="alert">
                  <TriangleAlert size={14} aria-hidden="true" />
                  {phone.trim() ? "Revisa el número: debe tener 9 dígitos (o el código de país con +)." : errors.phone}
                </p>
              ) : (
                <p className="fx-help">Ej.: 9 1234 5678. Si es de otro país, incluye el código: +58 412 555 0101.</p>
              )}
            </div>
          </div>
          <div className="fx-field">
            <label htmlFor="sx-np-email">Correo</label>
            <input
              id="sx-np-email"
              className="fx-input"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              aria-invalid={!!showErr("email")}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => {
                setTouched((t) => ({ ...t, email: true }));
                setChecked((c) => ({ ...c, email }));
              }}
            />
            {showErr("email") && (
              <p className="fx-error" role="alert">
                <TriangleAlert size={14} aria-hidden="true" /> {errors.email}
              </p>
            )}
          </div>
          <DuplicateNotice matches={matches} dismissed={dismissed === dupKey && !!dupKey} onDismiss={() => setDismissed(dupKey)} />
          <div className="fx-field">
            <label htmlFor="sx-np-birth">Fecha de nacimiento</label>
            <input
              id="sx-np-birth"
              className="fx-input sx-input-date"
              type="date"
              max={today}
              value={birth}
              aria-invalid={!!(birth && errors.birthDate)}
              onChange={(e) => setBirth(e.target.value)}
            />
            {birth && errors.birthDate ? (
              <p className="fx-error" role="alert">
                <TriangleAlert size={14} aria-hidden="true" /> {errors.birthDate}
              </p>
            ) : age !== null ? (
              <p className="fx-help-13">{age < 18 ? `Tiene ${age} años · menor de edad` : `Tiene ${age} años`}</p>
            ) : (
              <p className="fx-help">Opcional. La edad se calcula sola.</p>
            )}
          </div>
        </section>

        <section className="fx-panel sx-form-section" aria-labelledby="sx-np-faith">
          <h2 className="fx-h2" id="sx-np-faith">
            Fe
          </h2>
          <TriStateField name="sx-np-faith-confession" legend="Confesión de fe" value={faith} onChange={setFaith} />
          <TriStateField name="sx-np-baptized" legend="Bautizado" value={baptized} onChange={setBaptized} />
          <p className="fx-help">Si no lo sabes, deja «Sin información».</p>
        </section>

        <section className="fx-panel sx-form-section" aria-labelledby="sx-np-follow">
          <h2 className="fx-h2" id="sx-np-follow">
            Seguimiento
          </h2>
          <div className="fx-field">
            <label htmlFor="sx-np-owner">Responsable de seguimiento</label>
            <select id="sx-np-owner" className="fx-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Sin asignar</option>
              {m.owners.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName}
                </option>
              ))}
            </select>
            {!owner && <p className="sx-hint-warn">Aparecerá en Necesitan atención hasta que alguien la tome.</p>}
          </div>
          <div className="fx-field">
            <label htmlFor="sx-np-arrived">Llegó a (opcional)</label>
            <select id="sx-np-arrived" className="fx-select" value={arrived} onChange={(e) => setArrived(e.target.value)}>
              <option value="">No indicar</option>
              {occurrences.map((o) => (
                <option key={o.key} value={o.eventId}>
                  {o.event.title}
                  {o.startTime ? ` · ${o.startTime}` : ""}
                </option>
              ))}
              <option value="otra">Otra…</option>
            </select>
            {arrived === "otra" && (
              <input
                className="fx-input"
                aria-label="¿Dónde llegó?"
                placeholder="Ej.: Evangelismo en la plaza"
                value={arrivedOther}
                maxLength={120}
                onChange={(e) => setArrivedOther(e.target.value)}
              />
            )}
            <p className="fx-help">Será su primera visita en el historial.</p>
          </div>
          <div className="fx-field">
            <label htmlFor="sx-np-notes">Notas iniciales</label>
            <textarea
              id="sx-np-notes"
              className="sx-textarea"
              value={notes}
              maxLength={1000}
              aria-describedby="sx-np-notes-help"
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className="fx-help" id="sx-np-notes-help">
              {notes.length}/1000 · Solo lo que ayude al acompañamiento.
            </p>
          </div>
        </section>

        <div className="sx-entry-row">
          <CalendarCheck size={16} aria-hidden="true" />
          <p>
            <strong>Fecha de ingreso:</strong> hoy, {longDate(today)} · Se registra automáticamente.
          </p>
        </div>
        {matches.length > 0 && dismissed !== dupKey && (
          <Callout tone="info" icon={Info}>
            Hay un posible duplicado más arriba. Guardar sigue disponible: se marcará para revisarlo después.
          </Callout>
        )}

        <div className="sx-form-foot">
          <Link href={m.hrefFor(`${C_BASE}/personas`)} className="fx-btn fx-btn-secondary">
            Cancelar
          </Link>
          <button type="submit" className="fx-btn fx-btn-primary">
            Guardar persona
          </button>
        </div>
      </form>
      <p className="fx-help sx-page-note">
        Datos personales de uso pastoral. Solo los ve el equipo de Consolidación.
      </p>
    </div>
  );
}

export function NewPersonScreen() {
  return (
    <MemberActions>
      <PersonFormContent />
    </MemberActions>
  );
}
