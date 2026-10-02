// Modelo de presentación del calendario público. Lo arma el adaptador de
// components/suite-preview/calendar/public-adapter.tsx A PARTIR DE LA PROYECCIÓN
// PÚBLICA (resolvePublicCalendar): nunca recibe actividades internas.
// public/** solo importa types, sentinel, finance-preview/format, react y lucide.

import type { PublicArea, PublicEvent, Ymd } from "@/lib/suite-preview/types";

export interface PublicDayInfo {
  /** "domingo 4 de octubre" */
  label: string;
  isToday: boolean;
  isTomorrow: boolean;
}

export interface PublicMonthCell {
  date: Ymd;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

export interface PublicMonth {
  /** "2026-10" */
  key: string;
  /** "Octubre 2026" */
  title: string;
  /** "octubre" */
  name: string;
  first: Ymd;
  last: Ymd;
  weeks: PublicMonthCell[][];
}

export interface PublicEventView {
  event: PublicEvent;
  /** "viernes 9 de octubre · 20:00 – 22:00" */
  when: string;
  /** aria-label completo de la fila. */
  aria: string;
  /** Fechas que ocupa (varios días / medianoche). */
  spans: Ymd[];
}

export interface PublicCalendarModel {
  churchName: string;
  areas: PublicArea[];
  events: PublicEventView[];
  months: PublicMonth[];
  days: Record<Ymd, PublicDayInfo>;
  today: Ymd;
  initialMonth: number;
}

export type PublicStatus = "loading" | "error" | "unavailable" | "ready";
