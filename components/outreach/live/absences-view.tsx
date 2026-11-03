"use client";

// Confirmar ausencias (coordinación): la ausencia nunca se deduce; se confirma a mano.
import { UserX } from "lucide-react";
import * as api from "@/lib/outreach/client";
import { isReadOnly } from "@/lib/outreach/model";
import { Done, ErrorNote, Loading, useAction, useLoad } from "./ui";
import { useState } from "react";

export default function AbsencesView({ edition }: { edition: api.EditionSummary }) {
  const regs = useLoad(() => api.fetchEditionRegistrations(edition.id), [edition.id]);
  const act = useAction();
  const [done, setDone] = useState<number | null>(null);
  const pending = (regs.data ?? []).filter((r) => r.status === "activa" && r.attendance === "sin_confirmar");
  const closed = isReadOnly({ status: edition.status });
  const confirm = async () => {
    const res = await act.run(() =>
      api.confirmAbsences(edition.id, pending.map((r) => r.id).slice(0, 400), pending.length),
    );
    if (res) {
      setDone(res.confirmed);
      regs.reload();
    }
  };
  return (
    <section className="vp-card vp-narrow" aria-labelledby="vp-l-abs">
      <div className="vp-card-head">
        <h3 id="vp-l-abs">Confirmar ausencias</h3>
        <p>Personas inscritas cuya asistencia nadie confirmó. Revísalas antes de marcarlas como ausentes.</p>
      </div>
      {regs.loading && !regs.data && <Loading />}
      {regs.error && <ErrorNote message={regs.error} onRetry={regs.reload} />}
      {act.error && <ErrorNote message={act.error} />}
      {done !== null && <Done>{done} ausencias confirmadas.</Done>}
      {regs.data && pending.length === 0 && <p className="vp-small">No quedan personas con asistencia sin confirmar.</p>}
      {pending.length > 0 && (
        <>
          <p className="vp-small">
            <span className="tabular">{pending.length}</span> personas sin asistencia confirmada
            {pending.length > 400 && " (se confirman de a 400)"}.
          </p>
          <ul className="vp-sheet-list">
            {pending.slice(0, 8).map((r) => (
              <li key={r.id}>{r.fullName}</li>
            ))}
            {pending.length > 8 && <li>…y {pending.length - 8} más.</li>}
          </ul>
          {!closed && (
            <button type="button" className="button-primary vp-cta" disabled={act.busy} onClick={() => void confirm()}>
              <UserX size={16} aria-hidden="true" /> Confirmar que {Math.min(pending.length, 400)} no asistieron
            </button>
          )}
        </>
      )}
    </section>
  );
}
