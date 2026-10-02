import type { Metadata } from "next";
import { ClientRedirect } from "@/components/suite-preview/redirect";

// Configuración: el índice lleva a Áreas.
export const metadata: Metadata = { title: "Configuración · Vista previa CDS Suite" };

export default function Page() {
  return <ClientRedirect to="/preview/configuracion/areas" />;
}
