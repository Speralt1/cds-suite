import type { Metadata } from "next";
import { CajaScreen } from "@/components/finance-preview/screens/operacion";

export const metadata: Metadata = { title: "Caja · Vista previa Finanzas 2026" };

export default function Page() {
  return <CajaScreen />;
}
