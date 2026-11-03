"use client";

// SIMULACIÓN LOCAL de «Ve por los tuyos» (doc 39 §6, doc 40). Solo se carga con
// NEXT_PUBLIC_CDS_OUTREACH_SIM=1. Tres vistas por rol: Panorama (coordinación),
// Distribución (coordinación) y Mi lista (responsable). Datos 100 % ficticios
// y en memoria: recargar la página vuelve al estado inicial.

import { useMemo, useReducer, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  CloudDownload,
  MessageCircleOff,
  Phone,
  RotateCcw,
  Shuffle,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { Sheet } from "@/components/layout/sheet";
import { editionMetrics } from "@/lib/outreach/metrics";
import {
  ATTENDANCE_LABEL,
  EDITION_STATUS_LABEL,
  EVENT_CONTACT_RESULT_LABEL,
  EVENT_CONTACT_RESULTS,
  queueBucket,
  type EventContactResult,
  type QueueBucket,
  type Registration,
} from "@/lib/outreach/model";
import { initialSimState, SIM_TODAY, simReducer, unconfirmed, type SimState } from "@/lib/outreach/sim/state";
import "./outreach.css";

type View = "panorama" | "distribucion" | "mi-lista";

const VIEWS: { id: View; label: string; role: string }[] = [
  { id: "panorama", label: "Panorama", role: "Coordinación" },
  { id: "distribucion", label: "Distribución", role: "Coordinación" },
  { id: "mi-lista", label: "Mi lista", role: "Responsable" },
];

const ISSUE_LABEL: Record<string, string> = {
  posible_duplicado: "Posible duplicado: confirmar si es la misma persona",
  telefono_invalido: "Teléfono no válido en la inscripción",
  correo_invalido: "Correo no válido en la inscripción",
  nombre_requerido: "Inscripción sin nombre",
  conflicto_edicion_local: "La web cambió un dato que coordinación ya corrigió",
  cancelada_con_asistencia: "Cancelada en la web, pero asistió",
  edicion_no_coincide: "La inscripción es de otra edición",
  edicion_cerrada: "Llegó después del cierre de la edición",
  asistencia_revertida_en_origen: "La puerta deshizo un ingreso",
};

const BUCKET: Record<QueueBucket, { label: string; tone: string }> = {
  vencido: { label: "Atrasado", tone: "danger" },
  primer_contacto: { label: "Primer contacto", tone: "brand" },
  hoy: { label: "Para hoy", tone: "warning" },
  proximo: { label: "Próximamente", tone: "muted" },
  al_dia: { label: "Al día", tone: "ok" },
  baja: { label: "No contactar", tone: "muted" },
};
const BUCKET_ORDER: QueueBucket[] = ["vencido", "primer_contacto", "hoy", "proximo", "al_dia", "baja"];

function pct(n: number, d: number) {
  return d === 0 ? 0 : Math.round((n / d) * 100);
}

function dayLabel(ymd: string | null) {
  if (!ymd) return "sin fecha";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}

export default function SimWorkspace() {
  const [state, dispatch] = useReducer(simReducer, undefined, initialSimState);
  const [view, setView] = useState<View>("panorama");
  const [editionId, setEditionId] = useState(state.edition.id);
  const past = state.past.find((p) => p.edition.id === editionId);

  return (
    <div className="vp">
      <p className="vp-sim-banner" role="note">
        <CircleDashed size={16} aria-hidden="true" /> Simulación local con 300 personas y 15 responsables ficticios. Nada se
        guarda ni se envía.
      </p>
      <header className="vp-head">
        <div>
          <p className="vp-eyebrow">Integrantes · evento anual</p>
          <h2 className="vp-title">Ve por los tuyos</h2>
          <p className="vp-sub">
            {past ? (
              <>Edición {past.edition.year} · cerrada · solo lectura</>
            ) : (
              <>
                Edición {state.edition.year} · {EDITION_STATUS_LABEL[state.edition.status]} · evento {dayLabel(state.edition.eventDate)}{" "}
                18:00
              </>
            )}
          </p>
        </div>
        <label className="vp-edition">
          <span>Edición</span>
          <select value={editionId} onChange={(e) => setEditionId(e.target.value)}>
            <option value={state.edition.id}>{state.edition.year} · vigente</option>
            {state.past.map((p) => (
              <option key={p.edition.id} value={p.edition.id}>
                {p.edition.year} · cerrada
              </option>
            ))}
          </select>
        </label>
      </header>

      {past ? (
        <PastEditionView past={past} onBack={() => setEditionId(state.edition.id)} />
      ) : (
        <>
          <div className="vp-views" role="group" aria-label="Vista">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)}>
                <span>{v.label}</span>
                <small>{v.role}</small>
              </button>
            ))}
          </div>
          {state.error && (
            <p className="vp-error" role="alert">
              <AlertTriangle size={16} aria-hidden="true" /> No se pudo completar: {state.error.replaceAll("_", " ")}.
              <button type="button" onClick={() => dispatch({ type: "clear-error" })}>
                Entendido
              </button>
            </p>
          )}
          {view === "panorama" && <Panorama state={state} dispatch={dispatch} goTo={setView} />}
          {view === "distribucion" && <Distribution state={state} dispatch={dispatch} />}
          {view === "mi-lista" && <MyList state={state} dispatch={dispatch} />}
        </>
      )}
    </div>
  );
}

type Dispatch = React.Dispatch<Parameters<typeof simReducer>[1]>;

function Panorama({ state, dispatch, goTo }: { state: SimState; dispatch: Dispatch; goTo: (v: View) => void }) {
  const regs = state.sync.registrations;
  const m = useMemo(() => editionMetrics(regs, SIM_TODAY, state.edition.eventDate), [regs, state.edition.eventDate]);
  const pending = unconfirmed(state);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const owners = state.team.filter((t) => t.roles.includes("responsable"));
  const attendance = [
    { key: "asistio", n: m.attended, label: ATTENDANCE_LABEL.asistio, icon: UserCheck },
    { key: "no_asistio", n: m.absentConfirmed, label: ATTENDANCE_LABEL.no_asistio, icon: UserX },
    { key: "sin_confirmar", n: m.attendancePending, label: ATTENDANCE_LABEL.sin_confirmar, icon: CircleDashed },
  ];

  return (
    <div className="vp-grid">
      <section className="vp-card vp-span-2" aria-labelledby="vp-att">
        <div className="vp-card-head">
          <h3 id="vp-att">Asistencia</h3>
          <p>
            de <strong className="tabular">{m.registered}</strong> inscripciones activas
          </p>
        </div>
        <div className="vp-stack" aria-hidden="true">
          {attendance.map((a) => (
            <span key={a.key} className={`vp-stack-seg is-${a.key}`} style={{ flexGrow: a.n }} />
          ))}
        </div>
        <ul className="vp-legend">
          {attendance.map((a) => (
            <li key={a.key}>
              <a.icon size={16} aria-hidden="true" />
              <span>{a.label}</span>
              <strong className="tabular">{a.n}</strong>
              <small className="tabular">{pct(a.n, m.registered)} %</small>
            </li>
          ))}
        </ul>
        {pending.length > 0 && (
          <div className="vp-inline-action">
            <p>
              {pending.length} siguen «Sin confirmar». La ausencia no se deduce: confírmala tú cuando cierres la
              asistencia.
            </p>
            <button type="button" className="button-secondary" onClick={() => setConfirmOpen(true)}>
              Revisar y confirmar ausencias
            </button>
          </div>
        )}
      </section>

      <section className="vp-card" aria-labelledby="vp-fu">
        <div className="vp-card-head">
          <h3 id="vp-fu">Seguimiento</h3>
          <p>
            <strong className="tabular">{m.contactable}</strong> autorizaron contacto
          </p>
        </div>
        <dl className="vp-figures">
          <div>
            <dt>Asignadas</dt>
            <dd className="tabular">{m.assigned}</dd>
          </div>
          <div className={m.unassignedContactable ? "is-attention" : ""}>
            <dt>Sin asignar</dt>
            <dd className="tabular">{m.unassignedContactable}</dd>
          </div>
          <div>
            <dt>Primer contacto pendiente</dt>
            <dd className="tabular">{m.firstContactPending}</dd>
          </div>
          <div className={m.overdue ? "is-danger" : ""}>
            <dt>Atrasadas</dt>
            <dd className="tabular">{m.overdue}</dd>
          </div>
          <div>
            <dt>No contactar</dt>
            <dd className="tabular">{m.optedOut}</dd>
          </div>
          <div>
            <dt>Pasaron a Consolidación</dt>
            <dd className="tabular">{m.handedOff}</dd>
          </div>
        </dl>
        {m.unassignedContactable > 0 && (
          <button type="button" className="button-primary vp-cta" onClick={() => goTo("distribucion")}>
            Distribuir entre responsables <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </section>

      <section className="vp-card" aria-labelledby="vp-conn">
        <div className="vp-card-head">
          <h3 id="vp-conn">Conexiones</h3>
          <p>Cada una puede pausarse sin afectar a la otra</p>
        </div>
        <div className="vp-conn">
          <div className="vp-conn-row">
            <CloudDownload size={18} aria-hidden="true" />
            <div>
              <p className="vp-conn-name">Inscripciones de veporlostuyos.com</p>
              <p className="vp-conn-meta">
                {state.lastSync
                  ? `Última lectura ${state.lastSync.at.slice(11)} · ${state.lastSync.report.created} nuevas, ${state.lastSync.report.updated} corregidas, ${state.lastSync.report.cancelled} canceladas`
                  : "Solo lectura desde la web · CDS nunca escribe en el sitio"}
              </p>
            </div>
            <button type="button" className="button-secondary" onClick={() => dispatch({ type: "sync-web" })}>
              Simular lectura
            </button>
          </div>
          {state.sync.review.length > 0 && (
            <ul className="vp-review" aria-label="Por revisar">
              {state.sync.review.map((r) => (
                <li key={`${r.externalId}-${r.issue}-${r.sourceRevision}`}>
                  <AlertTriangle size={14} aria-hidden="true" /> {ISSUE_LABEL[r.issue] ?? r.issue}
                  <small> · registro web {r.externalId}</small>
                </li>
              ))}
            </ul>
          )}
          <div className="vp-conn-row is-paused">
            <MessageCircleOff size={18} aria-hidden="true" />
            <div>
              <p className="vp-conn-name">Mensajería WhatsApp</p>
              <p className="vp-conn-meta">Pausada · requiere aprobación de número, texto y prueba con destinatarios ficticios</p>
            </div>
            <span className="vp-chip">Pausada</span>
          </div>
        </div>
      </section>

      <section className="vp-card vp-span-2" aria-labelledby="vp-load">
        <div className="vp-card-head">
          <h3 id="vp-load">Carga por responsable</h3>
          <p>Tope sugerido {state.edition.maxPerOwner} por persona</p>
        </div>
        <ul className="vp-loads">
          {owners.map((o) => {
            const n = m.loadByOwner[o.uid] ?? 0;
            const cap = o.maxAssigned ?? state.edition.maxPerOwner;
            return (
              <li key={o.uid}>
                <span className="vp-load-name">{o.displayName}</span>
                <span className="vp-load-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, pct(n, cap))}%` }} className={n > cap ? "is-over" : ""} />
                </span>
                <span className="vp-load-n tabular">
                  {n}/{cap}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {confirmOpen && (
        <Sheet title="Confirmar ausencias" onClose={() => setConfirmOpen(false)}>
          <p className="vp-sheet-text">
            Se marcarán como «No asistió» {pending.length} personas que no registraron ingreso en la puerta. Hazlo solo al
            cerrar la asistencia; cada marca queda con tu nombre y la hora.
          </p>
          <ul className="vp-sheet-list">
            {pending.slice(0, 8).map((r) => (
              <li key={r.id}>{r.fullName}</li>
            ))}
            {pending.length > 8 && <li>y {pending.length - 8} más</li>}
          </ul>
          <button
            type="button"
            className="button-primary vp-cta"
            onClick={() => {
              dispatch({ type: "confirm-absences", ids: pending.map((r) => r.id) });
              setConfirmOpen(false);
            }}
          >
            Confirmar {pending.length} ausencias
          </button>
        </Sheet>
      )}
    </div>
  );
}

function Distribution({ state, dispatch }: { state: SimState; dispatch: Dispatch }) {
  const p = state.proposal;
  const owners = state.team.filter((t) => t.roles.includes("responsable") && t.active);
  const regName = (id: string) => state.sync.registrations.find((r) => r.id === id)?.fullName ?? id;

  if (!p) {
    return (
      <section className="vp-card vp-narrow">
        <div className="vp-card-head">
          <h3>Distribución de la edición</h3>
          <p>Solo personas que asistieron y autorizaron contacto. No toca Consolidación habitual.</p>
        </div>
        {state.lastBatch && (
          <p className="vp-result" role="status">
            <CheckCircle2 size={16} aria-hidden="true" /> Lote confirmado: {state.lastBatch.applied.length} asignaciones nuevas
            {state.lastBatch.alreadyApplied.length > 0 && `, ${state.lastBatch.alreadyApplied.length} ya estaban`}
            {state.lastBatch.conflicts.length > 0 && `, ${state.lastBatch.conflicts.length} cambiaron y se dejaron como estaban`}.
          </p>
        )}
        <ol className="vp-steps">
          <li>Generas una propuesta equilibrada (hasta {state.edition.maxPerOwner} por responsable).</li>
          <li>Ajustas lo necesario; superar el tope exige un motivo.</li>
          <li>Confirmas el lote. Repetir la confirmación no duplica nada.</li>
        </ol>
        <button type="button" className="button-primary vp-cta" onClick={() => dispatch({ type: "propose" })}>
          <Shuffle size={16} aria-hidden="true" /> Generar propuesta
        </button>
      </section>
    );
  }

  return (
    <div className="vp-grid">
      <section className="vp-card vp-span-2" aria-labelledby="vp-prop">
        <div className="vp-card-head">
          <h3 id="vp-prop">Propuesta · {p.assignments.length} personas</h3>
          <p>
            {p.unassigned.length} sin cupo · {p.excluded.length} no entran al reparto
          </p>
        </div>
        <ul className="vp-loads">
          {owners.map((o) => {
            const n = p.loads[o.uid] ?? 0;
            const cap = p.caps[o.uid];
            return (
              <li key={o.uid}>
                <span className="vp-load-name">{o.displayName}</span>
                <span className="vp-load-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, pct(n, cap))}%` }} className={n > cap ? "is-over" : ""} />
                </span>
                <span className="vp-load-n tabular">
                  {n}/{cap}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="vp-card" aria-labelledby="vp-excl">
        <div className="vp-card-head">
          <h3 id="vp-excl">Quedan fuera</h3>
          <p>Por qué no se reparten</p>
        </div>
        <ExclusionSummary excluded={p.excluded} />
        {p.unassigned.length > 0 && (
          <>
            <p className="vp-small">Sin cupo (asígnalas a mano con motivo):</p>
            <ul className="vp-sheet-list">
              {p.unassigned.slice(0, 5).map((u) => (
                <li key={u.registrationId}>{regName(u.registrationId)}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="vp-card" aria-labelledby="vp-confirm">
        <div className="vp-card-head">
          <h3 id="vp-confirm">Confirmar</h3>
          <p>Lote {p.batchId}</p>
        </div>
        <p className="vp-small">
          Si alguien cambió desde que generaste la propuesta (otra asignación, una baja), esa persona no se pisa: queda
          informada como conflicto.
        </p>
        <div className="vp-actions">
          <button type="button" className="button-primary" onClick={() => dispatch({ type: "confirm-batch" })}>
            Confirmar distribución
          </button>
          <button type="button" className="button-secondary" onClick={() => dispatch({ type: "discard-proposal" })}>
            <RotateCcw size={16} aria-hidden="true" /> Descartar
          </button>
        </div>
      </section>
    </div>
  );
}

const EXCLUDED_LABEL: Record<string, string> = {
  baja: "Pidieron no ser contactadas",
  sin_autorizacion: "Sin autorización de seguimiento",
  no_activa: "Canceladas o duplicadas",
  ya_asignada: "Ya tienen responsable",
  traspasada: "Ya pasaron a Consolidación",
  no_asistio: "No asistieron",
  sin_confirmar: "Asistencia sin confirmar",
};

function ExclusionSummary({ excluded }: { excluded: { reason: string }[] }) {
  const counts = new Map<string, number>();
  for (const e of excluded) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  return (
    <dl className="vp-figures is-compact">
      {[...counts.entries()].map(([reason, n]) => (
        <div key={reason}>
          <dt>{EXCLUDED_LABEL[reason] ?? reason}</dt>
          <dd className="tabular">{n}</dd>
        </div>
      ))}
    </dl>
  );
}

function MyList({ state, dispatch }: { state: SimState; dispatch: Dispatch }) {
  const owners = state.team.filter((t) => t.roles.includes("responsable"));
  const [ownerUid, setOwnerUid] = useState(owners[2]?.uid ?? "");
  const [open, setOpen] = useState<Registration | null>(null);
  const mine = state.sync.registrations.filter((r) => r.ownerUid === ownerUid && r.status === "activa" && !r.handedOffAt);
  const groups = BUCKET_ORDER.map((b) => ({ b, items: mine.filter((r) => queueBucket(r, SIM_TODAY, state.edition.eventDate) === b) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div className="vp-list-wrap">
      <label className="vp-as">
        <span>Responsable (simulación)</span>
        <select value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)}>
          {owners.map((o) => (
            <option key={o.uid} value={o.uid}>
              {o.displayName}
            </option>
          ))}
        </select>
      </label>
      <p className="vp-small">
        Cada responsable ve solo a sus personas asignadas en esta edición. Hoy es {dayLabel(SIM_TODAY)} (D+2).
      </p>
      {mine.length === 0 ? (
        <div className="vp-card vp-empty">
          <Users size={22} aria-hidden="true" />
          <p>Aún no tienes personas asignadas. Coordinación confirma la distribución después del evento.</p>
        </div>
      ) : (
        groups.map(({ b, items }) => (
          <section key={b} className="vp-group" aria-labelledby={`vp-g-${b}`}>
            <h3 id={`vp-g-${b}`} className={`vp-group-title is-${BUCKET[b].tone}`}>
              {BUCKET[b].label} <span className="tabular">{items.length}</span>
            </h3>
            <ul className="vp-people">
              {items.map((r) => (
                <li key={r.id}>
                  <div className="vp-person">
                    <p className="vp-person-name">{r.fullName}</p>
                    <p className="vp-person-meta">
                      {r.followUp.lastResult
                        ? `${EVENT_CONTACT_RESULT_LABEL[r.followUp.lastResult]} · ${dayLabel(r.followUp.lastContactAt)}`
                        : "Sin contacto todavía"}
                      {r.followUp.nextAction && ` · Próximo: ${r.followUp.nextAction} (${dayLabel(r.followUp.nextActionDate)})`}
                    </p>
                  </div>
                  {r.phoneE164 && b !== "baja" && (
                    <a className="vp-icon-btn" href={`tel:${r.phoneE164}`} aria-label={`Llamar a ${r.fullName}`}>
                      <Phone size={18} aria-hidden="true" />
                    </a>
                  )}
                  {b !== "baja" && (
                    <button type="button" className="button-secondary vp-row-cta" onClick={() => setOpen(r)}>
                      Registrar contacto
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {open && (
        <ContactSheet
          reg={open}
          onClose={() => setOpen(null)}
          onSave={(result, nextAction, nextDate) => {
            dispatch({
              type: "contact",
              contact: {
                id: `c-${open.id}-${state.contacts.length}`,
                registrationId: open.id,
                editionId: state.edition.id,
                date: SIM_TODAY,
                channel: "llamada",
                result,
                nextAction,
                nextActionDate: nextDate,
                byUid: ownerUid,
              },
            });
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

function ContactSheet({
  reg,
  onClose,
  onSave,
}: {
  reg: Registration;
  onClose: () => void;
  onSave: (result: EventContactResult, nextAction: string | null, nextDate: string | null) => void;
}) {
  const [result, setResult] = useState<EventContactResult>("contactado");
  const [next, setNext] = useState("Invitar a la reunión del domingo");
  const [date, setDate] = useState("2026-12-06");
  const optOut = result === "pidio_no_contacto";
  return (
    <Sheet title={`Contacto con ${reg.fullName}`} onClose={onClose}>
      <fieldset className="vp-results">
        <legend>¿Qué pasó?</legend>
        {EVENT_CONTACT_RESULTS.map((r) => (
          <label key={r} className={result === r ? "is-on" : ""}>
            <input type="radio" name="result" value={r} checked={result === r} onChange={() => setResult(r)} />
            {EVENT_CONTACT_RESULT_LABEL[r]}
          </label>
        ))}
      </fieldset>
      {optOut ? (
        <p className="vp-small">
          Se registrará la baja: la persona sale de tu lista, se cancelan sus pendientes y no recibirá mensajes.
        </p>
      ) : (
        <div className="vp-next">
          <label>
            Próxima acción
            <input className="form-input" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label>
            Fecha
            <input className="form-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      )}
      <p className="vp-small">No anotes aquí decisiones de fe ni temas personales: esta ficha la ve coordinación.</p>
      <button
        type="button"
        className="button-primary vp-cta"
        onClick={() => onSave(result, optOut || !next.trim() ? null : next.trim(), optOut || !next.trim() ? null : date)}
      >
        Guardar contacto
      </button>
    </Sheet>
  );
}

function PastEditionView({ past, onBack }: { past: SimState["past"][number]; onBack: () => void }) {
  const t = past.totals;
  return (
    <section className="vp-card vp-narrow" aria-labelledby="vp-past">
      <div className="vp-card-head">
        <h3 id="vp-past">
          <Archive size={18} aria-hidden="true" /> {past.edition.title}
        </h3>
        <p>Cerrada: sus pendientes no aparecen en la edición vigente.</p>
      </div>
      <dl className="vp-figures">
        <div>
          <dt>Inscripciones</dt>
          <dd className="tabular">{t.registered}</dd>
        </div>
        <div>
          <dt>Asistieron</dt>
          <dd className="tabular">{t.attended}</dd>
        </div>
        <div>
          <dt>Pasaron a Consolidación</dt>
          <dd className="tabular">{t.handedOff}</dd>
        </div>
        <div>
          <dt>Pidieron no ser contactadas</dt>
          <dd className="tabular">{t.optedOut}</dd>
        </div>
      </dl>
      <p className="vp-small">El equipo de esta edición se puede copiar a la siguiente (solo la estructura, sin personas).</p>
      <button type="button" className="button-secondary" onClick={onBack}>
        Volver a la edición vigente
      </button>
    </section>
  );
}
