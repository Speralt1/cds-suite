import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Usuarios y permisos · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Usuarios y permisos" subtitle="Cargo, permisos, áreas y módulo inicial." />;
}
