"use strict";

/**
 * functions/calendar/share-token.js
 *
 * Token del enlace público del calendario: 32 bytes aleatorios en base64url
 * (43 caracteres). Solo se guarda su SHA-256 en hex; el token en claro se
 * devuelve una única vez y nunca se persiste ni se loguea.
 */

const crypto = require("node:crypto");
const { SHARE_TOKEN_BYTES, SHARE_TOKEN_RE, isWellFormedShareToken } = require("../shared/share-token-format");

/**
 * @param {(size: number) => Buffer | Uint8Array} [randomBytes] inyectable para tests.
 * @returns {string} token base64url de 43 caracteres.
 */
function generateShareToken(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(SHARE_TOKEN_BYTES);
  if (!bytes || bytes.length !== SHARE_TOKEN_BYTES) {
    throw new Error("generateShareToken: randomBytes no devolvió 32 bytes");
  }
  const token = Buffer.from(bytes).toString("base64url");
  if (!SHARE_TOKEN_RE.test(token)) throw new Error("generateShareToken: formato inesperado");
  return token;
}

/** SHA-256 en hex (64 caracteres) del token. */
function hashShareToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

module.exports = { generateShareToken, hashShareToken, SHARE_TOKEN_RE, isWellFormedShareToken };
