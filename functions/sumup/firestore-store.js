"use strict";

/**
 * functions/sumup/firestore-store.js
 *
 * Real Firestore-backed implementation of the store adapter that
 * functions/sumup/engine.js expects. Kept separate from engine.js so the
 * engine can be unit tested with an in-memory store (see tests/functions).
 */

const core = require("./core");

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
  function payoutRef(docId) {
    return db.doc(`sumupPayouts/${docId}`);
  }
  function payoutVersionsCol(docId) {
    return payoutRef(docId).collection("versions");
  }
  function dailySettlementRef(account, date) {
    return db.doc(`sumupDailySettlement/${account}_${date}`);
  }
  function feeFinanceRef(account, date) {
    return db.doc(`financeTransactions/sumup_fee_${account}_${date}`);
  }
  function feeVersionsCol(account, date) {
    return feeFinanceRef(account, date).collection("versions");
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

    // -------------------------------------------------------------------
    // Slice 3a — payouts ingestion (comisión y depósito por día)
    // -------------------------------------------------------------------

    /**
     * getTransactionsInWindow — mirrors scripts/sumup-payouts-probe.mjs's
     * fetchImportedTransactions: pads the Firestore (UTC) query by a day on
     * each side, then filters to the exact Chile-local [start, end] using
     * core.datePartsChile, so a sale near midnight is never dropped due to
     * timezone rounding.
     *
     * Atlas review M4: only SUCCESSFUL/REFUNDED transactions are settleable —
     * a CANCELLED/FAILED/PENDING row (or a chargeback still under review)
     * never gets a payout, so it must not count as "pendiente" forever nor
     * silently poison a day's linkStatus. Excluded rows are still counted
     * (never silently dropped — spec "NO SILENT MONEY LOSS"), grouped by
     * their own local sale day so the caller can surface `txExcluded` per
     * day and for the whole run.
     */
    async getTransactionsInWindow(account, { start, end }) {
      const startPadded = new Date(`${start}T00:00:00Z`);
      startPadded.setUTCDate(startPadded.getUTCDate() - 1);
      const endPadded = new Date(`${end}T00:00:00Z`);
      endPadded.setUTCDate(endPadded.getUTCDate() + 2);

      const snap = await db
        .collection(`sumupIntegrations/${account}/transactions`)
        .where("timestamp", ">=", Timestamp.fromDate(startPadded))
        .where("timestamp", "<", Timestamp.fromDate(endPadded))
        .get();

      const transactions = [];
      const excludedByDate = {};
      let excludedCount = 0;
      const SETTLEABLE_STATUSES = ["SUCCESSFUL", "REFUNDED"];
      for (const doc of snap.docs) {
        const data = doc.data();
        if (!data?.timestamp?.toDate) continue;
        const iso = data.timestamp.toDate().toISOString();
        const parts = core.datePartsChile(iso);
        if (parts.localDate < start || parts.localDate > end) continue;
        const status = data.status || "";
        if (!SETTLEABLE_STATUSES.includes(status)) {
          excludedCount += 1;
          excludedByDate[parts.localDate] = (excludedByDate[parts.localDate] || 0) + 1;
          continue;
        }
        transactions.push({
          id: doc.id,
          transactionCode: data.transactionCode || "",
          grossAmount: Number(data.grossAmount || 0),
          refundedAmount: Number(data.refundedAmount || 0),
          status,
          localDate: parts.localDate,
        });
      }
      return { transactions, excludedCount, excludedByDate };
    },

    async getPayoutsBatch(docIds) {
      const map = new Map();
      if (!docIds.length) return map;
      const refs = docIds.map((id) => payoutRef(id));
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap, index) => {
        if (snap.exists) map.set(docIds[index], snap.data());
      });
      return map;
    },

    /**
     * upsertPayoutRow — `firstSeenAt`/`raw` are written once (spec §Modelo de
     * datos "Cambios"); a changed rawHash adds a versions/ entry instead of
     * silently overwriting history. Called only when decidePayoutRowAction
     * returned "create" or "update" — "unchanged" never reaches the store at
     * all (idempotency test).
     */
    async upsertPayoutRow({ docId, normalized, existing, runId, now }) {
      const patch = {
        account: normalized.account,
        merchantCode: normalized.merchantCode,
        rowId: normalized.rowId,
        type: normalized.type,
        status: normalized.status,
        date: normalized.date,
        reference: normalized.reference,
        transactionCode: normalized.transactionCode,
        currency: normalized.currency,
        amountRaw: normalized.amountRaw,
        feeRaw: normalized.feeRaw,
        amount: normalized.amount,
        fee: normalized.fee,
        netPaid: normalized.netPaid,
        basis: normalized.basis,
        raw: normalized.raw,
        rawHash: normalized.rawHash,
        lastSeenAt: toTimestamp(Timestamp, now),
        runId,
        linkStatus: normalized.linkStatus || null,
        review: normalized.review,
        reviewReason: normalized.reviewReason,
      };
      if (!existing) {
        patch.firstSeenAt = toTimestamp(Timestamp, now);
      } else {
        await payoutVersionsCol(docId).doc().set({
          previous: existing,
          rawHash: existing.rawHash || null,
          replacedAt: toTimestamp(Timestamp, now),
          runId,
        });
      }
      await payoutRef(docId).set(patch, { merge: true });
    },

    /**
     * setSettlement — writes ONLY the `settlement` map on the transaction
     * doc (spec §Modelo de datos). Never touches grossAmount/status/etc, and
     * is never called by the hourly sync's buildRawDoc/setRaw (functions/
     * sumup/engine.js) — see the regression test in
     * tests/functions/sumup-payouts-engine.test.ts.
     */
    async setSettlement(account, transactionId, settlement) {
      // MINOR m1: mergeFields (not a bare merge:true) — a merge:true set
      // would recursively merge nested maps on OTHER fields too if this call
      // site ever grows a sibling field; mergeFields keeps the write scoped
      // to exactly these two top-level fields, matching the "full replace,
      // never a silent partial merge" rule elsewhere in this store.
      await rawRef(account, transactionId).set(
        { settlement, settlementUpdatedAt: FieldValue.serverTimestamp() },
        { mergeFields: ["settlement", "settlementUpdatedAt"] },
      );
    },

    /** setDailySettlement — full replace (recomputed fresh every run; no merge). */
    async setDailySettlement(account, date, data) {
      await dailySettlementRef(account, date).set({
        ...data,
        account,
        date,
        updatedAt: FieldValue.serverTimestamp(),
      });
    },

    /**
     * runFeeLedgerTransaction — the SumUp fee expense movement
     * (financeTransactions/sumup_fee_{account}_{date}) plus its
     * expenseSummaryDelta on financeMonthlySummaries/{period}, both inside
     * one Firestore transaction (spec §Libro contable "Recálculo").
     */
    async runFeeLedgerTransaction({ account, date, period, day, amount, feeCoverage, now, runId }) {
      const finRef = feeFinanceRef(account, date);
      return db.runTransaction(async (tx) => {
        const finSnap = await tx.get(finRef);
        const existing = finSnap.exists ? finSnap.data() : null;

        const category = date < core.SUMUP_SPLIT_START_DATE
          ? "Comisión SumUp · histórico sin separar"
          : account === "offerings"
            ? "Comisión SumUp · Ofrendas"
            : "Comisión SumUp · Cafetería";

        const before = existing
          ? { active: existing.status === "active", amount: Number(existing.amount || 0), category: existing.category, day: existing.day }
          : { active: false, amount: 0, category, day };
        const willBeActive = amount > 0;
        const after = willBeActive
          ? { active: true, amount, category, day }
          : { active: false, amount: 0, category: before.category, day: before.day };

        if (!existing && !willBeActive) {
          // Nothing to record and nothing existed before: skip entirely
          // (never write a $0 expense — spec "nunca $0").
          return { outcome: "skipped" };
        }

        // Atlas review M5: re-running the same window with the SAME amount/
        // status/category must not bump revision or write anything — only
        // an actual change to the recorded commission does.
        if (
          existing &&
          Number(existing.amount || 0) === (willBeActive ? amount : 0) &&
          existing.status === (willBeActive ? "active" : "voided") &&
          existing.category === category
        ) {
          return { outcome: "unchanged" };
        }

        const delta = core.expenseSummaryDelta(before, after);
        const hasDelta = delta.expenseTotalDelta !== 0 || Object.keys(delta.categoryDeltas).length > 0 || Object.keys(delta.dayDeltas).length > 0;

        if (hasDelta) {
          const summarySnap = await tx.get(summaryRef(period));
          const summary = summarySnap.exists ? summarySnap.data() : null;
          tx.set(summaryRef(period), {
            ...core.applyExpenseSummaryDelta(summary, delta),
            lastTransactionId: `sumup_fee_${account}_${date}`,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        const revision = Number(existing?.revision || 0) + 1;
        const noonMs = new Date(`${date}T12:00:00-04:00`).getTime();
        const financeDoc = {
          type: "expense",
          amount: willBeActive ? amount : 0,
          date: toTimestamp(Timestamp, Number.isFinite(noonMs) ? noonMs : now),
          period,
          day,
          category,
          paymentMethod: "card",
          description: `Comisión SumUp · ${account === "offerings" ? "Ofrendas" : "Cafetería"}`,
          note: "",
          source: "general",
          status: willBeActive ? "active" : "voided",
          origin: "sumup_fee",
          area: account,
          feeCoverage: feeCoverage || null,
          revision,
          createdBy: existing?.createdBy || "system:sumup",
          createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
          updatedBy: "system:sumup",
          updatedAt: FieldValue.serverTimestamp(),
          voidReason: willBeActive ? null : "Comisión recalculada a $0",
          voidedBy: willBeActive ? null : "system:sumup",
          voidedAt: willBeActive ? null : FieldValue.serverTimestamp(),
        };
        tx.set(finRef, financeDoc, { merge: true });

        if (existing && Number(existing.amount || 0) !== (willBeActive ? amount : 0)) {
          tx.set(feeVersionsCol(account, date).doc(), {
            action: willBeActive ? "recalculated" : "voided",
            before: existing,
            afterAmount: willBeActive ? amount : 0,
            runId,
            at: toTimestamp(Timestamp, now),
          });
        }

        return { outcome: existing ? "updated" : "created" };
      });
    },
  };
}

module.exports = { createFirestoreStore };
