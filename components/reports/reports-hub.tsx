"use client";

// Hub de Reportes (18 §10 R2, 18a §F): "Calendario" (calendar.read) y la
// tarjeta "Reportes financieros" → /finanzas/reportes (solo con
// finance.details.read). Los reportes financieros no se mueven ni cambian.

import Link from "next/link";
import { CalendarDays, ChevronRight, Landmark, type LucideIcon } from "lucide-react";
import { useAccessModel } from "@/lib/access/model";

interface HubCard {
  href: string;
  title: string;
  body: string;
  icon: LucideIcon;
}

export const CALENDAR_REPORT_CARD: HubCard = {
  href: "/reportes/calendario",
  title: "Calendario",
  body: "Actividades por período, área, estado y visibilidad. Descárgalo en PDF.",
  icon: CalendarDays,
};

export const FINANCE_REPORT_CARD: HubCard = {
  href: "/finanzas/reportes",
  title: "Reportes financieros",
  body: "Resumen financiero del período, gráficos y alertas, con su PDF.",
  icon: Landmark,
};

export function reportHubCards(can: (p: "calendar.read" | "finance.details.read") => boolean): HubCard[] {
  return [
    ...(can("calendar.read") ? [CALENDAR_REPORT_CARD] : []),
    ...(can("finance.details.read") ? [FINANCE_REPORT_CARD] : []),
  ];
}

export function ReportsHub() {
  const access = useAccessModel();
  const cards = reportHubCards((p) => access.can(p));
  return (
    <div className="cal-rep-hub">
      <header className="finance-page-header">
        <div className="finance-page-title">
          <h2>Reportes disponibles</h2>
          <p>Elige el reporte que necesitas.</p>
        </div>
      </header>
      {cards.length ? (
        <ul className="cal-rep-hub-grid">
          {cards.map(({ href, title, body, icon: Icon }) => (
            <li key={href}>
              <Link href={href} className="cal-rep-hub-card">
                <span className="cal-rep-hub-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className="cal-rep-hub-text">
                  <span className="cal-rep-hub-title">{title}</span>
                  <span className="cal-rep-hub-body">{body}</span>
                </span>
                <ChevronRight size={18} className="cal-rep-hub-chevron" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel empty">
          <h3>No tienes reportes disponibles</h3>
          <p>Pide al administrador que te asigne acceso al calendario o a los reportes financieros.</p>
        </div>
      )}
    </div>
  );
}
