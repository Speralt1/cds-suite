import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Ficha de persona · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Ficha de persona" subtitle="Datos, visitas y seguimiento." />;
}
