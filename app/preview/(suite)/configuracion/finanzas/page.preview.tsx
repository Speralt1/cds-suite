import type { Metadata } from "next";
import { ConfiguracionScreen } from "@/components/finance-preview/screens/analisis";

// Contenido de Financial UX V2, ahora dentro del módulo global (R5). Los usuarios
// se gestionan en Configuración › Usuarios y permisos (variante "suite").
export const metadata: Metadata = { title: "Ajustes de finanzas · Vista previa CDS Suite" };

export default function Page() {
  return <ConfiguracionScreen variant="suite" />;
}
