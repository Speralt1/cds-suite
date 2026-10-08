"use client";

// /configuracion/areas: panel de Áreas con el uso real de las actividades
// próximas (no archivadas, que terminan hoy o después en hora de Chile).

import { useMemo } from "react";
import { areaUsage } from "@/lib/calendar/areas";
import { useAreas } from "@/lib/calendar/areas-client";
import { useCalendarEvents } from "@/lib/calendar/events-client";
import { useSantiagoNow } from "@/lib/calendar/use-now";
import { AreasPanel, type AreaUsageMap } from "./areas-panel";

export function AreasSettingsPage() {
  const { today } = useSantiagoNow();
  const { events, loading, error } = useCalendarEvents(today);
  const { areas } = useAreas();
  const usage = useMemo<AreaUsageMap | null>(() => {
    if (loading || error) return null;
    return new Map(areas.map((area) => [area.id, areaUsage(area.id, events)]));
  }, [areas, events, loading, error]);
  return <AreasPanel usage={usage} />;
}
