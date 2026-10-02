import type { Metadata } from "next";
import { PublicCalendarScreen } from "@/components/suite-preview/calendar/public-adapter";

// Calendario público (sin shell, sin perfil). El adaptador entrega a
// components/suite-preview/public/** SOLO la proyección pública (resolvePublicCalendar).
export const metadata: Metadata = {
  title: "Calendario · Casa de Salvación",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page() {
  return <PublicCalendarScreen />;
}
