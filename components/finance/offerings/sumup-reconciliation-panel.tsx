"use client";

// Panel "Conciliación SumUp" (doc 29) — SOLO LECTURA. Muestra, por abono de
// SumUp, ventas brutas, comisión (solo la que informa SumUp), ajustes,
// abono neto y estado, más lo que falta por abonar. No registra movimientos:
// las comisiones son propuestas que requieren una aprobación aparte.

import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Clock, RefreshCw, TriangleAlert } from "lucide-react";
import { clp, today } from "@/lib/finance/formatters";
import { firstOfMonth, lastOfMonth, numericYmd } from "@/lib/shared/dates";
import {
  SETTLEMENT_STATUS_LABEL,
  SUMUP_ACCOUNT_LABEL,
  type AccountReconciliation,
  type PendingDay,
  type Settlement,
  type SettlementStatus,
} from "@/lib/shared/sumup-payouts";
import {
  PAYOUTS_ERROR_MESSAGE,
  SETTLEMENT_REASON_LABEL,
  accountErrorMessage,
  payoutsErrorKind,
  requestPayoutsReconciliation,
  type PayoutsErrorKind,
  type PayoutsResponse,
} from "@/lib/offerings/payouts-client";

function dayMonth(ymd: string | null) {
  return ymd ? numericYmd(ymd).slice(0, 5) : "—";
}

function StatusBadge({ status }: { status: SettlementStatus }) {
  const label = SETTLEMENT_STATUS_LABEL[status];
  const icon =
    status === "CONCILIADO" ? (
      <CircleCheck size={13} aria-hidden="true" />
    ) : status === "PENDIENTE" ? (
      <Clock size={13} aria-hidden="true" />
    ) : status === "CON_DIFERENCIA" ? (
      <TriangleAlert size={13} aria-hidden="true" />
    ) : (
      <CircleAlert size={13} aria-hidden="true" />
    );
  const tone = status === "CONCILIADO" ? "" : status === "PENDIENTE" ? "text-muted" : "text-warning";
  return (
    <span className={`status-inline ${tone}`.trim()} data-status={status}>
      {icon}
      {label}
    </span>
  );
}

function feeText(s: Pick<Settlement, "fee" | "feeConfirmed">) {
  if (s.fee === null) return "pendiente";
  return s.feeConfirmed ? clp(s.fee) : `${clp(s.fee)} · sin confirmar`;
}

/** Etiqueta de celda visible solo en teléfono (la tabla oculta su encabezado < 640 px). */
function CellLabel({ children }: { children: string }) {
  return <span className="text-muted sm:hidden">{children}: </span>;
}

function SettlementRow({ s }: { s: Settlement }) {
  const reasons = s.reasons.filter((r) => r !== "difference_within_term" || s.status === "PENDIENTE");
  return (
    <tr data-testid="settlement-row">
      <td>
        <CellLabel>Abono</CellLabel>
        {dayMonth(s.payoutDate)}
        {s.afterWindow ? <span className="field-help"> · mes siguiente</span> : null}
      </td>
      <td>
        <CellLabel>Ventas del</CellLabel>
        {s.saleDays.length ? s.saleDays.map(dayMonth).join(", ") : "—"}
      </td>
      <td className="tabular-nums">
        <CellLabel>Ventas brutas</CellLabel>
        {clp(s.grossSales)}
      </td>
      <td className="tabular-nums">
        <CellLabel>Comisión SumUp</CellLabel>
        {feeText(s)}
      </td>
      <td className="tabular-nums">
        <CellLabel>Ajustes / devoluciones</CellLabel>
        {s.adjustments ? clp(s.adjustments) : "—"}
      </td>
      <td className="tabular-nums">
        <CellLabel>Abono neto</CellLabel>
        {clp(s.netPaid)}
      </td>
      <td>
        <StatusBadge status={s.status} />
        {s.status !== "CONCILIADO" && reasons.length > 0 && (
          <span className="field-help block whitespace-normal">{SETTLEMENT_REASON_LABEL[reasons[0]]}</span>
        )}
      </td>
      <td>
        <CellLabel>Ref.</CellLabel>
        <span title="Referencia del abono (abreviada)">{s.referenceShort}</span>
      </td>
    </tr>
  );
}

function PendingRow({ p }: { p: PendingDay }) {
  return (
    <tr data-testid="pending-row">
      <td>
        <CellLabel>Abono</CellLabel>
        Por abonar
      </td>
      <td>
        <CellLabel>Ventas del</CellLabel>
        {dayMonth(p.saleDate)}
      </td>
      <td className="tabular-nums">
        <CellLabel>Ventas brutas</CellLabel>
        {clp(p.amount)}
      </td>
      <td>
        <CellLabel>Comisión SumUp</CellLabel>
        pendiente
      </td>
      <td>
        <CellLabel>Ajustes / devoluciones</CellLabel>—
      </td>
      <td>
        <CellLabel>Abono neto</CellLabel>—
      </td>
      <td>
        <StatusBadge status="PENDIENTE" />
        {p.failedCount > 0 && <span className="field-help block whitespace-normal">SumUp informó un abono fallido</span>}
      </td>
      <td>—</td>
    </tr>
  );
}

function AccountBlock({ data }: { data: AccountReconciliation }) {
  const label = SUMUP_ACCOUNT_LABEL[data.account];
  const t = data.totals;
  const rows = data.settlements.length + data.pendingDays.length;
  return (
    <div className="offering-area-block" data-testid={`recon-${data.account}`}>
      <h3>{label}</h3>
      <div className="offering-area-line">
        <span>Ventas brutas abonadas</span>
        <strong className="tabular-nums">{clp(t.grossSales)}</strong>
      </div>
      <div className="offering-area-line">
        <span>Comisión SumUp</span>
        <strong className="tabular-nums">
          {t.settlements === 0 ? "pendiente" : t.feeComplete ? clp(t.fee) : `${clp(t.fee)} · sin confirmar`}
        </strong>
      </div>
      <div className="offering-area-line">
        <span>Ajustes / devoluciones</span>
        <strong className="tabular-nums">{t.adjustments ? clp(t.adjustments) : "—"}</strong>
      </div>
      <div className="offering-area-line offering-area-total">
        <span>Abono neto</span>
        <strong className="tabular-nums">{clp(t.netPaid)}</strong>
      </div>
      <div className="offering-area-line">
        <span>SumUp pendiente de abono</span>
        <strong className="tabular-nums" data-testid={`pending-${data.account}`}>
          {data.pendingAmount > 0 ? `${clp(data.pendingAmount)} · comisión pendiente` : clp(0)}
        </strong>
      </div>
      {rows > 0 ? (
        <div className="offering-days-table-wrap mt-3">
          <table className="offering-days-table">
            <caption className="sr-only">Abonos SumUp de {label}</caption>
            <thead>
              <tr>
                <th scope="col">Abono</th>
                <th scope="col">Ventas del</th>
                <th scope="col">Ventas brutas</th>
                <th scope="col">Comisión SumUp</th>
                <th scope="col">Ajustes / devoluciones</th>
                <th scope="col">Abono neto</th>
                <th scope="col">Estado</th>
                <th scope="col">Ref.</th>
              </tr>
            </thead>
            <tbody>
              {data.settlements.map((s) => (
                <SettlementRow key={s.id} s={s} />
              ))}
              {data.pendingDays.map((p) => (
                <PendingRow key={`p-${p.saleDate}`} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="field-help">Sin abonos ni ventas con tarjeta por abonar en este mes.</p>
      )}
    </div>
  );
}

type PanelState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: PayoutsErrorKind }
  | { kind: "ready"; data: PayoutsResponse };

export function SumUpReconciliationPanel({
  selectedDate,
  request = requestPayoutsReconciliation,
}: {
  selectedDate: string;
  /** Inyectable para pruebas y vistas locales; por defecto, el callable real. */
  request?: typeof requestPayoutsReconciliation;
}) {
  const startDate = firstOfMonth(selectedDate);
  const endDate = lastOfMonth(selectedDate);
  const future = startDate > today();
  const monthLabel = new Date(`${startDate}T12:00:00.000Z`).toLocaleDateString("es-CL", { month: "long", year: "numeric", timeZone: "UTC" });

  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled || future) return;
    const id = ++requestId.current;
    // Mostrar "cargando" es parte de sincronizar el panel con la consulta en curso.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: "loading" });
    request({ account: "both", startDate, endDate })
      .then((data) => {
        if (id === requestId.current) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (id === requestId.current) setState({ kind: "error", error: payoutsErrorKind(error) });
      });
  }, [enabled, future, startDate, endDate, reloadKey, request]);

  return (
    <section className="panel mt-6" aria-labelledby="sumup-recon-title" data-testid="sumup-reconciliation">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SOLO LECTURA</span>
          <h2 id="sumup-recon-title">Conciliación SumUp</h2>
          <p>Abonos de SumUp de {monthLabel}: ventas brutas, comisión informada por SumUp, ajustes y abono neto.</p>
        </div>
        {!future &&
          (enabled ? (
            <button
              type="button"
              className="button-ghost"
              disabled={state.kind === "loading"}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {state.kind === "loading" ? "Consultando…" : "Actualizar"}
            </button>
          ) : (
            <button type="button" className="button-secondary" onClick={() => setEnabled(true)}>
              Consultar abonos
            </button>
          ))}
      </div>

      {future ? (
        <p className="field-help">Aún no hay abonos para este mes.</p>
      ) : state.kind === "idle" ? (
        <p className="field-help">Consulta los abonos de SumUp para comparar con el banco. No registra movimientos.</p>
      ) : state.kind === "loading" ? (
        <p className="field-help" role="status">Consultando abonos de SumUp…</p>
      ) : state.kind === "error" ? (
        <p className={state.error === "unavailable" ? "field-help" : "notice-warning"} role="status">
          {state.error !== "unavailable" && <TriangleAlert size={15} aria-hidden="true" />}
          {PAYOUTS_ERROR_MESSAGE[state.error]}
        </p>
      ) : (
        <>
          <div>
            {state.data.accounts.map((a) =>
              a.ok ? (
                <AccountBlock key={a.account} data={a} />
              ) : (
                <div key={a.account} className="offering-area-block" data-testid={`recon-${a.account}`}>
                  <h3>{SUMUP_ACCOUNT_LABEL[a.account]}</h3>
                  <p className="field-help" role="status">
                    {accountErrorMessage(a.errorClass)}
                  </p>
                </div>
              ),
            )}
          </div>
          <p className="field-help mt-3">
            Solo lectura: no se registra ningún movimiento. La comisión sale de lo que informa SumUp; si no la informa, se
            muestra como pendiente. Las comisiones propuestas requieren aprobación antes de registrarse.
          </p>
        </>
      )}
    </section>
  );
}
