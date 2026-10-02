// Tipos de dominio de la preview de CDS Suite (Calendario + Integrantes).
// Puros: sin React, sin Firebase. Diseñados para promoverse a producción.
// Fechas y horas son LOCALES a America/Santiago, nunca instantes UTC.

/** "YYYY-MM-DD" (fecha local). */
export type Ymd = string;
/** "HH:mm" (hora de pared). */
export type HHmm = string;
/** "YYYY-MM-DDTHH:mm" (fecha y hora local). */
export type LocalDateTime = string;

// ---------- Acceso ----------

export const PERMISSIONS = [
  "finance.summary.read",
  "finance.details.read",
  "finance.records.manage",
  "finance.pastoral.manage",
  "calendar.read",
  "calendar.events.manage_assigned",
  "calendar.events.manage_all",
  "members.consolidation.read",
  "members.consolidation.manage",
  "settings.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type BaseRole = "admin" | "standard";
export const CARGOS = ["Administración", "Pastor", "Líder", "Diácono", "Finanzas", "Consolidación"] as const;
export type Cargo = (typeof CARGOS)[number];

export type ModuleId = "finanzas" | "calendario" | "integrantes" | "reportes" | "configuracion";
export type InitialModule = "finanzas" | "calendario" | "integrantes/consolidacion";
export type LegacyRole = "admin" | "pastor" | "finance" | "leader";

export interface AccessProfile {
  /** En la preview el uid es el slug de `?perfil=` (admin, pastor, lider…). */
  uid: string;
  displayName: string;
  email: string;
  active: boolean;
  baseRole: BaseRole;
  cargo: Cargo;
  /** Permisos guardados (sin cierre). `settings.manage` nunca va aquí. */
  permissions: Permission[];
  areaIds: string[];
  initialModule: InitialModule;
  legacyRole?: LegacyRole;
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

export interface Area {
  /** Slug estable. */
  id: string;
  name: string;
  color: AreaColor;
  description?: string;
  active: boolean;
  order: number;
}

export interface AreaInput {
  /** Ausente = área nueva. */
  id?: string;
  name: string;
  color: AreaColor;
  description?: string;
  active?: boolean;
}

// ---------- Calendario ----------

export type Visibility = "public" | "team";
/** Estado guardado. "realizada" es derivado (ver OccurrenceStatus). */
export type EventStatus = "programada" | "cancelada" | "archivada";
export type OccurrenceStatus = "programada" | "realizada" | "cancelada";
export type Freq = "none" | "weekly" | "biweekly" | "monthly";
/** 1.º–4.º o -1 = último. */
export type Ordinal = 1 | 2 | 3 | 4 | -1;

export interface MonthlyRule {
  /** Discriminador extensible ("day_of_month" queda para el siguiente slice). */
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

export interface RecurrenceException {
  date: Ymd;
  /** "modified" queda reservado para el siguiente slice. */
  type: "cancelled";
  /** Interno: nunca se publica. */
  reason: string;
  by: string;
  at: LocalDateTime;
}

export interface SeriesCancellation {
  from: Ymd;
  reason: string;
  by: string;
  at: LocalDateTime;
}

export interface CalendarEvent {
  id: string;
  title: string;
  responsibleAreaId: string;
  participantAreaIds: string[];
  startDate: Ymd;
  /** = startDate si dura un día; > startDate en vigilias y campamentos. */
  endDate: Ymd;
  allDay: boolean;
  startTime?: HHmm;
  endTime?: HHmm;
  location?: string;
  publicDescription?: string;
  /** Visible para todo calendar.read. Nunca se publica. */
  internalNotes?: string;
  visibility: Visibility;
  status: EventStatus;
  recurrence: RecurrenceRule;
  exceptions: RecurrenceException[];
  seriesCancellation?: SeriesCancellation;
  createdBy: string;
  createdAt: LocalDateTime;
  updatedBy?: string;
  updatedAt?: LocalDateTime;
  cancelledBy?: string;
  cancelledAt?: LocalDateTime;
  cancelReason?: string;
  archivedBy?: string;
  archivedAt?: LocalDateTime;
  archiveReason?: string;
  revision: number;
}

export type EventChangeAction =
  | "created"
  | "updated"
  | "cancelled"
  | "cancelled_occurrence"
  | "cancelled_series"
  | "archived";

export interface EventChange {
  id: string;
  eventId: string;
  at: LocalDateTime;
  by: string;
  action: EventChangeAction;
  changedFields: string[];
  /** Fecha de la ocurrencia afectada (cancelled_occurrence). */
  date?: Ymd;
}

/** Una fecha concreta de una actividad (derivada de su recurrencia). */
export interface Occurrence {
  /** `${eventId}@${date}`: clave estable para React y para el detalle. */
  key: string;
  eventId: string;
  event: CalendarEvent;
  date: Ymd;
  endDate: Ymd;
  allDay: boolean;
  startTime?: HHmm;
  endTime?: HHmm;
  status: OccurrenceStatus;
  /** Interno (motivo de la excepción, de la serie o de la actividad). */
  cancelReason?: string;
  isRecurring: boolean;
}

export interface EventInput {
  title: string;
  responsibleAreaId: string;
  participantAreaIds?: string[];
  startDate: Ymd;
  endDate?: Ymd;
  allDay?: boolean;
  startTime?: HHmm;
  endTime?: HHmm;
  location?: string;
  publicDescription?: string;
  internalNotes?: string;
  visibility?: Visibility;
  recurrence?: RecurrenceRule;
}

/** Cambios de "Editar toda la serie" (o de una actividad sin recurrencia). */
export type EventPatch = Partial<EventInput>;

export interface ShareLink {
  id: string;
  /** Preview: token legible de demostración. Producción: solo se guarda su hash. */
  token: string;
  active: boolean;
  createdAt: LocalDateTime;
  createdBy: string;
  regeneratedAt?: LocalDateTime;
  regeneratedBy?: string;
  deactivatedAt?: LocalDateTime;
  deactivatedBy?: string;
}

export interface PublicArea {
  slug: string;
  name: string;
  color: AreaColor;
}

/** Proyección pública: claves EXACTAS de PUBLIC_EVENT_KEYS (ausentes → null). */
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
  status: "programada" | "cancelada";
  /** "Se repite cada domingo hasta el 28 feb 2027" (null si no se repite). */
  recurrenceLabel: string | null;
}

export interface PublicCalendar {
  churchName: string;
  range: { from: Ymd; to: Ymd };
  areas: PublicArea[];
  events: PublicEvent[];
}

// ---------- Integrantes › Consolidación ----------

export type TriState = "si" | "no" | "sin_informacion";
export type LifecycleStage = "en_consolidacion" | "integrante";
export type ConsolidationStatus = "por_contactar" | "en_seguimiento" | "integrandose" | "integrado" | "sin_continuidad";
export type ClosedReason = "no_responde" | "cambio_iglesia" | "se_mudo" | "no_desea_contacto" | "otro";

export interface Person {
  id: string;
  fullName: string;
  phoneE164: string;
  /** Lo que se escribió (se muestra tal cual para números extranjeros). */
  phoneRaw: string;
  email?: string;
  birthDate?: Ymd;
  faithConfession: TriState;
  baptized: TriState;
  /** Fecha local de registro (inmutable). */
  entryDate: Ymd;
  createdAt: LocalDateTime;
  createdBy: string;
  initialNotes?: string;
  followUpOwnerUid: string | null;
  lifecycleStage: LifecycleStage;
  consolidationStatus: ConsolidationStatus;
  closedReason?: ClosedReason;
  doNotContact: boolean;
  /** Área donde se está integrando (informativo). */
  integrationAreaId?: string;
  revision: number;
}

export interface Visit {
  id: string;
  personId: string;
  date: Ymd;
  activityEventId?: string;
  activityLabel?: string;
  note?: string;
  voided: boolean;
  voidReason?: string;
  /** Quién y cuándo anuló la visita (visit/void). */
  voidedBy?: string;
  voidedAt?: LocalDateTime;
  createdBy: string;
  createdAt: LocalDateTime;
}

export type FollowUpType = "whatsapp" | "llamada" | "presencial" | "otro";
export type FollowUpResult = "contactado" | "sin_respuesta" | "numero_invalido" | "no_desea_contacto" | "otro";

export interface FollowUp {
  id: string;
  personId: string;
  at: LocalDateTime;
  type: FollowUpType;
  result: FollowUpResult;
  note?: string;
  nextAction?: string;
  nextActionDate?: Ymd;
  /** Responsable de la próxima acción. */
  ownerUid: string | null;
  createdBy: string;
}

export type PersonChangeField = "status" | "owner" | "faithConfession" | "baptized" | "stage" | "doNotContact";

export interface PersonChange {
  id: string;
  personId: string;
  at: LocalDateTime;
  by: string;
  field: PersonChangeField;
  from: string | null;
  to: string | null;
  reason?: string;
}

export interface ConsolidationSettings {
  firstContactMaxHours: number;
  noReturnDays: number;
  birthdayLeadDays: number;
  recentNewDays: number;
  returnedRecentDays: number;
}

export type AlertType =
  | "sin_responsable"
  | "sin_primer_contacto"
  | "seguimiento_vencido"
  | "cumpleanos_proximo"
  | "volvio"
  | "varios_dias_sin_volver"
  | "posible_duplicado_telefono"
  | "posible_duplicado_correo";

export type AlertSeverity = "high" | "medium" | "low" | "positive";

export interface Alert {
  type: AlertType;
  personId: string;
  severity: AlertSeverity;
  /** Desde cuándo aplica (para ordenar "lo más antiguo primero"). */
  since: Ymd;
  /** Texto corto en español para la UI. */
  detail: string;
  /** Duplicados: las otras personas del grupo. */
  otherIds?: string[];
}

export interface TimelineItem {
  id: string;
  kind: "created" | "visit" | "followup" | "change";
  at: LocalDateTime;
  title: string;
  detail?: string;
  by?: string;
  isFirstVisit?: boolean;
  voided?: boolean;
}

export interface PersonInput {
  fullName: string;
  phone: string;
  email?: string;
  birthDate?: Ymd;
  faithConfession?: TriState;
  baptized?: TriState;
  initialNotes?: string;
  followUpOwnerUid?: string | null;
  /** "Llegó a": actividad de la primera visita (opcional). */
  arrivedEventId?: string;
  arrivedLabel?: string;
}

export interface PersonPatch {
  fullName?: string;
  phone?: string;
  email?: string;
  birthDate?: Ymd | null;
  faithConfession?: TriState;
  baptized?: TriState;
  initialNotes?: string;
  doNotContact?: boolean;
  integrationAreaId?: string | null;
}

export interface VisitInput {
  personId: string;
  date: Ymd;
  activityEventId?: string;
  activityLabel?: string;
  note?: string;
}

export interface FollowUpInput {
  personId: string;
  /** Por defecto: ahora. */
  at?: LocalDateTime;
  type: FollowUpType;
  result: FollowUpResult;
  note?: string;
  nextAction?: string;
  nextActionDate?: Ymd;
  /** Por defecto: el responsable de la persona. */
  ownerUid?: string | null;
}
