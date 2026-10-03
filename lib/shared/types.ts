// Tipos de dominio compartidos por el cliente (Next) y Functions (CommonJS
// generado en functions/shared por scripts/build-shared.mjs).
//
// Reglas de este directorio: TypeScript puro, solo imports relativos "./x",
// sin React, sin Firebase y sin APIs del navegador. Fechas y horas de eventos
// son de pared en America/Santiago ("YYYY-MM-DD" / "HH:mm"), nunca instantes.

/** "YYYY-MM-DD" (fecha local). */
export type Ymd = string;
/** "HH:mm" (hora de pared). */
export type HHmm = string;
/** "YYYY-MM-DDTHH:mm" (fecha y hora local). */
export type LocalDateTime = string;
/** Marca de tiempo del almacenamiento (Timestamp de Firestore, Date, etc.). Opaca para lib/shared. */
export type StoredTimestamp = unknown;

// ---------- Acceso ----------

export const PERMISSIONS = [
  "finance.summary.read",
  "finance.details.read",
  "finance.records.manage",
  "finance.pastoral.manage",
  "calendar.read",
  "calendar.events.manage_assigned",
  "calendar.events.manage_all",
  "calendar.events.publish_assigned",
  "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permisos que se pueden guardar en `users/{uid}.permissions` (`settings.manage` solo vía baseRole admin). */
export const STORABLE_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter((p) => p !== "settings.manage");

export const BASE_ROLES = ["admin", "standard"] as const;
export type BaseRole = (typeof BASE_ROLES)[number];

export const LEGACY_ROLES = ["admin", "pastor", "finance", "leader"] as const;
export type LegacyRole = (typeof LEGACY_ROLES)[number];

export const HOME_MODULES = ["finance", "calendar"] as const;
export type HomeModule = (typeof HOME_MODULES)[number];

export type ModuleId = "finance" | "calendar" | "reports" | "settings";

/** Límites del documento v1 (iguales a las reglas). */
export const MAX_STORED_PERMISSIONS = 8;
export const MAX_AREA_IDS = 20;
export const MAX_POSITION_LENGTH = 60;

/** Datos crudos de `users/{uid}` (tolerante: nada se confía). */
export interface UserAccessDoc {
  role?: unknown;
  active?: unknown;
  accessSchemaVersion?: unknown;
  baseRole?: unknown;
  permissions?: unknown;
  areaIds?: unknown;
  homeModule?: unknown;
  position?: unknown;
}

/** Perfil de acceso normalizado (legacy o v1). */
export interface AccessProfile {
  schema: "legacy" | "v1";
  active: boolean;
  baseRole: BaseRole;
  /** Permisos guardados (o del mapeo legacy), sin cierre, en orden de catálogo. */
  permissions: Permission[];
  areaIds: string[];
  /** Módulo inicial configurado (null si no hay uno válido o el doc es legacy). */
  homeModule: HomeModule | null;
  position: string;
  legacyRole: LegacyRole | null;
}

/** Forma v1 completa de `users/{uid}` (18a §C.1). */
export interface UserDocV1 {
  displayName: string;
  email: string;
  role: LegacyRole;
  active: boolean;
  createdAt: StoredTimestamp;
  baseRole: BaseRole;
  position: string;
  permissions: Permission[];
  areaIds: string[];
  homeModule: HomeModule;
  accessSchemaVersion: 1;
  updatedAt: StoredTimestamp;
  updatedBy: string;
}

// ---------- Áreas ----------

export const AREA_COLORS = [
  "azul",
  "indigo",
  "naranjo",
  "ambar",
  "frambuesa",
  "cafe",
  "teal",
  "pizarra",
  "verde",
  "carmin",
] as const;
export type AreaColor = (typeof AREA_COLORS)[number];

/** `areas/{areaId}` (18a §C.2). El id es el slug. */
export interface AreaDoc {
  name: string;
  slug: string;
  color: AreaColor;
  description: string;
  active: boolean;
  createdAt: StoredTimestamp;
  createdBy: string;
  updatedAt: StoredTimestamp;
  updatedBy: string;
}

/** Área con su id (lo mínimo que necesita la lógica compartida). */
export interface Area {
  id: string;
  name: string;
  color: AreaColor;
  active: boolean;
  slug?: string;
  description?: string;
}

// ---------- Calendario ----------

export type Visibility = "internal" | "public";
/** Estado guardado. "Realizada" es derivada (ver OccurrenceStatus). */
export type EventStatus = "scheduled" | "cancelled" | "archived";
/** Estado de una ocurrencia: `realized` = terminó antes de "ahora" en Santiago. */
export type OccurrenceStatus = "scheduled" | "realized" | "cancelled";
export type Freq = "none" | "weekly" | "biweekly" | "monthly";
/** 1.º–4.º o -1 = último. */
export type Ordinal = 1 | 2 | 3 | 4 | -1;

export interface MonthlyRule {
  mode: "nth_weekday";
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  ordinal: Ordinal;
}

export interface RecurrenceRule {
  freq: Freq;
  /** Inclusivo. Obligatorio si freq ≠ none. Máx. 12 meses desde el inicio. */
  until?: Ymd;
  monthly?: MonthlyRule;
}

/** Excepción de una fecha. Sin `at`: el cuándo vive en el registro de cambios. */
export interface RecurrenceException {
  date: Ymd;
  type: "cancelled";
  /** Interno: nunca se publica. */
  reason: string;
  by: string;
}

export interface SeriesCancellation {
  from: Ymd;
  /** Interno: nunca se publica. */
  reason: string;
  by: string;
  at: StoredTimestamp;
}

/** `calendarEvents/{eventId}` (18a §C.3), sin el id. */
export interface CalendarEventDoc {
  title: string;
  responsibleAreaId: string;
  participantAreaIds: string[];
  startDate: Ymd;
  endDate: Ymd;
  allDay: boolean;
  startTime: HHmm | null;
  endTime: HHmm | null;
  location: string;
  publicDescription: string;
  /** Visible para calendar.read. Nunca se publica. */
  internalNotes: string;
  visibility: Visibility;
  status: EventStatus;
  recurrence: RecurrenceRule;
  exceptions: RecurrenceException[];
  seriesCancellation?: SeriesCancellation;
  /** none: == endDate ; recurrente: until + span (span ≤ 1). */
  lastDate: Ymd;
  cancelReason?: string;
  archivedAt?: StoredTimestamp;
  archiveReason?: string;
  revision: number;
  lastChangeId: string;
  createdBy: string;
  createdAt: StoredTimestamp;
  updatedBy: string;
  updatedAt: StoredTimestamp;
}

export interface CalendarEvent extends CalendarEventDoc {
  id: string;
}

/** Lo que el motor de recurrencia necesita de una actividad. */
export type RecurrenceEventLike = Pick<
  CalendarEvent,
  "id" | "startDate" | "endDate" | "allDay" | "startTime" | "endTime" | "status" | "recurrence" | "exceptions"
> &
  Partial<Pick<CalendarEvent, "seriesCancellation" | "cancelReason">>;

/** Una fecha concreta de una actividad (derivada de su recurrencia). */
export interface Occurrence<E extends RecurrenceEventLike = CalendarEvent> {
  /** `${eventId}@${date}`. */
  key: string;
  eventId: string;
  event: E;
  date: Ymd;
  endDate: Ymd;
  allDay: boolean;
  startTime: HHmm | null;
  endTime: HHmm | null;
  status: OccurrenceStatus;
  /** Interno (motivo de la excepción, de la serie o de la actividad). */
  cancelReason: string | null;
  isRecurring: boolean;
}

export type EventChangeAction =
  | "created"
  | "updated"
  | "cancelled"
  | "archived"
  | "recurrence_updated"
  | "visibility_changed";

/** `calendarEvents/{eventId}/changes/r{revision}` (18a §C.4). */
export interface EventChangeDoc {
  revision: number;
  action: EventChangeAction;
  scope?: "event" | "occurrence" | "series";
  occurrenceDate?: Ymd;
  actorUid: string;
  at: StoredTimestamp;
  changedFields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
}

/** `calendarShareLinks/{shareId}` (18a §C.5). Solo Admin SDK. */
export interface ShareLinkDoc {
  tokenHash: string;
  active: boolean;
  createdAt: StoredTimestamp;
  createdBy: string;
  regeneratedAt?: StoredTimestamp;
  /** uid de quien regeneró por última vez (el estado expone solo su nombre visible). */
  regeneratedBy?: string;
  disabledAt?: StoredTimestamp;
  /** uid de quien pausó el enlace (solo mientras está pausado). */
  disabledBy?: string;
  rotation: number;
  updatedAt: StoredTimestamp;
  updatedBy: string;
}

// ---------- Proyección pública ----------

export interface PublicArea {
  slug: string;
  name: string;
  color: AreaColor;
}

/** Claves EXACTAS de PUBLIC_EVENT_KEYS (ausentes → null). */
export interface PublicEvent {
  id: string;
  title: string;
  startDate: Ymd;
  endDate: Ymd;
  allDay: boolean;
  startTime: HHmm | null;
  endTime: HHmm | null;
  location: string | null;
  publicDescription: string | null;
  responsibleArea: PublicArea;
  participantAreas: PublicArea[];
  status: "scheduled" | "cancelled";
  /** "Se repite cada domingo hasta el 28 feb 2027" (null si no se repite). */
  recurrenceLabel: string | null;
}

export interface PublicCalendar {
  churchName: string;
  timeZone: string;
  range: { from: Ymd; to: Ymd };
  areas: PublicArea[];
  events: PublicEvent[];
}
