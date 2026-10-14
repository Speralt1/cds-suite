// Monitor financiero A6 (doc 31): orquestación pura de los detectores.
// Sin I/O: recibe snapshots como objetos JS y devuelve hallazgos + veredicto.
// La recolección de datos de producción NO vive en el repo (paso privado aparte).
import { detectBaselineDeltas } from "./detectors/baseline.mjs";
import { detectBackdated, detectFutureDated } from "./detectors/dates.mjs";
import { detectDuplicateProfiles } from "./detectors/profiles.mjs";
import { detectSummaryLedgerMismatch } from "./detectors/summaries.mjs";
import { detectSumup } from "./detectors/sumup.mjs";
import { detectDuplicateTithes } from "./detectors/tithes.mjs";
import { detectWrites } from "./detectors/writes.mjs";
import { DEFAULT_SIMILARITY_THRESHOLD, DEFAULT_TIME_ZONE, LEVELS, LEVEL_ORDER, finding, localDate, shortId } from "./lib/util.mjs";

export { LEVELS } from "./lib/util.mjs";

export const DETECTORS = Object.freeze([
  ["fechas-futuras", detectFutureDated],
  ["retroactivos", detectBackdated],
  ["diezmos-duplicados", detectDuplicateTithes],
  ["perfiles-duplicados", detectDuplicateProfiles],
  ["resumen-vs-ledger", detectSummaryLedgerMismatch],
  ["baseline", detectBaselineDeltas],
  ["escrituras", detectWrites],
  ["sumup", detectSumup],
]);

export const DEFAULT_OPTIONS = Object.freeze({
  timeZone: DEFAULT_TIME_ZONE,
  backdate: { maxLagDays: 31 },
  payouts: { pendingBusinessDays: 3, holidays: [] },
  profileSimilarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
  acknowledged: [],
});

export function resolveOptions(options = {}) {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    backdate: { ...DEFAULT_OPTIONS.backdate, ...(options.backdate || {}) },
    payouts: { ...DEFAULT_OPTIONS.payouts, ...(options.payouts || {}) },
    acknowledged: Array.isArray(options.acknowledged) ? options.acknowledged : [],
  };
}

const arr = (v) => (Array.isArray(v) ? v : []);

/** Valida la forma mínima. Devuelve { snapshot, problems }. */
export function normalizeSnapshot(raw = {}) {
  const problems = [];
  if (!raw || typeof raw !== "object") return { snapshot: null, problems: ["el snapshot no es un objeto JSON"] };
  if (!Array.isArray(raw.ledger)) problems.push("falta ledger[]");
  const ledger = arr(raw.ledger);
  ledger.forEach((t, i) => {
    if (!t || typeof t.id !== "string" || !/^\d{4}-\d{2}$/.test(String(t.period)) || !Number.isFinite(Number(t.amount)))
      problems.push(`movimiento #${i} sin id/period/amount válidos`);
  });
  const snapshot = {
    takenAt: raw.takenAt || null,
    ledger,
    attributions: arr(raw.attributions),
    profiles: arr(raw.profiles),
    summaries: raw.summaries && typeof raw.summaries === "object" ? raw.summaries : {},
    baseline: raw.baseline || null,
    previous: raw.previous || null,
    sumup: raw.sumup || null,
  };
  return { snapshot, problems: problems.slice(0, 20) };
}

/** Rebaja a INFORMATIVO los REVISAR reconocidos por un humano (config.acknowledged). STOP nunca se rebaja. */
export function applyAcknowledgements(findings, acknowledged = []) {
  const matches = (ack, ref) => (ack.ids || []).some((id) => id === ref || shortId(ref) === id || shortId(ref) === `…${id}`);
  return findings.map((f) => {
    if (f.level !== LEVELS.REVIEW || !f.refs.length) return f;
    const ack = acknowledged.find((a) => (!a.code || a.code === f.code) && f.refs.every((ref) => matches(a, ref)));
    if (!ack) return f;
    return { ...f, level: LEVELS.INFO, acknowledged: true, message: `${f.message} [reconocido: ${ack.note || "sin nota"}]` };
  });
}

/**
 * Ejecuta todos los detectores.
 * @param raw snapshot { takenAt, ledger, attributions, profiles, summaries, baseline?, previous?, sumup? }
 * @param opts { today?, since?, now?, ...options }
 */
export function runMonitor(raw, opts = {}) {
  const options = resolveOptions(opts);
  const { snapshot, problems } = normalizeSnapshot(raw);
  if (!snapshot || problems.length) {
    const f = finding("INPUT_INVALID", LEVELS.STOP, `Snapshot inválido: ${problems.join("; ")}. No se evaluó nada (falla cerrada).`, { problems });
    return { findings: [f], verdict: LEVELS.STOP, exitCode: 2, context: null };
  }
  const reference = opts.now || snapshot.takenAt;
  const today = opts.today || localDate(reference, options.timeZone);
  if (!today) {
    const f = finding("INPUT_INVALID", LEVELS.STOP, "No hay fecha de referencia: falta takenAt en el snapshot o --today.", {});
    return { findings: [f], verdict: LEVELS.STOP, exitCode: 2, context: null };
  }
  const ctx = {
    snapshot,
    options,
    today,
    todayPeriod: today.slice(0, 7),
    since: opts.since || snapshot.previous?.takenAt || null,
  };
  let findings = [];
  for (const [name, detect] of DETECTORS) {
    try {
      findings.push(...detect(ctx).map((f) => ({ ...f, detector: name })));
    } catch (e) {
      findings.push({ ...finding("DETECTOR_ERROR", LEVELS.STOP, `El detector ${name} falló: ${e instanceof Error ? e.message : String(e)}.`, {}), detector: name });
    }
  }
  findings = applyAcknowledgements(findings, options.acknowledged).sort(
    (a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level] || a.code.localeCompare(b.code),
  );
  const verdict = verdictOf(findings);
  return { findings, verdict, exitCode: exitCodeOf(verdict), context: { today: ctx.today, since: ctx.since, takenAt: snapshot.takenAt } };
}

export function verdictOf(findings) {
  const max = Math.max(0, ...findings.map((f) => LEVEL_ORDER[f.level]));
  return max === 2 ? LEVELS.STOP : max === 1 ? LEVELS.REVIEW : "OK";
}

export const exitCodeOf = (verdict) => (verdict === LEVELS.STOP ? 2 : verdict === LEVELS.REVIEW ? 1 : 0);

/** Hallazgos sin `refs` (ids completos): lo único que se imprime o exporta. */
export const publicFindings = (findings) =>
  findings.map((f) => {
    const copy = { ...f };
    delete copy.refs;
    return copy;
  });

const fmtEvidence = (e) =>
  Object.entries(e || {})
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("; ");

export function formatReport(result, meta = {}) {
  const out = [];
  out.push(`Monitor financiero A6 (modo observación; A5 sigue siendo el monitor oficial)`);
  if (result.context)
    out.push(`Snapshot ${result.context.takenAt || "?"} · hoy ${result.context.today} (${meta.timeZone || DEFAULT_TIME_ZONE}) · ventana de escrituras desde ${result.context.since || "—"}`);
  if (meta.inputs) out.push(`Entradas: ${meta.inputs}`);
  for (const level of [LEVELS.STOP, LEVELS.REVIEW, LEVELS.INFO]) {
    const fs = result.findings.filter((f) => f.level === level);
    out.push("", `${level} (${fs.length})`);
    for (const f of fs) {
      out.push(`- [${f.code}] ${f.message}`);
      const ev = fmtEvidence(f.evidence);
      if (ev) out.push(`    evidencia: ${ev}`);
    }
  }
  out.push("", `RESULTADO: ${result.verdict} (exit ${result.exitCode})`);
  return out.join("\n");
}
