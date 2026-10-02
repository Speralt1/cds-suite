"use strict";

/**
 * functions/auth/require-finance-user.js
 *
 * Autorización de las Functions financieras (sumupSyncNow). Usa el modelo de
 * acceso compartido: `can(userDoc, "finance.records.manage")`. Para los roles
 * legacy es equivalente a la regla anterior
 * (`exists && active === true && role in [admin, pastor, finance]`) y para los
 * documentos v1 respeta permisos y baseRole.
 */

const { can } = require("../shared/access");

/** ¿El documento `users/{uid}` puede operar finanzas? (null = no existe). */
function isFinanceUserDoc(userDoc) {
  return can(userDoc, "finance.records.manage");
}

/**
 * @param {{ verifyIdToken(token: string): Promise<{uid: string}>, getUserDoc(uid: string): Promise<object|null> }} deps
 * @returns {(req: { get(name: string): string | undefined }) => Promise<string>} uid; lanza Error('UNAUTHENTICATED' | 'FORBIDDEN').
 */
function createRequireFinanceUser({ verifyIdToken, getUserDoc }) {
  return async function requireFinanceUser(req) {
    const header = req.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new Error("UNAUTHENTICATED");

    const decoded = await verifyIdToken(match[1]);
    const userDoc = await getUserDoc(decoded.uid);
    if (!isFinanceUserDoc(userDoc)) throw new Error("FORBIDDEN");
    return decoded.uid;
  };
}

module.exports = { isFinanceUserDoc, createRequireFinanceUser };
