// Detector: cambios de meses vs baseline (gaps a, b, e). Puro.
// Para cada mes del baseline: delta = resumen actual − baseline debe ser igual a
// Σ de las escrituras listadas individualmente desde baseline.takenAt
// (creaciones, anulaciones, ediciones).
//   explicado    → INFORMATIVO (detalle por escritura, humana o sistema)
//   no explicado → STOP (el mes cambió sin escrituras que lo justifiquen)
// El estado previo de cada escritura sale de baseline.ledger cuando existe; si no,
// se infiere (creación posterior al baseline → no existía; anulación posterior →
// estaba activo con el mismo monto). Una edición sin estado previo no se puede
// explicar: si el delta no cuadra → STOP; si cuadra → REVISAR (no verificable),
// nunca INFORMATIVO. Un doc del baseline.ledger que ya no existe (borrado) → STOP
// BASELINE_ROW_DELETED, sin importar el delta: el ledger solo anula, nunca borra.
import { classifyWrite, isHumanClass } from "../lib/classify.mjs";
import {
  LEVELS,
  SCALAR_FIELDS,
  SUMMARY_FIELDS,
  addAggregates,
  aggregateLedger,
  clp,
  differingFields,
  emptyAggregate,
  finding,
  isActive,
  isoAfter,
  shortId,
  subtractAggregates,
} from "../lib/util.mjs";

const LABEL = { incomeTotal: "ingresos", expenseTotal: "egresos", result: "resultado", titheTotal: "diezmos", transactionCount: "movs" };
const signed = (f, v) => (f === "transactionCount" ? `${v > 0 ? "+" : ""}${v}` : `${v > 0 ? "+" : ""}${clp(v)}`);
const describe = (agg, fields) =>
  fields
    .filter((f) => SCALAR_FIELDS.includes(f) && Number(agg[f]))
    .map((f) => `${LABEL[f]} ${signed(f, agg[f])}`)
    .join(", ") || "sin cambio en totales";

/** Escrituras desde el baseline con su estado antes/después. */
export function writesSinceBaseline(ledger, baseline) {
  const takenAt = baseline.takenAt;
  const hasPrior = Array.isArray(baseline.ledger);
  const prior = new Map((hasPrior ? baseline.ledger : []).map((r) => [r.id, r]));
  const current = new Set(ledger.map((t) => t.id));
  const writes = [];
  for (const t of ledger) {
    const touched = isoAfter(t.updateTime, takenAt) || isoAfter(t.createTime, takenAt);
    if (!touched) continue;
    let before = null;
    let kind;
    if (hasPrior && prior.has(t.id)) {
      before = prior.get(t.id);
      kind = isActive(before) && !isActive(t) ? "void" : !isActive(before) && isActive(t) ? "reactivation" : "edit";
    } else if (isoAfter(t.createTime, takenAt)) {
      kind = "creation";
    } else if (!isActive(t)) {
      const voidedAfter = !t.voidedAt || isoAfter(t.voidedAt, takenAt);
      before = voidedAfter ? { ...t, status: "active" } : t;
      kind = voidedAfter ? "void" : "touch";
    } else {
      kind = "edit-unknown";
    }
    writes.push({ row: t, before, kind, cls: classifyWrite(t) });
  }
  if (hasPrior)
    for (const [id, r] of prior)
      if (!current.has(id)) writes.push({ row: null, before: r, kind: "deleted", cls: "unknown" });
  return writes;
}

/** Contribución neta de las escrituras por mes. */
function contributions(writes) {
  const by = new Map();
  const add = (period, agg) => by.set(period, addAggregates(by.get(period) || emptyAggregate(), agg));
  for (const w of writes) {
    if (w.kind === "edit-unknown") continue;
    if (w.row && isActive(w.row)) add(w.row.period, aggregateLedger([w.row]));
    if (w.before && isActive(w.before)) add(w.before.period, subtractAggregates(emptyAggregate(), aggregateLedger([w.before])));
  }
  return by;
}

/** Cambios humanos sobre docs existentes (no creaciones): anular, editar (incl. mover de mes), reactivar. */
const humanChangesIn = (ws) => ws.filter((w) => w.row && isHumanClass(w.cls) && ["void", "edit", "reactivation"].includes(w.kind));

const touchesPeriod = (w, period) => w.row?.period === period || w.before?.period === period;

function summarizeWrites(ws) {
  const kinds = {};
  for (const w of ws) kinds[w.kind] = (kinds[w.kind] || 0) + 1;
  const human = ws.filter((w) => isHumanClass(w.cls)).length;
  return { total: ws.length, kinds, human, system: ws.length - human };
}

const KIND_ES = { creation: "creación", void: "anulación", reactivation: "reactivación", edit: "edición", "edit-unknown": "edición sin estado previo", touch: "toque sin efecto", deleted: "borrado" };

export function detectBaselineDeltas(ctx) {
  const base = ctx.snapshot.baseline;
  // Sin baseline: la ausencia se reporta como COVERAGE_PARTIAL (REVISAR) en index.mjs.
  if (!base) return [];

  const ledger = ctx.snapshot.ledger;
  const writes = writesSinceBaseline(ledger, base);
  const contrib = contributions(writes);
  const byPeriod = new Map();
  for (const t of ledger) {
    if (!byPeriod.has(t.period)) byPeriod.set(t.period, []);
    byPeriod.get(t.period).push(t);
  }
  const findings = [];
  for (const period of Object.keys(base.months).sort()) {
    const b = base.months[period] || {};
    const fields = SUMMARY_FIELDS.filter((f) => f in b);
    const current = ctx.snapshot.summaries[period] || aggregateLedger(byPeriod.get(period) || []);
    const delta = subtractAggregates(current, b);
    const explained = contrib.get(period) || emptyAggregate();
    const bad = differingFields(delta, explained, fields);
    const ws = writes.filter((w) => touchesPeriod(w, period) && w.kind !== "touch");
    const closed = period < ctx.todayPeriod;
    const monthLabel = closed ? `Mes cerrado ${period}` : `Mes abierto ${period}`;
    const list = ws.map((w) => `${KIND_ES[w.kind]} ${shortId((w.row || w.before).id)} (${w.cls})`);
    const evidence = {
      period,
      closed,
      baselineTakenAt: base.takenAt,
      priorState: base.priorState || (Array.isArray(base.ledger) ? "ledger" : "inferido"),
      fieldsCompared: fields,
      delta: Object.fromEntries(fields.map((f) => [f, delta[f]])),
      explainedBy: Object.fromEntries(fields.map((f) => [f, explained[f]])),
      writes: summarizeWrites(ws),
      writeList: list,
    };
    const refs = ws.map((w) => (w.row || w.before).id);
    const deleted = ws.filter((w) => w.kind === "deleted");
    const unknownEdits = ws.filter((w) => w.kind === "edit-unknown");
    if (deleted.length)
      findings.push(
        finding(
          "BASELINE_ROW_DELETED",
          LEVELS.STOP,
          `${monthLabel}: ${deleted.length} movimiento(s) presentes en el baseline ya no existen (${clp(deleted.reduce((a, w) => a + Number(w.before.amount || 0), 0))}). El ledger solo anula, nunca borra: posible borrado directo o corrupción.`,
          { period, count: deleted.length, ids: deleted.map((w) => shortId(w.before.id)), deltaMatchesWrites: !bad.length },
          deleted.map((w) => w.before.id),
        ),
      );
    if (bad.length) {
      const unexplained = subtractAggregates(delta, explained);
      findings.push(
        finding(
          "BASELINE_DELTA_UNEXPLAINED",
          LEVELS.STOP,
          `${monthLabel} cambió respecto del baseline (${describe(delta, fields)}) y las ${ws.length} escritura(s) listadas desde ${base.takenAt} no lo explican (explican: ${describe(explained, fields)}; sin explicar: ${describe(unexplained, fields)}). Campos: ${bad.join(", ")}.${ws.some((w) => w.kind === "edit-unknown") ? " Hay ediciones sin estado previo: incluir el ledger en el baseline." : ""}`,
          { ...evidence, fieldsMismatched: bad, unexplained: Object.fromEntries(fields.map((f) => [f, unexplained[f]])) },
          refs,
        ),
      );
    } else if (unknownEdits.length) {
      findings.push(
        finding(
          "BASELINE_EDIT_UNVERIFIABLE",
          LEVELS.REVIEW,
          `${monthLabel}: el delta respecto del baseline cuadra, pero ${unknownEdits.length} edición(es) posteriores al baseline no tienen estado previo (${unknownEdits.map((w) => shortId(w.row.id)).join(", ")}); no se puede verificar su efecto. Incluir el ledger en el baseline.`,
          { ...evidence, unverifiable: unknownEdits.map((w) => shortId(w.row.id)) },
          unknownEdits.map((w) => w.row.id),
        ),
      );
    } else if (ws.length && !deleted.length && closed && humanChangesIn(ws).length && ctx.options.closedMonthHumanChanges !== "informativo") {
      // Decisión de diseño (doc 31 §3): por defecto, anulaciones/ediciones/movimientos
      // humanos en un mes cerrado se revisan aunque el delta cuadre. Con
      // closedMonthHumanChanges: "informativo" quedan como BASELINE_DELTA_EXPLAINED.
      const hc = humanChangesIn(ws);
      findings.push(
        finding(
          "BASELINE_CLOSED_MONTH_HUMAN_CHANGE",
          LEVELS.REVIEW,
          `${monthLabel}: el delta respecto del baseline cuadra (${describe(delta, fields)}), pero incluye ${hc.length} anulación(es)/edición(es) humana(s) de movimientos existentes (${hc.map((w) => `${KIND_ES[w.kind]} ${shortId(w.row.id)}`).join(", ")}). Confirmar con Tesorería.`,
          { ...evidence, humanChanges: hc.map((w) => shortId(w.row.id)) },
          hc.map((w) => w.row.id),
        ),
      );
    } else if (ws.length && !deleted.length) {
      const s = evidence.writes;
      findings.push(
        finding(
          "BASELINE_DELTA_EXPLAINED",
          LEVELS.INFO,
          `${monthLabel} cambió respecto del baseline (${describe(delta, fields)}); explicado por ${s.total} escritura(s) individuales (${Object.entries(s.kinds).map(([k, n]) => `${n} ${KIND_ES[k]}`).join(", ")}; ${s.human} humana(s), ${s.system} de sistema).`,
          evidence,
          refs,
        ),
      );
    }
  }
  // Meses cerrados con escrituras desde el baseline pero ausentes del baseline.
  const periodsWithWrites = new Set(writes.flatMap((w) => [w.row?.period, w.before?.period]).filter(Boolean));
  for (const period of [...periodsWithWrites].sort()) {
    if (period in base.months) continue;
    const gone = writes.filter((w) => w.kind === "deleted" && w.before.period === period);
    if (gone.length)
      findings.push(
        finding(
          "BASELINE_ROW_DELETED",
          LEVELS.STOP,
          `Mes ${period}: ${gone.length} movimiento(s) presentes en el baseline ya no existen. El ledger solo anula, nunca borra: posible borrado directo o corrupción.`,
          { period, count: gone.length, ids: gone.map((w) => shortId(w.before.id)) },
          gone.map((w) => w.before.id),
        ),
      );
    if (period >= ctx.todayPeriod) continue;
    const ws = writes.filter((w) => touchesPeriod(w, period) && w.kind !== "touch");
    if (!ws.length) continue;
    findings.push(
      finding(
        "BASELINE_MONTH_MISSING",
        LEVELS.REVIEW,
        `Mes cerrado ${period} recibió ${ws.length} escritura(s) desde el baseline pero no está en el baseline: no se puede verificar su delta.`,
        { period, writes: summarizeWrites(ws) },
        ws.map((w) => (w.row || w.before).id),
      ),
    );
  }
  if (!(ctx.todayPeriod in base.months))
    findings.push(
      finding(
        "BASELINE_OPEN_MONTH_ABSENT",
        LEVELS.INFO,
        `El mes en curso ${ctx.todayPeriod} no está en el baseline: solo se verifica resumen vs ledger. Agregarlo al refrescar el baseline.`,
        { period: ctx.todayPeriod },
      ),
    );
  return findings;
}
