// DATOS DE DEMOSTRACIÓN de la preview de CDS Suite (Calendario + Integrantes).
// Nombres, teléfonos (+56 9 5555 01xx) y correos (@demo.invalid) son ficticios.
// Hoy demo: domingo 04-10-2026 13:30 (ver ./clock). Guía: 16a §J.

import { CARGO_PRESETS } from "./access";
import { DEMO_NOW, DEMO_TODAY } from "./clock";
import { DEFAULT_CONSOLIDATION_SETTINGS } from "./consolidation";
import type {
  AccessProfile,
  Area,
  CalendarEvent,
  FollowUp,
  Person,
  PersonChange,
  ShareLink,
  Visit,
} from "./types";

export { SX_PREVIEW_SENTINEL } from "./sentinel";
export { DEMO_NOW, DEMO_TODAY, DEFAULT_CONSOLIDATION_SETTINGS };

// ---------- Canarios de fuga (16c §E) ----------
// Nunca deben aparecer en la proyección pública, el reporte ni el PDF.
// R9: las notas internas usan un canario, NUNCA el nombre de una persona.
export const LEAK_CANARIES = {
  internalNote: "CANARIO_NOTA_INTERNA_7Q",
  cancelReason: "CANARIO_MOTIVO_CANCELACION_3K",
  exceptionReason: "CANARIO_EXCEPCION_9P",
  archivedTitle: "CANARIO_ARCHIVADA_2M",
} as const;

// ---------- Áreas ----------

export const AREAS: readonly Area[] = [
  { id: "pastoral", name: "Pastoral", color: "azul", active: true, order: 1 },
  { id: "alabanza", name: "Alabanza", color: "indigo", active: true, order: 2 },
  { id: "jovenes", name: "Jóvenes", color: "naranjo", active: true, order: 3 },
  { id: "ninos", name: "Niños", color: "ambar", description: "Escuela Dominical", active: true, order: 4 },
  { id: "damas", name: "Damas", color: "frambuesa", active: true, order: 5 },
  { id: "varones", name: "Varones", color: "cafe", active: true, order: 6 },
  { id: "intercesion", name: "Intercesión", color: "teal", active: true, order: 7 },
  { id: "multimedia", name: "Multimedia", color: "pizarra", description: "Sonido y transmisión", active: true, order: 8 },
  { id: "consolidacion", name: "Consolidación", color: "verde", active: true, order: 9 },
  { id: "matrimonios", name: "Matrimonios", color: "carmin", active: false, order: 10 },
];

// ---------- Perfiles (8) ----------

const preset = (c: keyof typeof CARGO_PRESETS) => [...CARGO_PRESETS[c].permissions];

export const USERS: readonly AccessProfile[] = [
  {
    uid: "admin",
    displayName: "Administración (demo)",
    email: "admin@demo.invalid",
    active: true,
    baseRole: "admin",
    cargo: "Administración",
    permissions: [],
    areaIds: [],
    initialModule: "finanzas",
  },
  {
    uid: "pastor",
    displayName: "Daniel Herrera",
    email: "daniel.herrera@demo.invalid",
    active: true,
    baseRole: "standard",
    cargo: "Pastor",
    permissions: preset("Pastor"),
    areaIds: ["pastoral"],
    initialModule: "calendario",
  },
  {
    uid: "lider",
    displayName: "Matías Contreras",
    email: "matias.contreras@demo.invalid",
    active: true,
    baseRole: "standard",
    cargo: "Líder",
    permissions: preset("Líder"),
    areaIds: ["jovenes"],
    initialModule: "calendario",
  },
  {
    uid: "diacono",
    displayName: "Pedro Navarro",
    email: "pedro.navarro@demo.invalid",
    active: true,
    baseRole: "standard",
    cargo: "Diácono",
    permissions: preset("Diácono"),
    areaIds: ["multimedia", "varones"],
    initialModule: "calendario",
  },
  {
    uid: "finanzas",
    displayName: "Marcela Soto",
    email: "marcela.soto@demo.invalid",
    active: true,
    baseRole: "standard",
    cargo: "Finanzas",
    permissions: preset("Finanzas"),
    areaIds: [],
    initialModule: "finanzas",
  },
  {
    uid: "consolidacion",
    displayName: "Carolina Vidal",
    email: "carolina.vidal@demo.invalid",
    active: true,
    baseRole: "standard",
    cargo: "Consolidación",
    permissions: preset("Consolidación"),
    areaIds: ["consolidacion"],
    initialModule: "integrantes/consolidacion",
  },
  {
    uid: "sin-permisos",
    displayName: "Usuario sin permisos",
    email: "sin.permisos@demo.invalid",
    active: true,
    baseRole: "standard",
    cargo: "Líder",
    permissions: [],
    areaIds: [],
    initialModule: "calendario",
  },
  {
    uid: "lider-fallback",
    displayName: "Líder con módulo inicial no permitido",
    email: "lider.fallback@demo.invalid",
    active: true,
    baseRole: "standard",
    cargo: "Líder",
    // Sin finance.summary.read: su módulo inicial (Finanzas) ya no está permitido.
    permissions: ["calendar.events.manage_assigned"],
    areaIds: ["alabanza"],
    initialModule: "finanzas",
  },
];

export const DEFAULT_PROFILE_SLUG = "admin";
export const PROFILE_SLUGS = USERS.map((u) => u.uid);

/** Metadatos SOLO de la preview (pantalla de ingreso y simulador). */
export const DEMO_PROFILES: readonly { slug: string; initials: string; note: string }[] = [
  { slug: "admin", initials: "AD", note: "Ve todo, incluida Configuración." },
  { slug: "pastor", initials: "DH", note: "Todo menos Configuración." },
  { slug: "lider", initials: "MC", note: "Gestiona las actividades de Jóvenes." },
  { slug: "diacono", initials: "PN", note: "Gestiona Multimedia y Varones." },
  { slug: "finanzas", initials: "MS", note: "Finanzas completo y calendario en lectura." },
  { slug: "consolidacion", initials: "CV", note: "Llega directo a Consolidación." },
  { slug: "sin-permisos", initials: "SP", note: "Cuenta activa sin módulos." },
  { slug: "lider-fallback", initials: "LF", note: "Su módulo inicial ya no está permitido." },
];

const NAME_ONLY = new Set(["admin", "sin-permisos", "lider-fallback"]);

/** "Matías Contreras · Líder (Jóvenes)", "Administración (demo)". */
export function profileTitle(p: AccessProfile, areas: readonly Area[] = AREAS): string {
  if (NAME_ONLY.has(p.uid)) return p.displayName;
  const showAreas = (p.cargo === "Líder" || p.cargo === "Diácono") && p.areaIds.length;
  const names = p.areaIds.map((id) => areas.find((a) => a.id === id)?.name).filter(Boolean);
  return `${p.displayName} · ${p.cargo}${showAreas ? ` (${names.join(", ")})` : ""}`;
}

/** "Líder · Matías Contreras" (botón "Ver como"). */
export function simulatorLabel(p: AccessProfile): string {
  return NAME_ONLY.has(p.uid) ? p.displayName : `${p.cargo} · ${p.displayName}`;
}

export function initialsOf(p: AccessProfile): string {
  return (
    DEMO_PROFILES.find((d) => d.slug === p.uid)?.initials ??
    p.displayName
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase()
  );
}

// ---------- Actividades (16a §J) ----------

const created = { createdBy: "admin", createdAt: "2026-08-20T10:00", revision: 1, exceptions: [] as CalendarEvent["exceptions"] };

export const EVENTS: readonly CalendarEvent[] = [
  {
    ...created,
    id: "ev-culto",
    title: "Culto dominical",
    responsibleAreaId: "pastoral",
    participantAreaIds: ["alabanza", "multimedia", "ninos"],
    startDate: "2026-09-06",
    endDate: "2026-09-06",
    allDay: false,
    startTime: "11:00",
    endTime: "13:00",
    location: "Templo",
    publicDescription: "Culto de adoración y predicación. El primer domingo de cada mes celebramos la Santa Cena.",
    internalNotes: `${LEAK_CANARIES.internalNote} · Coordinar ujieres y recepción.`,
    visibility: "public",
    status: "programada",
    recurrence: { freq: "weekly", until: "2027-02-28" },
  },
  {
    ...created,
    id: "ev-escuela",
    title: "Escuela dominical",
    responsibleAreaId: "ninos",
    participantAreaIds: [],
    startDate: "2026-09-06",
    endDate: "2026-09-06",
    allDay: false,
    startTime: "11:00",
    endTime: "12:30",
    location: "Sala de niños",
    publicDescription: "Clases bíblicas para niños de 3 a 12 años durante el culto.",
    visibility: "public",
    status: "programada",
    recurrence: { freq: "weekly", until: "2027-02-28" },
  },
  {
    ...created,
    id: "ev-oracion",
    title: "Culto de oración y estudio bíblico",
    responsibleAreaId: "pastoral",
    participantAreaIds: ["intercesion"],
    startDate: "2026-09-02",
    endDate: "2026-09-02",
    allDay: false,
    startTime: "19:30",
    endTime: "21:00",
    location: "Templo",
    publicDescription: "Oración congregacional y estudio de la Biblia.",
    visibility: "public",
    status: "programada",
    recurrence: { freq: "weekly", until: "2027-02-24" },
  },
  {
    ...created,
    id: "ev-jovenes",
    title: "Reunión de jóvenes",
    responsibleAreaId: "jovenes",
    participantAreaIds: ["alabanza"],
    startDate: "2026-09-04",
    endDate: "2026-09-04",
    allDay: false,
    startTime: "20:00",
    endTime: "22:00",
    location: "Salón multiuso",
    publicDescription: "Alabanza, palabra y comunidad para jóvenes de 15 a 30 años.",
    visibility: "public",
    status: "programada",
    recurrence: { freq: "weekly", until: "2027-02-26" },
    exceptions: [
      {
        date: "2026-10-16",
        type: "cancelled",
        reason: `${LEAK_CANARIES.exceptionReason} · Se une al campamento.`,
        by: "lider",
        at: "2026-09-28T18:00",
      },
    ],
  },
  {
    ...created,
    id: "ev-ensayo",
    title: "Ensayo de alabanza",
    responsibleAreaId: "alabanza",
    participantAreaIds: ["multimedia"],
    startDate: "2026-09-05",
    endDate: "2026-09-05",
    allDay: false,
    startTime: "17:00",
    endTime: "19:00",
    location: "Templo",
    internalNotes: `${LEAK_CANARIES.internalNote} · Repertorio en la carpeta del equipo.`,
    visibility: "team",
    status: "programada",
    recurrence: { freq: "weekly", until: "2027-02-27" },
    exceptions: [
      { date: "2026-10-10", type: "cancelled", reason: "Mantención del sistema de sonido.", by: "admin", at: "2026-09-30T12:00" },
    ],
  },
  {
    ...created,
    id: "ev-ayuno",
    title: "Ayuno congregacional",
    responsibleAreaId: "intercesion",
    participantAreaIds: [],
    startDate: "2026-10-03",
    endDate: "2026-10-03",
    allDay: false,
    startTime: "10:00",
    endTime: "13:00",
    location: "Templo",
    publicDescription: "Mañana de ayuno y oración el primer sábado de cada mes.",
    visibility: "public",
    status: "programada",
    recurrence: { freq: "monthly", until: "2027-03-06", monthly: { mode: "nth_weekday", weekday: 6, ordinal: 1 } },
  },
  {
    ...created,
    id: "ev-vigilia",
    title: "Vigilia",
    responsibleAreaId: "intercesion",
    participantAreaIds: [],
    startDate: "2026-10-30",
    endDate: "2026-10-31",
    allDay: false,
    startTime: "22:00",
    endTime: "02:00",
    location: "Templo",
    publicDescription: "Noche de oración el último viernes de cada mes. Termina a las 02:00.",
    visibility: "public",
    status: "programada",
    recurrence: { freq: "monthly", until: "2027-02-26", monthly: { mode: "nth_weekday", weekday: 5, ordinal: -1 } },
  },
  {
    ...created,
    id: "ev-damas",
    title: "Reunión de damas",
    responsibleAreaId: "damas",
    participantAreaIds: [],
    startDate: "2026-09-22",
    endDate: "2026-09-22",
    allDay: false,
    startTime: "19:00",
    endTime: "20:30",
    location: "Salón multiuso",
    publicDescription: "Encuentro quincenal de mujeres.",
    visibility: "public",
    status: "programada",
    recurrence: { freq: "biweekly", until: "2027-03-02" },
  },
  {
    ...created,
    id: "ev-varones",
    title: "Desayuno de varones",
    responsibleAreaId: "varones",
    participantAreaIds: [],
    startDate: "2026-10-10",
    endDate: "2026-10-10",
    allDay: false,
    startTime: "09:00",
    endTime: "11:00",
    location: "Salón multiuso",
    publicDescription: "Desayuno y conversación el segundo sábado de cada mes.",
    visibility: "public",
    status: "programada",
    recurrence: { freq: "monthly", until: "2027-03-13", monthly: { mode: "nth_weekday", weekday: 6, ordinal: 2 } },
  },
  {
    ...created,
    id: "ev-lideres",
    title: "Reunión de líderes",
    responsibleAreaId: "pastoral",
    participantAreaIds: [],
    startDate: "2026-10-05",
    endDate: "2026-10-05",
    allDay: false,
    startTime: "20:00",
    endTime: "21:30",
    location: "Oficina pastoral",
    internalNotes: `${LEAK_CANARIES.internalNote} · Revisar el calendario de noviembre.`,
    visibility: "team",
    status: "programada",
    recurrence: { freq: "monthly", until: "2027-03-01", monthly: { mode: "nth_weekday", weekday: 1, ordinal: 1 } },
  },
  {
    ...created,
    id: "ev-consolidacion",
    title: "Reunión de consolidación",
    responsibleAreaId: "consolidacion",
    participantAreaIds: [],
    startDate: "2026-10-08",
    endDate: "2026-10-08",
    allDay: false,
    startTime: "19:30",
    endTime: "21:00",
    location: "Oficina pastoral",
    internalNotes: `${LEAK_CANARIES.internalNote} · Revisar la cola de atención.`,
    visibility: "team",
    status: "programada",
    recurrence: { freq: "none" },
  },
  {
    ...created,
    id: "ev-campamento",
    title: "Campamento de jóvenes",
    responsibleAreaId: "jovenes",
    participantAreaIds: ["alabanza"],
    startDate: "2026-10-17",
    endDate: "2026-10-18",
    allDay: true,
    location: "Pirque",
    publicDescription: "Dos días de campamento. Inscripciones con el equipo de Jóvenes.",
    visibility: "public",
    status: "programada",
    recurrence: { freq: "none" },
  },
  {
    ...created,
    id: "ev-fiesta-luz",
    title: "Fiesta de luz",
    responsibleAreaId: "ninos",
    participantAreaIds: ["damas"],
    startDate: "2026-10-31",
    endDate: "2026-10-31",
    allDay: false,
    startTime: "18:00",
    endTime: "20:30",
    location: "Templo",
    publicDescription: "Celebración para niños y familias con juegos y alabanza.",
    visibility: "public",
    status: "programada",
    recurrence: { freq: "none" },
  },
  {
    ...created,
    id: "ev-evangelismo",
    title: "Evangelismo en la plaza",
    responsibleAreaId: "consolidacion",
    participantAreaIds: ["jovenes", "alabanza"],
    startDate: "2026-10-10",
    endDate: "2026-10-10",
    allDay: false,
    startTime: "16:00",
    endTime: "18:00",
    location: "Plaza de armas",
    publicDescription: "Música y oración en la plaza.",
    visibility: "public",
    status: "cancelada",
    recurrence: { freq: "none" },
    cancelledBy: "pastor",
    cancelledAt: "2026-10-02T09:00",
    cancelReason: `${LEAK_CANARIES.cancelReason} · Pronóstico de lluvia.`,
  },
  {
    ...created,
    id: "ev-archivada",
    title: `${LEAK_CANARIES.archivedTitle} Culto dominical (duplicado)`,
    responsibleAreaId: "pastoral",
    participantAreaIds: [],
    startDate: "2026-10-11",
    endDate: "2026-10-11",
    allDay: false,
    startTime: "11:00",
    endTime: "13:00",
    location: "Templo",
    visibility: "public",
    status: "archivada",
    recurrence: { freq: "none" },
    archivedBy: "admin",
    archivedAt: "2026-09-29T10:00",
    archiveReason: "Creada por error (duplicado).",
  },
];

/** Títulos de actividades "solo equipo" (no deben aparecer en lo público). */
export const TEAM_EVENT_TITLES = EVENTS.filter((e) => e.visibility === "team").map((e) => e.title);

export const SHARE_LINK: ShareLink = {
  id: "share-1",
  token: "demo",
  active: true,
  createdAt: "2026-09-01T10:00",
  createdBy: "admin",
};

// ---------- Personas (16a §J) ----------

const person = (
  p: Pick<Person, "id" | "fullName" | "phoneE164" | "phoneRaw" | "entryDate" | "createdAt"> & Partial<Person>,
): Person => ({
  faithConfession: "sin_informacion",
  baptized: "sin_informacion",
  createdBy: "consolidacion",
  followUpOwnerUid: "consolidacion",
  lifecycleStage: "en_consolidacion",
  consolidationStatus: "en_seguimiento",
  doNotContact: false,
  revision: 1,
  ...p,
});

export const PERSONS: readonly Person[] = [
  // Ingresó hoy, sin responsable (aún no supera 48 h: contra-fixture de "sin primer contacto").
  person({
    id: "p-01",
    fullName: "Sofía Ramírez",
    phoneE164: "+56955550101",
    phoneRaw: "+56 9 5555 0101",
    email: "sofia.ramirez@demo.invalid",
    birthDate: "2007-03-12",
    entryDate: "2026-10-04",
    createdAt: "2026-10-04T12:45",
    followUpOwnerUid: null,
    consolidationStatus: "por_contactar",
    initialNotes: "Llegó invitada por una amiga.",
  }),
  // Ingresó el 30-09 y no se ha logrado contactar (> 48 h). Cumple el 19-10 (contra-fixture de cumpleaños).
  person({
    id: "p-02",
    fullName: "Pablo Muñoz",
    phoneE164: "+56955550102",
    phoneRaw: "9 5555 0102",
    birthDate: "1998-10-19",
    entryDate: "2026-09-30",
    createdAt: "2026-09-30T21:15",
    consolidationStatus: "por_contactar",
  }),
  // Seguimiento vencido el 01-10. Última visita hace 14 días (contra-fixture de "sin volver").
  person({
    id: "p-03",
    fullName: "Ana Torres",
    phoneE164: "+56955550103",
    phoneRaw: "+56 9 5555 0103",
    email: "ana.torres@demo.invalid",
    birthDate: "1985-06-02",
    faithConfession: "si",
    baptized: "no",
    entryDate: "2026-09-06",
    createdAt: "2026-09-06T13:10",
  }),
  // Volvió hoy (visitas 13-09, 20-09 y 04-10) sin seguimiento posterior.
  person({
    id: "p-04",
    fullName: "Javier Rojas",
    phoneE164: "+56955550104",
    phoneRaw: "955550104",
    birthDate: "1992-01-15",
    entryDate: "2026-09-13",
    createdAt: "2026-09-13T13:20",
  }),
  // Última visita el 06-09 (supera 21 días).
  person({
    id: "p-05",
    fullName: "Valentina Castro",
    phoneE164: "+56955550105",
    phoneRaw: "+56 9 5555 0105",
    birthDate: "1979-12-03",
    entryDate: "2026-08-23",
    createdAt: "2026-08-23T13:00",
  }),
  // Cumple años hoy. Volvió el 27-09 pero ya tiene seguimiento posterior (contra-fixture de "volvió").
  person({
    id: "p-06",
    fullName: "Diego Fuentes",
    phoneE164: "+56955550106",
    phoneRaw: "+56 9 5555 0106",
    email: "diego.fuentes@demo.invalid",
    birthDate: "1990-10-04",
    faithConfession: "si",
    baptized: "si",
    entryDate: "2026-09-20",
    createdAt: "2026-09-20T13:05",
  }),
  // Cumple el 05-10. Su responsable (Líder) no tiene acceso a Consolidación → "sin responsable".
  person({
    id: "p-07",
    fullName: "Fernanda Morales",
    phoneE164: "+56955550107",
    phoneRaw: "+56 9 5555 0107",
    birthDate: "1985-10-05",
    entryDate: "2026-09-13",
    createdAt: "2026-09-13T12:50",
    followUpOwnerUid: "lider",
  }),
  // Cumple el 10-10. Integrándose en Jóvenes.
  person({
    id: "p-08",
    fullName: "Tomás Silva",
    phoneE164: "+56955550108",
    phoneRaw: "+56 9 5555 0108",
    birthDate: "2001-10-10",
    faithConfession: "si",
    baptized: "no",
    entryDate: "2026-08-30",
    createdAt: "2026-08-30T13:15",
    consolidationStatus: "integrandose",
    integrationAreaId: "jovenes",
  }),
  // Nacida el 29-02 (en 2027 cumple el 28-02).
  person({
    id: "p-09",
    fullName: "Isidora Paredes",
    phoneE164: "+56955550109",
    phoneRaw: "+56 9 5555 0109",
    birthDate: "2004-02-29",
    entryDate: "2026-09-20",
    createdAt: "2026-09-20T13:30",
  }),
  // Madre e hijo con el mismo teléfono (escrito distinto).
  person({
    id: "p-10",
    fullName: "Carmen López",
    phoneE164: "+56955550110",
    phoneRaw: "+56 9 5555 0110",
    birthDate: "1981-04-21",
    entryDate: "2026-09-27",
    createdAt: "2026-09-27T13:00",
  }),
  // Menor de 16 años con fe y bautismo "Sin información".
  person({
    id: "p-11",
    fullName: "Benjamín López",
    phoneE164: "+56955550110",
    phoneRaw: "955550110",
    birthDate: "2012-05-14",
    entryDate: "2026-09-27",
    createdAt: "2026-09-27T13:02",
  }),
  // Par con el mismo correo.
  person({
    id: "p-12",
    fullName: "Ignacio Vega",
    phoneE164: "+56955550112",
    phoneRaw: "+56 9 5555 0112",
    email: "familia.vega@demo.invalid",
    birthDate: "1975-07-08",
    entryDate: "2026-09-20",
    createdAt: "2026-09-20T13:40",
  }),
  person({
    id: "p-13",
    fullName: "Josefa Vega",
    phoneE164: "+56955550113",
    phoneRaw: "+56 9 5555 0113",
    email: "familia.vega@demo.invalid",
    birthDate: "1977-08-30",
    entryDate: "2026-09-20",
    createdAt: "2026-09-20T13:42",
  }),
  // Integrada: cambió de etapa y conserva todo su historial.
  person({
    id: "p-14",
    fullName: "Martina Reyes",
    phoneE164: "+56955550114",
    phoneRaw: "+56 9 5555 0114",
    birthDate: "1995-11-25",
    faithConfession: "si",
    baptized: "si",
    entryDate: "2026-07-05",
    createdAt: "2026-07-05T13:00",
    lifecycleStage: "integrante",
    consolidationStatus: "integrado",
  }),
  // Sin continuidad por "no desea contacto": No contactar oculta WhatsApp y alertas.
  person({
    id: "p-15",
    fullName: "Andrés Gutiérrez",
    phoneE164: "+56955550115",
    phoneRaw: "+56 9 5555 0115",
    birthDate: "1988-10-12",
    entryDate: "2026-08-16",
    createdAt: "2026-08-16T13:00",
    followUpOwnerUid: null,
    consolidationStatus: "sin_continuidad",
    closedReason: "no_desea_contacto",
    doNotContact: true,
  }),
  // Teléfono extranjero (+58) y sin fecha de nacimiento.
  person({
    id: "p-16",
    fullName: "Rosa Quintero",
    phoneE164: "+584121234567",
    phoneRaw: "+58 412 123 4567",
    entryDate: "2026-09-27",
    createdAt: "2026-09-27T13:10",
    followUpOwnerUid: "pastor",
  }),
];

const visit = (id: string, personId: string, date: string, activityLabel = "Culto dominical", extra: Partial<Visit> = {}): Visit => ({
  id,
  personId,
  date,
  activityEventId: activityLabel === "Culto dominical" ? "ev-culto" : undefined,
  activityLabel,
  voided: false,
  createdBy: "consolidacion",
  createdAt: `${date}T13:30`,
  ...extra,
});

export const VISITS: readonly Visit[] = [
  visit("v-01", "p-01", "2026-10-04"),
  visit("v-02", "p-02", "2026-09-30", "Culto de oración"),
  visit("v-03", "p-03", "2026-09-06"),
  visit("v-04", "p-03", "2026-09-13"),
  visit("v-05", "p-03", "2026-09-20"),
  visit("v-06", "p-04", "2026-09-13"),
  visit("v-07", "p-04", "2026-09-20"),
  visit("v-08", "p-04", "2026-10-04"),
  visit("v-09", "p-05", "2026-08-23"),
  visit("v-10", "p-05", "2026-09-06"),
  visit("v-11", "p-06", "2026-09-20"),
  visit("v-12", "p-06", "2026-09-27"),
  visit("v-13", "p-07", "2026-09-13"),
  visit("v-14", "p-07", "2026-09-20"),
  visit("v-15", "p-08", "2026-08-30"),
  visit("v-16", "p-08", "2026-09-04", "Reunión de jóvenes"),
  visit("v-17", "p-08", "2026-09-27"),
  visit("v-18", "p-09", "2026-09-20"),
  visit("v-19", "p-10", "2026-09-27"),
  visit("v-20", "p-11", "2026-09-27"),
  visit("v-21", "p-12", "2026-09-20"),
  visit("v-22", "p-13", "2026-09-20"),
  visit("v-23", "p-14", "2026-07-05"),
  visit("v-24", "p-14", "2026-07-12"),
  visit("v-25", "p-14", "2026-08-02"),
  visit("v-26", "p-15", "2026-08-16"),
  visit("v-27", "p-16", "2026-09-27"),
  // Registrada por error y anulada (no cuenta en estadísticas).
  visit("v-28", "p-03", "2026-09-27", "Culto dominical", { voided: true, voidReason: "Se registró a otra persona." }),
];

const fu = (f: Omit<FollowUp, "createdBy" | "ownerUid"> & Partial<Pick<FollowUp, "ownerUid" | "createdBy">>): FollowUp => ({
  ownerUid: "consolidacion",
  createdBy: "consolidacion",
  ...f,
});

export const FOLLOWUPS: readonly FollowUp[] = [
  fu({ id: "f-01", personId: "p-02", at: "2026-10-02T18:30", type: "llamada", result: "sin_respuesta", nextAction: "Volver a llamar", nextActionDate: "2026-10-04" }),
  fu({ id: "f-02", personId: "p-03", at: "2026-09-08T19:00", type: "whatsapp", result: "contactado", note: "Agradeció la bienvenida.", nextAction: "Invitar a un grupo pequeño", nextActionDate: "2026-10-01" }),
  fu({ id: "f-03", personId: "p-04", at: "2026-09-15T19:10", type: "llamada", result: "contactado", nextAction: "Llamar para saludar", nextActionDate: "2026-10-11" }),
  fu({ id: "f-04", personId: "p-05", at: "2026-08-25T18:00", type: "whatsapp", result: "contactado" }),
  fu({ id: "f-05", personId: "p-06", at: "2026-09-28T19:30", type: "presencial", result: "contactado", nextAction: "Invitar a discipulado", nextActionDate: "2026-10-08" }),
  fu({ id: "f-06", personId: "p-07", at: "2026-09-15T18:45", type: "whatsapp", result: "contactado", nextAction: "Confirmar asistencia", nextActionDate: "2026-10-09", ownerUid: "lider" }),
  fu({ id: "f-07", personId: "p-08", at: "2026-09-01T19:00", type: "llamada", result: "contactado" }),
  fu({ id: "f-08", personId: "p-08", at: "2026-09-29T20:00", type: "presencial", result: "contactado", note: "Participa en Jóvenes.", nextAction: "Acompañar en el campamento", nextActionDate: "2026-10-17" }),
  fu({ id: "f-09", personId: "p-09", at: "2026-09-21T18:20", type: "whatsapp", result: "contactado" }),
  fu({ id: "f-10", personId: "p-10", at: "2026-09-28T18:00", type: "llamada", result: "contactado", note: "Llamada familiar." }),
  fu({ id: "f-11", personId: "p-11", at: "2026-09-28T18:05", type: "llamada", result: "contactado", note: "Contacto a través de su madre." }),
  fu({ id: "f-12", personId: "p-12", at: "2026-09-22T19:00", type: "whatsapp", result: "contactado" }),
  fu({ id: "f-13", personId: "p-13", at: "2026-09-22T19:05", type: "whatsapp", result: "contactado" }),
  fu({ id: "f-14", personId: "p-14", at: "2026-07-07T19:00", type: "llamada", result: "contactado" }),
  fu({ id: "f-15", personId: "p-15", at: "2026-08-18T19:00", type: "llamada", result: "no_desea_contacto", note: "Pidió no ser contactado." }),
  fu({ id: "f-16", personId: "p-16", at: "2026-09-29T18:40", type: "whatsapp", result: "contactado", nextAction: "Invitar al culto de oración", nextActionDate: "2026-10-06", ownerUid: "pastor", createdBy: "pastor" }),
];

const change = (c: Omit<PersonChange, "by"> & { by?: string }): PersonChange => ({ by: "consolidacion", ...c });

export const PERSON_CHANGES: readonly PersonChange[] = [
  change({ id: "pc-01", personId: "p-03", at: "2026-09-08T19:01", field: "status", from: "por_contactar", to: "en_seguimiento" }),
  change({ id: "pc-02", personId: "p-04", at: "2026-09-15T19:11", field: "status", from: "por_contactar", to: "en_seguimiento" }),
  change({ id: "pc-03", personId: "p-08", at: "2026-09-29T20:01", field: "status", from: "en_seguimiento", to: "integrandose" }),
  change({ id: "pc-04", personId: "p-14", at: "2026-07-07T19:01", field: "status", from: "por_contactar", to: "en_seguimiento" }),
  change({ id: "pc-05", personId: "p-14", at: "2026-08-02T14:00", field: "status", from: "en_seguimiento", to: "integrandose" }),
  change({ id: "pc-06", personId: "p-14", at: "2026-09-20T14:00", field: "status", from: "integrandose", to: "integrado" }),
  change({ id: "pc-07", personId: "p-14", at: "2026-09-20T14:00", field: "stage", from: "en_consolidacion", to: "integrante" }),
  change({ id: "pc-08", personId: "p-15", at: "2026-08-18T19:01", field: "status", from: "por_contactar", to: "sin_continuidad", reason: "No desea contacto" }),
  change({ id: "pc-09", personId: "p-15", at: "2026-08-18T19:01", field: "doNotContact", from: "false", to: "true" }),
];

/**
 * Textos que NUNCA deben aparecer en la proyección pública: canarios, correos,
 * nombres de usuarios y de personas, teléfonos y títulos de actividades de equipo.
 */
export const LEAK_STRINGS: readonly string[] = [
  ...Object.values(LEAK_CANARIES),
  ...USERS.flatMap((u) => [u.email, u.displayName]),
  ...PERSONS.flatMap((p) => [p.fullName, p.phoneE164, p.phoneRaw, ...(p.email ? [p.email] : [])]),
  ...TEAM_EVENT_TITLES,
  "5555",
  "@demo.invalid",
];
