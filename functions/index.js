const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineJsonSecret, defineBoolean } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const core = require("./sumup/core");
const engine = require("./sumup/engine");
const { createFirestoreStore } = require("./sumup/firestore-store");

initializeApp();

const db = getFirestore();
const REGION = "southamerica-west1";
const PROJECT = "cds-administracion";
const SITE = `https://${PROJECT}.web.app`;
const SUMUP_SPLIT_START_DATE = core.SUMUP_SPLIT_START_DATE;
const SUMUP_LEGACY_CATEGORY = core.SUMUP_LEGACY_CATEGORY;

const sumupOfferings = defineJsonSecret("SUMUP_OFFERINGS_CONFIG");
const sumupCafe = defineJsonSecret("SUMUP_CAFETERIA_CONFIG");
// Slice 3a — starts OFF (spec §Interruptor). While off, ingestion still
// writes sumupPayouts + settlement.* and the UI already shows commission
// and deposit; turning it on to create expense movements + the September
// backfill is a migration that needs human OK.
const sumupFeesLedgerEnabled = defineBoolean("SUMUP_FEES_LEDGER_ENABLED", { default: false });

const store = createFirestoreStore({ db, FieldValue, Timestamp });
const clock = { now: () => Date.now() };

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clp(value) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function campaignDescription(data) {
  const progress = data.goalAmount
    ? Math.min(100, Math.max(0, (data.verifiedAmount / data.goalAmount) * 100))
    : 0;
  const quota = data.totalInstallments > 0
    ? `Cuota ${data.currentInstallment} de ${data.totalInstallments} · `
    : "";
  return `${quota}${clp(data.verifiedAmount)} recaudados de ${clp(data.goalAmount)} · ${progress.toFixed(1).replace(".0", "")}% de avance`;
}

exports.campaignShare = onRequest(
  { region: REGION, timeoutSeconds: 20 },
  async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.status(405).send('Method Not Allowed');
      return;
    }

    try {
      const parts = req.path.split('/').filter(Boolean);
      const slug = decodeURIComponent(parts.at(-1) || '');
      if (!slug) {
        res.status(404).send('Campaña no encontrada');
        return;
      }

      const snapshot = await db.doc(`campaignPublicViews/${slug}`).get();
      if (!snapshot.exists || snapshot.data().isPublic !== true || snapshot.data().status !== 'active') {
        res.status(404).send('Campaña no disponible');
        return;
      }

      const data = snapshot.data();
      const title = `${data.title} | Casa de Salvación`;
      const description = campaignDescription(data);
      const shareUrl = `${SITE}/c/${encodeURIComponent(slug)}`;
      const targetUrl = `${SITE}/campanas/${encodeURIComponent(slug)}`;
      const imageUrl = `${SITE}/icon-512.png?v=3`;

      res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
      res.set('Content-Type', 'text/html; charset=utf-8');
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }

      res.status(200).send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Casa de Salvación">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(shareUrl)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:image:width" content="512">
  <meta property="og:image:height" content="512">
  <meta property="og:image:alt" content="${escapeHtml(data.title)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="robots" content="noindex,nofollow">
</head>
<body>
  <p>Abriendo campaña de Casa de Salvación…</p>
  <p><a href="${escapeHtml(targetUrl)}">Ver campaña</a></p>
  <script>window.location.replace(${JSON.stringify(targetUrl)});</script>
</body>
</html>`);
    } catch (error) {
      console.error('campaignShare', error);
      res.status(500).send('No pudimos abrir la campaña.');
    }
  },
);

/**
 * fetchPage — the only place that talks HTTP to SumUp. `cursor` is either
 * null (first page: build the query from changesSince/order/limit) or a
 * `links.next` href from a previous page (may be relative or absolute).
 * Every call gets its own 15s AbortController (S1.7).
 */
async function fetchPage({ config, changesSince, order, limit, cursor }) {
  const { apiKey, merchantCode } = config || {};
  if (!apiKey || !merchantCode) {
    const err = new Error("Configuración SumUp incompleta.");
    err.errorClass = "config_error";
    throw err;
  }

  const endpoint = `https://api.sumup.com/v2.1/merchants/${encodeURIComponent(merchantCode)}/transactions/history`;
  let url;
  if (cursor) {
    url = cursor.startsWith("http") ? cursor : `${endpoint}?${String(cursor).replace(/^\?/, "")}`;
  } else {
    const params = new URLSearchParams({ order, limit: String(limit) });
    if (changesSince) params.set("changes_since", changesSince);
    url = `${endpoint}?${params.toString()}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      const err = new Error("SumUp timeout (15s)");
      err.errorClass = "provider_unavailable";
      throw err;
    }
    const err = new Error(String(error.message || error));
    err.errorClass = "provider_unavailable";
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`SumUp ${response.status}: ${text.slice(0, 300)}`);
    err.status = response.status;
    err.errorClass = core.classifyHttpError({ status: response.status });
    throw err;
  }

  const body = await response.json();
  const items = Array.isArray(body.items) ? body.items : [];
  const next = (body.links || []).find((link) => link.rel === "next");
  return { items, nextCursor: next?.href || null };
}

/**
 * fetchPayoutsFromApi — GET /v1.0/merchants/{mc}/payouts for one account and
 * date window (spec §Ingesta: limit=9999, order=asc, timeout). This is the
 * same endpoint G9's read-only probe (scripts/sumup-payouts-probe.mjs)
 * validated against real data before this slice was authorized.
 */
async function fetchPayoutsFromApi({ config, start, end }) {
  const { apiKey, merchantCode } = config || {};
  if (!apiKey || !merchantCode) {
    const err = new Error("Configuración SumUp incompleta.");
    err.errorClass = "config_error";
    throw err;
  }

  const params = new URLSearchParams({ start_date: start, end_date: end, limit: "9999", order: "asc" });
  const url = `https://api.sumup.com/v1.0/merchants/${encodeURIComponent(merchantCode)}/payouts?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      const err = new Error("SumUp payouts timeout (20s)");
      err.errorClass = "provider_unavailable";
      throw err;
    }
    const err = new Error(String(error.message || error));
    err.errorClass = "provider_unavailable";
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(`SumUp payouts ${response.status}: ${text.slice(0, 300)}`);
    err.status = response.status;
    // A 401/403 here means the API key lacks the payouts.read scope
    // (spec §Ingesta "Un 401 o 403 se registra como scope_missing").
    err.errorClass = response.status === 401 || response.status === 403 ? "scope_missing" : core.classifyHttpError({ status: response.status });
    throw err;
  }

  const body = await response.json();
  if (!Array.isArray(body)) {
    const err = new Error("SumUp payouts: respuesta inesperada (se esperaba un array).");
    err.errorClass = "provider_unavailable";
    throw err;
  }
  return body;
}

const MAX_PAYOUTS_WINDOW_DAYS = 35;

function clampPayoutsWindow(startDate, endDate) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const end = /^\d{4}-\d{2}-\d{2}$/.test(endDate || "") ? endDate : todayStr;
  let start = /^\d{4}-\d{2}-\d{2}$/.test(startDate || "") ? startDate : null;
  const endMs = new Date(`${end}T00:00:00Z`).getTime();
  const minStartMs = endMs - (MAX_PAYOUTS_WINDOW_DAYS - 1) * 86_400_000;
  const minStart = new Date(minStartMs).toISOString().slice(0, 10);
  if (!start || start < minStart) start = minStart;
  if (start > end) start = end;
  return { start, end };
}

async function requireRoleUser(req, allowedRoles) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('UNAUTHENTICATED');

  const decoded = await getAuth().verifyIdToken(match[1]);
  const user = await db.doc(`users/${decoded.uid}`).get();
  if (!user.exists || user.data().active !== true || !allowedRoles.includes(user.data().role)) {
    throw new Error('FORBIDDEN');
  }
  return decoded.uid;
}

async function requireFinanceUser(req) {
  return requireRoleUser(req, ['admin', 'pastor', 'finance']);
}

/** sumupPayoutsNow (Slice 3a) is admin-only per spec §Ingesta "Funciones". */
async function requireAdminUser(req) {
  return requireRoleUser(req, ['admin']);
}

async function ensureSumUpSystemCategory() {
  const ref = db.doc('appSettings/finance');
  const snap = await ref.get();
  if (!snap.exists) return;

  const data = snap.data();
  const all = Array.isArray(data.incomeCategoriesAll)
    ? data.incomeCategoriesAll
    : [];

  if (all.includes(SUMUP_LEGACY_CATEGORY)) return;

  await ref.set(
    {
      incomeCategoriesAll: [
        ...all,
        SUMUP_LEGACY_CATEGORY,
      ],
      updatedBy: 'system:sumup',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Runs one account's sync in isolation: never throws, always resolves to a result row. */
async function safeRunAccountSync(opts) {
  try {
    return await engine.runAccountSync(opts);
  } catch (error) {
    console.error(`sumup sync (${opts.account})`, error);
    return {
      account: opts.account,
      runId: null,
      status: "failed",
      counts: engine.emptyCounts(),
      errorClass: error.errorClass || core.classifyHttpError(error),
      errorMessage: String(error?.message || error),
    };
  }
}

async function safeRunLegacyPage(opts) {
  try {
    return await engine.runLegacyPage(opts);
  } catch (error) {
    console.error(`sumup legacy sync (${opts.account})`, error);
    return {
      account: opts.account,
      runId: null,
      status: "failed",
      counts: engine.emptyCounts(),
      errorClass: error.errorClass || core.classifyHttpError(error),
      errorMessage: String(error?.message || error),
    };
  }
}

function toApiResult(result) {
  return {
    account: result.account,
    runId: result.runId,
    status: result.status,
    counts: result.counts,
    errorClass: result.errorClass || null,
  };
}

exports.sumupSyncNow = onRequest(
  { region: REGION, timeoutSeconds: 55, secrets: [sumupOfferings, sumupCafe] },
  async (req, res) => {
    const origin = req.get('origin') || '';
    if (origin === SITE || origin === `https://${PROJECT}.firebaseapp.com`) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    }
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    // M5 — one absolute deadline computed from the moment this request
    // started, shared by both accounts, instead of a budget each one measures
    // from its own (slightly later) start. Manual runs get 25s of work,
    // leaving headroom under Hosting/Cloud Run's own timeout.
    const requestStartedAt = clock.now();
    const deadlineAt = requestStartedAt + 25_000;

    let uid;
    try {
      uid = await requireFinanceUser(req);
    } catch (error) {
      const message = String(error?.message || error);
      const status = message === 'UNAUTHENTICATED' ? 401 : message === 'FORBIDDEN' ? 403 : 401;
      console.error('sumupSyncNow auth', error);
      res.status(status).json({ ok: false, error: message });
      return;
    }

    try {
      await ensureSumUpSystemCategory();
    } catch (error) {
      console.error('sumupSyncNow ensureSumUpSystemCategory', error);
    }

    // MINOR — secrets can throw if the JSON they hold is malformed; from here
    // on the response must still always be JSON (S1.7).
    let offeringsConfig;
    let cafeConfig;
    try {
      offeringsConfig = sumupOfferings.value();
      cafeConfig = sumupCafe.value();
    } catch (error) {
      console.error('sumupSyncNow secrets', error);
      res.status(200).json({
        ok: false,
        results: [
          { account: 'offerings', runId: null, status: 'failed', counts: engine.emptyCounts(), errorClass: 'config_error' },
          { account: 'cafeteria', runId: null, status: 'failed', counts: engine.emptyCounts(), errorClass: 'config_error' },
        ],
      });
      return;
    }

    const [offeringsResult, cafeResult] = await Promise.all([
      safeRunAccountSync({
        account: 'offerings',
        config: offeringsConfig,
        otherMerchantCode: cafeConfig?.merchantCode,
        trigger: 'manual',
        requestedBy: uid,
        deadlineAt,
        fetchPage,
        store,
        clock,
      }),
      safeRunAccountSync({
        account: 'cafeteria',
        config: cafeConfig,
        otherMerchantCode: offeringsConfig?.merchantCode,
        trigger: 'manual',
        requestedBy: uid,
        deadlineAt,
        fetchPage,
        store,
        clock,
      }),
    ]);

    res.status(200).json({ ok: true, results: [toApiResult(offeringsResult), toApiResult(cafeResult)] });
  },
);

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function shouldSweep(account) {
  try {
    const integration = await store.getIntegration(account);
    const last = integration?.lastSweepAt;
    if (!last) return true;
    const lastMs = last?.toDate ? last.toDate().getTime() : new Date(last).getTime();
    return Number.isNaN(lastMs) || Date.now() - lastMs >= SWEEP_INTERVAL_MS;
  } catch {
    return false;
  }
}

exports.sumupSyncScheduled = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'America/Santiago',
    region: 'southamerica-east1',
    timeoutSeconds: 540,
    secrets: [sumupOfferings, sumupCafe],
  },
  async () => {
    // M6 — the whole scheduled run must finish comfortably under the 540s
    // timeout: incremental sync -> legacy -> sweep, in that order, each with
    // a finite share of the remaining time.
    const runStartedAt = clock.now();

    try {
      await ensureSumUpSystemCategory();
    } catch (error) {
      console.error('sumupSyncScheduled ensureSumUpSystemCategory', error);
    }

    // MINOR — a malformed secret must not crash the scheduled invocation.
    let offeringsConfig;
    let cafeConfig;
    try {
      offeringsConfig = sumupOfferings.value();
      cafeConfig = sumupCafe.value();
    } catch (error) {
      console.error('sumupSyncScheduled secrets', error);
      return;
    }

    // Incremental sync, isolated per account (S1.3): one account failing
    // never stops the other, nor the legacy backfill or sweep below.
    const incrementalDeadline = runStartedAt + 180_000;
    const incremental = await Promise.allSettled([
      safeRunAccountSync({
        account: 'offerings',
        config: offeringsConfig,
        otherMerchantCode: cafeConfig?.merchantCode,
        trigger: 'scheduled',
        requestedBy: 'system:scheduler',
        deadlineAt: incrementalDeadline,
        fetchPage,
        store,
        clock,
      }),
      safeRunAccountSync({
        account: 'cafeteria',
        config: cafeConfig,
        otherMerchantCode: offeringsConfig?.merchantCode,
        trigger: 'scheduled',
        requestedBy: 'system:scheduler',
        deadlineAt: incrementalDeadline,
        fetchPage,
        store,
        clock,
      }),
    ]);
    incremental.forEach((settled) => {
      if (settled.status === 'rejected') console.error('sumupSyncScheduled incremental', settled.reason);
    });

    // Legacy backfill: always runs, regardless of the above (S1.3).
    const legacyResult = await safeRunLegacyPage({
      account: 'offerings',
      config: offeringsConfig,
      requestedBy: 'system:scheduler',
      fetchPage,
      store,
      clock,
    });
    if (legacyResult.status === 'failed') console.error('sumupSyncScheduled legacy', legacyResult.errorMessage);

    // Daily 45-day sweep (S1.5), at most once a day per account, last in
    // line and with a finite budget + its own cursor (M6) so it can never
    // block the incremental sync or the legacy backfill above, nor run past
    // the scheduled function's own timeout.
    const sweepDeadline = runStartedAt + 480_000;
    const sweepTargets = [
      { account: 'offerings', config: offeringsConfig, other: cafeConfig?.merchantCode },
      { account: 'cafeteria', config: cafeConfig, other: offeringsConfig?.merchantCode },
    ];
    for (const target of sweepTargets) {
      // eslint-disable-next-line no-await-in-loop
      if (clock.now() < sweepDeadline && (await shouldSweep(target.account))) {
        // eslint-disable-next-line no-await-in-loop
        const result = await safeRunAccountSync({
          account: target.account,
          config: target.config,
          otherMerchantCode: target.other,
          trigger: 'sweep',
          requestedBy: 'system:sweep',
          deadlineAt: sweepDeadline,
          sweep: true,
          fetchPage,
          store,
          clock,
        });
        if (result.status === 'failed') console.error('sumupSyncScheduled sweep', target.account, result.errorMessage);
      }
    }
  },
);

// ---------------------------------------------------------------------------
// Slice 3a — SumUp payouts (comisión y depósito por día)
// ---------------------------------------------------------------------------

async function safeRunPayoutsSync(opts) {
  try {
    return await engine.runPayoutsSync(opts);
  } catch (error) {
    console.error(`sumup payouts sync (${opts.account})`, error);
    return {
      account: opts.account,
      runId: null,
      status: 'failed',
      counts: engine.emptyPayoutsCounts(),
      basis: null,
      errorClass: error.errorClass || core.classifyHttpError(error),
      errorMessage: String(error?.message || error),
    };
  }
}

function toPayoutsApiResult(result) {
  return {
    account: result.account,
    runId: result.runId,
    status: result.status,
    counts: result.counts,
    basis: result.basis || null,
    errorClass: result.errorClass || null,
  };
}

/**
 * sumupPayoutsScheduled — once a day at 06:10 Chile time (SumUp pays out the
 * day after the sale, spec §Ingesta "Funciones"), 35-day rolling window so a
 * missed day self-heals without a manual backfill.
 */
exports.sumupPayoutsScheduled = onSchedule(
  {
    schedule: '10 6 * * *',
    timeZone: 'America/Santiago',
    region: 'southamerica-east1',
    timeoutSeconds: 300,
    secrets: [sumupOfferings, sumupCafe],
  },
  async () => {
    let offeringsConfig;
    let cafeConfig;
    try {
      offeringsConfig = sumupOfferings.value();
      cafeConfig = sumupCafe.value();
    } catch (error) {
      console.error('sumupPayoutsScheduled secrets', error);
      return;
    }

    const { start, end } = clampPayoutsWindow(null, null);
    const ledgerEnabled = sumupFeesLedgerEnabled.value();

    const results = await Promise.allSettled([
      safeRunPayoutsSync({
        account: 'offerings',
        config: offeringsConfig,
        trigger: 'scheduled',
        dryRun: false,
        ledgerEnabled,
        start,
        end,
        fetchPayouts: fetchPayoutsFromApi,
        store,
        clock,
        requestedBy: 'system:scheduler',
      }),
      safeRunPayoutsSync({
        account: 'cafeteria',
        config: cafeConfig,
        trigger: 'scheduled',
        dryRun: false,
        ledgerEnabled,
        start,
        end,
        fetchPayouts: fetchPayoutsFromApi,
        store,
        clock,
        requestedBy: 'system:scheduler',
      }),
    ]);
    results.forEach((settled) => {
      if (settled.status === 'rejected') console.error('sumupPayoutsScheduled', settled.reason);
      else if (settled.value.status === 'failed') console.error('sumupPayoutsScheduled', settled.value.account, settled.value.errorMessage);
    });
  },
);

/**
 * sumupPayoutsNow — admin-only manual trigger (spec §Ingesta "Funciones").
 * `dryRun` defaults to true: the first real execution after deploy must be
 * an explicit, reviewed dry run before anything is written.
 */
exports.sumupPayoutsNow = onRequest(
  { region: REGION, timeoutSeconds: 120, secrets: [sumupOfferings, sumupCafe] },
  async (req, res) => {
    const origin = req.get('origin') || '';
    if (origin === SITE || origin === `https://${PROJECT}.firebaseapp.com`) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    }
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    let uid;
    try {
      uid = await requireAdminUser(req);
    } catch (error) {
      const message = String(error?.message || error);
      const status = message === 'UNAUTHENTICATED' ? 401 : message === 'FORBIDDEN' ? 403 : 401;
      console.error('sumupPayoutsNow auth', error);
      res.status(status).json({ ok: false, error: message });
      return;
    }

    let body = {};
    try {
      body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.rawBody?.toString() || '{}');
    } catch {
      body = {};
    }

    const requestedAccount = body.account === 'offerings' || body.account === 'cafeteria' ? body.account : null;
    const dryRun = body.dryRun !== false; // default true (spec)
    const { start, end } = clampPayoutsWindow(body.startDate, body.endDate);

    let offeringsConfig;
    let cafeConfig;
    try {
      offeringsConfig = sumupOfferings.value();
      cafeConfig = sumupCafe.value();
    } catch (error) {
      console.error('sumupPayoutsNow secrets', error);
      res.status(200).json({
        ok: false,
        results: [
          { account: 'offerings', runId: null, status: 'failed', counts: engine.emptyPayoutsCounts(), basis: null, errorClass: 'config_error' },
          { account: 'cafeteria', runId: null, status: 'failed', counts: engine.emptyPayoutsCounts(), basis: null, errorClass: 'config_error' },
        ],
      });
      return;
    }

    const ledgerEnabled = sumupFeesLedgerEnabled.value();
    const targets = requestedAccount
      ? [{ account: requestedAccount, config: requestedAccount === 'offerings' ? offeringsConfig : cafeConfig }]
      : [
          { account: 'offerings', config: offeringsConfig },
          { account: 'cafeteria', config: cafeConfig },
        ];

    const results = await Promise.all(
      targets.map((target) =>
        safeRunPayoutsSync({
          account: target.account,
          config: target.config,
          trigger: 'manual',
          dryRun,
          ledgerEnabled,
          start,
          end,
          fetchPayouts: fetchPayoutsFromApi,
          store,
          clock,
          requestedBy: uid,
        }),
      ),
    );

    res.status(200).json({ ok: true, dryRun, window: { start, end }, results: results.map(toPayoutsApiResult) });
  },
);
