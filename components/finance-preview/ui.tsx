"use client";

import { useEffect, useRef } from "react";
import {
  AlarmClock,
  Ban,
  BookX,
  CircleCheck,
  CircleDashed,
  Clock,
  CloudOff,
  Compass,
  Flag,
  FlaskConical,
  Landmark,
  Lock,
  LockKeyhole,
  LockOpen,
  Receipt,
  RotateCcw,
  TriangleAlert,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { clp, clpSpoken } from "@/lib/finance-preview/format";

// ---------- MoneyAmount ----------

export function MoneyAmount({
  value,
  basis,
  struck,
  size = "md",
  signed,
  diff,
  className = "",
}: {
  value: number;
  /** Agrega el sufijo "bruto" (SumUp). */
  basis?: "bruto";
  struck?: boolean;
  size?: "sm" | "md" | "lg";
  /** Muestra "+" en positivos (diferencias). */
  signed?: boolean;
  /** Una diferencia negativa se pinta en danger (además del signo). */
  diff?: boolean;
  className?: string;
}) {
  const text = signed && value > 0 ? `+${clp(value)}` : clp(value);
  const label = `${clpSpoken(value)}${basis ? ", bruto" : ""}${struck ? ", anulado" : ""}`;
  // El texto visible se oculta a lectores de pantalla y se lee la versión
  // hablada (con signo y base) desde un span visualmente oculto: un aria-label
  // sobre un <span> genérico no es fiable en todos los lectores.
  return (
    <span
      className={`fx-money ${size === "lg" ? "fx-money-lg" : ""} ${struck ? "is-struck" : ""} ${
        diff && value < 0 ? "fx-is-diff-neg" : ""
      } ${className}`}
    >
      <span aria-hidden="true">{text}</span>
      {basis && (
        <span className="fx-money-basis" aria-hidden="true">
          bruto
        </span>
      )}
      <span className="fx-sr">{label}</span>
    </span>
  );
}

// ---------- StatusBadge ----------

export type Tone = "success" | "warning" | "danger" | "info" | "review" | "neutral" | "proposal" | "example";

type StatusDef = { icon: LucideIcon; text: string; tone: Tone; title?: string };

export const STATUS = {
  proposal: {
    icon: Compass,
    text: "Propuesta",
    tone: "proposal",
    title: "Así funcionaría cuando exista; hoy CDS no registra esto.",
  },
  example: { icon: FlaskConical, text: "Ejemplo", tone: "example", title: "Monto de ejemplo, no es un dato real." },
  gross: { icon: Receipt, text: "Bruto", tone: "neutral", title: "Monto cobrado antes de la comisión SumUp." },
  sumupLocked: { icon: Lock, text: "SumUp · solo lectura", tone: "neutral" },
  voided: { icon: Ban, text: "Anulado", tone: "neutral" },
  refunded: { icon: Undo2, text: "Reembolsado", tone: "neutral" },
  reconciled: { icon: CircleCheck, text: "Conciliado", tone: "success" },
  difference: { icon: TriangleAlert, text: "Con diferencia", tone: "danger" },
  pending: { icon: Clock, text: "Pendiente", tone: "warning" },
  partial: { icon: CircleDashed, text: "Parcial", tone: "info" },
  overdue: { icon: AlarmClock, text: "Atrasado", tone: "warning" },
  open: { icon: LockOpen, text: "Abierta", tone: "info" },
  counting: { icon: Clock, text: "En conteo", tone: "warning" },
  closedBalanced: { icon: Lock, text: "Cerrada · cuadrada", tone: "success" },
  closedDifference: { icon: LockKeyhole, text: "Cerrada · con diferencia", tone: "danger" },
  reopened: { icon: RotateCcw, text: "Reabierta · v2", tone: "review" },
  deposited: { icon: Landmark, text: "Depositada", tone: "neutral" },
  unsynced: { icon: CloudOff, text: "Sin sincronizar", tone: "danger" },
  synced: { icon: CircleCheck, text: "Sincronizado", tone: "success" },
  missingCash: { icon: TriangleAlert, text: "Falta efectivo", tone: "warning" },
  noRecords: { icon: CircleDashed, text: "Sin registros", tone: "neutral" },
  recorded: { icon: CircleCheck, text: "Registrado", tone: "success" },
  feePending: { icon: Clock, text: "Comisión pendiente de datos de SumUp", tone: "warning" },
  outsideLedger: { icon: BookX, text: "Fuera del libro", tone: "neutral" },
  review: { icon: Flag, text: "Requiere revisión", tone: "review" },
  missingSession: { icon: TriangleAlert, text: "Sin cierre registrado", tone: "warning" },
  notComparable: { icon: CircleDashed, text: "No comparable", tone: "neutral" },
  campaignDone: { icon: CircleCheck, text: "Cerrada · meta cumplida", tone: "success" },
  cashPending: { icon: Clock, text: "Sin depositar", tone: "warning" },
  cashToday: { icon: Clock, text: "Por registrar", tone: "info", title: "Culto en curso: el efectivo se registra al terminar." },
} satisfies Record<string, StatusDef>;

export type StatusKey = keyof typeof STATUS;

export function StatusBadge({ status, detail, className = "" }: { status: StatusKey; detail?: string; className?: string }) {
  const s: StatusDef = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={`fx-badge fx-tone-${s.tone} ${className}`} title={s.title}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {s.text}
      {detail ? ` · ${detail}` : ""}
      {s.title && <span className="fx-sr">. {s.title}</span>}
    </span>
  );
}

export const ProposalPill = () => <StatusBadge status="proposal" />;
export const ExampleBadge = () => <StatusBadge status="example" />;

// ---------- Panel ----------

export function Panel({
  title,
  action,
  children,
  flush,
  className = "",
  as: Tag = "section",
  labelledBy,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
  as?: "section" | "div" | "article";
  labelledBy?: string;
}) {
  return (
    <Tag className={`fx-panel ${flush ? "fx-panel-flush" : ""} ${className}`} aria-labelledby={labelledBy}>
      {(title || action) && (
        <div className="fx-panel-head">
          {title && (
            <h2 className="fx-h2" id={labelledBy}>
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </Tag>
  );
}

// ---------- Empty / Error / Skeleton ----------

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="fx-empty">
      <span className="fx-empty-icon" aria-hidden="true">
        <Icon size={24} />
      </span>
      <p className="fx-empty-title">{title}</p>
      {body && <p className="fx-empty-body">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ onRetry, title, body }: { onRetry: () => void; title?: string; body?: string }) {
  return (
    <div className="fx-empty" role="alert">
      <span className="fx-empty-icon" style={{ background: "var(--fx-danger-bg)", color: "var(--fx-danger)" }} aria-hidden="true">
        <CloudOff size={24} />
      </span>
      <p className="fx-empty-title">{title ?? "No pudimos cargar los datos"}</p>
      <p className="fx-empty-body">{body ?? "Revisa tu conexión e inténtalo de nuevo."}</p>
      <button type="button" className="fx-btn fx-btn-secondary" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

export function Skeleton({ h, w = "100%", style }: { h: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="fx-skel" style={{ height: h, width: w, ...style }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 8, h = 44 }: { rows?: number; h?: number }) {
  return (
    <div style={{ display: "grid", gap: 8 }} aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={h - 8} />
      ))}
    </div>
  );
}

// ---------- Sheet / Dialog (dialog nativo) ----------

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  variant = "side",
  labelId,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: "side" | "center";
  labelId: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const handleClose = () => {
      onClose();
      returnFocus.current?.focus?.();
    };
    d.addEventListener("close", handleClose);
    return () => d.removeEventListener("close", handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`fx-dialog ${variant === "center" ? "is-center" : ""}`}
      aria-labelledby={labelId}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      {open && (
        <>
          <div className="fx-sheet-handle" aria-hidden="true" />
          <div className="fx-sheet-head">
            <div style={{ minWidth: 0 }}>
              <h2 id={labelId} className="fx-h2" tabIndex={-1} data-autofocus style={{ fontSize: 17, lineHeight: "24px" }}>
                {title}
              </h2>
              {subtitle && <div className="fx-help-13" style={{ marginTop: 4 }}>{subtitle}</div>}
            </div>
            <button type="button" className="fx-close" aria-label="Cerrar" onClick={() => ref.current?.close()}>
              <X size={20} />
            </button>
          </div>
          <div className="fx-sheet-body">{children}</div>
          {footer && <div className="fx-sheet-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** Callout con ícono + texto (nunca solo color). */
export function Callout({
  tone,
  icon: Icon,
  children,
}: {
  tone: Exclude<Tone, "example">;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className={`fx-callout fx-tone-${tone}`}>
      <Icon size={16} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
