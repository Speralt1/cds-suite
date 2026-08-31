export const INCOME_CATEGORIES = [
  "Ofrendas",
  "Donaciones",
  "Actividades y eventos",
  "Ayudas / aportes especiales",
  "Otros ingresos",
] as const;
export const EXPENSE_CATEGORIES = [
  "Servicios básicos",
  "Mantención",
  "Compras y materiales",
  "Administración",
  "Ministerio Jóvenes",
  "Ministerio Niños",
  "Música y Producción",
  "Evangelismo",
  "Ayuda social",
  "Eventos",
  "Otros gastos",
] as const;
export const PAYMENT_METHODS = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  other: "Otro",
} as const;
export const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
export const MAX_AMOUNT = 1_000_000_000_000;
export const PAGE_SIZE = 30;
export const MAX_PERIOD_RECORDS = 9999;

// Twelve monthly totals can always be combined without losing a peso.
export const MAX_MONTHLY_TOTAL = Math.floor(Number.MAX_SAFE_INTEGER / 12);
