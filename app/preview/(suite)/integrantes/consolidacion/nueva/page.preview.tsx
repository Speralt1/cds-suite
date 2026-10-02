import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Nueva persona · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Nueva persona" subtitle="Registro de una persona nueva." />;
}
