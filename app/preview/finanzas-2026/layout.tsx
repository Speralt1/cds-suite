import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FinancialShell } from "@/components/finance-preview/shell";
import "@/components/finance-preview/finance-preview.css";

// Preview Financial UX 2026 · SOLO datos de demostración.
// Barrera 1: la extensión `.preview.tsx` solo se compila en `next dev` o con
// CDS_FINANCE_PREVIEW=1 (ver next.config.ts). Barrera 2: este gate.
// Esta ruta vive fuera de app/(private): no monta AuthGuard ni AccessProvider
// y no lee ni escribe Firestore.

export const metadata: Metadata = {
  title: "Vista previa Finanzas 2026",
  robots: { index: false, follow: false },
};

export default function FinancePreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CDS_FINANCE_PREVIEW !== "1"
  ) {
    notFound();
  }
  return <FinancialShell>{children}</FinancialShell>;
}
