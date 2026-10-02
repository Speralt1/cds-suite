import type { Metadata } from "next";
import { ConciliacionScreen } from "@/components/finance-preview/screens/operacion";

export const metadata: Metadata = { title: "Conciliación · Vista previa Finanzas 2026" };

export default function Page() {
  return <ConciliacionScreen />;
}
