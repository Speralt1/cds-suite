// PDF del reporte de calendario, generado LOCALMENTE (sin red). jspdf y
// jspdf-autotable se importan solo de forma dinámica dentro de buildCalendarPdf,
// que se llama desde el onClick de "Descargar PDF". No se reutiliza
// lib/finance/report-pdf.ts porque arrastra Firestore.
// A4 horizontal, Helvetica, rótulo "Vista previa · datos de demostración" en
// cada página y NUNCA notas internas ni motivos (las filas no los traen).
//
// Paginación por alto disponible: autoTable corta las páginas solo (pageBreak
// "auto", filas enteras). `calendarPdfLayout` reproduce ese mismo cálculo SIN
// cargar jspdf (métricas Helvetica de jspdf + mismo ajuste de líneas) para que
// la vista previa en pantalla muestre exactamente las filas de la página 1 y
// el total de páginas. El PDF recibe el texto ya ajustado por esta función.

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

// ---------- Geometría (mm) ----------
export const PDF_PAGE = { width: 297, height: 210 } as const;
const M = 15;
const MARGIN = { top: 14, bottom: 14, left: M, right: M } as const;
const FONT_SIZE = 8;
const PAD = 1.6;
const RESPONSIBLE_PAD_LEFT = 5.2;
/** jsPDF: puntos por mm y factor de interlineado por defecto. */
const SCALE_FACTOR = 72 / 25.4;
const LINE_HEIGHT_FACTOR = 1.15;
/** Anchos fijos de columna (suman el ancho útil: 297 − 2·15 = 267 mm). */
export const PDF_COLUMN_WIDTHS: readonly number[] = [24, 19, 42, 31, 34, 26, 20, 19, 52];

// ---------- Métricas Helvetica (las mismas tablas que usa jspdf) ----------
// Anchos en centésimas de em para GLYPHS; kerning "ab±n" (n en centésimas de
// em) aplicado al par anterior→actual, como getCharWidthsArray de jspdf.
const GLYPHS = (() => {
  let s = "";
  for (let i = 32; i < 127; i++) s += String.fromCharCode(i);
  for (let i = 160; i < 256; i++) s += String.fromCharCode(i);
  return s + "–—’“”…•";
})();
const NORMAL_W = "28,28,35,55,55,89,66,19,33,33,39,58,28,33,28,28,55,55,55,55,55,55,55,55,55,55,28,28,58,58,58,55,101,66,66,72,72,66,61,78,72,28,50,66,55,83,72,78,66,78,72,66,61,72,66,94,66,66,61,28,28,28,47,55,33,55,55,50,55,55,28,55,55,22,22,50,22,83,55,55,55,55,33,50,28,55,50,72,50,50,50,33,26,33,58,53,33,55,55,55,55,53,55,33,73,37,55,58,53,73,33,40,58,53,53,33,55,53,28,33,53,36,55,53,53,53,61,66,66,66,66,66,66,100,72,66,66,66,66,28,28,28,28,53,72,78,78,78,78,78,53,78,72,72,72,72,53,53,61,55,55,55,55,55,55,89,50,55,55,55,55,28,28,28,28,53,55,55,55,55,55,55,58,61,55,55,55,55,53,53,50,55,100,22,33,33,100,35";
const NORMAL_K = " Y-9|,’-10|,”-10|.’-10|.”-10|AT-12|AY-10|DY-9|F,-15|F.-15|FA-8|FÀ-8|FÁ-8|FÂ-8|FÃ-8|FÄ-8|FÅ-8|LT-11|LV-11|LY-14|L’-16|L”-14|P,-18|P.-18|PA-12|PÀ-12|PÁ-12|PÂ-12|PÃ-12|PÄ-12|PÅ-12|T,-12|T--14|T.-12|TA-12|Ta-12|Te-12|To-12|Tr-12|Tu-12|Tw-12|Ty-12|TÀ-12|TÁ-12|TÂ-12|TÃ-12|TÄ-12|TÅ-12|Tà-12|Tá-12|Tâ-12|Tä-12|Tå-12|Té-12|Tê-12|Të-12|Tò-12|Tó-12|Tô-12|Tö-12|Tø-12|Tù-12|Tú-12|Tû-12|Tü-12|V,-13|V--8|V.-13|VA-8|Ve-8|Vo-8|VÀ-8|VÁ-8|VÂ-8|VÃ-8|VÄ-8|VÅ-8|Vè-8|Vé-8|Vê-8|Vë-8|Vò-8|Vó-8|Vô-8|Võ-8|Vö-8|Vø-8|W,-8|W.-8|Y,-14|Y--14|Y.-14|YA-11|YO-9|Ya-14|Ye-14|Yo-14|Yu-11|YÀ-11|YÁ-11|YÂ-11|YÃ-11|YÄ-11|YÅ-11|YÒ-9|YÓ-9|YÔ-9|YÕ-9|YÖ-9|YØ-9|Yà-14|Yá-14|Yâ-14|Yã-14|Yä-14|Yå-14|Yè-14|Yé-14|Yê-14|Yë-14|Yò-14|Yó-14|Yô-14|Yõ-14|Yö-14|Yø-14|Yù-11|Yú-11|Yû-11|Yü-11|v,-8|v.-8|y,-10|y.-10|ÀT-12|ÀY-10|ÁT-12|ÁY-10|ÂT-12|ÂY-10|ÃT-12|ÃY-10|ÄT-12|ÄY-10|ÅT-12|ÅY-10|ø,-10|ø.-10|øx-9|ÿ,-10|ÿ.-10";
const BOLD_W = "28,33,47,55,55,89,72,24,33,33,39,58,28,33,28,28,55,55,55,55,55,55,55,55,55,55,33,33,58,58,58,61,97,72,72,72,72,66,61,78,72,28,55,72,61,83,72,78,66,78,72,66,61,72,66,94,66,66,61,33,28,33,58,55,33,55,61,55,61,55,33,61,61,28,28,55,28,89,61,61,61,61,39,55,33,61,55,78,55,55,50,39,28,39,58,56,33,55,55,55,55,56,55,33,73,37,55,58,56,73,33,40,58,56,56,33,61,55,28,33,56,36,55,56,56,56,61,72,72,72,72,72,72,100,72,66,66,66,66,28,28,28,28,56,72,78,78,78,78,78,56,78,72,72,72,72,56,56,61,55,55,55,55,55,55,89,55,55,55,55,55,28,28,28,28,56,61,61,61,61,61,61,58,61,61,61,61,61,56,56,55,55,100,28,50,50,100,35";
const BOLD_K = " T-10| V-8| W-8| Y-12| “-8|,’-12|,”-12|.’-12|.”-12|AT-9|AV-8|AY-11|F,-10|F.-10|FA-8|FÀ-8|FÁ-8|FÂ-8|FÃ-8|FÄ-8|FÅ-8|LT-9|LV-11|LW-8|LY-12|L’-14|L”-14|P,-12|P.-12|PA-10|PÀ-10|PÁ-10|PÂ-10|PÃ-10|PÄ-10|PÅ-10|T,-8|T--12|T.-8|TA-9|Ta-8|To-8|Tr-8|Tu-9|TÀ-9|TÁ-9|TÂ-9|TÃ-9|TÄ-9|TÅ-9|Tà-8|Tá-8|Tâ-8|Tã-8|Tä-8|Tå-8|Tò-8|Tó-8|Tô-8|Tõ-8|Tö-8|Tø-8|Tù-9|Tú-9|Tû-9|Tü-9|V,-12|V--8|V.-12|VA-8|Vo-9|VÀ-8|VÁ-8|VÂ-8|VÃ-8|VÄ-8|VÅ-8|Vò-9|Vó-9|Vô-9|Võ-9|Vö-9|Vø-9|W,-8|W.-8|Y,-10|Y.-10|YA-11|Ya-9|Ye-8|Yo-10|Yu-10|YÀ-11|YÁ-11|YÂ-11|YÃ-11|YÄ-11|YÅ-11|Yà-9|Yá-9|Yâ-9|Yã-9|Yä-9|Yå-9|Yè-8|Yé-8|Yê-8|Yë-8|Yò-10|Yó-10|Yô-10|Yõ-10|Yö-10|Yø-10|Yù-10|Yú-10|Yû-10|Yü-10|v,-8|v.-8|y,-8|y.-8|ÀT-9|ÀV-8|ÀY-11|ÁT-9|ÁV-8|ÁY-11|ÂT-9|ÂV-8|ÂY-11|ÃT-9|ÃV-8|ÃY-11|ÄT-9|ÄV-8|ÄY-11|ÅT-9|ÅV-8|ÅY-11|ÿ,-8|ÿ.-8|’ -8|’d-8|” -8";

type FontStyle = "normal" | "bold";
interface Metrics {
  widths: Map<string, number>;
  kerning: Map<string, number>;
  fallback: number;
}
function parseMetrics(w: string, k: string, fallback: number): Metrics {
  const values = w.split(",").map(Number);
  const widths = new Map<string, number>();
  [...GLYPHS].forEach((g, i) => widths.set(g, values[i] / 100));
  const kerning = new Map<string, number>();
  for (const pair of k.split("|")) {
    const chars = [...pair];
    kerning.set(chars[0] + chars[1], Number(chars.slice(2).join("")) / 100);
  }
  return { widths, kerning, fallback };
}
let metricsCache: Record<FontStyle, Metrics> | null = null;
function metrics(style: FontStyle): Metrics {
  metricsCache ??= { normal: parseMetrics(NORMAL_W, NORMAL_K, 0.53), bold: parseMetrics(BOLD_W, BOLD_K, 0.56) };
  return metricsCache[style];
}

/** Ancho de cada carácter (em), igual que jsPDF.getCharWidthsArray. */
function charWidths(text: string, style: FontStyle): number[] {
  const m = metrics(style);
  const out: number[] = [];
  let prev = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    out.push((m.widths.get(c) ?? m.fallback) + (prev ? (m.kerning.get(prev + c) ?? 0) : 0));
    prev = c;
  }
  return out;
}
const sum = (a: readonly number[]) => a.reduce((p, c) => p + c, 0);

/** Port de splitLongWord de jspdf. */
function splitLongWord(word: string, widths: number[], firstLineMax: number, max: number): string[] {
  const answer: string[] = [];
  let i = 0;
  let working = 0;
  while (i !== word.length && working + widths[i] < firstLineMax) {
    working += widths[i];
    i++;
  }
  answer.push(word.slice(0, i));
  let start = i;
  working = 0;
  while (i !== word.length) {
    if (working + widths[i] > max) {
      answer.push(word.slice(start, i));
      working = 0;
      start = i;
    }
    working += widths[i];
    i++;
  }
  if (start !== i) answer.push(word.slice(start, i));
  return answer;
}

/** Port de splitParagraphIntoLines de jspdf (sin sangrías). `max` en em. */
function splitParagraph(text: string, max: number, style: FontStyle): string[] {
  let line: (string | undefined)[] = [];
  const lines = [line];
  let lineLength = 0;
  let separator = 0;
  const space = charWidths(" ", style)[0];
  for (const word of text.split(" ")) {
    const widths = charWidths(word, style);
    let current = sum(widths);
    if (lineLength + separator + current > max) {
      if (current > max) {
        const tmp = splitLongWord(word, widths, max - (lineLength + separator), max);
        line.push(tmp.shift());
        line = [tmp.pop()];
        while (tmp.length) lines.push([tmp.shift()]);
        current = sum(widths.slice(word.length - (line[0] ? line[0].length : 0)));
      } else {
        line = [word];
      }
      lines.push(line);
      lineLength = current;
      separator = space;
    } else {
      line.push(word);
      lineLength += separator + current;
      separator = space;
    }
  }
  return lines.map((l) => l.join(" "));
}

/** Igual que jsPDF.splitTextToSize: `maxMm` en mm, `fontSize` en pt. */
export function splitPdfText(text: string, maxMm: number, fontSize: number, style: FontStyle = "normal"): string[] {
  const max = (SCALE_FACTOR * maxMm) / fontSize;
  return text.split(/\r?\n/).flatMap((p) => splitParagraph(p, max, style));
}

// ---------- Layout compartido (PDF y vista previa) ----------
export interface PdfHeaderLine {
  text: string | string[];
  /** Línea base (mm). */
  y: number;
  size: number;
  bold: boolean;
  tone: "strong" | "muted";
}

export interface PdfTableRow {
  /** Líneas por columna (orden de REPORT_COLUMNS). */
  lines: string[][];
  /** Alto (mm), como lo calcula autoTable. */
  height: number;
}

export interface CalendarPdfLayout {
  header: PdfHeaderLine[];
  /** Inicio de la tabla en la página 1 (mm). */
  startY: number;
  head: PdfTableRow;
  rows: PdfTableRow[];
  /** Índices de fila por página. */
  pages: number[][];
  pageCount: number;
}

const LINE_HEIGHT = (FONT_SIZE / SCALE_FACTOR) * LINE_HEIGHT_FACTOR;

/** Geometría para la vista previa en pantalla (mm y pt). */
export const PDF_GEOMETRY = {
  page: PDF_PAGE,
  margin: MARGIN,
  fontSize: FONT_SIZE,
  lineHeight: LINE_HEIGHT,
  padding: PAD,
  responsiblePadLeft: RESPONSIBLE_PAD_LEFT,
  responsibleColumn: RESPONSIBLE_COL,
  columnWidths: PDF_COLUMN_WIDTHS,
  /** mm por punto tipográfico. */
  mmPerPt: 1 / SCALE_FACTOR,
} as const;

function cellPadLeft(col: number): number {
  return col === RESPONSIBLE_COL ? RESPONSIBLE_PAD_LEFT : PAD;
}

function tableRow(values: readonly string[], style: FontStyle): PdfTableRow {
  const lines = values.map((v, col) => {
    const textSpace = PDF_COLUMN_WIDTHS[col] - (cellPadLeft(col) + PAD);
    // autoTable suma 1 pt al espacio de texto ("rounding error").
    return splitPdfText(v, textSpace + 1 / SCALE_FACTOR, FONT_SIZE, style);
  });
  const height = Math.max(0, ...lines.map((l) => l.length * LINE_HEIGHT + (PAD + PAD)));
  return { lines, height };
}

/**
 * Cálculo del PDF sin jspdf: encabezado, alto de cada fila y qué filas caben en
 * cada página (misma regla que autoTable con rowPageBreak "avoid").
 */
export function calendarPdfLayout(rows: readonly CalendarReportRow[], meta: CalendarReportMeta): CalendarPdfLayout {
  const header: PdfHeaderLine[] = [];
  let y = 18;
  header.push({ text: "Casa de Salvación", y, size: 15, bold: true, tone: "strong" });
  y += 6.5;
  header.push({ text: `Reporte de actividades · ${meta.periodLabel}`, y, size: 11, bold: false, tone: "strong" });
  y += 5.5;
  header.push({ text: `Filtros: ${meta.filtersLabel}`, y, size: 8.5, bold: false, tone: "muted" });
  y += 4.5;
  header.push({ text: `Generado por ${meta.generatedBy} el ${meta.generatedOn}`, y, size: 8.5, bold: false, tone: "muted" });
  if (meta.summaryLabel) {
    y += 4.5;
    header.push({ text: `Resumen: ${meta.summaryLabel}`, y, size: 8.5, bold: false, tone: "strong" });
  }
  if (meta.byAreaLabel) {
    y += 4.5;
    const lines = splitPdfText(`Por área: ${meta.byAreaLabel}`, PDF_PAGE.width - 2 * M, 8.5);
    header.push({ text: lines, y, size: 8.5, bold: false, tone: "muted" });
    y += (lines.length - 1) * 3.8;
  }
  const startY = y + 5;

  const head = tableRow(
    REPORT_COLUMNS.map((c) => c.label),
    "bold",
  );
  const body = rows.map((r) => tableRow(REPORT_COLUMNS.map((c) => String(r[c.key] ?? "")), "normal"));

  const pages: number[][] = [[]];
  let cursor = startY;
  if (startY + MARGIN.bottom + head.height > PDF_PAGE.height) cursor = MARGIN.top;
  cursor += head.height;
  body.forEach((row, i) => {
    const remaining = PDF_PAGE.height - cursor - MARGIN.bottom;
    if (!(row.height <= remaining)) {
      pages.push([]);
      cursor = MARGIN.top + head.height;
    }
    pages[pages.length - 1].push(i);
    cursor += row.height;
  });
  return { header, startY, head, rows: body, pages, pageCount: pages.length };
}

export async function buildCalendarPdf(
  rows: readonly CalendarReportRow[],
  meta: CalendarReportMeta,
): Promise<{ save(name: string): void; pageCount: number; rowsPerPage: number[]; rowHeights: number[]; output(): ArrayBuffer }> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const layout = calendarPdfLayout(rows, meta);

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
  for (const line of layout.header) {
    doc.setFont("helvetica", line.bold ? "bold" : "normal");
    doc.setFontSize(line.size);
    if (line.tone === "strong") doc.setTextColor(20, 35, 29);
    else doc.setTextColor(80, 95, 88);
    doc.text(line.text, M, line.y);
  }
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);

  const rowsPerPage: number[] = [];
  const rowHeights: number[] = [];
  autoTable(doc, {
    startY: layout.startY,
    head: [REPORT_COLUMNS.map((c) => c.label)],
    // Texto ya ajustado por calendarPdfLayout (autoTable no vuelve a cortarlo).
    body: layout.rows.map((r) => r.lines.map((l) => l.join("\n"))),
    pageBreak: "auto",
    rowPageBreak: "avoid",
    showHead: "everyPage",
    styles: {
      font: "helvetica",
      fontSize: FONT_SIZE,
      cellPadding: PAD,
      overflow: "linebreak",
      textColor: [35, 60, 51],
      lineColor: [227, 231, 224],
      lineWidth: 0.1,
    },
    headStyles: { fillColor: [238, 240, 236], textColor: [20, 35, 29], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 250, 248] },
    columnStyles: Object.fromEntries(
      PDF_COLUMN_WIDTHS.map((w, i) => [
        i,
        i === RESPONSIBLE_COL ? { cellWidth: w, cellPadding: { top: PAD, bottom: PAD, right: PAD, left: RESPONSIBLE_PAD_LEFT } } : { cellWidth: w },
      ]),
    ),
    margin: MARGIN,
    didDrawCell: (data) => {
      if (data.section !== "body") return;
      if (data.column.index === 0) {
        rowsPerPage[data.pageNumber - 1] = (rowsPerPage[data.pageNumber - 1] ?? 0) + 1;
        rowHeights[data.row.index] = data.row.height;
      }
      if (data.column.index !== RESPONSIBLE_COL) return;
      const row = rows[data.row.index];
      if (!row) return;
      doc.setFillColor(...hexToRgb(AREA_PALETTE[row.responsibleColor].swatch));
      doc.rect(data.cell.x + 1.6, data.cell.y + data.cell.height / 2 - 1.25, 2.5, 2.5, "F");
    },
    didDrawPage: () => band(),
  });

  if (!rows.length) {
    doc.setFontSize(10);
    doc.text("No hay actividades con estos filtros.", M, layout.startY + 13);
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
    rowsPerPage: Array.from({ length: pages }, (_, i) => rowsPerPage[i] ?? 0),
    rowHeights,
    output: () => doc.output("arraybuffer"),
  };
}
