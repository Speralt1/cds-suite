import type { Metadata } from "next";
import { SectionRedirect } from "@/components/suite-preview/redirect";

// Reportes: el índice lleva a la primera sección permitida.
export const metadata: Metadata = { title: "Reportes · Vista previa CDS Suite" };

export default function Page() {
  return <SectionRedirect module="reportes" />;
}
