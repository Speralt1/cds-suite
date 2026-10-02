import type { Metadata } from "next";
import { ReportesScreen } from "@/components/finance-preview/screens/analisis";

export const metadata: Metadata = { title: "Reportes · Vista previa Finanzas 2026" };

export default function Page() {
  return <ReportesScreen />;
}
