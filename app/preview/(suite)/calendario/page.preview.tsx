import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Calendario · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Calendario" subtitle="Actividades de todas las áreas de la iglesia." />;
}
