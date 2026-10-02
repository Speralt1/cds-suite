import type { Metadata } from "next";
import { HoyScreen } from "@/components/finance-preview/screens/hoy";

export const metadata: Metadata = { title: "Hoy · Vista previa Finanzas 2026" };

export default function Page() {
  return <HoyScreen />;
}
