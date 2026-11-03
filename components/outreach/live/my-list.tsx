"use client";

// Mi lista (responsable): SOLO sus personas asignadas (contrato de consulta:
// assigneeUid + editionActive + editionId) y la ficha de contacto.
import { useRef, useState } from "react";
import { MessageCircleOff, Phone, Users } from "lucide-react";
import { Sheet } from "@/components/layout/sheet";
import * as api from "@/lib/outreach/client";
import {
  EVENT_CONTACT_RESULT_LABEL,
  EVENT_CONTACT_RESULTS,
  queueBucket,
  type EventContactResult,
  type QueueBucket,
  type Registration,
} from "@/lib/outreach/model";
import { localToday } from "@/lib/shared/dates";
import { Done, ErrorNote, Loading, useAction, useLoad } from "./ui";

const BUCKET: Record<QueueBucket, { label: string; tone: string }> = {
  vencido: { label: "Atrasado", tone: "danger" },
  primer_contacto: { label: "Primer contacto", tone: "brand" },
  hoy: { label: "Para hoy", tone: "warning" },
  proximo: { label: "Próximamente", tone: "muted" },
  al_dia: { label: "Al día", tone: "ok" },
  baja: { label: "No contactar", tone: "muted" },
};
const ORDER: QueueBucket[] = ["vencido", "primer_contacto", "hoy", "proximo", "al_dia", "baja"];

const dayLabel = (ymd: string | null) => {
  if (!ymd) return "sin fecha";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
};

export default function MyList({ edition, uid }: { edition: api.EditionSummary; uid: string }) {
  const list = useLoad(() => api.fetchMyRegistrations(uid, edition.id), [uid, edition.id]);
  const [open, setOpen] = useState<Registration | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [today] = useState(() => localToday(Date.now()));
  const mine = (list.data ?? []).filter((r) => r.status === "activa" && !r.handedOffAt);
  const groups = ORDER.map((b) => ({ b, items: mine.filter((r) => queueBucket(r, today, edition.eventDate) === b) })).filter((g) => g.items.length > 0);

  return (
    <div className="vp-list-wrap">
      <p className="vp-small">Ves solo a las personas que coordinación te asignó en esta edición.</p>
      {notice && <Done>{notice}</Done>}
      {list.loading && !list.data && <Loading label="Cargando tu lista…" />}
      {list.error && <ErrorNote message={list.error} onRetry={list.reload} />}
      {list.data && mine.length === 0 && (
        <div className="vp-card vp-empty">
          <Users size={22} aria-hidden="true" />
          <p>Aún no tienes personas asignadas. Coordinación confirma la distribución después del evento.</p>
        </div>
      )}
      {groups.map(({ b, items }) => (
        <section key={b} className="vp-group" aria-labelledby={`vp-lg-${b}`}>
          <h3 id={`vp-lg-${b}`} className={`vp-group-title is-${BUCKET[b].tone}`}>
            {BUCKET[b].label} <span className="tabular">{items.length}</span>
          </h3>
          <ul className="vp-people">
            {items.map((r) => (
              <li key={r.id}>
                <div className="vp-person">
                  <p className="vp-person-name">{r.fullName}</p>
                  <p className="vp-person-meta">
                    {r.followUp.lastResult ? `${EVENT_CONTACT_RESULT_LABEL[r.followUp.lastResult]} · ${dayLabel(r.followUp.lastContactAt)}` : "Sin contacto todavía"}
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
      ))}
      {open && (
        <ContactSheet
          reg={open}
          editionId={edition.id}
          today={today}
          onClose={() => setOpen(null)}
          onSaved={(msg) => {
            setOpen(null);
            setNotice(msg);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function ContactSheet({ reg, editionId, today, onClose, onSaved }: { reg: Registration; editionId: string; today: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const [result, setResult] = useState<EventContactResult>("contactado");
  const [next, setNext] = useState("");
  const [date, setDate] = useState("");
  const requestId = useRef(api.newRequestId());
  const act = useAction();
  const optOut = result === "pidio_no_contacto";
  const hasNext = !optOut && next.trim() !== "";

  const save = async () => {
    const res = await act.run(() =>
      api.contactRecord({
        editionId,
        registrationId: reg.id,
        requestId: requestId.current,
        date: today,
        channel: "llamada",
        result,
        ...(hasNext && date ? { nextAction: next.trim(), nextActionDate: date } : {}),
      }),
    );
    if (res) onSaved(res.optedOut || optOut ? `${reg.fullName} salió de tu lista: no recibirá mensajes.` : "Contacto guardado.");
  };
  const stop = async () => {
    const res = await act.run(() => api.doNotContactSet({ editionId, registrationId: reg.id, value: true, reason: "pedido de la persona" }));
    if (res) onSaved(`${reg.fullName} salió de tu lista: no recibirá mensajes.`);
  };

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
        <p className="vp-small">Se registrará la baja: la persona sale de tu lista, se cancelan sus pendientes y no recibirá mensajes.</p>
      ) : (
        <div className="vp-next">
          <label>
            Próxima acción
            <input className="form-input" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label>
            Fecha
            <input className="form-input" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      )}
      {hasNext && !date && <p className="vp-small">Indica la fecha de la próxima acción o borra el texto.</p>}
      <p className="vp-small">No anotes aquí decisiones de fe ni temas personales: esta ficha la ve coordinación.</p>
      {act.error && <ErrorNote message={act.error} />}
      <button type="button" className="button-primary vp-cta" disabled={act.busy || (hasNext && !date)} onClick={() => void save()}>
        Guardar contacto
      </button>
      {!optOut && (
        <button type="button" className="button-secondary" disabled={act.busy} onClick={() => void stop()}>
          <MessageCircleOff size={16} aria-hidden="true" /> Pidió no ser contactada
        </button>
      )}
    </Sheet>
  );
}
