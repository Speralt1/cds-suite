// Saldo bancario estimado (doc 30): modelo de datos, constantes y validaciones
// PURAS (sin Firebase, sin React, sin reloj). Las reglas de Firestore validan lo
// mismo en el servidor (firestore.rules, sección "Banco y caja").

/** Fecha local de pared America/Santiago, "YYYY-MM-DD". */
export type Ymd = string;

export const DEFAULT_BANK_ACCOUNT_ID = "main";
export const DEFAULT_BANK_ACCOUNT_NAME = "Cuenta corriente principal";
/** Mismo tope que MAX_AMOUNT de constants.ts y money() de las reglas. */
export const BANK_MAX_AMOUNT = 1_000_000_000_000;
/** Fecha de corte mínima aceptada (las reglas exigen lo mismo). */
export const BANK_MIN_OPENING_DATE = "2020-01-01";
export const ADJUSTMENT_REASON_MIN = 10;
export const VOID_REASON_MIN = 3;
export const TEXT_MAX = 300;

export type TreasuryType =
  | "cash_deposit"
  | "cash_withdrawal"
  | "outgoing_transfer"
  | "other_deposit"
  | "adjustment";
export type TreasuryDirection = "in" | "out";

export const TREASURY_TYPES: readonly TreasuryType[] = [
  "cash_deposit",
  "cash_withdrawal",
  "outgoing_transfer",
  "other_deposit",
  "adjustment",
];

export const TREASURY_LABELS: Readonly<Record<TreasuryType, string>> = {
  cash_deposit: "Depósito de efectivo (caja → banco)",
  cash_withdrawal: "Retiro a caja (banco → caja)",
  outgoing_transfer: "Transferencia saliente que no es gasto",
  other_deposit: "Abono al banco que no es ingreso",
  adjustment: "Ajuste manual conciliado",
};

export const TREASURY_HELP: Readonly<Record<TreasuryType, string>> = {
  cash_deposit: "Efectivo de la caja que se depositó en la cuenta. Baja la caja y sube el banco.",
  cash_withdrawal: "Dinero que se sacó del banco para tenerlo en caja. Baja el banco y sube la caja.",
  outgoing_transfer:
    "Sale del banco sin ser un gasto (por ejemplo, traspaso a otra cuenta propia). No cambia el resultado contable.",
  other_deposit:
    "Entra al banco sin ser un ingreso (por ejemplo, traspaso desde otra cuenta propia). No cambia el resultado contable.",
  adjustment:
    "Corrección explícita tras comparar con la cartola. Exige un motivo de al menos 10 caracteres.",
};

/** Sentido fijo de cada tipo; el ajuste lo elige quien lo registra. */
export const TREASURY_FIXED_DIRECTION: Readonly<Partial<Record<TreasuryType, TreasuryDirection>>> = {
  cash_deposit: "in",
  other_deposit: "in",
  cash_withdrawal: "out",
  outgoing_transfer: "out",
};

export function directionFor(type: TreasuryType, chosen?: TreasuryDirection): TreasuryDirection | null {
  const fixed = TREASURY_FIXED_DIRECTION[type];
  if (fixed) return fixed;
  return chosen === "in" || chosen === "out" ? chosen : null;
}

const YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** "YYYY-MM-DD" con día real del calendario. */
export function isYmd(value: unknown): value is Ymd {
  if (typeof value !== "string" || !YMD_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Fecha local de un movimiento del libro: period ("YYYY-MM") + day ("1".."31"). */
export function ledgerLocalDate(period: unknown, day: unknown): Ymd | null {
  if (typeof period !== "string" || typeof day !== "string") return null;
  if (!/^\d{4}-\d{2}$/.test(period) || !/^([1-9]|[12]\d|3[01])$/.test(day)) return null;
  const value = `${period}-${day.padStart(2, "0")}`;
  return isYmd(value) ? value : null;
}

export function isSafeAmount(value: unknown, { allowNegative = false, allowZero = false } = {}): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;
  if (Math.abs(value) > BANK_MAX_AMOUNT) return false;
  if (value < 0) return allowNegative;
  if (value === 0) return allowZero || allowNegative;
  return true;
}

/** Parse de monto CLP escrito por una persona ("1.250.000", "-35000"). Sin decimales. */
export function parseClpInput(raw: string): number | null {
  const text = raw.trim().replace(/\s|\$/g, "");
  if (!text) return null;
  if (!/^-?\d{1,3}(\.\d{3})*$|^-?\d+$/.test(text)) return null;
  const value = Number(text.replace(/\./g, ""));
  return Number.isSafeInteger(value) ? value : null;
}

// ── Documentos ────────────────────────────────────────────────────────────

export interface BankAccountInput {
  name: string;
  /** Saldo según cartola al CIERRE de openingDate (CLP entero; puede ser negativo: sobregiro). */
  openingBalance: number;
  openingDate: Ymd;
  /** Efectivo contado en caja al cierre de openingDate (opcional, ≥ 0). */
  openingCash: number | null;
  statementReference: string;
}

export interface TreasuryInput {
  accountId: string;
  type: TreasuryType;
  direction: TreasuryDirection;
  amount: number;
  date: Ymd;
  note: string;
  reason: string;
}

export interface ReconciliationInput {
  accountId: string;
  date: Ymd;
  reportedBalance: number;
  expectedBalance: number;
  estimateComplete: boolean;
  openingRevision: number;
  note: string;
}

export function validateBankAccountInput(
  input: BankAccountInput,
  opts: { today: Ymd; reason?: string; isUpdate?: boolean },
): string | null {
  if (!input.name.trim() || input.name.trim().length > 80)
    return "El nombre de la cuenta es obligatorio y admite hasta 80 caracteres.";
  if (!isSafeAmount(input.openingBalance, { allowNegative: true }))
    return "Ingresa el saldo de la cartola como un monto entero en pesos, sin decimales.";
  if (!isYmd(input.openingDate)) return "Selecciona una fecha de corte válida.";
  if (input.openingDate < BANK_MIN_OPENING_DATE) return "La fecha de corte no puede ser anterior a 2020.";
  if (input.openingDate > opts.today) return "La fecha de corte no puede estar en el futuro.";
  if (input.openingCash !== null && !isSafeAmount(input.openingCash, { allowZero: true }))
    return "El efectivo inicial debe ser un monto entero de 0 o más pesos.";
  if (input.statementReference.length > 120) return "La referencia de la cartola admite hasta 120 caracteres.";
  const reason = (opts.reason ?? "").trim();
  if (opts.isUpdate && reason.length < VOID_REASON_MIN)
    return "Escribe el motivo del cambio (al menos 3 caracteres).";
  if (reason.length > TEXT_MAX) return "El motivo admite hasta 300 caracteres.";
  return null;
}

export function validateTreasuryInput(
  input: TreasuryInput,
  opts: { today: Ymd; openingDate: Ymd | null },
): string | null {
  if (!TREASURY_TYPES.includes(input.type)) return "Selecciona el tipo de movimiento.";
  const direction = directionFor(input.type, input.direction);
  if (!direction || direction !== input.direction) return "Indica si el ajuste suma o resta al banco.";
  if (!isSafeAmount(input.amount)) return "Ingresa un monto entero mayor que cero, sin decimales.";
  if (!isYmd(input.date)) return "Selecciona una fecha válida.";
  if (!opts.openingDate) return "Primero se debe configurar el saldo inicial de la cuenta.";
  if (input.date <= opts.openingDate)
    return "La fecha debe ser posterior a la fecha de corte del saldo inicial (ese día ya está en la cartola).";
  if (input.date > opts.today) return "La fecha no puede estar en el futuro.";
  if (input.note.length > TEXT_MAX) return "La nota admite hasta 300 caracteres.";
  const reason = input.reason.trim();
  if (input.type === "adjustment" && reason.length < ADJUSTMENT_REASON_MIN)
    return "Un ajuste manual exige un motivo de al menos 10 caracteres.";
  if (reason.length > TEXT_MAX) return "El motivo admite hasta 300 caracteres.";
  return null;
}

export function validateReconciliationInput(
  input: ReconciliationInput,
  opts: { today: Ymd; openingDate: Ymd | null },
): string | null {
  if (!opts.openingDate) return "Primero se debe configurar el saldo inicial de la cuenta.";
  if (!isYmd(input.date)) return "Selecciona una fecha válida.";
  if (input.date < opts.openingDate) return "La fecha no puede ser anterior a la fecha de corte.";
  if (input.date > opts.today) return "La fecha no puede estar en el futuro.";
  if (!isSafeAmount(input.reportedBalance, { allowNegative: true }))
    return "Ingresa el saldo que muestra el banco como un monto entero en pesos.";
  if (!isSafeAmount(input.expectedBalance, { allowNegative: true }))
    return "No hay un saldo estimado válido para comparar.";
  if (input.note.length > 500) return "La nota admite hasta 500 caracteres.";
  return null;
}
