import { clp } from "@/lib/finance/formatters";
import { variation } from "@/lib/finance/calculations";
import type { MonthlySummary } from "@/lib/finance/types";
export function Kpis({
  summary,
  previous,
}: {
  summary: MonthlySummary;
  previous?: MonthlySummary;
}) {
  return (
    <div className="kpi-grid">
      {(
        [
          ["incomeTotal", "Ingresos"],
          ["expenseTotal", "Gastos"],
          ["result", "Resultado del período"],
          ["titheTotal", "Diezmos"],
          ["transactionCount", "Movimientos"],
        ] as const
      ).map(([key, label]) => {
        const change = previous ? variation(summary[key], previous[key]) : null;
        return (
          <article className="kpi" key={key}>
            <h3>{label}</h3>
            <p
              className={
                key === "result" && summary.result < 0 ? "text-danger" : ""
              }
            >
              {key === "transactionCount"
                ? summary[key].toLocaleString("es-CL")
                : clp(summary[key])}
            </p>
            {change !== null && (
              <span>
                {change >= 0 ? "↑" : "↓"}{" "}
                {Math.abs(change).toLocaleString("es-CL", {
                  maximumFractionDigits: 1,
                })}
                % vs. período anterior
              </span>
            )}
          </article>
        );
      })}
    </div>
  );
}
