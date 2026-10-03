// Mensajes de error del Calendario en español (es-CL). Nunca muestran códigos
// (`permission-denied`, `unavailable`, `share/…`) ni nombres técnicos.

export type CalendarErrorContext = "load" | "save" | "share";
export type CalendarErrorKind = "permission" | "network" | "other";

/** Código de un error de Firebase (`permission-denied`, `functions/unavailable`…), sin prefijo. */
export function errorCode(error: unknown): string {
  const raw =
    typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  return raw.replace(/^(firestore|functions)\//, "");
}

/** Mensaje crudo (para las claves `share/*` de la Function). Nunca se muestra tal cual. */
export function errorKey(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : "";
}

const NETWORK_CODES = new Set(["unavailable", "deadline-exceeded", "network-request-failed", "cancelled", "resource-exhausted"]);
const PERMISSION_CODES = new Set(["permission-denied", "unauthenticated"]);

export function calendarErrorKind(error: unknown): CalendarErrorKind {
  const code = errorCode(error);
  const key = errorKey(error);
  if (PERMISSION_CODES.has(code) || key === "share/forbidden" || key === "share/unauthenticated") return "permission";
  if (NETWORK_CODES.has(code) || /network|offline/i.test(key)) return "network";
  return "other";
}

export const CALENDAR_ERROR_MESSAGES = {
  loadNetwork: "No pudimos cargar el calendario. Revisa tu conexión e inténtalo de nuevo.",
  loadPermission:
    "Ya no tienes acceso a esta información. Puede que tus permisos hayan cambiado. Recarga la página o pide ayuda al administrador.",
  saveNetwork: "No pudimos guardar la actividad. Revisa tu conexión e inténtalo de nuevo.",
  savePermission:
    "No tienes permiso para guardar esta actividad. Si cambiaron tus áreas o permisos, o alguien la modificó recién, recarga la página.",
  shareNetwork: "No pudimos completar la acción con el enlace. Revisa tu conexión e inténtalo de nuevo.",
  sharePermission: "No tienes permiso para administrar el enlace compartido. Si cambiaron tus permisos, recarga la página.",
  offline: "Sin conexión. Puedes ver lo último que se cargó; para crear o editar necesitas conexión.",
  unexpected: "Algo salió mal. Inténtalo de nuevo en unos minutos.",
} as const;

/** Mensaje en español para un error de lectura, guardado o del enlace compartido. */
export function calendarErrorMessage(error: unknown, context: CalendarErrorContext = "save"): string {
  const kind = calendarErrorKind(error);
  if (context === "load") {
    if (kind === "permission") return CALENDAR_ERROR_MESSAGES.loadPermission;
    return CALENDAR_ERROR_MESSAGES.loadNetwork;
  }
  if (context === "share") {
    if (kind === "permission") return CALENDAR_ERROR_MESSAGES.sharePermission;
    if (kind === "network") return CALENDAR_ERROR_MESSAGES.shareNetwork;
    return CALENDAR_ERROR_MESSAGES.unexpected;
  }
  if (kind === "permission") return CALENDAR_ERROR_MESSAGES.savePermission;
  if (kind === "network") return CALENDAR_ERROR_MESSAGES.saveNetwork;
  return CALENDAR_ERROR_MESSAGES.unexpected;
}
