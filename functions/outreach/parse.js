"use strict";

/**
 * functions/outreach/parse.js
 *
 * Validación ESTRICTA de los payloads de los callables `outreach*`: claves
 * desconocidas, tipos y largos. Devuelve el valor normalizado o lanza
 * `invalid-argument` con `details.fields` (nunca el valor recibido).
 */

const { HttpsError } = require("firebase-functions/v2/https");
const { isValidYmd } = require("../shared/dates");

const ID_RE = /^[A-Za-z0-9_-]{1,160}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_ERRORS = 20;

/** Bytes aproximados del JSON del payload. */
function sizeOf(data) {
  try {
    return Buffer.byteLength(JSON.stringify(data) ?? "", "utf8");
  } catch {
    return Infinity;
  }
}

function isPlain(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * spec: { clave: [tipo, opciones] }. Tipos: str, id, requestId, int, bool, enum, ymd, list.
 * Opciones: opt (ausente/null → `def ?? null`), min, max, values, of (spec de ítems | "id" | "str"), def, raw (no recorta).
 */
function parseWith(data, spec, errors, prefix) {
  if (!isPlain(data)) {
    errors[prefix || "payload"] = "object";
    return null;
  }
  for (const k of Object.keys(data)) if (!(k in spec)) errors[`${prefix}${k}`] = "unknown";
  const out = {};
  for (const [k, [type, opts = {}]] of Object.entries(spec)) {
    const path = `${prefix}${k}`;
    let v = data[k];
    if (v === undefined || v === null) {
      if (opts.opt) {
        out[k] = opts.def !== undefined ? opts.def : null;
        continue;
      }
      errors[path] = "required";
      continue;
    }
    const fail = (code) => {
      errors[path] = code;
    };
    switch (type) {
      case "str": {
        if (typeof v !== "string") {
          fail("string");
          break;
        }
        if (!opts.raw) v = v.replace(/\s+/g, " ").trim();
        if (v.length < (opts.min ?? 1)) fail("required");
        else if (v.length > (opts.max ?? 200)) fail("too-long");
        else out[k] = v;
        break;
      }
      case "id":
        if (typeof v !== "string" || !ID_RE.test(v)) fail("invalid");
        else out[k] = v;
        break;
      case "requestId":
        if (typeof v !== "string" || !REQUEST_ID_RE.test(v)) fail("invalid");
        else out[k] = v;
        break;
      case "int":
        if (!Number.isInteger(v)) fail("integer");
        else if (v < (opts.min ?? 0) || v > (opts.max ?? 1_000_000_000)) fail("range");
        else out[k] = v;
        break;
      case "bool":
        if (typeof v !== "boolean") fail("boolean");
        else out[k] = v;
        break;
      case "enum":
        if (typeof v !== "string" || !opts.values.includes(v)) fail("invalid");
        else out[k] = v;
        break;
      case "ymd":
        if (typeof v !== "string" || !isValidYmd(v)) fail("invalid");
        else out[k] = v;
        break;
      case "list": {
        if (!Array.isArray(v)) {
          fail("array");
          break;
        }
        if (v.length > (opts.max ?? 100)) {
          fail("too-many");
          break;
        }
        const items = [];
        v.forEach((item, i) => {
          if (Object.keys(errors).length >= MAX_ERRORS) return;
          if (opts.of === "id") {
            if (typeof item !== "string" || !ID_RE.test(item)) errors[`${path}[${i}]`] = "invalid";
            else items.push(item);
          } else if (opts.of === "str") {
            if (typeof item !== "string") errors[`${path}[${i}]`] = "string";
            else items.push(item);
          } else {
            const sub = parseWith(item, opts.of, errors, `${path}[${i}].`);
            if (sub) items.push(sub);
          }
        });
        out[k] = items;
        break;
      }
      default:
        throw new Error(`parse: tipo desconocido ${type}`);
    }
  }
  return out;
}

function parse(data, spec) {
  const errors = {};
  const out = parseWith(data, spec, errors, "");
  if (Object.keys(errors).length) {
    const limited = Object.fromEntries(Object.entries(errors).slice(0, MAX_ERRORS));
    throw new HttpsError("invalid-argument", "outreach/invalid-argument", { fields: limited });
  }
  return out;
}

module.exports = { parse, sizeOf, ID_RE, REQUEST_ID_RE };
