// Teléfonos (E.164 con reglas chilenas) y correos (16c §F).

export type PhoneResult =
  | { ok: true; e164: string; isChile: boolean; display: string }
  | { ok: false; reason: "empty" | "invalid" };

export const PHONE_HELP = "Si es extranjero, escribe el código de país con +.";

function chile(national: string): PhoneResult {
  const e164 = `+56${national}`;
  return { ok: true, e164, isChile: true, display: formatPhone(e164) };
}

/**
 * Normaliza un teléfono. Reglas, en orden:
 * 1. trim; quitar espacios, guiones, puntos, paréntesis y barras; "00" inicial = "+".
 * 2. Con "+": solo dígitos, 8–15 en total; "+56" exige 9 dígitos nacionales.
 * 3. 11 dígitos con "56" → +56 + 9. 4–5. 9 dígitos (9 celular, 2–8 fijo) → +56.
 * 6. 10 dígitos con "0" inicial cuyo resto cumple 4–5 → se quita el 0.
 * 7. 8 dígitos → +569 (celular anterior a 2012). 8. Lo demás es inválido.
 */
export function normalizePhone(raw: string): PhoneResult {
  let s = (raw ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  s = s.replace(/[\s\-.()/]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^\d{8,15}$/.test(digits)) return { ok: false, reason: "invalid" };
    if (digits.startsWith("56")) {
      const national = digits.slice(2);
      return national.length === 9 ? chile(national) : { ok: false, reason: "invalid" };
    }
    return { ok: true, e164: `+${digits}`, isChile: false, display: `+${digits}` };
  }
  if (!/^\d+$/.test(s)) return { ok: false, reason: "invalid" };
  if (s.length === 11 && s.startsWith("56")) return chile(s.slice(2));
  if (s.length === 9 && /^[2-9]/.test(s)) return chile(s);
  if (s.length === 10 && s.startsWith("0") && /^[2-9]/.test(s.slice(1))) return chile(s.slice(1));
  if (s.length === 8) return chile(`9${s}`);
  return { ok: false, reason: "invalid" };
}

/**
 * Formato visible: celular "+56 9 1234 5678", Santiago "+56 2 1234 5678",
 * otros fijos "+56 XX XXX XXXX"; extranjeros: lo escrito, limpio.
 */
export function formatPhone(e164: string, raw?: string): string {
  if (/^\+56[29]\d{8}$/.test(e164)) return `+56 ${e164[3]} ${e164.slice(4, 8)} ${e164.slice(8)}`;
  if (/^\+56\d{9}$/.test(e164)) return `+56 ${e164.slice(3, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}`;
  if (raw && raw.trim()) return raw.trim().replace(/\s+/g, " ");
  return e164;
}

/** "https://wa.me/56912345678" (sin texto prellenado). En la preview NO se renderiza como enlace. */
export function waLink(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}

// Mismo regex y máximo que lib/settings/users.ts (copiado, no importado: ese módulo
// arrastra Firestore). Sin normalizar puntos ni "+" de Gmail.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): { ok: true; value: string } | { ok: false } {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value.length > 160 || !EMAIL_RE.test(value)) return { ok: false };
  return { ok: true, value };
}
