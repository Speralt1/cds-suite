"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { TriangleAlert, CircleDashed, CircleCheck, Banknote, Clock, Flag } from "lucide-react";
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
  type DayStatus,
} from "@/lib/finance/insights";
import { WORSHIP_WEEKDAYS, MONTHS, MAX_PERIOD_RECORDS } from "@/lib/finance/constants";
import type { FinanceTransaction, PeriodSelection } from "@/lib/finance/types";
import type { CashArea } from "@/lib/offerings/cash";
import {
  settlementStatus,
  sumUpAccountForCategory,
  totalCommissionInRange,
  hasAnySettlement,
  useMonthSettlements,
  type SumUpDailySettlement,
} from "@/lib/finance/sumup-settlement";
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
import { TitheRegister } from "../tithes/tithe-register";
import { CashModal } from "../offerings/cash-modal";
import { Kpis } from "./kpis";

type SummaryView = "day" | "month" | "year";
type ActionModal = "cash" | "tithe" | "expense" | "other" | null;

const AREA_TO_KEY: Record<string, CashArea> = {
  Ofrendas: "offerings",
  Cafetería: "cafeteria",
};

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

// Panel del día (§D "Panel del día" / §C1.5): rows for Ofrendas, Cafetería,
// Diezmos, SumUp histórico sin separar and Otros ingresos, split into
// SumUp bruto / Efectivo / Otros / Total. Zero rows are hidden.
function dayBreakdown(transactions: FinanceTransaction[], date: string) {
  const period = date.slice(0, 7);
  const day = String(Number(date.slice(8, 10)));
  const dayTx = transactions.filter(
    (t) => t.status === "active" && t.period === period && t.day === day,
  );
  const definitions: [string, (t: FinanceTransaction) => boolean][] = [
    ["Ofrendas", (t) => t.type === "income" && t.category === "Ofrendas"],
    ["Cafetería", (t) => t.type === "income" && t.category === "Cafetería"],
    ["Diezmos", (t) => t.type === "income" && t.source === "tithe"],
    [
      "SumUp histórico sin separar",
      (t) => t.type === "income" && t.category === "SumUp histórico sin separar",
    ],
    [
      "Otros ingresos",
      (t) =>
        t.type === "income" &&
        t.source !== "tithe" &&
        !["Ofrendas", "Cafetería", "SumUp histórico sin separar"].includes(
          t.category,
        ),
    ],
  ];
  const rows = definitions
    .map(([label, match]) => {
      const items = dayTx.filter(match);
      const sumUp = items
        .filter((t) => t.paymentMethod === "card" && isSumUpTransaction(t.id, t.createdBy))
        .reduce((s, t) => s + t.amount, 0);
      const cash = items
        .filter((t) => t.paymentMethod === "cash")
        .reduce((s, t) => s + t.amount, 0);
      const other = items
        .filter(
          (t) =>
            t.paymentMethod !== "cash" &&
            !(t.paymentMethod === "card" && isSumUpTransaction(t.id, t.createdBy)),
        )
        .reduce((s, t) => s + t.amount, 0);
      return { label, sumUp, cash, other, total: sumUp + cash + other };
    })
    .filter((row) => row.total > 0);
  const expenses = dayTx
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const totalIncome = rows.reduce((s, r) => s + r.total, 0);
  return { rows, expenses, totalIncome };
}

function dateLabelShort(date: string) {
  const [, month, day] = date.split("-").map(Number);
  const weekday = new Date(`${date}T12:00:00.000Z`).toLocaleDateString("es-CL", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${weekday} ${day} ${MONTHS[month - 1].slice(0, 3).toLowerCase()}`;
}

const SETTLEMENT_STATUS_ICON: Record<string, typeof CircleCheck> = {
  "por-depositar": Clock,
  pagado: CircleCheck,
  diferencia: TriangleAlert,
  revision: Flag,
};

/** Comisión/depósito real de SumUp por área, para el día seleccionado (spec
 * §UI "Resumen del día"). Nunca muestra "$0" mientras la comisión es
 * simplemente desconocida — usa "pendiente". */
function DaySettlementRow({ area, settlement, todayStr }: { area: string; settlement?: SumUpDailySettlement; todayStr: string }) {
  // M3 (Atlas review): filas sumupPayouts en revisión priman sobre pagado/diferencia.
  const hasReviewRows = (settlement?.reviewCount ?? 0) > 0;
  const status = settlementStatus(settlement, todayStr, hasReviewRows);
  const StatusIcon = SETTLEMENT_STATUS_ICON[status.code] || CircleDashed;
  const partial = settlement?.linkStatus === "partial";

  return (
    <div className="day-panel-settlement-row">
      <span className="day-panel-settlement-area">{area}</span>
      {!settlement || settlement.linkStatus === "pending" ? (
        <span className="day-panel-settlement-fields">
          <span>Comisión: pendiente</span>
          <span>Por depositar</span>
        </span>
      ) : (
        <span className="day-panel-settlement-fields">
          <span>
            Comisión{" "}
            {partial ? `parcial (${settlement.txLinked} de ${settlement.txCount})` : ""}{" "}
            {clp(settlement.comisionSumUp)}
          </span>
          <span>{partial ? "Líquido parcial" : "Líquido"} {clp(settlement.liquidoEsperado)}</span>
          <span className={`settlement-status-${status.code}`}>
            <StatusIcon size={13} aria-hidden="true" />
            {settlement.depositado === null ? "Por depositar" : `Depositado ${clp(settlement.depositado)}`} · {status.label}
          </span>
        </span>
      )}
    </div>
  );
}

function DayPanel({
  date,
  status,
  transactions,
  settlements,
  todayStr,
  onRegisterCash,
  onViewDay,
}: {
  date: string;
  status?: DayStatus;
  transactions: FinanceTransaction[];
  settlements: Map<string, SumUpDailySettlement>;
  todayStr: string;
  onRegisterCash: (area: CashArea) => void;
  onViewDay: () => void;
}) {
  const { rows, expenses, totalIncome } = dayBreakdown(transactions, date);
  const sumUpAreas = rows
    .map((row) => sumUpAccountForCategory(row.label))
    .filter((account): account is "offerings" | "cafeteria" => account !== null);
  return (
    <div className="panel day-panel" aria-live="polite">
      <div className="day-panel-heading">
        <h3>
          {dateLabelShort(date)}
          {status?.isWorshipDay ? " · Culto" : ""}
        </h3>
        {status?.missingCashAreas.length ? (
          <p className="day-panel-status status-warning">
            <TriangleAlert size={15} aria-hidden="true" />
            {status.missingCashAreas.length === 2
              ? "Falta efectivo · 2 áreas"
              : `Falta efectivo · ${status.missingCashAreas[0]}`}
          </p>
        ) : status?.noRecords ? (
          <p className="day-panel-status status-muted">
            <CircleDashed size={15} aria-hidden="true" />
            Sin registros
          </p>
        ) : null}
      </div>

      {rows.length ? (
        <table className="day-panel-table">
          <thead>
            <tr>
              <th scope="col">Fuente</th>
              <th scope="col">SumUp bruto</th>
              <th scope="col">Efectivo</th>
              <th scope="col">Otros</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="tabular-nums">{row.sumUp ? clp(row.sumUp) : "—"}</td>
                <td className="tabular-nums">{row.cash ? clp(row.cash) : "—"}</td>
                <td className="tabular-nums">{row.other ? clp(row.other) : "—"}</td>
                <td className="tabular-nums">{clp(row.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Gastos</th>
              <td colSpan={3} />
              <td className="tabular-nums">{clp(expenses)}</td>
            </tr>
            <tr>
              <th scope="row">Total ingresos del día</th>
              <td colSpan={3} />
              <td className="tabular-nums font-semibold">{clp(totalIncome)}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className="field-help">Sin movimientos activos este día.</p>
      )}

      {sumUpAreas.length > 0 && (
        <div className="day-panel-settlement">
          {sumUpAreas.map((account) => (
            <DaySettlementRow
              key={account}
              area={account === "offerings" ? "Ofrendas" : "Cafetería"}
              settlement={settlements.get(`${account}_${date}`)}
              todayStr={todayStr}
            />
          ))}
        </div>
      )}

      <div className="day-panel-actions">
        {(status?.missingCashAreas || []).map((area) => (
          <button
            key={area}
            type="button"
            className="button-secondary"
            onClick={() => onRegisterCash(AREA_TO_KEY[area])}
          >
            <Banknote size={16} aria-hidden="true" />
            Registrar efectivo · {area}
          </button>
        ))}
        <button type="button" className="button-secondary" onClick={onViewDay}>
          Ver movimientos del día
        </button>
      </div>
    </div>
  );
}

function MonthCalendar({
  year,
  month,
  transactions,
  selected,
  onSelect,
}: {
  year: number;
  month: number;
  transactions: FinanceTransaction[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  const { weeks } = buildMonthCalendar(transactions, year, month, today());
  return (
    <table className="calendar-table" aria-label={`Calendario de ${MONTHS[month - 1]} ${year}`}>
      <thead>
        <tr>
          {["lun", "mar", "mié", "jue", "vie", "sáb", "dom"].map((label) => (
            <th scope="col" key={label}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, i) => (
          <tr key={i}>
            {week.map((day, j) =>
              day ? (
                <td key={day.date}>
                  <button
                    type="button"
                    className={`calendar-cell${day.isToday ? " is-today" : ""}${day.isFuture ? " is-future" : ""}${day.missingCashAreas.length ? " has-warning" : day.noRecords ? " has-empty" : ""}`}
                    aria-pressed={selected === day.date}
                    aria-current={day.isToday ? "date" : undefined}
                    onClick={() => onSelect(day.date)}
                    aria-label={`${dateLabelShort(day.date)}${day.isWorshipDay ? ", culto" : ""}${day.totalIncome ? `, ingresos ${clp(day.totalIncome)}` : ""}${day.missingCashAreas.length ? `, falta efectivo ${day.missingCashAreas.join(" y ")}` : ""}${day.noRecords ? ", sin registros" : ""}`}
                  >
                    <span className="calendar-cell-day">{Number(day.date.slice(8, 10))}</span>
                    {day.statusLabel && (
                      <span className="calendar-cell-status">
                        {day.missingCashAreas.length ? (
                          <TriangleAlert size={12} aria-hidden="true" />
                        ) : day.noRecords ? (
                          <CircleDashed size={12} aria-hidden="true" />
                        ) : null}
                        {day.missingCashAreas.length || day.noRecords ? "" : day.statusLabel}
                      </span>
                    )}
                  </button>
                </td>
              ) : (
                <td key={`blank-${i}-${j}`} aria-hidden="true" />
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
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

  // Slice 3a — comisión/depósito real de SumUp por día (spec §UI). Una
  // consulta por mes visible en cada vista, no por transacción.
  // sumupDailySettlement solo lo lee details() (firestore.rules) — para
  // leader nunca se consulta ni se muestra.
  const periodSettlements = useMonthSettlements(
    `${periodId(period.year, period.month)}-01`,
    `${periodId(period.year, period.month)}-31`,
    details,
  );
  const dailyPeriodSettlements = useMonthSettlements(
    `${periodId(dailyPeriod.year, dailyPeriod.month)}-01`,
    `${periodId(dailyPeriod.year, dailyPeriod.month)}-31`,
    details,
  );

  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [cashArea, setCashArea] = useState<CashArea>("offerings");
  const [cashDate, setCashDate] = useState(today());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
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

  const latestFiltered = movementItems
    .filter(
      (transaction) =>
        !isSumUpTransaction(transaction.id, transaction.createdBy),
    )
    .slice(0, 6);

  const isMonthCalendarView = summaryView === "month" && period.view === "month";

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
      ? reviewDays(latest.data, period.year, period.month, today(), WORSHIP_WEEKDAYS)
      : [];
  const calendar =
    isMonthCalendarView && detailReady
      ? buildMonthCalendar(latest.data, period.year, period.month, today(), WORSHIP_WEEKDAYS)
      : null;
  const effectiveSelectedDay =
    selectedDay ||
    (calendar ? defaultSelectedDay(calendar, review, today()) : undefined) ||
    today();
  const selectedDayStatus = calendar?.days.find((d) => d.date === effectiveSelectedDay);

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
    return status.missingCashAreas.length
      ? AREA_TO_KEY[status.missingCashAreas[0]]
      : "offerings";
  }

  return (
    <>
      <FinancePageHeader
        title="Resumen financiero"
        subtitle="Totales calculados a partir de los movimientos registrados."
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
      </div>

      {details && (
        <div className="summary-actions">
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

            {details ? (
              <DayPanel
                date={dailyDate}
                status={dayStatus(dailyDate, dailyTransactions.data, today(), WORSHIP_WEEKDAYS)}
                transactions={dailyTransactions.data}
                settlements={dailyPeriodSettlements.data}
                todayStr={today()}
                onRegisterCash={(area) => openCashModal(area, dailyDate)}
                onViewDay={() => {}}
              />
            ) : !dailyIncome && !dailyExpense ? (
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
          {!details && (
            <Kpis
              summary={total}
              previous={
                !previous.error &&
                previous.data.some((summary) => summary.transactionCount > 0)
                  ? combineSummaries(previous.data)
                  : undefined
              }
            />
          )}

          {details &&
            (latest.loading ? (
              <Loading />
            ) : latest.error ? (
              <Notice error={latest.error} />
            ) : (
              income && (
            <section className="panel income-method-panel">
              <h3>Ingresos por tipo de dinero</h3>
              <table className="income-method-table">
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    <th scope="col">Monto</th>
                    <th scope="col">%</th>
                    <th scope="col">Mov.</th>
                  </tr>
                </thead>
                <tbody>
                  {income.rows.map((row) => (
                    <Fragment key={row.key}>
                      <tr>
                        <th scope="row">{row.label}</th>
                        <td className="tabular-nums">{clp(row.amount)}</td>
                        <td className="tabular-nums">
                          {row.percent.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%
                        </td>
                        <td className="tabular-nums">{row.count}</td>
                      </tr>
                      {row.key === "sumup" && row.amount > 0 && (
                        <tr className="income-method-breakdown">
                          <td colSpan={4}>
                            {orderedSumUpEntries(income.sumUpByCategory)
                              .map(([category, amount]) => `${sumUpCategoryLabel(category)} ${clp(amount)}`)
                              .join(" · ")}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  <tr className="income-method-total">
                    <th scope="row">Total ingresos</th>
                    <td className="tabular-nums font-semibold">{clp(income.total)}</td>
                    <td className="tabular-nums font-semibold">100%</td>
                    <td className="tabular-nums font-semibold">{income.count}</td>
                  </tr>
                </tbody>
              </table>
              <p className="field-help">
                SumUp en bruto: la comisión aún no está disponible.
              </p>
              {income.total !== total.incomeTotal &&
                (latest.data.length >= MAX_PERIOD_RECORDS ? (
                  <p className="notice-warning">
                    <TriangleAlert size={15} aria-hidden="true" />
                    Resultado truncado: el período supera 10.000 movimientos.
                  </p>
                ) : (
                  <p className="notice success">
                    Los datos se están sincronizando; los totales pueden
                    cambiar en segundos.
                  </p>
                ))}
            </section>
              )
            ))}

          <p className="mb-6 text-xs text-muted">
            El resultado del período es ingresos menos gastos; no representa el
            saldo bancario.
          </p>

          {/* Días por revisar y el calendario dependen de los días de culto
              del mes, no de si ya hay movimientos registrados: deben poder
              mostrar "Sin registros" incluso en un mes vacío. Solo se
              calculan/muestran para roles con detalle (M2, Atlas): leader
              nunca ve calendario ni "Días por revisar". */}
          {details && isMonthCalendarView && (latest.loading ? (
            <Loading />
          ) : latest.error ? (
            <Notice error={latest.error} />
          ) : (
            <>
            <section className="panel review-days">
              <h3>Días por revisar ({review.length})</h3>
              {review.length ? (
                <ul>
                  {review.map((item) => (
                    <li key={`${item.date}-${item.kind}-${item.area || ""}`}>
                      {item.kind === "missing-cash" ? (
                        <TriangleAlert size={15} aria-hidden="true" />
                      ) : (
                        <CircleDashed size={15} aria-hidden="true" />
                      )}
                      <span>
                        {item.label} — {dateLabelShort(item.date)}
                      </span>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => setSelectedDay(item.date)}
                      >
                        Ver día
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="notice-ok">
                  <CircleCheck size={15} aria-hidden="true" />
                  Todo registrado en los días de culto de este mes.
                </p>
              )}
            </section>

              <section className="calendar-section">
                <div className="calendar-wrap">
                  <MonthCalendar
                    year={period.year}
                    month={period.month}
                    transactions={latest.data}
                    selected={effectiveSelectedDay}
                    onSelect={setSelectedDay}
                  />
                </div>
                <DayPanel
                  date={effectiveSelectedDay}
                  status={selectedDayStatus}
                  transactions={latest.data}
                  settlements={periodSettlements.data}
                  todayStr={today()}
                  onRegisterCash={(area) => openCashModal(area, effectiveSelectedDay)}
                  onViewDay={() => {
                    setDailyDate(effectiveSelectedDay);
                    setSummaryView("day");
                  }}
                />
              </section>
            </>
          ))}

          {summaryView === "year" && (
            <p className="field-help mb-6">
              Selecciona Mensual para ver el calendario.
            </p>
          )}

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
                  onClick={() => setActionModal("other")}
                >
                  Registrar primer movimiento
                </button>
              )}
            </Empty>
          ) : (
            <>
              {details && (
                <section className="panel source-block">
                  <div className="source-block-income">
                    <h3>Ingresos por fuente</h3>
                    <table className="income-method-table">
                      <tbody>
                        {Object.entries(total.incomeByCategory)
                          .sort(([, a], [, b]) => b - a)
                          .map(([category, amount]) => (
                            <tr key={category}>
                              <th scope="row">{category}</th>
                              <td className="tabular-nums">{clp(amount)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="source-block-expense">
                    <h3>Gastos y resultado</h3>
                    <p>
                      <span>Gastos</span>
                      <strong className="tabular-nums">{clp(total.expenseTotal)}</strong>
                    </p>
                    {income && income.sumUpAmount > 0 && (
                      hasAnySettlement(periodSettlements.data) ? (
                        <>
                          <p>
                            <span>Comisión SumUp</span>
                            <strong className="tabular-nums">
                              {clp(totalCommissionInRange(periodSettlements.data))}
                            </strong>
                          </p>
                          <p className="field-help">
                            Comisión real de SumUp para {periodLabel(period).toLowerCase()}
                            {" "}
                            (recomendado desde sumupDailySettlement). El resultado aún no la
                            descuenta como gasto{" "}
                            {" "}
                            hasta que se registre en el libro contable.
                          </p>
                        </>
                      ) : (
                        <>
                          <p>
                            <span>Comisión SumUp</span>
                            <strong className="tabular-nums sumup-fee-pending">
                              <Clock size={14} aria-hidden="true" />
                              Pendiente de datos de SumUp
                            </strong>
                          </p>
                          <p className="field-help">
                            La comisión se registrará como gasto cuando se
                            conecten los payouts de SumUp. El resultado aún no
                            la descuenta.
                          </p>
                        </>
                      )
                    )}
                    <p>
                      <span>Resultado</span>
                      <strong className={`tabular-nums ${total.result < 0 ? "text-danger" : ""}`}>
                        {clp(total.result)}
                      </strong>
                    </p>
                    <p className="field-help">No representa el saldo bancario.</p>
                    {total.expenseTotal === 0 && total.incomeTotal > 0 && (
                      <p className="notice-warning">
                        <TriangleAlert size={15} aria-hidden="true" />
                        No se registraron gastos en el período. ¿Faltan
                        egresos?
                      </p>
                    )}
                  </div>
                </section>
              )}

              <FinanceCharts summaries={summaries.data} period={period} />
            </>
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

      {actionModal === "other" && (
        <TransactionForm
          onClose={() => setActionModal(null)}
          onSaved={(message) => {
            setSuccess(message);
            setActionModal(null);
          }}
        />
      )}
      {actionModal === "expense" && (
        <TransactionForm
          initialType="expense"
          onClose={() => setActionModal(null)}
          onSaved={(message) => {
            setSuccess(message);
            setActionModal(null);
          }}
        />
      )}
      {actionModal === "tithe" && (
        <TitheRegister
          onClose={() => setActionModal(null)}
          onSaved={(message) => {
            setSuccess(message);
            setActionModal(null);
          }}
        />
      )}
      {actionModal === "cash" && (
        <CashModal
          key={`${cashArea}-${cashDate}`}
          area={cashArea}
          date={cashDate}
          allTransactionsForDay={
            cashDate.slice(0, 7) === dailyPeriodId
              ? dailyTransactions.data
              : latest.data
          }
          loading={dailyTransactions.loading || latest.loading}
          onAreaChange={setCashArea}
          onDateChange={setCashDate}
          onClose={() => setActionModal(null)}
          onSaved={(message) => {
            setSuccess(message);
            setActionModal(null);
          }}
        />
      )}
    </>
  );
}
