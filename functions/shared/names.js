// GENERADO por scripts/build-shared.mjs desde lib/shared/names.ts — NO EDITAR.
"use strict";
// Normalización de nombres de personas y familias (doc 27).
//
// TS puro y determinista: lo usan el cliente (fichas de diezmo) y, compilado a
// functions/shared/names.js, cualquier Function futura. Está pensado para que
// Consolidación (integrantes) lo reutilice tal cual: no depende de diezmos.
//
// - normalizeName: forma canónica legible ("juan perez").
// - identityKey: clave de identidad ("juan_perez"), apta como id de documento
//   (solo [a-z0-9_], 1..120 caracteres, nunca "." ni "..", nunca "__x__").
//   La usa el registro titheProfileKeys/{key} para impedir fichas duplicadas.
// - nameSimilarity / similarProfiles / duplicateGroups: avisos "nombre similar".
//
// IMPORTANTE: cambiar el algoritmo de identityKey cambia las claves ya
// guardadas. Si alguna vez se cambia, sube NAME_KEY_VERSION y planifica una
// migración del registro (las claves viejas seguirían bloqueando sus nombres).
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SIMILARITY_THRESHOLD = exports.IDENTITY_KEY_RE = exports.IDENTITY_KEY_MAX = exports.NAME_KEY_VERSION = void 0;
exports.normalizeName = normalizeName;
exports.nameTokens = nameTokens;
exports.identityKey = identityKey;
exports.editDistance = editDistance;
exports.nameSimilarity = nameSimilarity;
exports.similarProfiles = similarProfiles;
exports.duplicateGroups = duplicateGroups;
exports.NAME_KEY_VERSION = 1;
exports.IDENTITY_KEY_MAX = 120;
exports.IDENTITY_KEY_RE = /^[a-z0-9_]{1,120}$/;
/** Umbral por defecto de "nombre similar" (0..1). */
exports.DEFAULT_SIMILARITY_THRESHOLD = 0.8;
// Puntuación que se trata como separador de palabras.
const PUNCTUATION = /[.,;:'"´`‘’“”\-‐‑–—_/\\()[\]{}!¡?¿·•&+#*|<>~^=]/g;
// Letras que NFKD no descompone en base + marca.
const FOLD = {
    ß: "ss",
    æ: "ae",
    œ: "oe",
    ø: "o",
    đ: "d",
    ð: "d",
    ł: "l",
    þ: "th",
    ı: "i",
};
/** Minúsculas, sin tildes ni diéresis (ñ → n), puntuación como espacio, espacios colapsados. */
function normalizeName(raw) {
    if (typeof raw !== "string")
        return "";
    return raw
        .toLowerCase()
        .normalize("NFKD")
        .replace(/\p{M}+/gu, "")
        .replace(/[ßæœøđðłþı]/g, (c) => FOLD[c] ?? c)
        .replace(PUNCTUATION, " ")
        .replace(/\s+/g, " ")
        .trim();
}
/** Palabras de solo [a-z0-9] del nombre normalizado (emoji, RTL y otros alfabetos se descartan). */
function nameTokens(raw) {
    return normalizeName(raw)
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean);
}
/**
 * Clave de identidad: palabras unidas por "_", máximo 120 caracteres.
 * "" cuando no queda ninguna letra o dígito latino (el llamador guarda la ficha sin clave).
 */
function identityKey(raw) {
    let key = nameTokens(raw).join("_");
    if (key.length > exports.IDENTITY_KEY_MAX)
        key = key.slice(0, exports.IDENTITY_KEY_MAX).replace(/_+$/, "");
    return exports.IDENTITY_KEY_RE.test(key) ? key : "";
}
/**
 * Distancia de Damerau-Levenshtein (variante "optimal string alignment"):
 * inserción, borrado, sustitución y transposición de dos caracteres vecinos cuestan 1.
 */
function editDistance(a, b) {
    if (a === b)
        return 0;
    if (!a.length)
        return b.length;
    if (!b.length)
        return a.length;
    let prev2 = [];
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
                v = Math.min(v, prev2[j - 2] + 1);
            cur.push(v);
        }
        prev2 = prev;
        prev = cur;
    }
    return prev[b.length];
}
function ratio(a, b) {
    const max = Math.max(a.length, b.length);
    return max ? 1 - editDistance(a, b) / max : 0;
}
/**
 * Similitud en [0, 1] entre dos nombres, sobre sus palabras normalizadas. Es el máximo de:
 *  1. razón de edición (1 − distancia / largo mayor) del nombre completo;
 *  2. la misma razón con las palabras ordenadas y sin repetir ("Pérez Juan" ≈ "Juan Pérez");
 *  3. 0,85 si todas las palabras (≥ 2) del nombre más corto están en el otro
 *     ("Juan Pérez" ⊂ "Juan Pérez Soto").
 * Devuelve 1 solo si las claves de identidad son iguales; 0 si alguno no tiene palabras.
 */
function nameSimilarity(a, b) {
    const ta = nameTokens(a);
    const tb = nameTokens(b);
    if (!ta.length || !tb.length)
        return 0;
    const ka = ta.join(" ");
    const kb = tb.join(" ");
    if (identityKey(a) === identityKey(b))
        return 1;
    const sa = [...new Set(ta)].sort();
    const sb = [...new Set(tb)].sort();
    let score = Math.max(ratio(ka, kb), ratio(sa.join(" "), sb.join(" ")));
    const [small, big] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
    if (small.length >= 2 && small.every((t) => big.includes(t)))
        score = Math.max(score, 0.85);
    // Nunca 1 si las claves difieren: "exacto" queda reservado a la misma clave.
    return Math.min(score, 0.99);
}
/**
 * Fichas cuyo nombre coincide con `candidate`: "exact" (misma clave de identidad) o
 * "similar" (similitud ≥ threshold). Orden: exactas primero, luego por similitud
 * descendente y por nombre. `excludeId` omite la ficha que se está editando.
 */
function similarProfiles(candidate, profiles, threshold = exports.DEFAULT_SIMILARITY_THRESHOLD, excludeId) {
    const key = identityKey(candidate);
    if (!key)
        return [];
    const out = [];
    for (const profile of profiles) {
        if (excludeId && profile.id === excludeId)
            continue;
        if (identityKey(profile.displayName) === key) {
            out.push({ profile, score: 1, reason: "exact" });
            continue;
        }
        const score = nameSimilarity(candidate, profile.displayName);
        if (score >= threshold)
            out.push({ profile, score, reason: "similar" });
    }
    return out.sort((x, y) => (x.reason === y.reason ? 0 : x.reason === "exact" ? -1 : 1) ||
        y.score - x.score ||
        x.profile.displayName.localeCompare(y.profile.displayName, "es"));
}
/**
 * Agrupa fichas con la misma clave de identidad o con nombres similares (unión transitiva).
 * Determinista. Para ~500 fichas descarta pares cuyo largo ya impide llegar al umbral.
 */
function duplicateGroups(profiles, threshold = exports.DEFAULT_SIMILARITY_THRESHOLD) {
    const items = profiles.map((p) => ({ p, key: identityKey(p.displayName) }));
    const parent = items.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const byKey = new Map();
    items.forEach((it, i) => {
        if (!it.key)
            return;
        const first = byKey.get(it.key);
        if (first === undefined)
            byKey.set(it.key, i);
        else
            parent[find(i)] = find(first);
    });
    for (let i = 0; i < items.length; i++) {
        if (!items[i].key)
            continue;
        for (let j = i + 1; j < items.length; j++) {
            const a = items[i].key;
            const b = items[j].key;
            if (!b || a === b)
                continue;
            const longest = Math.max(a.length, b.length);
            // Sin contención posible y con largo demasiado distinto: no llega al umbral.
            if (Math.abs(a.length - b.length) > (1 - threshold) * longest && !a.includes(b) && !b.includes(a))
                continue;
            if (nameSimilarity(items[i].p.displayName, items[j].p.displayName) >= threshold) {
                parent[find(j)] = find(i);
            }
        }
    }
    const groups = new Map();
    items.forEach((_, i) => {
        const root = find(i);
        groups.set(root, [...(groups.get(root) ?? []), i]);
    });
    const out = [];
    for (const members of groups.values()) {
        if (members.length < 2)
            continue;
        const keys = new Set(members.map((i) => items[i].key));
        const reason = keys.size === 1 ? "exact" : "similar";
        out.push({
            reason,
            profiles: members
                .map((i) => items[i].p)
                .sort((x, y) => x.displayName.localeCompare(y.displayName, "es")),
        });
    }
    return out.sort((x, y) => (x.reason === y.reason ? 0 : x.reason === "exact" ? -1 : 1) ||
        x.profiles[0].displayName.localeCompare(y.profiles[0].displayName, "es"));
}
