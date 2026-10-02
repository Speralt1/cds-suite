import type { Metadata } from "next";
import { ConsolidationDashboardScreen } from "@/components/suite-preview/members/dashboard";

export const metadata: Metadata = { title: "Consolidación · Vista previa CDS Suite" };

export default function Page() {
  return <ConsolidationDashboardScreen />;
}
