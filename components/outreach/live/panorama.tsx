"use client";

// Panorama (coordinación): estado de la edición, transiciones y cifras con denominador.
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import * as api from "@/lib/outreach/client";
import { canMoveEdition, EDITION_STATUSES, EDITION_STATUS_LABEL, type EditionStatus } from "@/lib/outreach/model";
import { ErrorNote, Loading, useAction, useLoad } from "./ui";

const FIGURES: { key: string; label: string; attention?: boolean }[] = [
  { key: "registered", label: "Inscritas" },
  { key: "attended", label: "Asistieron" },
  { key: "attendancePending", label: "Asistencia sin confirmar", attention: true },
  { key: "unassignedContactable", label: "Sin asignar", attention: true },
  { key: "assigned", label: "Asignadas" },
  { key: "firstContactPending", label: "Primer contacto pendiente" },
  { key: "overdue", label: "Atrasadas", attention: true },
  { key: "optedOut", label: "Pidieron no ser contactadas" },
];

export default function Panorama({ edition, onChanged }: { edition: api.EditionSummary; onChanged: () => void }) {
  const st = useLoad(() => api.stats(edition.id), [edition.id, edition.revision]);
  const act = useAction();
  const [confirm, setConfirm] = useState<EditionStatus | null>(null);
  const targets = EDITION_STATUSES.filter((s) => canMoveEdition(edition.status, s));
  const forward = targets.find((s) => EDITION_STATUSES.indexOf(s) > EDITION_STATUSES.indexOf(edition.status));
  const move = async (to: EditionStatus) => {
    const ok = await act.run(() => api.editionTransition(edition.id, to, edition.revision));
    setConfirm(null);
    if (ok) onChanged();
  };

  return (
    <div className="vp-grid">
      <section className="vp-card" aria-labelledby="vp-l-state">
        <div className="vp-card-head">
          <h3 id="vp-l-state">Etapa de la edición</h3>
          <p>{EDITION_STATUS_LABEL[edition.status]}</p>
        </div>
        {edition.status === "cerrada" ? (
          <p className="vp-small">Edición cerrada: solo lectura.</p>
        ) : confirm ? (
          <div className="vp-actions">
            <p className="vp-small">¿Pasar a «{EDITION_STATUS_LABEL[confirm]}»? Cambia qué se muestra a recepción y responsables.</p>
            <button type="button" className="button-primary" disabled={act.busy} onClick={() => move(confirm)}>
              Sí, pasar a {EDITION_STATUS_LABEL[confirm]}
            </button>
            <button type="button" className="button-secondary" onClick={() => setConfirm(null)}>
              Cancelar
            </button>
          </div>
        ) : (
          <div className="vp-actions">
            {forward && (
              <button type="button" className="button-primary" onClick={() => setConfirm(forward)}>
                <ArrowRight size={16} aria-hidden="true" /> Pasar a {EDITION_STATUS_LABEL[forward]}
              </button>
            )}
            {targets
              .filter((s) => s !== forward)
              .map((s) => (
                <button key={s} type="button" className="button-secondary" onClick={() => setConfirm(s)}>
                  Volver a {EDITION_STATUS_LABEL[s]}
                </button>
              ))}
          </div>
        )}
        {act.error && <ErrorNote message={act.error} />}
      </section>

      <section className="vp-card" aria-labelledby="vp-l-fig">
        <div className="vp-card-head">
          <h3 id="vp-l-fig">Panorama</h3>
          <p>Cifras de la edición</p>
        </div>
        {st.loading && <Loading />}
        {st.error && <ErrorNote message={st.error} onRetry={st.reload} />}
        {st.data && (
          <>
            <dl className="vp-figures">
              {FIGURES.map((f) => (
                <div key={f.key} className={f.attention && (st.data!.metrics[f.key] ?? 0) > 0 ? "is-attention" : undefined}>
                  <dt>{f.label}</dt>
                  <dd className="tabular">{st.data!.metrics[f.key] ?? 0}</dd>
                </div>
              ))}
            </dl>
            {st.data.review.total > 0 && <p className="vp-small">{st.data.review.total} casos esperan revisión.</p>}
          </>
        )}
      </section>
    </div>
  );
}
