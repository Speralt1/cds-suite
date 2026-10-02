import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/suite-preview/placeholders";

export const metadata: Metadata = { title: "Áreas · Vista previa CDS Suite" };

export default function Page() {
  return <ModulePlaceholder title="Áreas" subtitle="Áreas de la iglesia y su color." />;
}
