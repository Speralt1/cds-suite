"use client";

// Banner de demostración + simulador "Ver como" (16b §3.5). El simulador es una
// herramienta de la PREVIEW: vive solo en el banner gris (borde dashed), nunca
// en la sidebar ni en la top bar. Sin SuiteProvider no se muestra.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, FlaskConical, UserRoundCog } from "lucide-react";
import { INITIAL_MODULE_LABEL, landingLabel, resolveInitialModule } from "@/lib/suite-preview/access";
import { DEMO_PROFILES, initialsOf, profileTitle, simulatorLabel } from "@/lib/suite-preview/fixtures";
import type { AccessProfile } from "@/lib/suite-preview/types";
import { Sheet } from "@/components/finance-preview/ui";
import { useSuiteOptional } from "./provider";

/** Perfiles demo en el orden del ingreso (con el estado vivo del store). */
export function useDemoProfiles(): AccessProfile[] {
  const suite = useSuiteOptional();
  const users = suite?.state.users ?? [];
  return DEMO_PROFILES.map((d) => users.find((u) => u.uid === d.slug)).filter((u): u is AccessProfile => !!u);
}

/** "Entra a Calendario*" (con * si su módulo inicial ya no está permitido). */
export function entersLabel(p: AccessProfile): string {
  const landing = resolveInitialModule(p);
  return `${landingLabel(landing)}${landing.kind === "module" && landing.invalidInitial ? "*" : ""}`;
}

function ProfileRows({ onPick }: { onPick: () => void }) {
  const suite = useSuiteOptional();
  const profiles = useDemoProfiles();
  if (!suite) return null;
  return (
    <ul className="sx-sim-list">
      {profiles.map((p) => {
        const current = p.uid === suite.profileId;
        return (
          <li key={p.uid}>
            <button
              type="button"
              className="sx-sim-row"
              aria-current={current ? "true" : undefined}
              onClick={() => {
                onPick();
                suite.switchProfile(p.uid);
              }}
            >
              <span className="sx-sim-avatar" aria-hidden="true">
                {initialsOf(p)}
              </span>
              <span className="sx-sim-text">
                <span className="sx-sim-name">{profileTitle(p, suite.state.areas)}</span>
                <span className="sx-sim-enters">{entersLabel(p)}</span>
              </span>
              {current ? <Check size={16} aria-label="Perfil actual" /> : <ChevronRight size={16} aria-hidden="true" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "* Su módulo inicial (Finanzas) ya no está permitido." si algún perfil lleva asterisco. */
function FallbackNote() {
  const profiles = useDemoProfiles();
  const fallback = profiles.map(resolveInitialModule).find((l) => l.kind === "module" && l.invalidInitial);
  if (fallback?.kind !== "module" || !fallback.invalidInitial) return null;
  return <p className="sx-sim-note">* Su módulo inicial ({INITIAL_MODULE_LABEL[fallback.invalidInitial]}) ya no está permitido.</p>;
}

function SimulatorFooter({ onPick }: { onPick: () => void }) {
  return (
    <p className="sx-sim-foot">
      Herramienta de la vista previa. Cambia el perfil para ver cómo cambia la navegación.{" "}
      <Link href="/preview" className="fx-link" onClick={onPick}>
        Volver a la pantalla de ingreso
      </Link>
    </p>
  );
}

const SHORT_BY_UID: Record<string, string> = { "sin-permisos": "Sin acceso" };
const SHORT_BY_CARGO: Record<string, string> = { Administración: "Admin", Consolidación: "Consolid." };

/**
 * Etiqueta corta (nunca vacía) del simulador bajo 400 px: "Admin", "Líder",
 * "Consolid."… Si no hay cargo, las iniciales.
 */
export function shortSimulatorLabel(p: AccessProfile | null): string {
  if (!p) return "Perfil no válido";
  const cargo = p.cargo.trim();
  return SHORT_BY_UID[p.uid] ?? SHORT_BY_CARGO[cargo] ?? (cargo || initialsOf(p));
}

/** Botón "Ver como: {cargo} · {nombre}" con popover (desktop) o bottom sheet (móvil). */
export function ProfileSimulator({ variant }: { variant: "desktop" | "mobile" }) {
  const suite = useSuiteOptional();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || variant !== "desktop") return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, variant]);
  if (!suite) return null;
  const label = suite.profile ? simulatorLabel(suite.profile) : "Perfil no válido";
  // Bajo 400 px el móvil muestra solo una etiqueta corta ("Ver como: Líder",
  // "Ver como: Admin"); el nombre accesible completo va en aria-label.
  const short = shortSimulatorLabel(suite.profile);
  const id = `sx-sim-${variant}`;
  const close = () => setOpen(false);
  return (
    <div className="sx-sim" ref={ref}>
      <button
        type="button"
        className="sx-sim-trigger"
        aria-label={`Ver como: ${label}`}
        aria-expanded={open}
        aria-controls={variant === "desktop" ? id : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <UserRoundCog size={14} aria-hidden="true" />
        <span className="sx-sim-label">
          Ver como: <span className="sx-sim-who">{label}</span>
          {variant === "mobile" && <span className="sx-sim-who-short">{short}</span>}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {variant === "desktop" && open && (
        <div className="sx-sim-popover" id={id} role="dialog" aria-label="Ver como (vista previa)">
          <p className="sx-sim-title">Ver como (vista previa)</p>
          <ProfileRows onPick={close} />
          <FallbackNote />
          <SimulatorFooter onPick={close} />
        </div>
      )}
      {variant === "mobile" && (
        <Sheet open={open} onClose={close} title="Ver como (vista previa)" labelId="sx-sim-sheet-title">
          <ProfileRows onPick={close} />
          <FallbackNote />
          <SimulatorFooter onPick={close} />
        </Sheet>
      )}
    </div>
  );
}

/**
 * Banners de demostración. El de móvil va primero en el DOM: su `role="note"`
 * es el primer note de la página y contiene "Vista previa · datos de demostración".
 */
export function MobileDemoBanner({ simulator = true }: { simulator?: boolean }) {
  return (
    <div className="fx-banner-mobile sx-banner-mobile">
      <p role="note" className="sx-banner-note">
        <FlaskConical size={13} aria-hidden="true" /> Vista previa<span className="fx-sr"> · datos de demostración</span>
      </p>
      {simulator && <ProfileSimulator variant="mobile" />}
    </div>
  );
}

export function DesktopDemoBanner({ simulator = true }: { simulator?: boolean }) {
  return (
    <div className="fx-banner sx-banner">
      <p role="note" className="sx-banner-note">
        <FlaskConical size={14} aria-hidden="true" />
        <span>
          <strong>Vista previa · datos de demostración.</strong> Nada de lo que hagas aquí se guarda.
        </span>
      </p>
      {simulator && <ProfileSimulator variant="desktop" />}
    </div>
  );
}
