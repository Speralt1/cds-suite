"use strict";

/**
 * functions/sumup/firestore-store.js
 *
 * Real Firestore-backed implementation of the store adapter that
 * functions/sumup/engine.js expects. Kept separate from engine.js so the
 * engine can be unit tested with an in-memory store (see tests/functions).
 */

function toTimestamp(Timestamp, value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return Timestamp.fromMillis(value);
  if (value instanceof Date) return Timestamp.fromDate(value);
  return value;
}

/**
 * @param {{db: FirebaseFirestore.Firestore, FieldValue: any, Timestamp: any}} deps
 */
function createFirestoreStore({ db, FieldValue, Timestamp }) {
  function integrationRef(account) {
    return db.doc(`sumupIntegrations/${account}`);
  }
  function leaseRef(account) {
    return db.doc(`sumupIntegrations/${account}/_locks/lease`);
  }
  function rawRef(account, rawId) {
    return db.doc(`sumupIntegrations/${account}/transactions/${rawId}`);
  }
  function versionsCol(account, rawId) {
    return rawRef(account, rawId).collection("versions");
  }
  function adjustmentsCol(account) {
    return db.doc(`sumupIntegrations/${account}`).collection("adjustments");
  }
  function financeRef(financeId) {
    return db.doc(`financeTransactions/${financeId}`);
  }
  function summaryRef(period) {
    return db.doc(`financeMonthlySummaries/${period}`);
  }
  function runRef(runId) {
    return db.doc(`sumupSyncRuns/${runId}`);
  }

  return {
    async getIntegration(account) {
      const snap = await integrationRef(account).get();
      if (!snap.exists) return null;
      const data = snap.data() || {};
      return {
        ...data,
        watermark: data.watermark instanceof Timestamp ? data.watermark.toDate().toISOString() : data.watermark || null,
      };
    },

    async setIntegration(account, patch) {
      const out = { ...patch, updatedAt: FieldValue.serverTimestamp() };
      for (const key of Object.keys(out)) {
        if (/At$/.test(key) && typeof out[key] === "number") out[key] = toTimestamp(Timestamp, out[key]);
      }
      await integrationRef(account).set(out, { merge: true });
    },

    async getFinanceBatch(account, ids) {
      const map = new Map();
      if (!ids.length) return map;
      const refs = ids.map((id) => financeRef(`sumup_${account}_${id}`));
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap, index) => {
        if (snap.exists) map.set(ids[index], snap.data());
      });
      return map;
    },

    async getRawBatch(account, ids) {
      const map = new Map();
      if (!ids.length) return map;
      const refs = ids.map((id) => rawRef(account, id));
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap, index) => {
        if (snap.exists) map.set(ids[index], snap.data());
      });
      return map;
    },

    async acquireLease(account, { ttlMs, runId, trigger, now }) {
      return db.runTransaction(async (tx) => {
        const ref = leaseRef(account);
        const snap = await tx.get(ref);
        const current = snap.exists ? snap.data() : null;
        const expired = !current || Number(current.expiresAtMs || 0) <= now;
        if (current && !expired) {
          return { acquired: false, existingRunId: current.runId || null };
        }
        if (current && expired && current.runId) {
          const staleRunSnap = await tx.get(runRef(current.runId));
          if (staleRunSnap.exists && staleRunSnap.data().status === "running") {
            tx.set(runRef(current.runId), { status: "abandoned", finishedAt: FieldValue.serverTimestamp() }, { merge: true });
          }
        }
        tx.set(ref, { runId, trigger, acquiredAtMs: now, expiresAtMs: now + ttlMs }, { merge: false });
        return { acquired: true };
      });
    },

    async releaseLease(account, runId) {
      const ref = leaseRef(account);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.data().runId === runId) {
          tx.delete(ref);
        }
      });
    },

    async createRun(data) {
      const col = db.collection("sumupSyncRuns");
      const docRef = col.doc();
      await docRef.set({
        ...data,
        startedAt: toTimestamp(Timestamp, data.startedAt),
      });
      return docRef.id;
    },

    async updateRun(runId, patch) {
      const out = { ...patch };
      for (const key of ["finishedAt"]) {
        if (typeof out[key] === "number") out[key] = toTimestamp(Timestamp, out[key]);
      }
      await runRef(runId).set(out, { merge: true });
    },

    async runLedgerTransaction({ account, rawId, financeId }, workFn) {
      return db.runTransaction(async (tx) => {
        const fRef = financeRef(financeId);
        const rRef = rawRef(account, rawId);
        const pendingSummary = { period: null, data: null };
        const wrapper = {
          async getFinance() {
            const snap = await tx.get(fRef);
            return snap.exists ? snap.data() : null;
          },
          async getRaw() {
            const snap = await tx.get(rRef);
            return snap.exists ? snap.data() : null;
          },
          async getSummary(period) {
            const snap = await tx.get(summaryRef(period));
            return snap.exists ? snap.data() : null;
          },
          async getAdjustment() {
            const snap = await tx.get(adjustmentsCol(account).doc(rawId));
            return snap.exists ? snap.data() : null;
          },
          setFinance(data) {
            const converted = { ...data };
            if (converted.date instanceof Date) converted.date = Timestamp.fromDate(converted.date);
            for (const key of ["createdAt", "updatedAt", "voidedAt"]) {
              if (typeof converted[key] === "number") converted[key] = toTimestamp(Timestamp, converted[key]);
            }
            for (const key of ["voidReason", "voidedBy", "voidedAt"]) {
              if (converted[key] === null) converted[key] = FieldValue.delete();
            }
            tx.set(fRef, converted, { merge: true });
          },
          setRaw(data) {
            const converted = { ...data };
            if (converted.timestamp instanceof Date) converted.timestamp = Timestamp.fromDate(converted.timestamp);
            for (const key of ["syncedAt"]) {
              if (typeof converted[key] === "number") converted[key] = toTimestamp(Timestamp, converted[key]);
            }
            tx.set(rRef, converted, { merge: true });
          },
          setSummary(period, data, lastTransactionId) {
            // Deliberately NOT merge:true — `data` is the FULL 9-field
            // summary doc (see core.applySummaryDelta). Firestore's merge
            // recursively merges nested maps, so it would never delete a
            // category/day key we zeroed out locally (Slice 1 review B1).
            tx.set(summaryRef(period), { ...data, lastTransactionId, updatedAt: FieldValue.serverTimestamp() });
          },
          setAdjustment(data) {
            const converted = { ...data };
            if (typeof converted.detectedAt === "number") converted.detectedAt = toTimestamp(Timestamp, converted.detectedAt);
            tx.set(adjustmentsCol(account).doc(rawId), converted, { merge: true });
          },
          addVersion(data) {
            const converted = { ...data };
            if (typeof converted.at === "number") converted.at = toTimestamp(Timestamp, converted.at);
            tx.set(versionsCol(account, rawId).doc(), converted);
          },
        };
        return workFn(wrapper);
      });
    },
  };
}

module.exports = { createFirestoreStore };
