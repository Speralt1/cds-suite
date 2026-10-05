"use strict";

/**
 * functions/members/firestore-store.js
 *
 * Adaptador Admin SDK para members/service.js (doc 23 §4–5). Separado para
 * testear el servicio con un store en memoria (tests/functions).
 *
 * Transacciones: el servicio hace TODAS las lecturas (`tx.get`) antes de las
 * escrituras (`tx.create`/`tx.update`), como exige Firestore. `create` falla si
 * el documento ya existe: el historial (visitas, seguimientos, cambios) es
 * append-only también a nivel de escritura.
 */

/** Ids reservados por Firestore (`__.*__`): se tratan como inexistentes. */
const RESERVED_ID = /^__.*__$/;

/** @param {{ db: FirebaseFirestore.Firestore, FieldValue: typeof FirebaseFirestore.FieldValue }} deps */
function createMembersStore({ db, FieldValue }) {
  if (!db || !FieldValue) throw new Error("createMembersStore: db y FieldValue son obligatorios");

  const ref = (collection, id) => db.collection(collection).doc(id);

  async function getUser(uid) {
    if (RESERVED_ID.test(uid)) return null;
    const snap = await ref("users", uid).get();
    return snap.exists ? snap.data() : null;
  }

  /** Todos los perfiles (la lista de usuarios de la iglesia es pequeña). */
  async function listUsers() {
    const snap = await db.collection("users").get();
    return snap.docs.map((doc) => ({ uid: doc.id, data: doc.data() }));
  }

  async function getCalendarEvent(id) {
    if (RESERVED_ID.test(id)) return null;
    const snap = await ref("calendarEvents", id).get();
    return snap.exists ? snap.data() : null;
  }

  /** Igualdad de un campo (índice automático), para advertir posibles duplicados. */
  async function findPeople(field, value, limit) {
    const snap = await db.collection("membersPeople").where(field, "==", value).limit(limit).get();
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
        create: (collection, id, data) => {
          tx.create(ref(collection, id), data);
        },
        update: (collection, id, data) => {
          tx.update(ref(collection, id), data);
        },
      }),
    );
  }

  return { getUser, listUsers, getCalendarEvent, findPeople, serverTimestamp, runTransaction };
}

module.exports = { createMembersStore };
