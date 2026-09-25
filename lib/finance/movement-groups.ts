import type { Timestamp } from "firebase/firestore";
import { dateLabel } from "./formatters";
import { isSumUpTransaction } from "./insights";
import type { FinanceTransaction } from "./types";

// "Categoría desconocida" nunca debería ocurrir en datos reales (siempre hay
// category), pero una transacción SumUp sin categoría no debe fusionarse en
// una clave `undefined`.
const NO_CATEGORY = "Sin categoría";
const LEGACY_CATEGORY = "SumUp histórico sin separar";

// Orden dentro de un mismo día para los grupos SumUp activos: Ofrendas,
// Cafetería, histórico sin separar y luego el resto alfabéticamente.
const CATEGORY_ORDER = ["Ofrendas", "Cafetería", LEGACY_CATEGORY];

export type MovementEntry =
  | { kind: "single"; key: string; transaction: FinanceTransaction }
  | {
      kind: "sumup-group";
      key: string;
      status: "active" | "voided";
      type: "income" | "expense";
      period: string;
      day: string;
      date: Timestamp;
      category: string;
      items: FinanceTransaction[];
      count: number;
      amount: number;
      label: string;
    };

/**
 * Etiqueta legible de un grupo SumUp a partir de una de sus transacciones.
 * activo: "SumUp · {categoría}"
 * anulado: "SumUp · {categoría} · Anulados o reembolsados en SumUp"
 */
export function sumUpGroupLabel(t: FinanceTransaction): string {
  const category = t.category || NO_CATEGORY;
  return t.status === "voided"
    ? `SumUp · ${category} · Anulados o reembolsados en SumUp`
    : `SumUp · ${category}`;
}

function groupKeyFor(t: FinanceTransaction): string {
  const category = t.category || NO_CATEGORY;
  return `sumup|${t.status}|${t.type}|${t.period}|${t.day}|${category}`;
}

/**
 * Búsqueda de movimientos: `q` vacío coincide con todo. Compara en
 * minúsculas (es) contra la descripción; si la transacción es SumUp,
 * también contra "{label} {fecha}" para poder buscar por el rótulo del
 * grupo o por su fecha aunque esté agrupada.
 */
export function matchesMovementSearch(
  t: FinanceTransaction,
  q: string,
): boolean {
  const needle = q.trim().toLocaleLowerCase("es");
  if (!needle) return true;
  const haystacks = [t.description.toLocaleLowerCase("es")];
  if (isSumUpTransaction(t.id, t.createdBy)) {
    haystacks.push(
      `${sumUpGroupLabel(t)} ${dateLabel(t.date)}`.toLocaleLowerCase("es"),
    );
  }
  return haystacks.some((h) => h.includes(needle));
}

function categoryRank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

function statusRank(entry: MovementEntry): number {
  if (entry.kind === "single") return 2;
  return entry.status === "active" ? 0 : 1;
}

/**
 * Agrupa las transacciones SumUp por día × categoría × estado y deja el
 * resto (manuales, diezmos, etc.) como filas individuales.
 *
 * Orden: por fecha descendente; dentro del mismo día, primero los grupos
 * activos (Ofrendas, Cafetería, histórico y luego el resto alfabético),
 * después los grupos anulados y al final las filas individuales por
 * `createdAt` descendente. Determinista e invariante en la suma de montos.
 */
export function groupMovements(items: FinanceTransaction[]): MovementEntry[] {
  const groups = new Map<
    string,
    {
      status: "active" | "voided";
      type: "income" | "expense";
      period: string;
      day: string;
      date: Timestamp;
      category: string;
      items: FinanceTransaction[];
    }
  >();
  const singles: FinanceTransaction[] = [];

  for (const t of items) {
    if (!isSumUpTransaction(t.id, t.createdBy)) {
      singles.push(t);
      continue;
    }
    const key = groupKeyFor(t);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(t);
    } else {
      groups.set(key, {
        status: t.status,
        type: t.type,
        period: t.period,
        day: t.day,
        date: t.date,
        category: t.category || NO_CATEGORY,
        items: [t],
      });
    }
  }

  const groupEntries: MovementEntry[] = Array.from(groups.entries()).map(
    ([key, g]) => ({
      kind: "sumup-group",
      key,
      status: g.status,
      type: g.type,
      period: g.period,
      day: g.day,
      date: g.date,
      category: g.category,
      items: g.items,
      count: g.items.length,
      amount: g.items.reduce((s, t) => s + t.amount, 0),
      label: sumUpGroupLabel(g.items[0]),
    }),
  );

  const singleEntries: MovementEntry[] = singles.map((t) => ({
    kind: "single",
    key: t.id,
    transaction: t,
  }));

  const entries = [...groupEntries, ...singleEntries];

  function dateMillis(entry: MovementEntry): number {
    return entry.kind === "single"
      ? entry.transaction.date.toMillis()
      : entry.date.toMillis();
  }

  entries.sort((a, b) => {
    const dateDiff = dateMillis(b) - dateMillis(a);
    if (dateDiff !== 0) return dateDiff;

    const rankDiff = statusRank(a) - statusRank(b);
    if (rankDiff !== 0) return rankDiff;

    if (a.kind === "sumup-group" && b.kind === "sumup-group") {
      const catDiff = categoryRank(a.category) - categoryRank(b.category);
      if (catDiff !== 0) return catDiff;
      const alphaDiff = a.category.localeCompare(b.category, "es");
      if (alphaDiff !== 0) return alphaDiff;
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.key.localeCompare(b.key);
    }

    // Both singles: createdAt descendente, y como último desempate el id
    // para que el orden sea siempre determinista.
    if (a.kind === "single" && b.kind === "single") {
      const createdDiff =
        b.transaction.createdAt.toMillis() - a.transaction.createdAt.toMillis();
      if (createdDiff !== 0) return createdDiff;
      return a.transaction.id.localeCompare(b.transaction.id);
    }

    return 0;
  });

  return entries;
}
