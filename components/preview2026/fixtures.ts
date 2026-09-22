// Datos de ejemplo para el Gate de experiencia visual (Slice 5, incremento 1).
// Ver docs/mission-2026/08-designer-ux-audit-design-lock.md §5.
// NUNCA importar firebase/firestore aquí: este módulo es 100% estático.
import type { MoneyBasis } from "./money-amount";
import type { StatusKey } from "./status-badge";

export type MovementSource = "ofrendas" | "cafeteria";
export type MovementMethod = "efectivo" | "tarjeta" | "transferencia";
export type MovementOrigin = "sumup" | "manual";
export type MovementType = "income" | "expense";

export interface Movement {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  category: string;
  source: MovementSource;
  method: MovementMethod;
  origin: MovementOrigin;
  status: StatusKey;
  amount: number; // + ingreso, − egreso/reembolso
  type: MovementType;
  basis?: MoneyBasis;
  reason?: string;
  duplicateOf?: string;
  createdBy: string;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  before?: string;
  after?: string;
  reason?: string;
  timestamp: string; // ISO datetime
}

export interface Payout {
  id: string;
  date: string;
  account: MovementSource;
  bruto: number;
  reembolsos: number;
  comision: number | null; // null = comisión no disponible
  liquido: number | null;
  deposito: number | null;
  status: StatusKey;
  movementCount: number;
}

export interface Deposit {
  id: string;
  date: string;
  amount: number;
  account: MovementSource | null;
  linkedPayoutId: string | null;
}

export interface CashSession {
  id: string;
  source: MovementSource;
  date: string;
  status: StatusKey;
  openedBy: string;
  openedAt: string;
  fondo: number;
  efectivoMovimientos: number;
  movementCount: number;
  count1?: { by: string; amount: number };
  count2?: { by: string; amount: number };
  contado?: number;
  diferencia?: number;
  motivo?: string;
  reopenedVersion?: number;
  history: AuditEntry[];
}

export const ACCOUNTS = [
  { id: "sumup-ofrendas", label: "SumUp Ofrendas", source: "ofrendas" as const },
  { id: "sumup-cafeteria", label: "SumUp Cafetería", source: "cafeteria" as const },
];

export const SYNC_ERROR = {
  account: "cafeteria" as const,
  message:
    "No se pudo conectar con SumUp Cafetería. Revisa la conexión e inténtalo de nuevo.",
  occurredAt: "2026-09-20T09:14:00.000Z",
};

const NAMES = ["M. Soto", "J. Pérez", "A. Rojas"];

function buildMovements(): Movement[] {
  const list: Movement[] = [];
  let n = 0;
  const add = (m: Omit<Movement, "id">) => {
    n += 1;
    list.push({ id: `mv-${String(n).padStart(3, "0")}`, ...m });
  };

  // Período que cruza el 09/09 (histórico sin separar antes de esa fecha).
  for (let day = 5; day <= 12; day++) {
    const date = `2026-09-${String(day).padStart(2, "0")}`;
    const before0909 = day < 9;
    add({
      date,
      description: "Ofrenda efectivo · culto",
      category: "Ofrendas",
      source: "ofrendas",
      method: "efectivo",
      origin: "manual",
      status: "conciliado",
      amount: 30000 + day * 500,
      type: "income",
      basis: "efectivo",
      createdBy: NAMES[day % NAMES.length],
    });
    add({
      date,
      description: before0909
        ? "Ofrenda tarjeta SumUp (histórico sin separar)"
        : "Ofrenda tarjeta SumUp",
      category: "Ofrendas",
      source: "ofrendas",
      method: "tarjeta",
      origin: "sumup",
      status: day === 9 ? "pendiente" : "conciliado",
      amount: 15000 + day * 300,
      type: "income",
      basis: "bruto",
      createdBy: "system:sumup",
    });
    add({
      date,
      description: "Venta cafetería · tarjeta",
      category: "Cafetería",
      source: "cafeteria",
      method: "tarjeta",
      origin: "sumup",
      status: "conciliado",
      amount: 8000 + day * 200,
      type: "income",
      basis: "bruto",
      createdBy: "system:sumup",
    });
    add({
      date,
      description: "Venta cafetería · efectivo",
      category: "Cafetería",
      source: "cafeteria",
      method: "efectivo",
      origin: "manual",
      status: "conciliado",
      amount: 4000 + day * 100,
      type: "income",
      basis: "efectivo",
      createdBy: NAMES[(day + 1) % NAMES.length],
    });
    add({
      date,
      description: "Compra de insumos cafetería",
      category: "Gastos operativos",
      source: "cafeteria",
      method: "efectivo",
      origin: "manual",
      status: "conciliado",
      amount: -(3000 + day * 50),
      type: "expense",
      createdBy: "A. Rojas",
    });
  }
  // 8 días × 5 = 40 movimientos. Se agregan 5 casos especiales (§5): 45 en total.
  add({
    date: "2026-09-07",
    description: "Ofrenda tarjeta SumUp",
    category: "Ofrendas",
    source: "ofrendas",
    method: "tarjeta",
    origin: "sumup",
    status: "anulado",
    amount: 12000,
    type: "income",
    basis: "bruto",
    reason: "Cobro duplicado registrado por el terminal",
    createdBy: "system:sumup",
  });
  add({
    date: "2026-09-08",
    description: "Venta cafetería · reembolso",
    category: "Cafetería",
    source: "cafeteria",
    method: "tarjeta",
    origin: "sumup",
    status: "reembolsado",
    amount: -5000,
    type: "expense",
    basis: "bruto",
    reason: "Producto no entregado",
    createdBy: "system:sumup",
  });
  const dupBaseId = `mv-${String(n + 1).padStart(3, "0")}`;
  add({
    date: "2026-09-10",
    description: "Venta cafetería · tarjeta",
    category: "Cafetería",
    source: "cafeteria",
    method: "tarjeta",
    origin: "sumup",
    status: "requiere-revision",
    amount: 9500,
    type: "income",
    basis: "bruto",
    createdBy: "system:sumup",
  });
  add({
    date: "2026-09-10",
    description: "Venta cafetería · tarjeta (posible duplicado)",
    category: "Cafetería",
    source: "cafeteria",
    method: "tarjeta",
    origin: "sumup",
    status: "requiere-revision",
    amount: 9500,
    type: "income",
    basis: "bruto",
    duplicateOf: dupBaseId,
    createdBy: "system:sumup",
  });
  add({
    date: "2026-09-21",
    description: "Ofrenda efectivo · culto dom 21",
    category: "Ofrendas",
    source: "ofrendas",
    method: "efectivo",
    origin: "manual",
    status: "con-diferencia",
    amount: 194500,
    type: "income",
    basis: "efectivo",
    reason: "Diferencia detectada en el cierre de caja (ver Caja).",
    createdBy: "M. Soto",
  });
  return list;
}

export const MOVEMENTS: Movement[] = buildMovements();

export const PAYOUTS: Payout[] = [
  {
    id: "po-001",
    date: "2026-09-19",
    account: "ofrendas",
    bruto: 102000,
    reembolsos: -5000,
    comision: -2346,
    liquido: 94654,
    deposito: 94654,
    status: "conciliado",
    movementCount: 18,
  },
  {
    id: "po-002",
    date: "2026-09-20",
    account: "cafeteria",
    bruto: 86400,
    reembolsos: 0,
    comision: -1987,
    liquido: 84413,
    deposito: 80000,
    status: "con-diferencia",
    movementCount: 31,
  },
  {
    id: "po-003",
    date: "2026-09-21",
    account: "ofrendas",
    bruto: 96940,
    reembolsos: 0,
    comision: null,
    liquido: null,
    deposito: null,
    status: "pendiente",
    movementCount: 14,
  },
  {
    id: "po-004",
    date: "2026-09-15",
    account: "cafeteria",
    bruto: 62300,
    reembolsos: -2100,
    comision: -1450,
    liquido: 58750,
    deposito: 58750,
    status: "parcial",
    movementCount: 22,
  },
];

export const DEPOSITS: Deposit[] = [
  { id: "dep-001", date: "2026-09-19", amount: 94654, account: "ofrendas", linkedPayoutId: "po-001" },
  { id: "dep-002", date: "2026-09-22", amount: 80000, account: "cafeteria", linkedPayoutId: "po-002" },
  { id: "dep-003", date: "2026-09-22", amount: 182340, account: null, linkedPayoutId: null },
];

export const CASH_SESSIONS: CashSession[] = [
  {
    id: "caja-ofrendas-2026-09-21",
    source: "ofrendas",
    date: "2026-09-21",
    status: "caja-cerrada-diferencia",
    openedBy: "M. Soto",
    openedAt: "2026-09-21T11:00:00.000Z",
    fondo: 20000,
    efectivoMovimientos: 194500,
    movementCount: 12,
    count1: { by: "M. Soto", amount: 210000 },
    count2: { by: "J. Pérez", amount: 210000 },
    contado: 210000,
    diferencia: -4500,
    motivo: "Faltante — posible vuelto entregado de más en la mesa de bienvenida.",
    history: [
      {
        id: "aud-101",
        actor: "M. Soto",
        action: "Abrió caja",
        after: "Fondo $20.000",
        timestamp: "2026-09-21T11:00:00.000Z",
      },
      {
        id: "aud-102",
        actor: "J. Pérez",
        action: "Cerró caja con diferencia",
        before: "Esperado $214.500",
        after: "Contado $210.000",
        reason: "Faltante — posible vuelto entregado de más en la mesa de bienvenida.",
        timestamp: "2026-09-21T13:42:00.000Z",
      },
    ],
  },
  {
    id: "caja-cafeteria-2026-09-22",
    source: "cafeteria",
    date: "2026-09-22",
    status: "caja-abierta",
    openedBy: "J. Pérez",
    openedAt: "2026-09-22T09:12:00.000Z",
    fondo: 15000,
    efectivoMovimientos: 46200,
    movementCount: 9,
    history: [
      {
        id: "aud-201",
        actor: "J. Pérez",
        action: "Abrió caja",
        after: "Fondo $15.000",
        timestamp: "2026-09-22T09:12:00.000Z",
      },
    ],
  },
  {
    id: "caja-ofrendas-2026-09-14",
    source: "ofrendas",
    date: "2026-09-14",
    status: "caja-reabierta",
    openedBy: "A. Rojas",
    openedAt: "2026-09-14T11:00:00.000Z",
    fondo: 20000,
    efectivoMovimientos: 168000,
    movementCount: 10,
    count1: { by: "A. Rojas", amount: 188000 },
    count2: { by: "M. Soto", amount: 188000 },
    contado: 188000,
    diferencia: 0,
    reopenedVersion: 2,
    history: [
      {
        id: "aud-301",
        actor: "A. Rojas",
        action: "Cerró caja cuadrada",
        after: "Contado $188.000",
        timestamp: "2026-09-14T13:10:00.000Z",
      },
      {
        id: "aud-302",
        actor: "M. Soto (admin)",
        action: "Reabrió caja",
        reason: "Se detectó un movimiento manual mal categorizado tras el cierre.",
        timestamp: "2026-09-15T09:00:00.000Z",
      },
    ],
  },
];

/** Resumen de "Hoy" para la Home (wireframe §3). Ofrendas y Cafetería nunca se suman. */
export const TODAY_SUMMARY = {
  label: "lunes 22 sep",
  ofrendas: {
    efectivoContado: 210000,
    tarjetaBruto: 102000,
    total: 312000,
  },
  cafeteria: { bruto: 86400 },
  diezmos: 450000,
  porRecibir: {
    sumupOfrendasComision: null as number | null, // no disponible
    efectivoADepositar: 205500,
  },
};

export const ACTIVITY_LOG: AuditEntry[] = [
  {
    id: "act-1",
    actor: "M. Soto",
    action: "cerró caja Ofrendas",
    timestamp: "2026-09-22T10:41:00.000Z",
  },
  {
    id: "act-2",
    actor: "Sync SumUp Ofrendas",
    action: "sincronizó 14 pagos",
    timestamp: "2026-09-22T10:02:00.000Z",
  },
  {
    id: "act-3",
    actor: "J. Pérez",
    action: "abrió caja Cafetería",
    timestamp: "2026-09-22T09:12:00.000Z",
  },
];

export const ATTENTION_ITEMS = [
  {
    id: "att-1",
    icon: "diff" as const,
    text: "Diferencia de caja Ofrendas dom 21",
    amount: -4500,
    action: "Explicar",
    href: "/preview/finanzas-2026/caja/cerrar",
  },
  {
    id: "att-2",
    icon: "sync" as const,
    text: "SumUp Cafetería sin sincronizar hace 2 d",
    amount: null,
    action: "Reintentar",
    href: "/preview/finanzas-2026",
  },
  {
    id: "att-3",
    icon: "link" as const,
    text: "Depósito $182.340 sin vincular",
    amount: 182340,
    action: "Vincular",
    href: "/preview/finanzas-2026",
  },
];
