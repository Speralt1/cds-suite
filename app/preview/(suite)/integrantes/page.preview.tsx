import type { Metadata } from "next";
import { ClientRedirect } from "@/components/suite-preview/redirect";

// Integrantes: el índice lleva al primer submódulo (Consolidación).
export const metadata: Metadata = { title: "Integrantes · Vista previa CDS Suite" };

export default function Page() {
  return <ClientRedirect to="/preview/integrantes/consolidacion" />;
}
