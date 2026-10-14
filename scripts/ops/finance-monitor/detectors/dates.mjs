// Detectores de fechas (gap c). Puros.
//  - FUTURE_DATED: fecha contable posterior a "hoy" (America/Santiago)          → REVISAR
//  - BACKDATED_ENTRY: creado en un mes posterior a su mes contable (mes cerrado):
//      atraso ≤ backdate.maxLagDays (o reconocido en config)                  → INFORMATIVO
//      atraso mayor                                                            → REVISAR
import { LEVELS, accountingDate, amountOf, clp, daysBetween, finding, isActive, isoAfter, localDate, shortId } from "../lib/util.mjs";

export function detectFutureDated(ctx) {
  const findings = [];
  for (const t of ctx.snapshot.ledger) {
    if (!isActive(t)) continue;
    const date = accountingDate(t);
    if (!date || date <= ctx.today) continue;
    const ahead = daysBetween(ctx.today, date);
    findings.push(
      finding(
        "FUTURE_DATED",
        LEVELS.REVIEW,
        `Movimiento con fecha futura: ${shortId(t.id)} (${t.type === "income" ? "ingreso" : "egreso"}${t.source === "tithe" ? ", diezmo" : ""}, ${clp(amountOf(t))}) fechado ${date}, ${ahead} día(s) después de hoy (${ctx.today}). Verificar la fecha ingresada.`,
        { id: shortId(t.id), date, today: ctx.today, daysAhead: ahead, amount: amountOf(t), source: t.source, actor: t.createdBy === "system:sumup" ? "system:sumup" : "humano" },
        [t.id],
      ),
    );
  }
  return findings;
}

export function detectBackdated(ctx) {
  const maxLag = ctx.options.backdate.maxLagDays;
  const groups = new Map();
  for (const t of ctx.snapshot.ledger) {
    if (!isActive(t) || !t.createTime) continue;
    // Solo lo creado dentro de la ventana observada (si hay una), para no repetir la historia completa.
    if (ctx.since && !isoAfter(t.createTime, ctx.since)) continue;
    const created = localDate(t.createTime, ctx.options.timeZone);
    const date = accountingDate(t);
    if (!created || !date || created.slice(0, 7) <= t.period) continue;
    const lag = daysBetween(date, created);
    const level = lag <= maxLag ? LEVELS.INFO : LEVELS.REVIEW;
    const key = `${t.period}|${level}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ t, lag, created });
  }
  const findings = [];
  for (const [key, items] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [period, level] = key.split("|");
    const lags = items.map((i) => i.lag);
    const total = items.reduce((a, i) => a + amountOf(i.t), 0);
    const tithes = items.filter((i) => i.t.source === "tithe").length;
    const lagText = Math.min(...lags) === Math.max(...lags) ? `${lags[0]} días` : `${Math.min(...lags)}–${Math.max(...lags)} días`;
    findings.push(
      finding(
        level === LEVELS.INFO ? "BACKDATED_ENTRY" : "BACKDATED_ENTRY_LATE",
        level,
        level === LEVELS.INFO
          ? `${items.length} movimiento(s) registrados retroactivamente en el mes cerrado ${period} (${clp(total)}, ${tithes} diezmo(s)) con ${lagText} de atraso, dentro del margen de ${maxLag} días. Cambia el mes cerrado: debe coincidir con el delta del baseline.`
          : `${items.length} movimiento(s) registrados retroactivamente en el mes cerrado ${period} (${clp(total)}, ${tithes} diezmo(s)) con ${lagText} de atraso, más que el margen de ${maxLag} días. Confirmar con Tesorería que la fecha contable es correcta.`,
        { period, count: items.length, total, tithes, minLagDays: Math.min(...lags), maxLagDays: Math.max(...lags), maxAllowedLagDays: maxLag, createdOn: [...new Set(items.map((i) => i.created))].sort(), ids: items.map((i) => shortId(i.t.id)) },
        items.map((i) => i.t.id),
      ),
    );
  }
  return findings;
}
