"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Info, Search, UserRoundSearch, HandCoins } from "lucide-react";
import { CAMPAIGN_SUBMISSIONS, DEMO_TODAY, INTEGRATIONS, PAYOUTS, TITHE_PROFILES, TRANSACTIONS } from "@/lib/finance-preview/fixtures";
import { clp, dayMonth, monthLabel, shortDate, timeOf } from "@/lib/finance-preview/format";
import {
  AREA_LABEL,
  areaCashStatus,
  AVAILABLE_MONTHS,
  campaignTotals,
  hasDetail,
  monthSummary,
  payoutNet,
  periodKey,
  periodSummary,
  periodTitle,
  reconciliationState,
  worshipDaysTable,
  worshipSeries,
  type AreaKey,
} from "@/lib/finance-preview/selectors";
import { SOURCE, SPLIT_DATE } from "@/lib/finance-preview/types";
import { FinancialChart, SERIES_COLOR } from "../charts";
import { CashStatusCell } from "./operacion";
import { usePreview } from "../context";
import { BASE, FinancialHeader } from "../shell";
import { Callout, EmptyState, ErrorState, ExampleBadge, MoneyAmount, Panel, ProposalPill, SkeletonRows, StatusBadge } from "../ui";

function DemoGate({ children, empty }: { children: React.ReactNode; empty: string }) {
  const { demoState } = usePreview();
  if (demoState === "loading")
    return (
      <Panel>
        <SkeletonRows rows={6} />
      </Panel>
    );
  if (demoState === "error")
    return (
      <Panel>
        <ErrorState onRetry={() => window.location.assign(window.location.pathname)} />
      </Panel>
    );
  if (demoState === "empty")
    return (
      <Panel>
        <EmptyState icon={HandCoins} title={empty} />
      </Panel>
    );
  return <>{children}</>;
}

// ---------- Ofrendas / Cafetería ----------

function AreaScreen({ area }: { area: AreaKey }) {
  const { period } = usePreview();
  const category = area === "ofrendas" ? SOURCE.ofrendas : SOURCE.cafeteria;
  const integration = INTEGRATIONS.find((i) => i.id === `sumup-${area}`)!;
  const isOfr = area === "ofrendas";

  const monthItems = TRANSACTIONS.filter(
    (t) => t.status === "active" && t.category === category && t.type === "income" && t.date.startsWith(periodKey(period)),
  );
  const s = periodSummary(period);
  const sumUp = monthItems.filter((t) => t.origin === "sumup").reduce((a, t) => a + t.amount, 0);
  const cash = monthItems.filter((t) => t.method === "cash").reduce((a, t) => a + t.amount, 0);
  const isYear = period.view === "year";
  const historyTotal = !isYear && !hasDetail(period) ? s.incomeByCategory[category] ?? 0 : null;
  const yearTotal = isYear ? s.incomeByCategory[category] ?? 0 : null;
  const legacy = s.sumUpByAccount.legacy;
  const crossesSplit = period.view === "month" ? periodKey(period) === SPLIT_DATE.slice(0, 7) : period.year === 2026;

  const series = worshipSeries(8).map((w) => {
    const day = TRANSACTIONS.filter((t) => t.date === w.date && t.status === "active" && t.category === category && t.type === "income");
    return {
      x: w.label.split(" ").slice(1).join(" ") + (w.inProgress ? "*" : ""),
      xs: `${Number(w.date.slice(8, 10))}/${Number(w.date.slice(5, 7))}${w.inProgress ? "*" : ""}`,
      full: `${w.label}${w.inProgress ? " (en curso)" : ""}`,
      sumup: day.filter((t) => t.origin === "sumup").reduce((a, t) => a + t.amount, 0),
      cash: day.filter((t) => t.method === "cash").reduce((a, t) => a + t.amount, 0),
    };
  });

  const days = period.view === "month" && hasDetail(period) ? worshipDaysTable(periodKey(period)) : [];

  return (
    <>
      <FinancialHeader
        title={AREA_LABEL[area]}
        subtitle={isOfr ? "Donaciones de los cultos: efectivo y tarjeta SumUp en bruto." : "Ventas de cafetería: tarjeta SumUp en bruto y efectivo. No son donaciones."}
      />
      <DemoGate empty={`Sin ingresos de ${AREA_LABEL[area]} en este período.`}>
        <div className="fx-stack">
          <Panel>
            <div className="fx-row-between" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <p className="fx-help-13">
                  {isYear
                    ? `${isOfr ? "Ofrendas" : "Ventas"} ${period.year} · ene–${dayMonth(DEMO_TODAY).split(" ")[1]}`
                    : `${isOfr ? "Ofrendas" : "Ventas"} de ${periodTitle(period).toLocaleLowerCase("es")}`}
                </p>
                <p className="fx-metric-value" style={{ marginTop: 2 }}>
                  <MoneyAmount value={historyTotal ?? yearTotal ?? sumUp + cash} />
                </p>
              </div>
              {yearTotal !== null && (
                <dl className="fx-dl" style={{ minWidth: 300 }}>
                  <dt>Ene–ago · solo efectivo</dt>
                  <dd>
                    <MoneyAmount value={yearTotal - sumUp - cash} />
                  </dd>
                  <dt>Sep–oct · SumUp (bruto)</dt>
                  <dd>
                    <MoneyAmount value={sumUp} />
                  </dd>
                  <dt>Sep–oct · efectivo</dt>
                  <dd>
                    <MoneyAmount value={cash} />
                  </dd>
                </dl>
              )}
              {historyTotal === null && yearTotal === null && (
                <dl className="fx-dl" style={{ minWidth: 260 }}>
                  <dt>Tarjeta SumUp (bruto)</dt>
                  <dd>
                    <MoneyAmount value={sumUp} />
                  </dd>
                  <dt>Efectivo</dt>
                  <dd>
                    <MoneyAmount value={cash} />
                  </dd>
                </dl>
              )}
            </div>
            {historyTotal !== null && (
              <p className="fx-help" style={{ marginTop: 8 }}>
                Solo efectivo: antes del 09/09/2026 la tarjeta SumUp de {isOfr ? "ofrendas" : "cafetería"} quedó en «SumUp histórico sin
                separar» y no se puede atribuir a esta área.
              </p>
            )}
            {crossesSplit && legacy > 0 && (
              <p className="fx-help" style={{ marginTop: 8, display: "flex", gap: 6 }}>
                <Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Áreas separadas desde el 09/09/2026. Antes de esa fecha, {clp(legacy)} en tarjeta quedó como «SumUp histórico sin separar»: no se
                  atribuye a {AREA_LABEL[area]}.
                </span>
              </p>
            )}
            <p className="fx-help" style={{ marginTop: 6 }}>
              Montos SumUp en bruto: la comisión aún no está disponible.
            </p>
          </Panel>

          <FinancialChart
            id={`chart-${area}`}
            question={isOfr ? "¿Cuánto se ofrendó en los últimos 8 cultos?" : "¿Cuánto se vendió en los últimos 8 cultos?"}
            subtitle="Tarjeta SumUp en bruto y efectivo registrado, por culto."
            data={series}
            xKey="x"
            xKeyMobile="xs"
            fullLabelKey="full"
            series={[
              { key: "sumup", label: "SumUp (bruto)", color: SERIES_COLOR.sumup },
              { key: "cash", label: "Efectivo", color: SERIES_COLOR.cash },
            ]}
            summary={`${AREA_LABEL[area]} en los últimos 8 cultos, separado en tarjeta SumUp y efectivo.`}
            footnote={`* Culto en curso. Un culto sin barra de efectivo puede indicar «Falta efectivo» (ver tabla).${
              series.some((x) => x.sumup + x.cash === 0) ? ` Sin registros: ${series.filter((x) => x.sumup + x.cash === 0).map((x) => x.full).join(", ")}.` : ""
            }`}
            height={{ desktop: 240, mobile: 200 }}
          />

          <Panel flush title={isYear ? `Cultos de ${period.year}` : `Cultos de ${periodTitle(period).toLocaleLowerCase("es")}`} labelledBy={`cultos-${area}`}>
            {days.length === 0 ? (
              <EmptyState icon={Info} title="Sin detalle por culto en este período" body="En la vista previa el detalle por culto existe desde septiembre 2026." />
            ) : (
              <div className="fx-table-wrap">
                <table className="fx-table fx-table-simple fx-table-fixed">
                  <caption className="fx-sr">Ingresos de {AREA_LABEL[area]} por día</caption>
                  <thead>
                    <tr>
                      <th scope="col" style={{ width: "34%" }}>Fecha</th>
                      <th scope="col" className="is-num">
                        SumUp (bruto)
                      </th>
                      <th scope="col" className="is-num">
                        Efectivo
                      </th>
                      <th scope="col" className="fx-hide-mobile" style={{ width: 172 }}>
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((r) => {
                      const su = isOfr ? r.ofrSumUp : r.cafSumUp;
                      const ca = isOfr ? r.ofrCash : r.cafCash;
                      const preSplit = r.date < SPLIT_DATE;
                      return (
                        <tr key={r.date}>
                          <td>
                            <span className="fx-nowrap">
                              {shortDate(r.date)}
                              {r.worship && <span className="fx-help fx-hide-mobile"> · culto</span>}
                            </span>
                            <span className="fx-show-mobile-inline" style={{ marginTop: 4 }}>
                              <CashStatusCell status={areaCashStatus(r.date, area, r.status)} compact />
                            </span>
                          </td>
                          <td className="is-num">{preSplit ? <span className="fx-help">No comparable</span> : su ? <MoneyAmount value={su} /> : "—"}</td>
                          <td className="is-num">{ca ? <MoneyAmount value={ca} /> : "—"}</td>
                          <td className="fx-hide-mobile">
                            <CashStatusCell status={areaCashStatus(r.date, area, r.status)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {!isOfr && (
            <Panel
              title={
                <>
                  Payouts de SumUp Cafetería <ProposalPill />
                </>
              }
              labelledBy="caf-payouts"
              action={
                <Link className="fx-link" href={`${BASE}/conciliacion`} style={{ fontSize: 13 }}>
                  Ir a Conciliación <ArrowRight size={13} aria-hidden="true" />
                </Link>
              }
            >
              <p className="fx-help" style={{ marginTop: -8, marginBottom: 8 }}>
                Bruto − devoluciones − comisión = líquido esperado. Comisiones de ejemplo.
              </p>
              <ul>
                {PAYOUTS.filter((p) => p.account === "cafeteria").map((p) => {
                  const net = payoutNet(p);
                  return (
                    <li key={p.id} className="fx-kv-row" style={{ borderTop: "1px solid var(--fx-line)" }}>
                      <span>
                        {shortDate(p.date)}
                        <span className="fx-help" style={{ display: "block" }}>
                          {clp(p.gross)} − {clp(p.refunds)} − {p.fee === null ? "comisión pendiente" : clp(p.fee)}
                          {net !== null && ` = ${clp(net)}`}
                        </span>
                      </span>
                      <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {net !== null && <ExampleBadge />}
                        <StatusBadge status={reconciliationState(p) === "reconciled" ? "reconciled" : reconciliationState(p) === "difference" ? "difference" : reconciliationState(p) === "partial" ? "partial" : "pending"} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          <p className="fx-help-13" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {integration.name}:{" "}
            {integration.state === "ok" ? (
              <StatusBadge status="synced" detail={`hoy ${timeOf(integration.lastSuccessAt)}`} />
            ) : (
              <StatusBadge status="unsynced" detail={`desde ${timeOf(integration.lastSuccessAt)}`} />
            )}
            {isOfr && (
              <>
                {" "}
                · Página pública de ofrendas <span className="fx-num">/ofrendar</span>
              </>
            )}
          </p>
        </div>
      </DemoGate>
    </>
  );
}

export const OfrendasScreen = () => <AreaScreen area="ofrendas" />;
export const CafeteriaScreen = () => <AreaScreen area="cafeteria" />;

// ---------- Diezmos ----------

const ACTIVE_TITHES = TRANSACTIONS.filter((t) => t.source === "tithe" && t.status === "active");

export function DiezmosScreen() {
  const { simulate } = usePreview();
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("es");
    return TITHE_PROFILES.filter((p) => !needle || p.name.toLocaleLowerCase("es").includes(needle)).map((p) => {
      const mine = ACTIVE_TITHES.filter((t) => t.profileId === p.id).sort((a, b) => b.date.localeCompare(a.date));
      return { ...p, last: mine[0]?.date, count: mine.length };
    });
  }, [q]);
  const months = AVAILABLE_MONTHS.map((m) => ({ m, s: monthSummary(m) })).filter((x) => x.s.tithes > 0);

  return (
    <>
      <FinancialHeader title="Diezmos" subtitle="Personas y familias que diezman. Registro rápido por transferencia." period={false} />
      <DemoGate empty="No hay fichas de diezmo todavía.">
        <div className="fx-grid">
          <div className="fx-span-8 fx-md-span-12">
            <Panel flush>
              <div className="fx-toolbar">
                <label className="fx-search" style={{ width: "100%" }}>
                  <span className="fx-sr">Buscar persona o familia</span>
                  <Search size={16} aria-hidden="true" />
                  <input className="fx-input" type="search" placeholder="Buscar persona o familia" value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
              </div>
              {rows.length === 0 ? (
                <EmptyState icon={UserRoundSearch} title={`No hay personas que coincidan con «${q}»`} />
              ) : (
                <div className="fx-table-wrap">
                  <table className="fx-table fx-table-simple">
                    <caption className="fx-sr">Fichas de diezmo</caption>
                    <thead>
                      <tr>
                        <th scope="col">Nombre</th>
                        <th scope="col" className="fx-hide-mobile">
                          Tipo
                        </th>
                        <th scope="col" className="fx-hide-mobile">
                          Último registro
                        </th>
                        <th scope="col" className="fx-hide-mobile">
                          Estado
                        </th>
                        <th scope="col">
                          <span className="fx-sr">Acción</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <span className="fx-cell-main">{p.name}</span>
                            <span className="fx-cell-sub fx-show-mobile-inline">{p.last ? `Último: ${shortDate(p.last)}` : "Sin registros"}</span>
                          </td>
                          <td className="fx-hide-mobile">{p.type === "family" ? "Familia" : "Persona"}</td>
                          <td className="fx-hide-mobile fx-num">{p.last ? shortDate(p.last) : "—"}</td>
                          <td className="fx-hide-mobile">
                            {!p.active ? (
                              <span className="fx-help">Ficha inactiva</span>
                            ) : p.last && p.last.startsWith(DEMO_TODAY.slice(0, 7)) ? (
                              <StatusBadge status="recorded" detail="este mes" />
                            ) : (
                              <span className="fx-help">Sin registro este mes</span>
                            )}
                          </td>
                          <td className="is-num">
                            {p.active && (
                              <button
                                type="button"
                                className="fx-btn fx-btn-ghost fx-btn-sm"
                                aria-label={`Registrar diezmo de ${p.name}`}
                                onClick={() => simulate(`Registrar diezmo · ${p.name}`)}
                              >
                                Registrar
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
          <div className="fx-span-4 fx-md-span-12">
            <Panel title="Diezmos por mes" labelledBy="tithe-months">
              <table className="fx-table fx-table-simple">
                <caption className="fx-sr">Diezmos registrados por mes</caption>
                <thead>
                  <tr>
                    <th scope="col">Mes</th>
                    <th scope="col" className="is-num">
                      Monto
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {months.map(({ m, s }) => (
                    <tr key={m}>
                      <td>
                        {monthLabel(m)}
                        {m === DEMO_TODAY.slice(0, 7) && <span className="fx-help"> · en curso</span>}
                      </td>
                      <td className="is-num">
                        <MoneyAmount value={s.tithes} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="fx-help" style={{ marginTop: 10 }}>
                Los diezmos se registran sistemáticamente en CDS desde septiembre 2026; antes hay registros aislados. El gráfico aparece con 3
                meses comparables. Son parte de los ingresos registrados, no una cifra aparte.
              </p>
              <p className="fx-help" style={{ marginTop: 6 }}>
                Las fichas son internas: los reportes no muestran nombres.
              </p>
            </Panel>
          </div>
        </div>
      </DemoGate>
    </>
  );
}

// ---------- Campañas ----------

export function CampanasScreen() {
  const { simulate } = usePreview();
  const camps = campaignTotals();
  return (
    <>
      <FinancialHeader
        title="Campañas"
        subtitle="Las campañas se llevan aparte y no suman a Ingresos registrados."
        period={false}
        primary="none"
      />
      <Callout tone="neutral" icon={Info}>
        <p>
          <StatusBadge status="outsideLedger" /> Lo recaudado en campañas es un libro paralelo: no suma en los ingresos de Hoy, en Movimientos ni
          en el resultado del período.
        </p>
      </Callout>
      <div style={{ height: 16 }} />
      <DemoGate empty="No hay campañas activas.">
        <div className="fx-grid">
          {camps.map((c) => (
            <div className="fx-span-6 fx-md-span-12" key={c.id}>
              <Panel
                title={
                  <>
                    {c.name}{" "}
                    {c.status === "active" ? (
                      <StatusBadge status="open" />
                    ) : (
                      <StatusBadge status="campaignDone" />
                    )}
                  </>
                }
                labelledBy={`camp-${c.id}`}
              >
                <p className="fx-metric-value" style={{ marginTop: 0 }}>
                  <MoneyAmount value={c.verified} />
                </p>
                <p className="fx-help-13">
                  {c.status === "closed" ? "recaudado (cerrada, meta cumplida)" : "verificado"} de una meta de {clp(c.goal)} · {c.percent} %
                  {c.installment ? ` · cuota ${c.installment.current} de ${c.installment.total}` : ""}
                </p>
                <div
                  className="fx-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={c.progress}
                  aria-valuetext={`${c.percent} % de la meta`}
                  aria-label={`Avance de ${c.name}`}
                  style={{ marginTop: 10 }}
                >
                  <div style={{ width: `${c.progress}%` }} />
                </div>
                {c.pending.length > 0 && (
                  <>
                    <p className="fx-section-label" style={{ marginTop: 16 }}>
                      Aportes por revisar ({c.pending.length})
                    </p>
                    <ul>
                      {c.pending.map((s) => (
                        <li key={s.id} className="fx-kv-row" style={{ borderTop: "1px solid var(--fx-line)" }}>
                          <span>
                            {s.donor}
                            <span className="fx-help" style={{ display: "block" }}>
                              {dayMonth(s.date)} · {s.origin === "public" ? "página pública" : "manual"}
                            </span>
                          </span>
                          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <MoneyAmount value={s.amount} />
                            <button
                              type="button"
                              className="fx-btn fx-btn-secondary fx-btn-sm"
                              aria-label={`Aprobar aporte de ${s.donor} por ${clp(s.amount)}`}
                              onClick={() => simulate(`Aprobar aporte de ${clp(s.amount)}`)}
                            >
                              Aprobar
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {c.id === "camp-techo" && (
                  <p className="fx-help" style={{ marginTop: 10 }}>
                    Rechazados:{" "}
                    {CAMPAIGN_SUBMISSIONS.filter((s) => s.campaignId === c.id && s.status === "rejected")
                      .map((s) => `${clp(s.amount)} (${dayMonth(s.date)})`)
                      .join(", ")}
                    .
                  </p>
                )}
              </Panel>
            </div>
          ))}
        </div>
      </DemoGate>
    </>
  );
}
