import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Compartir calendario · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Compartir calendario" subtitle="Enlace público del calendario." />;
}
