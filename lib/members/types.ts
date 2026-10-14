// Tipos de vista del cliente de Integrantes › Consolidación V1 (doc 23 §3–§4).
// Se leen de Firestore (solo lectura) y se mapean de forma tolerante en
// ./client. Las fechas del servidor (Timestamp) llegan como hora de pared de
// America/Santiago ("YYYY-MM-DDTHH:mm"); las fechas locales, como "YYYY-MM-DD".
//
// Privacidad V1: NO existen aquí fecha de nacimiento, edad, confesión de fe,
// bautismo, notas iniciales, área de integración ni archivos.

import type {
  ArrivalSource,
  ClosedReason,
  ConsolidationStatus,
  FollowUpResult,
  FollowUpType,
  LifecycleStage,
  PersonChangeAction,
  PersonProjection,
} from "@/lib/shared/members";
import type { LocalDateTime, Ymd } from "@/lib/shared/types";

export type { LocalDateTime, Ymd };

/** `membersPeople/{id}`: estado actual + proyección del historial. */
export interface Person {
  id: string;
  fullName: string;
  /** E.164 normalizado por el servidor ("" si el documento no lo trae). */
  phoneE164: string;
  email: string | null;
  /** Fecha local de registro (inmutable). */
  entryDate: Ymd;
  /** Fecha de la primera visita (≤ hoy). */
  firstVisitAt: Ymd | null;
  arrivalSource: ArrivalSource | null;
  /** Actividad de llegada (solo el id; el título se lee aparte con calendar.read). */
  calendarEventId: string | null;
  invitedBy: string | null;
  lifecycleStage: LifecycleStage;
  consolidationStatus: ConsolidationStatus;
  closedReason: ClosedReason | null;
  followUpOwnerUid: string | null;
  doNotContact: boolean;
  createdAt: LocalDateTime | null;
  createdBy: string | null;
  updatedAt: LocalDateTime | null;
  revision: number;
  /** Derivados del historial (los mantiene la Function en la misma transacción). */
  projection: PersonProjection;
}

/** `membersVisits/{id}` (append-only). */
export interface Visit {
  id: string;
  personId: string;
  date: Ymd;
  calendarEventId: string | null;
  note: string | null;
  firstVisit: boolean;
  createdAt: LocalDateTime | null;
  createdBy: string | null;
}

/** `membersFollowUps/{id}` (append-only). */
export interface FollowUp {
  id: string;
  personId: string;
  contactDate: Ymd;
  type: FollowUpType;
  result: FollowUpResult;
  note: string | null;
  nextAction: string | null;
  nextActionDate: Ymd | null;
  ownerUid: string | null;
  createdAt: LocalDateTime | null;
  createdBy: string | null;
}

/** `membersPersonChanges/{id}` (auditoría append-only; los cambios de perfil no guardan valores). */
export interface PersonChange {
  id: string;
  personId: string;
  action: PersonChangeAction;
  field: string | null;
  from: string | boolean | null;
  to: string | boolean | null;
  /** Solo NOMBRES de campos de perfil. */
  changedFields: string[];
  reason: ClosedReason | null;
  reasonNote: string | null;
  refId: string | null;
  revision: number | null;
  actorUid: string | null;
  at: LocalDateTime | null;
}

/** `membersOwnerOptions`: usuarios activos con members.consolidation.manage (sin correos). */
export interface OwnerOption {
  uid: string;
  displayName: string;
}

export type AlertType =
  | "sin_responsable"
  | "sin_primer_contacto"
  | "seguimiento_vencido"
  | "volvio"
  | "varios_dias_sin_volver"
  | "posible_duplicado_telefono"
  | "posible_duplicado_correo";

export type AlertSeverity = "high" | "medium" | "positive";

/** Alerta derivada en el cliente (nunca se guarda). */
export interface Alert {
  type: AlertType;
  personId: string;
  severity: AlertSeverity;
  /** Desde cuándo aplica (para ordenar "lo más antiguo primero"). */
  since: Ymd;
  /** Texto corto en español. */
  detail: string;
  /** Duplicados: las otras personas del grupo. */
  otherIds?: string[];
}

export type TimelineKind = "created" | "visit" | "followup" | "change";

/** Ítem del historial de la ficha (derivado; del más nuevo al más antiguo). */
export type TimelineItem =
  | { id: string; kind: "created"; at: LocalDateTime; date: Ymd; by: string | null }
  | { id: string; kind: "visit"; at: LocalDateTime; date: Ymd; by: string | null; visit: Visit; isFirstVisit: boolean }
  | { id: string; kind: "followup"; at: LocalDateTime; date: Ymd; by: string | null; followUp: FollowUp }
  | { id: string; kind: "change"; at: LocalDateTime; date: Ymd; by: string | null; change: PersonChange };
