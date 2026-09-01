"use client";
import { useMemo, useRef, useState } from "react";
import { useAccess } from "@/lib/auth/access-provider";
import { usePeriod, useSummaries, useTransactions } from "@/lib/finance/hooks";
import { buildReport, type FinanceReport } from "@/lib/finance/reports";
import { clp, errorMessage } from "@/lib/finance/formatters";
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
      transactions.error
    )
      return { data: null, error: "" };
    try {
      return {
        data: buildReport(
          period,
          summaries.data,
          transactions.data,
          access.displayName,
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
        view={<PeriodViewControl value={period} onChange={changePeriod} />}
        period={<PeriodPicker value={period} onChange={changePeriod} />}
        actions={
          <>
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
          </>
        }
      />
      <Notice
        error={summaries.error || transactions.error || preview.error || error}
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
function ReportPreview({
  report,
  charts,
}: {
  report: FinanceReport;
  charts: React.ReactNode;
}) {
  return (
    <section aria-label="Vista previa del reporte">
      <div className="panel">
        <p className="eyebrow">VISTA PREVIA · PDF A4</p>
        <h3 className="mt-3">Casa de Salvación · Reporte Financiero</h3>
        <p className="mt-2 text-sm text-muted">
          {report.label} · Generado por {report.generatedBy}
        </p>
      </div>
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
