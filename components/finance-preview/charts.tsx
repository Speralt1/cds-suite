"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, ChartColumn, Table2 } from "lucide-react";
import { clp, clpShort } from "@/lib/finance-preview/format";
import { SOURCE } from "@/lib/finance-preview/types";
import type { BreakdownRow } from "@/lib/finance-preview/selectors";
import { MoneyAmount } from "./ui";

export const SERIES_COLOR = {
  income: "#285b45",
  expense: "#b5552b",
  [SOURCE.diezmos]: "#5d9a78",
  [SOURCE.ofrendas]: "#3f7cac",
  [SOURCE.cafeteria]: "#b7801a",
  [SOURCE.legacy]: "#7f8c84",
  other: "#6f7d75",
  cash: "#285b45",
  sumup: "#3f7cac",
} as Record<string, string>;

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

interface TooltipPayload {
  dataKey?: string | number;
  value?: number;
  color?: string;
  payload?: Record<string, unknown>;
}

function ChartTooltip({
  active,
  payload,
  series,
  titleKey,
  extraRow,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  series: ChartSeries[];
  titleKey: string;
  extraRow?: { label: string; key: string };
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload ?? {};
  return (
    <div className="fx-tooltip">
      <p className="fx-tooltip-title">{String(row[titleKey] ?? "")}</p>
      {series.map((s) => (
        <p className="fx-tooltip-row" key={s.key}>
          <span className="fx-swatch" style={{ background: s.color }} />
          <span>{s.label}</span>
          <span>{clp(Number(row[s.key] ?? 0))}</span>
        </p>
      ))}
      {extraRow && (
        <p className="fx-tooltip-row" style={{ borderTop: "1px solid var(--fx-line)", marginTop: 4, paddingTop: 4 }}>
          <span>{extraRow.label}</span>
          <span>{clp(Number(row[extraRow.key] ?? 0))}</span>
        </p>
      )}
    </div>
  );
}

/** Gráfico de barras agrupadas con pregunta, leyenda propia y "Ver como tabla". */
export function FinancialChart({
  id,
  question,
  subtitle,
  data,
  xKey,
  fullLabelKey,
  series,
  summary,
  annotation,
  footnote,
  extraRow,
  controls,
  height = { desktop: 280, mobile: 220 },
}: {
  id: string;
  question: string;
  subtitle?: React.ReactNode;
  data: Record<string, string | number | boolean>[];
  xKey: string;
  fullLabelKey: string;
  series: ChartSeries[];
  summary: string;
  annotation?: { x: string; label: string };
  footnote?: React.ReactNode;
  extraRow?: { label: string; key: string };
  controls?: React.ReactNode;
  height?: { desktop: number; mobile: number };
}) {
  const [asTable, setAsTable] = useState(false);
  const reduced = useReducedMotion();
  const mobile = useIsMobile();
  const h = mobile ? height.mobile : height.desktop;

  return (
    <section className="fx-panel" aria-labelledby={`${id}-title`}>
      <div className="fx-panel-head" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <h2 className="fx-h2" id={`${id}-title`}>
            {question}
          </h2>
          {subtitle && <p className="fx-help" style={{ marginTop: 2 }}>{subtitle}</p>}
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {controls}
          <button
            type="button"
            className="fx-btn fx-btn-ghost fx-btn-sm"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? <ChartColumn size={16} aria-hidden="true" /> : <Table2 size={16} aria-hidden="true" />}
            <span className="fx-hide-mobile">{asTable ? "Ver gráfico" : "Ver como tabla"}</span>
            <span className="fx-sr">{asTable ? "" : ""}</span>
          </button>
        </div>
      </div>

      {!asTable && (
        <div className="fx-chart-legend" aria-hidden="true">
          {series.map((s) => (
            <span key={s.key}>
              <span className="fx-swatch" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </div>
      )}

      {asTable ? (
        <div className="fx-table-wrap">
          <table className="fx-table fx-table-simple">
            <caption className="fx-sr">{question}</caption>
            <thead>
              <tr>
                <th scope="col">Período</th>
                {series.map((s) => (
                  <th scope="col" className="is-num" key={s.key}>
                    {s.label}
                  </th>
                ))}
                {extraRow && (
                  <th scope="col" className="is-num">
                    {extraRow.label}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={String(row[xKey])}>
                  <th scope="row" style={{ position: "static", background: "transparent", fontWeight: 500, color: "var(--fx-ink)", border: 0, borderBottom: "1px solid var(--fx-line)" }}>
                    {String(row[fullLabelKey])}
                  </th>
                  {series.map((s) => (
                    <td className="is-num" key={s.key}>
                      <MoneyAmount value={Number(row[s.key] ?? 0)} />
                    </td>
                  ))}
                  {extraRow && (
                    <td className="is-num">
                      <MoneyAmount value={Number(row[extraRow.key] ?? 0)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="fx-chart" role="img" aria-label={summary} style={{ height: h }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: h }}>
            <BarChart data={data} margin={{ top: annotation ? 22 : 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%" barGap={4}>
              <CartesianGrid vertical={false} stroke="#e3e7e0" />
              <XAxis
                dataKey={xKey}
                tickLine={false}
                axisLine={{ stroke: "#e3e7e0" }}
                tick={{ fontSize: 12, fill: "#5f6e65" }}
                interval={0}
                minTickGap={4}
              />
              <YAxis
                width={mobile ? 48 : 56}
                axisLine={false}
                tickLine={false}
                tickCount={4}
                tick={{ fontSize: 12, fill: "#5f6e65" }}
                tickFormatter={(v: number) => clpShort(v)}
              />
              <Tooltip
                cursor={{ fill: "rgba(40,91,69,.06)" }}
                content={<ChartTooltip series={series} titleKey={fullLabelKey} extraRow={extraRow} />}
              />
              {annotation && (
                <ReferenceLine
                  x={annotation.x}
                  stroke="#7f8c84"
                  strokeDasharray="3 3"
                  label={{ value: annotation.label, position: "insideTopRight", fontSize: 11, fill: "#5f6e65", dy: -18, dx: -4 }}
                />
              )}
              {series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  maxBarSize={mobile ? 12 : 18}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={!reduced}
                  animationDuration={300}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {footnote && <p className="fx-chart-foot">{footnote}</p>}
    </section>
  );
}

/** "¿De dónde vino el dinero?" — barras horizontales con monto y %. Nunca suma Ofrendas + Cafetería. */
export function SourceBreakdown({
  rows,
  total,
  totalLabel = "Ingresos registrados",
  campaignsOutside,
  linkFor,
}: {
  rows: BreakdownRow[];
  total: number;
  totalLabel?: string;
  campaignsOutside?: number;
  linkFor?: (row: BreakdownRow) => string;
}) {
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <div className="fx-src">
      <ul aria-label="Desglose por fuente">
        {rows.map((r) => {
          const legacy = r.key === SOURCE.legacy;
          const color = SERIES_COLOR[r.key] ?? SERIES_COLOR.other;
          const label = linkFor ? (
            <Link href={linkFor(r)} className="fx-link" style={{ color: "var(--fx-ink-strong)", fontWeight: 500 }}>
              {r.label}
            </Link>
          ) : (
            r.label
          );
          return (
            <li className="fx-src-row" key={r.key}>
              <span className="fx-src-label">
                {label}
                {r.key === SOURCE.diezmos && <small>Parte de los ingresos registrados</small>}
                {legacy && <small>Antes del 09/09/2026 · sin área</small>}
              </span>
              <span className="fx-src-track" aria-hidden="true">
                <span
                  className={`fx-src-fill ${legacy ? "fx-hatch" : ""}`}
                  style={{ display: "block", width: `${Math.max(2, (r.amount / max) * 100)}%`, background: legacy ? undefined : color }}
                />
              </span>
              <span className="fx-src-amount">
                <MoneyAmount value={r.amount} />
              </span>
              <span className="fx-src-share fx-num">{r.share}</span>
            </li>
          );
        })}
      </ul>
      <div className="fx-src-total">
        <span>{totalLabel}</span>
        <span>
          <MoneyAmount value={total} /> <span className="fx-help">· 100 %</span>
        </span>
      </div>
      {campaignsOutside !== undefined && (
        <p className="fx-help" style={{ marginTop: 6 }}>
          Campañas: <MoneyAmount value={campaignsOutside} /> fuera del libro, no suman aquí ·{" "}
          <Link className="fx-link" href="/preview/finanzas-2026/campanas">
            Ver Campañas <ArrowRight size={12} aria-hidden="true" />
          </Link>
        </p>
      )}
    </div>
  );
}
