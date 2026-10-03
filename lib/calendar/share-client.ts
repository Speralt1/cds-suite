"use client";

// Cliente del callable `calendarShareLinkManage` (18a §E.2). El enlace en claro
// existe SOLO en la respuesta de create/regenerate: quien llama lo guarda en el
// estado del componente, nunca en storage ni en logs.

import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase";
import { calendarErrorMessage, errorKey } from "./errors";

export const SHARE_CALLABLE = "calendarShareLinkManage";

export type ShareLinkAction = "status" | "create" | "regenerate" | "activate" | "deactivate";

export interface ShareLinkStatus {
  exists: boolean;
  active: boolean;
  /** ISO 8601 o null. */
  createdAt: string | null;
  regeneratedAt: string | null;
  disabledAt: string | null;
}

export interface ShareLinkResult {
  status: ShareLinkStatus;
  /** Solo en create/regenerate. */
  token?: string;
}

/** Claves `share/*` de la Function → español. */
export const SHARE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "share/unauthenticated": "Tu sesión expiró. Vuelve a iniciar sesión.",
  "share/forbidden": "No tienes permiso para administrar el enlace compartido. Si cambiaron tus permisos, recarga la página.",
  "share/invalid-action": "No pudimos completar la acción. Recarga la página e inténtalo de nuevo.",
  "share/not-found": "Aún no hay un enlace para compartir. Recarga la página.",
  "share/already-exists": "Ya existe un enlace. Recarga la página para ver su estado.",
  "share/internal": "Algo salió mal. Inténtalo de nuevo en unos minutos.",
};

export function shareErrorMessage(error: unknown): string {
  return SHARE_ERROR_MESSAGES[errorKey(error)] ?? calendarErrorMessage(error, "share");
}

function normalizeStatus(raw: unknown): ShareLinkStatus {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const iso = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    exists: s.exists === true,
    active: s.active === true,
    createdAt: iso(s.createdAt),
    regeneratedAt: iso(s.regeneratedAt),
    disabledAt: iso(s.disabledAt),
  };
}

export async function manageShareLink(action: ShareLinkAction): Promise<ShareLinkResult> {
  const call = httpsCallable<{ action: ShareLinkAction }, { status?: unknown; token?: unknown }>(getFirebaseFunctions(), SHARE_CALLABLE);
  const { data } = await call({ action });
  const result: ShareLinkResult = { status: normalizeStatus(data?.status) };
  if (typeof data?.token === "string" && data.token) result.token = data.token;
  return result;
}

export const getShareLinkStatus = () => manageShareLink("status");
export const createShareLink = () => manageShareLink("create");
export const regenerateShareLink = () => manageShareLink("regenerate");
export const activateShareLink = () => manageShareLink("activate");
export const deactivateShareLink = () => manageShareLink("deactivate");
