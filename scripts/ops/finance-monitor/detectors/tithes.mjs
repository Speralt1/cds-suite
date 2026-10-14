// Detector: diezmos duplicados (gap d). Puro.
//  - mismo perfil + misma fecha contable + mismo monto + mismo medio de pago → REVISAR
//  - mismo perfil + mismo monto en el mismo mes (fechas distintas)        → INFORMATIVO
import { LEVELS, accountingDate, amountOf, clp, finding, isActive, shortId } from "../lib/util.mjs";

/** Diezmos activos con su(s) perfil(es) según atribuciones activas. */
function attributedTithes(ctx) {
  const rows = new Map(ctx.snapshot.ledger.filter((t) => isActive(t) && t.source === "tithe").map((t) => [t.id, t]));
  const out = [];
  for (const a of ctx.snapshot.attributions) {
    if (a.status && a.status !== "active") continue;
    const row = rows.get(a.transactionId);
    if (row && a.profileId) out.push({ row, profileId: a.profileId });
  }
  return out;
}

const spanSeconds = (rows) => {
  const ts = rows.map((r) => new Date(r.createTime).getTime()).filter((n) => Number.isFinite(n));
  return ts.length >= 2 ? Math.round((Math.max(...ts) - Math.min(...ts)) / 1000) : null;
};

export function detectDuplicateTithes(ctx) {
  const items = attributedTithes(ctx);
  const exact = new Map();
  const monthly = new Map();
  for (const it of items) {
    const { row, profileId } = it;
    const ek = [profileId, accountingDate(row), amountOf(row), row.paymentMethod].join("|");
    const mk = [profileId, row.period, amountOf(row)].join("|");
    if (!exact.has(ek)) exact.set(ek, new Map());
    exact.get(ek).set(row.id, row);
    if (!monthly.has(mk)) monthly.set(mk, new Map());
    monthly.get(mk).set(row.id, row);
  }
  const findings = [];
  const flagged = new Set();
  for (const [key, group] of exact) {
    if (group.size < 2) continue;
    const rows = [...group.values()];
    const [profileId] = key.split("|");
    rows.forEach((r) => flagged.add(r.id));
    const gap = spanSeconds(rows);
    findings.push(
      finding(
        "TITHE_DUPLICATE_EXACT",
        LEVELS.REVIEW,
        `Posible diezmo duplicado: ${rows.length} diezmos de ${clp(amountOf(rows[0]))} del mismo perfil (${shortId(profileId)}), misma fecha ${accountingDate(rows[0])} y mismo medio (${rows[0].paymentMethod})${gap != null ? `, registrados con ${gap} s de diferencia` : ""}. Confirmar con Tesorería si son dos aportes reales.`,
        { profile: shortId(profileId), date: accountingDate(rows[0]), amount: amountOf(rows[0]), paymentMethod: rows[0].paymentMethod, count: rows.length, ids: rows.map((r) => shortId(r.id)), createdSpanSeconds: gap },
        rows.map((r) => r.id),
      ),
    );
  }
  for (const [key, group] of monthly) {
    if (group.size < 2) continue;
    const rows = [...group.values()];
    if (rows.every((r) => flagged.has(r.id))) continue;
    const [profileId, period] = key.split("|");
    findings.push(
      finding(
        "TITHE_REPEAT_MONTH",
        LEVELS.INFO,
        `Mismo perfil (${shortId(profileId)}) con ${rows.length} diezmos de ${clp(amountOf(rows[0]))} en ${period} en fechas distintas (${[...new Set(rows.map(accountingDate))].sort().join(", ")}). Suele ser legítimo (aporte semanal).`,
        { profile: shortId(profileId), period, amount: amountOf(rows[0]), count: rows.length, ids: rows.map((r) => shortId(r.id)) },
        rows.map((r) => r.id),
      ),
    );
  }
  return findings;
}
