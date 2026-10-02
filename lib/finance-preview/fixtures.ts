// DATOS DE DEMOSTRACIÓN del preview Financial UX 2026.
// Sintéticos: magnitudes plausibles para CDS, pero ninguna cifra ni nombre
// corresponde a datos reales. Generados de forma determinista (semilla fija)
// para que gráficos, tablas y tests sean estables.

import {
  SOURCE,
  type ActivityEvent,
  type AuditEntry,
  type BankDeposit,
  type Campaign,
  type CampaignSubmission,
  type CashSession,
  type DemoTransaction,
  type Integration,
  type MonthAggregate,
  type PaymentMethod,
  type Payout,
  type TitheProfile,
} from "./types";

/** Marcador para verificar que el build por defecto NO publica el preview. */
export const FX_PREVIEW_SENTINEL = "FX_PREVIEW_SENTINEL_V2_7f3a";

/** "Hoy" del preview: domingo 4 de octubre de 2026, 13:30. */
export const DEMO_TODAY = "2026-10-04";
export const DEMO_NOW = "2026-10-04T13:30";

export const DEMO_USER = { name: "Usuario demo", role: "Tesorería" };

// ---------- PRNG determinista ----------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261004);
const pick = <T,>(items: readonly T[]) => items[Math.floor(rng() * items.length)];

/** Divide `total` en montos tomados de `choices`; el último ajusta el exacto. */
function split(total: number, choices: readonly number[]): number[] {
  const out: number[] = [];
  let left = total;
  const max = Math.max(...choices);
  const min = Math.min(...choices);
  while (left > max * 1.5) {
    const v = pick(choices);
    out.push(v);
    left -= v;
  }
  if (left >= min || out.length === 0) out.push(left);
  else out[out.length - 1] += left;
  return out;
}

function minutesToTime(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Horas repartidas dentro de una ventana [from, to] en minutos del día. */
function spreadTimes(n: number, from: number, to: number) {
  return Array.from({ length: n }, (_, i) =>
    minutesToTime(Math.round(from + ((to - from) * (i + rng() * 0.8)) / Math.max(n, 1))),
  );
}

// ---------- Personas de demostración (ficticias) ----------

export const PEOPLE = {
  treasurer: "Marta Soto",
  counter: "Javier Pérez",
  admin: "Andrea Rojas",
  cafeteria: "Lucas Fernández",
  system: "SumUp (automático)",
};

export const TITHE_PROFILES: TitheProfile[] = [
  ["Familia Contreras Vidal", "family"],
  ["Camila Fuentes", "person"],
  ["Familia Muñoz Araya", "family"],
  ["Rodrigo Espinoza", "person"],
  ["Valentina Castro", "person"],
  ["Familia Rojas Tapia", "family"],
  ["Ignacio Herrera", "person"],
  ["Daniela Morales", "person"],
  ["Familia Saavedra León", "family"],
  ["Felipe Navarro", "person"],
  ["Constanza Reyes", "person"],
  ["Familia Valenzuela Soto", "family"],
  ["Tomás Gutiérrez", "person"],
  ["Paula Carrasco", "person"],
  ["Familia Bravo Ortiz", "family"],
  ["Sebastián Pizarro", "person"],
  ["Francisca Salinas", "person"],
  ["Matías Sepúlveda", "person"],
  ["Familia Cárdenas Díaz", "family"],
  ["Antonia Leiva", "person"],
  ["Benjamín Toro", "person"],
  ["Josefa Alarcón", "person"],
  ["Familia Peña Godoy", "family"],
  ["Cristóbal Vera", "person"],
  ["Isidora Fuentealba", "person"],
].map(([name, type], i) => ({
  id: `p${String(i + 1).padStart(2, "0")}`,
  name,
  type: type as TitheProfile["type"],
  active: i !== 23,
}));

// ---------- Movimientos (sep–oct 2026, detalle completo) ----------

const txs: DemoTransaction[] = [];
let seq = 0;
const nextId = (prefix: string) => `${prefix}_${String(++seq).padStart(4, "0")}`;

function add(t: Omit<DemoTransaction, "id" | "status" | "origin" | "source"> &
  Partial<Pick<DemoTransaction, "id" | "status" | "origin" | "source">>) {
  const tx: DemoTransaction = {
    status: "active",
    origin: "manual",
    source: "general",
    id: t.id ?? nextId("mov"),
    ...t,
  };
  txs.push(tx);
  return tx;
}

const CAFE_TICKETS = [1500, 1800, 2200, 2500, 2800, 3200, 3500, 3900, 4500, 5200, 6000, 7400];
const OFFERING_TICKETS = [1000, 2000, 2000, 3000, 5000, 5000, 10000, 10000, 20000];

/** Pagos SumUp de un día: se agrupan en Movimientos por día y categoría. */
function sumUpDay(
  date: string,
  account: "ofrendas" | "cafeteria" | "legacy",
  total: number,
  window: [number, number],
) {
  const tickets = split(total, account === "ofrendas" ? OFFERING_TICKETS : CAFE_TICKETS);
  const times = spreadTimes(tickets.length, window[0], window[1]);
  const category =
    account === "ofrendas" ? SOURCE.ofrendas : account === "cafeteria" ? SOURCE.cafeteria : SOURCE.legacy;
  tickets.forEach((amount, i) =>
    add({
      id: nextId("sumup"),
      type: "income",
      amount,
      date,
      time: times[i],
      category,
      method: "card",
      description: account === "ofrendas" ? "Ofrenda con tarjeta" : "Venta con tarjeta",
      origin: "sumup",
      account,
      createdBy: PEOPLE.system,
    }),
  );
}

function cash(date: string, area: "ofrendas" | "cafeteria", amount: number, time: string, by = PEOPLE.treasurer) {
  return add({
    type: "income",
    amount,
    date,
    time,
    category: area === "ofrendas" ? SOURCE.ofrendas : SOURCE.cafeteria,
    method: "cash",
    description: area === "ofrendas" ? "Efectivo de ofrendas del culto" : "Efectivo de ventas de cafetería",
    createdBy: by,
  });
}

const SUNDAY: [number, number] = [10 * 60 + 20, 13 * 60 + 25];
const WEDNESDAY: [number, number] = [19 * 60 + 15, 21 * 60 + 30];

// Antes del 09/09 SumUp no separaba áreas: todo queda como histórico.
sumUpDay("2026-09-02", "legacy", 318_600, WEDNESDAY);
sumUpDay("2026-09-06", "legacy", 471_900, SUNDAY);
cash("2026-09-02", "ofrendas", 74_000, "21:48");
cash("2026-09-02", "cafeteria", 52_500, "21:52", PEOPLE.cafeteria);
cash("2026-09-06", "ofrendas", 96_000, "13:51");
cash("2026-09-06", "cafeteria", 68_000, "13:58", PEOPLE.cafeteria);

// Desde el 09/09: cuentas separadas.
const AREA_DAYS: Array<{
  date: string;
  win: [number, number];
  ofrSumUp: number;
  ofrCash?: number;
  cafSumUp: number;
  cafCash?: number;
}> = [
  { date: "2026-09-09", win: WEDNESDAY, ofrSumUp: 36_000, ofrCash: 58_000, cafSumUp: 384_600, cafCash: 71_500 },
  { date: "2026-09-13", win: SUNDAY, ofrSumUp: 81_000, ofrCash: 124_000, cafSumUp: 598_200, cafCash: 92_000 },
  { date: "2026-09-16", win: WEDNESDAY, ofrSumUp: 22_000, ofrCash: 47_000, cafSumUp: 296_400, cafCash: 58_000 },
  { date: "2026-09-20", win: SUNDAY, ofrSumUp: 34_000, ofrCash: 88_000, cafSumUp: 617_300, cafCash: 84_500 },
  // 23-09 (miércoles): día de culto sin ningún registro → "Sin registros".
  { date: "2026-09-27", win: SUNDAY, ofrSumUp: 52_000, ofrCash: 210_000, cafSumUp: 486_700, cafCash: 118_000 },
  // 30-09: Cafetería con SumUp y sin efectivo → "Falta efectivo · Cafetería".
  { date: "2026-09-30", win: WEDNESDAY, ofrSumUp: 41_000, ofrCash: 98_000, cafSumUp: 412_300 },
];
for (const d of AREA_DAYS) {
  sumUpDay(d.date, "ofrendas", d.ofrSumUp, d.win);
  sumUpDay(d.date, "cafeteria", d.cafSumUp, d.win);
  const close = d.win === SUNDAY ? "13:55" : "21:50";
  if (d.ofrCash) cash(d.date, "ofrendas", d.ofrCash, close);
  if (d.cafCash) cash(d.date, "cafeteria", d.cafCash, close, PEOPLE.cafeteria);
}

// Reembolso total en SumUp (Cafetería, 20-09): queda anulado por el sistema.
add({
  id: "sumup_refund_0920",
  type: "income",
  amount: 6_500,
  date: "2026-09-20",
  time: "12:41",
  category: SOURCE.cafeteria,
  method: "card",
  description: "Venta con tarjeta",
  origin: "sumup",
  account: "cafeteria",
  status: "voided",
  refund: true,
  createdBy: PEOPLE.system,
  voidedBy: PEOPLE.system,
  voidedAt: "2026-09-22T09:14",
  voidReason: "Reembolsado en SumUp",
});

// Hoy, domingo 04-10, en curso (SumUp Cafetería sincronizó hasta las 11:04).
sumUpDay("2026-10-04", "ofrendas", 64_000, [10 * 60 + 25, 13 * 60 + 2]);
sumUpDay("2026-10-04", "cafeteria", 238_400, [9 * 60 + 20, 11 * 60 + 4]);

// Diezmos: mayoritariamente transferencias, concentrados a inicio de mes.
function tithes(dates: string[], total: number, oddAmount?: number) {
  const base = oddAmount ? total - oddAmount : total;
  const amounts = split(base, [20_000, 30_000, 40_000, 50_000, 60_000, 80_000, 100_000, 120_000, 150_000]);
  if (oddAmount) amounts.splice(Math.floor(amounts.length / 2), 0, oddAmount);
  amounts.forEach((amount, i) => {
    const profile = TITHE_PROFILES[(i * 7 + dates.length) % TITHE_PROFILES.length];
    const method: PaymentMethod = i % 6 === 5 ? "cash" : "transfer";
    add({
      type: "income",
      amount,
      date: dates[i % dates.length],
      time: minutesToTime(9 * 60 + Math.floor(rng() * 600)),
      category: SOURCE.diezmos,
      method,
      description: "Diezmo",
      source: "tithe",
      profileId: profile.id,
      createdBy: i % 2 ? PEOPLE.treasurer : PEOPLE.counter,
    });
  });
}
tithes(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-06", "2026-09-07"], 1_684_000, 76_400);
tithes(["2026-09-09", "2026-09-13", "2026-09-15", "2026-09-20", "2026-09-27", "2026-09-30"], 1_118_000);
tithes(["2026-10-01", "2026-10-02", "2026-10-03"], 1_096_000, 43_750);

// Posible duplicado (TO-BE): mismo diezmo registrado dos veces el 01-10.
const dupA = add({
  type: "income",
  amount: 50_000,
  date: "2026-10-01",
  time: "10:12",
  category: SOURCE.diezmos,
  method: "transfer",
  description: "Diezmo",
  source: "tithe",
  profileId: "p05",
  createdBy: PEOPLE.treasurer,
});
add({
  type: "income",
  amount: 50_000,
  date: "2026-10-01",
  time: "16:40",
  category: SOURCE.diezmos,
  method: "transfer",
  description: "Diezmo",
  source: "tithe",
  profileId: "p05",
  createdBy: PEOPLE.counter,
  possibleDuplicateOf: dupA.id,
});

// Otros ingresos.
add({ type: "income", amount: 150_000, date: "2026-09-28", time: "11:05", category: SOURCE.donaciones, method: "transfer", description: "Donación para ayuda social", createdBy: PEOPLE.treasurer });
add({ type: "income", amount: 84_000, date: "2026-09-19", time: "18:30", category: SOURCE.actividades, method: "cash", description: "Venta de completos · actividad jóvenes", createdBy: PEOPLE.counter });
add({ type: "income", amount: 35_000, date: "2026-10-02", time: "12:20", category: SOURCE.otros, method: "transfer", description: "Arriendo de sala a taller vecinal", createdBy: PEOPLE.treasurer });

// Gastos (desde la última semana de septiembre se registran en CDS).
const expense = (date: string, amount: number, category: string, description: string, method: PaymentMethod = "transfer", time = "11:30") =>
  add({ type: "expense", amount, date, time, category, method, description, createdBy: PEOPLE.treasurer });
expense("2026-09-24", 42_870, "Servicios básicos", "Agua · septiembre");
expense("2026-09-25", 120_000, "Mantención", "Reparación de baño del segundo piso");
expense("2026-09-26", 38_500, "Ministerio Niños", "Materiales escuela dominical", "cash", "17:40");
expense("2026-09-28", 186_300, "Cafetería", "Insumos cafetería · semana 39");
expense("2026-09-29", 96_450, "Servicios básicos", "Electricidad · septiembre");
expense("2026-09-30", 64_990, "Música y Producción", "Cuerdas y cables de audio");
expense("2026-10-01", 168_430, "Servicios básicos", "Internet y telefonía · octubre");
expense("2026-10-02", 214_900, "Cafetería", "Insumos cafetería · semana 40");
expense("2026-10-03", 36_990, "Compras y materiales", "Artículos de aseo");
// Anulado y reemplazado (monto mal ingresado).
add({
  type: "expense",
  amount: 45_000,
  date: "2026-10-02",
  time: "15:10",
  category: "Mantención",
  method: "transfer",
  description: "Gasfitería · cambio de llave de paso",
  status: "voided",
  createdBy: PEOPLE.counter,
  voidedBy: PEOPLE.treasurer,
  voidedAt: "2026-10-02T18:22",
  voidReason: "Monto mal ingresado; se registró nuevamente por $54.000",
});
expense("2026-10-02", 54_000, "Mantención", "Gasfitería · cambio de llave de paso", "transfer", "18:24");

export const TRANSACTIONS: readonly DemoTransaction[] = txs.sort((a, b) =>
  `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`),
);

/** Primer mes con detalle completo en el preview. */
export const DETAIL_FROM = "2026-09";

// ---------- Historia mensual (ene–ago 2026, solo totales) ----------
// Antes de septiembre: SumUp no separaba áreas (todo "histórico"), y casi no
// se registraban diezmos ni gastos en CDS. La historia se muestra así, sin
// maquillarla.

const HISTORY: Array<[string, number, number, number, number, number]> = [
  // period, histórico SumUp, efectivo ofrendas, efectivo cafetería, diezmos, gastos
  ["2026-01", 2_412_300, 318_000, 196_500, 0, 0],
  ["2026-02", 2_188_700, 296_000, 174_000, 0, 0],
  ["2026-03", 2_754_900, 342_000, 221_000, 0, 50_000],
  ["2026-04", 2_903_400, 365_000, 238_500, 0, 0],
  ["2026-05", 2_689_100, 331_000, 209_000, 0, 0],
  ["2026-06", 2_597_800, 312_000, 197_500, 0, 0],
  ["2026-07", 2_846_200, 356_000, 231_000, 0, 0],
  ["2026-08", 2_978_600, 371_000, 246_000, 160_000, 0],
];

export const MONTH_HISTORY: readonly MonthAggregate[] = HISTORY.map(
  ([period, legacy, ofr, caf, diezmos, gastos]) => ({
    period,
    incomeByCategory: <Record<string, number>>{
      [SOURCE.legacy]: legacy,
      [SOURCE.ofrendas]: ofr,
      [SOURCE.cafeteria]: caf,
      ...(diezmos ? { [SOURCE.diezmos]: diezmos } : {}),
    },
    expenseByCategory: (gastos ? { Administración: gastos } : {}) as Record<string, number>,
    incomeByMethod: { card: legacy, cash: ofr + caf, transfer: diezmos, other: 0 },
    count: Math.round(legacy / 3_100) + 18 + (diezmos ? 4 : 0) + (gastos ? 1 : 0),
  }),
);

// ---------- TO-BE: caja (Propuesta) ----------

export const CASH_SESSIONS: readonly CashSession[] = [
  {
    id: "caja-caf-1004",
    area: "cafeteria",
    date: "2026-10-04",
    state: "open",
    openedAt: "2026-10-04T09:12",
    openedBy: PEOPLE.cafeteria,
    float: 20_000,
    expected: 20_000 + 96_500,
    counts: [],
    version: 1,
  },
  {
    id: "caja-ofr-1004",
    area: "ofrendas",
    date: "2026-10-04",
    state: "counting",
    openedAt: "2026-10-04T10:00",
    openedBy: PEOPLE.treasurer,
    counts: [{ by: PEOPLE.treasurer, at: "2026-10-04T13:12", amount: 186_000 }],
    version: 1,
  },
  {
    id: "caja-caf-0930",
    area: "cafeteria",
    date: "2026-09-30",
    state: "missing",
    counts: [],
    version: 1,
  },
  {
    id: "caja-ofr-0930",
    area: "ofrendas",
    date: "2026-09-30",
    state: "deposited",
    openedAt: "2026-09-30T19:00",
    openedBy: PEOPLE.treasurer,
    counts: [
      { by: PEOPLE.treasurer, at: "2026-09-30T21:41", amount: 98_000 },
      { by: PEOPLE.counter, at: "2026-09-30T21:47", amount: 98_000, blind: true },
    ],
    version: 1,
    depositId: "dep-1002-ofr",
    ledgerCash: 98_000,
  },
  {
    id: "caja-ofr-0927",
    area: "ofrendas",
    date: "2026-09-27",
    state: "closed-difference",
    openedAt: "2026-09-27T10:00",
    openedBy: PEOPLE.treasurer,
    counts: [
      { by: PEOPLE.treasurer, at: "2026-09-27T13:30", amount: 214_500 },
      { by: PEOPLE.counter, at: "2026-09-27T13:44", amount: 210_000, blind: true },
    ],
    differenceReason: "Un billete de $5.000 se contó dos veces en el primer conteo; el sobre de $500 quedó fuera.",
    version: 1,
    ledgerCash: 210_000,
  },
  {
    id: "caja-caf-0927",
    area: "cafeteria",
    date: "2026-09-27",
    state: "deposited",
    openedAt: "2026-09-27T09:05",
    openedBy: PEOPLE.cafeteria,
    float: 20_000,
    expected: 138_000,
    counts: [{ by: PEOPLE.cafeteria, at: "2026-09-27T13:50", amount: 138_000 }],
    version: 1,
    depositId: "dep-0929-caf",
    ledgerCash: 118_000,
  },
  {
    id: "caja-caf-0920",
    area: "cafeteria",
    date: "2026-09-20",
    state: "reopened",
    openedAt: "2026-09-20T09:10",
    openedBy: PEOPLE.cafeteria,
    float: 20_000,
    expected: 104_500,
    counts: [{ by: PEOPLE.cafeteria, at: "2026-09-20T13:40", amount: 104_500 }],
    version: 2,
    reopenReason: "Reembolso posterior de $6.500 en SumUp; se revisa si hubo devolución en efectivo.",
    ledgerCash: 84_500,
  },
];

// ---------- TO-BE: payouts y depósitos (Propuesta; comisiones de ejemplo) ----------

export const PAYOUTS: readonly Payout[] = [
  {
    id: "po-1001-ofr",
    account: "ofrendas",
    date: "2026-10-01",
    salesFrom: "2026-09-27",
    salesTo: "2026-09-30",
    salesCount: 14,
    gross: 93_000,
    refunds: 0,
    fee: null,
    depositIds: [],
    state: "pending",
    note: "SumUp aún no informa la comisión de este payout.",
  },
  {
    id: "po-1001-caf",
    account: "cafeteria",
    date: "2026-10-01",
    salesFrom: "2026-09-30",
    salesTo: "2026-09-30",
    salesCount: 118,
    gross: 412_300,
    refunds: 0,
    fee: 9_483,
    depositIds: ["dep-1002-caf-a"],
    state: "partial",
  },
  {
    id: "po-0929-caf",
    account: "cafeteria",
    date: "2026-09-29",
    salesFrom: "2026-09-27",
    salesTo: "2026-09-27",
    salesCount: 141,
    gross: 486_700,
    refunds: 0,
    fee: 11_194,
    depositIds: ["dep-0930-caf"],
    state: "difference",
  },
  {
    id: "po-0922-caf",
    account: "cafeteria",
    date: "2026-09-22",
    salesFrom: "2026-09-20",
    salesTo: "2026-09-20",
    salesCount: 176,
    gross: 623_800,
    refunds: 6_500,
    fee: 14_198,
    depositIds: ["dep-0923-caf"],
    state: "reconciled",
  },
  {
    id: "po-0921-ofr",
    account: "ofrendas",
    date: "2026-09-21",
    salesFrom: "2026-09-16",
    salesTo: "2026-09-20",
    salesCount: 12,
    gross: 56_000,
    refunds: 0,
    fee: 1_288,
    depositIds: ["dep-0922-ofr"],
    state: "reconciled",
  },
];

export const DEPOSITS: readonly BankDeposit[] = [
  { id: "dep-0922-ofr", date: "2026-09-22", amount: 54_712, description: "Abono SumUp", kind: "payout", linkedTo: "po-0921-ofr", linkedBy: PEOPLE.treasurer },
  { id: "dep-0923-caf", date: "2026-09-23", amount: 603_102, description: "Abono SumUp", kind: "payout", linkedTo: "po-0922-caf", linkedBy: PEOPLE.treasurer },
  { id: "dep-0930-caf", date: "2026-09-30", amount: 470_000, description: "Abono SumUp", kind: "payout", linkedTo: "po-0929-caf", linkedBy: PEOPLE.treasurer },
  { id: "dep-1002-caf-a", date: "2026-10-02", amount: 200_000, description: "Abono SumUp (parcial)", kind: "payout", linkedTo: "po-1001-caf", linkedBy: PEOPLE.counter },
  { id: "dep-0929-caf", date: "2026-09-29", amount: 118_000, description: "Depósito efectivo cafetería", kind: "cash", linkedTo: "caja-caf-0927", linkedBy: PEOPLE.cafeteria },
  { id: "dep-1002-ofr", date: "2026-10-02", amount: 98_000, description: "Depósito efectivo ofrendas", kind: "cash", linkedTo: "caja-ofr-0930", linkedBy: PEOPLE.treasurer },
  { id: "dep-0928-unk", date: "2026-09-28", amount: 182_340, description: "Transferencia recibida · sin referencia", kind: "unknown" },
];

// ---------- Integraciones ----------

export const INTEGRATIONS: readonly Integration[] = [
  {
    id: "sumup-ofrendas",
    name: "SumUp Ofrendas",
    state: "ok",
    lastSuccessAt: "2026-10-04T13:04",
    lastAttemptAt: "2026-10-04T13:04",
  },
  {
    id: "sumup-cafeteria",
    name: "SumUp Cafetería",
    state: "error",
    lastSuccessAt: "2026-10-04T11:04",
    lastAttemptAt: "2026-10-04T13:04",
    message:
      "SumUp no respondió en los dos últimos intentos. Reintentamos cada hora; las ventas posteriores a las 11:04 aún no aparecen.",
  },
];

// ---------- Campañas (libro aparte) ----------

export const CAMPAIGNS: readonly Campaign[] = [
  {
    id: "camp-techo",
    name: "Reparación del techo",
    status: "active",
    goal: 1_500_000,
    verified: 890_000,
    installment: { current: 6, total: 12 },
    endsOn: "2027-03-31",
  },
  {
    id: "camp-invierno",
    name: "Ayuda solidaria de invierno",
    status: "closed",
    goal: 600_000,
    verified: 642_000,
    endsOn: "2026-08-31",
  },
];

export const CAMPAIGN_SUBMISSIONS: readonly CampaignSubmission[] = [
  { id: "cs1", campaignId: "camp-techo", donor: "Familia Muñoz Araya", amount: 40_000, date: "2026-10-02", origin: "public", status: "pending" },
  { id: "cs2", campaignId: "camp-techo", donor: "Ignacio Herrera", amount: 30_000, date: "2026-10-02", origin: "public", status: "pending" },
  { id: "cs3", campaignId: "camp-techo", donor: "Anónimo", amount: 25_000, date: "2026-10-03", origin: "public", status: "pending" },
  { id: "cs4", campaignId: "camp-techo", donor: "Paula Carrasco", amount: 50_000, date: "2026-09-29", origin: "manual", status: "approved" },
  { id: "cs5", campaignId: "camp-techo", donor: "Sin nombre", amount: 15_000, date: "2026-09-26", origin: "public", status: "rejected" },
];

// ---------- Actividad reciente ----------

export const ACTIVITY: readonly ActivityEvent[] = [
  { id: "a1", at: "2026-10-04T13:12", actor: PEOPLE.treasurer, text: "Registró el primer conteo de la caja de Ofrendas", amount: 186_000, kind: "cash" },
  { id: "a2", at: "2026-10-04T13:04", actor: "Sistema", text: "SumUp Ofrendas: 9 pagos nuevos sincronizados", kind: "sync" },
  { id: "a3", at: "2026-10-04T13:04", actor: "Sistema", text: "SumUp Cafetería no respondió; se reintentará a las 14:04", kind: "sync" },
  { id: "a4", at: "2026-10-04T09:12", actor: PEOPLE.cafeteria, text: "Abrió la caja de Cafetería con fondo inicial", amount: 20_000, kind: "cash" },
  { id: "a5", at: "2026-10-03T17:02", actor: PEOPLE.treasurer, text: "Registró un gasto: Artículos de aseo", amount: -36_990, kind: "expense" },
  { id: "a6", at: "2026-10-02T18:22", actor: PEOPLE.treasurer, text: "Anuló un gasto de Mantención (monto mal ingresado)", amount: -45_000, kind: "void" },
  { id: "a7", at: "2026-10-02T12:30", actor: PEOPLE.treasurer, text: "Registró el depósito del efectivo de Ofrendas del 30-09", amount: 98_000, kind: "deposit" },
  { id: "a8", at: "2026-10-02T10:15", actor: "Página pública", text: "2 aportes nuevos para Reparación del techo", amount: 70_000, kind: "campaign" },
  { id: "a9", at: "2026-10-01T16:40", actor: PEOPLE.counter, text: "Registró un diezmo por transferencia", amount: 50_000, kind: "tithe" },
];

// ---------- Historial de auditoría de ejemplo (TO-BE) ----------

export function auditFor(tx: DemoTransaction): AuditEntry[] {
  const created: AuditEntry = {
    at: `${tx.date}T${tx.time}`,
    actor: tx.createdBy,
    action: tx.origin === "sumup" ? "Importado desde SumUp" : "Registrado",
  };
  if (tx.status !== "voided") return [created];
  return [
    created,
    {
      at: tx.voidedAt ?? `${tx.date}T${tx.time}`,
      actor: tx.voidedBy ?? "—",
      action: tx.refund ? "Reembolsado en SumUp" : "Anulado",
      detail: tx.voidReason,
    },
  ];
}
