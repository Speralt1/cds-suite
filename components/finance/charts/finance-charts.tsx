"use client";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { clp } from "@/lib/finance/formatters";
import { combineSummaries, evolution } from "@/lib/finance/calculations";
import type { MonthlySummary, PeriodSelection } from "@/lib/finance/types";
const colors = [
  "#285b45",
  "#7b9866",
  "#b2bd97",
  "#60746b",
  "#ad9373",
  "#d2d8cb",
];
const tooltip = (value: unknown) => clp(Number(value));
const axis = (v: number) =>
  Math.abs(v) >= 1000000
    ? `${v / 1000000}M`
    : Math.abs(v) >= 1000
      ? `${v / 1000}k`
      : String(v);
export function EvolutionChart({
  data,
  annual = false,
  tithe = false,
}: {
  data: { label: string; income: number; expense: number; result?: number }[];
  annual?: boolean;
  tithe?: boolean;
}) {
  return (
    <div
      className="chart-box"
      role="img"
      aria-label={
        tithe
          ? "Registros de diezmos de los últimos doce meses"
          : annual
            ? "Evolución de ingresos, gastos y resultado por mes"
            : "Evolución diaria de ingresos y gastos"
      }
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart
          data={data}
          margin={{ top: 12, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid vertical={false} stroke="#e2e7df" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={15} />
          <YAxis tickFormatter={axis} width={48} tick={{ fontSize: 10 }} />
          <Tooltip formatter={tooltip} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            isAnimationActive={false}
            name={tithe ? "Diezmos" : "Ingresos"}
            dataKey="income"
            stroke="#285b45"
            strokeWidth={2}
            dot={false}
          />
          {!tithe && (
            <Line
              isAnimationActive={false}
              name="Gastos"
              dataKey="expense"
              stroke="#ad9373"
              strokeWidth={2}
              dot={false}
            />
          )}
          {annual && (
            <Line
              isAnimationActive={false}
              name="Resultado"
              dataKey="result"
              stroke="#60746b"
              strokeDasharray="4 4"
              dot={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
function Composition({
  title,
  values,
}: {
  title: string;
  values: Record<string, number>;
}) {
  const entries = Object.entries(values)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));
  return (
    <section className="panel min-w-0">
      <h3>{title}</h3>
      {!entries.length ? (
        <p className="empty-chart">Sin registros en este período.</p>
      ) : (
        <>
          <div className="chart-box short" role="img" aria-label={title}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={entries}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="48%"
                  outerRadius="80%"
                  paddingAngle={2}
                >
                  {entries.map((entry, i) => (
                    <Cell key={entry.name} fill={colors[i % colors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={tooltip} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="chart-legend">
            {entries.map((e, i) => (
              <li key={e.name}>
                <span
                  className="legend-dot"
                  style={{ background: colors[i % colors.length] }}
                />
                <span>{e.name}</span>
                <strong>{clp(e.value)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
export function FinanceCharts({
  summaries,
  period,
}: {
  summaries: MonthlySummary[];
  period: PeriodSelection;
}) {
  const sum = combineSummaries(summaries);
  return (
    <div className="charts-grid">
      <section className="panel min-w-0">
        <h3>Ingresos vs gastos</h3>
        <div
          className="chart-box"
          role="img"
          aria-label={`Ingresos ${clp(sum.incomeTotal)}; gastos ${clp(sum.expenseTotal)}`}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart
              data={[
                {
                  label: "Período",
                  income: sum.incomeTotal,
                  expense: sum.expenseTotal,
                },
              ]}
            >
              <CartesianGrid vertical={false} stroke="#e2e7df" />
              <XAxis dataKey="label" />
              <YAxis width={48} tickFormatter={axis} tick={{ fontSize: 10 }} />
              <Tooltip formatter={tooltip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                isAnimationActive={false}
                name="Ingresos"
                dataKey="income"
                fill="#285b45"
                radius={[5, 5, 0, 0]}
                maxBarSize={64}
              />
              <Bar
                isAnimationActive={false}
                name="Gastos"
                dataKey="expense"
                fill="#ad9373"
                radius={[5, 5, 0, 0]}
                maxBarSize={64}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="panel min-w-0">
        <h3>
          {period.view === "year"
            ? "Evolución de los 12 meses"
            : "Evolución durante el mes"}
        </h3>
        <EvolutionChart
          data={evolution(summaries, period)}
          annual={period.view === "year"}
        />
      </section>
      <Composition
        title="Composición de ingresos"
        values={sum.incomeByCategory}
      />
      <Composition
        title="Gastos por categoría"
        values={sum.expenseByCategory}
      />
    </div>
  );
}
