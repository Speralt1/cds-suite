"use client";

// Ingreso simulado /preview (16b §3.4): "¿Con qué perfil entras?". Sin shell.
// La columna "Entra a …" se calcula con resolveInitialModule (la misma función
// que usa la app). Al elegir, se fija el perfil y se navega directo a su módulo,
// sin pantalla intermedia; un perfil sin módulos ve su pantalla aquí mismo.

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { INITIAL_MODULE_LABEL, resolveInitialModule } from "@/lib/suite-preview/access";
import { initialsOf, profileTitle } from "@/lib/suite-preview/fixtures";
import { withProfile } from "@/lib/suite-preview/routes";
import { DesktopDemoBanner, MobileDemoBanner, entersLabel, useDemoProfiles } from "./demo-banner";
import { useSuite } from "./provider";
import { AccessNotice, InactiveScreen, NoModulesScreen, SuiteFrame } from "./screens";

export function PreviewLogin() {
  const suite = useSuite();
  const profiles = useDemoProfiles();
  const [inPlace, setInPlace] = useState<"no-modules" | "inactive" | null>(null);

  if (inPlace === "no-modules") return <NoModulesScreen onSignOut={() => setInPlace(null)} />;
  if (inPlace === "inactive") return <InactiveScreen onSignOut={() => setInPlace(null)} />;

  const fallback = profiles.map(resolveInitialModule).find((l) => l.kind === "module" && l.invalidInitial);
  const fallbackInitial = fallback?.kind === "module" ? fallback.invalidInitial : undefined;
  return (
    <SuiteFrame className="sx-login">
      <MobileDemoBanner simulator={false} />
      <DesktopDemoBanner simulator={false} />
      <main id="fx-main" className="sx-login-main" tabIndex={-1}>
        <AccessNotice />
        <div className="sx-login-card">
          <div className="sx-login-brand">
            <span className="fx-brand-mark" aria-hidden="true">
              CS
            </span>
            <span>Casa de Salvación · CDS Suite</span>
          </div>
          <h1 className="fx-h1">Ingresar a la vista previa</h1>
          <p className="fx-subtitle">
            Elige con qué perfil quieres entrar. En CDS real cada persona entra con su propia cuenta y llega directo a su
            módulo.
          </p>
          <ul className="sx-login-list">
            {profiles.map((p) => {
              const landing = resolveInitialModule(p);
              const content = (
                <>
                  <span className="sx-sim-avatar" aria-hidden="true">
                    {initialsOf(p)}
                  </span>
                  <span className="sx-login-text">
                    <span className="sx-login-name">{profileTitle(p, suite.state.areas)}</span>
                    <span className="sx-login-enters">{entersLabel(p)}</span>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </>
              );
              return (
                <li key={p.uid}>
                  {landing.kind === "module" ? (
                    <Link
                      href={withProfile(landing.href, p.uid)}
                      className="sx-login-row"
                      onClick={(e) => {
                        e.preventDefault();
                        suite.switchProfile(p.uid);
                      }}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="sx-login-row"
                      onClick={() => {
                        suite.switchProfile(p.uid);
                        setInPlace(landing.kind);
                      }}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {fallbackInitial && (
            <p className="sx-login-foot">* Su módulo inicial ({INITIAL_MODULE_LABEL[fallbackInitial]}) ya no está permitido.</p>
          )}
        </div>
      </main>
    </SuiteFrame>
  );
}
