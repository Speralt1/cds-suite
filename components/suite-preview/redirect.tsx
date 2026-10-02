"use client";

// Redirecciones cliente de la preview (export estático: no hay redirect de servidor).
// Navegan con replace y conservan `?perfil=`. La navegación la ejecuta AccessGate.

import Link from "next/link";
import { useEffect } from "react";
import { flatSections, moduleSections } from "@/lib/suite-preview/modules";
import type { ModuleId } from "@/lib/suite-preview/types";
import { useSuiteOptional } from "./provider";

function Redirecting({ to }: { to: string }) {
  return (
    <p className="fx-help" aria-live="off">
      Redirigiendo… <Link href={to} className="fx-link">Continuar</Link>
    </p>
  );
}

/** Redirige a `to` (ruta interna) al montarse. */
export function ClientRedirect({ to }: { to: string }) {
  const suite = useSuiteOptional();
  const navigate = suite?.navigate;
  const href = suite ? suite.hrefFor(to) : to;
  useEffect(() => {
    navigate?.(href);
  }, [navigate, href]);
  return <Redirecting to={href} />;
}

/** Redirige a la primera sección permitida del módulo para el perfil simulado. */
export function SectionRedirect({ module }: { module: ModuleId }) {
  const suite = useSuiteOptional();
  const first = suite?.profile ? flatSections(moduleSections(module, suite.profile)).find((s) => !s.shortcut) : undefined;
  if (!first) return null;
  return <ClientRedirect to={first.href} />;
}
