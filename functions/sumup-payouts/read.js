"use strict";

/**
 * functions/sumup-payouts/read.js
 *
 * Callable `sumupPayoutsReconciliation` — conciliación de abonos SumUp en
 * SOLO LECTURA (doc 29). Aislado del motor de ventas (functions/sumup/*): no
 * lo importa ni lo modifica.
 *
 *  - Auth: `finance.details.read` (modelo compartido, igual que la página
 *    Ofrendas y Cafetería). Sin sesión → unauthenticated; sin permiso → permission-denied.
 *  - Entrada: { account?: 'offerings'|'cafeteria'|'both', startDate, endDate } (≤ 35 días).
 *  - Único llamado HTTP: GET /v1.0/merchants/{mc}/payouts con timeout.
 *  - Lee (solo lectura) sumupIntegrations/{a}/transactions y, para detectar
 *    comisiones ya registradas, financeTransactions/{idPropuesta} (getAll).
 *  - NO ESCRIBE NADA: Firestore va envuelto en `readOnlyFirestore`, que lanza
 *    ante cualquier escritura; el store no expone métodos de escritura.
 *  - La apiKey y el merchantCode nunca se loguean ni se devuelven.
 *
 * Errores (HttpsError, message = clave): sumup-payouts/unauthenticated ·
 * sumup-payouts/forbidden · sumup-payouts/invalid-input ·
 * sumup-payouts/window-too-long · sumup-payouts/internal
 */

const { HttpsError } = require("firebase-functions/v2/https");
const { can } = require("../shared/access");
const payouts = require("../shared/sumup-payouts");

const PAYOUTS_ERROR_KEYS = Object.freeze({
  unauthenticated: "sumup-payouts/unauthenticated",
  forbidden: "sumup-payouts/forbidden",
  invalidInput: "sumup-payouts/invalid-input",
  windowTooLong: "sumup-payouts/window-too-long",
  internal: "sumup-payouts/internal",
});

const ACCOUNT_CHOICES = Object.freeze(["offerings", "cafeteria", "both"]);
const FETCH_TIMEOUT_MS = 15_000;
const SALES_READ_LIMIT = 20_000;
const WRITE_METHODS = Object.freeze([
  "set",
  "update",
  "delete",
  "create",
  "add",
  "batch",
  "runTransaction",
  "bulkWriter",
  "recursiveDelete",
]);

// ---------------------------------------------------------------------------
// Guardia de solo lectura
// ---------------------------------------------------------------------------

class ReadOnlyViolation extends Error {
  constructor(method) {
    super(`sumup-payouts: escritura bloqueada (${method}); este módulo es de solo lectura.`);
    this.name = "ReadOnlyViolation";
  }
}

/**
 * Envuelve un Firestore (o cualquier ref/query que devuelva) en un Proxy que
 * lanza ReadOnlyViolation al pedir un método de escritura. Las lecturas pasan
 * al objeto real (con `this` = objeto real). `getAll` desenvuelve sus refs.
 */
function readOnlyFirestore(target) {
  const proxies = new WeakMap();
  const originals = new WeakMap();

  function unwrap(value) {
    return value && typeof value === "object" && originals.has(value) ? originals.get(value) : value;
  }

  function wrap(value) {
    if (!value || typeof value !== "object") return value;
    if (typeof value.then === "function") return value.then(wrap);
    if (proxies.has(value)) return proxies.get(value);
    // Solo se envuelven objetos con capacidad de escribir o de navegar a refs
    // (Firestore, refs, colecciones, queries); los datos leídos pasan tal cual.
    const navigable =
      WRITE_METHODS.some((m) => typeof value[m] === "function") ||
      ["doc", "collection", "where", "getAll"].some((m) => typeof value[m] === "function");
    if (!navigable) return value;
    const proxy = new Proxy(value, {
      get(obj, prop) {
        if (typeof prop === "string" && WRITE_METHODS.includes(prop)) {
          return () => {
            throw new ReadOnlyViolation(prop);
          };
        }
        const v = obj[prop];
        if (typeof v === "function") {
          return (...args) => wrap(v.apply(obj, args.map(unwrap)));
        }
        return v;
      },
      set() {
        throw new ReadOnlyViolation("assign");
      },
    });
    proxies.set(value, proxy);
    originals.set(proxy, value);
    return proxy;
  }

  return wrap(target);
}

// ---------------------------------------------------------------------------
// Store de solo lectura
// ---------------------------------------------------------------------------

function toMillis(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function toInt(value) {
  const n = payouts.roundClp(value);
  return n === null ? 0 : n;
}

/** Documento crudo de venta → SaleRecord (día local de Chile). */
function toSaleRecord(account, data) {
  const ms = toMillis(data && data.timestamp);
  return {
    account,
    transactionCode: String((data && data.transactionCode) || ""),
    saleDate: ms === null ? null : payouts.chileDate(ms),
    grossAmount: toInt(data && data.grossAmount),
    refundedAmount: toInt(data && data.refundedAmount),
    amountAfterRefunds: toInt(data && data.amountAfterRefunds),
    status: String((data && data.status) || ""),
    paymentType: String((data && data.paymentType) || ""),
    currency: String((data && data.currency) || ""),
  };
}

/**
 * Store real, solo lectura. Métodos: getUser, listSales, getFinanceAmounts.
 * @param {{ db: FirebaseFirestore.Firestore }} deps
 */
function createPayoutsReadStore({ db }) {
  const ro = readOnlyFirestore(db);
  return Object.freeze({
    async getUser(uid) {
      const snap = await ro.doc(`users/${uid}`).get();
      return snap.exists ? snap.data() : null;
    },

    /** Ventas con timestamp en [fromMs, toMs) (margen amplio; el día local se filtra en memoria). */
    async listSales(account, fromMs, toMs) {
      const snap = await ro
        .collection(`sumupIntegrations/${account}/transactions`)
        .where("timestamp", ">=", new Date(fromMs))
        .where("timestamp", "<", new Date(toMs))
        .select("transactionCode", "grossAmount", "refundedAmount", "amountAfterRefunds", "status", "paymentType", "currency", "timestamp")
        .limit(SALES_READ_LIMIT)
        .get();
      return snap.docs.map((d) => d.data());
    },

    /** Montos de comisiones ya registradas en el libro (id → { amount }), solo activas. */
    async getFinanceAmounts(ids) {
      const out = {};
      if (!ids.length) return out;
      const refs = ids.map((id) => ro.doc(`financeTransactions/${id}`));
      const snaps = await ro.getAll(...refs);
      snaps.forEach((snap, i) => {
        if (!snap.exists) return;
        const data = snap.data() || {};
        if (data.status === "voided") return;
        out[ids[i]] = { amount: toInt(data.amount) };
      });
      return out;
    },
  });
}

// ---------------------------------------------------------------------------
// HTTP: solo GET /payouts
// ---------------------------------------------------------------------------

function payoutsError(errorClass, status) {
  const err = new Error(`sumup payouts: ${errorClass}`);
  err.errorClass = errorClass;
  if (status) err.status = status;
  return err;
}

function classifyStatus(status) {
  if (status === 401) return "auth_error";
  if (status === 403) return "scope_missing";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "provider_client_error";
}

/**
 * GET https://api.sumup.com/v1.0/merchants/{mc}/payouts?start_date&end_date&limit=9999&order=asc
 * Nunca incluye URL, merchantCode, apiKey ni cuerpo de respuesta en los errores.
 */
async function fetchPayouts({ config, startDate, endDate, fetchImpl, timeoutMs = FETCH_TIMEOUT_MS }) {
  const apiKey = config && typeof config.apiKey === "string" ? config.apiKey : "";
  const merchantCode = config && typeof config.merchantCode === "string" ? config.merchantCode : "";
  if (!apiKey || !merchantCode) throw payoutsError("config_error");
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate, limit: "9999", order: "asc" });
  const url = `https://api.sumup.com/v1.0/merchants/${encodeURIComponent(merchantCode)}/payouts?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.errorClass) throw error;
    throw payoutsError(error && error.name === "AbortError" ? "timeout" : "provider_unavailable");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw payoutsError(classifyStatus(response.status), response.status);
  let body;
  try {
    body = await response.json();
  } catch {
    throw payoutsError("provider_bad_response");
  }
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.items)) return body.items;
  throw payoutsError("provider_bad_response");
}

/** fetch del emulador: nunca sale a la red (sin SumUp real en local). */
async function offlineFetch() {
  throw payoutsError("emulator_offline");
}

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

function parseInput(data) {
  const input = data && typeof data === "object" ? data : {};
  const choice = input.account === undefined || input.account === null ? "both" : input.account;
  if (!ACCOUNT_CHOICES.includes(choice)) return { error: PAYOUTS_ERROR_KEYS.invalidInput };
  return { choice, startDate: input.startDate, endDate: input.endDate };
}

/**
 * @param {{
 *   store: { getUser(uid): Promise<object|null>, listSales(account, fromMs, toMs): Promise<object[]>, getFinanceAmounts(ids): Promise<object> },
 *   getConfig: (account: 'offerings'|'cafeteria') => object,
 *   fetchImpl: typeof fetch,
 *   clock: { now(): number },
 *   logger?: { error: Function, info?: Function },
 *   options?: object,
 * }} deps
 */
function createPayoutsReconciliationService({ store, getConfig, fetchImpl, clock, logger = console, options = {} }) {
  if (!store || !getConfig || !fetchImpl || !clock) throw new Error("createPayoutsReconciliationService: dependencias incompletas");

  async function authorize(uid) {
    if (!uid || typeof uid !== "string") throw new HttpsError("unauthenticated", PAYOUTS_ERROR_KEYS.unauthenticated);
    const userDoc = await store.getUser(uid);
    if (!can(userDoc, "finance.details.read")) throw new HttpsError("permission-denied", PAYOUTS_ERROR_KEYS.forbidden);
  }

  async function loadRows(account, fetchWindow) {
    if (!fetchWindow) return { rows: [], errorClass: null };
    let config;
    try {
      config = getConfig(account);
    } catch {
      return { rows: null, errorClass: "config_error" };
    }
    try {
      const rows = await fetchPayouts({ config, startDate: fetchWindow.startDate, endDate: fetchWindow.endDate, fetchImpl });
      return { rows, errorClass: null };
    } catch (error) {
      const errorClass = (error && error.errorClass) || "provider_unavailable";
      logger.error("sumupPayoutsReconciliation fetch", { account, errorClass });
      return { rows: null, errorClass };
    }
  }

  async function run(choice, plan, asOfDate) {
    const accounts = choice === "both" ? ["offerings", "cafeteria"] : [choice];
    // Ventas de AMBAS cuentas: así una fila de la otra cuenta se detecta como tal.
    const fromMs = Date.parse(`${plan.salesRead.startDate}T00:00:00.000Z`) - 86_400_000;
    const toMs = Date.parse(`${plan.salesRead.endDate}T00:00:00.000Z`) + 2 * 86_400_000;
    const [rowResults, salesLists] = await Promise.all([
      Promise.all(accounts.map((a) => loadRows(a, plan.payoutFetch))),
      Promise.all(payouts.SUMUP_ACCOUNTS.map((a) => store.listSales(a, fromMs, toMs))),
    ]);
    const salesByAccount = {};
    payouts.SUMUP_ACCOUNTS.forEach((a, i) => {
      salesByAccount[a] = salesLists[i]
        .map((d) => toSaleRecord(a, d))
        .filter((s) => s.saleDate && s.saleDate >= plan.salesRead.startDate && s.saleDate <= plan.salesRead.endDate);
    });

    const policy = options.accountingDatePolicy || "payout_date";
    const okAccounts = accounts.filter((_, i) => rowResults[i].rows !== null);
    const rowsByAccount = {};
    const candidateIds = [];
    accounts.forEach((a, i) => {
      if (rowResults[i].rows === null) return;
      rowsByAccount[a] = rowResults[i].rows;
      candidateIds.push(...payouts.candidateProposalIds(a, rowResults[i].rows, policy, salesByAccount[a]));
    });
    const previousProposals = await store.getFinanceAmounts([...new Set(candidateIds)]);

    const result = payouts.reconcile({
      accounts: okAccounts,
      rowsByAccount,
      salesByAccount,
      window: { startDate: plan.startDate, endDate: plan.endDate },
      asOfDate,
      options: { ...options, accountingDatePolicy: policy, previousProposals },
    });

    const byAccount = new Map(result.accounts.map((r) => [r.account, r]));
    return {
      readOnly: true,
      window: result.window,
      payoutFetch: plan.payoutFetch,
      salesRead: plan.salesRead,
      asOfDate,
      policy: result.policy,
      differenceBusinessDays: result.differenceBusinessDays,
      accounts: accounts.map((a, i) => {
        const r = byAccount.get(a);
        return r ? { ok: true, errorClass: null, ...r } : { ok: false, account: a, errorClass: rowResults[i].errorClass };
      }),
      totals: result.totals,
    };
  }

  /** Punto de entrada del callable. */
  async function handle(uid, data) {
    try {
      await authorize(uid);
      const parsed = parseInput(data);
      if (parsed.error) throw new HttpsError("invalid-argument", parsed.error);
      const asOfDate = payouts.chileDate(clock.now());
      const planned = payouts.planWindow(parsed.startDate, parsed.endDate, asOfDate);
      if (!planned.ok) {
        throw new HttpsError(
          "invalid-argument",
          planned.error === "window_too_long" ? PAYOUTS_ERROR_KEYS.windowTooLong : PAYOUTS_ERROR_KEYS.invalidInput,
        );
      }
      return await run(parsed.choice, planned.plan, asOfDate);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error("sumupPayoutsReconciliation", {
        name: error && error.name ? String(error.name) : "Error",
        code: error && error.code !== undefined ? String(error.code) : undefined,
      });
      throw new HttpsError("internal", PAYOUTS_ERROR_KEYS.internal);
    }
  }

  return { authorize, handle };
}

/** Adaptador onCall. */
function createPayoutsCallableHandler(service) {
  return async function sumupPayoutsReconciliationHandler(request) {
    const uid = request && request.auth && typeof request.auth.uid === "string" ? request.auth.uid : null;
    return service.handle(uid, request ? request.data : undefined);
  };
}

/**
 * Cableado real (functions/index.js). Reutiliza los secrets ya declarados y la
 * región de las demás Functions. En el emulador nunca sale a la red.
 */
function buildSumupPayoutsReconciliation({ db, region, secrets }) {
  const { onCall } = require("firebase-functions/v2/https");
  const [offeringsSecret, cafeteriaSecret] = secrets;
  const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
  const service = createPayoutsReconciliationService({
    store: createPayoutsReadStore({ db }),
    getConfig: (account) => (account === "offerings" ? offeringsSecret : cafeteriaSecret).value(),
    fetchImpl: isEmulator ? offlineFetch : (...args) => fetch(...args),
    clock: { now: () => Date.now() },
  });
  return onCall({ region, timeoutSeconds: 60, memory: "256MiB", maxInstances: 3, secrets }, createPayoutsCallableHandler(service));
}

module.exports = {
  PAYOUTS_ERROR_KEYS,
  ACCOUNT_CHOICES,
  WRITE_METHODS,
  ReadOnlyViolation,
  readOnlyFirestore,
  createPayoutsReadStore,
  toSaleRecord,
  fetchPayouts,
  offlineFetch,
  createPayoutsReconciliationService,
  createPayoutsCallableHandler,
  buildSumupPayoutsReconciliation,
};
