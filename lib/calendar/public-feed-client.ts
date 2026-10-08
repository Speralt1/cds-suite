// Cliente del calendario público (18a §E.1, §E.4, §F; doc 20 §5). Sin Firebase
// SDK: un POST same-origin a `/api/calendario-publico` (rewrite de Hosting a la
// Function `calendarPublicFeed`) o, en desarrollo con emuladores, directo al
// emulador de Functions. No hay variables de entorno nuevas.
//
// - El enlace compartido lleva el token en el FRAGMENTO (`/calendario-publico#<token>`):
//   el navegador no lo envía al servidor ni en el Referer. La página lo lee de
//   `location.hash` y lo manda en el cuerpo JSON del POST, nunca en la URL.
//   No se guarda en localStorage, cookies ni analítica.
// - Un token mal formado NUNCA se envía: se responde "unavailable" sin red.
// - 404 → "unavailable" (inexistente, desactivado o mal formado son idénticos).
// - Error de red, 5xx o respuesta inesperada → lanza PublicFeedError (la
//   página ofrece "Reintentar").

import { isWellFormedShareToken } from "@/lib/shared/share-token-format";
import type { PublicCalendar } from "@/lib/shared/types";

export const PUBLIC_FEED_PATH = "/api/calendario-publico";
export const PUBLIC_FEED_FUNCTION = "calendarPublicFeed";
export const PUBLIC_FEED_REGION = "southamerica-west1";
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

/** URL del feed (sin query: el token va en el cuerpo). */
export function calendarFeedUrl(env: PublicFeedEnv = currentFeedEnv()): string {
  if (usesFunctionsEmulator(env)) {
    return `http://127.0.0.1:5001/${env.projectId}/${PUBLIC_FEED_REGION}/${PUBLIC_FEED_FUNCTION}`;
  }
  return PUBLIC_FEED_PATH;
}

/**
 * Enlace público para compartir, igual en producción y en desarrollo:
 * `${origin}/calendario-publico#${token}`. El fragmento no viaja al servidor.
 */
export function publicCalendarUrl(token: string, origin?: string): string {
  const base = (origin ?? (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  return `${base}${PUBLIC_PAGE_PATH}#${encodeURIComponent(token)}`;
}

/**
 * Token presentado en el fragmento de la URL (`#<token>`). Devuelve el texto
 * tal cual (la validación es aparte). La ruta y la query se ignoran: un token
 * en `?t=` no se acepta.
 */
export function shareTokenFromLocation(loc: { hash: string }): string | null {
  const raw = typeof loc.hash === "string" ? loc.hash.replace(/^#/, "") : "";
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
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
  let res: Pick<Response, "status" | "ok" | "json">;
  try {
    res = await doFetch(calendarFeedUrl(options.env), {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
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
