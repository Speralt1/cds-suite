// Detector: diezmos duplicados (gap d) e integridad de atribuciones. Puro.
//  - mismo perfil (o perfiles gemelos con el mismo nombre normalizado) + misma fecha
//    contable + mismo monto + mismo medio de pago                         → REVISAR
//  - mismo perfil/gemelos + mismo monto en el mismo mes (fechas distintas) → INFORMATIVO
//  - diezmo activo con 0 o ≥ 2 atribuciones activas                       → REVISAR
import { LEVELS, accountingDate, amountOf, clp, finding, identityKey, isActive, shortId } from "../lib/util.mjs";

const activeAttribution = (a) => !a.status || a.status === "active";

const spanSeconds = (rows) => {
  const ts = rows.map((r) => new Date(r.createTime).getTime()).filter((n) => Number.isFinite(n));
  return ts.length >= 2 ? Math.round((Math.max(...ts) - Math.min(...ts)) / 1000) : null;
};

export function detectDuplicateTithes(ctx) {
  const tithes = new Map(ctx.snapshot.ledger.filter((t) => isActive(t) && t.source === "tithe").map((t) => [t.id, t]));
  // Perfiles gemelos (misma clave de identidad) se agrupan: un duplicado repartido
  // entre dos fichas de la misma familia también se detecta.
  const identity = new Map(ctx.snapshot.profiles.map((p) => [p.id, identityKey(p.displayName)]));
  const groupOf = (profileId) => (identity.get(profileId) ? `k:${identity.get(profileId)}` : `p:${profileId}`);

  const perTithe = new Map();
  const exact = new Map();
  const monthly = new Map();
  for (const a of ctx.snapshot.attributions) {
    if (!activeAttribution(a)) continue;
    const row = tithes.get(a.transactionId);
    if (!row) continue;
    perTithe.set(row.id, (perTithe.get(row.id) || 0) + 1);
    const g = groupOf(a.profileId);
    const ek = [g, accountingDate(row), amountOf(row), row.paymentMethod].join("|");
    const mk = [g, row.period, amountOf(row)].join("|");
    if (!exact.has(ek)) exact.set(ek, new Map());
    exact.get(ek).set(row.id, { row, profileId: a.profileId });
    if (!monthly.has(mk)) monthly.set(mk, new Map());
    monthly.get(mk).set(row.id, { row, profileId: a.profileId });
  }

  const findings = [];
  const flagged = new Set();
  for (const group of exact.values()) {
    if (group.size < 2) continue;
    const items = [...group.values()];
    const rows = items.map((i) => i.row);
    const profiles = [...new Set(items.map((i) => i.profileId))];
    rows.forEach((r) => flagged.add(r.id));
    const gap = spanSeconds(rows);
    const who =
      profiles.length > 1
        ? `perfiles gemelos con el mismo nombre normalizado (${profiles.map(shortId).join(", ")})`
        : `el mismo perfil (${shortId(profiles[0])})`;
    findings.push(
      finding(
        "TITHE_DUPLICATE_EXACT",
        LEVELS.REVIEW,
        `Posible diezmo duplicado: ${rows.length} diezmos de ${clp(amountOf(rows[0]))} de ${who}, misma fecha ${accountingDate(rows[0])} y mismo medio (${rows[0].paymentMethod})${gap != null ? `, registrados con ${gap} s de diferencia` : ""}. Confirmar con Tesorería si son dos aportes reales.`,
        {
          profiles: profiles.map(shortId),
          twinProfiles: profiles.length > 1,
          date: accountingDate(rows[0]),
          amount: amountOf(rows[0]),
          paymentMethod: rows[0].paymentMethod,
          count: rows.length,
          ids: rows.map((r) => shortId(r.id)),
          createdSpanSeconds: gap,
        },
        rows.map((r) => r.id),
      ),
    );
  }
  for (const [key, group] of monthly) {
    if (group.size < 2) continue;
    const items = [...group.values()];
    const rows = items.map((i) => i.row);
    if (rows.every((r) => flagged.has(r.id))) continue;
    const period = key.split("|")[1];
    const profiles = [...new Set(items.map((i) => i.profileId))];
    findings.push(
      finding(
        "TITHE_REPEAT_MONTH",
        LEVELS.INFO,
        `Mismo perfil${profiles.length > 1 ? " (o perfiles gemelos)" : ""} (${profiles.map(shortId).join(", ")}) con ${rows.length} diezmos de ${clp(amountOf(rows[0]))} en ${period} en fechas distintas (${[...new Set(rows.map(accountingDate))].sort().join(", ")}). Suele ser legítimo (aporte semanal).`,
        { profiles: profiles.map(shortId), period, amount: amountOf(rows[0]), count: rows.length, ids: rows.map((r) => shortId(r.id)) },
        rows.map((r) => r.id),
      ),
    );
  }

  const orphan = [...tithes.values()].filter((t) => !perTithe.get(t.id));
  const multi = [...tithes.values()].filter((t) => (perTithe.get(t.id) || 0) >= 2);
  if (orphan.length || multi.length) {
    const bad = [...orphan, ...multi];
    findings.push(
      finding(
        "TITHE_ATTRIBUTION_INTEGRITY",
        LEVELS.REVIEW,
        `Integridad de atribuciones: ${orphan.length} diezmo(s) activo(s) sin atribución activa y ${multi.length} con 2 o más atribuciones activas (${clp(bad.reduce((a, t) => a + amountOf(t), 0))}). Cada diezmo activo debe tener exactamente una.`,
        { withoutAttribution: orphan.map((t) => shortId(t.id)), multipleAttributions: multi.map((t) => shortId(t.id)) },
        bad.map((t) => t.id),
      ),
    );
  }
  return findings;
}
