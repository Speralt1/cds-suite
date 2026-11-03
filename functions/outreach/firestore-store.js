"use strict";

/**
 * functions/outreach/firestore-store.js
 *
 * Adaptador Admin SDK para outreach/service.js. Separado para testear el
 * servicio con un store en memoria (tests/functions).
 *
 * Transacciones: el servicio hace TODAS las lecturas (`tx.get` / `tx.list`)
 * antes de las escrituras. `create` falla si el documento existe (historial
 * append-only); `set` reemplaza; `update` falla si no existe; `delete` borra.
 * `collection` puede ser una ruta de subcolección (`outreachEditions/e/team`).
 */

const RESERVED_ID = /^__.*__$/;

/** @param {{ db: FirebaseFirestore.Firestore, FieldValue: typeof FirebaseFirestore.FieldValue, FieldPath: typeof FirebaseFirestore.FieldPath }} deps */
function createOutreachStore({ db, FieldValue, FieldPath }) {
  if (!db || !FieldValue || !FieldPath) throw new Error("createOutreachStore: db, FieldValue y FieldPath son obligatorios");

  const ref = (collection, id) => db.collection(collection).doc(id);

  function query(collection, where, limit, afterId) {
    let q = db.collection(collection);
    for (const [field, op, value] of where || []) q = q.where(field, op, value);
    q = q.orderBy(FieldPath.documentId());
    if (afterId) q = q.startAfter(afterId);
    if (limit) q = q.limit(limit);
    return q;
  }

  async function getUser(uid) {
    if (RESERVED_ID.test(uid)) return null;
    const snap = await ref("users", uid).get();
    return snap.exists ? snap.data() : null;
  }

  async function get(collection, id) {
    if (RESERVED_ID.test(id)) return null;
    const snap = await ref(collection, id).get();
    return snap.exists ? snap.data() : null;
  }

  /** Igualdad de campos (índices automáticos), orden por id y cursor `afterId`. */
  async function list(collection, { where = [], limit = 100, afterId = null } = {}) {
    const snap = await query(collection, where, limit, afterId).get();
    return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  }

  function serverTimestamp() {
    return FieldValue.serverTimestamp();
  }

  async function runTransaction(fn) {
    return db.runTransaction(async (tx) =>
      fn({
        get: async (collection, id) => {
          if (RESERVED_ID.test(id)) return null;
          const snap = await tx.get(ref(collection, id));
          return snap.exists ? snap.data() : null;
        },
        list: async (collection, where, limit = 200) => {
          const snap = await tx.get(query(collection, where, limit, null));
          return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
        },
        create: (collection, id, data) => {
          tx.create(ref(collection, id), data);
        },
        set: (collection, id, data) => {
          tx.set(ref(collection, id), data);
        },
        update: (collection, id, data) => {
          tx.update(ref(collection, id), data);
        },
        delete: (collection, id) => {
          tx.delete(ref(collection, id));
        },
      }),
    );
  }

  return { getUser, get, list, serverTimestamp, runTransaction };
}

module.exports = { createOutreachStore };
