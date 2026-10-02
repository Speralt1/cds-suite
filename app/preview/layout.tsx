import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SuiteProvider } from "@/components/suite-preview/provider";
import { AccessGate } from "@/components/suite-preview/access-gate";
import "@/components/finance-preview/finance-preview.css";
import "@/components/suite-preview/suite-preview.css";
import "@/components/suite-preview/calendar/calendar.css";
import "@/components/suite-preview/members/members.css";
import "@/components/suite-preview/settings/settings.css";

// Preview CDS Suite (Finanzas V2 + Calendario + Integrantes) · SOLO datos de demostración.
// Barrera 1: las páginas usan `.preview.tsx`, que solo se compila en `next dev` o
// con CDS_FINANCE_PREVIEW=1 (ver next.config.ts). Barrera 2: este gate.
// Barrera 3: scripts/check-no-preview.mjs (sentinels FX + SX) antes de cada deploy.
// Vive fuera de app/(private): no monta AuthGuard ni AccessProvider y no lee ni
// escribe Firestore. El perfil simulado, el store en memoria y los toasts viven
// en SuiteProvider; AccessGate aplica los permisos simulados a cada ruta.

export const metadata: Metadata = {
  title: "Vista previa CDS Suite",
  robots: { index: false, follow: false },
};

export default function SuitePreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.CDS_FINANCE_PREVIEW !== "1") {
    notFound();
  }
  return (
    <SuiteProvider>
      <AccessGate>{children}</AccessGate>
    </SuiteProvider>
  );
}
