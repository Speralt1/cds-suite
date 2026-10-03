// Cliente del calendario público (18a §E.1, §E.4, §F). Sin Firebase SDK: un
// GET same-origin a `/api/calendario-publico?t=` (rewrite de Hosting a la
// Function `calendarPublicFeed`) o, en desarrollo con emuladores, directo al
// emulador de Functions. No hay variables de entorno nuevas.
//
// - Un token mal formado NUNCA se envía: se responde "unavailable" sin red.
// - 404 → "unavailable" (inexistente, desactivado o mal formado son idénticos).
// - Error de red, 5xx o respuesta inesperada → lanza PublicFeedError (la
//   página ofrece "Reintentar").

import { isWellFormedShareToken } from "@/lib/shared/share-token-format";
import type { PublicCalendar } from "@/lib/shared/types";

export const PUBLIC_FEED_PATH = "/api/calendario-publico";
export const PUBLIC_FEED_FUNCTION = "calendarPublicFeed";
export const PUBLIC_FEED_REGION = "southamerica-west1";
export const SHARE_PATH_PREFIX = "/calendario/compartir/";
export const PUBLIC_PAGE_PATH = "/calendario-publico";

export interface PublicFeedEnv {
  nodeEnv?: string;
  useEmulators?: string;
  projectId?: string;
}

/** Variables leídas con acceso literal para que Next las incruste en el build. */
export function currentFeedEnv(): PublicFeedEnv {
  return {
    nodeEnv: process.env.NODE_ENV,
    useEmulators: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  };
}

/** Misma guardia que lib/firebase.ts: desarrollo + emuladores + proyecto demo-. */
export function usesFunctionsEmulator(env: PublicFeedEnv = currentFeedEnv()): boolean {
  return env.nodeEnv === "development" && env.useEmulators === "true" && !!env.projectId?.startsWith("demo-");
}

/** URL base del feed (sin query). */
export function calendarFeedUrl(env: PublicFeedEnv = currentFeedEnv()): string {
  if (usesFunctionsEmulator(env)) {
    return `http://127.0.0.1:5001/${env.projectId}/${PUBLIC_FEED_REGION}/${PUBLIC_FEED_FUNCTION}`;
  }
  return PUBLIC_FEED_PATH;
}

/**
 * Enlace público para compartir:
 * producción → `${origin}/calendario/compartir/${token}` (rewrite de Hosting);
 * desarrollo (`next dev`, sin rewrites) → `${origin}/calendario-publico?t=${token}`.
 */
export function publicCalendarUrl(token: string, origin?: string, env: PublicFeedEnv = currentFeedEnv()): string {
  const base = (origin ?? (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  const t = encodeURIComponent(token);
  return env.nodeEnv === "development" ? `${base}${PUBLIC_PAGE_PATH}?t=${t}` : `${base}${SHARE_PATH_PREFIX}${t}`;
}

/**
 * Token presentado en la URL: el último segmento de `/calendario/compartir/<t>`
 * o, si no, `?t=`. Devuelve el texto tal cual (la validación es aparte).
 */
export function shareTokenFromLocation(loc: { pathname: string; search: string }): string | null {
  const path = loc.pathname.replace(/\/+$/, "");
  if (path.startsWith(SHARE_PATH_PREFIX)) {
    const rest = path.slice(SHARE_PATH_PREFIX.length);
    if (!rest || rest.includes("/")) return null;
    try {
      return decodeURIComponent(rest);
    } catch {
      return null;
    }
  }
  const t = new URLSearchParams(loc.search).get("t");
  return t === null ? null : t;
}

export class PublicFeedError extends Error {
  constructor(public readonly kind: "network" | "server" | "invalid") {
    super(`calendar-public-feed/${kind}`);
    this.name = "PublicFeedError";
  }
}

function isPublicCalendar(value: unknown): value is PublicCalendar {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  const range = c.range as Record<string, unknown> | undefined;
  return (
    typeof c.churchName === "string" &&
    typeof c.timeZone === "string" &&
    !!range &&
    typeof range.from === "string" &&
    typeof range.to === "string" &&
    Array.isArray(c.areas) &&
    Array.isArray(c.events)
  );
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "status" | "ok" | "json">>;

/**
 * Lee el calendario público. "unavailable" para token mal formado (sin red) o
 * 404; lanza PublicFeedError si la red falla o la respuesta no es la esperada.
 */
export async function fetchPublicCalendar(
  token: unknown,
  options: { fetch?: FetchLike; env?: PublicFeedEnv } = {},
): Promise<PublicCalendar | "unavailable"> {
  if (!isWellFormedShareToken(token)) return "unavailable";
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const url = `${calendarFeedUrl(options.env)}?t=${encodeURIComponent(token)}`;
  let res: Pick<Response, "status" | "ok" | "json">;
  try {
    res = await doFetch(url, {
      method: "GET",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new PublicFeedError("network");
  }
  if (res.status === 404) return "unavailable";
  if (!res.ok) throw new PublicFeedError("server");
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new PublicFeedError("invalid");
  }
  const b = body as { ok?: unknown; calendar?: unknown } | null;
  if (!b || b.ok !== true || !isPublicCalendar(b.calendar)) throw new PublicFeedError("invalid");
  return b.calendar;
}
