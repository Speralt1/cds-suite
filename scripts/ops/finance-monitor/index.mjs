// Monitor financiero A6 (doc 31): orquestación pura de los detectores.
// Sin I/O: recibe snapshots como objetos JS y devuelve hallazgos + veredicto.
// La recolección de datos de producción NO vive en el repo (paso privado aparte).
// Falla cerrada: entrada u opciones inválidas, o cualquier excepción → STOP.
import { detectBaselineDeltas } from "./detectors/baseline.mjs";
import { detectBackdated, detectFutureDated } from "./detectors/dates.mjs";
import { detectDuplicateProfiles } from "./detectors/profiles.mjs";
import { detectSummaryLedgerMismatch } from "./detectors/summaries.mjs";
import { detectSumup } from "./detectors/sumup.mjs";
import { detectDuplicateTithes } from "./detectors/tithes.mjs";
import { detectWrites } from "./detectors/writes.mjs";
import { DEFAULT_SIMILARITY_THRESHOLD, DEFAULT_TIME_ZONE, LEVELS, LEVEL_ORDER, finding, localDate } from "./lib/util.mjs";
import { validateOptions, validateSnapshot } from "./lib/validate.mjs";

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

/** Valida y completa las opciones. Devuelve { options, problems }. */
export function resolveOptions(opts = {}) {
  const problems = validateOptions(opts);
  if (problems.length) return { options: null, problems };
  const options = {
    ...DEFAULT_OPTIONS,
    ...opts,
    backdate: { ...DEFAULT_OPTIONS.backdate, ...(opts.backdate || {}) },
    payouts: { ...DEFAULT_OPTIONS.payouts, ...(opts.payouts || {}) },
    acknowledged: opts.acknowledged || [],
  };
  return { options, problems };
}

/**
 * Rebaja a INFORMATIVO los REVISAR reconocidos por un humano. Exige `code` igual al
 * del hallazgo y que TODOS sus ids completos estén listados; `until` (YYYY-MM-DD)
 * vence el reconocimiento. Un STOP nunca se rebaja.
 */
export function applyAcknowledgements(findings, acknowledged = [], today = "") {
  const live = acknowledged.filter((a) => !a.until || !today || a.until >= today);
  const out = findings.map((f) => {
    if (f.level !== LEVELS.REVIEW || !f.refs.length) return f;
    const ack = live.find((a) => a.code === f.code && f.refs.every((ref) => a.ids.includes(ref)));
    if (!ack) return f;
    return { ...f, level: LEVELS.INFO, acknowledged: true, message: `${f.message} [reconocido${ack.until ? ` hasta ${ack.until}` : ""}: ${ack.note || "sin nota"}]` };
  });
  const expired = acknowledged.length - live.length;
  if (expired)
    out.push({ ...finding("ACK_EXPIRED", LEVELS.INFO, `${expired} reconocimiento(s) vencido(s) en la config: ya no rebajan hallazgos. Revisar y renovar o eliminar.`, { count: expired }), detector: "config" });
  return out;
}

const stop = (code, message, evidence = {}) => {
  const findings = [{ ...finding(code, LEVELS.STOP, message, evidence), detector: "entrada" }];
  return { findings, verdict: LEVELS.STOP, exitCode: 2, context: null };
};

/** Qué se pudo verificar. Baseline o snapshot previo ausente → REVISAR (OK nunca significa "nada revisado"). */
function coverageOf(snapshot, since) {
  const coverage = {
    ledger: snapshot.ledger.length,
    summaries: Object.keys(snapshot.summaries).length,
    baseline: snapshot.baseline ? `sí (estado previo: ${snapshot.baseline.priorState})` : "no",
    previous: snapshot.previous ? "sí" : "no",
    window: since || "sin ventana",
    sumup: snapshot.sumup ? `sí (${snapshot.sumup.sales.length} ventas, ${snapshot.sumup.payouts.length} filas de payout)` : "no",
  };
  const missing = [];
  if (!snapshot.baseline) missing.push("baseline (no se verifican cambios de meses cerrados)");
  if (!snapshot.previous) missing.push("snapshot previo (no se detectan modificaciones, anulaciones ni borrados)");
  const findings = [];
  if (missing.length)
    findings.push(
      finding("COVERAGE_PARTIAL", LEVELS.REVIEW, `Cobertura parcial: falta ${missing.join(" y ")}. El resultado no cubre esos controles.`, { missing: missing.map((m) => m.split(" (")[0]) }),
    );
  if (!snapshot.sumup)
    findings.push(finding("COVERAGE_SUMUP_ABSENT", LEVELS.INFO, "Sin datos SumUp (ventas/payouts/comisiones): no se verificaron payouts ni comisiones.", {}));
  return { coverage, findings: findings.map((f) => ({ ...f, detector: "cobertura" })) };
}

/**
 * Ejecuta todos los detectores.
 * @param raw snapshot { takenAt, ledger, attributions, profiles, summaries, baseline?, previous?, sumup? }
 * @param opts { today?, since?, now?, allowEmpty?, ...options }
 */
export function runMonitor(raw, opts = {}) {
  try {
    const { options, problems: optionProblems } = resolveOptions(opts);
    if (!options) return stop("INPUT_INVALID", `Opciones inválidas: ${optionProblems.join("; ")}. No se evaluó nada (falla cerrada).`, { problems: optionProblems });
    const { snapshot, problems } = validateSnapshot(raw, { allowEmpty: options.allowEmpty === true });
    if (!snapshot || problems.length) return stop("INPUT_INVALID", `Snapshot inválido: ${problems.join("; ")}. No se evaluó nada (falla cerrada).`, { problems });
    const reference = options.now || snapshot.takenAt;
    const today = options.today || (reference ? localDate(reference, options.timeZone) : "");
    if (!today) return stop("INPUT_INVALID", "No hay fecha de referencia: falta takenAt en el snapshot o --today.");
    const since = options.since || snapshot.previous?.takenAt || null;
    const ctx = { snapshot, options, today, todayPeriod: today.slice(0, 7), since };
    const { coverage, findings: coverageFindings } = coverageOf(snapshot, since);
    let findings = [...coverageFindings];
    for (const [name, detect] of DETECTORS) {
      try {
        findings.push(...detect(ctx).map((f) => ({ ...f, detector: name })));
      } catch (e) {
        findings.push({ ...finding("DETECTOR_ERROR", LEVELS.STOP, `El detector ${name} falló: ${e instanceof Error ? e.message : String(e)}.`, {}), detector: name });
      }
    }
    findings = applyAcknowledgements(findings, options.acknowledged, today).sort(
      (a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level] || a.code.localeCompare(b.code),
    );
    const verdict = verdictOf(findings);
    return { findings, verdict, exitCode: exitCodeOf(verdict), context: { today, since, takenAt: snapshot.takenAt, timeZone: options.timeZone, coverage } };
  } catch (e) {
    return stop("INTERNAL_ERROR", `Error interno del monitor (${e instanceof Error ? e.name : "desconocido"}). No se evaluó nada (falla cerrada).`);
  }
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

export function formatReport(result) {
  const out = [];
  out.push(`Monitor financiero A6 (modo observación; A5 sigue siendo el monitor oficial)`);
  const c = result.context;
  if (c) {
    out.push(`Snapshot ${c.takenAt || "?"} · hoy ${c.today} (${c.timeZone || DEFAULT_TIME_ZONE}) · ventana de escrituras desde ${c.since || "—"}`);
    const v = c.coverage;
    out.push(`Cobertura: ledger ${v.ledger} movimiento(s) · resúmenes ${v.summaries} · baseline ${v.baseline} · snapshot previo ${v.previous} · SumUp ${v.sumup}`);
  }
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
