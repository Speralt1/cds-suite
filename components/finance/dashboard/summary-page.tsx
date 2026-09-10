"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccess } from "@/lib/auth/access-provider";
import { canSeeDetails } from "@/lib/finance/permissions";
import {
  usePeriod,
  useSummaries,
  useTransactions,
} from "@/lib/finance/hooks";
import { combineSummaries } from "@/lib/finance/calculations";
import {
  clp,
  previousPeriod,
  periodLabel,
  today,
} from "@/lib/finance/formatters";
import type { PeriodSelection } from "@/lib/finance/types";
import {
  FinancePageHeader,
  PeriodPicker,
  Notice,
  Loading,
  Empty,
} from "../shared";
import { FinanceCharts } from "../charts/finance-charts";
import { TransactionForm } from "../forms/transaction-form";
import { TransactionList } from "../transactions/transaction-list";
import { Kpis } from "./kpis";

type SummaryView = "day" | "month" | "year";

function DailyKpis({
  income,
  expense,
  tithe,
  movements,
  showDetails,
}: {
  income: number;
  expense: number;
  tithe: number;
  movements: number;
  showDetails: boolean;
}) {
  const rows: [string, string, number, boolean][] = [
    ["Ingresos", "income", income, false],
    ["Gastos", "expense", expense, false],
    ["Resultado del día", "result", income - expense, false],
  ];

  if (showDetails) {
    rows.push(
      ["Diezmos", "tithe", tithe, false],
      ["Movimientos", "movements", movements, true],
    );
  }

  return (
    <div className="kpi-grid">
      {rows.map(([label, key, value, integer]) => (
        <article className="kpi" key={key}>
          <h3>{label}</h3>
          <p
            className={
              key === "result" && value < 0 ? "text-danger" : ""
            }
          >
            {integer ? value.toLocaleString("es-CL") : clp(value)}
          </p>
        </article>
      ))}
    </div>
  );
}

export function SummaryPage() {
  const [period, setPeriod] = usePeriod();
  const [summaryView, setSummaryView] =
    useState<SummaryView>(period.view);
  const [dailyDate, setDailyDate] = useState(today());
  const details = canSeeDetails(useAccess().role);

  const dailyPeriod: PeriodSelection = {
    year: Number(dailyDate.slice(0, 4)),
    month: Number(dailyDate.slice(5, 7)),
    view: "month",
  };

  const summaries = useSummaries(period);
  const previous = useSummaries(previousPeriod(period));
  const latest = useTransactions(period, details);
  const dailySummaries = useSummaries(dailyPeriod);
  const dailyTransactions = useTransactions(dailyPeriod, details);

  const [create, setCreate] = useState(false);
  const [success, setSuccess] = useState("");

  const total = combineSummaries(summaries.data);
  const dailyMonth = combineSummaries(dailySummaries.data);
  const dailyDay = String(Number(dailyDate.slice(8, 10)));
  const dailyPeriodId = dailyDate.slice(0, 7);

  const dailyIncome = Number(dailyMonth.dailyIncome[dailyDay] || 0);
  const dailyExpense = Number(dailyMonth.dailyExpense[dailyDay] || 0);

  const dailyRows = dailyTransactions.data.filter(
    (transaction) =>
      transaction.period === dailyPeriodId &&
      transaction.day === dailyDay,
  );

  const activeDailyRows = dailyRows.filter(
    (transaction) => transaction.status === "active",
  );

  const dailyTithe = activeDailyRows.reduce(
    (sum, transaction) =>
      sum + (transaction.source === "tithe" ? transaction.amount : 0),
    0,
  );

  const movementItems =
    summaryView === "day" ? dailyRows : latest.data;
  const movementLoading =
    summaryView === "day" ? dailyTransactions.loading : latest.loading;
  const movementError =
    summaryView === "day" ? dailyTransactions.error : latest.error;

  const isSumUpTransaction = (id: string, createdBy: string) =>
    id.startsWith("sumup_") || createdBy === "system:sumup";

  const sumUpTransactions = movementItems.filter(
    (transaction) =>
      transaction.status === "active" &&
      transaction.type === "income" &&
      isSumUpTransaction(transaction.id, transaction.createdBy),
  );

  const sumUpTotal = sumUpTransactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );

  const latestNonSumUp = movementItems
    .filter(
      (transaction) =>
        !isSumUpTransaction(transaction.id, transaction.createdBy),
    )
    .slice(0, 6);

  function selectView(view: SummaryView) {
    setSummaryView(view);
    if (view === "month" || view === "year") {
      setPeriod({ ...period, view });
    }
  }

  return (
    <>
      <FinancePageHeader
        title="Resumen financiero"
        subtitle="Información confirmada en Firestore."
      />

      <div className="summary-period-controls">
        <div className="summary-period-left">
          <div
            className="period-view-toggle"
            role="group"
            aria-label="Vista del período"
          >
            {(
              [
                ["day", "Diario"],
                ["month", "Mensual"],
                ["year", "Anual"],
              ] as const
            ).map(([view, label]) => (
              <button
                key={view}
                type="button"
                aria-pressed={summaryView === view}
                onClick={() => selectView(view)}
              >
                {label}
              </button>
            ))}
          </div>

          {summaryView === "day" ? (
            <label className="summary-day-picker">
              Fecha
              <input
                type="date"
                min="2000-01-01"
                max="2099-12-31"
                value={dailyDate}
                onChange={(event) => setDailyDate(event.target.value)}
              />
            </label>
          ) : (
            <PeriodPicker
              value={period}
              onChange={setPeriod}
              showPeriodLabel={false}
            />
          )}
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

      <Notice
        error={
          summaryView === "day"
            ? dailySummaries.error ||
              (details ? dailyTransactions.error : "")
            : summaries.error || previous.error
        }
        success={success}
      />

      {summaryView === "day" ? (
        dailySummaries.loading ||
        (details && dailyTransactions.loading) ? (
          <Loading />
        ) : dailySummaries.error ? null : (
          <>
            <DailyKpis
              income={dailyIncome}
              expense={dailyExpense}
              tithe={dailyTithe}
              movements={activeDailyRows.length}
              showDetails={details}
            />

            <p className="mb-6 text-xs text-muted">
              Vista del {dailyDate}. El resultado del día es ingresos menos
              gastos y no representa el saldo bancario.
            </p>

            {!dailyIncome &&
            !dailyExpense &&
            (!details || !activeDailyRows.length) ? (
              <Empty>
                <h3>No hay movimientos registrados para esta fecha.</h3>
                <p className="mt-2">
                  Cambia la fecha o registra un nuevo movimiento.
                </p>
              </Empty>
            ) : (
              <div className="summary-day-balance panel">
                <div>
                  <span>Ingresos del día</span>
                  <strong>{clp(dailyIncome)}</strong>
                </div>
                <div>
                  <span>Gastos del día</span>
                  <strong>{clp(dailyExpense)}</strong>
                </div>
                <div>
                  <span>Resultado</span>
                  <strong
                    className={
                      dailyIncome - dailyExpense < 0 ? "text-danger" : ""
                    }
                  >
                    {clp(dailyIncome - dailyExpense)}
                  </strong>
                </div>
              </div>
            )}
          </>
        )
      ) : summaries.loading ? (
        <Loading />
      ) : summaries.error ? null : (
        <>
          <Kpis
            summary={total}
            previous={
              !previous.error &&
              previous.data.some((summary) => summary.transactionCount > 0)
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
            <h2>
              {summaryView === "day"
                ? "Movimientos del día"
                : "Últimos movimientos"}
            </h2>
            <Link className="button-secondary" href="/finanzas/movimientos">
              Ver todos
            </Link>
          </div>

          <Notice error={movementError} />

          {movementLoading ? (
            <Loading />
          ) : movementError ? null : (
            <>
              {sumUpTotal > 0 && (
                <div className="summary-sumup-card">
                  <div className="summary-sumup-copy">
                    <span className="eyebrow">
                      {summaryView === "day"
                        ? "SUMUP · TOTAL DEL DÍA"
                        : "SUMUP · TOTAL DEL PERÍODO"}
                    </span>
                    <h3>Recaudación SumUp</h3>
                    <p>
                      Incluye Ofrendas, Cafetería y, cuando corresponda, el
                      histórico anterior al 09/09/2026 sin separación.
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
                  No hay otros movimientos en esta selección.
                </p>
              ) : (
                <Empty>No hay registros en esta selección.</Empty>
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

