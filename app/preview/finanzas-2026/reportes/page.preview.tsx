import type { Metadata } from "next";
import { ClientRedirect } from "@/components/suite-preview/redirect";

// R5: los reportes financieros viven en el módulo global Reportes.
export const metadata: Metadata = { title: "Reportes · Vista previa CDS Suite" };

export default function Page() {
  return <ClientRedirect to="/preview/reportes/finanzas" />;
}
