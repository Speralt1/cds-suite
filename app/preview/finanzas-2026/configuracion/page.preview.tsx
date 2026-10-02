import type { Metadata } from "next";
import { ConfiguracionScreen } from "@/components/finance-preview/screens/analisis";

export const metadata: Metadata = { title: "Configuración · Vista previa Finanzas 2026" };

export default function Page() {
  return <ConfiguracionScreen />;
}
