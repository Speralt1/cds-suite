"use client";

// Datos comunes de las pantallas del Calendario: acceso (actor), áreas, uid,
// hoy/ahora en Santiago, conexión y confirmaciones (toast del shell).

import { useAccessModel } from "@/lib/access/model";
import { useAuth } from "@/lib/auth/auth-provider";
import { useOnlineStatus } from "@/lib/browser/online";
import { useAreas } from "@/lib/calendar/areas-client";
import type { CalendarActor } from "@/lib/calendar/calendar";
import { useSantiagoNow } from "@/lib/calendar/use-now";
import type { Area, LocalDateTime, Ymd } from "@/lib/shared/types";
import { useToast } from "@/components/layout/notice";

export interface CalendarBase {
  actor: CalendarActor;
  areas: Area[];
  areasLoading: boolean;
  areasError: string;
  uid: string | null;
  today: Ymd;
  now: LocalDateTime;
  offline: boolean;
  toast: (message: string) => void;
}

export function useCalendarBase(): CalendarBase {
  const actor = useAccessModel();
  const { areas, loading, error } = useAreas();
  const { user } = useAuth();
  const { today, now } = useSantiagoNow();
  const online = useOnlineStatus();
  const { toast } = useToast();
  return {
    actor,
    areas,
    areasLoading: loading,
    areasError: error,
    uid: user?.uid ?? null,
    today,
    now,
    offline: !online,
    toast,
  };
}
