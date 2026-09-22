"use client";
import { useMemo, useRef, useState } from "react";
import { TriangleAlert, CircleDashed } from "lucide-react";
import { useAccess } from "@/lib/auth/access-provider";
import {
  usePeriod,
  useSummaries,
  useTransactions,
} from "@/lib/finance/hooks";
import { buildReport, type AlertItem, type FinanceReport } from "@/lib/finance/reports";
import { clp, errorMessage, previousPeriod, today } from "@/lib/finance/formatters";
import {
  DetailGuard,
  FinancePageHeader,
  PeriodPicker,
  PeriodViewControl,
  Notice,
  Loading,
  Empty,
} from "../shared";
import { Kpis } from "../dashboard/kpis";
import { FinanceCharts } from "../charts/finance-charts";
export function ReportsPage() {
  return (
    <DetailGuard>
      <Reports />
    </DetailGuard>
  );
}
function Reports() {
  const access = useAccess();
  const [period, setPeriod] = usePeriod();
  const summaries = useSummaries(period);
  const transactions = useTransactions(period);
  const isMonthView = period.view === "month";
  const previousSummaries = useSummaries(previousPeriod(period));
  const previousTransactions = useTransactions(previousPeriod(period), isMonthView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const lock = useRef(false);
  function changePeriod(nextPeriod: typeof period) {
    setPeriod(nextPeriod);
    setSuccess("");
    setError("");
  }
  const preview = useMemo(() => {
    if (
      summaries.loading ||
      transactions.loading ||
      summaries.error ||
      transactions.error ||
      (isMonthView && (previousSummaries.loading || previousTransactions.loading))
    )
      return { data: null, error: "" };
    try {
      return {
        data: buildReport(
          period,
          summaries.data,
          transactions.data,
          access.displayName,
          new Date(),
          {
            previousTransactions: isMonthView ? previousTransactions.data : undefined,
            previousSummaries: isMonthView ? previousSummaries.data : undefined,
            today: today(),
          },
        ),
        error: "",
      };
    } catch (e) {
      return { data: null, error: errorMessage(e) };
    }
  }, [
    period,
    summaries.data,
    summaries.loading,
    summaries.error,
    transactions.data,
    transactions.loading,
    transactions.error,
    isMonthView,
    previousSummaries.data,
    previousSummaries.loading,
    previousTransactions.data,
    previousTransactions.loading,
    access.displayName,
  ]);
  async function generate(share = false) {
    if (lock.current || !preview.data) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const { createFinancePdf, loadReportLogo } =
        await import("@/lib/finance/report-pdf");
      const report = { ...preview.data, generatedAt: new Date() };
      const pdf = createFinancePdf(report, await loadReportLogo());
      const blob = pdf.output("blob");
      const file = new File([blob], report.filename, {
        type: "application/pdf",
      });
      if (share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            title: `Finanzas · ${report.label}`,
            files: [file],
          });
          setSuccess("Reporte compartido correctamente");
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") return;
          pdf.save(report.filename);
          setSuccess("No se pudo compartir directamente; se descargó el PDF.");
        }
      } else {
        pdf.save(report.filename);
        setSuccess(
          share
            ? "Este navegador no permite compartir archivos; se descargó el PDF."
            : "PDF descargado correctamente",
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <FinancePageHeader
        title="Reportes financieros"
        subtitle="Revisa la vista previa y descarga un PDF con texto y gráficos vectoriales."
        aside={<PeriodViewControl value={period} onChange={changePeriod} />}
      />
      <div className="report-period-controls">
        <PeriodPicker value={period} onChange={changePeriod} />
        <div className="report-actions">
          <button
            className="button-primary"
            disabled={!preview.data || busy}
            onClick={() => void generate()}
          >
            {busy ? "Preparando PDF…" : "Descargar PDF"}
          </button>
          <button
            className="button-secondary"
            disabled={!preview.data || busy}
            onClick={() => void generate(true)}
          >
            Compartir
          </button>
        </div>
      </div>
      <Notice
        error={
          summaries.error ||
          transactions.error ||
          (isMonthView ? previousSummaries.error || previousTransactions.error : "") ||
          preview.error ||
          error
        }
        success={success}
      />
      <p className="mb-6 text-xs leading-6 text-muted">
        El reporte financiero general no incluye nombres ni datos personales de
        las fichas de diezmos, ni notas privadas. Los movimientos anulados se
        conservan en una sección separada y no suman a los totales.
      </p>
      {summaries.loading || transactions.loading ? (
        <Loading />
      ) : preview.data ? (
        <ReportPreview
          report={preview.data}
          charts={<FinanceCharts summaries={summaries.data} period={period} />}
        />
      ) : (
        <Empty>
          La vista previa estará disponible cuando la información esté completa.
        </Empty>
      )}
    </>
  );
}
function AlertRow({ alert }: { alert: AlertItem }) {
  return (
    <li className={alert.tone === "revisar" ? "text-warning" : "text-muted"}>
      {alert.tone === "revisar" ? (
        <TriangleAlert size={15} aria-hidden="true" />
      ) : (
        <CircleDashed size={15} aria-hidden="true" />
      )}
      <span>{alert.text}</span>
    </li>
  );
}

function ReportPreview({
  report,
  charts,
}: {
  report: FinanceReport;
  charts: React.ReactNode;
}) {
  const isMonth = report.period.view === "month";
  return (
    <section aria-label="Vista previa del reporte">
      <div className="panel">
        <p className="eyebrow">VISTA PREVIA · PDF A4</p>
        <h3 className="mt-3">Casa de Salvación · Reporte Financiero</h3>
        <p className="mt-2 text-sm text-muted">
          {report.label} · Generado por {report.generatedBy}
        </p>
      </div>

      {isMonth && report.narrative && (
        <section className="panel mt-6">
          <h3>Resumen ejecutivo</h3>
          <p className="mt-3 text-sm leading-6">{report.narrative}</p>
        </section>
      )}

      <section className="panel mt-6">
        <h3>Alertas</h3>
        {report.alerts.revisar.length ? (
          <ul className="report-alerts mt-3">
            {report.alerts.revisar.map((a, i) => (
              <AlertRow key={`revisar-${i}`} alert={a} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Sin alertas de revisión en este período.
          </p>
        )}
        {report.alerts.info.length > 0 && (
          <ul className="report-alerts mt-3">
            {report.alerts.info.map((a, i) => (
              <AlertRow key={`info-${i}`} alert={a} />
            ))}
          </ul>
        )}
      </section>

      <section className="panel mt-6">
        <h3>Por tipo de dinero</h3>
        <table className="income-method-table mt-3">
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Monto</th>
              <th scope="col">%</th>
              <th scope="col">Mov.</th>
            </tr>
          </thead>
          <tbody>
            {report.byMethod.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td className="tabular-nums">{clp(row.amount)}</td>
                <td className="tabular-nums">
                  {row.percent.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%
                </td>
                <td className="tabular-nums">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel mt-6">
        <h3>Por fuente</h3>
        {isMonth ? (
          <table className="income-method-table mt-3">
            <thead>
              <tr>
                <th scope="col">Fuente</th>
                <th scope="col">SumUp (bruto)</th>
                <th scope="col">Efectivo</th>
                <th scope="col">Transferencia</th>
                <th scope="col">Otro</th>
                <th scope="col">Total</th>
                <th scope="col">Mes anterior</th>
              </tr>
            </thead>
            <tbody>
              {report.bySource.map((row) => (
                <tr key={row.category}>
                  <th scope="row">{row.category}</th>
                  <td className="tabular-nums">{row.sumUp ? clp(row.sumUp) : "—"}</td>
                  <td className="tabular-nums">{row.cash ? clp(row.cash) : "—"}</td>
                  <td className="tabular-nums">{row.transfer ? clp(row.transfer) : "—"}</td>
                  <td className="tabular-nums">{row.other ? clp(row.other) : "—"}</td>
                  <td className="tabular-nums">{clp(row.total)}</td>
                  <td>
                    {row.notComparable
                      ? "No comparable (antes del 09/09 SumUp no separaba áreas)"
                      : row.previousTotal !== null
                        ? clp(row.previousTotal)
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-sm text-muted">
            — Comparación disponible en vista mensual.
          </p>
        )}
      </section>

      {isMonth ? (
        <section className="panel mt-6">
          <h3>Días de culto</h3>
          <div className="offering-days-table-wrap mt-3">
            <table className="offering-days-table">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Ofrendas SumUp</th>
                  <th scope="col">Ofrendas efectivo</th>
                  <th scope="col">Cafetería SumUp</th>
                  <th scope="col">Cafetería efectivo</th>
                  <th scope="col">Diezmos</th>
                  <th scope="col">Total del día</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {report.worshipDays.map((row) => (
                  <tr key={row.date}>
                    <td>{row.label}</td>
                    <td className="tabular-nums">{row.offeringsSumUp ? clp(row.offeringsSumUp) : "—"}</td>
                    <td className="tabular-nums">{row.offeringsCash ? clp(row.offeringsCash) : "—"}</td>
                    <td className="tabular-nums">{row.cafeSumUp ? clp(row.cafeSumUp) : "—"}</td>
                    <td className="tabular-nums">{row.cafeCash ? clp(row.cafeCash) : "—"}</td>
                    <td className="tabular-nums">{row.tithe ? clp(row.tithe) : "—"}</td>
                    <td className="tabular-nums">{clp(row.total)}</td>
                    <td>{row.statusLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="panel mt-6">
          <h3>Resumen de los 12 meses</h3>
          <div className="offering-days-table-wrap mt-3">
            <table className="offering-days-table">
              <thead>
                <tr>
                  <th scope="col">Mes</th>
                  <th scope="col">Ingresos</th>
                  <th scope="col">Efectivo</th>
                  <th scope="col">SumUp</th>
                  <th scope="col">Transferencia</th>
                  <th scope="col">Gastos</th>
                  <th scope="col">Alertas (n)</th>
                </tr>
              </thead>
              <tbody>
                {report.monthlyByMethod.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="tabular-nums">{clp(row.income)}</td>
                    <td className="tabular-nums">{clp(row.cash)}</td>
                    <td className="tabular-nums">{clp(row.sumUp)}</td>
                    <td className="tabular-nums">{clp(row.transfer)}</td>
                    <td className="tabular-nums">{clp(row.expense)}</td>
                    <td className="tabular-nums">{row.alertCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel mt-6">
        <h3>Principales categorías</h3>
        <div className="source-block mt-3">
          <div>
            <h4 className="mb-2 text-sm font-medium">Top 5 ingresos</h4>
            {report.topIncome.length ? (
              <table className="income-method-table">
                <tbody>
                  {report.topIncome.map((row) => (
                    <tr key={row.category}>
                      <th scope="row">{row.category}</th>
                      <td className="tabular-nums">
                        {clp(row.amount)} ·{" "}
                        {row.percent.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted">Sin ingresos registrados.</p>
            )}
          </div>
          <div>
            <h4 className="mb-2 text-sm font-medium">Top 5 gastos</h4>
            {report.topExpense.length ? (
              <table className="income-method-table">
                <tbody>
                  {report.topExpense.map((row) => (
                    <tr key={row.category}>
                      <th scope="row">{row.category}</th>
                      <td className="tabular-nums">
                        {clp(row.amount)} ·{" "}
                        {row.percent.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted">Sin gastos registrados</p>
            )}
          </div>
        </div>
      </section>

      <Kpis summary={report.summary} />
      {charts}
      <section className="panel mt-6">
        <h3>Detalle incluido en el PDF</h3>
        <p className="my-3 text-xs text-muted">
          {report.rows.length} movimientos activos · {report.voided.length}{" "}
          anulados. Vista previa de hasta 20 movimientos; el PDF contiene todos
          los del período.
        </p>
        {!report.rows.length ? (
          <p className="py-8 text-sm text-muted">
            Sin movimientos activos en este período.
          </p>
        ) : (
          report.rows.slice(0, 20).map((row, i) => (
            <div
              key={i}
              className="flex flex-wrap justify-between gap-3 border-b border-line py-3 text-xs"
            >
              <div className="min-w-0">
                <p className="break-words">{row.description}</p>
                <p className="mt-1 text-muted">
                  {row.date} · {row.category} · {row.method}
                </p>
              </div>
              <strong>{clp(row.amount)}</strong>
            </div>
          ))
        )}
      </section>
    </section>
  );
}
