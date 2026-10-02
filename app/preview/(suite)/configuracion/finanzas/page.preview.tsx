import type { Metadata } from "next";
import { ConfiguracionScreen } from "@/components/finance-preview/screens/analisis";

// Contenido de Financial UX V2, ahora dentro del módulo global (R5).
export const metadata: Metadata = { title: "Finanzas e integraciones · Vista previa CDS Suite" };

export default function Page() {
  return <ConfiguracionScreen />;
}
