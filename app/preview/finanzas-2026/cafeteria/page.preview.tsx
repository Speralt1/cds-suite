import type { Metadata } from "next";
import { CafeteriaScreen } from "@/components/finance-preview/screens/fuentes";

export const metadata: Metadata = { title: "Cafetería · Vista previa Finanzas 2026" };

export default function Page() {
  return <CafeteriaScreen />;
}
