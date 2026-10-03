"use client";

// Guardia de rutas privadas (18a §F). Decide con `guardRoute` (puro):
// - allow → monta la ruta;
// - redirect → un único `router.replace` (ref anti-StrictMode) y, mientras
//   tanto, SessionLoading: la ruta prohibida nunca se monta (no arranca
//   listeners de Firestore). El aviso del deep link va a la región role="status";
// - no-modules → pantalla "Aún no tienes módulos asignados", sin redirect;
// - inactive → no monta nada (lo resuelve AccessProvider, sin cambios).
// La intención de aterrizaje se lee al llegar a cada ruta y se consume una vez.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOptionalAccess } from "@/lib/auth/access-provider";
import { consumeLandingIntent, peekLandingIntent } from "@/lib/access/landing-intent";
import { guardRoute, normalizePath } from "@/lib/access/routes";
import { SessionLoading } from "@/components/ui/session-loading";
import { NoModulesScreen } from "./no-modules";
import { useAccessNoticeControl } from "./notice";

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = normalizePath(usePathname());
  const router = useRouter();
  const access = useOptionalAccess();
  const { showAccessNotice } = useAccessNoticeControl();

  // Foto de la intención al llegar a esta ruta: estable entre re-renders
  // aunque el efecto ya la haya consumido.
  const [arrival, setArrival] = useState(() => ({ path: pathname, intent: peekLandingIntent() }));
  let current = arrival;
  if (arrival.path !== pathname) {
    current = { path: pathname, intent: peekLandingIntent() };
    setArrival(current);
  }

  const decision = guardRoute(access, pathname, current.intent);
  const to = decision.type === "redirect" ? decision.to : null;
  const notice = decision.type === "redirect" ? decision.notice : null;
  const redirected = useRef<string | null>(null);

  useEffect(() => {
    if (current.intent) consumeLandingIntent();
    if (!to) {
      redirected.current = null;
      return;
    }
    const key = `${pathname}->${to}`;
    if (redirected.current === key) return;
    redirected.current = key;
    if (notice) showAccessNotice(notice, to);
    router.replace(to);
  }, [current.intent, pathname, to, notice, router, showAccessNotice]);

  if (decision.type === "allow") return children;
  if (decision.type === "no-modules") return <NoModulesScreen />;
  return <SessionLoading />;
}
