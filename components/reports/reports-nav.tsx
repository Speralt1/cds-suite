"use client";

// Subnav del módulo Reportes (mismo estilo que Calendario y Configuración).
// Los reportes financieros siguen en /finanzas/reportes (18 §10 R2): se llega
// desde la tarjeta del hub.

import { ModuleSubnav, type ModuleSubnavItem } from "@/components/layout/module-subnav";
import { useAccessModel } from "@/lib/access/model";

export function reportsNavItems(canCalendar: boolean): ModuleSubnavItem[] {
  return [
    { href: "/reportes", label: "Todos los reportes" },
    ...(canCalendar ? [{ href: "/reportes/calendario", label: "Calendario" }] : []),
  ];
}

export function ReportsNav() {
  const access = useAccessModel();
  return <ModuleSubnav label="Reportes" items={reportsNavItems(access.can("calendar.read"))} />;
}
