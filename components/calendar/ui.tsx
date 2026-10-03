"use client";

// Primitivas visuales del Calendario sobre las clases productivas
// (button-primary/secondary/ghost/danger, panel) y CSS propio `cal-*`.
// Diálogos y sheets: <dialog> nativo (mismo patrón que el `Modal` de Finanzas):
// se montan solo abiertos, Esc y el fondo cierran y el foco vuelve al control
// que los abrió.

import { useEffect, useId, useRef } from "react";
import { RefreshCw, TriangleAlert, X, type LucideIcon } from "lucide-react";

export function CalDialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  variant = "side",
  busy = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** side = sheet lateral (pantalla completa en móvil); center = diálogo. */
  variant?: "side" | "center";
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  useEffect(() => {
    busyRef.current = busy;
    closeRef.current = onClose;
  });

  useEffect(() => {
    const d = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (d && !d.open) {
      try {
        if (typeof d.showModal === "function") d.showModal();
        else d.setAttribute("open", "");
      } catch {
        d.setAttribute("open", "");
      }
    }
    d?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      if (d?.open && typeof d.close === "function") d.close();
      opener?.focus?.();
    };
  }, []);

  const requestClose = () => {
    if (!busyRef.current) closeRef.current();
  };

  return (
    <dialog
      ref={ref}
      className={`cal-dialog ${variant === "center" ? "is-center" : "is-side"}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="cal-dialog-head">
        <div className="cal-dialog-titles">
          <h2 id={titleId} className="cal-dialog-title" tabIndex={-1} data-autofocus>
            {title}
          </h2>
          {subtitle && <div className="cal-dialog-subtitle">{subtitle}</div>}
        </div>
        <button type="button" className="cal-icon-btn" aria-label="Cerrar" onClick={requestClose} disabled={busy}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="cal-dialog-body">{children}</div>
      {footer && <div className="cal-dialog-foot">{footer}</div>}
    </dialog>
  );
}

export type BadgeTone = "info" | "neutral" | "warning" | "success" | "danger";

export function CalBadge({ icon: Icon, text, tone }: { icon: LucideIcon; text: string; tone: BadgeTone }) {
  return (
    <span className={`cal-badge cal-tone-${tone}`}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {text}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="cal-empty">
      <span className="cal-empty-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <h3 className="cal-empty-title">{title}</h3>
      {body && <p className="cal-empty-body">{body}</p>}
      {action && <div className="cal-empty-action">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel = "Reintentar",
}: {
  title: string;
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="cal-empty" role="alert">
      <span className="cal-empty-icon is-danger" aria-hidden="true">
        <TriangleAlert size={22} />
      </span>
      <h3 className="cal-empty-title">{title}</h3>
      {body && <p className="cal-empty-body">{body}</p>}
      {onRetry && (
        <div className="cal-empty-action">
          <button type="button" className="button-secondary" onClick={onRetry}>
            <RefreshCw size={16} aria-hidden="true" /> {retryLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function Skeleton({ h = 16, w, style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <span className="cal-skeleton" style={{ height: h, width: w ?? "100%", ...style }} aria-hidden="true" />;
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="cal-field-error" id={id}>
      <TriangleAlert size={14} aria-hidden="true" />
      {message}
    </p>
  );
}

/** Aviso con ícono + texto (nunca solo color). */
export function InlineNotice({
  tone,
  icon: Icon,
  children,
  id,
  role,
}: {
  tone: "info" | "warning" | "danger" | "success";
  icon: LucideIcon;
  children: React.ReactNode;
  id?: string;
  role?: "alert" | "status";
}) {
  return (
    <div className={`cal-notice cal-tone-${tone}`} id={id} role={role}>
      <Icon size={16} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="cal-page-header">
      <div className="cal-page-header-text">
        <h2 className="cal-page-title">{title}</h2>
        {subtitle && <div className="cal-page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="cal-page-actions">{actions}</div>}
    </header>
  );
}
