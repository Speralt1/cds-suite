"use client";

// /preview/reportes/finanzas: contenido de Financial UX V2 dentro del módulo
// global, con el mismo encabezado de secciones y la misma etiqueta del botón
// PDF que el reporte de calendario.

import { ReportesScreen } from "@/components/finance-preview/screens/analisis";
import { ReportSections } from "./report-sections";

export function FinanceReport() {
  return (
    <div className="sx-rep sx-rep-fin">
      <ReportesScreen pdfLabel="Descargar PDF" belowHeader={<ReportSections current="finanzas" />} />
    </div>
  );
}
