"use client";

// /preview/calendario/compartir (16b §5.10, solo manage_all): administración
// del enlace público. En la preview el enlace de producción es solo texto; la
// vista pública de demostración vive en /preview/calendario/compartir/demo.

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Ban, CircleCheck, CircleSlash, Copy, Link2, Power, RefreshCw } from "lucide-react";
import { dateOf, numericYmd } from "@/lib/suite-preview/dates";
import { DEFAULT_PRESENTED_TOKEN, nextPreviewToken, previewShareHref, productionShareUrl } from "@/lib/suite-preview/share";
import { ErrorState, Panel, Skeleton } from "@/components/finance-preview/ui";
import { PageHeader } from "../primitives";
import { useSuite } from "../provider";
import { replaceQueryParam, useQueryParam } from "../use-query";
import { ConfirmDialog } from "./event-dialogs";
import { SxBadge } from "./event-bits";
import { personName } from "./labels";

const PUBLISHED = [
  "Título, fecha y hora",
  "Lugar",
  "Descripción pública",
  "Área responsable y áreas participantes",
  "«Cancelada», sin el motivo",
];
const NEVER = [
  "Actividades «Solo equipo»",
  "Notas internas y motivos",
  "Nombres y correos de usuarios",
  "Datos de Integrantes",
  "Información financiera",
  "Actividades eliminadas",
];

export function ShareScreen() {
  const { state, dispatch, simulate } = useSuite();
  const estado = useQueryParam("estado");
  const [confirm, setConfirm] = useState<"none" | "regenerate" | "deactivate">("none");
  const link = state.shareLink;
  const n = state.shareRegenerations;
  const previousToken = n === 0 ? null : n === 1 ? DEFAULT_PRESENTED_TOKEN : nextPreviewToken(n - 2);
  const prodUrl = productionShareUrl(link.token);

  const header = <PageHeader title="Compartir calendario" subtitle="Un enlace de solo lectura con las actividades públicas." />;

  if (estado === "cargando")
    return (
      <div className="sx-share">
        {header}
        <Panel>
          <div aria-busy="true" aria-label="Cargando">
            <Skeleton h={22} w={160} />
            <Skeleton h={40} style={{ marginTop: 16 }} />
            <Skeleton h={18} w={200} style={{ marginTop: 16 }} />
          </div>
        </Panel>
      </div>
    );
  if (estado === "error")
    return (
      <div className="sx-share">
        {header}
        <Panel>
          <ErrorState title="No pudimos cargar el enlace." onRetry={() => replaceQueryParam("estado", null)} />
        </Panel>
      </div>
    );

  const copy = async () => {
    const demoUrl = `${window.location.origin}${previewShareHref(link.token)}`;
    try {
      await navigator.clipboard?.writeText(demoUrl);
    } catch {
      // Sin permiso de portapapeles: la simulación igual informa.
    }
    simulate("Enlace copiado");
  };

  const activeSince = link.regeneratedAt ?? link.createdAt;
  const activeBy = link.regeneratedBy ?? link.createdBy;

  return (
    <div className="sx-share">
      {header}
      <Panel title="Enlace" labelledBy="sx-share-link-title">
        <div className="sx-share-status">
          {link.active ? <SxBadge icon={CircleCheck} text="Activo" tone="info" /> : <SxBadge icon={Ban} text="Desactivado" tone="neutral" />}
          <span className="fx-help-13">
            {link.active
              ? `${link.regeneratedAt ? "Generado" : "Creado"} el ${numericYmd(dateOf(activeSince))} por ${personName(state.users, activeBy)}`
              : link.deactivatedAt
                ? `Desactivado el ${numericYmd(dateOf(link.deactivatedAt))} por ${personName(state.users, link.deactivatedBy)}`
                : "Desactivado"}
          </span>
        </div>

        {link.active ? (
          <>
            <div className="sx-share-field">
              <label htmlFor="sx-share-url" className="fx-sr">
                Enlace público
              </label>
              <input id="sx-share-url" className="fx-input sx-share-url" readOnly value={prodUrl} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="fx-btn fx-btn-secondary" onClick={copy}>
                <Copy size={16} aria-hidden="true" /> Copiar enlace
              </button>
            </div>
            <p className="fx-help">Formato del enlace en producción. En esta vista previa se abre la versión de demostración.</p>
            <Link href={previewShareHref(link.token)} className="fx-link sx-share-open">
              Abrir vista pública (demo) <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
            <div className="sx-share-actions">
              <button type="button" className="fx-btn fx-btn-secondary" onClick={() => setConfirm("regenerate")}>
                <RefreshCw size={16} aria-hidden="true" /> Regenerar enlace
              </button>
              <button type="button" className="fx-btn fx-btn-ghost sx-btn-danger-ghost" onClick={() => setConfirm("deactivate")}>
                <Power size={16} aria-hidden="true" /> Desactivar enlace
              </button>
            </div>
          </>
        ) : (
          <div className="sx-share-inactive">
            <p className="fx-help-13">Nadie puede ver el calendario compartido. Al activarlo se crea un enlace nuevo; los anteriores siguen sin funcionar.</p>
            <button type="button" className="fx-btn fx-btn-primary" onClick={() => dispatch({ type: "share/activate" }, "Enlace nuevo activado")}>
              <Link2 size={16} aria-hidden="true" /> Activar con un enlace nuevo
            </button>
          </div>
        )}

        {(previousToken || !link.active) && (
          <p className="sx-share-prev fx-help">
            {previousToken ? "El enlace anterior ya no funciona. " : ""}
            <Link href={previewShareHref(previousToken ?? link.token)} className="fx-link">
              Probar {previousToken ? "el enlace anterior" : "el enlace desactivado"} (demo)
            </Link>
          </p>
        )}
      </Panel>

      <div className="sx-share-lists">
        <Panel title="Qué se publica" labelledBy="sx-share-yes">
          <ul className="sx-share-list">
            {PUBLISHED.map((t) => (
              <li key={t}>
                <CircleCheck size={16} className="sx-share-yes" aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Qué nunca se publica" labelledBy="sx-share-no">
          <ul className="sx-share-list">
            {NEVER.map((t) => (
              <li key={t}>
                <CircleSlash size={16} className="sx-share-no" aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <ConfirmDialog
        open={confirm === "regenerate"}
        onClose={() => setConfirm("none")}
        labelId="sx-confirm-regenerate"
        title="¿Regenerar el enlace?"
        body="El enlace actual dejará de funcionar de inmediato. Quienes lo tengan verán «Este calendario no está disponible»."
        confirmLabel="Regenerar enlace"
        onConfirm={() => {
          dispatch({ type: "share/regenerate" }, "Enlace regenerado");
          setConfirm("none");
        }}
      />
      <ConfirmDialog
        open={confirm === "deactivate"}
        onClose={() => setConfirm("none")}
        labelId="sx-confirm-deactivate"
        title="¿Desactivar el enlace?"
        body="Nadie podrá ver el calendario compartido hasta que lo actives con un enlace nuevo."
        confirmLabel="Desactivar"
        destructive
        onConfirm={() => {
          dispatch({ type: "share/deactivate" }, "Enlace desactivado");
          setConfirm("none");
        }}
      />
    </div>
  );
}
