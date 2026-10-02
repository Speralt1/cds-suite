// PDF del reporte de calendario, generado LOCALMENTE (sin red). jspdf y
// jspdf-autotable se importan solo de forma dinámica dentro de buildCalendarPdf,
// que se llama desde el onClick de "Descargar PDF". No se reutiliza
// lib/finance/report-pdf.ts porque arrastra Firestore.
// A4 horizontal, Helvetica, rótulo "Vista previa · datos de demostración" en
// cada página y NUNCA notas internas ni motivos (las filas no los traen).

import { AREA_PALETTE } from "./areas";
import { REPORT_COLUMNS, type CalendarReportRow } from "./report";

export interface CalendarReportMeta {
  /** "Octubre 2026" o "01-10-2026 – 31-10-2026". */
  periodLabel: string;
  /** "Área: Jóvenes · Estados: Programada, Realizada · Visibilidad: Todas". */
  filtersLabel: string;
  /** Nombre del perfil demo que genera el reporte. */
  generatedBy: string;
  /** "04-10-2026" */
  generatedOn: string;
  /** "42 actividades · 30 realizadas · 9 programadas · 3 canceladas" (opcional). */
  summaryLabel?: string;
  /** "Pastoral 12 · Jóvenes 8 · …" (opcional). */
  byAreaLabel?: string;
}

export const PDF_PREVIEW_LABEL = "Vista previa · datos de demostración";

/** Nombre de archivo sugerido. */
export function calendarPdfFileName(month: string): string {
  return `reporte-calendario-DEMO-${month}.pdf`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const RESPONSIBLE_COL = REPORT_COLUMNS.findIndex((c) => c.key === "responsible");

export async function buildCalendarPdf(
  rows: readonly CalendarReportRow[],
  meta: CalendarReportMeta,
): Promise<{ save(name: string): void; pageCount: number; output(): ArrayBuffer }> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const M = 15;

  const band = () => {
    doc.setFillColor(238, 240, 244);
    doc.rect(0, 0, width, 9, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(70, 80, 94);
    doc.text(PDF_PREVIEW_LABEL.toUpperCase(), width - M, 6, { align: "right" });
    doc.text("Casa de Salvación", M, 6);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
  };

  band();
  let y = 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(20, 35, 29);
  doc.text("Casa de Salvación", M, y);
  y += 6.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Reporte de actividades · ${meta.periodLabel}`, M, y);
  doc.setFontSize(8.5);
  doc.setTextColor(80, 95, 88);
  y += 5.5;
  doc.text(`Filtros: ${meta.filtersLabel}`, M, y);
  y += 4.5;
  doc.text(`Generado por ${meta.generatedBy} el ${meta.generatedOn}`, M, y);
  if (meta.summaryLabel) {
    y += 4.5;
    doc.setTextColor(20, 35, 29);
    doc.text(`Resumen: ${meta.summaryLabel}`, M, y);
  }
  if (meta.byAreaLabel) {
    y += 4.5;
    doc.setTextColor(80, 95, 88);
    const lines = doc.splitTextToSize(`Por área: ${meta.byAreaLabel}`, width - 2 * M) as string[];
    doc.text(lines, M, y);
    y += (lines.length - 1) * 3.8;
  }
  doc.setTextColor(0, 0, 0);

  autoTable(doc, {
    startY: y + 5,
    head: [REPORT_COLUMNS.map((c) => c.label)],
    body: rows.map((r) => REPORT_COLUMNS.map((c) => String(r[c.key] ?? ""))),
    styles: { font: "helvetica", fontSize: 8, cellPadding: 1.6, overflow: "linebreak", textColor: [35, 60, 51], lineColor: [227, 231, 224], lineWidth: 0.1 },
    headStyles: { fillColor: [238, 240, 236], textColor: [20, 35, 29], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 250, 248] },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 20 },
      [RESPONSIBLE_COL]: { cellPadding: { top: 1.6, bottom: 1.6, right: 1.6, left: 5.2 } },
      8: { cellWidth: 62 },
    },
    margin: { top: 14, left: M, right: M, bottom: 14 },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== RESPONSIBLE_COL) return;
      const row = rows[data.row.index];
      if (!row) return;
      doc.setFillColor(...hexToRgb(AREA_PALETTE[row.responsibleColor].swatch));
      doc.rect(data.cell.x + 1.6, data.cell.y + data.cell.height / 2 - 1.25, 2.5, 2.5, "F");
    },
    didDrawPage: () => band(),
  });

  if (!rows.length) {
    doc.setFontSize(10);
    doc.text("No hay actividades con estos filtros.", M, y + 18);
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(95, 110, 101);
    doc.text(`Página ${p} de ${pages}`, width - M, height - 7, { align: "right" });
  }

  return {
    save: (name: string) => doc.save(name),
    pageCount: pages,
    output: () => doc.output("arraybuffer"),
  };
}
