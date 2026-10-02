import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Ajustes de alertas · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Ajustes de alertas" subtitle="Parámetros de las alertas (solo lectura)." />;
}
