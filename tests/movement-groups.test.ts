// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import {
  groupMovements,
  matchesMovementSearch,
  sumUpGroupLabel,
  type MovementEntry,
} from "@/lib/finance/movement-groups";
import { parseDate } from "@/lib/finance/formatters";
import type { FinanceTransaction } from "@/lib/finance/types";

let seq = 0;
function tx(
  partial: Partial<FinanceTransaction> & { day: string; period: string; amount: number },
): FinanceTransaction {
  seq += 1;
  const date = parseDate(`${partial.period}-${partial.day.padStart(2, "0")}`);
  return {
    id: partial.id || `tx_${seq}`,
    type: "income",
    status: "active",
    category: "Ofrendas",
    paymentMethod: "cash",
    description: "",
    source: "general",
    revision: 1,
    createdBy: "user_1",
    createdAt: Timestamp.fromMillis(seq * 1000),
    updatedBy: "user_1",
    updatedAt: Timestamp.fromMillis(seq * 1000),
    date,
    ...partial,
  };
}

function sumUpTx(
  partial: Partial<FinanceTransaction> & { day: string; period: string; amount: number },
): FinanceTransaction {
  return tx({
    paymentMethod: "card",
    createdBy: "system:sumup",
    id: `sumup_${seq + 1}`,
    ...partial,
  });
}

function sumAmounts(items: FinanceTransaction[]) {
  return items.reduce((s, t) => s + t.amount, 0);
}

function sumEntries(entries: MovementEntry[]) {
  return entries.reduce(
    (s, e) => s + (e.kind === "single" ? e.transaction.amount : e.amount),
    0,
  );
}

describe("groupMovements", () => {
  it("31 pagos de Cafetería el mismo día se agrupan en 1 grupo con count y monto exactos", () => {
    const items = Array.from({ length: 31 }, (_, i) =>
      sumUpTx({
        period: "2026-09",
        day: "16",
        category: "Cafetería",
        amount: 1000 + i,
        id: `sumup_cafe_${i}`,
      }),
    );
    const entries = groupMovements(items);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    expect(group.kind).toBe("sumup-group");
    if (group.kind === "sumup-group") {
      expect(group.count).toBe(31);
      expect(group.amount).toBe(sumAmounts(items));
    }
  });

  it("Ofrendas y Cafetería el mismo día producen 2 grupos", () => {
    const items = [
      sumUpTx({ period: "2026-09", day: "16", category: "Ofrendas", amount: 5000 }),
      sumUpTx({ period: "2026-09", day: "16", category: "Cafetería", amount: 7000 }),
    ];
    const entries = groupMovements(items);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === "sumup-group")).toBe(true);
  });

  it("días distintos producen grupos distintos", () => {
    const items = [
      sumUpTx({ period: "2026-09", day: "16", category: "Ofrendas", amount: 5000 }),
      sumUpTx({ period: "2026-09", day: "17", category: "Ofrendas", amount: 5000 }),
    ];
    const entries = groupMovements(items);
    expect(entries).toHaveLength(2);
  });

  it("los anulados forman un grupo aparte del activo, aunque compartan día y categoría", () => {
    const active = sumUpTx({ period: "2026-09", day: "16", category: "Ofrendas", amount: 5000 });
    const voided = sumUpTx({
      period: "2026-09",
      day: "16",
      category: "Ofrendas",
      amount: 3000,
      status: "voided",
      id: "sumup_voided_1",
    });
    const entries = groupMovements([active, voided]);
    expect(entries).toHaveLength(2);
    const [first, second] = entries;
    expect(first.kind).toBe("sumup-group");
    expect(second.kind).toBe("sumup-group");
    if (first.kind === "sumup-group" && second.kind === "sumup-group") {
      expect(first.status).toBe("active");
      expect(second.status).toBe("voided");
      expect(second.label).toContain("Anulados o reembolsados en SumUp");
    }
  });

  it("manuales y diezmos quedan como filas individuales (single)", () => {
    const manual = tx({ period: "2026-09", day: "16", category: "Administración", amount: 10000, type: "expense" });
    const tithe = tx({ period: "2026-09", day: "16", category: "Diezmos", amount: 20000, source: "tithe", paymentMethod: "transfer" });
    const entries = groupMovements([manual, tithe]);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === "single")).toBe(true);
  });

  it("orden intra-día: activos (Ofrendas, Cafetería, histórico, resto alfabético), luego anulados, luego individuales por createdAt desc", () => {
    const other = sumUpTx({ period: "2026-09", day: "16", category: "Zzz", amount: 1000, id: "sumup_z" });
    const legacy = sumUpTx({ period: "2026-09", day: "16", category: "SumUp histórico sin separar", amount: 1000, id: "sumup_legacy" });
    const cafe = sumUpTx({ period: "2026-09", day: "16", category: "Cafetería", amount: 1000, id: "sumup_cafe" });
    const off = sumUpTx({ period: "2026-09", day: "16", category: "Ofrendas", amount: 1000, id: "sumup_off" });
    const voidedOff = sumUpTx({
      period: "2026-09",
      day: "16",
      category: "Ofrendas",
      amount: 500,
      status: "voided",
      id: "sumup_voided_off",
    });
    const single1 = tx({ period: "2026-09", day: "16", amount: 2000, id: "single_1" });
    const single2 = tx({ period: "2026-09", day: "16", amount: 3000, id: "single_2" });
    // single2 created after single1
    single2.createdAt = Timestamp.fromMillis(single1.createdAt.toMillis() + 1000);

    const entries = groupMovements([other, legacy, cafe, off, voidedOff, single1, single2]);
    const describe = entries.map((e) =>
      e.kind === "single" ? `single:${e.transaction.id}` : `group:${e.status}:${e.category}`,
    );
    expect(describe).toEqual([
      "group:active:Ofrendas",
      "group:active:Cafetería",
      "group:active:SumUp histórico sin separar",
      "group:active:Zzz",
      "group:voided:Ofrendas",
      "single:single_2",
      "single:single_1",
    ]);
  });

  it("invariante: la suma de montos de las entradas es igual a la suma de montos de los ítems", () => {
    const items = [
      sumUpTx({ period: "2026-09", day: "16", category: "Ofrendas", amount: 5000 }),
      sumUpTx({ period: "2026-09", day: "16", category: "Cafetería", amount: 7000 }),
      sumUpTx({ period: "2026-09", day: "17", category: "Ofrendas", amount: 4000 }),
      tx({ period: "2026-09", day: "18", amount: 20000, category: "Diezmos", source: "tithe" }),
    ];
    const entries = groupMovements(items);
    expect(sumEntries(entries)).toBe(sumAmounts(items));
  });

  it("es determinista: llamadas repetidas con el mismo input producen el mismo orden", () => {
    const items = [
      sumUpTx({ period: "2026-09", day: "16", category: "Ofrendas", amount: 5000, id: "a" }),
      sumUpTx({ period: "2026-09", day: "16", category: "Cafetería", amount: 7000, id: "b" }),
      tx({ period: "2026-09", day: "18", amount: 20000, id: "c" }),
    ];
    const first = groupMovements(items).map((e) => e.key);
    const second = groupMovements(items).map((e) => e.key);
    expect(second).toEqual(first);
  });
});

describe("matchesMovementSearch", () => {
  it("q vacío coincide con todo", () => {
    const t = tx({ period: "2026-09", day: "16", amount: 1000, description: "cualquier cosa" });
    expect(matchesMovementSearch(t, "")).toBe(true);
    expect(matchesMovementSearch(t, "   ")).toBe(true);
  });

  it("compara en minúsculas contra la descripción", () => {
    const t = tx({ period: "2026-09", day: "16", amount: 1000, description: "Compra de MATERIALES" });
    expect(matchesMovementSearch(t, "materiales")).toBe(true);
    expect(matchesMovementSearch(t, "MATERIALES")).toBe(true);
    expect(matchesMovementSearch(t, "no existe")).toBe(false);
  });

  it("para transacciones SumUp también compara contra label + fecha", () => {
    const t = sumUpTx({ period: "2026-09", day: "16", category: "Ofrendas", amount: 1000, description: "" });
    expect(matchesMovementSearch(t, "sumup")).toBe(true);
    expect(matchesMovementSearch(t, "ofrendas")).toBe(true);
    expect(matchesMovementSearch(t, "16-09-2026")).toBe(true);
  });

  it("no SumUp no coincide por label/fecha si la descripción no lo contiene", () => {
    const t = tx({ period: "2026-09", day: "16", amount: 1000, description: "otra cosa" });
    expect(matchesMovementSearch(t, "16-09-2026")).toBe(false);
  });
});

describe("sumUpGroupLabel", () => {
  it("activo: SumUp · categoría", () => {
    const t = sumUpTx({ period: "2026-09", day: "16", category: "Cafetería", amount: 1000 });
    expect(sumUpGroupLabel(t)).toBe("SumUp · Cafetería");
  });
  it("anulado: SumUp · categoría · Anulados o reembolsados en SumUp", () => {
    const t = sumUpTx({ period: "2026-09", day: "16", category: "Cafetería", amount: 1000, status: "voided" });
    expect(sumUpGroupLabel(t)).toBe("SumUp · Cafetería · Anulados o reembolsados en SumUp");
  });
});
