import type { Metadata } from "next";
import { AtencionScreen } from "@/components/finance-preview/screens/operacion";

export const metadata: Metadata = { title: "Atención · Vista previa Finanzas 2026" };

export default function Page() {
  return <AtencionScreen />;
}
