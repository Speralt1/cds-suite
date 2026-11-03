"use client";

import dynamic from "next/dynamic";
import { CalendarHeart } from "lucide-react";
import { OUTREACH_LIVE_BUNDLED, OUTREACH_SIM } from "@/lib/outreach/features";

// La simulación se carga aparte y solo existe en desarrollo con la variable
// encendida; la build productiva muestra únicamente el aviso de abajo.
const SimWorkspace = OUTREACH_SIM ? dynamic(() => import("@/components/outreach/sim-workspace"), { ssr: false }) : null;

// El espacio en vivo (datos reales) solo con el submódulo habilitado o la variable LIVE (emulador).
const LiveWorkspace =
  OUTREACH_LIVE_BUNDLED ? dynamic(() => import("@/components/outreach/live/live-workspace"), { ssr: false }) : null;

export default function OutreachPage() {
  if (SimWorkspace) return <SimWorkspace />;
  if (LiveWorkspace) return <LiveWorkspace />;
  return (
    <section className="cal-empty" aria-labelledby="vplt-pending-title">
      <CalendarHeart size={28} aria-hidden="true" />
      <h2 id="vplt-pending-title">Ve por los tuyos está en preparación</h2>
      <p>
        El submódulo del evento anual todavía no está habilitado. Las inscripciones siguen en el sitio del evento y el
        seguimiento habitual continúa en Consolidación.
      </p>
    </section>
  );
}
