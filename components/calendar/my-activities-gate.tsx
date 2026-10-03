"use client";

// Puerta de /calendario/mis-actividades: quien solo lee el calendario y no
// tiene áreas no tiene nada que ver aquí (la pestaña tampoco se le muestra).
// Igual que RouteGuard: un único `router.replace` al Calendario con el aviso
// "No tienes acceso a Mis actividades. Te llevamos a Calendario." en la región
// role="status" del shell, y la pantalla nunca se monta (no abre listeners).

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAccessModel } from "@/lib/access/model";
import { accessNoticeText } from "@/lib/access/routes";
import { myActivitiesRoute } from "@/lib/calendar/calendar";
import { useAccessNoticeControl } from "@/components/layout/notice";
import { MyActivitiesScreen } from "./my-activities";

export const MY_ACTIVITIES_REDIRECT_NOTICE = accessNoticeText("Mis actividades", "Calendario");

export function MyActivitiesGate() {
  const access = useAccessModel();
  const router = useRouter();
  const { showAccessNotice } = useAccessNoticeControl();
  const decision = myActivitiesRoute(access);
  const done = useRef(false);

  useEffect(() => {
    if (decision !== "redirect" || done.current) return;
    done.current = true;
    showAccessNotice(MY_ACTIVITIES_REDIRECT_NOTICE, "/calendario");
    router.replace("/calendario");
  }, [decision, router, showAccessNotice]);

  if (decision === "redirect") return <p className="cal-help-13">Te llevamos al Calendario…</p>;
  return <MyActivitiesScreen />;
}
