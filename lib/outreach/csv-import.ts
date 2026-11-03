// «Ve por los tuyos» (doc 40 §7) · lector del CSV que exporta el panel del sitio
// del evento (tipo=asistentes y tipo=solicitudes). Puro y sin red: convierte
// texto en InboundRegistration para `importRegistrations` (que vuelve a
// validar todo en el servidor). Los mensajes de error llevan el número de fila
// y la columna, NUNCA el valor de una celda (son datos personales).
//
// Columnas del sitio (servidor/exportar.ts, solo lectura):
//   asistentes : id, solicitud, nombre, menor, correo, telefono, estado,
//                destino_entrada, codigo_final, usada, ninos_acompanantes[, fecha_nacimiento]
//   solicitudes: id, fecha_solicitud, solicitante, correo, telefono, personas,
//                estado_revision, estado_contacto, resultado
// La fecha de nacimiento, el código de entrada y los niños acompañantes se
// IGNORAN a propósito (doc 40 §7.2: nunca menores ni fechas de nacimiento; el
// código completo solo lo maneja el sitio).

import { localNow } from "@/lib/shared/dates";
import type { InboundRegistration } from "@/lib/shared/outreach-sync";

export type CsvKind = "asistentes" | "solicitudes";

export interface CsvRowError {
  /** Número de registro del CSV; la cabecera es la fila 1. */
  row: number;
  message: string;
}

export interface CsvParseResult {
  kind: CsvKind | null;
  rows: InboundRegistration[];
  errors: CsvRowError[];
  /** Filas válidas que no entran (pendiente, no aprobado, en espera, sin resultado favorable). */
  skipped: number;
  /** Menores de edad: no se envían (el sitio marca `menor = sí`). */
  minors: number;
  /** Cómo se obtuvo `sourceRevision` (informativo para el informe). */
  revisionSource: "updatedAt" | "estado";
}

export interface CsvParseOptions {
  /** Año de la edición abierta: el CSV del sitio no lo trae (la convocatoria es el archivo). */
  editionYear: number;
  /** Fuerza el tipo; por defecto se detecta por las columnas. */
  kind?: CsvKind;
  /** Instante de la importación: hora de ingreso cuando el CSV solo dice «usada = sí». */
  now?: Date | number;
}

// ---------- CSV ----------

/** Quita el BOM y detecta el separador mirando solo la primera línea (fuera de comillas). */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const first = text.replace(/^﻿/, "");
  let inQuotes = false;
  const count = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of first) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && ch in count) count[ch as keyof typeof count] += 1;
  }
  if (count[";"] > count[","] && count[";"] >= count["\t"]) return ";";
  if (count["\t"] > count[","]) return "\t";
  return ",";
}

/** Registros de un CSV (RFC 4180): comillas dobles, saltos dentro de comillas, CRLF/LF, BOM. */
export function parseCsvRecords(text: string, delimiter: string = detectDelimiter(text)): string[][] {
  const src = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let touched = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (touched || row.some((c) => c !== "")) records.push(row);
    row = [];
    touched = false;
  };
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      touched = true;
    } else if (ch === delimiter) {
      endCell();
      touched = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0 || touched) endRow();
  return records;
}

// ---------- Mapeo ----------

const normHeader = (h: string) =>
  h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** El sitio prefija con «'» las celdas que una planilla leería como fórmula (= + - @): se deshace. */
const unescapeCell = (v: string) => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v).trim();

const YES = new Set(["si", "sí", "true", "1", "x", "yes"]);
const isYes = (v: string) => YES.has(v.normalize("NFC").trim().toLowerCase());
const isNo = (v: string) => ["no", "false", "0"].includes(v.trim().toLowerCase());

const COL = {
  id: ["id"],
  name: ["nombre", "solicitante"],
  minor: ["menor"],
  email: ["correo", "email"],
  phone: ["telefono", "celular"],
  state: ["estado"],
  used: ["usada"],
  usedAt: ["ingreso", "usada_en", "ingreso_en", "hora_ingreso"],
  updated: ["actualizado", "updated_at", "updatedat", "fecha_actualizacion"],
  reviewState: ["estado_revision"],
  result: ["resultado"],
  invitedBy: ["invitado_por", "invitado_por_nombre"],
  year: ["edicion", "anio", "ano"],
  consentFollow: ["autoriza_seguimiento"],
  consentWhatsapp: ["autoriza_whatsapp"],
  consentVersion: ["version_consentimiento"],
  consentAt: ["fecha_consentimiento"],
} as const;

type ColName = keyof typeof COL;

function indexColumns(header: string[]): Partial<Record<ColName, number>> {
  const names = header.map(normHeader);
  const out: Partial<Record<ColName, number>> = {};
  for (const key of Object.keys(COL) as ColName[]) {
    const at = names.findIndex((n) => (COL[key] as readonly string[]).includes(n));
    if (at >= 0) out[key] = at;
  }
  return out;
}

function detectKind(header: string[]): CsvKind | null {
  const names = new Set(header.map(normHeader));
  if (names.has("solicitante") && !names.has("nombre")) return "solicitudes";
  if (names.has("nombre") && names.has("menor")) return "asistentes";
  return null;
}

const SKIPPED_STATES = new Set(["pendiente", "no-aprobado", "no_aprobado", "en-espera", "en_espera"]);
const CANCEL_STATES = new Set(["anulado", "retirado", "retirada"]);

/** Instante de la importación o de la celda como «YYYY-MM-DDTHH:mm» de Santiago; null si no se entiende. */
function toLocal(value: string, fallback: Date | number): string {
  const t = Date.parse(value);
  return localNow(Number.isNaN(t) || !value ? fallback : t);
}

/**
 * Convierte el texto del CSV en filas para importar.
 *
 * `sourceRevision`: el sitio no exporta un contador. Si hay una columna de
 * actualización (`actualizado`/`updated_at`) se usan sus milisegundos; si no,
 * se deriva del ESTADO de la fila (aprobado = 1, usada = 2, anulado/retirado
 * = 3): es monótona (el estado solo avanza), estable entre exportaciones del
 * mismo estado (importar dos veces no cambia nada) y no depende del orden de
 * las filas, que no es confiable entre exportaciones.
 */
export function parseSiteCsv(text: string, options: CsvParseOptions): CsvParseResult {
  const result: CsvParseResult = { kind: null, rows: [], errors: [], skipped: 0, minors: 0, revisionSource: "estado" };
  const records = parseCsvRecords(text);
  if (records.length === 0) {
    result.errors.push({ row: 1, message: "El archivo está vacío." });
    return result;
  }
  const kind = options.kind ?? detectKind(records[0]);
  if (!kind) {
    result.errors.push({ row: 1, message: "No reconocemos las columnas. Usa la exportación «asistentes» o «solicitudes» del panel del evento." });
    return result;
  }
  result.kind = kind;
  const cols = indexColumns(records[0]);
  const required: ColName[] = kind === "asistentes" ? ["id", "name", "minor", "state"] : ["id", "name"];
  const missing = required.filter((c) => cols[c] === undefined);
  if (missing.length > 0) {
    result.errors.push({ row: 1, message: `Faltan columnas obligatorias: ${missing.map((c) => COL[c][0]).join(", ")}.` });
    return result;
  }
  result.revisionSource = cols.updated !== undefined ? "updatedAt" : "estado";
  const now = options.now ?? Date.now();
  const seen = new Set<string>();

  for (let i = 1; i < records.length; i += 1) {
    const row = i + 1;
    const rec = records[i];
    const get = (c: ColName) => (cols[c] === undefined ? "" : unescapeCell(rec[cols[c] as number] ?? ""));
    const fail = (message: string) => result.errors.push({ row, message: `Fila ${row}: ${message}` });

    const rawId = get("id");
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(rawId)) {
      fail("el identificador falta o no es válido.");
      continue;
    }
    const externalId = kind === "solicitudes" ? `sol-${rawId}` : rawId;
    if (seen.has(externalId)) {
      fail("el identificador está repetido en el archivo.");
      continue;
    }
    seen.add(externalId);
    const fullName = get("name").replace(/\s+/g, " ");
    if (!fullName) {
      fail("falta el nombre.");
      continue;
    }

    let cancelled = false;
    let attended = false;
    let adult = true;
    if (kind === "asistentes") {
      const state = get("state").toLowerCase();
      const minor = get("minor");
      if (!isYes(minor) && !isNo(minor)) {
        fail("la columna «menor» debe ser sí o no.");
        continue;
      }
      if (isYes(minor)) {
        result.minors += 1;
        continue;
      }
      if (SKIPPED_STATES.has(state)) {
        result.skipped += 1;
        continue;
      }
      if (CANCEL_STATES.has(state)) cancelled = true;
      else if (state !== "aprobado") {
        fail("el estado de la inscripción no es reconocido.");
        continue;
      }
      attended = !cancelled && cols.used !== undefined && isYes(get("used"));
    } else {
      // Solicitudes: la persona que llenó el formulario; se asume adulta (el formulario lo exige).
      const review = get("reviewState").toLowerCase();
      const outcome = get("result").toLowerCase();
      if (CANCEL_STATES.has(review)) cancelled = true;
      else if (!["aprobada", "parcial"].includes(outcome)) {
        result.skipped += 1;
        continue;
      }
      adult = true;
    }

    const year = get("year") ? Number(get("year")) : options.editionYear;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      fail("el año de la edición no es válido.");
      continue;
    }

    let sourceRevision: number;
    if (cols.updated !== undefined) {
      const t = Date.parse(get("updated"));
      if (Number.isNaN(t)) {
        fail("la fecha de actualización no es válida.");
        continue;
      }
      sourceRevision = t;
    } else sourceRevision = cancelled ? 3 : attended ? 2 : 1;

    const consents: InboundRegistration["consents"] = [];
    const version = get("consentVersion");
    if (version) {
      const grantedAt = toLocal(get("consentAt"), now);
      if (isYes(get("consentFollow"))) consents.push({ purpose: "seguimiento_evento", textVersion: version.slice(0, 40), grantedAt });
      if (isYes(get("consentWhatsapp"))) consents.push({ purpose: "mensajes_whatsapp", textVersion: version.slice(0, 40), grantedAt });
    }

    result.rows.push({
      externalId,
      sourceRevision,
      editionYear: year,
      fullName,
      phone: get("phone") || null,
      email: get("email") || null,
      invitedByName: get("invitedBy") || null,
      adultConfirmed: adult,
      consents,
      cancelled,
      attendedAt: attended ? toLocal(get("usedAt"), now) : null,
    });
  }
  return result;
}
