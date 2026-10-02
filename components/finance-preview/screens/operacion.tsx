"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, CircleCheck, Inbox, Lock, Minus, Plus, ScanSearch, TriangleAlert } from "lucide-react";
import { CASH_SESSIONS, DEMO_TODAY, DEPOSITS, PAYOUTS } from "@/lib/finance-preview/fixtures";
import { clp, dayMonth, numericDate, shortDate, timeOf } from "@/lib/finance-preview/format";
import {
  AREA_LABEL,
  areaCashStatus,
  attentionItems,
  totalsStrip,
  canCloseWithDifference,
  depositsOf,
  filterMovements,
  hasDetail,
  NO_FILTERS,
  payoutGap,
  payoutNet,
  periodTitle,
  reconciliationState,
  sessionCounted,
  sessionDifference,
  sessionToDeposit,
  transactionsIn,
  unlinkedDeposits,
  worshipDaysTable,
  type AreaKey,
  type MovementFilters,
} from "@/lib/finance-preview/selectors";
import type { CashSession, Payout } from "@/lib/finance-preview/types";
import { AttentionList } from "../attention";
import { usePreview } from "../context";
import { FilterToolbar, TotalsStrip, TransactionsTable } from "../movements";
import { BASE, FinancialHeader } from "../shell";
import {
  Callout,
  EmptyState,
  ErrorState,
  ExampleBadge,
  MoneyAmount,
  Panel,
  ProposalPill,
  SkeletonRows,
  StatusBadge,
  type StatusKey,
} from "../ui";

function DemoStates({ empty, children }: { empty: React.ReactNode; children: React.ReactNode }) {
  const { demoState } = usePreview();
  if (demoState === "loading")
    return (
      <Panel>
        <SkeletonRows rows={8} />
      </Panel>
    );
  if (demoState === "error")
    return (
      <Panel>
        <ErrorState onRetry={() => window.location.assign(window.location.pathname)} />
      </Panel>
    );
  if (demoState === "empty") return <Panel>{empty}</Panel>;
  return <>{children}</>;
}

// ---------- Atención ----------

export function AtencionScreen() {
  const items = attentionItems();
  const [scope, setScope] = useState<"all" | "mine">("all");
  const mine = items.filter((i) => ["records", "deposit", "approve"].includes(i.group));
  return (
    <>
      <FinancialHeader title="Atención" subtitle="Lo que necesita una acción, ordenado por prioridad." period={false} primary="none" />
      <div style={{ maxWidth: 880 }}>
        <div className="fx-segmented" role="group" aria-label="Mostrar" style={{ marginBottom: 16 }}>
          <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
            Todas ({items.length})
          </button>
          <button type="button" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>
            Mis tareas ({mine.length})
          </button>
        </div>
        <DemoStates empty={<AttentionList items={[]} />}>
          <Panel>
            <AttentionList key={scope} items={scope === "all" ? items : mine} />
          </Panel>
        </DemoStates>
        <p className="fx-help" style={{ marginTop: 12 }}>
          Los grupos marcados como Propuesta dependen de conceptos que CDS aún no registra (cajas con conteo, payouts y
          depósitos). Resolver un ítem aquí es una simulación.
        </p>
      </div>
    </>
  );
}

// ---------- Movimientos ----------

export function MovimientosScreen() {
  const { period } = usePreview();
  const [filters, setFilters] = useState<MovementFilters>(NO_FILTERS);

  // "Ver desglose" desde Hoy llega con ?tipo= o ?fuente=.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tipo = q.get("tipo");
    const fuente = q.get("fuente");
    if (tipo === "income" || tipo === "expense" || fuente)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza una sola vez con la URL tras hidratar
      setFilters((f) => ({
        ...f,
        type: tipo === "income" || tipo === "expense" ? tipo : f.type,
        source: fuente ?? f.source,
      }));
  }, []);

  const periodItems = useMemo(() => {
    if (period.view === "year") return transactionsIn(period);
    return hasDetail(period) ? transactionsIn(period) : [];
  }, [period]);
  const items = useMemo(() => filterMovements(periodItems, filters), [periodItems, filters]);

  return (
    <>
      <FinancialHeader title="Movimientos" subtitle="Entradas y salidas del período. Los pagos SumUp se agrupan por día." />
      <DemoStates
        empty={<EmptyState icon={Inbox} title="Aún no hay movimientos en este período" body="Cuando se registren ingresos o gastos aparecerán aquí." />}
      >
        <Panel flush>
          {periodItems.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={`Sin detalle por movimiento en ${periodTitle(period).toLocaleLowerCase("es")}`}
              body="En esta vista previa el detalle está disponible desde septiembre 2026. Los meses anteriores existen solo como totales en Hoy y Reportes."
            />
          ) : (
            <>
              {period.view === "year" && (
                <div style={{ padding: "12px 20px 0" }}>
                  <Callout tone="info" icon={Inbox}>
                    <p>
                      Detalle por movimiento disponible desde septiembre 2026. Los totales del año en Hoy y Reportes incluyen enero–agosto
                      como totales mensuales, por eso no coinciden con esta franja.
                    </p>
                  </Callout>
                </div>
              )}
              <FilterToolbar filters={filters} onChange={setFilters} resultCount={totalsStrip(items).count} />
              <TotalsStrip items={items} />
              <TransactionsTable items={items} caption={`Movimientos de ${periodTitle(period)}`} />
            </>
          )}
        </Panel>
      </DemoStates>
    </>
  );
}

// ---------- Caja ----------

/** Estado del efectivo de un área por día: una sola regla para todas las pantallas. */
export function CashStatusCell({ status, compact }: { status: ReturnType<typeof areaCashStatus>; compact?: boolean }) {
  switch (status) {
    case "today":
      return <StatusBadge status="cashToday" detail={compact ? undefined : "en curso"} />;
    case "missing":
      return <StatusBadge status="missingCash" />;
    case "noRecords":
      return <StatusBadge status="noRecords" />;
    case "preSplit":
      return <StatusBadge status="notComparable" />;
    case "recorded":
      return <StatusBadge status="recorded" />;
    default:
      return <span className="fx-help">Sin efectivo</span>;
  }
}

const DENOMS = [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 10];

function sessionBadge(s: CashSession): { status: StatusKey; detail?: string } {
  switch (s.state) {
    case "open":
      return { status: "open", detail: timeOf(s.openedAt!) };
    case "counting":
      return { status: "counting", detail: `${s.counts.length} de 2 conteos` };
    case "closed-balanced":
      return { status: "closedBalanced" };
    case "closed-difference":
      return { status: "closedDifference" };
    case "reopened":
      return { status: "reopened" };
    case "deposited":
      return { status: "deposited" };
    default:
      return { status: "missingSession" };
  }
}

function BlindCount({ session }: { session: CashSession }) {
  const { simulate } = usePreview();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const total = DENOMS.reduce((a, d) => a + d * (qty[d] ?? 0), 0);
  const first = session.counts[0];
  const diff = total - first.amount;
  const ok = canCloseWithDifference(diff, reason);
  const reasonId = useId();

  const set = (d: number, n: number) => setQty((q) => ({ ...q, [d]: Math.max(0, Math.min(999, n)) }));

  return (
    <div>
      <ol className="fx-step-list" style={{ marginBottom: 8 }}>
        <li>
          <span>
            <span className="fx-step-num">1</span>Conteo 1 · {first.by}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CircleCheck size={16} aria-hidden="true" style={{ color: "var(--fx-success)" }} />
            {done ? <MoneyAmount value={first.amount} /> : <span className="fx-help">Oculto hasta terminar</span>}
          </span>
        </li>
        <li>
          <span>
            <span className="fx-step-num">2</span>Conteo 2 · ciego
          </span>
          <span className="fx-help">{done ? "Terminado" : "En curso"}</span>
        </li>
      </ol>
      {!done && (
        <div role="group" aria-label="Conteo por denominación">
          {DENOMS.map((d) => (
            <div className="fx-count-row" key={d}>
              <span className="fx-count-label">{clp(d)}</span>
              <span className="fx-count-step">
                <button type="button" aria-label={`Quitar uno de ${clp(d)}`} onClick={() => set(d, (qty[d] ?? 0) - 1)}>
                  <Minus size={16} />
                </button>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label={`Cantidad de ${clp(d)}`}
                  value={qty[d] ?? 0}
                  onChange={(e) => set(d, Number(e.target.value.replace(/\D/g, "")) || 0)}
                />
                <button type="button" aria-label={`Agregar uno de ${clp(d)}`} onClick={() => set(d, (qty[d] ?? 0) + 1)}>
                  <Plus size={16} />
                </button>
              </span>
              <span className="fx-count-sub">{clp(d * (qty[d] ?? 0))}</span>
            </div>
          ))}
        </div>
      )}
      <div className="fx-count-total">
        <div className="fx-row-between" style={{ fontWeight: 600 }}>
          <span>Conteo 2</span>
          <MoneyAmount value={total} />
        </div>
        <span className="fx-sr" aria-live="polite">
          Conteo 2: {clp(total)}
        </span>
        {done && (
          <>
            <div className="fx-row-between">
              <span>Diferencia entre conteos</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                {diff !== 0 && <TriangleAlert size={14} aria-hidden="true" style={{ color: "var(--fx-danger)" }} />}
                <MoneyAmount value={diff} signed diff />
              </span>
            </div>
            {diff !== 0 && (
              <div className="fx-field" style={{ marginTop: 4 }}>
                <label htmlFor={reasonId}>Motivo de la diferencia (obligatorio)</label>
                <textarea
                  id={reasonId}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-invalid={touched && !ok}
                  placeholder="Ej.: billete contado dos veces en el primer conteo"
                />
                {touched && !ok && (
                  <p className="fx-error" role="alert">
                    <TriangleAlert size={14} aria-hidden="true" /> Explica la diferencia para poder cerrar la caja.
                  </p>
                )}
              </div>
            )}
          </>
        )}
        {done ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {diff !== 0 && (
              <button
                type="button"
                className="fx-btn fx-btn-secondary"
                onClick={() => simulate("Tercer conteo pedido a otra persona (el conteo 2 ya no puede corregirse)")}
              >
                Pedir tercer conteo
              </button>
            )}
            <button
              type="button"
              className="fx-btn fx-btn-primary"
              style={{ flex: 1 }}
              onClick={() => {
                setTouched(true);
                if (!ok) return;
                simulate(diff === 0 ? "Caja cerrada · cuadrada" : `Caja cerrada con diferencia ${clp(diff)}`);
              }}
            >
              {diff === 0 ? "Cerrar caja" : "Cerrar con diferencia"}
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="fx-btn fx-btn-primary" disabled={total === 0} onClick={() => setDone(true)}>
              Terminar conteo 2
            </button>
            <p className="fx-help">Al terminar se revela el conteo 1 y el conteo 2 queda fijo; si no cuadran, cuenta una tercera persona.</p>
          </>
        )}
      </div>
    </div>
  );
}

function AreaCash({ area }: { area: AreaKey }) {
  const { simulate } = usePreview();
  const rows = [...worshipDaysTable("2026-10"), ...worshipDaysTable("2026-09")].filter((r) => r.date >= "2026-09-09").slice(0, 6);
  const sessions = CASH_SESSIONS.filter((s) => s.area === area);
  const today = sessions.find((s) => s.date === DEMO_TODAY);
  return (
    <div className="fx-grid">
      <div className="fx-span-7 fx-md-span-12">
      <Panel title={`${AREA_LABEL[area]} · ${shortDate(DEMO_TODAY)}`} labelledBy={`caja-${area}`}>
        {today?.state === "counting" ? (
          <>
            <p className="fx-section-label">
              Cierre con doble conteo <ProposalPill />
            </p>
            <BlindCount session={today} />
          </>
        ) : today?.state === "open" ? (
          <>
            <p className="fx-section-label">
              Caja abierta <ProposalPill />
            </p>
            <dl className="fx-dl">
              <dt>Abierta por</dt>
              <dd>
                {today.openedBy} · {timeOf(today.openedAt!)}
              </dd>
              <dt>Fondo inicial</dt>
              <dd>
                <MoneyAmount value={today.float ?? 0} />
              </dd>
              <dt>Esperado en caja</dt>
              <dd style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                <MoneyAmount value={today.expected ?? 0} /> <ExampleBadge />
              </dd>
            </dl>
            <p className="fx-help" style={{ marginTop: 8 }}>
              El esperado se calcularía con el fondo y las ventas en efectivo, y nunca se edita. Requiere registrar el
              efectivo de cada venta, algo que CDS hoy no hace: el monto es de ejemplo.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="fx-btn fx-btn-secondary" onClick={() => simulate("Registrar salida de caja")}>
                Registrar salida
              </button>
              <button type="button" className="fx-btn fx-btn-primary" onClick={() => simulate("Iniciar cierre de caja")}>
                Iniciar cierre
              </button>
            </div>
          </>
        ) : (
          <EmptyState icon={Lock} title="Sin caja abierta" />
        )}
      </Panel>
      </div>

      <div className="fx-span-5 fx-md-span-12 fx-stack">
      <Panel title={`${AREA_LABEL[area]} · efectivo por culto`} labelledBy={`efectivo-${area}`}>
        <p className="fx-help" style={{ marginTop: -8, marginBottom: 8 }}>
          Lo que existe hoy en CDS: un monto de efectivo por área y día.
        </p>
        <table className="fx-table fx-table-simple fx-table-fixed">
          <caption className="fx-sr">Efectivo de {AREA_LABEL[area]} por culto</caption>
          <thead>
            <tr>
              <th scope="col">Culto</th>
              <th scope="col" className="is-num fx-hide-mobile" style={{ width: 92 }}>
                SumUp bruto
              </th>
              <th scope="col" className="is-num" style={{ width: 92 }}>
                Efectivo
              </th>
              <th scope="col" style={{ width: 132 }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sumUp = area === "ofrendas" ? r.ofrSumUp : r.cafSumUp;
              const cash = area === "ofrendas" ? r.ofrCash : r.cafCash;
              const st = areaCashStatus(r.date, area, r.status);
              return (
                <tr key={r.date}>
                  <td style={{ whiteSpace: "nowrap" }}>{shortDate(r.date)}</td>
                  <td className="is-num fx-hide-mobile">{sumUp ? <MoneyAmount value={sumUp} /> : "—"}</td>
                  <td className="is-num">{cash ? <MoneyAmount value={cash} /> : "—"}</td>
                  <td>
                    <CashStatusCell status={st} compact />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel
        title={
          <>
            {AREA_LABEL[area]} · cierres anteriores <ProposalPill />
          </>
        }
        labelledBy={`cierres-${area}`}
      >
        <ul>
          {sessions
            .filter((s) => s.date !== DEMO_TODAY)
            .map((s) => {
              const b = sessionBadge(s);
              const d = sessionDifference(s);
              const dep = sessionToDeposit(s);
              return (
                <li key={s.id} className="fx-kv-row" style={{ borderTop: "1px solid var(--fx-line)", padding: "8px 0", alignItems: "flex-start" }}>
                  <span>
                    {shortDate(s.date)}
                    <span className="fx-help" style={{ display: "block" }}>
                      {s.state === "missing"
                        ? "No se registró el cierre ni el efectivo."
                        : `${area === "ofrendas" ? "Conteos" : "Contado"} ${s.counts.map((c) => clp(c.amount)).join(" / ")}${
                            d ? ` · diferencia ${clp(d)}` : ""
                          }${dep !== null && !s.depositId ? ` · a depositar ${clp(dep)}` : ""}`}
                      {s.differenceReason ? ` · Motivo: ${s.differenceReason}` : ""}
                      {s.reopenReason ? ` · ${s.reopenReason}` : ""}
                    </span>
                  </span>
                  <StatusBadge status={b.status} detail={b.detail} />
                </li>
              );
            })}
        </ul>
      </Panel>
      </div>
    </div>
  );
}

export function CajaScreen() {
  const [area, setArea] = useState<AreaKey>("ofrendas");
  return (
    <>
      <FinancialHeader
        title="Caja"
        subtitle="Efectivo por culto y por área. Ofrendas y Cafetería se cuentan por separado."
        period={false}
        primary="none"
      />
      <DemoStates empty={<EmptyState icon={Lock} title="No hubo culto en este período" />}>
        <div className="fx-tabs" role="group" aria-label="Área">
          {(["ofrendas", "cafeteria"] as const).map((a) => (
            <button key={a} type="button" aria-pressed={area === a} onClick={() => setArea(a)}>
              {AREA_LABEL[a]}
            </button>
          ))}
        </div>
        <AreaCash key={area} area={area} />
      </DemoStates>
    </>
  );
}

// ---------- Conciliación ----------

const REC_BADGE: Record<string, StatusKey> = {
  pending: "pending",
  partial: "partial",
  reconciled: "reconciled",
  difference: "difference",
  review: "review",
};

function PayoutRow({ p }: { p: Payout }) {
  const { simulate } = usePreview();
  const [open, setOpen] = useState(false);
  const id = useId();
  const state = reconciliationState(p);
  const net = payoutNet(p);
  const deps = depositsOf(p);
  const gap = payoutGap(p);
  const depTotal = deps.reduce((a, d) => a + d.amount, 0);
  return (
    <>
      <tr>
        <td style={{ whiteSpace: "nowrap" }}>
          <button type="button" className="fx-toggle" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((v) => !v)} style={{ color: "var(--fx-ink-strong)" }}>
            <ChevronDown size={14} aria-hidden="true" /> {shortDate(p.date)}
          </button>
        </td>
        <td>SumUp {AREA_LABEL[p.account]}</td>
        <td className="is-num">
          <MoneyAmount value={p.gross} />
        </td>
        <td className="is-num fx-hide-md">{p.refunds ? <MoneyAmount value={-p.refunds} /> : clp(0)}</td>
        <td className="is-num">
          {p.fee === null ? (
            <span className="fx-help">Pendiente de SumUp</span>
          ) : (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <MoneyAmount value={-p.fee} /> <ExampleBadge />
            </span>
          )}
        </td>
        <td className="is-num">
          {net === null ? (
            <span className="fx-help">—</span>
          ) : (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <MoneyAmount value={net} /> <ExampleBadge />
            </span>
          )}
        </td>
        <td className="is-num">{depTotal ? <MoneyAmount value={depTotal} /> : <span className="fx-help">—</span>}</td>
        <td>
          <StatusBadge
            status={REC_BADGE[state]}
            detail={
              state === "difference" && gap !== null
                ? clp(gap)
                : state === "partial" && gap !== null
                  ? `falta ${clp(-gap)}`
                  : state === "reconciled"
                    ? "con comisión de ejemplo"
                    : undefined
            }
          />
        </td>
      </tr>
      {open && (
        <tr id={id}>
          <td colSpan={8} style={{ background: "var(--fx-surface-2)", padding: "12px 16px", height: "auto" }}>
            <ul style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <li>
                Ventas incluidas: {p.salesCount} pagos del {dayMonth(p.salesFrom)}
                {p.salesTo !== p.salesFrom ? ` al ${dayMonth(p.salesTo)}` : ""} · bruto {clp(p.gross)}
              </li>
              {p.fee === null && <li>{p.note}</li>}
              {net !== null && (
                <li>
                  Líquido esperado = bruto − devoluciones − comisión = {clp(p.gross)} − {clp(p.refunds)} − {clp(p.fee!)} ={" "}
                  <strong>{clp(net)}</strong> (comisión de ejemplo)
                </li>
              )}
              {deps.map((d) => (
                <li key={d.id}>
                  Depósito {numericDate(d.date)} · {clp(d.amount)} · vinculado por {d.linkedBy}
                </li>
              ))}
            </ul>
            <p className="fx-help" style={{ marginTop: 8 }}>
              {state === "reconciled"
                ? "Conciliado: el depósito vinculado coincide con el líquido esperado, calculado con una comisión de ejemplo."
                : "El estado se recalcula al vincular depósitos. Comisiones de ejemplo."}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <Link className="fx-link fx-btn-sm" href={`${BASE}/movimientos?periodo=${p.salesFrom.slice(0, 7)}&fuente=${encodeURIComponent(AREA_LABEL[p.account])}`} style={{ marginRight: 8 }}>
                Ver movimientos →
              </Link>
              {state === "difference" && (
                <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={() => simulate("Explicar diferencia")}>
                  Explicar diferencia
                </button>
              )}
              {state !== "reconciled" && (
                <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={() => simulate("Vincular depósito")}>
                  Vincular depósito
                </button>
              )}
              <button type="button" className="fx-btn fx-btn-ghost fx-btn-sm" onClick={() => simulate("Marcar para revisión")}>
                Marcar para revisión
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MobilePayouts({ list }: { list: readonly Payout[] }) {
  const { simulate } = usePreview();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="fx-mobile-list" style={{ marginTop: 8 }}>
      {list.map((p) => {
        const state = reconciliationState(p);
        const net = payoutNet(p);
        const gap = payoutGap(p);
        const isOpen = open === p.id;
        return (
          <li key={p.id}>
            <button type="button" className="fx-mlist-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>
              <span className="fx-mlist-title">
                {shortDate(p.date)} · SumUp {AREA_LABEL[p.account]}
              </span>
              <span className="fx-mlist-amount">
                <MoneyAmount value={p.gross} basis="bruto" />
              </span>
              <span className="fx-mlist-meta">
                <span style={{ flexBasis: "100%" }}>{net === null ? "Comisión pendiente de SumUp" : `Líquido ${clp(net)} · comisión de ejemplo`}</span>
                <StatusBadge
                  status={REC_BADGE[state]}
                  detail={state === "difference" && gap !== null ? clp(gap) : undefined}
                />
              </span>
            </button>
            {isOpen && (
              <div style={{ padding: "4px 16px 14px", fontSize: 14, background: "var(--fx-surface-2)" }}>
                <dl className="fx-dl">
                  <dt>Ventas</dt>
                  <dd>{p.salesCount} pagos</dd>
                  <dt>Devoluciones</dt>
                  <dd>{clp(-p.refunds)}</dd>
                  <dt>Comisión</dt>
                  <dd>{p.fee === null ? "Pendiente" : `${clp(-p.fee)} (ejemplo)`}</dd>
                  <dt>Depositado</dt>
                  <dd>{clp(depositsOf(p).reduce((a, d) => a + d.amount, 0))}</dd>
                </dl>
                {state !== "reconciled" && (
                  <button type="button" className="fx-btn fx-btn-secondary" style={{ width: "100%", marginTop: 10 }} onClick={() => simulate(state === "difference" ? "Explicar diferencia" : "Vincular depósito")}>
                    {state === "difference" ? "Explicar diferencia" : "Vincular depósito"}
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ConciliacionScreen() {
  const { simulate } = usePreview();
  const [tab, setTab] = useState<"action" | "all">("action");
  const needs = PAYOUTS.filter((p) => reconciliationState(p) !== "reconciled");
  const list = tab === "action" ? needs : PAYOUTS;
  const cash = CASH_SESSIONS.filter((s) => s.state !== "open" && s.state !== "counting" && s.state !== "missing");
  const unlinked = unlinkedDeposits();
  return (
    <>
      <FinancialHeader
        title="Conciliación"
        proposal
        subtitle="Así se vincularían los payouts de SumUp y el efectivo con los depósitos del banco."
        period={false}
        primary="none"
      />
      <Callout tone="proposal" icon={ScanSearch}>
        <p>
          <strong>Hoy CDS no recibe payouts ni depósitos.</strong> Las comisiones y líquidos de esta pantalla son de
          ejemplo. Un payout queda «Conciliado» solo cuando un depósito vinculado coincide con su líquido.
        </p>
      </Callout>
      <div style={{ height: 16 }} />
      <DemoStates empty={<EmptyState icon={CircleCheck} title="No hay payouts por revisar" />}>
        <div className="fx-tabs" role="group" aria-label="Mostrar payouts">
          <button type="button" aria-pressed={tab === "action"} onClick={() => setTab("action")}>
            Necesita acción ({needs.length})
          </button>
          <button type="button" aria-pressed={tab === "all"} onClick={() => setTab("all")}>
            Todos ({PAYOUTS.length})
          </button>
        </div>
        <div className="fx-stack">
          <Panel flush title="Payouts de SumUp" labelledBy="rec-payouts">
            <MobilePayouts list={list} />
            <div className="fx-table-wrap fx-desktop-table" style={{ marginTop: 4 }}>
              <table className="fx-table">
                <caption className="fx-sr">Payouts de SumUp y su conciliación</caption>
                <thead>
                  <tr>
                    <th scope="col">Payout</th>
                    <th scope="col">Cuenta</th>
                    <th scope="col" className="is-num">
                      Bruto
                    </th>
                    <th scope="col" className="is-num fx-hide-md">
                      Devoluciones
                    </th>
                    <th scope="col" className="is-num">
                      Comisión
                    </th>
                    <th scope="col" className="is-num">
                      Líquido
                    </th>
                    <th scope="col" className="is-num">
                      Depositado
                    </th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <PayoutRow key={p.id} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="fx-grid">
            <div className="fx-span-7 fx-md-span-12">
              <Panel flush title="Efectivo → depósito" labelledBy="rec-cash">
                <div className="fx-table-wrap">
                  <table className="fx-table fx-table-simple">
                    <caption className="fx-sr">Cajas cerradas y su depósito</caption>
                    <thead>
                      <tr>
                        <th scope="col">Caja</th>
                        <th scope="col" className="is-num">
                          A depositar
                        </th>
                        <th scope="col" className="fx-hide-mobile">
                          Depósito
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {cash.map((s) => {
                        const dep = DEPOSITS.find((d) => d.id === s.depositId);
                        const age = s.date < DEMO_TODAY ? Math.round((Date.parse(DEMO_TODAY) - Date.parse(s.date)) / 86400000) : 0;
                        const badge = dep ? (
                          <StatusBadge status="deposited" detail={shortDate(dep.date)} />
                        ) : s.state === "reopened" ? (
                          <StatusBadge status="cashPending" detail="caja reabierta" />
                        ) : (
                          <StatusBadge status={age > 3 ? "overdue" : "cashPending"} detail={`${age} d sin depositar`} />
                        );
                        return (
                          <tr key={s.id}>
                            <td>
                              <span className="fx-cell-main" style={{ whiteSpace: "nowrap" }}>
                                {AREA_LABEL[s.area]} · {shortDate(s.date)}
                              </span>
                              <span className="fx-show-mobile-inline" style={{ marginTop: 4 }}>
                                {badge}
                              </span>
                            </td>
                            <td className="is-num">
                              <MoneyAmount value={sessionToDeposit(s) ?? sessionCounted(s) ?? 0} />
                            </td>
                            <td className="fx-hide-mobile">{badge}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
            <div className="fx-span-5 fx-md-span-12">
              <Panel title="Depósitos sin origen" labelledBy="rec-unlinked">
                {unlinked.length ? (
                  <ul>
                    {unlinked.map((d) => (
                      <li key={d.id} className="fx-kv-row" style={{ alignItems: "flex-start" }}>
                        <span>
                          {numericDate(d.date)} · {d.description}
                          <span className="fx-help" style={{ display: "block" }}>
                            No coincide con ningún payout ni caja.
                          </span>
                        </span>
                        <span style={{ display: "grid", justifyItems: "end", gap: 6 }}>
                          <MoneyAmount value={d.amount} />
                          <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={() => simulate("Vincular depósito")}>
                            Vincular
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={CircleCheck} title="Todo vinculado" />
                )}
              </Panel>
            </div>
          </div>
        </div>
      </DemoStates>
    </>
  );
}

