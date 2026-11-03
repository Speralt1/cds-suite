// «Ve por los tuyos» (doc 40/41): interruptores del submódulo. Con `enabled`
// apagado la ruta solo muestra «en preparación»: no hay Rules, Functions ni
// colecciones `outreach*` desplegadas. Encender exige el GO del doc 41 §6.
export const OUTREACH_FEATURES = {
  enabled: false,
  /** Decisiones voluntarias: requiere aprobación de valores, acceso y conservación (Ley 21.719). */
  decisions: false,
  /** Envíos por el motor de mensajería: requiere aprobación de org, número, texto y canario. */
  messaging: false,
} as const;

/**
 * Simulación local para revisar la interfaz con datos ficticios. Solo con
 * NEXT_PUBLIC_CDS_OUTREACH_SIM=1 en desarrollo; check:no-preview verifica que
 * la build productiva no contenga el código de la simulación.
 */
export const OUTREACH_SIM = process.env.NEXT_PUBLIC_CDS_OUTREACH_SIM === "1";

/**
 * Espacio de trabajo en vivo (callables + Firestore reales). Solo con
 * NEXT_PUBLIC_CDS_OUTREACH_LIVE=1 (desarrollo/emulador) o con `enabled`
 * encendido. Sin la variable, next.config lo reemplaza por un módulo vacío.
 */
export const OUTREACH_LIVE = process.env.NEXT_PUBLIC_CDS_OUTREACH_LIVE === "1";

/** Único criterio de empaquetado del espacio en vivo: lo leen la página y next.config.ts. */
export const outreachLiveBundled = (enabled: boolean, live: boolean): boolean => enabled || live;
export const OUTREACH_LIVE_BUNDLED = outreachLiveBundled(OUTREACH_FEATURES.enabled, OUTREACH_LIVE);
