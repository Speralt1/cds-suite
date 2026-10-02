import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Necesitan atención · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Necesitan atención" subtitle="Personas con alertas, por prioridad." />;
}
