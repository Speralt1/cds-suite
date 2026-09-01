"use client";
import { useEffect, useRef, useId } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { MONTHS } from "@/lib/finance/constants";
import { useAccess } from "@/lib/auth/access-provider";
import { canSeeDetails } from "@/lib/finance/permissions";
import type { PeriodSelection } from "@/lib/finance/types";
export function FinanceNav() {
  const path = usePathname();
  const access = useAccess();
  const items = canSeeDetails(access.role)
    ? [
        ["/finanzas", "Resumen"],
        ["/finanzas/movimientos", "Movimientos"],
        ["/finanzas/diezmos", "Diezmos"],
        ["/finanzas/reportes", "Reportes"],
      ]
    : [["/finanzas", "Resumen"]];
  return (
    <nav aria-label="Secciones de Finanzas" className="finance-nav">
      {items.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={
            (href === "/finanzas" ? path === href : path.startsWith(href))
              ? "page"
              : undefined
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
export function PeriodPicker({
  value,
  onChange,
  monthlyOnly = false,
}: {
  value: PeriodSelection;
  onChange: (p: PeriodSelection) => void;
  monthlyOnly?: boolean;
}) {
  return (
    <div className="period-picker">
      {!monthlyOnly && (
        <label>
          Vista
          <select
            value={value.view}
            onChange={(e) =>
              onChange({
                ...value,
                view: e.target.value as PeriodSelection["view"],
              })
            }
          >
            <option value="month">Mensual</option>
            <option value="year">Anual</option>
          </select>
        </label>
      )}
      {value.view === "month" && (
        <label>
          Mes
          <select
            value={value.month}
            onChange={(e) =>
              onChange({ ...value, month: Number(e.target.value) })
            }
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Año
        <select
          value={value.year}
          onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}
        >
          {Array.from({ length: 100 }, (_, i) => 2000 + i)
            .reverse()
            .map((y) => (
              <option key={y}>{y}</option>
            ))}
        </select>
      </label>
    </div>
  );
}
export function FinancePageHeader({
  title,
  subtitle,
  period,
  actions,
}: {
  title: string;
  subtitle: string;
  period: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="finance-page-header">
      <div className="finance-page-title">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="finance-page-controls">
        {period}
        {actions && <div className="finance-page-actions">{actions}</div>}
      </div>
    </div>
  );
}
export function Notice({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="notice success">
          {success}
        </p>
      )}
    </>
  );
}
export function Loading() {
  return (
    <div role="status" className="panel py-10">
      <span className="animate-pulse">Consultando información…</span>
    </div>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="panel empty">{children}</div>;
}
export function DetailGuard({ children }: { children: React.ReactNode }) {
  return canSeeDetails(useAccess().role) ? (
    children
  ) : (
    <Empty>
      Esta sección está reservada para los roles de administración, pastor y
      finanzas.{" "}
      <Link className="text-primary underline" href="/finanzas">
        Volver al resumen
      </Link>
    </Empty>
  );
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const active = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      dialog?.close();
      active?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="finance-modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Cerrar formulario"
          onClick={onClose}
          disabled={busy}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function TypeIcon({ income }: { income: boolean }) {
  const Icon = income ? ArrowDownLeft : ArrowUpRight;
  return (
    <span className={`type-icon ${income ? "income" : "expense"}`}>
      <Icon size={18} />
    </span>
  );
}
