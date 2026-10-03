"use client";

import { CalendarDays, ListChecks, Share2 } from "lucide-react";
import { useAccessModel } from "@/lib/access/model";
import { showsMyActivities } from "@/lib/calendar/calendar";
import { ModuleSubnav, type ModuleSubnavItem } from "@/components/layout/module-subnav";
import "@/components/calendar/calendar.css";

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  const access = useAccessModel();
  const items: ModuleSubnavItem[] = [{ href: "/calendario", label: "Calendario", icon: CalendarDays }];
  // "Mis actividades": con áreas asignadas aunque solo se lea (18 §11.7), y con
  // gestión de sus áreas aunque aún no tenga ninguna (ve "Aún no tienes áreas").
  if (showsMyActivities(access)) items.push({ href: "/calendario/mis-actividades", label: "Mis actividades", icon: ListChecks });
  if (access.can("calendar.events.manage_all")) items.push({ href: "/calendario/compartir", label: "Compartir", icon: Share2 });
  return (
    <div className="cds-calendar">
      <h1 className="mb-3 text-xl font-semibold">Calendario</h1>
      <ModuleSubnav label="Calendario" items={items} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
