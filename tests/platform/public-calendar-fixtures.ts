// Fixtures ficticias de la proyección pública (compartidas por los tests de
// lib/shared y de la Function calendarPublicFeed). Cada dato interno lleva un
// canario que NUNCA debe aparecer en la salida pública.
import type { Area, CalendarEvent } from "@/lib/shared/types";

export const CANARIES = {
  internalNotes: "CANARIO_NOTA_INTERNA_7f3a",
  cancelReason: "CANARIO_MOTIVO_CANCELACION_19bd",
  archiveReason: "CANARIO_MOTIVO_ARCHIVO_44e0",
  exceptionReason: "CANARIO_MOTIVO_EXCEPCION_a1c2",
  seriesReason: "CANARIO_MOTIVO_SERIE_d9e8",
  uid: "uid-canario-c0ffee",
  extra: "CANARIO_CAMPO_EXTRA_beef",
  email: "canario.privado@cds.test",
  internalTitle: "CANARIO_TITULO_INTERNO_55aa",
  archivedTitle: "CANARIO_TITULO_ARCHIVADO_66bb",
} as const;

export const TODAY = "2026-10-04";
export const NOW = "2026-10-04T12:00";

export const AREAS: Area[] = [
  { id: "jovenes", name: "Jóvenes", color: "azul", active: true, description: CANARIES.internalNotes },
  { id: "alabanza", name: "Alabanza", color: "verde", active: true },
  { id: "intercesion", name: "Intercesión", color: "indigo", active: true },
  { id: "matrimonios", name: "Matrimonios", color: "frambuesa", active: true },
  { id: "antigua", name: "Área antigua", color: "cafe", active: false },
];

export function event(over: Partial<CalendarEvent> & Record<string, unknown>): CalendarEvent {
  return {
    id: "ev",
    title: "Actividad",
    responsibleAreaId: "jovenes",
    participantAreaIds: [],
    startDate: "2026-10-10",
    endDate: "2026-10-10",
    allDay: false,
    startTime: "19:00",
    endTime: "21:00",
    location: "Templo",
    publicDescription: "Descripción pública",
    internalNotes: CANARIES.internalNotes,
    visibility: "public",
    status: "scheduled",
    recurrence: { freq: "none" },
    exceptions: [],
    lastDate: "2026-10-10",
    revision: 3,
    lastChangeId: "r3",
    createdBy: CANARIES.uid,
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedBy: CANARIES.uid,
    updatedAt: { seconds: 2, nanoseconds: 0 },
    ...over,
  } as CalendarEvent;
}

export const EVENTS: CalendarEvent[] = [
  event({
    id: "ev-culto",
    title: "Culto dominical",
    responsibleAreaId: "alabanza",
    participantAreaIds: ["jovenes", "antigua", "no-existe"],
    startDate: "2026-09-06",
    endDate: "2026-09-06",
    startTime: "11:00",
    endTime: "13:00",
    recurrence: { freq: "weekly", until: "2027-02-28" },
    lastDate: "2027-02-28",
    exceptions: [{ date: "2026-10-18", type: "cancelled", reason: CANARIES.exceptionReason, by: CANARIES.uid }],
  }),
  event({
    id: "ev-escuela",
    title: "Escuela dominical",
    responsibleAreaId: "intercesion",
    startDate: "2026-10-04",
    endDate: "2026-10-04",
    startTime: "10:00",
    endTime: "11:00",
    location: "",
    publicDescription: "",
  }),
  event({
    id: "ev-interno",
    title: CANARIES.internalTitle,
    responsibleAreaId: "matrimonios",
    visibility: "internal",
  }),
  event({
    id: "ev-archivado",
    title: CANARIES.archivedTitle,
    status: "archived",
    archiveReason: CANARIES.archiveReason,
    archivedAt: { seconds: 3 },
  }),
  event({
    id: "ev-evangelismo",
    title: "Evangelismo en la plaza",
    startDate: "2026-10-24",
    endDate: "2026-10-24",
    status: "cancelled",
    cancelReason: CANARIES.cancelReason,
  }),
  event({
    id: "ev-oracion",
    title: "Oración de los martes",
    responsibleAreaId: "intercesion",
    startDate: "2026-09-29",
    endDate: "2026-09-29",
    recurrence: { freq: "weekly", until: "2026-12-29" },
    lastDate: "2026-12-29",
    seriesCancellation: { from: "2026-10-13", reason: CANARIES.seriesReason, by: CANARIES.uid, at: { seconds: 4 } },
  }),
  event({
    id: "ev-vigilia",
    title: "Vigilia",
    responsibleAreaId: "intercesion",
    startDate: "2026-10-30",
    endDate: "2026-10-31",
    startTime: "22:00",
    endTime: "02:00",
    recurrence: { freq: "monthly", until: "2027-02-26", monthly: { mode: "nth_weekday", weekday: 5, ordinal: -1 } },
    lastDate: "2027-02-27",
    secretField: CANARIES.extra,
    email: CANARIES.email,
    permissions: ["settings.manage"],
  }),
  event({ id: "ev-lejano", title: "Fuera de rango", startDate: "2027-06-01", endDate: "2027-06-01", lastDate: "2027-06-01" }),
  event({ id: "ev-pasado", title: "Muy antiguo", startDate: "2026-07-01", endDate: "2026-07-01", lastDate: "2026-07-01" }),
  event({ id: "ev-roto", title: "Fecha rota", startDate: "2026-02-31", endDate: "2026-02-31", lastDate: "2026-02-31" }),
];

