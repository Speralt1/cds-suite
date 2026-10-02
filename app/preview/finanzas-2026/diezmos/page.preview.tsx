import type { Metadata } from "next";
import { DiezmosScreen } from "@/components/finance-preview/screens/fuentes";

export const metadata: Metadata = { title: "Diezmos · Vista previa Finanzas 2026" };

export default function Page() {
  return <DiezmosScreen />;
}
