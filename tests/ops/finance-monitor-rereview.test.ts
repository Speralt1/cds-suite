// @vitest-environment node
// Monitor A6 (doc 31) · re-revisión Atlas: N-M1 timestamps obligatorios y mutaciones
// system:sumup detectadas por diferencia contra el snapshot previo; MINOR 1 atribuciones
// huérfanas o incoherentes; MINOR 2 closedMonthHumanChanges; NIT 1/2 sin eco de datos.
import { describe, expect, it } from "vitest";
import type { LedgerRow } from "../../scripts/ops/finance-monitor/index.mjs";
import { daysBetween } from "../../scripts/ops/finance-monitor/lib/util.mjs";
import { BASELINE_AT, PREVIOUS_AT, attribute, baselineOf, byCode, codes, nextSeq, row, run, snap, summariesOf } from "./finance-monitor-fixtures";

const onlyInputInvalid = (r: ReturnType<typeof run>) => {
  expect(codes(r.findings)).toEqual(["INPUT_INVALID:STOP"]);
  expect(r.exitCode).toBe(2);
};
const strip = (t: LedgerRow, ...fields: ("createTime" | "updateTime")[]) => {
  const copy = { ...t } as Partial<LedgerRow>;
  for (const f of fields) delete copy[f];
  return copy as LedgerRow;
};

describe("N-M1 · createTime/updateTime obligatorios en todas las filas", () => {
  it.each([["createTime"], ["updateTime"]] as const)("ledger sin %s → INPUT_INVALID", (f) => {
    const t = row();
    onlyInputInvalid(run(snap([strip(t, f)], { previous: { takenAt: PREVIOUS_AT, ledger: [] } })));
  });
  it("previous.ledger y baseline.ledger (lista de filas) sin timestamps → INPUT_INVALID", () => {
    const t = row();
    onlyInputInvalid(run(snap([t], { previous: { takenAt: PREVIOUS_AT, ledger: [strip(t, "createTime", "updateTime")] } })));
    onlyInputInvalid(run(snap([t], { baseline: { takenAt: BASELINE_AT, months: {}, ledger: [strip(t, "updateTime")] } })));
  });
  it("voidedAt sigue siendo opcional", () => {
    const t = row({ status: "voided" });
    expect(run(snap([t, row()])).verdict).toBe("OK");
  });
});

describe("N-M1 · mutaciones system:sumup por diferencia contra el snapshot previo", () => {
  const pos = (p: Partial<LedgerRow> = {}) =>
    row({ id: `sumup_offerings_m${nextSeq()}`, category: "Ofrendas", paymentMethod: "card", amount: 10000, createdBy: "system:sumup", updatedBy: "system:sumup", day: "3", ...p });

  it("repro Atlas: POS 10000 → 1 por system:sumup sin avanzar timestamps, octubre fuera del baseline → REVISAR, no OK", () => {
    const before = pos();
    const after = { ...before, amount: 1 }; // mismos createTime/updateTime/revision que en el snapshot previo
    const r = run(snap([after], { previous: { takenAt: PREVIOUS_AT, ledger: [before] }, baseline: baselineOf([], ["2026-09"]) }));
    const f = byCode(r.findings, "SUMUP_POS_MUTATION");
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe("REVISAR");
    expect(f[0].evidence).toMatchObject({ count: 1, changes: ["amount"] });
    expect(r.verdict).not.toBe("OK");
  });
  it("card → cash por system:sumup cuenta como POS", () => {
    const before = pos();
    const r = run(snap([{ ...before, paymentMethod: "cash" }], { previous: { takenAt: PREVIOUS_AT, ledger: [before] } }));
    expect(byCode(r.findings, "SUMUP_POS_MUTATION")[0].evidence).toMatchObject({ changes: ["paymentMethod"] });
  });
  it("anulación POS por system:sumup sin timestamps nuevos → SUMUP_POS_MUTATION (status) + UNEXPECTED_VOID", () => {
    const before = pos();
    const r = run(snap([{ ...before, status: "voided" }], { previous: { takenAt: PREVIOUS_AT, ledger: [before] } }));
    expect(codes(r.findings)).toEqual(expect.arrayContaining(["SUMUP_POS_MUTATION:REVISAR", "UNEXPECTED_VOID:REVISAR"]));
    expect(byCode(r.findings, "SUMUP_POS_MUTATION")[0].evidence).toMatchObject({ changes: ["status"] });
  });
  it("cash → cash por system:sumup → SUMUP_CASH_MUTATION INFORMATIVO", () => {
    const before = pos({ paymentMethod: "cash" });
    const r = run(snap([{ ...before, amount: 9000 }], { previous: { takenAt: PREVIOUS_AT, ledger: [before] } }));
    expect(byCode(r.findings, "SUMUP_CASH_MUTATION")[0]).toMatchObject({ level: "INFORMATIVO", evidence: { changes: ["amount"] } });
    expect(byCode(r.findings, "SUMUP_POS_MUTATION")).toHaveLength(0);
  });
  it("un doc detectado por ventana y por diferencia aparece una sola vez", () => {
    const before = pos();
    const after = { ...before, amount: 5000, revision: 2, updateTime: "2026-10-13T01:00:00Z" };
    const f = byCode(run(snap([after], { previous: { takenAt: PREVIOUS_AT, ledger: [before] } })).findings, "SUMUP_POS_MUTATION");
    expect(f).toHaveLength(1);
    expect(f[0].evidence).toMatchObject({ count: 1, changes: ["amount+revision"] });
  });
});

describe("MINOR 1 · atribuciones huérfanas o incoherentes → TITHE_ATTRIBUTION_INTEGRITY", () => {
  const tithe = () => row({ source: "tithe", category: "Diezmos", amount: 30000, day: "8" });
  const integrity = (r: ReturnType<typeof run>) => byCode(r.findings, "TITHE_ATTRIBUTION_INTEGRITY")[0];
  it("atribución activa a un movimiento inexistente, anulado o que no es diezmo", () => {
    const ok = tithe();
    const voided = row({ source: "tithe", amount: 1000, day: "2", status: "voided" });
    const general = row({ day: "3" });
    const attributions = [
      ...attribute([ok], "prof-x-000001"),
      { id: "attr-missing-000001", transactionId: "no-existe", profileId: "prof-x-000002", status: "active" },
      { id: "attr-voided-000002", transactionId: voided.id, profileId: "prof-x-000003", status: "active" },
      { id: "attr-general-00003", transactionId: general.id, profileId: "prof-x-000004", status: "active" },
    ];
    const f = integrity(run(snap([ok, voided, general], { attributions })));
    expect(f.level).toBe("REVISAR");
    expect(f.evidence.orphanAttributions).toEqual(["…000001 (sin movimiento)", "…000002 (movimiento anulado)", "…-00003 (movimiento no es diezmo)"]);
  });
  it.each([
    ["monto", { amount: 29000 }, "amount"],
    ["mes", { period: "2026-09" }, "period"],
    ["fecha YYYY-MM-DD", { date: "2026-10-09" }, "date"],
    ["fecha ISO (02:00Z del 8 = día 7 en Santiago)", { date: "2026-10-08T02:00:00Z" }, "date"],
  ])("atribución con %s distinto → REVISAR", (_label, p, field) => {
    const t = tithe();
    const [a] = attribute([t], "prof-y-000001");
    const f = integrity(run(snap([t], { attributions: [{ ...a, ...p }] })));
    expect(f.evidence.mismatchedAttributions).toEqual([expect.stringContaining(`(${field})`)]);
  });
  it("atribución coherente (fecha ISO del mismo día local) → sin hallazgo", () => {
    const t = tithe();
    const [a] = attribute([t], "prof-z-000001");
    const r = run(snap([t], { attributions: [{ ...a, period: "2026-10", date: "2026-10-09T02:30:00Z" }] }));
    expect(integrity(r)).toBeUndefined();
    expect(r.verdict).toBe("OK");
  });
});

describe("MINOR 2 · closedMonthHumanChanges (por defecto revisar)", () => {
  const t = row({ period: "2026-06", day: "3", amount: 70000 });
  const moved = { ...t, period: "2026-05", day: "28", revision: 2, updateTime: "2026-10-05T12:00:00Z" };
  const s = snap([moved], {
    summaries: summariesOf([moved]),
    baseline: { takenAt: BASELINE_AT, months: { ...baselineOf([t], ["2026-06"]).months, "2026-05": summariesOf([])["2026-05"] ?? { incomeTotal: 0, expenseTotal: 0, result: 0, titheTotal: 0, transactionCount: 0 } }, ledger: [t] },
  });
  it("movimiento humano de mes entre meses cerrados con delta explicado → REVISAR por defecto", () => {
    const r = run(s);
    const f = byCode(r.findings, "BASELINE_CLOSED_MONTH_HUMAN_CHANGE");
    expect(f.map((x) => x.evidence.period).sort()).toEqual(["2026-05", "2026-06"]);
    expect(f.every((x) => x.level === "REVISAR")).toBe(true);
  });
  it('con closedMonthHumanChanges: "informativo" → BASELINE_DELTA_EXPLAINED y OK', () => {
    const r = run(s, { closedMonthHumanChanges: "informativo" });
    expect(byCode(r.findings, "BASELINE_DELTA_EXPLAINED")).toHaveLength(2);
    expect(r.verdict).toBe("OK");
  });
  it("las creaciones retroactivas no cuentan como cambio humano de docs existentes", () => {
    const sept = row({ period: "2026-09", day: "6" });
    const late = row({ period: "2026-09", day: "20", createTime: "2026-10-08T14:00:00Z", updateTime: "2026-10-08T14:00:00Z" });
    const r = run(snap([sept, late], { baseline: baselineOf([sept], ["2026-09"]) }, "2026-10-07T00:00:00Z"));
    expect(byCode(r.findings, "BASELINE_DELTA_EXPLAINED")).toHaveLength(1);
    expect(byCode(r.findings, "BASELINE_CLOSED_MONTH_HUMAN_CHANGE")).toHaveLength(0);
  });
  it("valor inválido → INPUT_INVALID", () => {
    onlyInputInvalid(run(s, { closedMonthHumanChanges: "ignorar" as never }));
  });
});

describe("NIT 1/2 · los errores no repiten datos", () => {
  it("INPUT_INVALID de resúmenes usa la posición, nunca la clave ni el valor", () => {
    const ledger = [row()];
    const sums = { ...summariesOf(ledger), "CLAVE-PRIVADA-99": { incomeTotal: "VALOR-PRIVADO-77" } };
    const r = run(snap(ledger, { summaries: sums as never }));
    onlyInputInvalid(r);
    const text = r.findings[0].message + JSON.stringify(r.findings[0].evidence);
    expect(text).not.toContain("CLAVE-PRIVADA");
    expect(text).not.toContain("VALOR-PRIVADO");
    expect(text).toContain("posición 1");
  });
  it("el error de fecha inválida no incluye fragmentos del valor", () => {
    expect(() => daysBetween("9999-99-99-secreto", "2026-01-01")).toThrow(/^fecha inválida \(se esperaba YYYY-MM-DD real\)$/);
  });
});
