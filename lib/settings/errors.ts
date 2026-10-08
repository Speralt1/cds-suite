// Mensajes de error de Configuración (18b §5), sin nombres técnicos.

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
}

/** Error al cargar datos (listas de áreas o usuarios). `what` = "las áreas", "los usuarios"… */
export function settingsLoadError(error: unknown, what = "la información"): string {
  const code = errorCode(error);
  if (code.includes("permission-denied"))
    return "Ya no tienes acceso a esta información. Puede que tus permisos hayan cambiado. Recarga la página o pide ayuda al administrador.";
  return `No pudimos cargar ${what}. Revisa tu conexión e inténtalo de nuevo.`;
}

/** Error al guardar. Los errores de validación propios (Error sin código) se muestran tal cual. */
export function settingsSaveError(error: unknown): string {
  const code = errorCode(error);
  if (code.includes("email-already-in-use")) return "Ya existe una cuenta con ese correo.";
  if (code.includes("invalid-email")) return "Ingresa un correo electrónico válido.";
  if (code.includes("too-many-requests")) return "Hubo demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.";
  if (code.includes("permission-denied"))
    return "No tienes permiso para guardar estos cambios. Si cambiaron tus áreas o permisos, recarga la página.";
  if (code.includes("unavailable") || code.includes("deadline") || code.includes("network"))
    return "No pudimos guardar los cambios. Revisa tu conexión e inténtalo de nuevo.";
  if (!code && error instanceof Error && error.message) return error.message;
  return "Algo salió mal. Inténtalo de nuevo en unos minutos.";
}
