import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { clp } from "./formatters";
import {
  reportCategoryRows,
  type FinanceReport,
  type ReportRow,
} from "./reports";
const green: [number, number, number] = [40, 91, 69],
  ink: [number, number, number] = [35, 60, 51],
  muted: [number, number, number] = [104, 119, 110],
  sand: [number, number, number] = [173, 147, 115];
/** Native PDF text/tables and vector charts; no screenshots or private data sources. */
export function createFinancePdf(report: FinanceReport, logoData?: string) {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pdf.setProperties({
    title: `Reporte Financiero · ${report.label}`,
    subject: "Casa de Salvación · CDS Administración",
    author: report.generatedBy,
    creator: "CDS Suite V0.2",
  });
  const W = 174;
  function text(
    value: string,
    x: number,
    y: number,
    size = 10,
    color = ink,
    bold = false,
  ) {
    pdf.setTextColor(...color);
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.text(value, x, y);
  }
  function heading(title: string, subtitle: string) {
    text(title, 18, 48, 20, ink, true);
    text(subtitle, 18, 56, 9, muted);
  }
  function newPage(title: string, subtitle = report.label) {
    pdf.addPage();
    heading(title, subtitle);
  }
  function table(
    head: string[],
    body: (string | number)[][],
    y: number,
    width: number | undefined = undefined,
    x = 18,
  ) {
    autoTable(pdf, {
      startY: y,
      head: [head],
      body,
      margin: { left: x, right: 18, top: 43, bottom: 22 },
      tableWidth: width,
      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: 3,
        textColor: ink,
        lineColor: [226, 231, 223],
        overflow: "linebreak",
      },
      headStyles: { fillColor: green, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 249, 245] },
      rowPageBreak: "avoid",
      showHead: "everyPage",
    });
  }
  function horizontalBars(
    title: string,
    values: [string, number][],
    y: number,
  ) {
    text(title, 18, y, 12, ink, true);
    const max = Math.max(...values.map(([, v]) => v), 1);
    values.forEach(([label, value], i) => {
      const cy = y + 11 + i * 14;
      text(label, 18, cy, 9);
      pdf.setFillColor(...(i === 1 ? sand : green));
      pdf.roundedRect(
        61,
        cy - 4,
        Math.max(0.4, (value / max) * 84),
        5,
        1,
        1,
        "F",
      );
      pdf.setFontSize(9);
      pdf.setTextColor(...ink);
      pdf.text(clp(value), 192, cy, { align: "right" });
    });
  }
  function categoryBars(
    title: string,
    values: Record<string, number>,
    x: number,
    y: number,
  ) {
    text(title, x, y, 12, ink, true);
    const entries = Object.entries(values).filter(([, v]) => v > 0);
    const max = Math.max(...entries.map(([, v]) => v), 1);
    if (!entries.length)
      text("Sin registros en el período.", x, y + 11, 9, muted);
    entries.forEach(([label, value], i) => {
      const yy = y + 11 + i * 13;
      const short = pdf.splitTextToSize(label, 75) as string[];
      text(short[0], x, yy, 8);
      pdf.setFillColor(...green);
      pdf.rect(x, yy + 2, Math.max(0.3, (value / max) * 75), 2, "F");
      text(clp(value), x, yy + 8, 7, muted);
    });
  }
  function lineChart(y: number) {
    text(
      report.period.view === "year"
        ? "Evolución de los 12 meses"
        : "Evolución del mes",
      18,
      y,
      12,
      ink,
      true,
    );
    const series = report.evolution;
    const annual = report.period.view === "year";
    const all = series.flatMap((s) =>
      annual ? [s.income, s.expense, s.result] : [s.income, s.expense],
    );
    const min = Math.min(...all, 0),
      max = Math.max(...all, 1);
    const left = 37,
      top = y + 12,
      h = 40,
      w = 150;
    const py = (n: number) => top + h - ((n - min) / (max - min)) * h;
    pdf.setDrawColor(226, 231, 223);
    pdf.setLineWidth(0.2);
    for (let i = 0; i < 4; i++) {
      const yy = top + (i * h) / 3;
      pdf.line(left, yy, left + w, yy);
      text(clp(Math.round(max - ((max - min) * i) / 3)), 18, yy + 1, 6, muted);
    }
    const styles: [
      keyof (typeof series)[number],
      [number, number, number],
      string,
    ][] = [
      ["income", green, "Ingresos"],
      ["expense", sand, "Gastos"],
      ...(annual
        ? [
            ["result", muted, "Resultado"] as [
              keyof (typeof series)[number],
              [number, number, number],
              string,
            ],
          ]
        : []),
    ];
    styles.forEach(([key, color, label], k) => {
      pdf.setDrawColor(...color);
      pdf.setLineWidth(0.6);
      for (let i = 1; i < series.length; i++)
        pdf.line(
          left + ((i - 1) / (series.length - 1)) * w,
          py(Number(series[i - 1][key])),
          left + (i / (series.length - 1)) * w,
          py(Number(series[i][key])),
        );
      pdf.line(18 + k * 52, top + h + 16, 24 + k * 52, top + h + 16);
      text(label, 27 + k * 52, top + h + 17, 8, muted);
    });
    series.forEach((d, i) => {
      if (annual || i % 5 === 0 || i === series.length - 1)
        text(
          d.label,
          left + (i / Math.max(1, series.length - 1)) * w - 1,
          top + h + 6,
          7,
          muted,
        );
    });
  }
  heading("Reporte Financiero", report.label);
  text(
    `Generado el ${new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(report.generatedAt)}`,
    18,
    67,
    8,
    muted,
  );
  const by = pdf.splitTextToSize(
    `Generado por: ${report.generatedBy}`,
    W,
  ) as string[];
  pdf.setFontSize(8);
  pdf.text(by, 18, 73);
  const kpis = [
    ["Ingresos", clp(report.summary.incomeTotal)],
    ["Gastos", clp(report.summary.expenseTotal)],
    ["Resultado del período", clp(report.summary.result)],
    ["Diezmos", clp(report.summary.titheTotal)],
  ];
  kpis.forEach(([label, value], i) => {
    const x = 18 + (i % 2) * 89,
      y = 86 + Math.floor(i / 2) * 28;
    pdf.setFillColor(240, 245, 237);
    pdf.roundedRect(x, y, 85, 24, 2, 2, "F");
    text(label, x + 5, y + 8, 8, muted);
    text(value, x + 5, y + 18, 15, green, true);
  });
  text(
    `${report.summary.transactionCount} movimientos activos · ${report.voided.length} anulados`,
    18,
    149,
    9,
    muted,
  );
  text(
    "Resultado = ingresos menos gastos. No representa el saldo bancario.",
    18,
    156,
    8,
    muted,
  );
  horizontalBars(
    "Ingresos vs gastos",
    [
      ["Ingresos", report.summary.incomeTotal],
      ["Gastos", report.summary.expenseTotal],
    ],
    169,
  );
  lineChart(204);
  // Separate categories page keeps every chart readable and avoids tiny screenshots.
  newPage("Composición del período");
  categoryBars(
    "Composición de ingresos",
    report.summary.incomeByCategory,
    18,
    70,
  );
  categoryBars(
    "Distribución de gastos",
    report.summary.expenseByCategory,
    108,
    70,
  );
  newPage("Desglose por categoría");
  table(
    ["Ingresos", "Monto CLP"],
    reportCategoryRows(report.summary.incomeByCategory).length
      ? reportCategoryRows(report.summary.incomeByCategory)
      : [["Sin registros", clp(0)]],
    67,
  );
  const end = (pdf as jsPDF & { lastAutoTable: { finalY: number } })
    .lastAutoTable.finalY;
  table(
    ["Gastos", "Monto CLP"],
    reportCategoryRows(report.summary.expenseByCategory).length
      ? reportCategoryRows(report.summary.expenseByCategory)
      : [["Sin registros", clp(0)]],
    end + 14,
  );
  if (report.period.view === "year") {
    newPage(
      "Comparación mensual",
      `Resumen de cada mes · ${report.period.year}`,
    );
    table(
      ["Mes", "Ingresos", "Gastos", "Resultado", "Diezmos", "Mov."],
      report.monthly.map((m) => [
        m.label,
        clp(m.income),
        clp(m.expense),
        clp(m.result),
        clp(m.tithe),
        m.count,
      ]),
      68,
    );
  }
  const rows = (items: ReportRow[]) =>
    items.map((t) => [
      t.date,
      t.type,
      t.category,
      t.description,
      t.method,
      clp(t.amount),
    ]);
  newPage(
    "Detalle de movimientos",
    "Movimientos activos · Sin atribuciones personales de diezmos",
  );
  if (report.rows.length)
    table(
      ["Fecha", "Tipo", "Categoría", "Descripción", "Método", "Monto CLP"],
      rows(report.rows),
      68,
    );
  else
    text("Aún no hay movimientos activos en este período.", 18, 75, 11, muted);
  if (report.voided.length) {
    newPage(
      "Movimientos anulados",
      "Conservados para auditoría · No incluidos en los totales",
    );
    table(
      ["Fecha", "Tipo", "Categoría", "Descripción", "Método", "Monto CLP"],
      rows(report.voided),
      68,
    );
  }
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFillColor(...green);
    pdf.roundedRect(18, 16, 17, 14, 2, 2, "F");
    if (logoData) {
      try {
        pdf.addImage(logoData, "PNG", 18, 15, 17, 17, undefined, "FAST");
      } catch {
        text("CDS", 20, 25, 11, [255, 255, 255], true);
      }
    } else text("CDS", 20, 25, 11, [255, 255, 255], true);
    text("Casa de Salvación", 40, 22, 12, ink, true);
    text("CDS Administración", 40, 28, 8, muted);
    pdf.setDrawColor(226, 231, 223);
    pdf.line(18, 35, 192, 35);
    pdf.line(18, 280, 192, 280);
    text("Casa de Salvación · Finanzas", 18, 286, 8, muted);
    pdf.setTextColor(...muted);
    pdf.setFontSize(8);
    pdf.text(`Página ${i} de ${pages}`, 192, 286, { align: "right" });
  }
  return pdf;
}
export async function loadReportLogo() {
  try {
    const response = await fetch("/logo-cds.png");
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("image/png")
    )
      return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}
