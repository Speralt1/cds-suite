// PDF del reporte de calendario, generado LOCALMENTE (sin red). jspdf y
// jspdf-autotable se importan solo de forma dinámica dentro de buildCalendarPdf,
// que se llama desde el onClick de "Descargar PDF". No se reutiliza
// lib/finance/report-pdf.ts porque arrastra Firestore.

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
}

export const PDF_PREVIEW_LABEL = "Vista previa · datos de demostración";

/** Nombre de archivo sugerido. */
export function calendarPdfFileName(month: string): string {
  return `reporte-calendario-DEMO-${month}.pdf`;
}

export async function buildCalendarPdf(
  rows: readonly CalendarReportRow[],
  meta: CalendarReportMeta,
): Promise<{ save(name: string): void; pageCount: number; output(): ArrayBuffer }> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const width = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(`Casa de Salvación · Reporte de calendario · ${meta.periodLabel}`, 14, 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(meta.filtersLabel, 14, 28);
  doc.text(`Generado por ${meta.generatedBy} el ${meta.generatedOn}`, 14, 33);

  autoTable(doc, {
    startY: 38,
    head: [REPORT_COLUMNS.map((c) => c.label)],
    body: rows.map((r) => REPORT_COLUMNS.map((c) => String(r[c.key] ?? ""))),
    styles: { font: "helvetica", fontSize: 8, cellPadding: 1.6, overflow: "linebreak" },
    headStyles: { fillColor: [40, 91, 69], textColor: 255 },
    columnStyles: { 8: { cellWidth: 60 } },
    margin: { top: 16, left: 14, right: 14 },
    didDrawPage: () => {
      // Rótulo de vista previa en CADA página.
      doc.setFillColor(238, 240, 244);
      doc.rect(0, 0, width, 10, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(70, 80, 94);
      doc.text(PDF_PREVIEW_LABEL, 14, 6.5);
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "normal");
    },
  });

  if (!rows.length) {
    doc.setFontSize(10);
    doc.text("No hay actividades con estos filtros.", 14, 50);
  }

  return {
    save: (name: string) => doc.save(name),
    pageCount: doc.getNumberOfPages(),
    output: () => doc.output("arraybuffer"),
  };
}
