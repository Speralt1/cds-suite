// GENERADO por scripts/build-shared.mjs desde lib/shared/share-token-format.ts — NO EDITAR.
"use strict";
// Formato del token del enlace público del calendario: 32 bytes aleatorios en
// base64url sin relleno = exactamente 43 caracteres [A-Za-z0-9_-].
// Lo comparten la página pública (validación previa al fetch) y la Function.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHARE_TOKEN_RE = exports.SHARE_TOKEN_LENGTH = exports.SHARE_TOKEN_BYTES = void 0;
exports.isWellFormedShareToken = isWellFormedShareToken;
exports.SHARE_TOKEN_BYTES = 32;
exports.SHARE_TOKEN_LENGTH = 43;
exports.SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
function isWellFormedShareToken(value) {
    return typeof value === "string" && exports.SHARE_TOKEN_RE.test(value);
}
