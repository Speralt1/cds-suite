import type { Metadata } from "next";
import { ShareScreen } from "@/components/suite-preview/calendar/share-screen";

export const metadata: Metadata = { title: "Compartir calendario · Vista previa CDS Suite" };

export default function Page() {
  return <ShareScreen />;
}
