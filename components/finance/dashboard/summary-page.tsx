"use client";
import Link from "next/link";
import { useState } from "react";
import { useAccess } from "@/lib/auth/access-provider";
import { canSeeDetails } from "@/lib/finance/permissions";
import { usePeriod, useSummaries, useTransactions } from "@/lib/finance/hooks";
import { combineSummaries } from "@/lib/finance/calculations";
import { previousPeriod, periodLabel } from "@/lib/finance/formatters";
import { PeriodPicker, Notice, Loading, Empty } from "../shared";
import { FinanceCharts } from "../charts/finance-charts";
import { TransactionForm } from "../forms/transaction-form";
import { TransactionList } from "../transactions/transaction-list";
import { Kpis } from "./kpis";
export function SummaryPage() {
  const [period, setPeriod] = usePeriod();
  const summaries = useSummaries(period);
  const previous = useSummaries(previousPeriod(period));
  const details = canSeeDetails(useAccess().role);
  const latest = useTransactions(period, details, 6);
  const [create, setCreate] = useState(false);
  const [success, setSuccess] = useState("");
  const total = combineSummaries(summaries.data);
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Resumen financiero</h2>
          <p>{periodLabel(period)} · Información confirmada en Firestore.</p>
        </div>
        {details && (
          <div className="flex flex-wrap gap-2">
            <button className="button-primary" onClick={() => setCreate(true)}>
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
      <PeriodPicker value={period} onChange={setPeriod} />
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
          ) : latest.error ? null : latest.data.length ? (
            <TransactionList items={latest.data} onSaved={setSuccess} />
          ) : (
            <Empty>No hay registros en este período.</Empty>
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
