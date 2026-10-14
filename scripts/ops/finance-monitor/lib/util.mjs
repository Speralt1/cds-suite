// Utilidades puras del monitor financiero A6 (doc 31).
// Sin I/O, sin red y sin Date.now(): toda fecha "hoy" llega como argumento.

export const LEVELS = Object.freeze({ INFO: "INFORMATIVO", REVIEW: "REVISAR", STOP: "STOP" });
export const LEVEL_ORDER = Object.freeze({ INFORMATIVO: 0, REVISAR: 1, STOP: 2 });
export const DEFAULT_TIME_ZONE = "America/Santiago";

export const SUMMARY_FIELDS = Object.freeze([
  "incomeTotal",
  "expenseTotal",
  "result",
  "titheTotal",
  "transactionCount",
  "incomeByCategory",
  "expenseByCategory",
  "dailyIncome",
  "dailyExpense",
]);
export const SCALAR_FIELDS = Object.freeze(["incomeTotal", "expenseTotal", "result", "titheTotal", "transactionCount"]);
export const MAP_FIELDS = Object.freeze(["incomeByCategory", "expenseByCategory", "dailyIncome", "dailyExpense"]);
const DAY_FIELDS = new Set(["dailyIncome", "dailyExpense"]);

/**
 * Crea un hallazgo. `refs` guarda los ids completos SOLO para cruzar
 * reconocimientos (config.acknowledged); el reporte nunca los imprime.
 */
export function finding(code, level, message, evidence = {}, refs = []) {
  if (!Object.values(LEVELS).includes(level)) throw new Error(`nivel desconocido: ${level}`);
  return { code, level, message, evidence, refs: [...new Set(refs.filter(Boolean).map(String))] };
}

/** Id abreviado (…últimos 6), igual que A5. Nunca se imprime un id completo. */
export function shortId(id) {
  return `…${String(id ?? "").slice(-6)}`;
}

/** Monto CLP con separador de miles "." (independiente de ICU): 145000 → "$145.000". */
export function clp(n) {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${v < 0 ? "-" : ""}$${s}`;
}

const pad2 = (n) => String(n).padStart(2, "0");

/** Fecha contable "YYYY-MM-DD" de un movimiento (period + day). */
export function accountingDate(row) {
  if (!row || typeof row.period !== "string") return "";
  const day = Number(row.day);
  return Number.isFinite(day) && day > 0 ? `${row.period}-${pad2(day)}` : "";
}

/** Fecha local "YYYY-MM-DD" de un instante ISO en la zona dada. "" si no es válido. */
export function localDate(iso, timeZone = DEFAULT_TIME_ZONE) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Día UTC de una fecha "YYYY-MM-DD" real; lanza si no lo es (nunca NaN silencioso). */
const utcDay = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd));
  const t = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  if (!m || new Date(t).getUTCDate() !== Number(m[3]) || new Date(t).getUTCMonth() !== Number(m[2]) - 1) throw new Error(`fecha inválida: ${String(ymd).slice(0, 10)}`);
  return t / 86400e3;
};

/** Días calendario de `a` a `b` (b − a), ambos "YYYY-MM-DD". */
export function daysBetween(a, b) {
  return Math.round(utcDay(b) - utcDay(a));
}

/** Días hábiles (lun–vie, sin feriados) estrictamente después de `from` y hasta `to` inclusive. */
export function businessDaysBetween(from, to, holidays = []) {
  const skip = new Set(holidays);
  let n = 0;
  for (let t = utcDay(from) + 1; t <= utcDay(to); t++) {
    const d = new Date(t * 86400e3);
    const wd = d.getUTCDay();
    const ymd = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    if (wd !== 0 && wd !== 6 && !skip.has(ymd)) n++;
  }
  return n;
}

export const isActive = (row) => row?.status === "active";
export const isoAfter = (a, b) => !!a && !!b && new Date(a).getTime() > new Date(b).getTime();
export const amountOf = (row) => Math.round(Number(row?.amount) || 0);

/** Mapa sin claves en cero, claves de día normalizadas ("05" → "5") y ordenado, para comparar. */
export function cleanMap(map, field) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    const n = Number(v) || 0;
    if (n === 0) continue;
    const key = DAY_FIELDS.has(field) ? String(Number(k)) : k;
    out[key] = (out[key] || 0) + n;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Claves presentes con valor 0 (estructurales, sin efecto monetario). */
export function zeroKeys(map) {
  return Object.entries(map || {})
    .filter(([, v]) => Number(v) === 0)
    .map(([k]) => k);
}

/** Agregado de los 9 campos del resumen mensual a partir de movimientos activos. */
export function aggregateLedger(rows) {
  const L = {
    incomeTotal: 0,
    expenseTotal: 0,
    result: 0,
    titheTotal: 0,
    transactionCount: 0,
    incomeByCategory: {},
    expenseByCategory: {},
    dailyIncome: {},
    dailyExpense: {},
  };
  for (const t of rows) {
    if (!isActive(t)) continue;
    const inc = t.type === "income";
    const amount = amountOf(t);
    if (inc) L.incomeTotal += amount;
    else L.expenseTotal += amount;
    L.transactionCount++;
    if (t.source === "tithe") L.titheTotal += amount;
    const c = inc ? L.incomeByCategory : L.expenseByCategory;
    c[t.category] = (c[t.category] || 0) + amount;
    const d = inc ? L.dailyIncome : L.dailyExpense;
    const day = String(Number(t.day));
    d[day] = (d[day] || 0) + amount;
  }
  L.result = L.incomeTotal - L.expenseTotal;
  return L;
}

/** Campos (de `fields`) en que dos agregados difieren, comparando mapas sin ceros. */
export function differingFields(a, b, fields = SUMMARY_FIELDS) {
  return fields.filter((f) => {
    if (MAP_FIELDS.includes(f)) return JSON.stringify(cleanMap(a?.[f], f)) !== JSON.stringify(cleanMap(b?.[f], f));
    return Number(a?.[f] || 0) !== Number(b?.[f] || 0);
  });
}

/** a − b campo a campo (mapas incluidos). */
export function subtractAggregates(a, b) {
  const out = {};
  for (const f of SUMMARY_FIELDS) {
    if (MAP_FIELDS.includes(f)) {
      const m = {};
      for (const [k, v] of Object.entries(cleanMap(a?.[f], f))) m[k] = (m[k] || 0) + v;
      for (const [k, v] of Object.entries(cleanMap(b?.[f], f))) m[k] = (m[k] || 0) - v;
      out[f] = cleanMap(m, f);
    } else out[f] = Number(a?.[f] || 0) - Number(b?.[f] || 0);
  }
  return out;
}

/** Suma campo a campo. */
export function addAggregates(a, b) {
  const neg = subtractAggregates({}, b);
  return subtractAggregates(a, neg);
}

export const emptyAggregate = () => aggregateLedger([]);

// ---------------------------------------------------------------------------
// Normalización de nombres. Replica el algoritmo de lib/shared/names.ts (doc 27,
// rama de integridad de diezmos): minúsculas, NFKD sin marcas, letras plegadas,
// puntuación → espacio, espacios colapsados. Cuando ese módulo llegue a
// producción, este bloque debe reemplazarse por functions/shared/names.js.
// ---------------------------------------------------------------------------
const PUNCTUATION = /[.,;:'"´`‘’“”\-‐‑–—_/\\()[\]{}!¡?¿·•&+#*|<>~^=]/g;
const FOLD = { ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", ł: "l", þ: "th", ı: "i" };
export const DEFAULT_SIMILARITY_THRESHOLD = 0.8;

export function normalizeName(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[ßæœøđðłþı]/g, (c) => FOLD[c] ?? c)
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameTokens(raw) {
  return normalizeName(raw)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export function identityKey(raw) {
  let key = nameTokens(raw).join("_");
  if (key.length > 120) key = key.slice(0, 120).replace(/_+$/, "");
  return /^[a-z0-9_]{1,120}$/.test(key) ? key : "";
}

/** Damerau-Levenshtein (optimal string alignment). */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev2 = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

const ratio = (a, b) => {
  const max = Math.max(a.length, b.length);
  return max ? 1 - editDistance(a, b) / max : 0;
};

/** Similitud [0, 1]; 1 solo con la misma clave de identidad. */
export function nameSimilarity(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  if (identityKey(a) === identityKey(b)) return 1;
  const sa = [...new Set(ta)].sort();
  const sb = [...new Set(tb)].sort();
  let score = Math.max(ratio(ta.join(" "), tb.join(" ")), ratio(sa.join(" "), sb.join(" ")));
  const [small, big] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (small.length >= 2 && small.every((t) => big.includes(t))) score = Math.max(score, 0.85);
  return Math.min(score, 0.99);
}
