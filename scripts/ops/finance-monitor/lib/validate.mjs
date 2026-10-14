// Validación estricta de snapshots y opciones (falla cerrada, doc 31 §2).
// Nada se coerciona en silencio: un tipo inesperado es INPUT_INVALID (STOP).
import { MAP_FIELDS, SCALAR_FIELDS } from "./util.mjs";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_PROBLEMS = 30;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

/** Fecha de calendario real "YYYY-MM-DD" (rechaza 2026-02-30). */
export function isYmd(v) {
  const m = typeof v === "string" && YMD_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Instante ISO 8601 con zona (Z u offset) y válido. */
export function isIso(v) {
  return typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(new Date(v).getTime());
}

const daysInMonth = (period) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

function collector() {
  const problems = [];
  return {
    problems,
    add: (msg) => problems.push(msg),
  };
}

const ENUMS = { type: ["income", "expense"], status: ["active", "voided"], source: ["general", "tithe"] };

function checkRows(rows, label, add) {
  const ids = new Set();
  rows.forEach((t, i) => {
    const at = `${label}[${i}]`;
    if (!isObj(t)) return add(`${at} no es un objeto`);
    if (!isStr(t.id)) add(`${at}.id debe ser texto`);
    else if (ids.has(t.id)) add(`${label}: id duplicado en la posición ${i}`);
    else ids.add(t.id);
    for (const [f, values] of Object.entries(ENUMS)) if (!values.includes(t[f])) add(`${at}.${f} fuera de dominio`);
    if (!isInt(t.amount) || t.amount < 0) add(`${at}.amount debe ser un entero ≥ 0`);
    if (!isStr(t.category)) add(`${at}.category debe ser texto`);
    if (!isStr(t.paymentMethod)) add(`${at}.paymentMethod debe ser texto`);
    if (typeof t.period !== "string" || !PERIOD_RE.test(t.period)) add(`${at}.period inválido`);
    else {
      const day = typeof t.day === "number" ? t.day : typeof t.day === "string" && /^\d{1,2}$/.test(t.day) ? Number(t.day) : NaN;
      if (!isInt(day) || day < 1 || day > daysInMonth(t.period)) add(`${at}.day inválido`);
    }
    if (t.revision !== undefined && (!isInt(t.revision) || t.revision < 1)) add(`${at}.revision debe ser un entero ≥ 1`);
    for (const f of ["createdBy", "updatedBy"]) if (t[f] !== undefined && typeof t[f] !== "string") add(`${at}.${f} debe ser texto`);
    // createTime/updateTime son obligatorios: sin ellos la ventana de escrituras y los
    // retroactivos se apagarían en silencio. voidedAt es opcional.
    for (const f of ["createTime", "updateTime"]) if (!isIso(t[f])) add(`${at}.${f} falta o no es ISO`);
    if (t.voidedAt !== undefined && t.voidedAt !== null && !isIso(t.voidedAt)) add(`${at}.voidedAt no es ISO`);
  });
}

function checkSummaryValue(s, at, add, requireScalars) {
  if (!isObj(s)) return add(`${at} no es un objeto`);
  for (const f of SCALAR_FIELDS) {
    if (s[f] === undefined) {
      if (requireScalars) add(`${at}.${f} falta`);
    } else if (!isNum(s[f])) add(`${at}.${f} no es numérico`);
  }
  for (const f of MAP_FIELDS) {
    if (s[f] === undefined) continue;
    if (!isObj(s[f])) add(`${at}.${f} no es un mapa`);
    else if (Object.values(s[f]).some((v) => !isNum(v))) add(`${at}.${f} tiene valores no numéricos`);
  }
}

function checkSummaries(map, label, add, requireScalars) {
  if (!isObj(map)) return add(`${label} debe ser un objeto { "YYYY-MM": resumen }`);
  // Nunca se repiten claves ni valores del resumen en el mensaje: solo la posición.
  Object.entries(map).forEach(([period, s], i) => {
    if (!PERIOD_RE.test(period)) add(`${label}: la clave de la posición ${i} no es un mes YYYY-MM`);
    checkSummaryValue(s, `${label}[posición ${i}]`, add, requireScalars);
  });
}

function checkSumup(s, add) {
  if (!isObj(s)) return add("sumup no es un objeto");
  for (const f of ["sales", "payouts", "feeExpenses", "feeProposals"]) if (!Array.isArray(s[f])) add(`sumup.${f}[] es obligatorio cuando hay sumup`);
  if (s.payoutAmountBasis !== undefined && !isStr(s.payoutAmountBasis)) add("sumup.payoutAmountBasis debe ser texto");
  (Array.isArray(s.sales) ? s.sales : []).forEach((x, i) => {
    const at = `sumup.sales[${i}]`;
    if (!isObj(x)) return add(`${at} no es un objeto`);
    if (!isStr(x.transactionCode)) add(`${at}.transactionCode debe ser texto`);
    if (!isYmd(x.date)) add(`${at}.date debe ser fecha local America/Santiago YYYY-MM-DD`);
    if (!isInt(x.gross) || x.gross < 0) add(`${at}.gross debe ser un entero ≥ 0`);
    if (x.refunded !== undefined && (!isInt(x.refunded) || x.refunded < 0)) add(`${at}.refunded debe ser un entero ≥ 0`);
    if (!["POS", "CASH"].includes(x.paymentType)) add(`${at}.paymentType debe ser POS o CASH`);
    for (const f of ["account", "status"]) if (x[f] !== undefined && typeof x[f] !== "string") add(`${at}.${f} debe ser texto`);
  });
  (Array.isArray(s.payouts) ? s.payouts : []).forEach((x, i) => {
    const at = `sumup.payouts[${i}]`;
    if (!isObj(x)) return add(`${at} no es un objeto`);
    if (!isStr(x.id)) add(`${at}.id debe ser texto`);
    if (!isInt(x.amount)) add(`${at}.amount debe ser entero`);
    for (const f of ["fee", "deduction"]) if (x[f] !== undefined && (!isInt(x[f]) || x[f] < 0)) add(`${at}.${f} debe ser un entero ≥ 0`);
    for (const f of ["account", "type", "transactionCode", "reference", "status"]) if (x[f] !== undefined && typeof x[f] !== "string") add(`${at}.${f} debe ser texto`);
    if (x.date !== undefined && !isYmd(x.date)) add(`${at}.date debe ser YYYY-MM-DD`);
  });
  for (const f of ["feeExpenses", "feeProposals"])
    (Array.isArray(s[f]) ? s[f] : []).forEach((x, i) => {
      const at = `sumup.${f}[${i}]`;
      if (!isObj(x)) return add(`${at} no es un objeto`);
      if (!isStr(x.id)) add(`${at}.id debe ser texto`);
      if (!isStr(x.payoutRowId)) add(`${at}.payoutRowId debe ser texto`);
      if (!isInt(x.amount) || x.amount < 0) add(`${at}.amount debe ser un entero ≥ 0`);
      if (x.status !== undefined && typeof x.status !== "string") add(`${at}.status debe ser texto`);
    });
}

/**
 * Valida y normaliza el snapshot. Adaptador de baselines A9/A10: `takenAt` cae a
 * `createdAt`, y `ledger` solo se usa como estado previo si es un arreglo de filas
 * (el `ledger` de A10 es un agregado y se ignora).
 */
export function validateSnapshot(raw, { allowEmpty = false } = {}) {
  const { problems, add } = collector();
  if (!isObj(raw)) return { snapshot: null, problems: ["el snapshot no es un objeto JSON"] };
  if (raw.takenAt !== undefined && raw.takenAt !== null && !isIso(raw.takenAt)) add("takenAt no es ISO");
  if (!Array.isArray(raw.ledger)) add("falta ledger[]");
  else {
    if (!raw.ledger.length && !allowEmpty) add("ledger[] vacío (usar --allow-empty solo si es intencional)");
    checkRows(raw.ledger, "ledger", add);
  }
  if (raw.summaries === undefined) add("falta summaries");
  else {
    checkSummaries(raw.summaries, "summaries", add, true);
    if (isObj(raw.summaries) && !Object.keys(raw.summaries).length && !allowEmpty) add("summaries vacío (usar --allow-empty solo si es intencional)");
  }
  for (const f of ["attributions", "profiles"]) if (raw[f] !== undefined && !Array.isArray(raw[f])) add(`${f} debe ser un arreglo`);
  (Array.isArray(raw.attributions) ? raw.attributions : []).forEach((a, i) => {
    const at = `attributions[${i}]`;
    if (!isObj(a)) return add(`${at} no es un objeto`);
    for (const f of ["id", "transactionId", "profileId"]) if (!isStr(a[f])) add(`${at}.${f} debe ser texto`);
    if (a.status !== undefined && !["active", "voided"].includes(a.status)) add(`${at}.status fuera de dominio`);
    if (a.amount !== undefined && !isNum(a.amount)) add(`${at}.amount no es numérico`);
    if (a.period !== undefined && (typeof a.period !== "string" || !PERIOD_RE.test(a.period))) add(`${at}.period inválido`);
    if (a.date !== undefined && a.date !== null && !isIso(a.date) && !isYmd(a.date)) add(`${at}.date debe ser ISO o YYYY-MM-DD`);
  });
  const profileIds = new Set();
  (Array.isArray(raw.profiles) ? raw.profiles : []).forEach((p, i) => {
    const at = `profiles[${i}]`;
    if (!isObj(p)) return add(`${at} no es un objeto`);
    if (!isStr(p.id)) add(`${at}.id debe ser texto`);
    else if (profileIds.has(p.id)) add(`profiles: id duplicado en la posición ${i}`);
    else profileIds.add(p.id);
    if (typeof p.displayName !== "string") add(`${at}.displayName debe ser texto`);
    if (p.active !== undefined && typeof p.active !== "boolean") add(`${at}.active debe ser booleano`);
  });

  let baseline = null;
  if (raw.baseline !== undefined && raw.baseline !== null) {
    const b = raw.baseline;
    if (!isObj(b)) add("baseline no es un objeto");
    else {
      const takenAt = b.takenAt ?? b.createdAt;
      if (!isIso(takenAt)) add("baseline.takenAt (o createdAt) falta o no es ISO");
      checkSummaries(b.months, "baseline.months", add, false);
      const priorRows = Array.isArray(b.ledger) ? b.ledger : null;
      if (priorRows) checkRows(priorRows, "baseline.ledger", add);
      baseline = { takenAt, months: isObj(b.months) ? b.months : {}, ledger: priorRows ?? undefined, priorState: priorRows ? "ledger" : "inferido" };
    }
  }
  let previous = null;
  if (raw.previous !== undefined && raw.previous !== null) {
    const p = raw.previous;
    if (!isObj(p)) add("previous no es un objeto");
    else {
      if (!isIso(p.takenAt)) add("previous.takenAt falta o no es ISO");
      if (!Array.isArray(p.ledger)) add("previous.ledger[] es obligatorio");
      else checkRows(p.ledger, "previous.ledger", add);
      previous = { takenAt: p.takenAt, ledger: Array.isArray(p.ledger) ? p.ledger : [] };
    }
  }
  if (raw.sumup !== undefined && raw.sumup !== null) checkSumup(raw.sumup, add);

  const snapshot = {
    takenAt: raw.takenAt ?? null,
    ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
    attributions: Array.isArray(raw.attributions) ? raw.attributions : [],
    profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
    summaries: isObj(raw.summaries) ? raw.summaries : {},
    baseline,
    previous,
    sumup: raw.sumup ?? null,
  };
  return { snapshot, problems: capped(problems) };
}

const capped = (problems) => (problems.length > MAX_PROBLEMS ? [...problems.slice(0, MAX_PROBLEMS), `… y ${problems.length - MAX_PROBLEMS} problema(s) más`] : problems);

const OPTION_KEYS = new Set(["timeZone", "backdate", "payouts", "profileSimilarityThreshold", "acknowledged", "closedMonthHumanChanges", "today", "since", "now", "allowEmpty"]);

/** Valida opciones (config + flags). Claves desconocidas o tipos erróneos → problemas. */
export function validateOptions(opts) {
  const { problems, add } = collector();
  if (!isObj(opts)) return ["las opciones/config no son un objeto"];
  for (const k of Object.keys(opts)) if (!OPTION_KEYS.has(k)) add(`opción desconocida: ${k}`);
  if (opts.timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: opts.timeZone });
    } catch {
      add("timeZone inválida");
    }
  }
  if (opts.backdate !== undefined && (!isObj(opts.backdate) || (opts.backdate.maxLagDays !== undefined && (!isInt(opts.backdate.maxLagDays) || opts.backdate.maxLagDays < 0))))
    add("backdate.maxLagDays debe ser un entero ≥ 0");
  if (opts.payouts !== undefined) {
    const p = opts.payouts;
    if (!isObj(p)) add("payouts debe ser un objeto");
    else {
      if (p.pendingBusinessDays !== undefined && (!isInt(p.pendingBusinessDays) || p.pendingBusinessDays < 0)) add("payouts.pendingBusinessDays debe ser un entero ≥ 0");
      if (p.holidays !== undefined && (!Array.isArray(p.holidays) || !p.holidays.every(isYmd))) add("payouts.holidays debe ser un arreglo de fechas YYYY-MM-DD");
    }
  }
  if (opts.profileSimilarityThreshold !== undefined && (!isNum(opts.profileSimilarityThreshold) || opts.profileSimilarityThreshold <= 0 || opts.profileSimilarityThreshold > 1))
    add("profileSimilarityThreshold debe estar en (0, 1]");
  if (opts.today !== undefined && !isYmd(opts.today)) add("today debe ser una fecha real YYYY-MM-DD");
  for (const f of ["since", "now"]) if (opts[f] !== undefined && !isIso(opts[f])) add(`${f} debe ser un instante ISO con zona`);
  if (opts.allowEmpty !== undefined && typeof opts.allowEmpty !== "boolean") add("allowEmpty debe ser booleano");
  if (opts.closedMonthHumanChanges !== undefined && !["informativo", "revisar"].includes(opts.closedMonthHumanChanges))
    add('closedMonthHumanChanges debe ser "informativo" o "revisar"');
  if (opts.acknowledged !== undefined) {
    if (!Array.isArray(opts.acknowledged)) add("acknowledged debe ser un arreglo");
    else
      opts.acknowledged.forEach((a, i) => {
        const at = `acknowledged[${i}]`;
        if (!isObj(a)) return add(`${at} no es un objeto`);
        if (!isStr(a.code)) add(`${at}.code es obligatorio`);
        if (!Array.isArray(a.ids) || !a.ids.length || !a.ids.every(isStr)) add(`${at}.ids debe ser un arreglo no vacío de ids completos`);
        if (a.note !== undefined && typeof a.note !== "string") add(`${at}.note debe ser texto`);
        if (a.until !== undefined && !isYmd(a.until)) add(`${at}.until debe ser una fecha real YYYY-MM-DD`);
      });
  }
  return capped(problems);
}
