import type { Metadata } from "next";
import { PublicCalendarRoute } from "./public-calendar-route";
import "@/components/public-calendar/public-calendar.css";

// Página pública estática del calendario (18a §F): sin shell ni AccessProvider.
// El enlace compartido es /calendario-publico#<enlace> (doc 20 §5): el
// fragmento no llega al servidor. El HTML prerenderizado es solo el skeleton:
// los datos se piden en el navegador.
export const metadata: Metadata = {
  title: { absolute: "Calendario de actividades | Casa de Salvación" },
  description: "Calendario de actividades de Casa de Salvación.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PublicCalendarRoute />;
}
