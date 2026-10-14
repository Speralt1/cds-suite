// @vitest-environment node
// Callable sumupPayoutsReconciliation (functions/sumup-payouts/read.js, doc 29):
// auth, validación, GET-only con fetch simulado, aislamiento por cuenta,
// solo lectura y secretos que nunca se filtran. Sin red ni Firebase real.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { cafeteriaCase, groupedOfferingsCase } from "./sumup-payouts-fixtures";

const require = createRequire(import.meta.url);
const read = require("../../functions/sumup-payouts/read.js");
const { HttpsError } = require("../../functions/node_modules/firebase-functions/lib/v2/providers/https.js");

const ROOT = path.resolve(__dirname, "../..");
const FAKE = {
  offerings: { apiKey: "sup_sk_FICTICIO_OFR_123456", merchantCode: "MFAKEOFR1" },
  cafeteria: { apiKey: "sup_sk_FICTICIO_CAF_654321", merchantCode: "MFAKECAF2" },
};
const NOW = Date.parse("2026-10-20T15:00:00.000Z"); // 20-10-2026 12:00 Chile

const USERS: Record<string, Record<string, unknown> | null> = {
  "u-admin": { role: "admin", active: true },
  "u-pastor": { role: "pastor", active: true },
  "u-finance": { role: "finance", active: true },
  "u-reader-v1": { accessSchemaVersion: 1, role: "leader", active: true, baseRole: "standard", permissions: ["finance.details.read"] },
  "u-leader": { role: "leader", active: true },
  "u-summary-v1": { accessSchemaVersion: 1, role: "leader", active: true, baseRole: "standard", permissions: ["finance.summary.read"] },
  "u-finance-inactive": { role: "finance", active: false },
};

type Doc = Record<string, unknown>;

/** Store en memoria con la MISMA interfaz de solo lectura que createPayoutsReadStore. */
function memoryStore(salesDocs: Record<string, Doc[]>, financeDocs: Record<string, Doc> = {}) {
  const calls: string[] = [];
  return {
    calls,
    store: {
      async getUser(uid: string) {
        calls.push(`getUser:${uid}`);
        return USERS[uid] ?? null;
      },
      async listSales(account: string, fromMs: number, toMs: number) {
        calls.push(`listSales:${account}`);
        return (salesDocs[account] ?? []).filter((d) => {
          const ms = (d.timestamp as Date).getTime();
          return ms >= fromMs && ms < toMs;
        });
      },
      async getFinanceAmounts(ids: string[]) {
        calls.push(`getFinanceAmounts:${ids.length}`);
        const out: Record<string, { amount: number }> = {};
        for (const id of ids) if (financeDocs[id]) out[id] = { amount: Number(financeDocs[id].amount) };
        return out;
      },
    },
  };
}

/** Venta del fixture → documento crudo como lo escribe el motor (timestamp mediodía Chile). */
function saleDoc(s: { transactionCode: string; saleDate: string | null; grossAmount: number; refundedAmount: number; amountAfterRefunds: number; status: string; paymentType: string; currency: string }) {
  return {
    transactionCode: s.transactionCode,
    grossAmount: s.grossAmount,
    refundedAmount: s.refundedAmount,
    amountAfterRefunds: s.amountAfterRefunds,
    status: s.status,
    paymentType: s.paymentType,
    currency: s.currency,
    timestamp: new Date(`${s.saleDate}T15:00:00.000Z`),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function setup(opts: { fetchImpl?: (url: string, init: RequestInit) => Promise<unknown>; financeDocs?: Record<string, Doc>; getConfig?: (a: string) => unknown } = {}) {
  const caf = cafeteriaCase();
  const ofr = groupedOfferingsCase();
  const { store, calls } = memoryStore({ offerings: ofr.sales.map(saleDoc), cafeteria: caf.sales.map(saleDoc) }, opts.financeDocs);
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  const fetchImpl =
    opts.fetchImpl ??
    (async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return jsonResponse(url.includes(FAKE.offerings.merchantCode) ? ofr.rows : caf.rows);
    });
  const wrapped = async (url: string, init: RequestInit) => {
    if (opts.fetchImpl) fetchCalls.push({ url, init });
    return fetchImpl(url, init);
  };
  const logger = { error: vi.fn(), info: vi.fn() };
  const service = read.createPayoutsReconciliationService({
    store,
    getConfig: opts.getConfig ?? ((a: "offerings" | "cafeteria") => FAKE[a]),
    fetchImpl: wrapped,
    clock: { now: () => NOW },
    logger,
  });
  const handler = read.createPayoutsCallableHandler(service);
  const call = (uid: string | null, data: unknown) => handler({ auth: uid ? { uid } : undefined, data });
  return { call, calls, fetchCalls, logger };
}

const OCT = { startDate: "2026-10-01", endDate: "2026-10-31" };

async function expectHttpsError(p: Promise<unknown>, code: string, message: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpsError);
  expect((err as { code: string }).code).toBe(code);
  expect((err as Error).message).toBe(message);
}

describe("autorización", () => {
  it("sin sesión → unauthenticated, sin tocar SumUp ni Firestore de ventas", async () => {
    const { call, fetchCalls, calls } = setup();
    await expectHttpsError(call(null, OCT), "unauthenticated", "sumup-payouts/unauthenticated");
    expect(fetchCalls).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it.each(["u-leader", "u-summary-v1", "u-finance-inactive", "u-unknown"])("%s → permission-denied", async (uid) => {
    const { call, fetchCalls } = setup();
    await expectHttpsError(call(uid, OCT), "permission-denied", "sumup-payouts/forbidden");
    expect(fetchCalls).toHaveLength(0);
  });

  it.each(["u-admin", "u-pastor", "u-finance", "u-reader-v1"])("%s (finance.details.read) → OK", async (uid) => {
    const { call } = setup();
    const res = (await call(uid, OCT)) as { readOnly: boolean };
    expect(res.readOnly).toBe(true);
  });
});

describe("validación de entrada", () => {
  it("> 35 días → window-too-long", async () => {
    const { call, fetchCalls } = setup();
    await expectHttpsError(call("u-admin", { startDate: "2026-09-01", endDate: "2026-10-06" }), "invalid-argument", "sumup-payouts/window-too-long");
    expect(fetchCalls).toHaveLength(0);
  });

  it.each([
    [{ account: "otra", ...OCT }],
    [{ startDate: "2026-10-31", endDate: "2026-10-01" }],
    [{ startDate: "10/01/2026", endDate: "2026-10-31" }],
    [{}],
    [null],
  ])("entrada inválida %j → invalid-input", async (data) => {
    const { call } = setup();
    await expectHttpsError(call("u-admin", data), "invalid-argument", "sumup-payouts/invalid-input");
  });
});

describe("conciliación con fetch simulado", () => {
  it("ambas cuentas: abonos conciliados con los montos de la evidencia", async () => {
    const { call } = setup();
    const res = (await call("u-finance", OCT)) as {
      accounts: { account: string; ok: boolean; settlements: { grossSales: number; fee: number; netPaid: number; status: string }[]; proposals: { amount: number; writesLedger: boolean }[] }[];
      totals: { grossSales: number; fee: number; netPaid: number };
      payoutFetch: { startDate: string; endDate: string };
      asOfDate: string;
    };
    expect(res.asOfDate).toBe("2026-10-20");
    expect(res.payoutFetch).toEqual({ startDate: "2026-10-01", endDate: "2026-10-20" });
    const [ofr, caf] = res.accounts;
    expect(ofr).toMatchObject({ account: "offerings", ok: true });
    expect(ofr.settlements.map((s) => [s.grossSales, s.fee, s.netPaid, s.status])).toEqual([[100_522, 3_352, 97_170, "CONCILIADO"]]);
    expect(caf.settlements.map((s) => [s.grossSales, s.fee, s.netPaid, s.status])).toEqual([[462_500, 15_968, 446_532, "CONCILIADO"]]);
    expect(res.totals).toMatchObject({ grossSales: 563_022, fee: 19_320, netPaid: 543_702 });
    for (const a of res.accounts) for (const p of a.proposals) expect(p.writesLedger).toBe(false);
  });

  it("solo llama GET /v1.0/merchants/{mc}/payouts con fechas, limit y order, y Bearer", async () => {
    const { call, fetchCalls } = setup();
    await call("u-admin", { account: "cafeteria", ...OCT });
    expect(fetchCalls).toHaveLength(1);
    const { url, init } = fetchCalls[0];
    const u = new URL(url);
    expect(u.origin).toBe("https://api.sumup.com");
    expect(u.pathname).toBe(`/v1.0/merchants/${FAKE.cafeteria.merchantCode}/payouts`);
    expect(Object.fromEntries(u.searchParams)).toEqual({ start_date: "2026-10-01", end_date: "2026-10-20", limit: "9999", order: "asc" });
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE.cafeteria.apiKey}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("cuenta única: solo esa cuenta en la respuesta, pero lee ventas de ambas (detección de otra cuenta)", async () => {
    const { call, calls } = setup();
    const res = (await call("u-admin", { account: "offerings", ...OCT })) as { accounts: { account: string }[] };
    expect(res.accounts.map((a) => a.account)).toEqual(["offerings"]);
    expect(calls).toContain("listSales:offerings");
    expect(calls).toContain("listSales:cafeteria");
  });

  it("una cuenta falla (401) y la otra sigue: aislamiento por cuenta", async () => {
    const caf = cafeteriaCase();
    const { call } = setup({
      fetchImpl: async (url) => (url.includes(FAKE.offerings.merchantCode) ? jsonResponse({ error: "unauthorized" }, 401) : jsonResponse(caf.rows)),
    });
    const res = (await call("u-admin", OCT)) as { accounts: { account: string; ok: boolean; errorClass: string | null; settlements?: unknown[] }[] };
    expect(res.accounts[0]).toEqual({ ok: false, account: "offerings", errorClass: "auth_error" });
    expect(res.accounts[1]).toMatchObject({ ok: true, errorClass: null });
    expect(res.accounts[1].settlements).toHaveLength(1);
  });

  it.each([
    [403, "scope_missing"],
    [429, "rate_limited"],
    [503, "provider_unavailable"],
    [400, "provider_client_error"],
  ])("HTTP %i → %s", async (status, errorClass) => {
    const { call } = setup({ fetchImpl: async () => jsonResponse({}, status as number) });
    const res = (await call("u-admin", { account: "offerings", ...OCT })) as { accounts: { errorClass: string }[] };
    expect(res.accounts[0].errorClass).toBe(errorClass);
  });

  it("configuración ausente o secreto inválido → config_error, sin llamar a SumUp", async () => {
    const { call, fetchCalls } = setup({
      getConfig: (a) => {
        if (a === "offerings") throw new SyntaxError("Unexpected token");
        return {};
      },
    });
    const res = (await call("u-admin", OCT)) as { accounts: { errorClass: string }[] };
    expect(res.accounts.map((a) => a.errorClass)).toEqual(["config_error", "config_error"]);
    expect(fetchCalls).toHaveLength(0);
  });

  it("respuesta no JSON o con otra forma → provider_bad_response", async () => {
    const bad = setup({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("x"); } }) });
    expect(((await bad.call("u-admin", { account: "offerings", ...OCT })) as { accounts: { errorClass: string }[] }).accounts[0].errorClass).toBe("provider_bad_response");
    const odd = setup({ fetchImpl: async () => jsonResponse({ nope: true }) });
    expect(((await odd.call("u-admin", { account: "offerings", ...OCT })) as { accounts: { errorClass: string }[] }).accounts[0].errorClass).toBe("provider_bad_response");
  });

  it("acepta { items: [...] } además del arreglo plano", async () => {
    const ofr = groupedOfferingsCase();
    const { call } = setup({ fetchImpl: async () => jsonResponse({ items: ofr.rows }) });
    const res = (await call("u-admin", { account: "offerings", ...OCT })) as { accounts: { settlements: unknown[] }[] };
    expect(res.accounts[0].settlements).toHaveLength(1);
  });

  it("timeout: aborta y clasifica como timeout", async () => {
    const never = (_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    await expect(
      read.fetchPayouts({ config: FAKE.offerings, startDate: "2026-10-01", endDate: "2026-10-02", fetchImpl: never, timeoutMs: 20 }),
    ).rejects.toMatchObject({ errorClass: "timeout" });
  });

  it("comisión ya registrada en el libro con otro monto → propuesta en 'revision' con montos viejo/nuevo", async () => {
    const id = "sumup_fee_cafeteria_2026-10-13_" + require("../../functions/shared/sumup-payouts.js").shortHash("FICT PID CAFE 0001");
    const { call, calls } = setup({ financeDocs: { [id]: { amount: 15_000, status: "active" } } });
    const res = (await call("u-admin", { account: "cafeteria", ...OCT })) as { accounts: { proposals: { id: string; state: string; amount: number; previousAmount: number | null }[] }[] };
    expect(res.accounts[0].proposals[0]).toMatchObject({ id, state: "revision", amount: 15_968, previousAmount: 15_000 });
    expect(calls.some((c) => c.startsWith("getFinanceAmounts:"))).toBe(true);
  });

  it("rerun idéntico → misma respuesta (idempotente)", async () => {
    const { call } = setup();
    expect(await call("u-admin", OCT)).toEqual(await call("u-admin", OCT));
  });

  it("emulador: offlineFetch nunca sale a la red", async () => {
    await expect(read.offlineFetch()).rejects.toMatchObject({ errorClass: "emulator_offline" });
    const { call } = setup({ fetchImpl: read.offlineFetch });
    const res = (await call("u-admin", OCT)) as { accounts: { errorClass: string }[] };
    expect(res.accounts.map((a) => a.errorClass)).toEqual(["emulator_offline", "emulator_offline"]);
  });
});

describe("secretos: nunca en logs ni en la respuesta", () => {
  it("un error del proveedor que repite la clave no la filtra", async () => {
    const echo = async (url: string, init: RequestInit) =>
      jsonResponse({ message: `bad key ${(init.headers as Record<string, string>).Authorization} for ${url}` }, 500);
    const { call, logger } = setup({ fetchImpl: echo });
    const res = await call("u-admin", OCT);
    const logged = JSON.stringify(logger.error.mock.calls);
    const body = JSON.stringify(res);
    for (const cfg of Object.values(FAKE)) {
      for (const text of [logged, body]) {
        expect(text).not.toContain(cfg.apiKey);
        expect(text).not.toContain(cfg.merchantCode);
      }
    }
    expect(logger.error).toHaveBeenCalled();
  });

  it("una respuesta exitosa no incluye apiKey ni merchantCode", async () => {
    const { call, logger } = setup();
    const body = JSON.stringify(await call("u-admin", OCT));
    for (const cfg of Object.values(FAKE)) {
      expect(body).not.toContain(cfg.apiKey);
      expect(body).not.toContain(cfg.merchantCode);
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("un error inesperado → internal genérico, sin detalles", async () => {
    const service = read.createPayoutsReconciliationService({
      store: { getUser: async () => ({ role: "admin", active: true }), listSales: async () => { throw new Error(`boom ${FAKE.offerings.apiKey}`); }, getFinanceAmounts: async () => ({}) },
      getConfig: () => FAKE.offerings,
      fetchImpl: async () => jsonResponse([]),
      clock: { now: () => NOW },
      logger: { error: vi.fn() },
    });
    await expectHttpsError(service.handle("u-admin", OCT), "internal", "sumup-payouts/internal");
  });
});

describe("solo lectura", () => {
  function fakeDb() {
    const writes: string[] = [];
    const docRef = (p: string): Record<string, unknown> => ({
      path: p,
      get: async () => ({ exists: true, id: p, data: () => ({ role: "admin", active: true, amount: 5, status: "active" }) }),
      set: async () => writes.push(`set:${p}`),
      update: async () => writes.push(`update:${p}`),
      delete: async () => writes.push(`delete:${p}`),
      create: async () => writes.push(`create:${p}`),
      collection: (c: string) => collectionRef(`${p}/${c}`),
    });
    const query = (p: string): Record<string, unknown> => ({
      where: () => query(p),
      select: () => query(p),
      limit: () => query(p),
      orderBy: () => query(p),
      get: async () => ({ docs: [{ data: () => ({ transactionCode: "A", grossAmount: 1000, timestamp: new Date("2026-10-11T15:00:00Z") }) }] }),
    });
    const collectionRef = (p: string): Record<string, unknown> => ({ ...query(p), doc: (id: string) => docRef(`${p}/${id}`), add: async () => writes.push(`add:${p}`) });
    const db = {
      doc: (p: string) => docRef(p),
      collection: (p: string) => collectionRef(p),
      getAll: async (...refs: { path: string; get: () => Promise<unknown> }[]) => {
        // Debe recibir las refs reales (desenvueltas), no los proxies.
        for (const r of refs) if (typeof (r as unknown as { set: unknown }).set !== "function") throw new Error("ref no desenvuelta");
        return Promise.all(refs.map((r) => r.get()));
      },
      batch: () => ({ set: () => writes.push("batch.set"), commit: async () => writes.push("batch.commit") }),
      runTransaction: async () => writes.push("runTransaction"),
      bulkWriter: () => writes.push("bulkWriter"),
      recursiveDelete: async () => writes.push("recursiveDelete"),
    };
    return { db, writes };
  }

  it("readOnlyFirestore lanza ante cualquier escritura (db, doc, colección, subcolección)", () => {
    const { db, writes } = fakeDb();
    const ro = read.readOnlyFirestore(db);
    const attempts: (() => unknown)[] = [
      () => ro.doc("financeTransactions/x").set({ amount: 1 }),
      () => ro.doc("financeTransactions/x").update({ amount: 1 }),
      () => ro.doc("financeTransactions/x").delete(),
      () => ro.doc("financeTransactions/x").create({}),
      () => ro.collection("financeTransactions").add({}),
      () => ro.collection("sumupIntegrations").doc("offerings").collection("transactions").doc("t").set({}),
      () => ro.batch(),
      () => ro.runTransaction(async () => null),
      () => ro.bulkWriter(),
      () => ro.recursiveDelete(ro.doc("a/b")),
    ];
    for (const attempt of attempts) expect(attempt).toThrow(read.ReadOnlyViolation);
    expect(writes).toEqual([]);
  });

  it("el store real solo expone lecturas y funciona sobre el db envuelto", async () => {
    const { db, writes } = fakeDb();
    const store = read.createPayoutsReadStore({ db });
    expect(Object.keys(store).sort()).toEqual(["getFinanceAmounts", "getUser", "listSales"]);
    expect(Object.isFrozen(store)).toBe(true);
    expect(await store.getUser("u1")).toEqual({ role: "admin", active: true, amount: 5, status: "active" });
    expect(await store.listSales("offerings", 0, Date.now())).toHaveLength(1);
    expect(await store.getFinanceAmounts(["sumup_fee_x"])).toEqual({ sumup_fee_x: { amount: 5 } });
    expect(writes).toEqual([]);
  });

  it("toSaleRecord convierte Timestamp → día local de Chile", () => {
    const ts = { toMillis: () => Date.parse("2026-10-12T02:30:00.000Z") };
    expect(read.toSaleRecord("offerings", { transactionCode: "A", grossAmount: 1000.4, timestamp: ts })).toMatchObject({ saleDate: "2026-10-11", grossAmount: 1000 });
    expect(read.toSaleRecord("offerings", {}).saleDate).toBeNull();
  });

  it("el código del callable no contiene escrituras a Firestore ni otros métodos HTTP", () => {
    const src = fs.readFileSync(path.join(ROOT, "functions/sumup-payouts/read.js"), "utf8");
    // Solo los WeakMap internos de la guardia usan .set().
    expect(src).not.toMatch(/(?<!proxies|originals)\.(set|update|add|create|commit)\(/);
    expect(src).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
    expect(src).not.toMatch(/console\.log/);
    expect(src).not.toMatch(/require\("\.\.\/sumup\//);
  });
});

describe("cableado en functions/index.js", () => {
  const indexJs = fs.readFileSync(path.join(ROOT, "functions/index.js"), "utf8");

  it("una sola línea nueva: export aislado con la región y los secrets existentes", () => {
    expect(indexJs).toContain(
      'exports.sumupPayoutsReconciliation = require("./sumup-payouts/read").buildSumupPayoutsReconciliation({ db, region: REGION, secrets: [sumupOfferings, sumupCafe] });',
    );
  });

  it("build: onCall en southamerica-west1 con los dos secrets y sin llamadas en el import", () => {
    const fn = read.buildSumupPayoutsReconciliation({
      db: {},
      region: "southamerica-west1",
      secrets: [{ name: "SUMUP_OFFERINGS_CONFIG", value: () => FAKE.offerings }, { name: "SUMUP_CAFETERIA_CONFIG", value: () => FAKE.cafeteria }],
    });
    expect(typeof fn).toBe("function");
    const endpoint = (fn as unknown as { __endpoint: { region: string[]; callableTrigger: unknown; secretEnvironmentVariables?: { key: string }[] } }).__endpoint;
    expect(endpoint.region).toEqual(["southamerica-west1"]);
    expect(endpoint.callableTrigger).toBeDefined();
  });
});
