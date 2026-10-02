import type { Metadata } from "next";
import { FinanceSummaryScreen } from "@/components/suite-preview/finance-summary";

export const metadata: Metadata = { title: "Resumen financiero · Vista previa CDS Suite" };

export default function Page() {
  return <FinanceSummaryScreen />;
}
