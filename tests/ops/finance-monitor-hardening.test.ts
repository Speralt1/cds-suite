// @vitest-environment node
// Monitor A6 (doc 31) · arreglos de la revisión Atlas: M1 borrados/ediciones sin estado
// previo, M2 falla cerrada (exit 2), M3 validación estricta, MINOR 1–9 y NIT 1/2/5.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { formatReport, publicFindings, runMonitor, type LedgerRow } from "../../scripts/ops/finance-monitor/index.mjs";
import { businessDaysBetween, daysBetween, identityKey, localDate, nameSimilarity, normalizeName } from "../../scripts/ops/finance-monitor/lib/util.mjs";
import { isYmd } from "../../scripts/ops/finance-monitor/lib/validate.mjs";
import { main } from "../../scripts/ops/finance-monitor/run.mjs";
import { BASELINE_AT, PREVIOUS_AT, TAKEN_AT, attribute, baselineOf, byCode, codes, nextSeq, row, run, snap, summariesOf } from "./finance-monitor-fixtures";

const onlyInputInvalid = (r: ReturnType<typeof run>) => {
  expect(codes(r.findings)).toEqual(["INPUT_INVALID:STOP"]);
  expect(r.exitCode).toBe(2);
};

describe("M1 · baseline: borrados y ediciones sin estado previo nunca son INFORMATIVO", () => {
  it("fila del baseline.ledger borrada + resumen ajustado, sin snapshot previo → STOP BASELINE_ROW_DELETED", () => {
    const keep = row({ period: "2026-07", day: "3", amount: 40000 });
    const gone = row({ period: "2026-07", day: "4", amount: 25000 });
    // El resumen se "ajustó" al ledger sin la fila: delta y escrituras cuadran, pero hubo un borrado.
    const r = run(snap([keep], { previous: null, baseline: baselineOf([keep, gone], ["2026-07"], true) }));
    const f = byCode(r.findings, "BASELINE_ROW_DELETED");
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe("STOP");
    expect(f[0].evidence).toMatchObject({ period: "2026-07", count: 1, deltaMatchesWrites: true });
    expect(byCode(r.findings, "BASELINE_DELTA_EXPLAINED")).toHaveLength(0);
    expect(r.exitCode).toBe(2);
  });
  it("borrado en un mes que no está en el baseline también es STOP", () => {
    const keep = row({ period: "2026-10", day: "3" });
    const gone = row({ period: "2026-10", day: "4" });
    const r = run(snap([keep], { baseline: { ...baselineOf([keep, gone], [], true) } }));
    expect(codes(r.findings)).toContain("BASELINE_ROW_DELETED:STOP");
  });
  it("dos ediciones +100/−100 sin estado previo → REVISAR (no verificable), nunca OK", () => {
    const a = row({ period: "2026-08", day: "3", amount: 1000 });
    const b = row({ period: "2026-08", day: "3", amount: 1000 }); // mismo día y categoría: el delta neto es 0
    const a2 = { ...a, amount: 1100, revision: 2, updateTime: "2026-10-06T12:00:00Z" };
    const b2 = { ...b, amount: 900, revision: 2, updateTime: "2026-10-06T12:00:00Z" };
    const r = run(snap([a2, b2], { baseline: baselineOf([a, b], ["2026-08"]) }));
    const f = byCode(r.findings, "BASELINE_EDIT_UNVERIFIABLE");
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe("REVISAR");
    expect(byCode(r.findings, "BASELINE_DELTA_EXPLAINED")).toHaveLength(0);
    expect(r.verdict).toBe("REVISAR");
  });
});

describe("M2 · cualquier fallo sale con exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "a6-hardening-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, data: string) => {
    const p = join(dir, name);
    writeFileSync(p, data);
    return p;
  };
  const okFile = () => write(`ok-${nextSeq()}.json`, JSON.stringify(snap([row()])));

  it("snapshot `null`, arreglo o no-objeto → exit 2 (CLI) y INPUT_INVALID (API)", () => {
    expect(main(["--snapshot", write("null.json", "null")]).code).toBe(2);
    expect(main(["--snapshot", write("arr.json", "[]")]).code).toBe(2);
    onlyInputInvalid(runMonitor(null));
    onlyInputInvalid(runMonitor("texto"));
  });
  it("acknowledged mal formado ([null], ids no arreglo, sin code) → exit 2", () => {
    for (const acknowledged of [[null], [{ code: "X", ids: "abc" }], [{ ids: ["tx1"] }], { code: "X" }, [{ code: "X", ids: ["a"], until: "2026-13-01" }]]) {
      const r = main(["--snapshot", okFile(), "--config", write(`c-${nextSeq()}.json`, JSON.stringify({ acknowledged }))]);
      expect(r.code).toBe(2);
      expect(r.output).toContain("INPUT_INVALID");
    }
  });
  it("opciones desconocidas o de tipo erróneo → STOP", () => {
    onlyInputInvalid(run(snap([row()]), { backdate: { maxLagDays: "31" } } as never));
    onlyInputInvalid(run(snap([row()]), { typo: true } as never));
    onlyInputInvalid(run(snap([row()]), { payouts: { holidays: ["2026-09-31"] } }));
  });
  it("una excepción inesperada fuera de los detectores → STOP INTERNAL_ERROR", () => {
    const raw = snap([row()]);
    Object.defineProperty(raw, "ledger", {
      get() {
        throw new Error("boom");
      },
    });
    const r = runMonitor(raw);
    expect(codes(r.findings)).toEqual(["INTERNAL_ERROR:STOP"]);
    expect(r.exitCode).toBe(2);
  });
});

describe("M3 · validación estricta (no falla abierta)", () => {
  const sale = { transactionCode: "TXCODE000100", account: "cafeteria", gross: 5000, paymentType: "POS" as const };
  it("sales[].date con hora ISO o ausente → INPUT_INVALID", () => {
    onlyInputInvalid(run(snap([row()], { sumup: { sales: [{ ...sale, date: "2026-09-01T12:00:00Z" }] } })));
    onlyInputInvalid(run(snap([row()], { sumup: { sales: [{ ...sale } as never] } })));
  });
  it("venta POS impaga de hace 6 semanas → PAYOUT_PENDING REVISAR", () => {
    const r = run(snap([row()], { sumup: { sales: [{ ...sale, date: "2026-09-01" }] } }));
    expect(byCode(r.findings, "PAYOUT_PENDING")[0]).toMatchObject({ level: "REVISAR", evidence: { oldest: "2026-09-01" } });
  });
  it("ledger y resúmenes vacíos → STOP salvo allowEmpty explícito", () => {
    onlyInputInvalid(run({ takenAt: TAKEN_AT, ledger: [], summaries: {} }));
    const r = run({ takenAt: TAKEN_AT, ledger: [], summaries: {}, baseline: { takenAt: BASELINE_AT, months: {} }, previous: { takenAt: PREVIOUS_AT, ledger: [] } }, { allowEmpty: true });
    expect(r.verdict).toBe("OK");
  });
  it("sumup presente sin sus 4 arreglos → INPUT_INVALID", () => {
    const s = { ...snap([row()]), sumup: { sales: [], payouts: [] } };
    onlyInputInvalid(run(s));
  });
  it("fechas inválidas en utilidades lanzan (→ DETECTOR_ERROR STOP), nunca NaN silencioso", () => {
    expect(() => businessDaysBetween("2026-10-06T00:00:00Z", "2026-10-13")).toThrow();
    expect(() => daysBetween("2026-02-30", "2026-03-01")).toThrow();
    expect(isYmd("2026-02-29")).toBe(false);
    expect(isYmd("2028-02-29")).toBe(true);
  });
});

describe("MINOR 1 · creación SumUp legítima estricta (espejo de engine.js)", () => {
  const base = (p: Partial<LedgerRow>) =>
    row({
      id: `sumup_offerings_n${nextSeq()}`,
      paymentMethod: "card",
      createdBy: "system:sumup",
      updatedBy: "system:sumup",
      day: "12",
      createTime: "2026-10-12T20:00:00Z",
      updateTime: "2026-10-12T20:00:00Z",
      ...p,
    });
  it("rev 1 + ingreso general activo card/cash monto > 0 → SUMUP_CREATIONS (INFORMATIVO, diferencia deliberada vs A5)", () => {
    const r = run(snap([base({}), base({ paymentMethod: "cash" })]));
    expect(byCode(r.findings, "SUMUP_CREATIONS")[0].evidence).toMatchObject({ count: 2 });
    expect(r.verdict).toBe("OK");
  });
  it.each([
    ["revision ausente", { revision: undefined }],
    ["egreso", { type: "expense" as const }],
    ["fuente diezmo", { source: "tithe" as const }],
    ["medio transferencia", { paymentMethod: "transfer" }],
    ["monto 0", { amount: 0 }],
  ])("%s → no es creación legítima (mutación → REVISAR)", (_label, p) => {
    const r = run(snap([base(p as Partial<LedgerRow>)]));
    expect(byCode(r.findings, "SUMUP_CREATIONS")).toHaveLength(0);
    expect(r.verdict).not.toBe("OK");
  });
});

describe("MINOR 2 · reconocimientos: code + ids completos + vencimiento", () => {
  const old = row({ period: "2026-08", day: "20", createTime: "2026-10-12T16:00:00Z", updateTime: "2026-10-12T16:00:00Z" });
  const s = snap([old], { baseline: baselineOf([], ["2026-08"]) });
  const levelWith = (ack: object) => byCode(run(s, { acknowledged: [ack as never] }).findings, "BACKDATED_ENTRY_LATE")[0].level;
  it("sufijo de 6 caracteres o code distinto no reconocen", () => {
    expect(levelWith({ code: "BACKDATED_ENTRY_LATE", ids: [old.id.slice(-6)] })).toBe("REVISAR");
    expect(levelWith({ code: "FUTURE_DATED", ids: [old.id] })).toBe("REVISAR");
    expect(levelWith({ code: "BACKDATED_ENTRY_LATE", ids: [old.id], until: "2026-10-13" })).toBe("INFORMATIVO");
  });
  it("reconocimiento vencido (until < hoy) no rebaja y se avisa ACK_EXPIRED", () => {
    const r = run(s, { acknowledged: [{ code: "BACKDATED_ENTRY_LATE", ids: [old.id], until: "2026-10-12" }] });
    expect(byCode(r.findings, "BACKDATED_ENTRY_LATE")[0].level).toBe("REVISAR");
    expect(codes(r.findings)).toContain("ACK_EXPIRED:INFORMATIVO");
  });
});

describe("MINOR 3 · diezmos: perfiles gemelos e integridad de atribuciones", () => {
  const profiles = [
    { id: "prof-twin-00001", displayName: "Familia Zorbaxi Dos", active: true },
    { id: "prof-twin-00002", displayName: "FAMILIA ZORBAXI-DOS", active: true },
  ];
  it("duplicado repartido entre perfiles gemelos → TITHE_DUPLICATE_EXACT (twinProfiles)", () => {
    const a = row({ source: "tithe", amount: 145000, day: "11" });
    const b = row({ source: "tithe", amount: 145000, day: "11" });
    const r = run(snap([a, b], { profiles, attributions: [...attribute([a], profiles[0].id), ...attribute([b], profiles[1].id)] }));
    expect(byCode(r.findings, "TITHE_DUPLICATE_EXACT")[0].evidence).toMatchObject({ twinProfiles: true, count: 2 });
  });
  it("diezmo activo sin atribución o con 2 → REVISAR", () => {
    const orphan = row({ source: "tithe", amount: 1000, day: "2" });
    const doubled = row({ source: "tithe", amount: 2000, day: "3" });
    const fine = row({ source: "tithe", amount: 3000, day: "4" });
    const attributions = [...attribute([doubled], "prof-a-000001"), ...attribute([doubled], "prof-b-000002"), ...attribute([fine], "prof-c-000003")];
    const f = byCode(run(snap([orphan, doubled, fine], { attributions })).findings, "TITHE_ATTRIBUTION_INTEGRITY");
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe("REVISAR");
    expect((f[0].evidence.withoutAttribution as string[]).length).toBe(1);
    expect((f[0].evidence.multipleAttributions as string[]).length).toBe(1);
  });
});

describe("MINOR 4 · corrupción de tipos → INPUT_INVALID (sin coerción silenciosa)", () => {
  const t = () => row();
  const withRow = (p: Record<string, unknown>) => {
    const r0 = { ...t(), ...p } as LedgerRow;
    return snap([r0], { summaries: { "2026-10": summariesOf([t()])["2026-10"] } });
  };
  it.each([
    ["monto como texto", { amount: "10000" }],
    ["monto decimal", { amount: 10.5 }],
    ["status fuera de dominio", { status: "deleted" }],
    ["type fuera de dominio", { type: "transfer" }],
    ["source fuera de dominio", { source: "sumup" }],
    ["día 32", { day: "32" }],
    ["31 de septiembre", { period: "2026-09", day: "31" }],
    ["periodo inválido", { period: "2026-13" }],
    ["createTime no ISO", { createTime: "ayer" }],
    ["revision texto", { revision: "2" }],
  ])("ledger: %s", (_label, p) => onlyInputInvalid(run(withRow(p))));
  it("ids duplicados en el ledger", () => {
    const a = row();
    onlyInputInvalid(run(snap([a, { ...a }])));
  });
  it.each([
    ["escalar como texto", { incomeTotal: "10000" }],
    ["mapa con valor no numérico", { dailyIncome: { "5": "x" } }],
    ["falta transactionCount", { transactionCount: undefined }],
  ])("resumen: %s", (_label, p) => {
    const ledger = [row()];
    const s = summariesOf(ledger);
    onlyInputInvalid(run(snap(ledger, { summaries: { "2026-10": { ...s["2026-10"], ...p } as never } })));
  });
  it("previous.ledger, perfiles y atribuciones también se validan", () => {
    const a = row();
    onlyInputInvalid(run(snap([a], { previous: { takenAt: PREVIOUS_AT, ledger: [{ ...a, status: "borrado" as never }] } })));
    onlyInputInvalid(run(snap([a], { profiles: [{ id: "p1", displayName: "X" }, { id: "p1", displayName: "Y" }] })));
    onlyInputInvalid(run(snap([a], { attributions: [{ id: "x", transactionId: a.id } as never] })));
  });
});

describe("MINOR 5 · cobertura visible: OK nunca significa «nada revisado»", () => {
  it("sin baseline o sin snapshot previo → COVERAGE_PARTIAL REVISAR; sin SumUp → INFORMATIVO", () => {
    const ledger = [row()];
    const noBase = run(snap(ledger, { baseline: null }));
    expect(byCode(noBase.findings, "COVERAGE_PARTIAL")[0]).toMatchObject({ level: "REVISAR", evidence: { missing: ["baseline"] } });
    expect(noBase.verdict).toBe("REVISAR");
    const noPrev = run(snap(ledger, { previous: null }));
    expect(byCode(noPrev.findings, "COVERAGE_PARTIAL")[0].evidence).toMatchObject({ missing: ["snapshot previo"] });
    const noSumup = run(snap(ledger, { sumup: null }));
    expect(codes(noSumup.findings)).toContain("COVERAGE_SUMUP_ABSENT:INFORMATIVO");
    expect(noSumup.verdict).toBe("OK");
    expect(formatReport(noBase)).toMatch(/Cobertura: ledger 1 movimiento\(s\) · resúmenes 1 · baseline no · snapshot previo sí · SumUp sí/);
  });
});

describe("MINOR 6 · baselines A9/A10", () => {
  it("A9: createdAt como takenAt, meses con campos extra (updatedAt) → aceptado", () => {
    const ledger = [row({ period: "2026-09", day: "3" })];
    const months = { "2026-09": { ...summariesOf(ledger)["2026-09"], updatedAt: "2026-09-30T12:00:00Z" } };
    const r = run(snap(ledger, { baseline: { createdAt: BASELINE_AT, months } as never }));
    expect(r.verdict).toBe("OK");
  });
  it("A10: ledger agregado (objeto) se ignora como estado previo → inferido", () => {
    const t = row({ period: "2026-07", day: "3", amount: 70000 });
    const voided = { ...t, status: "voided" as const, revision: 2, updateTime: "2026-10-05T12:00:00Z" };
    const base = { createdAt: BASELINE_AT, months: baselineOf([t], ["2026-07"]).months, ledger: { docs: 1, voided: { count: 0, sum: 0 } } };
    const r = run(snap([voided], { baseline: base as never }), { closedMonthHumanChanges: "informativo" });
    expect(byCode(r.findings, "BASELINE_DELTA_EXPLAINED")[0].evidence).toMatchObject({ priorState: "inferido" });
    expect(formatReport(r)).toContain("baseline sí (estado previo: inferido)");
  });
  it("baseline sin takenAt ni createdAt → INPUT_INVALID", () => {
    onlyInputInvalid(run(snap([row()], { baseline: { months: {} } as never })));
  });
});

describe("MINOR 9 · --today real y config sin today/since/now", () => {
  const dir = mkdtempSync(join(tmpdir(), "a6-cli9-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name: string, data: unknown) => {
    const p = join(dir, name);
    writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data));
    return p;
  };
  const s = file("s.json", snap([row()]));
  it("fechas imposibles o ISO inválido en flags → exit 2", () => {
    expect(main(["--snapshot", s, "--today", "2026-02-30"]).code).toBe(2);
    expect(main(["--snapshot", s, "--since", "ayer"]).code).toBe(2);
    expect(main(["--snapshot", s, "--today", "2026-10-13"]).code).toBe(0);
  });
  it.each(["today", "since", "now", "allowEmpty"])("config con %s → exit 2", (k) => {
    const r = main(["--snapshot", s, "--config", file(`c-${k}.json`, { [k]: k === "allowEmpty" ? true : "2026-10-13" })]);
    expect(r.code).toBe(2);
    expect(r.output).toContain(k);
  });
  it("--allow-empty solo por CLI", () => {
    const empty = file("e.json", { takenAt: TAKEN_AT, ledger: [], summaries: {}, baseline: { takenAt: BASELINE_AT, months: {} }, previous: { takenAt: PREVIOUS_AT, ledger: [] } });
    expect(main(["--snapshot", empty]).code).toBe(2);
    expect(main(["--snapshot", empty, "--allow-empty"]).code).toBe(0);
  });
  it("NIT 1: error de JSON genérico, sin repetir el contenido del archivo", () => {
    const r = main(["--snapshot", file("bad.json", '{"secreto": "VALOR-PRIVADO-123", ')]);
    expect(r.code).toBe(2);
    expect(r.output).not.toContain("VALOR-PRIVADO");
    expect(r.output).toContain("no es JSON válido");
  });
});

describe("NIT 2 · horario de verano America/Santiago", () => {
  it("fin de DST 2026-04-05 e inicio 2026-09-06", () => {
    expect(localDate("2026-04-05T02:59:00Z")).toBe("2026-04-04"); // 23:59 GMT-3
    expect(localDate("2026-04-05T03:59:00Z")).toBe("2026-04-04"); // 23:59 GMT-4 (hora repetida)
    expect(localDate("2026-04-05T04:00:00Z")).toBe("2026-04-05");
    expect(localDate("2026-09-06T03:59:00Z")).toBe("2026-09-05"); // 23:59 GMT-4
    expect(localDate("2026-09-06T04:00:00Z")).toBe("2026-09-06"); // 01:00 GMT-3 (00:00 no existe)
  });
  it("«hoy» en el borde del cambio decide si un movimiento es futuro", () => {
    const t = row({ period: "2026-09", day: "6", createTime: "2026-09-06T03:00:00Z", updateTime: "2026-09-06T03:00:00Z" });
    const at = (takenAt: string) => run({ ...snap([t], { previous: { takenAt: "2026-09-01T00:00:00Z", ledger: [] } }), takenAt });
    expect(codes(at("2026-09-06T03:59:00Z").findings)).toContain("FUTURE_DATED:REVISAR");
    expect(codes(at("2026-09-06T04:00:00Z").findings)).not.toContain("FUTURE_DATED:REVISAR");
  });
});

describe("NIT 5 · regresión de privacidad: muchos códigos, ninguna PII en texto ni JSON", () => {
  it("no aparecen ids completos, nombres, correos ni uids", () => {
    const UID = "uid-privado-a1b2c3d4e5";
    const profiles = [
      { id: "perfil-privado-000aaa", displayName: "Familia Wexorlan Prueba", active: true, email: "contacto.privado@ejemplo.invalid", phone: "+56 9 0000 0000" },
      { id: "perfil-privado-000bbb", displayName: "familia wexorlan-prueba", active: true, email: "otro.privado@ejemplo.invalid" },
    ];
    const a = row({ id: "movimiento-privado-0001", source: "tithe", amount: 145000, day: "11", createdBy: UID, updatedBy: UID });
    const b = row({ id: "movimiento-privado-0002", source: "tithe", amount: 145000, day: "11", createdBy: UID, updatedBy: UID });
    const future = row({ id: "movimiento-privado-0003", day: "20", createdBy: UID, updatedBy: UID });
    const orphan = row({ id: "movimiento-privado-0004", source: "tithe", amount: 7000, day: "2", createdBy: UID, updatedBy: UID });
    const ledger = [a, b, future, orphan];
    const summaries = summariesOf(ledger);
    summaries["2026-10"] = { ...summaries["2026-10"], expenseTotal: 1, result: summaries["2026-10"].result - 1 };
    const sales = [{ transactionCode: "codigo-venta-privado-01", account: "offerings", date: "2026-09-01", gross: 5000, paymentType: "POS" as const }];
    const payouts = [
      { id: "fila-payout-privada-01", account: "offerings", type: "PAYOUT", transactionCode: "codigo-venta-privado-99", amount: 100, fee: 1, reference: "deposito-privado-01" },
      { id: "fila-payout-privada-01", account: "offerings", type: "PAYOUT", transactionCode: "codigo-venta-privado-99", amount: 100, fee: 1, reference: "deposito-privado-01" },
    ];
    const r = run(
      snap(ledger, {
        profiles,
        summaries,
        attributions: [...attribute([a], profiles[0].id), ...attribute([b], profiles[1].id)],
        sumup: { sales, payouts, feeExpenses: [{ id: "egreso-comision-privado-01", payoutRowId: "fila-payout-privada-01", amount: 5 }], feeProposals: [] },
        previous: { takenAt: PREVIOUS_AT, ledger: [{ ...row({ id: "movimiento-privado-borrado" }) }] },
      }),
    );
    const found = new Set(r.findings.map((f) => f.code));
    for (const c of ["TITHE_DUPLICATE_EXACT", "PROFILE_DUPLICATE_NAME", "FUTURE_DATED", "TITHE_ATTRIBUTION_INTEGRITY", "SUMMARY_LEDGER_MISMATCH", "ROW_MISSING", "PAYOUT_ROW_DUPLICATE", "PAYOUT_PENDING", "FEE_AMOUNT_MISMATCH", "PAYOUT_UNLINKED"])
      expect(found).toContain(c);
    const outputs = [formatReport(r), JSON.stringify(publicFindings(r.findings)), JSON.stringify(r.context)];
    const secrets = [
      UID,
      ...profiles.flatMap((p) => [p.id, p.email, "wexorlan"]),
      "+56 9",
      ...ledger.map((t) => t.id),
      "movimiento-privado-borrado",
      "codigo-venta-privado-01",
      "fila-payout-privada-01",
      "deposito-privado-01",
      "egreso-comision-privado-01",
    ];
    for (const out of outputs) for (const secret of secrets) expect(out.toLowerCase()).not.toContain(String(secret).toLowerCase());
  });
});

describe("MINOR 7 · paridad de normalización con lib/shared/names.ts (doc 27)", () => {
  // Valores esperados generados con lib/shared/names.ts de la rama de integridad de diezmos.
  // Cuando ese módulo llegue a producción, A6 importará functions/shared/names.js y este
  // fixture debe seguir pasando sin cambios.
  const KEYS: [string, string, string][] = [
    ["  José   PÉREZ-Soto. ", "jose perez soto", "jose_perez_soto"],
    ["Familia Muñoz (Ejemplo)", "familia munoz ejemplo", "familia_munoz_ejemplo"],
    ["ÑANDÚ Çedilla", "nandu cedilla", "nandu_cedilla"],
    ["Strauß Øster", "strauss oster", "strauss_oster"],
    ["O'Higgins / D'Arcy", "o higgins d arcy", "o_higgins_d_arcy"],
    ["Ana_María—López", "ana maria lopez", "ana_maria_lopez"],
    ["  ", "", ""],
    ["Łukasz Ðorđe", "lukasz dorde", "lukasz_dorde"],
    ["😀 Juan 😀", "😀 juan 😀", "juan"],
    ["Familia   Zorbaxi-Uno", "familia zorbaxi uno", "familia_zorbaxi_uno"],
    ["MARÍA JOSÉ", "maria jose", "maria_jose"],
  ];
  it.each(KEYS)("%j → normalizeName %j, identityKey %j", (input, normalized, key) => {
    expect(normalizeName(input)).toBe(normalized);
    expect(identityKey(input)).toBe(key);
  });
  it("similitud igual a la referencia", () => {
    expect(nameSimilarity("Juan Pérez", "Pérez Juan")).toBe(0.99);
    expect(nameSimilarity("Juan Pérez", "Juan Pérez Soto")).toBe(0.85);
    expect(nameSimilarity("Familia Zorbaxi Uno", "familia zorbaxi-uno")).toBe(1);
    expect(nameSimilarity("Persona Vantrel Prueba", "Persona Vantrel Pruebas")).toBeCloseTo(0.9565217391304348, 12);
    expect(nameSimilarity("Ana López", "Pedro Díaz")).toBeCloseTo(0.2, 12);
  });
});
