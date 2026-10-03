"use strict";

/**
 * functions/calendar/firestore-store.js
 *
 * Adaptador Admin SDK para public-feed.js y share-links.js. Separado para
 * poder testear ambos con un store en memoria (tests/functions).
 */

const SHARE_LINK_PATH = "calendarShareLinks/public";

/** @param {{ db: FirebaseFirestore.Firestore }} deps */
function createCalendarStore({ db }) {
  if (!db) throw new Error("createCalendarStore: db es obligatorio");

  /** `where tokenHash == hash limit 1` → datos del enlace o null. */
  async function findShareLinkByHash(hash) {
    const snap = await db.collection("calendarShareLinks").where("tokenHash", "==", hash).limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].data();
  }

  /** Eventos `visibility == public` con `lastDate >= from` (índice compuesto visibility+lastDate). */
  async function listPublicEventsFrom(from) {
    const snap = await db
      .collection("calendarEvents")
      .where("visibility", "==", "public")
      .where("lastDate", ">=", from)
      .get();
    return snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  }

  async function listAreas() {
    const snap = await db.collection("areas").get();
    return snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  }

  async function getUser(uid) {
    const snap = await db.doc(`users/${uid}`).get();
    return snap.exists ? snap.data() : null;
  }

  /**
   * Transacción sobre `calendarShareLinks/public`.
   * `fn({ current, set })`: `current` = datos actuales o null; `set(data)` reemplaza el documento completo.
   */
  async function shareLinkTransaction(fn) {
    const ref = db.doc(SHARE_LINK_PATH);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      return fn({
        current: snap.exists ? snap.data() : null,
        set: (data) => {
          tx.set(ref, data);
        },
      });
    });
  }

  return { findShareLinkByHash, listPublicEventsFrom, listAreas, getUser, shareLinkTransaction };
}

module.exports = { createCalendarStore, SHARE_LINK_PATH };
