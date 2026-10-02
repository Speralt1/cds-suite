import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Personas · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Personas" subtitle="Lista de personas en consolidación." />;
}
