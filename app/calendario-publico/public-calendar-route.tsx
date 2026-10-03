"use client";

// Contenedor de la página pública: lee el enlace del fragmento (#) en un efecto
// (nunca durante el prerender), lo valida ANTES de pedir datos y entrega a
// components/public-calendar SOLO la proyección pública. El token vive solo en
// memoria (ref): no se guarda en localStorage, sessionStorage ni cookies.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchPublicCalendar, shareTokenFromLocation } from "@/lib/calendar/public-feed-client";
import { localToday } from "@/lib/shared/dates";
import { isWellFormedShareToken } from "@/lib/shared/share-token-format";
import type { PublicCalendar } from "@/lib/shared/types";
import { buildPublicModel, type PublicStatus } from "@/components/public-calendar/model";
import { PublicCalendarView } from "@/components/public-calendar/public-calendar";

type State = { status: Exclude<PublicStatus, "ready"> } | { status: "ready"; calendar: PublicCalendar; today: string };

export function PublicCalendarRoute() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const token = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (attempt === 0) token.current = shareTokenFromLocation(window.location);
    const t = token.current;
    if (!isWellFormedShareToken(t)) {
      setState({ status: "unavailable" });
      return;
    }
    setState({ status: "loading" });
    fetchPublicCalendar(t)
      .then((result) => {
        if (!alive) return;
        if (result === "unavailable") setState({ status: "unavailable" });
        else setState({ status: "ready", calendar: result, today: localToday(Date.now()) });
      })
      .catch(() => {
        if (alive) setState({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  // Otro enlace pegado en la misma pestaña cambia solo el fragmento (sin recarga).
  useEffect(() => {
    const onHashChange = () => {
      token.current = shareTokenFromLocation(window.location);
      setAttempt((n) => n + 1);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const model = useMemo(
    () => (state.status === "ready" ? buildPublicModel(state.calendar, state.today) : null),
    [state],
  );

  return <PublicCalendarView status={state.status} model={model} onRetry={retry} />;
}
