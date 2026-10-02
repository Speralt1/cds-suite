import type { Metadata } from "next";
import { ReportesScreen } from "@/components/finance-preview/screens/analisis";

// Contenido de Financial UX V2, ahora dentro del módulo global (R5).
export const metadata: Metadata = { title: "Reportes financieros · Vista previa CDS Suite" };

export default function Page() {
  return <ReportesScreen />;
}
