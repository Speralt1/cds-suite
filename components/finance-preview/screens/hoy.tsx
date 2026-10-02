"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Clock,
  Equal,
  Info,
  Inbox,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { ACTIVITY, CAMPAIGNS, CASH_SESSIONS, DEMO_TODAY, INTEGRATIONS, TRANSACTIONS } from "@/lib/finance-preview/fixtures";
import { dayMonth, timeOf, variation, shortDate } from "@/lib/finance-preview/format";
import {
  attentionItems,
  headlineMetrics,
  incomeBySource,
  monthlySeries,
  periodTitle,
  type Metric,
} from "@/lib/finance-preview/selectors";
import { SOURCE } from "@/lib/finance-preview/types";
import { FinancialChart, SERIES_COLOR, SourceBreakdown } from "../charts";
import { AttentionList } from "../attention";
import { usePreview } from "../context";
import { FinancialHeader, TODAY_LABEL, BASE } from "../shell";
import { EmptyState, ErrorState, MoneyAmount, Panel, ProposalPill, Skeleton, StatusBadge } from "../ui";

const METRIC_ICON = { income: ArrowDownLeft, expense: ArrowUpRight, result: Equal };
const METRIC_HOW: Record<Metric["id"], string> = {
  income:
    "Suma los ingresos activos del período: diezmos, efectivo, transferencias y tarjeta SumUp en bruto (menos devoluciones). No incluye anulados ni campañas, que se llevan fuera del libro.",
  expense: "Suma los gastos activos registrados en el período. La comisión SumUp aún no se registra como gasto.",
  result:
    "Ingresos registrados menos gastos registrados. Es un resultado contable del período: no representa el dinero disponible en el banco.",
};
const METRIC_LINK: Record<Metric["id"], string> = {
  income: `${BASE}/movimientos?tipo=income`,
  expense: `${BASE}/movimientos?tipo=expense`,
  result: `${BASE}/reportes`,
};

export function MetricCard({ m }: { m: Metric }) {
  const [how, setHow] = useState(false);
  const Icon = METRIC_ICON[m.id];
  const v = m.previous !== null ? variation(m.value, m.previous) : null;
  const id = `metric-${m.id}`;
  return (
    <section className="fx-panel fx-metric" aria-labelledby={id}>
      <div className="fx-metric-label">
        <span className="fx-metric-icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <h2 id={id} style={{ font: "inherit" }}>
          {m.label}
        </h2>
        <button
          type="button"
          className="fx-metric-info"
          aria-expanded={how}
          aria-controls={`${id}-how`}
          aria-label={`Cómo se calcula ${m.label}`}
          onClick={() => setHow((x) => !x)}
        >
          <Info size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="fx-metric-value">
        <MoneyAmount value={m.value} />
      </p>
      {v ? (
        <p className="fx-metric-delta">
          {v.value >= 0 ? <TrendingUp size={14} aria-hidden="true" /> : <TrendingDown size={14} aria-hidden="true" />}
          <span className="fx-num">{v.label}</span> <span className="fx-help">{m.comparisonLabel}</span>
        </p>
      ) : (
        <p className="fx-metric-delta is-muted">
          {m.comparabilityNote ? m.comparabilityNote.replace(/^No homogénea:/, "Sin comparación:") : "Sin base comparable"}
        </p>
      )}
      {m.comparabilityNote && v && <p className="fx-help" style={{ marginTop: 2 }}>{m.comparabilityNote}</p>}
      {how && (
        <p className="fx-popover" id={`${id}-how`}>
          {METRIC_HOW[m.id]}
        </p>
      )}
      <div className="fx-metric-comp">
        <p>
          {m.id === "expense" && m.value === 0 && (
            <TriangleAlert size={12} aria-hidden="true" style={{ color: "var(--fx-warning)", verticalAlign: -1, marginRight: 4 }} />
          )}
          {m.composition}
          {m.note && m.id === "income" ? ` · ${m.note}` : ""}
        </p>
        {m.note && m.id === "result" && (
          <p style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Clock size={12} aria-hidden="true" style={{ color: "var(--fx-warning)" }} /> {m.note}
          </p>
        )}
        <p>
          <Link className="fx-link" href={METRIC_LINK[m.id]} style={{ fontSize: 12 }}>
            {m.id === "result" ? "Ver reporte del período" : "Ver desglose"} <ArrowRight size={12} aria-hidden="true" />
          </Link>
        </p>
      </div>
    </section>
  );
}

export function EvolutionChart({ id = "evo", until }: { id?: string; until?: string }) {
  const [range, setRange] = useState<6 | 10>(6);
  const data = monthlySeries(range, until).map((p) => ({
    ...p,
    x: p.partial ? `${p.label}*` : p.label,
    full: `${periodTitle({ view: "month", year: Number(p.period.slice(0, 4)), month: Number(p.period.slice(5)) })}${p.partial ? " (en curso)" : ""}`,
  }));
  const last = data.at(-1)!;
  return (
    <FinancialChart
      id={id}
      question="¿Cómo evolucionan ingresos y gastos?"
      subtitle="Montos registrados por mes. Tarjeta SumUp en bruto."
      data={data}
      xKey="x"
      fullLabelKey="full"
      series={[
        { key: "income", label: "Ingresos", color: SERIES_COLOR.income },
        { key: "expense", label: "Gastos", color: SERIES_COLOR.expense },
      ]}
      extraRow={{ label: "Resultado", key: "result" }}
      annotation={data.some((d) => d.x.startsWith("Sep")) ? { x: data.find((d) => d.x.startsWith("Sep"))!.x, label: "Diezmos y gastos en CDS desde sep" } : undefined}
      summary={`Ingresos y gastos de los últimos ${data.length} meses. ${last.full}: ingresos ${last.income} pesos, gastos ${last.expense} pesos.`}
      footnote={`${data.some((d) => d.partial) ? "* Mes en curso. " : ""}Antes de septiembre 2026 casi no se registraban diezmos ni gastos en CDS y SumUp no separaba áreas: esos meses no son comparables.`}
      controls={
        <div className="fx-segmented fx-hide-mobile" role="group" aria-label="Rango">
          <button type="button" aria-pressed={range === 6} onClick={() => setRange(6)}>
            6 M
          </button>
          <button type="button" aria-pressed={range === 10} onClick={() => setRange(10)}>
            10 M
          </button>
        </div>
      }
    />
  );
}

function OpsStatus() {
  const todaySumUp = (cat: string) =>
    TRANSACTIONS.filter((t) => t.date === DEMO_TODAY && t.category === cat && t.origin === "sumup" && t.status === "active").reduce(
      (a, t) => a + t.amount,
      0,
    );
  const cafe = INTEGRATIONS.find((i) => i.id === "sumup-cafeteria")!;
  const sessions = CASH_SESSIONS.filter((s) => s.date === DEMO_TODAY);
  return (
    <Panel title="Estado operativo" labelledBy="ops-title">
      <p className="fx-section-label">Hoy por área · {shortDate(DEMO_TODAY)}</p>
      <div className="fx-kv">
        {(
          [
            ["Ofrendas", SOURCE.ofrendas, ""],
            ["Cafetería", SOURCE.cafeteria, ` hasta ${timeOf(cafe.lastSuccessAt)}`],
          ] as const
        ).map(([label, cat, until]) => (
          <div className="fx-kv-row fx-ops-row" key={label} style={{ alignItems: "flex-start", padding: "4px 0" }}>
            <span>
              {label}
              <span className="fx-help" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                Efectivo: <StatusBadge status="cashToday" />
              </span>
            </span>
            <span style={{ textAlign: "right" }}>
              <span className="fx-help" style={{ display: "block" }}>
                SumUp{until}
              </span>
              <MoneyAmount value={todaySumUp(cat)} basis="bruto" />
            </span>
          </div>
        ))}
      </div>
      <p className="fx-section-label" style={{ marginTop: 14 }}>
        Integraciones
      </p>
      <div className="fx-kv">
        {INTEGRATIONS.map((i) => (
          <div className="fx-kv-row" key={i.id}>
            <span>{i.name}</span>
            {i.state === "ok" ? (
              <StatusBadge status="synced" detail={timeOf(i.lastSuccessAt)} />
            ) : (
              <StatusBadge status="unsynced" detail={`desde ${timeOf(i.lastSuccessAt)}`} />
            )}
          </div>
        ))}
      </div>
      <p className="fx-section-label" style={{ marginTop: 14 }}>
        Cajas de hoy <ProposalPill />
      </p>
      <div className="fx-kv">
        {sessions.map((s) => (
          <div className="fx-kv-row" key={s.id}>
            <span>{s.area === "ofrendas" ? "Ofrendas" : "Cafetería"}</span>
            {s.state === "open" ? (
              <StatusBadge status="open" detail={timeOf(s.openedAt!)} />
            ) : (
              <StatusBadge status="counting" detail="1 de 2 conteos" />
            )}
          </div>
        ))}
      </div>
      <Link className="fx-link" href={`${BASE}/caja`} style={{ marginTop: 8, fontSize: 13 }}>
        Ir a Caja <ArrowRight size={13} aria-hidden="true" />
      </Link>
    </Panel>
  );
}

function RecentActivity() {
  return (
    <Panel title="Actividad reciente" labelledBy="act-title">
      <ul className="fx-activity">
        {ACTIVITY.slice(0, 6).map((a) => (
          <li key={a.id}>
            <time dateTime={a.at}>{a.at.slice(0, 10) === DEMO_TODAY ? timeOf(a.at) : dayMonth(a.at)}</time>
            <span>
              <strong>{a.actor}</strong> · {a.text}
              {a.amount !== undefined && (
                <>
                  {" "}
                  · <MoneyAmount value={a.amount} />
                </>
              )}
              {a.proposal && (
                <>
                  {" "}
                  <ProposalPill />
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function HoyScreen() {
  const { period, demoState } = usePreview();
  const metrics = headlineMetrics(period);
  const sources = incomeBySource(period);
  const attention = attentionItems();
  const activeCampaign = CAMPAIGNS.find((c) => c.status === "active");

  return (
    <>
      <FinancialHeader title="Hoy" subtitle={`${TODAY_LABEL} · culto hoy`} />
      {demoState === "loading" ? (
        <div aria-busy="true" aria-label="Cargando">
          <div className="fx-metrics">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} h={148} style={{ borderRadius: 12 }} />
            ))}
          </div>
          <div className="fx-grid">
            <Skeleton h={340} style={{ gridColumn: "span 8", borderRadius: 12 }} />
            <Skeleton h={340} style={{ gridColumn: "span 4", borderRadius: 12 }} />
          </div>
        </div>
      ) : demoState === "error" ? (
        <Panel>
          <ErrorState onRetry={() => window.location.assign(BASE)} />
        </Panel>
      ) : demoState === "empty" ? (
        <Panel>
          <EmptyState
            icon={Inbox}
            title={`Sin movimientos en ${periodTitle(period).toLocaleLowerCase("es")}`}
            body="Cuando se registren ingresos o gastos aparecerán aquí."
          />
        </Panel>
      ) : (
        <>
          <div className="fx-metrics">
            {metrics.map((m) => (
              <MetricCard key={m.id} m={m} />
            ))}
          </div>
          <div className="fx-grid">
            <div className="fx-span-8 fx-md-span-12 fx-m-order-2" style={{ alignSelf: "start" }}>
              <EvolutionChart />
            </div>
            <div className="fx-span-4 fx-md-span-12 fx-m-order-1" style={{ alignSelf: "start" }}>
              <Panel
                title={
                  <>
                    Atención <span className="fx-count">({attention.length})</span>
                  </>
                }
                labelledBy="hoy-att"
              >
                <AttentionList items={attention} compact max={3} />
              </Panel>
            </div>
            <div className="fx-span-4 fx-md-span-6 fx-sm-span-12 fx-fill fx-m-order-3">
              <Panel title={`Ingresos por fuente · ${periodTitle(period)}`} labelledBy="hoy-src">
                <p className="fx-help" style={{ marginTop: -8, marginBottom: 8 }}>
                  ¿De dónde vino el dinero del período?
                </p>
                <SourceBreakdown
                  rows={sources.rows}
                  total={sources.total}
                  campaign={activeCampaign ? { name: activeCampaign.name, amount: activeCampaign.verified } : undefined}
                  linkFor={(r) => `${BASE}/movimientos?fuente=${encodeURIComponent(r.key)}`}
                />
              </Panel>
            </div>
            <div className="fx-span-4 fx-md-span-6 fx-sm-span-12 fx-fill fx-m-order-4">
              <OpsStatus />
            </div>
            <div className="fx-span-4 fx-md-span-12 fx-fill fx-m-order-5">
              <RecentActivity />
            </div>
          </div>
        </>
      )}
    </>
  );
}
