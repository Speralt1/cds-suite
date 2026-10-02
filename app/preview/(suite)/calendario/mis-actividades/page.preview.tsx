import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Mis actividades · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Mis actividades" subtitle="Actividades de tus áreas." />;
}
