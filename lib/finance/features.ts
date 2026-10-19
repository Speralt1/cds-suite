// Funcionalidades de Finanzas que se pueden apagar sin borrar código, datos ni
// cálculos. No hay interruptor en la interfaz: para volver a mostrar una, cambiar
// el valor a true aquí y publicar Hosting.
export const FINANCE_FEATURES = {
  /**
   * "Posición de fondos" en /finanzas: tile "Saldo bancario estimado" (doc 30).
   * Apagada por decisión del administrador (18/10/2026). Apagada, la tarjeta no
   * se monta ni consulta saldos ni abonos SumUp; la cuenta bancaria, la
   * conciliación y los movimientos siguen en Configuración y Finanzas.
   */
  fundsPosition: false,
} as const;
