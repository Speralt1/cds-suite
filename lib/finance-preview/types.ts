// Modelo de datos del preview Financial UX 2026.
// Las fechas son strings ISO ("2026-09-30" / "2026-09-30T19:42"), nunca
// Timestamp de Firestore. Todo lo que este archivo describe son DATOS DE
// DEMOSTRACIÓN; los conceptos marcados "TO-BE" no existen hoy en CDS.

export type TxType = "income" | "expense";
export type PaymentMethod = "cash" | "transfer" | "card" | "other";
export type TxStatus = "active" | "voided";
export type Origin = "sumup" | "manual";
export type SumUpAccount = "ofrendas" | "cafeteria";

/** Áreas/fuentes de ingreso tal como las nombra CDS (categorías). */
export const SOURCE = {
  ofrendas: "Ofrendas",
  diezmos: "Diezmos",
  cafeteria: "Cafetería",
  legacy: "SumUp histórico sin separar",
  donaciones: "Donaciones",
  actividades: "Actividades y eventos",
  otros: "Otros ingresos",
} as const;

/** Desde esta fecha SumUp separa Ofrendas y Cafetería (cuentas distintas). */
export const SPLIT_DATE = "2026-09-09";

export interface DemoTransaction {
  id: string;
  type: TxType;
  amount: number;
  /** Día contable, "YYYY-MM-DD". */
  date: string;
  /** Hora local "HH:MM" del registro o del pago. */
  time: string;
  category: string;
  method: PaymentMethod;
  description: string;
  source: "general" | "tithe";
  status: TxStatus;
  origin: Origin;
  /** Solo SumUp: cuenta que cobró. Antes del 09/09 no se distinguía. */
  account?: SumUpAccount | "legacy";
  createdBy: string;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  /** Anulado por un reembolso total en SumUp. */
  refund?: boolean;
  /** Diezmo: ficha asociada. */
  profileId?: string;
  note?: string;
  /** TO-BE: posible duplicado detectado. */
  possibleDuplicateOf?: string;
}

/** Totales mensuales previos al detalle disponible en el preview. */
export interface MonthAggregate {
  period: string; // "2026-03"
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  incomeByMethod: Record<PaymentMethod, number>;
  count: number;
}

// ---------- TO-BE: caja, payouts, depósitos (Propuesta) ----------

export type CashArea = "ofrendas" | "cafeteria";

export type CashSessionState =
  | "open"
  | "counting"
  | "closed-balanced"
  | "closed-difference"
  | "reopened"
  | "deposited"
  | "missing";

export interface CashCount {
  by: string;
  at: string; // ISO con hora
  amount: number;
  blind?: boolean;
}

export interface CashSession {
  id: string;
  area: CashArea;
  date: string;
  state: CashSessionState;
  openedAt?: string;
  openedBy?: string;
  /** Fondo inicial (solo Cafetería). */
  float?: number;
  /** Cafetería: esperado calculado (Propuesta: requiere registrar ventas en efectivo). */
  expected?: number;
  counts: CashCount[];
  differenceReason?: string;
  version: number;
  reopenReason?: string;
  depositId?: string;
  /** Efectivo registrado en el libro para esa área y día (si existe). */
  ledgerCash?: number;
}

export type ReconciliationState =
  | "pending"
  | "partial"
  | "reconciled"
  | "difference"
  | "review";

export interface Payout {
  id: string;
  account: SumUpAccount;
  date: string;
  salesFrom: string;
  salesTo: string;
  salesCount: number;
  gross: number;
  refunds: number;
  /** null = SumUp aún no entrega la comisión (no se inventa). */
  fee: number | null;
  depositIds: string[];
  state: ReconciliationState;
  note?: string;
}

export interface BankDeposit {
  id: string;
  date: string;
  amount: number;
  description: string;
  kind: "payout" | "cash" | "unknown";
  linkedTo?: string;
  linkedBy?: string;
}

// ---------- Integraciones, campañas, diezmos, actividad ----------

export interface Integration {
  id: string;
  name: string;
  state: "ok" | "error";
  lastSuccessAt: string;
  lastAttemptAt: string;
  message?: string;
  paymentsToday?: number;
}

export interface Campaign {
  id: string;
  name: string;
  status: "active" | "closed";
  goal: number;
  verified: number;
  installment?: { current: number; total: number };
  endsOn: string;
}

export interface CampaignSubmission {
  id: string;
  campaignId: string;
  donor: string;
  amount: number;
  date: string;
  origin: "public" | "manual";
  status: "pending" | "approved" | "rejected";
}

export interface TitheProfile {
  id: string;
  name: string;
  type: "person" | "family";
  active: boolean;
}

export interface ActivityEvent {
  id: string;
  at: string; // ISO con hora
  actor: string;
  text: string;
  amount?: number;
  kind: "cash" | "sync" | "tithe" | "expense" | "void" | "campaign" | "deposit";
  /** TO-BE: el evento depende de un concepto que CDS aún no registra (caja, depósito). */
  proposal?: boolean;
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  detail?: string;
}
