import type { Metadata } from "next";
import { MovimientosScreen } from "@/components/finance-preview/screens/operacion";

export const metadata: Metadata = { title: "Movimientos · Vista previa Finanzas 2026" };

export default function Page() {
  return <MovimientosScreen />;
}
