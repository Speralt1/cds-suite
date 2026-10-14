// Detector: perfiles de diezmo duplicados (gap d). Puro.
//  - misma clave de identidad (nombre normalizado) → REVISAR
//  - nombre similar (similitud ≥ umbral)           → INFORMATIVO
// Nunca imprime nombres: solo ids abreviados y un token de grupo.
import { LEVELS, finding, identityKey, nameSimilarity, shortId } from "../lib/util.mjs";

export function detectDuplicateProfiles(ctx) {
  const threshold = ctx.options.profileSimilarityThreshold;
  const profiles = ctx.snapshot.profiles.map((p) => ({ p, key: identityKey(p.displayName) })).filter((x) => x.key);
  const attributionCount = new Map();
  for (const a of ctx.snapshot.attributions)
    if (!a.status || a.status === "active") attributionCount.set(a.profileId, (attributionCount.get(a.profileId) || 0) + 1);

  const byKey = new Map();
  for (const x of profiles) {
    if (!byKey.has(x.key)) byKey.set(x.key, []);
    byKey.get(x.key).push(x.p);
  }
  const findings = [];
  let group = 0;
  for (const ps of byKey.values()) {
    if (ps.length < 2) continue;
    group++;
    const sorted = [...ps].sort((a, b) => String(a.createTime || "").localeCompare(String(b.createTime || "")));
    findings.push(
      finding(
        "PROFILE_DUPLICATE_NAME",
        LEVELS.REVIEW,
        `Perfiles duplicados (grupo P${group}): ${ps.length} perfiles con el mismo nombre normalizado (${sorted.map((p) => `${shortId(p.id)}${p.active === false ? " inactivo" : ""}, ${attributionCount.get(p.id) || 0} atribución(es)`).join("; ")}). Unificar o desactivar uno con Tesorería.`,
        { group: `P${group}`, count: ps.length, ids: sorted.map((p) => shortId(p.id)), active: sorted.map((p) => p.active !== false), attributions: sorted.map((p) => attributionCount.get(p.id) || 0) },
        ps.map((p) => p.id),
      ),
    );
  }
  // Similares: un representante por clave; pares con claves distintas.
  const reps = [...byKey.entries()].map(([key, ps]) => ({ key, p: ps[0], ids: ps.map((p) => p.id) }));
  for (let i = 0; i < reps.length; i++)
    for (let j = i + 1; j < reps.length; j++) {
      const a = reps[i];
      const b = reps[j];
      const longest = Math.max(a.key.length, b.key.length);
      if (Math.abs(a.key.length - b.key.length) > (1 - threshold) * longest && !a.key.includes(b.key) && !b.key.includes(a.key)) continue;
      const score = nameSimilarity(a.p.displayName, b.p.displayName);
      if (score < threshold) continue;
      group++;
      findings.push(
        finding(
          "PROFILE_SIMILAR_NAME",
          LEVELS.INFO,
          `Perfiles con nombre similar (grupo P${group}, similitud ${score.toFixed(2)}): ${[...a.ids, ...b.ids].map(shortId).join(", ")}. Puede ser la misma persona o familia.`,
          { group: `P${group}`, score: Number(score.toFixed(2)), ids: [...a.ids, ...b.ids].map(shortId) },
          [...a.ids, ...b.ids],
        ),
      );
    }
  return findings;
}
