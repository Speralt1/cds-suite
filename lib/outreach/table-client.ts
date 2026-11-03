// Cliente de la mesa pública («Ve por los tuyos», doc 40 · H4). Sin Firebase SDK
// ni sesión: POST same-origin a `/api/mesa` (rewrite de Hosting a la callable
// `outreachTableOp`) o, en desarrollo con emuladores, directo al emulador.
//
// - Enlace: `/mesa#<editionId>.<mesa>.<token>`. El token va en el FRAGMENTO: no
//   llega al servidor, a los logs ni al Referer; se manda solo en el cuerpo.
// - Protocolo callable por HTTP: cuerpo `{ data: { op, payload } }`; éxito
//   `{ result }`; error `{ error: { status, message, details } }` con la clave
//   `outreach/...` en `message`.
// - Cada acción de escritura lleva un `requestId` que el llamador conserva para
//   reintentar sin duplicar (la callable es idempotente por requestId).

import { isWellFormedShareToken } from "@/lib/shared/share-token-format";
import { TABLE_MARKS, type TableMark, type TableRow } from "@/lib/shared/outreach-tables";

export const TABLE_OP_PATH = "/api/mesa";
export const TABLE_OP_FUNCTION = "outreachTableOp";
export const TABLE_OP_REGION = "southamerica-west1";
export const TABLE_SESSION_KEY = "cds.mesa.link";

export interface TableLink {
  editionId: string;
  table: number;
  token: string;
}

const EDITION_RE = /^[A-Za-z0-9_-]{1,160}$/;

/** `<editionId>.<mesa>.<token>` (decodificado) → enlace validado, o null. */
export function parseTableLink(raw: string | null | undefined): TableLink | null {
  if (!raw) return null;
  let text = raw.replace(/^#/, "");
  try {
    text = decodeURIComponent(text);
  } catch {
    return null;
  }
  const parts = text.split(".");
  if (parts.length !== 3) return null;
  const [editionId, tableText, token] = parts;
  if (!EDITION_RE.test(editionId) || !/^[0-9]{1,2}$/.test(tableText) || !isWellFormedShareToken(token)) return null;
  const table = Number(tableText);
  if (table < 1 || table > 99) return null;
  return { editionId, table, token };
}

export function tableLinkFromLocation(loc: { hash: string }): TableLink | null {
  return parseTableLink(loc.hash);
}

export interface TableEnv {
  nodeEnv?: string;
  useEmulators?: string;
  projectId?: string;
}

export function currentTableEnv(): TableEnv {
  return {
    nodeEnv: process.env.NODE_ENV,
    useEmulators: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  };
}

export function tableOpUrl(env: TableEnv = currentTableEnv()): string {
  if (env.nodeEnv === "development" && env.useEmulators === "true" && !!env.projectId?.startsWith("demo-")) {
    return `http://127.0.0.1:5001/${env.projectId}/${TABLE_OP_REGION}/${TABLE_OP_FUNCTION}`;
  }
  return TABLE_OP_PATH;
}

/** Identificador de reintento (6–64 de [A-Za-z0-9_-]). */
export function newRequestId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return `r${c.randomUUID().replace(/-/g, "")}`;
  let s = "r";
  for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

export type TableErrorKind =
  | "unavailable" // inexistente, mal formado o edición cerrada
  | "revoked"
  | "outside-window"
  | "rate-limited"
  | "other-table"
  | "rejected" // rechazo de dominio (sin permiso, no contactar, no encontrada…)
  | "network"
  | "server";

export interface TableWindow {
  opensAt: string;
  closesAt: string;
}

/** Una persona sentada en esta mesa; `mark` es null si no expresó decisión. */
export interface SeatedRow {
  id: string;
  fullName: string;
  mark: TableMark | null;
}

function toWindow(v: unknown): TableWindow | undefined {
  const w = v as { opensAt?: unknown; closesAt?: unknown } | null | undefined;
  return w && typeof w.opensAt === "string" && typeof w.closesAt === "string" ? { opensAt: w.opensAt, closesAt: w.closesAt } : undefined;
}

export class TableOpError extends Error {
  constructor(
    public readonly kind: TableErrorKind,
    public readonly otherTable?: number,
    public readonly code?: string,
    public readonly window?: TableWindow,
  ) {
    super(`table-op/${kind}`);
    this.name = "TableOpError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "status" | "ok" | "json">>;

export interface TableOpOptions {
  fetch?: FetchLike;
  env?: TableEnv;
}

type Body = { result?: unknown; error?: { status?: unknown; message?: unknown; details?: unknown } };

function kindFromError(status: number, err: NonNullable<Body["error"]> | undefined): TableOpError {
  const code = typeof err?.message === "string" ? err.message : "";
  const details = err?.details as { otherTable?: unknown; window?: unknown } | undefined;
  if (code === "outreach/link-revoked") return new TableOpError("revoked", undefined, code);
  if (code === "outreach/link-out-of-window") return new TableOpError("outside-window", undefined, code, toWindow(details?.window));
  if (code === "outreach/link-unavailable") return new TableOpError("unavailable", undefined, code);
  if (code === "outreach/rate-limited" || status === 429) return new TableOpError("rate-limited", undefined, code);
  if (code === "outreach/otra-mesa") {
    const n = details && typeof details.otherTable === "number" ? details.otherTable : undefined;
    return new TableOpError("other-table", n, code);
  }
  if (status >= 500 || code === "outreach/internal") return new TableOpError("server", undefined, code);
  if (code.startsWith("outreach/")) return new TableOpError("rejected", undefined, code);
  return new TableOpError("server", undefined, code);
}

async function call(link: TableLink, op: string, extra: Record<string, unknown>, options: TableOpOptions): Promise<unknown> {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  let res: Pick<Response, "status" | "ok" | "json">;
  try {
    res = await doFetch(tableOpUrl(options.env), {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ data: { op, payload: { editionId: link.editionId, table: link.table, token: link.token, ...extra } } }),
    });
  } catch {
    throw new TableOpError("network");
  }
  let body: Body | null = null;
  try {
    body = (await res.json()) as Body;
  } catch {
    body = null;
  }
  if (!res.ok) throw kindFromError(res.status, body?.error);
  if (!body || !("result" in body)) throw new TableOpError("server");
  return body.result;
}

export async function tableSearch(link: TableLink, q: string, options: TableOpOptions = {}): Promise<TableRow[]> {
  const out = (await call(link, "search", { q }, options)) as { rows?: unknown };
  if (!out || !Array.isArray(out.rows)) throw new TableOpError("server");
  return out.rows as TableRow[];
}

export async function tableMark(
  link: TableLink,
  input: { registrationId: string; mark: TableMark; personAgreed: boolean; moveHere: boolean; requestId: string },
  options: TableOpOptions = {},
): Promise<void> {
  await call(link, "mark", input, options);
}

/** «Está en mi mesa»: la sienta sin decisión (el permiso viene del sitio). */
export async function tableSeat(
  link: TableLink,
  input: { registrationId: string; moveHere: boolean; requestId: string },
  options: TableOpOptions = {},
): Promise<void> {
  await call(link, "seat", input, options);
}

export async function tableUnmark(
  link: TableLink,
  input: { registrationId: string; requestId: string },
  options: TableOpOptions = {},
): Promise<void> {
  await call(link, "unmark", input, options);
}

export async function tableAddWalkIn(
  link: TableLink,
  input: { fullName: string; phone: string; requestId: string },
  options: TableOpOptions = {},
): Promise<{ row: TableRow | null }> {
  const out = (await call(link, "addWalkIn", input, options)) as { row?: TableRow };
  return { row: out && out.row ? out.row : null };
}

/** «En esta mesa N»: todos los sentados, con su marca o sin ella, para no perderlos al recargar. */
export async function tableListMine(link: TableLink, options: TableOpOptions = {}): Promise<{ items: SeatedRow[]; window: TableWindow | null }> {
  const out = (await call(link, "listMine", {}, options)) as { items?: unknown; window?: unknown };
  if (!out || !Array.isArray(out.items)) throw new TableOpError("server");
  const items = (out.items as Partial<SeatedRow>[]).flatMap((i): SeatedRow[] => {
    if (typeof i.id !== "string" || typeof i.fullName !== "string") return [];
    if (i.mark == null) return [{ id: i.id, fullName: i.fullName, mark: null }];
    return (TABLE_MARKS as readonly string[]).includes(i.mark) ? [{ id: i.id, fullName: i.fullName, mark: i.mark }] : [];
  });
  return { items, window: toWindow(out.window) ?? null };
}
