import {
  Clock,
  AlarmClock,
  CircleDashed,
  CircleCheck,
  TriangleAlert,
  PenLine,
  Flag,
  Ban,
  Undo2,
  CloudOff,
  Lock,
  LockOpen,
  Timer,
  RotateCcw,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import { cx } from "./format";

export type StatusColor =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "review"
  | "neutral";

/** Tabla completa de estados del Design Lock (§4: movimientos/conciliación + caja). */
export type StatusKey =
  | "pendiente"
  | "atrasado"
  | "parcial"
  | "conciliado"
  | "con-diferencia"
  | "conciliado-ajuste"
  | "requiere-revision"
  | "anulado"
  | "reembolsado"
  | "sin-sincronizar"
  | "importado"
  | "caja-abierta"
  | "caja-en-cierre"
  | "caja-cerrada-cuadrada"
  | "caja-cerrada-diferencia"
  | "caja-reabierta"
  | "caja-depositada"
  | "caja-conciliada";

interface StatusConfig {
  label: string;
  icon: LucideIcon;
  icon2?: LucideIcon;
  color: StatusColor;
  strike?: boolean;
}

export const STATUS_CONFIG: Record<StatusKey, StatusConfig> = {
  pendiente: { label: "Pendiente", icon: Clock, color: "warning" },
  atrasado: { label: "Atrasado", icon: AlarmClock, color: "warning" },
  parcial: { label: "Parcial", icon: CircleDashed, color: "info" },
  conciliado: { label: "Conciliado", icon: CircleCheck, color: "success" },
  "con-diferencia": {
    label: "Diferencia",
    icon: TriangleAlert,
    color: "danger",
  },
  "conciliado-ajuste": {
    label: "Conciliado con ajuste",
    icon: CircleCheck,
    icon2: PenLine,
    color: "success",
  },
  "requiere-revision": {
    label: "Requiere revisión",
    icon: Flag,
    color: "review",
  },
  anulado: { label: "Anulado", icon: Ban, color: "neutral", strike: true },
  reembolsado: { label: "Reembolsado", icon: Undo2, color: "neutral" },
  "sin-sincronizar": {
    label: "Sin sincronizar",
    icon: CloudOff,
    color: "danger",
  },
  importado: { label: "SumUp", icon: Lock, color: "neutral" },
  "caja-abierta": { label: "Abierta", icon: LockOpen, color: "info" },
  "caja-en-cierre": { label: "En cierre", icon: Timer, color: "warning" },
  "caja-cerrada-cuadrada": {
    label: "Cerrada · cuadrada",
    icon: Lock,
    icon2: CircleCheck,
    color: "success",
  },
  "caja-cerrada-diferencia": {
    label: "Cerrada · con diferencia",
    icon: Lock,
    icon2: TriangleAlert,
    color: "danger",
  },
  "caja-reabierta": { label: "Reabierta v2", icon: RotateCcw, color: "review" },
  "caja-depositada": { label: "Depositada", icon: Landmark, color: "neutral" },
  "caja-conciliada": {
    label: "Conciliada",
    icon: CircleCheck,
    color: "success",
  },
};

export interface StatusBadgeProps {
  status: StatusKey;
  /**
   * Texto a mostrar en lugar de la etiqueta por defecto — para variantes con
   * detalle, p. ej. "Atrasado · 3 d", "Parcial · falta $12.000",
   * "Diferencia −$4.500", "Sin sincronizar · hace 2 d".
   */
  label?: string;
  className?: string;
}

/**
 * Estado siempre expresado con ícono + texto + color (nunca solo color).
 * Design Lock §4, criterio de aceptación 4 y 10 del Gate §5.
 */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const Icon2 = config.icon2;
  return (
    <span
      className={cx("p26-badge", `p26-badge--${config.color}`, className)}
    >
      <Icon aria-hidden="true" size={14} className="p26-badge__icon" />
      {Icon2 && (
        <Icon2 aria-hidden="true" size={12} className="p26-badge__icon" />
      )}
      <span className={cx(config.strike && "p26-badge__text--strike")}>
        {label ?? config.label}
      </span>
    </span>
  );
}
