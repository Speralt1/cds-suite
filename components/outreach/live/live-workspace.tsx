"use client";

// «Ve por los tuyos» · espacio de trabajo EN VIVO (callables y Firestore reales).
// Solo se carga con NEXT_PUBLIC_CDS_OUTREACH_LIVE=1 o con el submódulo
// habilitado; la build normal lo reemplaza por un módulo vacío.
// Marcador para check:no-preview: outreach-live-workspace

import { useMemo, useState } from "react";
import { useAccessModel } from "@/lib/access/model";
import { useAuth } from "@/lib/auth/auth-provider";
import * as api from "@/lib/outreach/client";
import { EDITION_STATUS_LABEL } from "@/lib/outreach/model";
import ImportView from "./import-view";
import Panorama from "./panorama";
import ReviewView from "./review-view";
import TablesView from "./tables-view";
import { ErrorNote, Loading, useLoad } from "./ui";
import "../outreach.css";

type ViewId = "panorama" | "importar" | "revision" | "mesas";
interface ViewDef {
  id: ViewId;
  label: string;
  role: string;
  perm: "coordinate" | "followup" | "decisions";
}
const VIEWS: ViewDef[] = [
  { id: "panorama", label: "Panorama", role: "Coordinación", perm: "coordinate" },
  { id: "importar", label: "Importar", role: "Coordinación", perm: "coordinate" },
  { id: "revision", label: "Revisión", role: "Coordinación", perm: "coordinate" },
  { id: "mesas", label: "Mesas", role: "Coordinación", perm: "coordinate" },
];

const PERMS = {
  coordinate: "members.outreach.coordinate",
  followup: "members.outreach.followup_assigned",
  decisions: "members.outreach.decisions",
} as const;

export default function LiveWorkspace() {
  const access = useAccessModel();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const editions = useLoad(() => api.fetchEditions(), []);
  const [editionId, setEditionId] = useState<string | null>(null);
  const [view, setView] = useState<ViewId | null>(null);
  const visible = useMemo(() => VIEWS.filter((v) => access.can(PERMS[v.perm])), [access]);

  const edition =
    editions.data?.find((e) => e.id === editionId) ?? editions.data?.find((e) => e.editionActive) ?? editions.data?.[0] ?? null;
  const current = visible.find((v) => v.id === view) ?? visible[0] ?? null;

  return (
    <div className="vp">
      <header className="vp-head">
        <div>
          <p className="vp-eyebrow">Integrantes · evento anual</p>
          <h2 className="vp-title">Ve por los tuyos</h2>
          {edition && (
            <p className="vp-sub">
              Edición {edition.year} · {EDITION_STATUS_LABEL[edition.status]}
            </p>
          )}
        </div>
        {editions.data && editions.data.length > 1 && (
          <label className="vp-edition">
            <span>Edición</span>
            <select value={edition?.id ?? ""} onChange={(e) => setEditionId(e.target.value)}>
              {editions.data.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.year} · {e.status === "cerrada" ? "cerrada" : "vigente"}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {editions.loading && <Loading label="Cargando edición…" />}
      {editions.error && <ErrorNote message={editions.error} onRetry={editions.reload} />}
      {editions.data && editions.data.length === 0 && (
        <p className="vp-card vp-empty">Todavía no hay una edición creada. Coordinación la crea para comenzar.</p>
      )}
      {editions.data && editions.data.length > 0 && visible.length === 0 && (
        <p className="vp-card vp-empty">Tu perfil no tiene una vista de este submódulo. Pide acceso a coordinación.</p>
      )}

      {edition && current && (
        <>
          {visible.length > 1 && (
            <div className="vp-views" role="group" aria-label="Vista">
              {visible.map((v) => (
                <button key={v.id} type="button" aria-pressed={current.id === v.id} onClick={() => setView(v.id)}>
                  <span>{v.label}</span>
                  <small>{v.role}</small>
                </button>
              ))}
            </div>
          )}
          {current.id === "panorama" && <Panorama edition={edition} onChanged={editions.reload} />}
          {current.id === "importar" && <ImportView edition={edition} />}
          {current.id === "revision" && <ReviewView edition={edition} />}
          {current.id === "mesas" && <TablesView edition={edition} />}
          <span hidden data-uid={uid ?? ""} />
        </>
      )}
    </div>
  );
}
