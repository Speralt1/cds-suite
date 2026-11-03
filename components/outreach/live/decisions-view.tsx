"use client";

// Decisiones (permiso pastoral): las del responsable para SUS personas, por el
// mismo contrato de consulta que Mi lista. Datos sensibles: sin cifras globales aquí.
import * as api from "@/lib/outreach/client";
import { DECISION_LABEL } from "@/lib/outreach/model";
import { ErrorNote, Loading, useLoad } from "./ui";

export default function DecisionsView({ edition, uid }: { edition: api.EditionSummary; uid: string }) {
  const data = useLoad(async () => {
    const [decisions, regs] = await Promise.all([api.fetchMyDecisions(uid, edition.id), api.fetchMyRegistrations(uid, edition.id)]);
    return decisions.map((d) => ({ ...d, fullName: regs.find((r) => r.id === d.registrationId)?.fullName ?? "Persona asignada" }));
  }, [uid, edition.id]);
  return (
    <section className="vp-card vp-narrow" aria-labelledby="vp-l-dec">
      <div className="vp-card-head">
        <h3 id="vp-l-dec">Decisiones de tus personas</h3>
        <p>Lo que la persona declaró por sí misma en su mesa. Trátalo con reserva.</p>
      </div>
      {data.loading && !data.data && <Loading />}
      {data.error && <ErrorNote message={data.error} onRetry={data.reload} />}
      {data.data && data.data.length === 0 && <p className="vp-small">Todavía no hay decisiones registradas para tus personas.</p>}
      <ul className="vp-people">
        {data.data?.map((d) => (
          <li key={d.registrationId}>
            <div className="vp-person">
              <p className="vp-person-name">{d.fullName}</p>
              <p className="vp-person-meta">
                {DECISION_LABEL[d.value]}
                {d.tableNumber !== null && ` · Mesa ${d.tableNumber}`}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
