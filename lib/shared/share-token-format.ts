// Formato del token del enlace público del calendario: 32 bytes aleatorios en
// base64url sin relleno = exactamente 43 caracteres [A-Za-z0-9_-].
// Lo comparten la página pública (validación previa al fetch) y la Function.

export const SHARE_TOKEN_BYTES = 32;
export const SHARE_TOKEN_LENGTH = 43;
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedShareToken(value: unknown): value is string {
  return typeof value === "string" && SHARE_TOKEN_RE.test(value);
}
