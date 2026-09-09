const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineJsonSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();

const db = getFirestore();
const REGION = "southamerica-west1";
const PROJECT = "cds-administracion";
const SITE = `https://${PROJECT}.web.app`;

const sumupOfferings = defineJsonSecret("SUMUP_OFFERINGS_CONFIG");
const sumupCafe = defineJsonSecret("SUMUP_CAFETERIA_CONFIG");

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

function datePartsChile(iso) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return { date, dayKey: String(Number(day)), period: `${year}-${month}` };
}

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
}

async function fetchSumUpTransactions(config) {
  const { apiKey, merchantCode } = config || {};
  if (!apiKey || !merchantCode) throw new Error('Configuración SumUp incompleta.');

  const endpoint = `https://api.sumup.com/v2.1/merchants/${encodeURIComponent(merchantCode)}/transactions/history`;
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({ order: 'descending', limit: '100', changes_since: since });

  let url = `${endpoint}?${params.toString()}`;
  const all = new Map();

  for (let page = 0; page < 10 && url; page += 1) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SumUp ${response.status}: ${text.slice(0, 300)}`);
    }

    const body = await response.json();
    for (const item of body.items || []) {
      const id = item.transaction_id || item.id;
      if (id) all.set(id, item);
    }

    const next = (body.links || []).find((link) => link.rel === 'next');
    if (!next?.href) url = '';
    else if (next.href.startsWith('http')) url = next.href;
    else url = `${endpoint}?${String(next.href).replace(/^\?/, '')}`;
  }

  return [...all.values()];
}

function emptySummary() {
  return {
    incomeTotal: 0,
    expenseTotal: 0,
    result: 0,
    titheTotal: 0,
    transactionCount: 0,
    incomeByCategory: {},
    expenseByCategory: {},
    dailyIncome: {},
    dailyExpense: {},
  };
}

async function upsertSumUpTransaction(account, item) {
  if (item.payment_type !== 'POS' || item.type !== 'PAYMENT') return false;
  if (!['SUCCESSFUL', 'REFUNDED'].includes(item.status)) return false;
  if (item.currency !== 'CLP') return false;

  const transactionId = item.transaction_id || item.id;
  if (!transactionId || !item.timestamp) return false;

  const gross = Math.max(0, Math.round(Number(item.amount || 0)));
  const refunded = Math.max(0, Math.round(Number(item.refunded_amount || 0)));
  const net = Math.max(0, gross - refunded);
  const fee = Math.max(0, Math.round(Number(item.fee_amount || 0)));
  const { date, dayKey, period } = datePartsChile(item.timestamp);

  const category = account === 'offerings' ? 'Ofrendas' : 'Cafetería';
  const description = account === 'offerings'
    ? 'Ofrenda tarjeta física · SumUp'
    : 'Venta Cafetería · SumUp';

  const rawRef = db.doc(`sumupIntegrations/${account}/transactions/${safeId(transactionId)}`);
  const financeRef = db.doc(`financeTransactions/sumup_${account}_${safeId(transactionId)}`);
  const summaryRef = db.doc(`financeMonthlySummaries/${period}`);

  await db.runTransaction(async (tx) => {
    const beforeSnap = await tx.get(financeRef);
    const summarySnap = await tx.get(summaryRef);
    const before = beforeSnap.exists ? beforeSnap.data() : null;
    const beforeActive = before && before.status === 'active' ? Number(before.amount || 0) : 0;
    const afterActive = net > 0 ? net : 0;
    const delta = afterActive - beforeActive;
    const wasActive = !!before && before.status === 'active';
    const willBeActive = net > 0;
    const changed = !before || delta !== 0 || wasActive !== willBeActive;

    if (changed) {
      const summary = summarySnap.exists ? { ...emptySummary(), ...summarySnap.data() } : emptySummary();
      const incomeByCategory = { ...(summary.incomeByCategory || {}) };
      const dailyIncome = { ...(summary.dailyIncome || {}) };
      incomeByCategory[category] = Number(incomeByCategory[category] || 0) + delta;
      dailyIncome[dayKey] = Number(dailyIncome[dayKey] || 0) + delta;
      if (incomeByCategory[category] === 0) delete incomeByCategory[category];
      if (dailyIncome[dayKey] === 0) delete dailyIncome[dayKey];

      const countDelta = (willBeActive ? 1 : 0) - (wasActive ? 1 : 0);
      const incomeTotal = Number(summary.incomeTotal || 0) + delta;
      const expenseTotal = Number(summary.expenseTotal || 0);

      tx.set(summaryRef, {
        ...summary,
        incomeTotal,
        result: incomeTotal - expenseTotal,
        transactionCount: Number(summary.transactionCount || 0) + countDelta,
        incomeByCategory,
        dailyIncome,
        updatedAt: FieldValue.serverTimestamp(),
        lastTransactionId: financeRef.id,
      }, { merge: true });

      if (willBeActive) {
        tx.set(financeRef, {
          type: 'income',
          amount: net,
          date: Timestamp.fromDate(date),
          period,
          day: dayKey,
          category,
          paymentMethod: 'card',
          description,
          note: `SumUp ${item.transaction_code || transactionId}`,
          source: 'general',
          status: 'active',
          revision: Number(before?.revision || 0) + 1,
          createdBy: before?.createdBy || 'system:sumup',
          createdAt: before?.createdAt || FieldValue.serverTimestamp(),
          updatedBy: 'system:sumup',
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } else if (before) {
        tx.set(financeRef, {
          ...before,
          status: 'voided',
          revision: Number(before.revision || 0) + 1,
          updatedBy: 'system:sumup',
          updatedAt: FieldValue.serverTimestamp(),
          voidReason: 'Pago reembolsado en SumUp',
          voidedBy: 'system:sumup',
          voidedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    tx.set(rawRef, {
      account,
      transactionId,
      transactionCode: item.transaction_code || '',
      grossAmount: gross,
      refundedAmount: refunded,
      netAmount: net,
      feeAmount: fee,
      currency: item.currency,
      timestamp: Timestamp.fromDate(date),
      status: item.status,
      paymentType: item.payment_type,
      cardType: item.card_type || '',
      entryMode: item.entry_mode || '',
      user: item.user || item.username || '',
      productSummary: item.product_summary || '',
      syncedAt: FieldValue.serverTimestamp(),
      financeTransactionId: financeRef.id,
    }, { merge: true });
  });

  return true;
}

async function syncAccount(account, config) {
  const integrationRef = db.doc(`sumupIntegrations/${account}`);
  const label = account === 'offerings' ? 'Ofrendas' : 'Cafetería';
  try {
    const items = await fetchSumUpTransactions(config);
    let reviewed = 0;
    for (const item of items) {
      if (await upsertSumUpTransaction(account, item)) reviewed += 1;
    }
    await integrationRef.set({
      account,
      label,
      configured: true,
      merchantCode: config.merchantCode,
      lastSyncAt: FieldValue.serverTimestamp(),
      lastSyncStatus: 'ok',
      lastError: '',
      lastImportedCount: reviewed,
    }, { merge: true });
    return { account, reviewed };
  } catch (error) {
    await integrationRef.set({
      account,
      label,
      configured: true,
      lastSyncAt: FieldValue.serverTimestamp(),
      lastSyncStatus: 'error',
      lastError: String(error?.message || error).slice(0, 500),
    }, { merge: true });
    throw error;
  }
}

async function syncAllSumUp() {
  return [
    await syncAccount('offerings', sumupOfferings.value()),
    await syncAccount('cafeteria', sumupCafe.value()),
  ];
}

async function requireFinanceUser(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('UNAUTHENTICATED');

  const decoded = await getAuth().verifyIdToken(match[1]);
  const user = await db.doc(`users/${decoded.uid}`).get();
  if (!user.exists || user.data().active !== true || !['admin', 'pastor', 'finance'].includes(user.data().role)) {
    throw new Error('FORBIDDEN');
  }
  return decoded.uid;
}

exports.sumupSyncNow = onRequest(
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

    try {
      await requireFinanceUser(req);
      const results = await syncAllSumUp();
      res.status(200).json({ ok: true, results });
    } catch (error) {
      const message = String(error?.message || error);
      const status = message === 'UNAUTHENTICATED' ? 401 : message === 'FORBIDDEN' ? 403 : 500;
      console.error('sumupSyncNow', error);
      res.status(status).json({ ok: false, error: message });
    }
  },
);

exports.sumupSyncScheduled = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'America/Santiago',
    region: 'southamerica-east1',
    timeoutSeconds: 120,
    secrets: [sumupOfferings, sumupCafe],
  },
  async () => {
    await syncAllSumUp();
  },
);
