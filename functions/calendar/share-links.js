"use strict";

/**
 * functions/calendar/share-links.js
 *
 * Servicio del callable `calendarShareLinkManage` (18a §E.2). Inyectable:
 * recibe `store` (ver firestore-store.js), `clock` y `randomBytes`.
 *
 * Acciones: status | create | regenerate | activate | deactivate.
 * Solo `calendar.events.manage_all` (con fallback legacy: pastor y admin).
 * El token en claro se devuelve UNA vez (create/regenerate); se guarda solo
 * su SHA-256. `status` nunca devuelve hash ni token.
 *
 * Errores: HttpsError con message = clave traducible:
 *   share/unauthenticated · share/forbidden · share/invalid-action ·
 *   share/not-found · share/already-exists · share/internal
 */

const { HttpsError } = require("firebase-functions/v2/https");
const { can } = require("../shared/access");
const { generateShareToken, hashShareToken } = require("./share-token");

const SHARE_ACTIONS = Object.freeze(["status", "create", "regenerate", "activate", "deactivate"]);
const SHARE_ERROR_KEYS = Object.freeze({
  unauthenticated: "share/unauthenticated",
  forbidden: "share/forbidden",
  invalidAction: "share/invalid-action",
  notFound: "share/not-found",
  alreadyExists: "share/already-exists",
  internal: "share/internal",
});

function toIso(value) {
  if (value === null || value === undefined) return null;
  try {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (typeof value === "number") return new Date(value).toISOString();
  } catch {
    return null;
  }
  return null;
}

/** Firestore rechaza `undefined`: se omiten esas claves. */
function compact(doc) {
  const out = {};
  for (const [key, value] of Object.entries(doc)) if (value !== undefined) out[key] = value;
  return out;
}

/** Vista pública del documento: NUNCA hash ni token. */
function toStatus(doc) {
  if (!doc) return { exists: false, active: false, createdAt: null, regeneratedAt: null, disabledAt: null };
  return {
    exists: true,
    active: doc.active === true,
    createdAt: toIso(doc.createdAt),
    regeneratedAt: toIso(doc.regeneratedAt),
    disabledAt: toIso(doc.disabledAt),
  };
}

/**
 * @param {{
 *   store: { getUser(uid: string): Promise<object|null>,
 *            shareLinkTransaction(fn: (tx: { current: object|null, set(data: object): void }) => any): Promise<any> },
 *   clock: { now(): number },
 *   randomBytes?: (size: number) => Buffer,
 *   logger?: { error: Function },
 * }} deps
 */
function createShareLinkService({ store, clock, randomBytes, logger = console }) {
  if (!store || !clock) throw new Error("createShareLinkService: store y clock son obligatorios");

  const nowDate = () => new Date(clock.now());
  const newToken = () => (randomBytes ? generateShareToken(randomBytes) : generateShareToken());

  async function authorize(uid) {
    if (!uid || typeof uid !== "string") throw new HttpsError("unauthenticated", SHARE_ERROR_KEYS.unauthenticated);
    const userDoc = await store.getUser(uid);
    if (!can(userDoc, "calendar.events.manage_all")) throw new HttpsError("permission-denied", SHARE_ERROR_KEYS.forbidden);
  }

  async function status() {
    return store.shareLinkTransaction(async ({ current }) => ({ status: toStatus(current) }));
  }

  async function create(uid) {
    return store.shareLinkTransaction(async ({ current, set }) => {
      if (current) throw new HttpsError("failed-precondition", SHARE_ERROR_KEYS.alreadyExists);
      const token = newToken();
      const now = nowDate();
      const doc = {
        tokenHash: hashShareToken(token),
        active: true,
        createdAt: now,
        createdBy: uid,
        rotation: 1,
        updatedAt: now,
        updatedBy: uid,
      };
      set(compact(doc));
      return { status: toStatus(doc), token };
    });
  }

  async function regenerate(uid) {
    return store.shareLinkTransaction(async ({ current, set }) => {
      if (!current) throw new HttpsError("not-found", SHARE_ERROR_KEYS.notFound);
      const token = newToken();
      const now = nowDate();
      const doc = {
        tokenHash: hashShareToken(token),
        active: true,
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        regeneratedAt: now,
        rotation: (Number.isInteger(current.rotation) ? current.rotation : 0) + 1,
        updatedAt: now,
        updatedBy: uid,
      };
      set(compact(doc));
      return { status: toStatus(doc), token };
    });
  }

  async function setActive(uid, active) {
    return store.shareLinkTransaction(async ({ current, set }) => {
      if (!current) throw new HttpsError("not-found", SHARE_ERROR_KEYS.notFound);
      if ((current.active === true) === active) return { status: toStatus(current) };
      const now = nowDate();
      const doc = {
        tokenHash: current.tokenHash,
        active,
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        rotation: current.rotation,
        updatedAt: now,
        updatedBy: uid,
      };
      if (current.regeneratedAt !== undefined) doc.regeneratedAt = current.regeneratedAt;
      if (!active) doc.disabledAt = now;
      set(compact(doc));
      return { status: toStatus(doc) };
    });
  }

  /**
   * Punto de entrada del callable.
   * @returns {Promise<{status: object, token?: string}>}
   */
  async function handle(uid, action) {
    try {
      await authorize(uid);
      switch (action) {
        case "status":
          return await status();
        case "create":
          return await create(uid);
        case "regenerate":
          return await regenerate(uid);
        case "activate":
          return await setActive(uid, true);
        case "deactivate":
          return await setActive(uid, false);
        default:
          throw new HttpsError("invalid-argument", SHARE_ERROR_KEYS.invalidAction);
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error("calendarShareLinkManage", {
        action: SHARE_ACTIONS.includes(action) ? action : "invalid",
        name: error && error.name ? String(error.name) : "Error",
        code: error && error.code !== undefined ? String(error.code) : undefined,
      });
      throw new HttpsError("internal", SHARE_ERROR_KEYS.internal);
    }
  }

  return { authorize, status, create, regenerate, activate: (uid) => setActive(uid, true), deactivate: (uid) => setActive(uid, false), handle };
}

/** Adaptador onCall: `(request) => service.handle(request.auth?.uid, request.data?.action)`. */
function createShareLinkCallableHandler(service) {
  return async function calendarShareLinkManageHandler(request) {
    const uid = request && request.auth && typeof request.auth.uid === "string" ? request.auth.uid : null;
    const action = request && request.data && typeof request.data === "object" ? request.data.action : undefined;
    return service.handle(uid, action);
  };
}

module.exports = {
  createShareLinkService,
  createShareLinkCallableHandler,
  SHARE_ACTIONS,
  SHARE_ERROR_KEYS,
  toStatus,
};
