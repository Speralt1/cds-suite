import Link from "next/link";
import { TriangleAlert, CloudOff, Link2 } from "lucide-react";
import { MoneyAmount } from "@/components/preview2026/money-amount";
import { StatusBadge } from "@/components/preview2026/status-badge";
import {
  ATTENTION_ITEMS,
  ACTIVITY_LOG,
  CASH_SESSIONS,
  TODAY_SUMMARY,
} from "@/components/preview2026/fixtures";
import { formatDateTime } from "@/components/preview2026/format";

const ATTENTION_ICON = {
  diff: TriangleAlert,
  sync: CloudOff,
  link: Link2,
} as const;

/**
 * Home "Hoy" del preview 2026. Sin KPI grid: prioriza atención y decisiones
 * (Design Lock §3, reglas de la Home).
 */
export default function Preview2026HoyPage() {
  const ofrendasCaja = CASH_SESSIONS.find((c) => c.source === "ofrendas");
  const cafeteriaCaja = CASH_SESSIONS.find((c) => c.source === "cafeteria" && c.status === "caja-abierta");
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-medium">Hoy · {TODAY_SUMMARY.label}</h1>
        <Link href="/preview/finanzas-2026/movimientos" className="p26-button p26-button--primary">
          + Registrar
        </Link>
      </div>

      <section
        aria-labelledby="p26-attention-heading"
        className="mb-8 rounded-[var(--p26-radius-panel)] border p-4"
        style={{ borderColor: "var(--p26-line)" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="p26-attention-heading" className="text-sm font-semibold">
            Necesita atención ({ATTENTION_ITEMS.length})
          </h2>
          <Link href="/preview/finanzas-2026/movimientos" className="text-sm text-[var(--p26-primary)]">
            Ver todo →
          </Link>
        </div>
        <ul className="flex flex-col gap-2">
          {ATTENTION_ITEMS.map((item) => {
            const Icon = ATTENTION_ICON[item.icon];
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-[var(--p26-radius-control)] px-3 py-2"
                style={{ background: "var(--p26-canvas)" }}
              >
                <span className="flex items-center gap-2 text-sm">
                  <Icon size={16} aria-hidden="true" style={{ color: "var(--p26-warning)" }} />
                  {item.text}
                  {item.amount !== null && (
                    <MoneyAmount value={item.amount} className="ml-1" />
                  )}
                </span>
                <Link href={item.href} className="p26-button p26-button--secondary" style={{ height: 32 }}>
                  {item.action}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section
          aria-labelledby="p26-ingresos-heading"
          className="rounded-[var(--p26-radius-panel)] border p-4"
          style={{ borderColor: "var(--p26-line)" }}
        >
          <h2 id="p26-ingresos-heading" className="mb-3 text-sm font-semibold">
            Ingresos de hoy
          </h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between">
              <dt>Ofrendas</dt>
              <dd>
                <MoneyAmount value={TODAY_SUMMARY.ofrendas.total} />
              </dd>
            </div>
            <div className="flex items-baseline justify-between pl-4 text-[var(--p26-muted)]">
              <dt>Efectivo contado</dt>
              <dd>
                <MoneyAmount value={TODAY_SUMMARY.ofrendas.efectivoContado} basis="contado" />
              </dd>
            </div>
            <div className="flex items-baseline justify-between pl-4 text-[var(--p26-muted)]">
              <dt>Tarjeta</dt>
              <dd>
                <MoneyAmount value={TODAY_SUMMARY.ofrendas.tarjetaBruto} basis="bruto" />
              </dd>
            </div>
            <div className="flex items-baseline justify-between border-t pt-2" style={{ borderColor: "var(--p26-line)" }}>
              <dt>Cafetería</dt>
              <dd>
                <MoneyAmount value={TODAY_SUMMARY.cafeteria.bruto} basis="bruto" />
              </dd>
            </div>
            <p className="text-xs text-[var(--p26-muted)]">
              Ofrendas y Cafetería nunca se suman entre sí.
            </p>
            <div className="flex items-baseline justify-between border-t pt-2" style={{ borderColor: "var(--p26-line)" }}>
              <dt>Diezmos</dt>
              <dd>
                <MoneyAmount value={TODAY_SUMMARY.diezmos} />
              </dd>
            </div>
          </dl>
        </section>

        <section
          aria-labelledby="p26-caja-heading"
          className="rounded-[var(--p26-radius-panel)] border p-4"
          style={{ borderColor: "var(--p26-line)" }}
        >
          <h2 id="p26-caja-heading" className="mb-3 text-sm font-semibold">
            Caja
          </h2>
          <ul className="flex flex-col gap-3 text-sm">
            {ofrendasCaja && (
              <li className="flex items-center justify-between">
                <span>Ofrendas</span>
                <StatusBadge status={ofrendasCaja.status} label="Cerrada · con diferencia" />
              </li>
            )}
            {cafeteriaCaja && (
              <li className="flex items-center justify-between">
                <span>Cafetería</span>
                <StatusBadge status={cafeteriaCaja.status} label={`Abierta ${new Date(cafeteriaCaja.openedAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`} />
              </li>
            )}
            <Link href="/preview/finanzas-2026/caja/cerrar" className="p26-button p26-button--secondary self-start">
              Ir a caja
            </Link>
          </ul>
        </section>

        <section
          aria-labelledby="p26-por-recibir-heading"
          className="rounded-[var(--p26-radius-panel)] border p-4"
          style={{ borderColor: "var(--p26-line)" }}
        >
          <h2 id="p26-por-recibir-heading" className="mb-3 text-sm font-semibold">
            Por recibir
          </h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between">
              <dt>SumUp Ofrendas</dt>
              <dd aria-label="comisión no disponible">—</dd>
            </div>
            <p className="text-xs text-[var(--p26-muted)]">Comisión no disponible.</p>
            <div className="flex items-baseline justify-between border-t pt-2" style={{ borderColor: "var(--p26-line)" }}>
              <dt>Efectivo a depositar</dt>
              <dd>
                <MoneyAmount value={TODAY_SUMMARY.porRecibir.efectivoADepositar} />
              </dd>
            </div>
          </dl>
        </section>

        <section
          aria-labelledby="p26-actividad-heading"
          className="rounded-[var(--p26-radius-panel)] border p-4"
          style={{ borderColor: "var(--p26-line)" }}
        >
          <h2 id="p26-actividad-heading" className="mb-3 text-sm font-semibold">
            Actividad reciente
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {ACTIVITY_LOG.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-3">
                <span>
                  {entry.actor} {entry.action}
                </span>
                <span className="text-[var(--p26-muted)]">{formatDateTime(entry.timestamp)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
