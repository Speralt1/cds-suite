"use client";

// Vocabulario visual de Consolidación (16b §9.1): estados del pipeline,
// badges derivados y alertas. Siempre ícono + texto (nunca solo color).

import {
  AlarmClock,
  BellOff,
  Cake,
  CalendarX2,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  Copy,
  DoorOpen,
  MessageCircle,
  PhoneMissed,
  PhoneOutgoing,
  Shield,
  Sprout,
  UserPlus,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { STATUS_LABEL, TRISTATE_LABEL } from "@/lib/suite-preview/consolidation";
import type { AlertType, ConsolidationStatus, TriState } from "@/lib/suite-preview/types";
import type { Tone } from "@/components/finance-preview/ui";

// ---------- Estados ----------

export const STATUS_VIS: Record<ConsolidationStatus, { icon: LucideIcon; tone: Tone; solid?: boolean }> = {
  por_contactar: { icon: PhoneOutgoing, tone: "warning" },
  en_seguimiento: { icon: MessageCircle, tone: "info" },
  integrandose: { icon: Sprout, tone: "success" },
  integrado: { icon: CircleCheck, tone: "success", solid: true },
  sin_continuidad: { icon: CircleSlash, tone: "neutral" },
};

/** StatusBadge del pipeline: ícono + texto + tono. */
export function PersonStatusBadge({ status, className = "" }: { status: ConsolidationStatus; className?: string }) {
  const v = STATUS_VIS[status];
  const Icon = v.icon;
  return (
    <span className={`fx-badge fx-tone-${v.tone} ${v.solid ? "sx-badge-solid" : ""} ${className}`}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

// ---------- Badges derivados ----------

export type DerivedBadge = "nuevo" | "volvio" | "menor" | "no_contactar";

const DERIVED: Record<DerivedBadge, { icon: LucideIcon; text: string; className: string }> = {
  nuevo: { icon: UserPlus, text: "Nuevo", className: "is-new" },
  volvio: { icon: DoorOpen, text: "Volvió", className: "is-returned" },
  menor: { icon: Shield, text: "Menor de edad", className: "is-minor" },
  no_contactar: { icon: BellOff, text: "No contactar", className: "is-dnc" },
};

export function DerivedBadgeView({ kind, short }: { kind: DerivedBadge; short?: boolean }) {
  const d = DERIVED[kind];
  const Icon = d.icon;
  const text = short && kind === "menor" ? "Menor" : d.text;
  return (
    <span className={`sx-dbadge ${d.className}`} title={short && kind === "menor" ? d.text : undefined}>
      <Icon size={11} strokeWidth={2.25} aria-hidden="true" />
      {text}
    </span>
  );
}

export function DerivedBadges({ kinds, short }: { kinds: DerivedBadge[]; short?: boolean }) {
  if (!kinds.length) return null;
  return (
    <span className="sx-dbadges">
      {kinds.map((k) => (
        <DerivedBadgeView key={k} kind={k} short={short} />
      ))}
    </span>
  );
}

// ---------- Alertas ----------

export const ALERT_VIS: Record<AlertType, { icon: LucideIcon; tone: Tone; label: string }> = {
  sin_responsable: { icon: UserX, tone: "review", label: "Sin responsable" },
  sin_primer_contacto: { icon: PhoneMissed, tone: "warning", label: "Sin primer contacto" },
  seguimiento_vencido: { icon: AlarmClock, tone: "warning", label: "Seguimiento vencido" },
  volvio: { icon: DoorOpen, tone: "success", label: "Volvió sin seguimiento" },
  varios_dias_sin_volver: { icon: CalendarX2, tone: "neutral", label: "Varios días sin volver" },
  posible_duplicado_telefono: { icon: Copy, tone: "info", label: "Posible duplicado (teléfono)" },
  posible_duplicado_correo: { icon: Copy, tone: "info", label: "Posible duplicado (correo)" },
  cumpleanos_proximo: { icon: Cake, tone: "info", label: "Cumpleaños próximo" },
};

/** Ícono de alerta en círculo de 32 px (o 28 / 14). */
export function AlertIcon({ type, size = 32 }: { type: AlertType; size?: number }) {
  const v = ALERT_VIS[type];
  const Icon = v.icon;
  return (
    <span className={`sx-alert-icon fx-tone-${v.tone}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}

// ---------- Tri-estado ----------

export function TriStateValue({ value }: { value: TriState }) {
  if (value === "sin_informacion")
    return (
      <span className="sx-tri-unknown">
        <CircleHelp size={14} aria-hidden="true" />
        {TRISTATE_LABEL.sin_informacion}
      </span>
    );
  return <span>{TRISTATE_LABEL[value]}</span>;
}
