import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Reporte de calendario · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Reporte de calendario" subtitle="Actividades por período, área y estado." />;
}
