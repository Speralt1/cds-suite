// @vitest-environment node
// Contrato con la callable sumupPayoutsReconciliation (PR C) y estado de la
// tarjeta que falla cerrado (doc 30). Datos ficticios.
import { describe, expect, it, vi } from "vitest";
import { computeBankBalance } from "@/lib/finance/bank-balance";
import { adaptSumupReconciliationResponse } from "@/lib/finance/sumup-payouts-adapter";

vi.mock("@/lib/firebase", () => ({ getFirebaseServices: () => ({ db: {} }), getFirebaseFunctions: () => ({}) }));
const { fetchSumupPayoutsForBank, payoutWindows } = await import("@/lib/finance/sumup-payouts-client");
const { resolveBankBalanceState } = await import("@/lib/finance/bank-hooks");

type O = Record<string, unknown>;
function settlement(o: O = {}): O {
  return {
    id: "ref-1",
    account: "offerings",
    payoutDate: "2026-10-06",
    statusClass: "successful",
    status: "CONCILIADO",
    reasons: [],
    netPaid: 97_000,
    fee: 3_000,
    grossSales: 100_000,
    inWindow: true,
    ...o,
  };
}
function account(o: O = {}): O {
  return {
    ok: true,
    errorClass: null,
    account: "offerings",
    basis: { basis: "net", reason: null, tally: { net: 3, gross: 0, ambiguous: 0, mismatch: 0 } },
    settlements: [settlement()],
    pendingDays: [],
    pendingAmount: 0,
    pendingSales: 0,
    proposals: [],
    totals: {},
    rowStats: {},
    ...o,
  };
}
function response(o: O = {}, accounts: O[] = [account(), account({ account: "cafeteria", settlements: [] })]): O {
  return {
    readOnly: true,
    period: { startDate: "2026-10-01", endDate: "2026-10-13" },
    payoutFetch: { startDate: "2026-10-01", endDate: "2026-10-13" },
    salesRead: { startDate: "2026-09-21", endDate: "2026-10-13" },
    asOfDate: "2026-10-13",
    policy: "payout_date",
    differenceBusinessDays: 5,
    accounts,
    totals: {},
    ...o,
  };
}

describe("adaptSumupReconciliationResponse", () => {
  it("toma solo abonos exitosos con fecha, suma pendientes de ambas cuentas y fija la cobertura", () => {
    const r = adaptSumupReconciliationResponse(
      response({}, [
        account({
          pendingAmount: 12_000,
          settlements: [
            settlement(),
            settlement({ id: "ref-2", statusClass: "in_progress", status: "PENDIENTE", netPaid: 5_000 }),
            settlement({ id: "ref-3", statusClass: "failed", status: "REQUIERE_REVISION", netPaid: 6_000 }),
            settlement({ id: "ref-4", payoutDate: null, netPaid: 7_000 }),
          ],
        }),
        account({ account: "cafeteria", pendingAmount: 3_000, settlements: [settlement({ id: "ref-1", account: "cafeteria", netPaid: 20_000 })] }),
      ]),
      "2026-10-13",
    );
    expect(r.status).toBe("available");
    if (r.status !== "available") return;
    expect(r.payouts).toEqual([
      { id: "offerings:ref-1", payoutDate: "2026-10-06", netPaid: 97_000, fee: 3_000, status: "SUCCESSFUL" },
      { id: "cafeteria:ref-1", payoutDate: "2026-10-06", netPaid: 20_000, fee: 3_000, status: "SUCCESSFUL" },
    ]);
    expect(r.pendingDeposit).toBe(15_000);
    expect(r.coverageFrom).toBe("2026-10-01");
    expect(r.coverageTo).toBe("2026-10-13");
    expect(r.partialReasons).toEqual([]);
    expect(r.warnings!.join(" ")).toMatch(/3 abono\(s\) SumUp en proceso, fallidos o sin fecha/);
  });

  it("una cuenta con ok:false deja todo no disponible con su errorClass", () => {
    const r = adaptSumupReconciliationResponse(response({}, [account(), { ok: false, account: "cafeteria", errorClass: "provider_unavailable" }]));
    expect(r).toEqual({ status: "unavailable", reason: "la cuenta Cafetería no respondió (provider_unavailable)." });
  });

  it.each([
    ["statusClass desconocido", { statusClass: "done" }],
    ["status desconocido", { status: "SUCCESSFUL" }],
    ["sin id", { id: "" }],
    ["fecha inválida", { payoutDate: "06-10-2026" }],
    ["monto inválido", { netPaid: 1.5 }],
  ])("vocabulario o dato desconocido (%s): no disponible, nunca 0 en silencio", (_l, o) => {
    expect(adaptSumupReconciliationResponse(response({}, [account({ settlements: [settlement(o)] })])).status).toBe("unavailable");
  });

  it.each([
    ["sin readOnly", { readOnly: false }],
    ["período inválido", { period: { startDate: "2026-10-13", endDate: "2026-10-01" } }],
    ["sin cuentas", { accounts: [] }],
  ])("forma desconocida (%s): no disponible", (_l, o) => {
    expect(adaptSumupReconciliationResponse(response(o)).status).toBe("unavailable");
  });

  it("base indeterminada o pendiente inválido", () => {
    const r = adaptSumupReconciliationResponse(response({}, [account({ basis: { basis: "indeterminate" } })]));
    expect(r.status === "available" && r.partialReasons).toEqual([expect.stringMatching(/netos o brutos/)]);
    expect(adaptSumupReconciliationResponse(response({}, [account({ basis: { basis: "otra" } })])).status).toBe("unavailable");
    expect(adaptSumupReconciliationResponse(response({}, [account({ pendingAmount: -1 })])).status).toBe("unavailable");
  });

  it("abono exitoso que requiere revisión por moneda o monto: no suma y deja el saldo parcial", () => {
    const r = adaptSumupReconciliationResponse(
      response({}, [account({ settlements: [settlement({ status: "REQUIERE_REVISION", reasons: ["currency_issue"] }), settlement({ id: "ok", status: "REQUIERE_REVISION", reasons: ["fee_missing"], netPaid: 1 })] })]),
    );
    expect(r.status === "available" && r.payouts.map((p) => p.id)).toEqual(["offerings:ok"]);
    expect(r.status === "available" && r.partialReasons![0]).toMatch(/requiere revisión/);
  });

  it("varias ventanas: deduplica por id, cuenta cada abono solo en la ventana de su fecha y detecta huecos", () => {
    const w1 = response({ period: { startDate: "2026-08-01", endDate: "2026-09-04" } }, [
      account({ pendingAmount: 0, settlements: [settlement({ id: "a", payoutDate: "2026-09-03" }), settlement({ id: "b", payoutDate: "2026-09-08", inWindow: false })] }),
    ]);
    const w2 = response({ period: { startDate: "2026-09-05", endDate: "2026-10-09" } }, [
      account({ pendingAmount: 4_000, settlements: [settlement({ id: "b", payoutDate: "2026-09-08" }), settlement({ id: "a", payoutDate: "2026-09-03" })] }),
    ]);
    const r = adaptSumupReconciliationResponse([w2, w1], "2026-10-13");
    expect(r.status === "available" && r.payouts.map((p) => p.id)).toEqual(["offerings:a", "offerings:b"]);
    expect(r.status === "available" && r.coverageFrom).toBe("2026-08-01");
    expect(r.status === "available" && r.pendingDeposit).toBe(4_000);
    const gap = adaptSumupReconciliationResponse([w1, response({ period: { startDate: "2026-09-10", endDate: "2026-10-13" } })]);
    expect(gap.status === "available" && gap.partialReasons).toContain("Falta consultar a SumUp desde el 2026-09-05.");
    expect(adaptSumupReconciliationResponse([w1, w1]).status).toBe("unavailable");
  });

  it("cobertura que empieza después de hoy: parcial", () => {
    const r = adaptSumupReconciliationResponse(response({ period: { startDate: "2026-10-20", endDate: "2026-10-21" } }), "2026-10-13");
    expect(r.status === "available" && r.partialReasons).toContain("El período consultado a SumUp empieza después de hoy.");
  });

  it("de punta a punta: abono neto suma y el estimado queda completo", () => {
    const payouts = adaptSumupReconciliationResponse(response(), "2026-10-13");
    const r = computeBankBalance({
      account: { openingBalance: 1_000_000, openingDate: "2026-09-30", openingCash: null },
      ledger: [],
      treasury: [],
      payouts,
      asOf: "2026-10-13",
    });
    expect(r.status).toBe("complete");
    expect(r.bank!.estimated).toBe(1_097_000);
  });
});

describe("ventanas y llamada a la callable", () => {
  it("ventanas contiguas de 35 días desde el día siguiente al corte hasta hoy", () => {
    expect(payoutWindows("2026-09-30", "2026-10-13")).toEqual([{ startDate: "2026-10-01", endDate: "2026-10-13" }]);
    const w = payoutWindows("2026-07-31", "2026-10-13");
    expect(w).toEqual([
      { startDate: "2026-08-01", endDate: "2026-09-04" },
      { startDate: "2026-09-05", endDate: "2026-10-09" },
      { startDate: "2026-10-10", endDate: "2026-10-13" },
    ]);
    expect(payoutWindows("2026-10-13", "2026-10-13")).toEqual([]);
    expect(payoutWindows("2020-01-01", "2026-10-13")).toHaveLength(11);
  });

  it("consulta cada ventana con account 'both' y adapta", async () => {
    const call = vi.fn(async (input: { startDate: string; endDate: string }) => response({ period: { startDate: input.startDate, endDate: input.endDate } }, [account({ settlements: [] })]));
    const r = await fetchSumupPayoutsForBank(call, "2026-07-31", "2026-10-13");
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[0][0]).toEqual({ account: "both", startDate: "2026-08-01", endDate: "2026-09-04" });
    expect(r.status).toBe("available");
  });

  it("si la función no existe o falla: falla cerrado a 'no disponible'", async () => {
    const call = vi.fn(async () => {
      throw Object.assign(new Error("not found"), { code: "functions/not-found" });
    });
    const r = await fetchSumupPayoutsForBank(call, "2026-09-30", "2026-10-13");
    expect(r).toEqual({ status: "unavailable", reason: "la consulta de abonos SumUp no está disponible (not-found)." });
    const est = computeBankBalance({ account: { openingBalance: 1, openingDate: "2026-09-30", openingCash: null }, ledger: [], treasury: [], payouts: r, asOf: "2026-10-13" });
    expect(est.status).toBe("partial");
    expect(est.incompleteReasons[0]).toMatch(/Faltan los abonos SumUp/);
  });
});

describe("resolveBankBalanceState: nunca un número con una consulta fallida", () => {
  const acc = { data: { id: "main", name: "Cuenta", openingBalance: 1_000, openingDate: "2026-09-30", openingCash: null, statementReference: "", revision: 1 } as never, loading: false, error: "" };
  const ok = { data: [], loading: false, error: "" };
  const base = { account: acc, ledger: [ok, ok], treasury: ok, payouts: null, asOf: "2026-10-13", accountId: "main", enabled: true };

  it("índice faltante en el libro: result null y error visible", () => {
    const s = resolveBankBalanceState({ ...base, payouts: { status: "unavailable", reason: "x" }, ledger: [{ data: [], loading: false, error: "La consulta necesita un índice de Firestore." }, ok] });
    expect(s.result).toBeNull();
    expect(s.error).toMatch(/índice/);
  });
  it("error en tesorería o en la cuenta: result null", () => {
    expect(resolveBankBalanceState({ ...base, treasury: { data: [], loading: false, error: "denegado" } }).result).toBeNull();
    expect(resolveBankBalanceState({ ...base, account: { ...acc, error: "sin conexión" } }).result).toBeNull();
  });
  it("abonos cargando (null): estado cargando, sin número", () => {
    const s = resolveBankBalanceState(base);
    expect(s.loading).toBe(true);
    expect(s.result).toBeNull();
  });
  it("todo bien: calcula", () => {
    const s = resolveBankBalanceState({ ...base, payouts: { status: "unavailable", reason: "x" } });
    expect(s.result?.bank?.estimated).toBe(1_000);
  });
  it("sin cuenta: no espera a los abonos y queda sin configurar", () => {
    const s = resolveBankBalanceState({ ...base, account: { data: null, loading: false, error: "" } });
    expect(s.result?.status).toBe("unconfigured");
  });
});
