"use client";
import Link from "next/link";
import { useState } from "react";
import { useAccess } from "@/lib/auth/access-provider";
import { canSeeDetails } from "@/lib/finance/permissions";
import { usePeriod, useSummaries, useTransactions } from "@/lib/finance/hooks";
import { combineSummaries } from "@/lib/finance/calculations";
import { clp, previousPeriod, periodLabel } from "@/lib/finance/formatters";
import {
  FinancePageHeader,
  PeriodPicker,
  PeriodViewControl,
  Notice,
  Loading,
  Empty,
} from "../shared";
import { FinanceCharts } from "../charts/finance-charts";
import { TransactionForm } from "../forms/transaction-form";
import { TransactionList } from "../transactions/transaction-list";
import { Kpis } from "./kpis";
export function SummaryPage() {
  const [period, setPeriod] = usePeriod();
  const summaries = useSummaries(period);
  const previous = useSummaries(previousPeriod(period));
  const details = canSeeDetails(useAccess().role);
  const latest = useTransactions(period, details);
  const [create, setCreate] = useState(false);
  const [success, setSuccess] = useState("");
  const total = combineSummaries(summaries.data);

  const isSumUpTransaction = (id: string, createdBy: string) =>
    id.startsWith("sumup_") || createdBy === "system:sumup";

  const sumUpTransactions = latest.data.filter(
    (transaction) =>
      transaction.status === "active" &&
      transaction.type === "income" &&
      isSumUpTransaction(
        transaction.id,
        transaction.createdBy,
      ),
  );

  const sumUpTotal = sumUpTransactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );

  const latestNonSumUp = latest.data
    .filter(
      (transaction) =>
        !isSumUpTransaction(
          transaction.id,
          transaction.createdBy,
        ),
    )
    .slice(0, 6);
  return (
    <>
      <FinancePageHeader
        title="Resumen financiero"
        subtitle="Información confirmada en Firestore."
      />
      <div className="summary-period-controls">
        <div className="summary-period-left">
          <PeriodViewControl value={period} onChange={setPeriod} />
          <PeriodPicker
            value={period}
            onChange={setPeriod}
            showPeriodLabel={false}
          />
        </div>

        {details && (
          <div className="finance-page-actions">
            <button
              className="button-primary"
              onClick={() => setCreate(true)}
            >
              + Registrar movimiento
            </button>
            <Link
              className="button-secondary"
              href="/finanzas/diezmos?registrar=1"
            >
              + Registrar diezmo
            </Link>
          </div>
        )}
      </div>
      <Notice error={summaries.error || previous.error} success={success} />
      {summaries.loading ? (
        <Loading />
      ) : summaries.error ? null : (
        <>
          <Kpis
            summary={total}
            previous={
              !previous.error &&
              previous.data.some((s) => s.transactionCount > 0)
                ? combineSummaries(previous.data)
                : undefined
            }
          />
          <p className="mb-6 text-xs text-muted">
            El resultado del período es ingresos menos gastos; no representa el
            saldo bancario.
          </p>
          {!total.transactionCount ? (
            <Empty>
              <h3>
                Aún no hay movimientos en {periodLabel(period).toLowerCase()}.
              </h3>
              <p className="mt-2">
                Los indicadores y gráficos se completarán al registrar
                movimientos.
              </p>
              {details && (
                <button
                  className="button-primary mt-5"
                  onClick={() => setCreate(true)}
                >
                  Registrar primer movimiento
                </button>
              )}
            </Empty>
          ) : (
            <FinanceCharts summaries={summaries.data} period={period} />
          )}
        </>
      )}
      {details && (
        <section className="mt-8">
          <div className="section-heading">
            <h2>Últimos movimientos</h2>
            <Link className="button-secondary" href="/finanzas/movimientos">
              Ver todos
            </Link>
          </div>
          <Notice error={latest.error} />

          {latest.loading ? (
            <Loading />
          ) : latest.error ? null : (
            <>
              {sumUpTotal > 0 && (
                <div className="summary-sumup-card">
                  <div className="summary-sumup-copy">
                    <span className="eyebrow">
                      SUMUP · TOTAL DEL PERÍODO
                    </span>

                    <h3>Recaudación SumUp</h3>

                    <p>
                      Incluye Ofrendas, Cafetería y el histórico
                      anterior al 09/09/2026 sin separación.
                    </p>
                  </div>

                  <div className="summary-sumup-amount">
                    <strong>{clp(sumUpTotal)}</strong>

                    <span>
                      {sumUpTransactions.length} movimientos agrupados
                    </span>

                    <Link
                      className="button-secondary"
                      href="/finanzas/movimientos"
                    >
                      Ver detalle
                    </Link>
                  </div>
                </div>
              )}

              {latestNonSumUp.length ? (
                <TransactionList
                  items={latestNonSumUp}
                  onSaved={setSuccess}
                />
              ) : sumUpTotal ? (
                <p className="summary-sumup-only-note">
                  No hay otros movimientos recientes en este período.
                </p>
              ) : (
                <Empty>No hay registros en este período.</Empty>
              )}
            </>
          )}
        </section>
      )}
      {create && (
        <TransactionForm
          onClose={() => setCreate(false)}
          onSaved={setSuccess}
        />
      )}
    </>
  );
}
