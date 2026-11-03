"use client";

// Distribución (coordinación): proponer → ver la propuesta → confirmar; los conflictos se informan.
import { useRef, useState } from "react";
import { RotateCcw, Shuffle } from "lucide-react";
import * as api from "@/lib/outreach/client";
import { isReadOnly } from "@/lib/outreach/model";
import { Done, ErrorNote, Loading, useAction, useLoad } from "./ui";

const EXCLUDED_LABEL: Record<string, string> = {
  baja: "Pidieron no ser contactadas",
  sin_autorizacion: "Sin autorización de seguimiento",
  no_activa: "Canceladas o duplicadas",
  ya_asignada: "Ya tienen responsable",
  traspasada: "Ya pasaron a Consolidación",
  no_asistio: "No asistieron",
  sin_confirmar: "Asistencia sin confirmar",
};
const CONFLICT_LABEL: Record<string, string> = {
  revision: "cambió desde la propuesta",
  ya_asignada: "ya tenía responsable",
  baja: "pidió no ser contactada",
  no_activa: "ya no está activa",
  responsable_invalido: "el responsable ya no está disponible",
  sin_capacidad: "el responsable llegó a su tope",
};

export default function DistributionView({ edition }: { edition: api.EditionSummary }) {
  const names = useLoad(() => api.teamCandidates(edition.id), [edition.id]);
  const [proposal, setProposal] = useState<api.Proposal | null>(null);
  const [outcome, setOutcome] = useState<api.BatchOutcome | null>(null);
  const requestId = useRef<string | null>(null);
  const act = useAction();
  const closed = isReadOnly({ status: edition.status });
  const nameOf = (uid: string) => names.data?.find((n) => n.uid === uid)?.displayName ?? "Responsable";

  const propose = async () => {
    requestId.current ??= api.newRequestId();
    setOutcome(null);
    const p = await act.run(() => api.distributionPropose(edition.id, requestId.current!));
    if (p) setProposal(p);
  };
  const confirm = async () => {
    if (!proposal) return;
    const o = await act.run(() => api.distributionConfirm(edition.id, proposal.batchId));
    if (o) {
      setOutcome(o);
      setProposal(null);
      requestId.current = null;
    }
  };
  const discard = () => {
    setProposal(null);
    requestId.current = null;
  };

  if (!proposal) {
    return (
      <section className="vp-card vp-narrow" aria-labelledby="vp-l-dist">
        <div className="vp-card-head">
          <h3 id="vp-l-dist">Distribución de la edición</h3>
          <p>Solo personas que asistieron y autorizaron contacto. No toca Consolidación habitual.</p>
        </div>
        {outcome && (
          <>
            <Done>
              Lote confirmado: {outcome.applied} asignaciones nuevas
              {outcome.alreadyApplied > 0 && `, ${outcome.alreadyApplied} ya estaban`}
              {outcome.conflicts.length > 0 && `, ${outcome.conflicts.length} con conflicto y sin cambios`}.
            </Done>
            {outcome.conflicts.length > 0 && <ConflictList conflicts={outcome.conflicts} />}
          </>
        )}
        <ol className="vp-steps">
          <li>Cada persona queda con el encargado de su mesa; quien no tenga mesa se reparte por equilibrio.</li>
          <li>Revisas la propuesta: nada se guarda hasta confirmar.</li>
          <li>Confirmas el lote. Repetir la confirmación no duplica nada.</li>
        </ol>
        {act.error && <ErrorNote message={act.error} />}
        {act.busy && <Loading label="Generando propuesta…" />}
        {!closed && (
          <button type="button" className="button-primary vp-cta" disabled={act.busy} onClick={() => void propose()}>
            <Shuffle size={16} aria-hidden="true" /> Generar propuesta
          </button>
        )}
      </section>
    );
  }

  const { summary } = proposal;
  return (
    <div className="vp-grid">
      <section className="vp-card vp-span-2" aria-labelledby="vp-l-prop">
        <div className="vp-card-head">
          <h3 id="vp-l-prop">Propuesta · {summary.assignments} personas</h3>
          <p>
            {summary.unassigned} sin cupo · {Object.values(summary.excluded).reduce((a, b) => a + b, 0)} no entran al reparto
          </p>
        </div>
        <ul className="vp-loads">
          {Object.entries(summary.loads).map(([uid, n]) => {
            const cap = summary.caps[uid] ?? 0;
            return (
              <li key={uid}>
                <span className="vp-load-name">{nameOf(uid)}</span>
                <span className="vp-load-bar" aria-hidden="true">
                  <span style={{ width: `${cap ? Math.min(100, Math.round((n / cap) * 100)) : 0}%` }} className={n > cap ? "is-over" : ""} />
                </span>
                <span className="vp-load-n tabular">
                  {n}/{cap}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="vp-card" aria-labelledby="vp-l-excl">
        <div className="vp-card-head">
          <h3 id="vp-l-excl">Quedan fuera</h3>
          <p>Por qué no se reparten</p>
        </div>
        <dl className="vp-figures is-compact">
          {Object.entries(summary.excluded).map(([reason, n]) => (
            <div key={reason}>
              <dt>{EXCLUDED_LABEL[reason] || reason}</dt>
              <dd className="tabular">{n}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="vp-card" aria-labelledby="vp-l-conf">
        <div className="vp-card-head">
          <h3 id="vp-l-conf">Confirmar</h3>
          <p>Lote {proposal.batchId.slice(0, 8)}</p>
        </div>
        <p className="vp-small">
          Si alguien cambió desde que generaste la propuesta, esa persona no se pisa: queda informada como conflicto.
        </p>
        {act.error && <ErrorNote message={act.error} />}
        <div className="vp-actions">
          <button type="button" className="button-primary" disabled={act.busy} onClick={() => void confirm()}>
            Confirmar distribución
          </button>
          <button type="button" className="button-secondary" onClick={discard}>
            <RotateCcw size={16} aria-hidden="true" /> Descartar
          </button>
        </div>
      </section>
    </div>
  );
}

function ConflictList({ conflicts }: { conflicts: api.BatchOutcome["conflicts"] }) {
  const counts = new Map<string, number>();
  for (const c of conflicts) counts.set(c.reason, (counts.get(c.reason) ?? 0) + 1);
  return (
    <ul className="vp-sheet-list" aria-label="Conflictos">
      {[...counts.entries()].map(([reason, n]) => (
        <li key={reason}>
          {n} {n === 1 ? "persona" : "personas"}: {CONFLICT_LABEL[reason] ?? "cambió y se dejó como estaba"}
        </li>
      ))}
    </ul>
  );
}
