"use client";

// Marco raíz de la preview y pantallas de estado del acceso (sin shell):
// skeleton de la guardia, "Sin módulos asignados", "Cuenta sin acceso" y el
// aviso "No tienes acceso a {módulo}".

import Link from "next/link";
import { ShieldAlert, X } from "lucide-react";
import { FX_PREVIEW_SENTINEL } from "@/lib/finance-preview/fixtures";
import { normalizePath } from "@/lib/suite-preview/routes";
import { SX_PREVIEW_SENTINEL } from "@/lib/suite-preview/sentinel";
import { Skeleton } from "@/components/finance-preview/ui";
import { DesktopDemoBanner, MobileDemoBanner } from "./demo-banner";
import { useSuiteOptional } from "./provider";

/** Raíz con las clases de la preview y los dos sentinels que vigila la guardia de deploy. */
export function SuiteFrame({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`fx sx ${className}`} lang="es-CL" data-preview={FX_PREVIEW_SENTINEL} data-suite-preview={SX_PREVIEW_SENTINEL}>
      {children}
    </div>
  );
}

export function GateSkeleton() {
  return (
    <SuiteFrame className="sx-gate-skeleton">
      <div className="sx-skeleton-layout" aria-busy="true" aria-label="Cargando la vista previa">
        <div className="sx-skeleton-side" aria-hidden="true" />
        <div className="sx-skeleton-main">
          <Skeleton h={28} w={240} />
          <Skeleton h={16} w={360} style={{ marginTop: 12 }} />
          <Skeleton h={160} style={{ marginTop: 24 }} />
          <Skeleton h={160} style={{ marginTop: 16 }} />
        </div>
      </div>
    </SuiteFrame>
  );
}

function FullScreen({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <SuiteFrame className="sx-fullscreen">
      <MobileDemoBanner />
      <DesktopDemoBanner />
      <main id="fx-main" className="sx-center" tabIndex={-1}>
        <span className="sx-brand-mark-lg" aria-hidden="true">
          CS
        </span>
        <h1 className="fx-h1">{title}</h1>
        <p className="sx-center-body">{body}</p>
        {children}
      </main>
    </SuiteFrame>
  );
}

/** "Cerrar sesión" (simulación): vuelve al ingreso. En el propio ingreso usa onSignOut. */
function SignOut({ onSignOut }: { onSignOut?: () => void }) {
  return onSignOut ? (
    <button type="button" className="fx-btn fx-btn-secondary" onClick={onSignOut}>
      Cerrar sesión
    </button>
  ) : (
    <Link href="/preview" className="fx-btn fx-btn-secondary">
      Cerrar sesión
    </Link>
  );
}

/** Perfil activo sin permisos: sin sidebar, sin redirecciones, sin loop. */
export function NoModulesScreen({ onSignOut }: { onSignOut?: () => void }) {
  return (
    <FullScreen
      title="Aún no tienes módulos asignados"
      body="Tu cuenta está activa, pero todavía no tiene permisos. Pide al administrador que te asigne un módulo."
    >
      <SignOut onSignOut={onSignOut} />
    </FullScreen>
  );
}

export function InactiveScreen({ onSignOut }: { onSignOut?: () => void }) {
  return (
    <FullScreen title="Tu cuenta no tiene acceso autorizado" body="Pide al administrador que revise tu cuenta.">
      <SignOut onSignOut={onSignOut} />
    </FullScreen>
  );
}

/**
 * Franja "No tienes acceso a {módulo}. Te llevamos a {destino}." sobre el
 * contenido. Sin role="status" para no duplicar la región de toasts.
 */
export function AccessNotice() {
  const suite = useSuiteOptional();
  if (!suite?.notice || !suite.notice.text) return null;
  if (normalizePath(suite.pathname) !== suite.notice.forPath) return null;
  return (
    <section className="sx-notice" aria-label="Aviso de acceso">
      <ShieldAlert size={18} aria-hidden="true" />
      <p>{suite.notice.text}</p>
      <button type="button" className="sx-notice-close" aria-label="Cerrar aviso" onClick={() => suite.setNotice(null)}>
        <X size={16} aria-hidden="true" />
      </button>
    </section>
  );
}
