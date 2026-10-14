// Detectores de escrituras (semántica A5 + gap f). Puros.
// Ventana: desde snapshot previo (previous.takenAt) o ctx.since.
//  - SUMUP_POS_MUTATION: system:sumup modificó un doc POS ya existente     → REVISAR (A5)
//  - SYSTEM_WRITE_FOREIGN_DOC: system:sumup sobre un doc que no es sumup_*  → REVISAR (A5)
//  - HUMAN_WRITE_ON_SUMUP_DOC: humano modificó un doc sumup_*               → REVISAR
//  - SUMUP_CASH_MUTATION / SUMUP_CREATIONS / HUMAN_WRITES                   → INFORMATIVO
// Contra el snapshot previo (estado anterior real):
//  - PREEXISTING_MODIFIED: campos contables de un doc previo cambiaron      → REVISAR
//  - UNEXPECTED_VOID / REACTIVATED                                          → REVISAR
//  - ROW_MISSING: un doc previo desapareció (el ledger no borra)            → STOP
//  - REVISION_REGRESSION: revision o updateTime retrocedieron               → STOP
import { classifyWrite } from "../lib/classify.mjs";
import { LEVELS, accountingDate, amountOf, clp, finding, isActive, isoAfter, shortId } from "../lib/util.mjs";

const ACCOUNTING_FIELDS = ["type", "amount", "category", "paymentMethod", "period", "day", "source"];

export function detectWrites(ctx) {
  const since = ctx.since;
  // Sin ventana: la falta de cobertura se reporta como COVERAGE_PARTIAL en index.mjs.
  if (!since) return [];
  const recent = ctx.snapshot.ledger.filter((t) => isoAfter(t.updateTime, since) || isoAfter(t.createTime, since));
  const by = {};
  for (const t of recent) (by[classifyWrite(t)] ||= []).push(t);
  const findings = [];
  const ids = (xs) => xs.map((t) => shortId(t.id));
  const pos = (by["sumup-mutation"] || []).filter((t) => t.paymentMethod !== "cash");
  const cash = (by["sumup-mutation"] || []).filter((t) => t.paymentMethod === "cash");
  if (pos.length)
    findings.push(
      finding(
        "SUMUP_POS_MUTATION",
        LEVELS.REVIEW,
        `${pos.length} escritura(s) system:sumup que modifican docs POS existentes (debe explicarlas un cambio real del proveedor: reembolso/anulación).`,
        { count: pos.length, ids: ids(pos), statuses: pos.map((t) => `${t.status}/rev${t.revision ?? "?"}`) },
        pos.map((t) => t.id),
      ),
    );
  if (cash.length)
    findings.push(
      finding("SUMUP_CASH_MUTATION", LEVELS.INFO, `${cash.length} modificación(es) system:sumup de CASH (los invariantes CASH siguen en A5).`, { count: cash.length, ids: ids(cash) }, cash.map((t) => t.id)),
    );
  const foreign = by["system-foreign-doc"] || [];
  if (foreign.length)
    findings.push(
      finding("SYSTEM_WRITE_FOREIGN_DOC", LEVELS.REVIEW, `${foreign.length} escritura(s) de system:sumup sobre docs que no son sumup_*.`, { count: foreign.length, ids: ids(foreign) }, foreign.map((t) => t.id)),
    );
  const humanOnSumup = by["human-on-sumup-doc"] || [];
  if (humanOnSumup.length)
    findings.push(
      finding(
        "HUMAN_WRITE_ON_SUMUP_DOC",
        LEVELS.REVIEW,
        `${humanOnSumup.length} doc(s) sumup_* modificados por un usuario humano (los docs del proveedor no deberían editarse a mano).`,
        { count: humanOnSumup.length, ids: ids(humanOnSumup) },
        humanOnSumup.map((t) => t.id),
      ),
    );
  const created = by["sumup-creation"] || [];
  if (created.length)
    findings.push(
      finding(
        "SUMUP_CREATIONS",
        LEVELS.INFO,
        `${created.length} creación(es) SumUp legítimas (rev 1, sin modificar): ${created.filter((t) => t.paymentMethod === "cash").length} CASH, ${created.filter((t) => t.paymentMethod !== "cash").length} POS, total ${clp(created.reduce((a, t) => a + amountOf(t), 0))}.`,
        { count: created.length, total: created.reduce((a, t) => a + amountOf(t), 0) },
      ),
    );
  const human = [...(by["human-creation"] || []), ...(by["human-edit"] || [])];
  if (human.length) {
    const periods = {};
    for (const t of human) periods[t.period] = (periods[t.period] || 0) + 1;
    findings.push(
      finding(
        "HUMAN_WRITES",
        LEVELS.INFO,
        `${human.length} escritura(s) humanas en la ventana (${(by["human-creation"] || []).length} creaciones, ${(by["human-edit"] || []).length} ediciones/anulaciones) por mes: ${Object.entries(periods).sort().map(([p, n]) => `${p}: ${n}`).join(", ")}. Actividad de Tesorería; los demás detectores validan fechas, duplicados y meses cerrados.`,
        { count: human.length, byPeriod: periods },
      ),
    );
  }

  const prev = ctx.snapshot.previous;
  if (!prev || !Array.isArray(prev.ledger)) return findings;
  const now = new Map(ctx.snapshot.ledger.map((t) => [t.id, t]));
  const missing = [];
  const regress = [];
  for (const p of prev.ledger) {
    const t = now.get(p.id);
    if (!t) {
      missing.push(p);
      continue;
    }
    if (Number(t.revision ?? 0) < Number(p.revision ?? 0) || (p.updateTime && t.updateTime && isoAfter(p.updateTime, t.updateTime))) regress.push(t);
    const systemMutation = t.updatedBy === "system:sumup";
    if (isActive(p) && !isActive(t)) {
      findings.push(
        finding(
          "UNEXPECTED_VOID",
          LEVELS.REVIEW,
          `Anulación desde el snapshot previo: ${shortId(t.id)} (${clp(amountOf(p))}, ${accountingDate(p)}, ${classifyWrite(t)}). Confirmar que fue intencional.`,
          { id: shortId(t.id), amount: amountOf(p), date: accountingDate(p), by: classifyWrite(t) },
          [t.id],
        ),
      );
      continue;
    }
    if (!isActive(p) && isActive(t)) {
      findings.push(
        finding("REACTIVATED", LEVELS.REVIEW, `Movimiento anulado que volvió a estar activo: ${shortId(t.id)} (${clp(amountOf(t))}, ${accountingDate(t)}).`, { id: shortId(t.id), amount: amountOf(t) }, [t.id]),
      );
      continue;
    }
    const changed = ACCOUNTING_FIELDS.filter((f) => String(p[f] ?? "") !== String(t[f] ?? ""));
    if (changed.length && !systemMutation)
      findings.push(
        finding(
          "PREEXISTING_MODIFIED",
          LEVELS.REVIEW,
          `Movimiento preexistente modificado desde el snapshot previo: ${shortId(t.id)} cambió ${changed.join(", ")}${changed.includes("amount") ? ` (${clp(amountOf(p))} → ${clp(amountOf(t))})` : ""}.`,
          { id: shortId(t.id), fields: changed, by: classifyWrite(t) },
          [t.id],
        ),
      );
  }
  if (missing.length)
    findings.push(
      finding(
        "ROW_MISSING",
        LEVELS.STOP,
        `${missing.length} movimiento(s) del snapshot previo ya no existen (el ledger solo anula, nunca borra): ${clp(missing.reduce((a, t) => a + amountOf(t), 0))}.`,
        { count: missing.length, ids: ids(missing) },
        missing.map((t) => t.id),
      ),
    );
  if (regress.length)
    findings.push(
      finding("REVISION_REGRESSION", LEVELS.STOP, `${regress.length} movimiento(s) con revision o updateTime menor que en el snapshot previo (posible restauración o corrupción).`, { count: regress.length, ids: ids(regress) }, regress.map((t) => t.id)),
    );
  return findings;
}
