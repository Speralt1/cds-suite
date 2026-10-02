"use client";

// Segmented [Finanzas | Calendario] de Reportes (16b §7.1). Solo se muestra
// cuando el perfil puede ver ambas secciones.

import Link from "next/link";
import { useSuite } from "../provider";

export type ReportSection = "finanzas" | "calendario";

/** ¿El perfil efectivo ve ambas secciones de Reportes? */
export function useBothReportSections(): boolean {
  const { eff } = useSuite();
  return eff.has("finance.details.read") && eff.has("calendar.read");
}

export function ReportSections({ current }: { current: ReportSection }) {
  const { hrefFor } = useSuite();
  const both = useBothReportSections();
  if (!both) return null;
  return (
    <nav className="fx-segmented sx-rep-sections" aria-label="Secciones de Reportes">
      <Link href={hrefFor("/preview/reportes/finanzas")} aria-current={current === "finanzas" ? "page" : undefined}>
        Finanzas
      </Link>
      <Link href={hrefFor("/preview/reportes/calendario")} aria-current={current === "calendario" ? "page" : undefined}>
        Calendario
      </Link>
    </nav>
  );
}
