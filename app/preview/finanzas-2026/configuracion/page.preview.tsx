import type { Metadata } from "next";
import { ClientRedirect } from "@/components/suite-preview/redirect";

// R5: la configuración financiera vive en el módulo global Configuración.
export const metadata: Metadata = { title: "Configuración · Vista previa CDS Suite" };

export default function Page() {
  return <ClientRedirect to="/preview/configuracion/finanzas" />;
}
