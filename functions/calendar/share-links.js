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
 * su SHA-256. `status` nunca devuelve hash ni token, ni correos ni uids: las
 * personas salen solo como nombre visible (`createdByName`, `regeneratedByName`,
 * `disabledByName`, desde users/{uid}.displayName; null si no hay).
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

/** Vista pública del documento: NUNCA hash ni token (sin nombres; ver describeStatus). */
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

/** Nombre visible seguro: string no vacío, sin "@" (nunca un correo), máx. 120. */
function safeDisplayName(user) {
  const name = user && typeof user.displayName === "string" ? user.displayName.trim() : "";
  if (!name || name.includes("@")) return null;
  return name.slice(0, 120);
}

/** uid que corresponde a cada nombre del estado (solo si la marca de tiempo existe). */
function actorUids(doc) {
  if (!doc) return { createdBy: null, regeneratedBy: null, disabledBy: null };
  const uid = (v) => (typeof v === "string" && v ? v : null);
  return {
    createdBy: uid(doc.createdBy),
    regeneratedBy: doc.regeneratedAt !== undefined && doc.regeneratedAt !== null ? uid(doc.regeneratedBy) : null,
    disabledBy: doc.active !== true && doc.disabledAt !== undefined && doc.disabledAt !== null ? uid(doc.disabledBy) : null,
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

  /** Estado + nombres visibles (lecturas fuera de la transacción; un get por persona distinta). */
  async function describeStatus(doc) {
    const uids = actorUids(doc);
    const names = new Map();
    for (const uid of new Set(Object.values(uids).filter(Boolean))) names.set(uid, safeDisplayName(await store.getUser(uid)));
    const nameOf = (uid) => (uid ? names.get(uid) ?? null : null);
    return {
      ...toStatus(doc),
      createdByName: nameOf(uids.createdBy),
      regeneratedByName: nameOf(uids.regeneratedBy),
      disabledByName: nameOf(uids.disabledBy),
    };
  }

  /** Corre la transacción (que devuelve { doc, token? }) y arma la respuesta con nombres. */
  async function respond(run) {
    const { doc, token } = await store.shareLinkTransaction(run);
    const result = { status: await describeStatus(doc) };
    if (token !== undefined) result.token = token;
    return result;
  }

  async function status() {
    return respond(async ({ current }) => ({ doc: current }));
  }

  async function create(uid) {
    return respond(async ({ current, set }) => {
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
      return { doc, token };
    });
  }

  async function regenerate(uid) {
    return respond(async ({ current, set }) => {
      if (!current) throw new HttpsError("not-found", SHARE_ERROR_KEYS.notFound);
      const token = newToken();
      const now = nowDate();
      const doc = {
        tokenHash: hashShareToken(token),
        active: true,
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        regeneratedAt: now,
        regeneratedBy: uid,
        rotation: (Number.isInteger(current.rotation) ? current.rotation : 0) + 1,
        updatedAt: now,
        updatedBy: uid,
      };
      set(compact(doc));
      return { doc, token };
    });
  }

  async function setActive(uid, active) {
    return respond(async ({ current, set }) => {
      if (!current) throw new HttpsError("not-found", SHARE_ERROR_KEYS.notFound);
      if ((current.active === true) === active) return { doc: current };
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
      if (current.regeneratedBy !== undefined) doc.regeneratedBy = current.regeneratedBy;
      if (!active) {
        doc.disabledAt = now;
        doc.disabledBy = uid;
      }
      set(compact(doc));
      return { doc };
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

  return { authorize, status, describeStatus, create, regenerate, activate: (uid) => setActive(uid, true), deactivate: (uid) => setActive(uid, false), handle };
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
  safeDisplayName,
};
