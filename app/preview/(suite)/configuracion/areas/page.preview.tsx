import type { Metadata } from "next";
import { AreasScreen } from "@/components/suite-preview/settings/areas-screen";

export const metadata: Metadata = { title: "Áreas · Vista previa CDS Suite" };

export default function Page() {
  return <AreasScreen />;
}
