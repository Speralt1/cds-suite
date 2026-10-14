// @vitest-environment node
// Monitor financiero A6 (doc 31): un caso o más por detector, incluidos los patrones
// reales de incidentes ya anonimizados (ids sintéticos, nombres ficticios, sin PII).
// Los arreglos de la revisión Atlas (M1–M3, MINOR, NIT) están en finance-monitor-hardening.test.ts.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { formatReport, publicFindings, type LedgerRow, type MonitorOptions, type Snapshot } from "../../scripts/ops/finance-monitor/index.mjs";
import { businessDaysBetween, identityKey, localDate, nameSimilarity, normalizeName } from "../../scripts/ops/finance-monitor/lib/util.mjs";
import { main } from "../../scripts/ops/finance-monitor/run.mjs";
import { BASELINE_AT, HUMAN, PREVIOUS_AT, attribute, baselineOf, byCode, codes, nextSeq, row, run, snap, summariesOf } from "./finance-monitor-fixtures";

describe("utilidades (normalización espejo de lib/shared/names.ts, fechas Santiago)", () => {
  it("normaliza nombres: minúsculas, sin tildes, puntuación → espacio, espacios colapsados", () => {
    expect(normalizeName("  José   PÉREZ-Soto. ")).toBe("jose perez soto");
    expect(identityKey("Familia  Muñoz (Ejemplo)")).toBe("familia_munoz_ejemplo");
    expect(nameSimilarity("Familia Ejemplo Uno", "familia ejemplo-uno")).toBe(1);
    expect(nameSimilarity("Ejemplo Uno Prueba", "Ejemplo Uno")).toBeGreaterThanOrEqual(0.8);
  });
  it("calcula la fecha local en America/Santiago y días hábiles", () => {
    expect(localDate("2026-10-13T02:00:00Z")).toBe("2026-10-12");
    expect(localDate("2026-10-13T15:00:00Z")).toBe("2026-10-13");
    expect(businessDaysBetween("2026-10-06", "2026-10-13")).toBe(5);
    expect(businessDaysBetween("2026-10-09", "2026-10-13", ["2026-10-12"])).toBe(1);
  });
});

describe("snapshot sano con cobertura completa", () => {
  it("sin hallazgos REVISAR/STOP → OK, exit 0", () => {
    const ledger = [row(), row({ type: "expense", category: "Luz", amount: 3000, day: "6" })];
    const r = run(snap(ledger));
    expect(r.findings.filter((f) => f.level !== "INFORMATIVO")).toEqual([]);
    expect(r.verdict).toBe("OK");
    expect(r.exitCode).toBe(0);
  });
  it("entrada inválida → STOP (falla cerrada), exit 2", () => {
    const r = run({ takenAt: "2026-10-13T15:00:00Z", ledger: [{ id: 1 }], summaries: {} });
    expect(codes(r.findings)).toEqual(["INPUT_INVALID:STOP"]);
    expect(r.exitCode).toBe(2);
  });
});

describe("fechas futuras", () => {
  it("diezmo fechado +1 día → REVISAR", () => {
    const t = row({ source: "tithe", category: "Diezmos", amount: 50000, day: "14", createTime: "2026-10-13T13:00:00Z", updateTime: "2026-10-13T13:00:00Z" });
    const r = run(snap([t], { attributions: attribute([t], "prof-ejemplo-000009") }));
    const f = byCode(r.findings, "FUTURE_DATED");
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe("REVISAR");
    expect(f[0].evidence).toMatchObject({ date: "2026-10-14", daysAhead: 1, actor: "humano" });
    expect(r.exitCode).toBe(1);
  });
  it("movimiento de hoy o anulado no es futuro", () => {
    const r = run(snap([row({ day: "13" }), row({ day: "20", status: "voided" })]));
    expect(byCode(r.findings, "FUTURE_DATED")).toHaveLength(0);
  });
});

describe("retroactivos en meses cerrados", () => {
  const sept = [row({ period: "2026-09", day: "6", amount: 20000 })];
  const lateTithes = [1, 2, 3].map((i) =>
    row({
      period: "2026-09",
      day: "20",
      source: "tithe",
      category: "Diezmos",
      amount: 30000 + i * 1000,
      createTime: `2026-10-08T14:0${i}:00Z`, // 18 días después del 20/09
      updateTime: `2026-10-08T14:0${i}:00Z`,
    }),
  );
  const attributions = lateTithes.flatMap((t, i) => attribute([t], `prof-ejemplo-00001${i}`));

  it("incidente real: 3 diezmos de septiembre ingresados 18 días tarde, explicados → INFORMATIVO", () => {
    const ledger = [...sept, ...lateTithes];
    const r = run(snap(ledger, { attributions, baseline: baselineOf(sept, ["2026-09"]) }, "2026-10-07T00:00:00Z"));
    const back = byCode(r.findings, "BACKDATED_ENTRY");
    expect(back).toHaveLength(1);
    expect(back[0].level).toBe("INFORMATIVO");
    expect(back[0].evidence).toMatchObject({ period: "2026-09", count: 3, tithes: 3, minLagDays: 18, maxLagDays: 18 });
    const base = byCode(r.findings, "BASELINE_DELTA_EXPLAINED");
    expect(base).toHaveLength(1);
    expect(base[0].evidence).toMatchObject({ period: "2026-09", closed: true, writes: { total: 3, human: 3, kinds: { creation: 3 } } });
    expect(r.verdict).toBe("OK");
  });
  it("atraso mayor al margen → REVISAR; reconocido en config → INFORMATIVO", () => {
    const old = row({ period: "2026-08", day: "20", createTime: "2026-10-12T16:00:00Z", updateTime: "2026-10-12T16:00:00Z" });
    const s = snap([old], { baseline: baselineOf([], ["2026-08"]) });
    const late = byCode(run(s).findings, "BACKDATED_ENTRY_LATE");
    expect(late[0].level).toBe("REVISAR");
    expect(late[0].evidence).toMatchObject({ maxLagDays: 53 });
    const acked = run(s, { acknowledged: [{ code: "BACKDATED_ENTRY_LATE", ids: [old.id], note: "regularización aprobada" }] });
    const f = byCode(acked.findings, "BACKDATED_ENTRY_LATE")[0];
    expect(f.level).toBe("INFORMATIVO");
    expect(f.message).toContain("reconocido");
  });
  it("con snapshot previo solo mira lo creado dentro de la ventana", () => {
    const old = row({ period: "2026-08", day: "20", createTime: "2026-10-08T14:00:00Z", updateTime: "2026-10-08T14:00:00Z" });
    expect(byCode(run(snap([old])).findings, "BACKDATED_ENTRY_LATE")).toHaveLength(0);
  });
});

describe("diezmos duplicados", () => {
  it("incidente real: dos diezmos idénticos de $145.000 a 24 s, mismo perfil → REVISAR", () => {
    const a = row({ source: "tithe", category: "Diezmos", amount: 145000, day: "11", createTime: "2026-10-11T15:00:00Z", updateTime: "2026-10-11T15:00:00Z" });
    const b = row({ source: "tithe", category: "Diezmos", amount: 145000, day: "11", createTime: "2026-10-11T15:00:24Z", updateTime: "2026-10-11T15:00:24Z" });
    const r = run(snap([a, b], { attributions: attribute([a, b], "prof-ejemplo-000001") }));
    const f = byCode(r.findings, "TITHE_DUPLICATE_EXACT");
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe("REVISAR");
    expect(f[0].evidence).toMatchObject({ amount: 145000, count: 2, createdSpanSeconds: 24, date: "2026-10-11", twinProfiles: false });
    expect(f[0].message).toContain("$145.000");
    expect(byCode(r.findings, "TITHE_REPEAT_MONTH")).toHaveLength(0);
  });
  it("mismo perfil y monto en el mes con fechas distintas → INFORMATIVO; distinto medio → no exacto", () => {
    const a = row({ source: "tithe", category: "Diezmos", amount: 40000, day: "4" });
    const b = row({ source: "tithe", category: "Diezmos", amount: 40000, day: "11" });
    const c = row({ source: "tithe", category: "Diezmos", amount: 40000, day: "11", paymentMethod: "cash" });
    const r = run(snap([a, b, c], { attributions: attribute([a, b, c], "prof-ejemplo-000002") }));
    expect(byCode(r.findings, "TITHE_DUPLICATE_EXACT")).toHaveLength(0);
    expect(byCode(r.findings, "TITHE_REPEAT_MONTH")[0]).toMatchObject({ level: "INFORMATIVO", evidence: { count: 3 } });
  });
  it("un diezmo anulado no cuenta como duplicado", () => {
    const a = row({ source: "tithe", amount: 145000, day: "11" });
    const b = row({ source: "tithe", amount: 145000, day: "11", status: "voided" });
    expect(byCode(run(snap([a, b], { attributions: attribute([a, b], "prof-ejemplo-000003") })).findings, "TITHE_DUPLICATE_EXACT")).toHaveLength(0);
  });
});

describe("perfiles duplicados", () => {
  const profiles = [
    { id: "prof-fam-aaaa01", displayName: "Familia Zorbaxi Uno", active: true, createTime: "2026-01-01T00:00:00Z" },
    { id: "prof-fam-bbbb02", displayName: "familia  zorbaxi-uno", active: true, createTime: "2026-10-09T00:00:00Z" },
    { id: "prof-per-cccc03", displayName: "Persona Vantrel Prueba", active: true },
    { id: "prof-per-dddd04", displayName: "Persona Vantrel Pruebas", active: true },
    { id: "prof-per-eeee05", displayName: "Otro Qulmirax Distinto", active: true },
  ];
  it("incidente real: perfil de familia duplicado con nombre idéntico → REVISAR; similar → INFORMATIVO; sin nombres en el reporte", () => {
    const r = run(snap([row()], { profiles }));
    const dup = byCode(r.findings, "PROFILE_DUPLICATE_NAME");
    expect(dup).toHaveLength(1);
    expect(dup[0].level).toBe("REVISAR");
    expect(dup[0].evidence).toMatchObject({ count: 2, ids: ["…aaaa01", "…bbbb02"] });
    const sim = byCode(r.findings, "PROFILE_SIMILAR_NAME");
    expect(sim).toHaveLength(1);
    expect(sim[0].level).toBe("INFORMATIVO");
    const text = formatReport(r) + JSON.stringify(publicFindings(r.findings));
    for (const p of profiles) expect(text.toLowerCase()).not.toContain(normalizeName(p.displayName).split(" ")[1]);
    expect(text).not.toContain("prof-fam-aaaa01");
  });
});

describe("resumen vs ledger (todos los meses)", () => {
  it("resumen descuadrado en un mes cerrado → STOP", () => {
    const ledger = [row({ period: "2026-03", day: "2" }), row()];
    const summaries = summariesOf(ledger);
    summaries["2026-03"] = { ...summaries["2026-03"], incomeTotal: 99999, result: 99999 };
    const r = run(snap(ledger, { summaries }));
    const f = byCode(r.findings, "SUMMARY_LEDGER_MISMATCH");
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe("STOP");
    expect(f[0].evidence).toMatchObject({ period: "2026-03", fields: ["incomeTotal", "result"] });
    expect(r.exitCode).toBe(2);
  });
  it("mapas por día y categoría; claves en cero → INFORMATIVO; mes sin resumen → STOP", () => {
    const ledger = [row({ period: "2026-04", day: "7" }), row({ period: "2026-05", day: "1" })];
    const summaries = summariesOf(ledger);
    summaries["2026-04"] = { ...summaries["2026-04"], dailyExpense: { "5": 0 }, dailyIncome: { "07": 10000 } };
    delete summaries["2026-05"];
    const r = run(snap(ledger, { summaries }));
    expect(codes(r.findings)).toEqual(expect.arrayContaining(["SUMMARY_ZERO_KEYS:INFORMATIVO", "SUMMARY_MISSING:STOP"]));
    expect(byCode(r.findings, "SUMMARY_LEDGER_MISMATCH")).toHaveLength(0);
    const bad = summariesOf(ledger);
    bad["2026-04"] = { ...bad["2026-04"], dailyIncome: { "8": 10000 } };
    expect(byCode(run(snap(ledger, { summaries: bad })).findings, "SUMMARY_LEDGER_MISMATCH")[0].evidence).toMatchObject({ fields: ["dailyIncome"] });
  });
});

describe("meses vs baseline", () => {
  it("incidente: cambio ene–sep sin escrituras que lo expliquen → STOP", () => {
    const before = [row({ period: "2026-05", day: "3", amount: 100000 })];
    // Un movimiento aparece en mayo con timestamps anteriores al baseline (restauración/corrupción).
    const ghost = row({ period: "2026-05", day: "9", amount: 50000, createTime: "2026-06-01T00:00:00Z", updateTime: "2026-06-01T00:00:00Z" });
    const r = run(snap([...before, ghost], { baseline: baselineOf(before, ["2026-05"]) }));
    const f = byCode(r.findings, "BASELINE_DELTA_UNEXPLAINED");
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe("STOP");
    expect(f[0].evidence).toMatchObject({ period: "2026-05", closed: true, unexplained: { incomeTotal: 50000, transactionCount: 1 } });
    expect(byCode(r.findings, "SUMMARY_LEDGER_MISMATCH")).toHaveLength(0);
    expect(r.exitCode).toBe(2);
  });
  it("resumen cambiado sin ledger → STOP doble (baseline y resumen)", () => {
    const ledger = [row({ period: "2026-06", day: "3", amount: 100000 })];
    const summaries = summariesOf(ledger);
    summaries["2026-06"] = { ...summaries["2026-06"], incomeTotal: 120000, result: 120000 };
    const r = run(snap(ledger, { summaries, baseline: baselineOf(ledger, ["2026-06"]) }));
    expect(codes(r.findings)).toEqual(expect.arrayContaining(["BASELINE_DELTA_UNEXPLAINED:STOP", "SUMMARY_LEDGER_MISMATCH:STOP"]));
  });
  it("anulación humana posterior al baseline explica el delta → REVISAR por defecto; INFORMATIVO con closedMonthHumanChanges", () => {
    const t = row({ period: "2026-07", day: "3", amount: 70000 });
    const keep = row({ period: "2026-07", day: "4", amount: 5000 });
    const voided = { ...t, status: "voided" as const, revision: 2, updateTime: "2026-10-05T12:00:00Z", voidedAt: "2026-10-05T12:00:00Z" };
    const s = snap([voided, keep], { baseline: baselineOf([t, keep], ["2026-07"]) });
    const strict = run(s);
    expect(byCode(strict.findings, "BASELINE_CLOSED_MONTH_HUMAN_CHANGE")[0]).toMatchObject({ level: "REVISAR", evidence: { writes: { kinds: { void: 1 } } } });
    expect(byCode(strict.findings, "BASELINE_DELTA_EXPLAINED")).toHaveLength(0);
    const r = run(s, { closedMonthHumanChanges: "informativo" });
    const f = byCode(r.findings, "BASELINE_DELTA_EXPLAINED");
    expect(f[0].evidence).toMatchObject({ delta: { incomeTotal: -70000 }, writes: { kinds: { void: 1 } }, priorState: "inferido" });
    expect(r.verdict).toBe("OK");
  });
  it("edición de monto: sin estado previo → STOP; con baseline.ledger → explicada", () => {
    const t = row({ period: "2026-08", day: "3", amount: 10000 });
    const edited = { ...t, amount: 12000, revision: 2, updateTime: "2026-10-06T12:00:00Z" };
    const noPrior = run(snap([edited], { baseline: baselineOf([t], ["2026-08"]) }));
    const stop = byCode(noPrior.findings, "BASELINE_DELTA_UNEXPLAINED")[0];
    expect(stop.message).toContain("sin estado previo");
    const withPrior = run(snap([edited], { baseline: baselineOf([t], ["2026-08"], true) }), { closedMonthHumanChanges: "informativo" });
    expect(byCode(withPrior.findings, "BASELINE_DELTA_EXPLAINED")[0].evidence).toMatchObject({ writes: { kinds: { edit: 1 } }, priorState: "ledger" });
    expect(withPrior.verdict).toBe("OK");
  });
  it("mes abierto (octubre) también se compara si está en el baseline; ausente → INFORMATIVO", () => {
    const t = row({ day: "1", amount: 8000, createTime: "2026-10-01T10:00:00Z", updateTime: "2026-10-01T10:00:00Z" });
    const fresh = row({ day: "10", amount: 2000, createTime: "2026-10-10T12:00:00Z", updateTime: "2026-10-10T12:00:00Z" });
    const r = run(snap([t, fresh], { baseline: baselineOf([t], ["2026-10"]) }));
    expect(byCode(r.findings, "BASELINE_DELTA_EXPLAINED")[0].evidence).toMatchObject({ closed: false });
    const r2 = run(snap([t], { baseline: baselineOf([t], ["2026-09"]) }));
    expect(codes(r2.findings)).toContain("BASELINE_OPEN_MONTH_ABSENT:INFORMATIVO");
  });
  it("mes cerrado con escrituras pero fuera del baseline → REVISAR", () => {
    const t = row({ period: "2025-12", day: "20", createTime: "2026-10-02T12:00:00Z", updateTime: "2026-10-02T12:00:00Z" });
    const r = run(snap([t], { baseline: baselineOf([], ["2026-09"]) }), { backdate: { maxLagDays: 400 } });
    expect(codes(r.findings)).toContain("BASELINE_MONTH_MISSING:REVISAR");
  });
});

describe("escrituras vs snapshot previo (semántica A5)", () => {
  const pos = (p: Partial<LedgerRow> = {}) =>
    row({ id: `sumup_offerings_pos${nextSeq()}`, category: "Ofrendas", paymentMethod: "card", createdBy: "system:sumup", updatedBy: "system:sumup", ...p });
  it("mutación system:sumup de POS → REVISAR; creación legítima → INFORMATIVO", () => {
    const old = pos({ day: "3" });
    const created = pos({ day: "12", createTime: "2026-10-12T20:00:00Z", updateTime: "2026-10-12T20:00:00Z" });
    const mutated = { ...old, status: "voided" as const, revision: 2, updateTime: "2026-10-12T21:00:00Z" };
    const r = run(snap([mutated, created], { previous: { takenAt: PREVIOUS_AT, ledger: [old] } }));
    expect(codes(r.findings)).toEqual(expect.arrayContaining(["SUMUP_POS_MUTATION:REVISAR", "SUMUP_CREATIONS:INFORMATIVO", "UNEXPECTED_VOID:REVISAR"]));
  });
  it("doc preexistente modificado → REVISAR; borrado → STOP; revision hacia atrás → STOP", () => {
    const a = row({ day: "2" });
    const b = row({ day: "3" });
    const c = row({ day: "4", revision: 3, updateTime: "2026-10-10T00:00:00Z" });
    const a2 = { ...a, amount: 15000, revision: 2, updateTime: "2026-10-12T22:00:00Z" };
    const c2 = { ...c, revision: 2 };
    const r = run(snap([a2, c2], { previous: { takenAt: PREVIOUS_AT, ledger: [a, b, c] } }));
    expect(codes(r.findings)).toEqual(expect.arrayContaining(["PREEXISTING_MODIFIED:REVISAR", "ROW_MISSING:STOP", "REVISION_REGRESSION:STOP", "HUMAN_WRITES:INFORMATIVO"]));
  });
  it("system:sumup sobre un doc ajeno y humano sobre sumup_* → REVISAR", () => {
    const foreign = row({ updatedBy: "system:sumup", revision: 2, updateTime: "2026-10-13T01:00:00Z" });
    const handEdited = pos({ updatedBy: HUMAN, revision: 2, updateTime: "2026-10-13T01:00:00Z" });
    const r = run(snap([foreign, handEdited]));
    expect(codes(r.findings)).toEqual(expect.arrayContaining(["SYSTEM_WRITE_FOREIGN_DOC:REVISAR", "HUMAN_WRITE_ON_SUMUP_DOC:REVISAR"]));
  });
  it("anulación reconocida → INFORMATIVO; un STOP nunca se rebaja", () => {
    const a = row({ day: "2" });
    const b = row({ day: "3" });
    const voided = { ...a, status: "voided" as const, revision: 2, updateTime: "2026-10-12T22:00:00Z" };
    const r = run(snap([voided], { previous: { takenAt: PREVIOUS_AT, ledger: [a, b] } }), {
      acknowledged: [
        { code: "UNEXPECTED_VOID", ids: [a.id], note: "anulación pedida por Tesorería" },
        { code: "ROW_MISSING", ids: [b.id], note: "no debería rebajar" },
      ],
    });
    expect(byCode(r.findings, "UNEXPECTED_VOID")[0].level).toBe("INFORMATIVO");
    expect(byCode(r.findings, "ROW_MISSING")[0].level).toBe("STOP");
  });
});

describe("SumUp: bruto vs payout neto", () => {
  // Una fila de payout por venta, monto NETO; depósito agrupado por `reference`.
  const sales = [
    { transactionCode: "TXCODE000001", account: "offerings", date: "2026-10-06", gross: 300000, paymentType: "POS" as const, status: "SUCCESSFUL" },
    { transactionCode: "TXCODE000002", account: "offerings", date: "2026-10-06", gross: 162500, paymentType: "POS" as const, status: "SUCCESSFUL" },
  ];
  const payouts = [
    { id: "po-row-000001", account: "offerings", type: "PAYOUT", transactionCode: "TXCODE000001", amount: 289640, fee: 10360, reference: "DEP-0001", date: "2026-10-08" },
    { id: "po-row-000002", account: "offerings", type: "PAYOUT", transactionCode: "TXCODE000002", amount: 156892, fee: 5608, reference: "DEP-0001", date: "2026-10-08" },
  ];
  const sumupFindings = (s: Snapshot, opts: MonitorOptions = {}) => run(s, opts).findings.filter((f) => f.detector === "sumup");

  it("caso real: bruto 462.500 / comisión 15.968 / neto 446.532 conciliado → sin hallazgos", () => {
    expect(payouts.reduce((a, p) => a + p.amount, 0)).toBe(446532);
    expect(payouts.reduce((a, p) => a + p.fee, 0)).toBe(15968);
    const fees = payouts.map((p) => ({ id: `fee-${p.id}`, payoutRowId: p.id, amount: p.fee, status: "active" }));
    const r = run(snap([row()], { sumup: { payoutAmountBasis: "net", sales, payouts, feeExpenses: fees } }));
    expect(r.findings.filter((f) => f.detector === "sumup")).toEqual([]);
    expect(r.verdict).toBe("OK");
  });
  it("payout agrupado que cubre ventas de dos días → sin hallazgos", () => {
    const s2 = [sales[0], { ...sales[1], date: "2026-10-07" }];
    expect(sumupFindings(snap([row()], { sumup: { sales: s2, payouts } }))).toEqual([]);
  });
  it("la misma fila de payout vista dos veces → STOP (doble registro)", () => {
    const f = sumupFindings(snap([row()], { sumup: { sales, payouts: [...payouts, { ...payouts[0] }] } }));
    expect(codes(f)).toEqual(["PAYOUT_ROW_DUPLICATE:STOP"]);
  });
  it("payout en base bruta y depósito descuadrado → REVISAR", () => {
    const gross = [{ ...payouts[0], amount: 300000 }, payouts[1]];
    const f = sumupFindings(snap([row()], { sumup: { sales, payouts: gross } }));
    expect(codes(f)).toEqual(expect.arrayContaining(["PAYOUT_BASIS_NOT_NET:REVISAR", "SETTLEMENT_MISMATCH:REVISAR"]));
    expect(f.find((x) => x.code === "SETTLEMENT_MISMATCH")?.evidence).toMatchObject({ difference: 10360 });
    expect(codes(sumupFindings(snap([row()], { sumup: { payoutAmountBasis: "gross", sales, payouts } })))).toEqual(["PAYOUT_BASIS_NOT_NET:REVISAR"]);
  });
  it("venta POS sin payout tras N días hábiles → REVISAR; dentro del plazo → INFORMATIVO; CASH no espera payout", () => {
    const pending = [
      { transactionCode: "TXCODE000010", account: "cafeteria", date: "2026-10-06", gross: 5000, paymentType: "POS" as const },
      { transactionCode: "TXCODE000011", account: "cafeteria", date: "2026-10-09", gross: 7000, paymentType: "POS" as const },
      { transactionCode: "TXCODE000012", account: "cafeteria", date: "2026-10-01", gross: 9000, paymentType: "CASH" as const },
    ];
    const f = sumupFindings(snap([row()], { sumup: { sales: pending } }));
    expect(codes(f)).toEqual(expect.arrayContaining(["PAYOUT_PENDING:REVISAR", "PAYOUT_PENDING_WITHIN_TERM:INFORMATIVO"]));
    expect(f.find((x) => x.code === "PAYOUT_PENDING")?.evidence).toMatchObject({ count: 1, total: 5000, oldest: "2026-10-06" });
  });
  it("propuesta de comisión ya registrada → STOP; comisión registrada dos veces → STOP; monto ≠ proveedor → REVISAR", () => {
    const feeExpenses = [
      { id: "fee-a", payoutRowId: "po-row-000001", amount: 10360 },
      { id: "fee-b", payoutRowId: "po-row-000001", amount: 10360 },
      { id: "fee-c", payoutRowId: "po-row-000002", amount: 5000 },
    ];
    const feeProposals = [{ id: "fee-c", payoutRowId: "po-row-000002", amount: 5608 }];
    const f = sumupFindings(snap([row()], { sumup: { sales, payouts, feeExpenses, feeProposals } }));
    expect(codes(f)).toEqual(expect.arrayContaining(["FEE_DOUBLE_BOOKED:STOP", "FEE_PROPOSAL_ALREADY_BOOKED:STOP", "FEE_AMOUNT_MISMATCH:REVISAR"]));
  });
  it("deducción por reembolso cuadra con el reembolso de la venta; si no → REVISAR", () => {
    const refunded = [{ ...sales[0], refunded: 20000 }, sales[1]];
    const ded = { id: "po-row-000009", account: "offerings", type: "REFUND_DEDUCTION", transactionCode: "TXCODE000001", amount: -20000, fee: 0, reference: "DEP-0002" };
    expect(sumupFindings(snap([row()], { sumup: { sales: refunded, payouts: [...payouts, ded] } }))).toEqual([]);
    expect(codes(sumupFindings(snap([row()], { sumup: { sales, payouts: [...payouts, ded] } })))).toEqual(["PAYOUT_DEDUCTION_MISMATCH:REVISAR"]);
  });
});

describe("CLI run.mjs (solo archivos locales)", () => {
  const dir = mkdtempSync(join(tmpdir(), "a6-monitor-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, data: unknown) => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(data));
    return p;
  };
  const ok = snap([row(), row({ day: "6" })]);
  const dupAt = row({ source: "tithe", amount: 145000, day: "11" });
  const dupBt = row({ source: "tithe", amount: 145000, day: "11" });
  const review = snap([dupAt, dupBt], { attributions: attribute([dupAt, dupBt], "prof-cli-000001") });

  it("exit 0/1/2 y reporte en español agrupado por nivel, con línea de cobertura", () => {
    const okRun = main(["--snapshot", write("ok.json", ok)]);
    expect(okRun.code).toBe(0);
    expect(okRun.output).toContain("Cobertura: ledger 2 movimiento(s)");
    const r = main(["--snapshot", write("rev.json", review)]);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/STOP \(0\)[\s\S]*REVISAR \(1\)[\s\S]*TITHE_DUPLICATE_EXACT[\s\S]*RESULTADO: REVISAR/);
    const bad = summariesOf(ok.ledger);
    bad["2026-10"] = { ...bad["2026-10"], expenseTotal: 1 };
    expect(main(["--snapshot", write("stop.json", { ...ok, summaries: bad })]).code).toBe(2);
  });
  it("baseline/previo/config desde archivos; JSON sin ids completos", () => {
    const t = row({ period: "2026-08", day: "20", createTime: "2026-10-12T16:00:00Z", updateTime: "2026-10-12T16:00:00Z" });
    const s = snap([t], { baseline: baselineOf([], ["2026-08"]) });
    const r = main(["--snapshot", write("s.json", s), "--config", write("c.json", { backdate: { maxLagDays: 60 } }), "--format", "json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.output).verdict).toBe("OK");
    expect(r.output).not.toContain(t.id);
    const rest = { ...s, baseline: undefined };
    const withBase = main(["--snapshot", write("s2.json", rest), "--baseline", write("b.json", baselineOf([], ["2026-08"])), "--today", "2026-10-13"]);
    expect(withBase.output).toContain("BASELINE_DELTA_EXPLAINED");
    expect(withBase.output).toContain(`baseline sí (estado previo: inferido)`);
    expect(BASELINE_AT).toBe(baselineOf([], []).takenAt);
  });
  it("argumentos o archivos inválidos → exit 2", () => {
    expect(main([]).code).toBe(2);
    expect(main(["--snapshot"]).code).toBe(2);
    expect(main(["--snapshot", join(dir, "no-existe.json")]).code).toBe(2);
    expect(main(["--snapshot", write("x.json", ok), "--today", "13-10-2026"]).code).toBe(2);
  });
  it("como proceso: exit code real del CLI", () => {
    const script = join(process.cwd(), "scripts/ops/finance-monitor/run.mjs");
    let status = 0;
    try {
      execFileSync(process.execPath, [script, "--snapshot", write("p.json", review)], { stdio: "pipe" });
    } catch (e) {
      status = (e as { status: number }).status;
    }
    expect(status).toBe(1);
  });
});
