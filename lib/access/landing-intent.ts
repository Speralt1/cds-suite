// Intención de aterrizaje (18 §10 R6, 18a §F).
//
// `/` y `/login` conservan `router.replace("/finanzas")` (lo fijan los tests),
// pero antes marcan aquí que el usuario está "entrando". La primera evaluación
// de `RouteGuard` la consume y, si el módulo inicial resuelto no es Finanzas,
// redirige una sola vez (p. ej. Líder → /calendario). Vive solo en memoria:
// una recarga o un deep link a /finanzas no la tienen, así que no redirigen.

let pending = false;

/** Marca que la próxima llegada a /finanzas es un aterrizaje (no un deep link). */
export function markLandingIntent(): void {
  pending = true;
}

/** ¿Hay una intención pendiente? No la consume. */
export function peekLandingIntent(): boolean {
  return pending;
}

/** Devuelve la intención pendiente y la borra (se consume exactamente una vez). */
export function consumeLandingIntent(): boolean {
  const value = pending;
  pending = false;
  return value;
}
