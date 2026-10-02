"use client";

// Finanzas › Resumen (16b §3.8, R4): para quien solo tiene finance.summary.read.
// Cifras AGREGADAS del período: sin drill-down, sin Atención, sin actividad, sin
// nombres y sin "+ Registrar". Se mantiene el gráfico de evolución (agregado).

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Equal, Info, TrendingDown, TrendingUp } from "lucide-react";
import { variation } from "@/lib/finance-preview/format";
import { headlineMetrics, type Metric } from "@/lib/finance-preview/selectors";
import { usePreview } from "@/components/finance-preview/context";
import { FinancialHeader } from "@/components/finance-preview/shell";
import { EvolutionChart } from "@/components/finance-preview/screens/hoy";
import { MoneyAmount } from "@/components/finance-preview/ui";

const ICON = { income: ArrowDownLeft, expense: ArrowUpRight, result: Equal };

/** Notas fijas (sin composición por nombre ni enlaces al detalle). */
const NOTE: Record<Metric["id"], string> = {
  income: "Ingresos activos del período. No incluye anulados ni campañas.",
  expense: "Gastos activos registrados en el período.",
  result: "Ingresos − gastos. No representa el saldo bancario.",
};

/** "Cómo se calcula" (texto, sin enlaces al detalle). */
const HOW: Record<Metric["id"], string> = {
  income:
    "Suma los ingresos activos del período: diezmos, efectivo, transferencias y tarjeta SumUp en bruto (menos devoluciones). No incluye anulados ni campañas.",
  expense: "Suma los gastos activos registrados en el período.",
  result: "Ingresos registrados menos gastos registrados. No representa el dinero disponible en el banco.",
};

function SummaryMetric({ m }: { m: Metric }) {
  const [how, setHow] = useState(false);
  const Icon = ICON[m.id];
  const v = m.previous !== null ? variation(m.value, m.previous) : null;
  const id = `summary-${m.id}`;
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
      {m.comparabilityNote && v && (
        <p className="fx-help" style={{ marginTop: 2 }}>
          {m.comparabilityNote}
        </p>
      )}
      {how && (
        <p className="fx-popover" id={`${id}-how`}>
          {HOW[m.id]}
        </p>
      )}
      <div className="fx-metric-comp">
        <p>{NOTE[m.id]}</p>
      </div>
    </section>
  );
}

export function FinanceSummaryScreen() {
  const { period } = usePreview();
  const metrics = headlineMetrics(period);
  return (
    <>
      <FinancialHeader
        title="Resumen financiero"
        subtitle="Cifras generales del período. El detalle lo administra el equipo de Finanzas."
        primary="none"
      />
      <div className="fx-metrics">
        {metrics.map((m) => (
          <SummaryMetric key={m.id} m={m} />
        ))}
      </div>
      <div style={{ marginTop: 24 }}>
        <EvolutionChart id="summary-evo" />
      </div>
    </>
  );
}
