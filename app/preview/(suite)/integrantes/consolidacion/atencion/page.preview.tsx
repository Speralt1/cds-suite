import type { Metadata } from "next";
import { AttentionScreen } from "@/components/suite-preview/members/attention";

export const metadata: Metadata = { title: "Necesitan atención · Vista previa CDS Suite" };

export default function Page() {
  return <AttentionScreen />;
}
