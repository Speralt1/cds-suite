"use client";

// Estados transversales del módulo: error de carga (red / sin permiso),
// sin conexión y lista de responsables que no cargó.

import { RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { ErrorState, InlineNotice } from "@/components/calendar/ui";
import { useMembers } from "@/lib/members/use-members";

export const LOAD_ERROR_TEXT = {
  permissionTitle: "No tienes acceso a Consolidación",
  permissionBody: "Puede que tus permisos hayan cambiado. Recarga la página o pide ayuda al administrador.",
  networkTitle: "No pudimos cargar Consolidación",
  networkBody: "Revisa tu conexión e inténtalo de nuevo.",
} as const;

/** Error al leer personas: sin permiso (recargar) o de red (reintentar). */
export function LoadErrorState() {
  const m = useMembers();
  if (m.error === "permission")
    return (
      <ErrorState
        title={LOAD_ERROR_TEXT.permissionTitle}
        body={LOAD_ERROR_TEXT.permissionBody}
        retryLabel="Recargar"
        onRetry={() => window.location.reload()}
      />
    );
  return <ErrorState title={LOAD_ERROR_TEXT.networkTitle} body={LOAD_ERROR_TEXT.networkBody} onRetry={m.retry} />;
}

/** Avisos del módulo bajo la subnav: sin conexión y responsables no disponibles. */
export function ModuleNotices() {
  const m = useMembers();
  if (m.online && !m.ownersError) return null;
  return (
    <div className="mem-module-notices">
      {!m.online && (
        <InlineNotice tone="warning" icon={WifiOff} role="status">
          Sin conexión. Puedes ver lo último que se cargó; para registrar o editar necesitas conexión.
        </InlineNotice>
      )}
      {m.ownersError && (
        <InlineNotice tone="warning" icon={TriangleAlert} role="status">
          <p>No pudimos cargar la lista de responsables. Las alertas «Sin responsable» solo consideran a quienes no tienen uno.</p>
          <button type="button" className="button-secondary mem-notice-btn" onClick={m.retryOwners}>
            <RefreshCw size={16} aria-hidden="true" /> Reintentar
          </button>
        </InlineNotice>
      )}
    </div>
  );
}
