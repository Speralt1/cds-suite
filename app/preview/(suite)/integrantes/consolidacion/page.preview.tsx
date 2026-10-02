import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Consolidación · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Consolidación" subtitle="Personas nuevas y su seguimiento." />;
}
