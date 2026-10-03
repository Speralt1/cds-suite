"use client";

// "Hoy" y "ahora" en hora de pared de America/Santiago (Intl), sin mostrar el
// identificador en la UI. Se actualiza cada 30 s para que "Realizada" y el
// límite de lo editable avancen solos.

import { useSyncExternalStore } from "react";
import { localNow } from "@/lib/shared/dates";
import type { LocalDateTime, Ymd } from "@/lib/shared/types";

const TICK_MS = 30_000;

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
}

function snapshot(): LocalDateTime {
  return localNow(Date.now());
}

export function useSantiagoNow(): { today: Ymd; now: LocalDateTime } {
  const now = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { today: now.slice(0, 10), now };
}
