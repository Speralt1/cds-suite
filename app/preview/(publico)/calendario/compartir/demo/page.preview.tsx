import type { Metadata } from "next";
import { PublicPlaceholder } from "@/components/suite-preview/placeholders";

// Calendario público (sin shell, sin perfil). Lo reemplaza el módulo Calendario
// con el adaptador que entrega SOLO la proyección pública (resolvePublicCalendar).
export const metadata: Metadata = {
  title: "Calendario · Casa de Salvación",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page() {
  return <PublicPlaceholder />;
}
