"use client";

// Vocabulario visual de Consolidación (16b §9.1): estados del pipeline,
// badges derivados y alertas. Siempre ícono + texto (nunca solo color).
// Excluido en V1: "Menor", cumpleaños y tri-estado de fe/bautismo.

import {
  AlarmClock,
  BellOff,
  CalendarX2,
  CircleCheck,
  CircleSlash,
  Copy,
  DoorOpen,
  MessageCircle,
  PhoneMissed,
  PhoneOutgoing,
  Sprout,
  UserPlus,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { STATUS_LABEL, type ConsolidationStatus } from "@/lib/shared/members";
import { ALERT_LABEL, type DerivedBadge } from "@/lib/members/consolidation";
import type { AlertType } from "@/lib/members/types";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "review";

// ---------- Estados ----------

export const STATUS_VIS: Record<ConsolidationStatus, { icon: LucideIcon; tone: Tone; solid?: boolean }> = {
  por_contactar: { icon: PhoneOutgoing, tone: "warning" },
  en_seguimiento: { icon: MessageCircle, tone: "info" },
  integrandose: { icon: Sprout, tone: "success" },
  integrado: { icon: CircleCheck, tone: "success", solid: true },
  sin_continuidad: { icon: CircleSlash, tone: "neutral" },
};

/** Estado del pipeline: ícono + texto + tono. */
export function PersonStatusBadge({ status, className = "" }: { status: ConsolidationStatus; className?: string }) {
  const v = STATUS_VIS[status];
  const Icon = v.icon;
  return (
    <span className={`mem-badge mem-tone-${v.tone}${v.solid ? " is-solid" : ""} ${className}`}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

// ---------- Badges derivados ----------

const DERIVED: Record<DerivedBadge, { icon: LucideIcon; text: string; className: string }> = {
  nuevo: { icon: UserPlus, text: "Nuevo", className: "is-new" },
  volvio: { icon: DoorOpen, text: "Volvió", className: "is-returned" },
  no_contactar: { icon: BellOff, text: "No contactar", className: "is-dnc" },
};

export function DerivedBadgeView({ kind }: { kind: DerivedBadge }) {
  const d = DERIVED[kind];
  const Icon = d.icon;
  return (
    <span className={`mem-dbadge ${d.className}`}>
      <Icon size={11} strokeWidth={2.25} aria-hidden="true" />
      {d.text}
    </span>
  );
}

export function DerivedBadges({ kinds }: { kinds: DerivedBadge[] }) {
  if (!kinds.length) return null;
  return (
    <span className="mem-dbadges">
      {kinds.map((k) => (
        <DerivedBadgeView key={k} kind={k} />
      ))}
    </span>
  );
}

// ---------- Alertas ----------

export const ALERT_VIS: Record<AlertType, { icon: LucideIcon; tone: Tone; label: string }> = {
  sin_responsable: { icon: UserX, tone: "review", label: ALERT_LABEL.sin_responsable },
  sin_primer_contacto: { icon: PhoneMissed, tone: "warning", label: ALERT_LABEL.sin_primer_contacto },
  seguimiento_vencido: { icon: AlarmClock, tone: "warning", label: ALERT_LABEL.seguimiento_vencido },
  volvio: { icon: DoorOpen, tone: "success", label: ALERT_LABEL.volvio },
  varios_dias_sin_volver: { icon: CalendarX2, tone: "neutral", label: ALERT_LABEL.varios_dias_sin_volver },
  posible_duplicado_telefono: { icon: Copy, tone: "info", label: ALERT_LABEL.posible_duplicado_telefono },
  posible_duplicado_correo: { icon: Copy, tone: "info", label: ALERT_LABEL.posible_duplicado_correo },
};

/** Ícono de alerta en círculo (32 / 28 px). */
export function AlertIcon({ type, size = 32 }: { type: AlertType; size?: number }) {
  const v = ALERT_VIS[type];
  const Icon = v.icon;
  return (
    <span className={`mem-alert-icon mem-tone-${v.tone}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}
