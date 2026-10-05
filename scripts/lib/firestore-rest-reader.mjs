/**
 * scripts/lib/firestore-rest-reader.mjs
 *
 * Read-only Firestore access for operational scripts: only REST
 * `GET documents/...` and `:runQuery` (a read RPC) are ever called, so these
 * helpers cannot write to production by construction.
 */

const PROJECT_ID = "cds-administracion";
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ---------------------------------------------------------------------------

function decodeValue(v) {
  if (v == null || "nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

export function createFirestoreReader(token) {
  async function getDoc(path) {
    const r = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Firestore GET ${r.status}`);
    return decodeFields((await r.json()).fields || {});
  }
  async function runQuery(structuredQuery) {
    // :runQuery is a read RPC; its body only carries the query.
    const r = await fetch(`${FS}:runQuery`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery }),
    });
    if (!r.ok) throw new Error(`Firestore runQuery ${r.status}`);
    return (await r.json()).filter((x) => x.document).map((x) => ({ id: x.document.name.split("/").pop(), ...decodeFields(x.document.fields || {}) }));
  }
  return {
    getIntegration: (account) => getDoc(`sumupIntegrations/${account}`),
    getFinance: (financeId) => getDoc(`financeTransactions/${financeId}`),
    getRaw: (account, rawId) => getDoc(`sumupIntegrations/${account}/transactions/${rawId}`),
    getSummary: (period) => getDoc(`financeMonthlySummaries/${period}`),
    financeForPeriod: (period) =>
      runQuery({
        from: [{ collectionId: "financeTransactions" }],
        where: { fieldFilter: { field: { fieldPath: "period" }, op: "EQUAL", value: { stringValue: period } } },
      }),
  };
}

