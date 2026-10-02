import type { Metadata } from "next";
import { CampanasScreen } from "@/components/finance-preview/screens/fuentes";

export const metadata: Metadata = { title: "Campañas · Vista previa Finanzas 2026" };

export default function Page() {
  return <CampanasScreen />;
}
