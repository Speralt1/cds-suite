"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { useAccess } from "@/lib/auth/access-provider";
import { can } from "@/lib/shared/access";
import {
  usePeriod,
  useSummaries,
  useTransactions,
} from "@/lib/finance/hooks";
import { combineSummaries } from "@/lib/finance/calculations";
import {
  clp,
  previousPeriod,
  periodId,
  periodLabel,
  today,
} from "@/lib/finance/formatters";
import {
  buildMonthCalendar,
  defaultSelectedDay,
  dayStatus,
  incomeByMethod,
  isSumUpTransaction,
  reviewDays,
  type IncomeByMethodResult,
} from "@/lib/finance/insights";
import { WORSHIP_WEEKDAYS, MONTHS, MAX_PERIOD_RECORDS } from "@/lib/finance/constants";
import type { FinanceTransaction, PeriodSelection } from "@/lib/finance/types";
import type { CashArea } from "@/lib/offerings/cash";
import {
  FinancePageHeader,
  PeriodPicker,
  Notice,
  Empty,
} from "../shared";
import { FinanceCharts } from "../charts/finance-charts";
import { TransactionForm } from "../forms/transaction-form";
import { TransactionList } from "../transactions/transaction-list";
import { TitheRegister } from "../tithes/tithe-register";
import { CashModal } from "../offerings/cash-modal";
import { BALANCE_TITLE_ID, BalanceBand, BalanceBandSkeleton } from "./balance-band";
import { FundsPosition } from "./funds-position";
import { BankBalanceCard } from "../bank/bank-balance-card";
import { CashCalendarSection, CashCalendarSkeleton } from "./cash-calendar";
import { AREA_TO_KEY, CashDayPanel, dateLabelShort } from "./cash-day-panel";
import "./tokens.css";
import "./summary.css";

type SummaryView = "day" | "month" | "year";
type ActionModal = "cash" | "tithe" | "expense" | "other" | null;

// SumUp breakdown order (§D minor de Atlas): Ofrendas, luego Cafetería,
// luego el histórico sin separar y por último cualquier otra categoría.
const SUMUP_CATEGORY_ORDER = ["Ofrendas", "Cafetería", "SumUp histórico sin separar"];
function orderedSumUpEntries(byCategory: Record<string, number>) {
  return Object.entries(byCategory).sort(([a], [b]) => {
    const ia = SUMUP_CATEGORY_ORDER.indexOf(a);
    const ib = SUMUP_CATEGORY_ORDER.indexOf(b);
    const ra = ia === -1 ? SUMUP_CATEGORY_ORDER.length : ia;
    const rb = ib === -1 ? SUMUP_CATEGORY_ORDER.length : ib;
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
}
function sumUpCategoryLabel(category: string) {
  return category === "SumUp histórico sin separar" ? "Histórico sin separar" : category;
}

function shortDayMonth(date: string) {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3).toLowerCase()}`;
}

// Loading placeholder without role="status": only the band skeleton
// announces loading, so screen readers hear a single status at a time.
function BusyPlaceholder() {
  return (
    <div className="panel py-10" aria-busy="true">
      <span className="animate-pulse">Consultando información…</span>
    </div>
  );
}

function percentLabel(percent: number) {
  return `${percent.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`;
}

// Secondary line under the Tipo label for narrow panels (<26rem), where the
// % and Mov. columns are hidden (display: none, so assistive tech hears the
// figures once in either layout).
function MethodSubline({ percent, count }: { percent: string; count: number }) {
  return (
    <span className="fin-amount-sub">
      {percent} · {count.toLocaleString("es-CL")} mov.
    </span>
  );
}

function isSumUpIncome(t: FinanceTransaction) {
  return t.type === "income" && t.paymentMethod === "card" && isSumUpTransaction(t.id, t.createdBy);
}

// "Ingresos por tipo de dinero" y "por fuente", lado a lado desde 52rem
// (28 §C1 "Tablas"). "Gastos y resultado" ya no existe: su nota y su
// advertencia viven en la BalanceBand.
function IncomeTables({
  income,
  incomeByCategory,
  incomeTotal,
  truncated,
}: {
  income: IncomeByMethodResult;
  incomeByCategory: Record<string, number>;
  incomeTotal: number;
  truncated: boolean;
}) {
  return (
    <div className="fin-income-tables">
      <div className="fin-income-tables-grid">
        <section className="panel" aria-labelledby="fin-income-method-title">
          <h3 id="fin-income-method-title">Ingresos por tipo de dinero</h3>
          <table className="fin-amount-table">
            <colgroup>
              <col />
              <col className="is-amount" />
              <col className="is-pct" />
              <col className="is-count" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Tipo</th>
                <th scope="col" className="is-num">Monto</th>
                <th scope="col" className="is-num is-pct">%</th>
                <th scope="col" className="is-num is-count">Mov.</th>
              </tr>
            </thead>
            <tbody>
              {income.rows.map((row) => (
                <Fragment key={row.key}>
                  <tr>
                    <th scope="row">
                      {row.label}
                      <MethodSubline percent={percentLabel(row.percent)} count={row.count} />
                    </th>
                    <td className="is-num">{clp(row.amount)}</td>
                    <td className="is-num is-pct">{percentLabel(row.percent)}</td>
                    <td className="is-num is-count">{row.count}</td>
                  </tr>
                  {row.key === "sumup" && row.amount > 0 && (
                    <tr className="is-breakdown">
                      <td colSpan={4}>
                        {orderedSumUpEntries(income.sumUpByCategory)
                          .map(([category, amount]) => `${sumUpCategoryLabel(category)} ${clp(amount)}`)
                          .join(" · ")}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr className="is-total">
                <th scope="row">
                  Total ingresos
                  <MethodSubline percent="100%" count={income.count} />
                </th>
                <td className="is-num">{clp(income.total)}</td>
                <td className="is-num is-pct">100%</td>
                <td className="is-num is-count">{income.count}</td>
              </tr>
            </tbody>
          </table>
          <p className="fin-table-help">SumUp en bruto: la comisión aún no está disponible.</p>
          {income.total !== incomeTotal &&
            (truncated ? (
              <p className="fin-table-warning">
                <TriangleAlert size={16} aria-hidden="true" />
                Resultado truncado: el período supera 10.000 movimientos.
              </p>
            ) : (
              <p className="notice success">
                Los datos se están sincronizando; los totales pueden cambiar en segundos.
              </p>
            ))}
        </section>
        <section className="panel" aria-labelledby="fin-income-source-title">
          <h3 id="fin-income-source-title">Ingresos por fuente</h3>
          <table className="fin-amount-table">
            <colgroup>
              <col />
              <col className="is-amount" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Fuente</th>
                <th scope="col" className="is-num">Monto</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(incomeByCategory)
                .sort(([, a], [, b]) => b - a)
                .map(([category, amount]) => (
                  <tr key={category}>
                    <th scope="row">{category}</th>
                    <td className="is-num">{clp(amount)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

export interface SummaryDashboardProps {
  /**
   * PR D: tile "Saldo bancario estimado" para "Posición de fondos". Sin él la
   * sección no se renderiza (decisión 10 del Tech Lead). Solo se muestra a
   * quien tiene finance.details.read.
   */
  fundsBankTile?: ReactNode;
  /** PR C/D: tiles adicionales ("Efectivo en caja", "SumUp pendiente de abono"). */
  fundsTiles?: ReactNode[];
}

// Ruta /finanzas (sin props: la ruta la exporta tal cual). PR D (doc 30) monta
// el tile "Saldo bancario estimado" en Posición de fondos. FundsPosition ya lo
// limita a finance.details.read; la tarjeta consulta los abonos SumUp con la
// callable de solo lectura y, si no está disponible, se muestra "incompleto".
export function SummaryPage() {
  return <SummaryDashboard fundsBankTile={<BankBalanceCard variant="funds" connectSumupPayouts />} />;
}

export function SummaryDashboard({ fundsBankTile, fundsTiles }: SummaryDashboardProps = {}) {
  const [period, setPeriod] = usePeriod();
  const [summaryView, setSummaryView] =
    useState<SummaryView>(period.view);
  const [dailyDate, setDailyDate] = useState(today());
  const access = useAccess();
  const details = can(access, "finance.details.read");
  // Writing (cash, tithes, expenses, other movements) needs records.manage,
  // as the Rules do. Legacy admin/pastor/finance have both, so for them this
  // is the same as `details`; a v1 read-only profile no longer gets write
  // actions that would end in permission-denied.
  const manage = can(access, "finance.records.manage");

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

  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [cashArea, setCashArea] = useState<CashArea>("offerings");
  const [cashDate, setCashDate] = useState(today());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const cashTransactions = useTransactions(
    {
      year: Number(cashDate.slice(0, 4)),
      month: Number(cashDate.slice(5, 7)),
      view: "month",
    },
    details && actionModal === "cash",
  );

  const todayStr = today();
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

  const latestFiltered = movementItems
    .filter(
      (transaction) =>
        !isSumUpTransaction(transaction.id, transaction.createdBy),
    )
    .slice(0, 6);

  const isMonthCalendarView = summaryView === "month" && period.view === "month";
  const viewedPeriodId = periodId(period.year, period.month);

  // M2 (Atlas): income/review/calendar must only be computed once `latest`
  // has actually loaded without error for this period — otherwise a leader
  // (details=false, hook disabled) or a still-loading/errored fetch could
  // render stale or empty-looking figures as if they were final. Leaders
  // never get here since `details` is false, so they keep seeing exactly
  // what they saw before (no calendar, no "Días por revisar").
  const detailReady = details && !latest.loading && !latest.error;

  const income = detailReady && summaryView !== "day" ? incomeByMethod(latest.data) : null;
  const review =
    isMonthCalendarView && detailReady
      ? reviewDays(latest.data, period.year, period.month, todayStr, WORSHIP_WEEKDAYS)
      : [];
  const calendar =
    isMonthCalendarView && detailReady
      ? buildMonthCalendar(latest.data, period.year, period.month, todayStr, WORSHIP_WEEKDAYS)
      : null;
  // A day picked in another month never leaks into this month's panel.
  const selectedInView =
    selectedDay && selectedDay.startsWith(`${viewedPeriodId}-`) ? selectedDay : null;
  const effectiveSelectedDay =
    selectedInView ||
    (calendar ? defaultSelectedDay(calendar, review, todayStr) : undefined) ||
    `${viewedPeriodId}-01`;

  const periodName = periodLabel(period).toLowerCase();
  const before = previousPeriod(period);
  const previousName =
    period.view === "year" ? String(before.year) : MONTHS[before.month - 1].toLowerCase();
  const previousSummary =
    !previous.error && previous.data.some((summary) => summary.transactionCount > 0)
      ? combineSummaries(previous.data)
      : undefined;
  const isCurrentPeriod =
    summaryView === "day"
      ? dailyDate === todayStr
      : period.view === "year"
        ? String(period.year) === todayStr.slice(0, 4)
        : viewedPeriodId === todayStr.slice(0, 7);

  function selectView(view: SummaryView) {
    setSummaryView(view);
    if (view === "month" || view === "year") {
      setPeriod({ ...period, view });
    }
  }

  function openCashModal(area: CashArea, date: string) {
    setCashArea(area);
    setCashDate(date);
    setActionModal("cash");
  }

  function defaultCashArea(): CashArea {
    const status = dayStatus(today(), dailyTransactions.data, today(), WORSHIP_WEEKDAYS);
    return status.pendingCashAreas.length
      ? AREA_TO_KEY[status.pendingCashAreas[0]]
      : "offerings";
  }

  const fundsPosition = details && fundsBankTile ? (
    <FundsPosition
      bankTile={fundsBankTile}
      tiles={fundsTiles}
      isCurrentPeriod={isCurrentPeriod}
      todayLabel={shortDayMonth(todayStr)}
    />
  ) : null;

  // Diario: the day panel and the count only render once the day's month has
  // loaded without error (same ready rule as the month view, M2).
  const dailyReady = details && !dailyTransactions.loading && !dailyTransactions.error;
  const dailyBandReady =
    !dailySummaries.loading && !(details && dailyTransactions.loading) && !dailySummaries.error;

  // "Ver movimientos del día" switches to Diario and unmounts the calendar: the
  // focus moves to the Diario band title once it is rendered (not the skeleton).
  // If the Diario band fails to load, the focus falls back to the pressed
  // "Diario" toggle (the error Notice itself is not focusable).
  const focusBandTitle = useRef(false);
  const viewToggleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusBandTitle.current || summaryView !== "day") return;
    if (dailySummaries.loading || (details && dailyTransactions.loading)) return;
    focusBandTitle.current = false;
    const title = dailyBandReady ? document.getElementById(BALANCE_TITLE_ID) : null;
    (title || viewToggleRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]'))?.focus();
  }, [summaryView, dailyBandReady, dailySummaries.loading, dailyTransactions.loading, details]);

  function viewDay(date: string) {
    focusBandTitle.current = true;
    setDailyDate(date);
    setSummaryView("day");
  }

  const movementCount =
    summaryView === "day"
      ? !dailyReady
        ? null
        : activeDailyRows.length
      : summaries.loading || summaries.error
        ? null
        : total.transactionCount;

  return (
    <div className="fin-summary">
      <FinancePageHeader
        title="Resumen financiero"
        subtitle="Totales calculados a partir de los movimientos registrados."
      />

      <div className="summary-period-controls">
        <div className="summary-period-left">
          <div
            ref={viewToggleRef}
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
      </div>

      {details && (
        <div className="summary-actions">
          {manage && (
            <>
              <button
                type="button"
                className="button-primary summary-action-primary"
                onClick={() => openCashModal(defaultCashArea(), today())}
              >
                + Registrar efectivo
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setActionModal("tithe")}
              >
                + Diezmo
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setActionModal("expense")}
              >
                + Gasto
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setActionModal("other")}
              >
                Otro movimiento
              </button>
            </>
          )}
          <Link
            className="button-ghost"
            href={`/finanzas/reportes?periodo=${periodId(period.year, period.month)}`}
          >
            Reporte del mes →
          </Link>
        </div>
      )}

      <Notice
        error={
          summaryView === "day"
            ? dailySummaries.error ||
              (details ? dailyTransactions.error : "")
            : summaries.error || previous.error
        }
        success={success}
      />

      {/* Banda (slot fijo), luego la posición de fondos en una posición estable
          fuera de las ramas de carga/error: el tile del PR D no se remonta al
          cambiar de período ni se oculta si fallan los resúmenes. */}
      {summaryView === "day" ? (
        dailySummaries.loading ||
        (details && dailyTransactions.loading) ? (
          <BalanceBandSkeleton title={`Resultado del ${dateLabelShort(dailyDate)}`} />
        ) : dailySummaries.error ? null : (
          <BalanceBand
            title={`Resultado del ${dateLabelShort(dailyDate)}`}
            resultLabel="Resultado del día"
            income={dailyIncome}
            expense={dailyExpense}
            result={dailyIncome - dailyExpense}
            tithe={details ? dailyTithe : undefined}
            sumUpFeePending={details && activeDailyRows.some(isSumUpIncome)}
            // A single day without expenses is normal (e.g. every Sunday).
            showMissingExpenses={false}
            emptyNote={
              !dailyIncome && !dailyExpense
                ? "No hay movimientos registrados para esta fecha."
                : undefined
            }
          />
        )
      ) : summaries.loading ? (
        <BalanceBandSkeleton title={`Resultado de ${periodName}`} />
      ) : summaries.error ? null : (
        <BalanceBand
          title={`Resultado de ${periodName}`}
          income={total.incomeTotal}
          expense={total.expenseTotal}
          result={total.result}
          tithe={total.titheTotal}
          previous={
            previousSummary
              ? {
                  income: previousSummary.incomeTotal,
                  result: previousSummary.result,
                  label: previousName,
                }
              : undefined
          }
          sumUpFeePending={Boolean(income && income.sumUpAmount > 0)}
          showMissingExpenses={details}
          emptyNote={
            !total.transactionCount ? `Aún no hay movimientos en ${periodName}.` : undefined
          }
        />
      )}

      {fundsPosition}

      {summaryView === "day" ? (
        dailyReady &&
        !dailySummaries.loading && (
          <CashDayPanel
            date={dailyDate}
            status={dayStatus(dailyDate, dailyTransactions.data, todayStr, WORSHIP_WEEKDAYS)}
            transactions={dailyTransactions.data}
            onRegisterCash={manage ? (area) => openCashModal(area, dailyDate) : undefined}
          />
        )
      ) : summaries.loading || summaries.error ? null : (
        <>
          {/* El calendario depende de los días de culto del mes, no de si ya
              hay movimientos registrados: debe poder mostrar "Sin registros"
              incluso en un mes vacío. Solo se calcula/muestra para roles con
              detalle (M2, Atlas): leader nunca ve calendario ni "Días por
              revisar". */}
          {details &&
            (latest.loading ? (
              isMonthCalendarView ? (
                <CashCalendarSkeleton year={period.year} month={period.month} />
              ) : (
                <BusyPlaceholder />
              )
            ) : latest.error ? (
              <Notice error={latest.error} />
            ) : (
              <>
                {calendar && (
                  <CashCalendarSection
                    year={period.year}
                    month={period.month}
                    calendar={calendar}
                    review={review}
                    transactions={latest.data}
                    selected={effectiveSelectedDay}
                    onSelect={setSelectedDay}
                    onRegisterCash={manage ? openCashModal : undefined}
                    onViewDay={viewDay}
                  />
                )}
                {income && (income.count > 0 || total.transactionCount > 0) && (
                  <IncomeTables
                    income={income}
                    incomeByCategory={total.incomeByCategory}
                    incomeTotal={total.incomeTotal}
                    truncated={latest.data.length >= MAX_PERIOD_RECORDS}
                  />
                )}
              </>
            ))}

          {summaryView === "year" && details && (
            <p className="field-help mb-6">
              Selecciona Mensual para ver el calendario.
            </p>
          )}

          {!total.transactionCount ? (
            <Empty>
              <p>
                Los indicadores y gráficos se completarán al registrar
                movimientos.
              </p>
              {manage && (
                <button
                  className="button-primary mt-5"
                  onClick={() => setActionModal("other")}
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
        <section className="mt-8" id="fin-movements" aria-labelledby="fin-movements-title">
          <div className="section-heading">
            <h2 id="fin-movements-title">
              {summaryView === "day" ? "Movimientos del día" : "Últimos movimientos"}
              {movementCount !== null && " "}
              {movementCount !== null && (
                <span className="fin-movements-count">
                  {"· "}
                  {summaryView === "day"
                    ? movementCount.toLocaleString("es-CL")
                    : `${movementCount.toLocaleString("es-CL")} en el período`}
                </span>
              )}
            </h2>
            <Link className="button-secondary" href="/finanzas/movimientos">
              Ver todos
            </Link>
          </div>

          <Notice error={movementError} />

          {movementLoading ? (
            <BusyPlaceholder />
          ) : movementError ? null : latestFiltered.length ? (
            <TransactionList
              items={latestFiltered}
              onSaved={setSuccess}
            />
          ) : (
            <Empty>No hay registros en esta selección.</Empty>
          )}
        </section>
      )}

      {manage && actionModal === "other" && (
        <TransactionForm
          onClose={() => setActionModal(null)}
          onSaved={(message) => {
            setSuccess(message);
            setActionModal(null);
          }}
        />
      )}
      {manage && actionModal === "expense" && (
        <TransactionForm
          initialType="expense"
          onClose={() => setActionModal(null)}
          onSaved={(message) => {
            setSuccess(message);
            setActionModal(null);
          }}
        />
      )}
      {manage && actionModal === "tithe" && (
        <TitheRegister
          onClose={() => setActionModal(null)}
          onSaved={(message) => {
            setSuccess(message);
            setActionModal(null);
          }}
        />
      )}
      {manage && actionModal === "cash" && (
        <CashModal
          area={cashArea}
          date={cashDate}
          allTransactionsForDay={cashTransactions.data}
          // Retained or cached data is not enough to write over: wait for the
          // live, server-confirmed snapshot of cashDate's month.
          loading={!cashTransactions.synced}
          loadError={cashTransactions.error}
          onAreaChange={setCashArea}
          onDateChange={setCashDate}
          onClose={() => setActionModal(null)}
          onSaved={(message) => {
            setSuccess(message);
            setActionModal(null);
          }}
        />
      )}
    </div>
  );
}
