"use client";

// Revisión (coordinación): casos que la importación no resolvió sola.
import { useRef } from "react";
import * as api from "@/lib/outreach/client";
import { ErrorNote, ISSUE_LABEL, Loading, useAction, useLoad } from "./ui";

export default function ReviewView({ edition }: { edition: api.EditionSummary }) {
  const list = useLoad(() => api.reviewList(edition.id), [edition.id]);
  const act = useAction();
  // Un requestId por (caso, resolución): un reintento no duplica la acción.
  const ids = useRef(new Map<string, string>());
  const resolve = async (item: api.ReviewItem, resolution: api.ReviewResolution) => {
    const k = `${item.id}:${resolution}`;
    if (!ids.current.has(k)) ids.current.set(k, api.newRequestId());
    const ok = await act.run(() =>
      api.reviewResolve({
        editionId: edition.id,
        reviewId: item.id,
        resolution,
        ...(resolution === "mark_duplicate" && item.candidates[0] ? { targetRegistrationId: item.candidates[0] } : {}),
        requestId: ids.current.get(k)!,
      }),
    );
    if (ok) list.reload();
  };

  return (
    <section className="vp-card vp-narrow" aria-labelledby="vp-l-rev">
      <div className="vp-card-head">
        <h3 id="vp-l-rev">Revisión</h3>
        <p>Casos que necesitan una decisión de coordinación.</p>
      </div>
      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorNote message={list.error} onRetry={list.reload} />}
      {act.error && <ErrorNote message={act.error} />}
      {list.data && list.data.length === 0 && <p className="vp-small">No hay casos pendientes.</p>}
      <ul className="vp-people">
        {list.data?.map((item) => (
          <li key={item.id}>
            <div className="vp-person">
              <p className="vp-person-name">{ISSUE_LABEL[item.issue] ?? "Caso para revisar"}</p>
              <p className="vp-person-meta">
                {item.candidates.length > 0 ? `${item.candidates.length} posibles coincidencias` : "Sin coincidencias sugeridas"}
              </p>
            </div>
            <div className="vp-actions">
              {item.issue === "posible_duplicado" && item.candidates.length > 0 && (
                <button type="button" className="button-primary" disabled={act.busy} onClick={() => void resolve(item, "mark_duplicate")}>
                  Es la misma persona
                </button>
              )}
              {item.issue === "posible_duplicado" && (
                <button type="button" className="button-secondary" disabled={act.busy} onClick={() => void resolve(item, "keep_both")}>
                  Son distintas
                </button>
              )}
              <button type="button" className="button-secondary" disabled={act.busy} onClick={() => void resolve(item, "dismiss")}>
                Descartar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
