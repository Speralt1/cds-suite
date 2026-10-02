import type { Metadata } from "next";
import { OfrendasScreen } from "@/components/finance-preview/screens/fuentes";

export const metadata: Metadata = { title: "Ofrendas · Vista previa Finanzas 2026" };

export default function Page() {
  return <OfrendasScreen />;
}
