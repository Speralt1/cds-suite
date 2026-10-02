import type { Metadata } from "next";
import { MembersSettingsScreen } from "@/components/suite-preview/members/settings";

export const metadata: Metadata = { title: "Ajustes de Consolidación · Vista previa CDS Suite" };

export default function Page() {
  return <MembersSettingsScreen />;
}
