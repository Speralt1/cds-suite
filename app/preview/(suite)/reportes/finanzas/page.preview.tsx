import type { Metadata } from "next";
import { FinanceReport } from "@/components/suite-preview/reports/finance-report";

// Contenido de Financial UX V2, ahora dentro del módulo global (R5).
export const metadata: Metadata = { title: "Reportes financieros · Vista previa CDS Suite" };

export default function Page() {
  return <FinanceReport />;
}
