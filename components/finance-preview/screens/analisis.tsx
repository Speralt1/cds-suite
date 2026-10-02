"use client";

import Link from "next/link";
import { ArrowRight, Clock, Download, Flag, Info, RefreshCw } from "lucide-react";
import { CAMPAIGNS, INTEGRATIONS, PEOPLE } from "@/lib/finance-preview/fixtures";
import { timeOf } from "@/lib/finance-preview/format";
import {
  comparabilityNote,
  comparisonBase,
  periodKey,
  expenseByCategory,
  incomeByMethod,
  incomeBySource,
  periodRangeNote,
  periodSummary,
  periodTitle,
  previousPeriod,
  reportAlerts,
  reportNarrative,
  worshipSeries,
} from "@/lib/finance-preview/selectors";
import { FinancialChart, SERIES_COLOR, SourceBreakdown } from "../charts";
import { usePreview } from "../context";
import { FinancialHeader } from "../shell";
import { EmptyState, ErrorState, MoneyAmount, Panel, ProposalPill, Skeleton, StatusBadge } from "../ui";
import { EvolutionChart } from "./hoy";

/**
 * Props opcionales (suite): `pdfLabel` cambia la etiqueta del botón PDF y
 * `belowHeader` se dibuja bajo el encabezado (p. ej. secciones de Reportes).
 * Sin props = comportamiento de Financial UX V2.
 */
export function ReportesScreen({ pdfLabel = "Exportar PDF", belowHeader }: { pdfLabel?: string; belowHeader?: React.ReactNode } = {}) {
  const { period, demoState, simulate } = usePreview();
  const s = periodSummary(period);
  const methods = incomeByMethod(period);
  const sources = incomeBySource(period);
  const expenses = expenseByCategory(period);
  const alerts = reportAlerts(period);
  const prevP = previousPeriod(period);
  const base = comparisonBase(period);
  const prevMethods = prevP && periodRangeNote(period) === null ? incomeByMethod(prevP) : null;
  const activeCampaign = CAMPAIGNS.find((c) => c.status === "active");
  const prevNote = comparabilityNote(period);

  const periodEnd = period.view === "month" ? `${periodKey(period)}-31` : `${period.year}-12-31`;
  const worship = worshipSeries(8, periodEnd).map((w) => ({
    x: w.label.split(" ").slice(1).join(" ") + (w.inProgress ? "*" : ""),
    xs: `${Number(w.date.slice(8, 10))}/${Number(w.date.slice(5, 7))}${w.inProgress ? "*" : ""}`,
    full: `${w.label}${w.inProgress ? " (en curso)" : ""}`,
    ofrendas: w.ofrendas,
    cafeteria: w.cafeteria,
  }));

  return (
    <>
      <FinancialHeader
        title="Reportes"
        subtitle={`Análisis de ${periodTitle(period).toLocaleLowerCase("es")}. Mismas cifras que Hoy y Movimientos.`}
        primary="none"
        actions={
          <button type="button" className="fx-btn fx-btn-secondary" onClick={() => simulate(`${pdfLabel} del período`)}>
            <Download size={16} aria-hidden="true" /> {pdfLabel}
          </button>
        }
      />
      {belowHeader}
      {demoState === "loading" ? (
        <div className="fx-stack" aria-busy="true">
          <Skeleton h={120} style={{ borderRadius: 12 }} />
          <Skeleton h={320} style={{ borderRadius: 12 }} />
        </div>
      ) : demoState === "error" ? (
        <Panel>
          <ErrorState onRetry={() => window.location.assign(window.location.pathname)} />
        </Panel>
      ) : demoState === "empty" ? (
        <Panel>
          <EmptyState icon={Info} title="No hay datos para este período" />
        </Panel>
      ) : (
        <div className="fx-stack">
          <Panel title="Resumen ejecutivo" labelledBy="rep-summary">
            <p style={{ fontSize: 15, lineHeight: "24px", maxWidth: 820 }}>{reportNarrative(period)}</p>
            {periodRangeNote(period) && (
              <p className="fx-help" style={{ marginTop: 8 }}>
                Período en curso ({periodRangeNote(period)}): las cifras cambiarán hasta el cierre del mes.
              </p>
            )}
          </Panel>

          <Panel title={`Alertas (${alerts.length})`} labelledBy="rep-alerts">
            <ul>
              {alerts.map((a, i) => (
                <li key={i} className="fx-kv-row" style={{ borderTop: i ? "1px solid var(--fx-line)" : 0, justifyContent: "flex-start", padding: "6px 0" }}>
                  {a.tone === "review" ? (
                    <span className="fx-badge fx-tone-review" style={{ flexShrink: 0 }}>
                      <Flag size={12} aria-hidden="true" /> Revisar
                    </span>
                  ) : (
                    <span className="fx-badge fx-tone-info" style={{ flexShrink: 0 }}>
                      <Info size={12} aria-hidden="true" /> Info
                    </span>
                  )}
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <EvolutionChart id="rep-evo" until={period.view === "month" ? periodKey(period) : undefined} />

          <div className="fx-grid">
            <div className="fx-span-6 fx-md-span-12">
              <Panel title="¿De dónde vino el dinero?" labelledBy="rep-src">
                <SourceBreakdown
                  rows={sources.rows}
                  total={sources.total}
                  campaign={activeCampaign ? { name: activeCampaign.name, amount: activeCampaign.verified } : undefined}
                />
              </Panel>
            </div>
            <div className="fx-span-6 fx-md-span-12">
              <FinancialChart
                id="rep-worship"
                question="¿Cómo se comparan Ofrendas y Cafetería por culto?"
                subtitle="Donaciones y ventas por separado: nunca se suman."
                data={worship}
                xKey="x"
                xKeyMobile="xs"
                fullLabelKey="full"
                series={[
                  { key: "ofrendas", label: "Ofrendas", color: SERIES_COLOR["Ofrendas"] },
                  { key: "cafeteria", label: "Cafetería", color: SERIES_COLOR["Cafetería"] },
                ]}
                summary="Ofrendas y Cafetería en los últimos 8 cultos, en series separadas."
                footnote={`* Culto en curso. Incluye tarjeta SumUp en bruto y efectivo registrado.${
                  worship.some((w) => w.ofrendas + w.cafeteria === 0) ? ` Sin registros: ${worship.filter((w) => w.ofrendas + w.cafeteria === 0).map((w) => w.full).join(", ")}.` : ""
                }`}
                height={{ desktop: 240, mobile: 200 }}
              />
            </div>
          </div>

          <div className="fx-grid">
            <div className="fx-span-7 fx-md-span-12">
              <Panel flush title="Por tipo de dinero" labelledBy="rep-method">
                <div className="fx-table-wrap" style={{ marginTop: 4 }}>
                  <table className="fx-table fx-table-simple">
                    <caption className="fx-sr">Ingresos por tipo de dinero</caption>
                    <thead>
                      <tr>
                        <th scope="col">Tipo</th>
                        <th scope="col" className="is-num">
                          Monto
                        </th>
                        <th scope="col" className="is-num">
                          %
                        </th>
                        <th scope="col" className="is-num fx-hide-mobile">
                          {prevP && prevMethods ? `${periodTitle(prevP)}${prevNote ? " · no homogéneo" : ""}` : "Mes anterior"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {methods.rows.map((r) => {
                        const prev = prevMethods?.rows.find((x) => x.key === r.key);
                        return (
                          <tr key={r.key}>
                            <td>
                              <span className="fx-cell-main">{r.label}</span>
                              {r.hint && <span className="fx-cell-sub" style={{ whiteSpace: "normal" }}>{r.hint}</span>}
                            </td>
                            <td className="is-num">
                              <MoneyAmount value={r.amount} />
                            </td>
                            <td className="is-num">{r.share}</td>
                            <td className="is-num fx-hide-mobile">
                              {prevMethods ? prev ? <MoneyAmount value={prev.amount} /> : "—" : <span className="fx-help">Mes en curso</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Ingresos registrados</td>
                        <td className="is-num">
                          <MoneyAmount value={methods.total} />
                        </td>
                        <td className="is-num">100 %</td>
                        <td className="is-num fx-hide-mobile">{prevMethods ? <MoneyAmount value={prevMethods.total} /> : base ? "" : "—"}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Panel>
            </div>
            <div className="fx-span-5 fx-md-span-12">
              <Panel title="Gastos y resultado" labelledBy="rep-exp">
                <dl className="fx-dl">
                  {expenses.map((e) => (
                    <div key={e.key} style={{ display: "contents" }}>
                      <dt>{e.label}</dt>
                      <dd>
                        <MoneyAmount value={-e.amount} />
                      </dd>
                    </div>
                  ))}
                  {expenses.length === 0 && (
                    <>
                      <dt>Gastos</dt>
                      <dd>Sin gastos registrados</dd>
                    </>
                  )}
                  <dt style={{ fontWeight: 600, color: "var(--fx-ink)" }}>Gastos registrados</dt>
                  <dd style={{ fontWeight: 600 }}>
                    <MoneyAmount value={-s.expense} />
                  </dd>
                  {s.sumUpGross > 0 && (
                    <>
                      <dt>Comisión SumUp</dt>
                      <dd>
                        <StatusBadge status="feePending" />
                      </dd>
                    </>
                  )}
                  <dt style={{ fontWeight: 600, color: "var(--fx-ink)" }}>Resultado del período</dt>
                  <dd style={{ fontWeight: 600 }}>
                    <MoneyAmount value={s.result} />
                  </dd>
                </dl>
                <p className="fx-help" style={{ marginTop: 10, display: "flex", gap: 6 }}>
                  <Clock size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>
                    Ingresos − gastos. No representa el saldo bancario.
                    {s.sumUpGross > 0 ? " La comisión se registrará como gasto cuando se conecten los payouts de SumUp; el resultado aún no la descuenta." : ""}
                  </span>
                </p>
              </Panel>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * `variant="suite"`: dentro del módulo global Configuración (/preview/configuracion/finanzas)
 * los usuarios se gestionan en «Usuarios y permisos»; aquí solo queda el enlace.
 * Por defecto ("standalone") se comporta como siempre.
 */
export function ConfiguracionScreen({ variant = "standalone" }: { variant?: "standalone" | "suite" } = {}) {
  const { simulate } = usePreview();
  const suite = variant === "suite";
  const users = [
    [PEOPLE.admin, "Administración"],
    [PEOPLE.treasurer, "Tesorería"],
    [PEOPLE.counter, "Finanzas"],
    [PEOPLE.cafeteria, "Cafetería (cajero)"],
  ];
  return (
    <>
      <FinancialHeader
        title={suite ? "Ajustes de finanzas" : "Configuración"}
        subtitle={suite ? "Integraciones, categorías y días de culto." : "Integraciones, categorías, días de culto y usuarios."}
        period={false}
        primary="none"
      />
      <div className="fx-grid">
        <div className="fx-span-6 fx-md-span-12">
          <Panel title="Integraciones" labelledBy="cfg-int">
            <ul>
              {INTEGRATIONS.map((i) => (
                <li key={i.id} style={{ borderTop: "1px solid var(--fx-line)", padding: "10px 0" }}>
                  <div className="fx-row-between">
                    <strong style={{ fontWeight: 600 }}>{i.name}</strong>
                    {i.state === "ok" ? (
                      <StatusBadge status="synced" detail={`hoy ${timeOf(i.lastSuccessAt)}`} />
                    ) : (
                      <StatusBadge status="unsynced" detail={`desde ${timeOf(i.lastSuccessAt)}`} />
                    )}
                  </div>
                  {i.message && <p className="fx-help-13" style={{ marginTop: 6 }}>{i.message}</p>}
                  {i.state === "error" && (
                    <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" style={{ marginTop: 8 }} onClick={() => simulate(`Reintentar ${i.name}`)}>
                      <RefreshCw size={14} aria-hidden="true" /> Reintentar ahora
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="fx-span-6 fx-md-span-12">
          <Panel title="Días de culto" labelledBy="cfg-days">
            <p>Miércoles y domingo</p>
            <p className="fx-help" style={{ marginTop: 4 }}>
              Se usan para detectar «Sin registros» y «Falta efectivo». Hoy es un valor fijo; hacerlo editable es una mejora futura.
            </p>
          </Panel>
          <div style={{ height: 16 }} />
          {suite ? (
            <Panel title="Usuarios" labelledBy="cfg-users">
              <p className="fx-help-13">Quién entra a Finanzas y con qué permisos se define para toda la suite.</p>
              <Link className="fx-link" href="/preview/configuracion/usuarios" style={{ marginTop: 8, fontSize: 14 }}>
                Usuarios y permisos <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </Panel>
          ) : (
            <Panel
              title={
                <>
                  Usuarios y roles <span className="fx-help">(ficticios)</span>
                </>
              }
              labelledBy="cfg-users"
            >
              <ul>
                {users.map(([n, r]) => (
                  <li key={n} className="fx-kv-row" style={{ borderTop: "1px solid var(--fx-line)" }}>
                    <span>{n}</span>
                    <span className="fx-help-13">
                      {r}
                      {r.startsWith("Cafetería") && (
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
          )}
        </div>
      </div>
    </>
  );
}
