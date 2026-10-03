import type { Metadata } from "next";
import { PublicCalendarRoute } from "./public-calendar-route";
import "@/components/public-calendar/public-calendar.css";

// Página pública estática del calendario (18a §F): sin shell ni AccessProvider.
// En Hosting, /calendario/compartir/<enlace> llega aquí por rewrite; en
// desarrollo se usa /calendario-publico?t=. El HTML prerenderizado es solo el
// skeleton: los datos se piden en el navegador.
export const metadata: Metadata = {
  title: { absolute: "Calendario de actividades | Casa de Salvación" },
  description: "Calendario de actividades de Casa de Salvación.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PublicCalendarRoute />;
}
