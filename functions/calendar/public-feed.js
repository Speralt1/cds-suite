"use strict";

/**
 * functions/calendar/public-feed.js
 *
 * Handler HTTP de `calendarPublicFeed` (18a §E.1). Inyectable: no toca Admin
 * SDK directamente; recibe un `store` (ver firestore-store.js) y un `clock`.
 *
 * - GET ?t=<token>. OPTIONS solo en el emulador (CORS de desarrollo).
 * - Token mal formado, inexistente o desactivado → el MISMO 404
 *   {"ok":false,"error":"unavailable"} con los mismos headers.
 * - 200 {ok:true, calendar} con la proyección pública compartida (lista blanca).
 * - Nunca se loguea el token ni su hash.
 */

const { hashShareToken, isWellFormedShareToken } = require("./share-token");
const { localNow } = require("../shared/dates");
const { buildPublicCalendar, publicRange } = require("../shared/public-calendar");

const DEV_ORIGINS = Object.freeze(["http://localhost:3000", "http://127.0.0.1:3000"]);
const UNAVAILABLE_BODY = Object.freeze({ ok: false, error: "unavailable" });
const METHOD_NOT_ALLOWED_BODY = Object.freeze({ ok: false, error: "method_not_allowed" });
const INTERNAL_BODY = Object.freeze({ ok: false, error: "internal" });

const BASE_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
});

function scrub(message, secrets) {
  let text = String(message ?? "");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text.slice(0, 500);
}

/**
 * @param {{
 *   store: { findShareLinkByHash(hash: string): Promise<object|null>,
 *            listPublicEventsFrom(from: string): Promise<object[]>,
 *            listAreas(): Promise<object[]> },
 *   clock: { now(): number },
 *   isEmulator?: boolean,
 *   logger?: { info: Function, error: Function },
 * }} deps
 */
function createPublicFeedHandler({ store, clock, isEmulator = false, logger = console }) {
  if (!store || !clock) throw new Error("createPublicFeedHandler: store y clock son obligatorios");

  function corsHeaders(req) {
    if (!isEmulator) return {};
    const origin = typeof req.get === "function" ? req.get("origin") : req.headers?.origin;
    const headers = { Vary: "Origin" };
    if (typeof origin === "string" && DEV_ORIGINS.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    }
    return headers;
  }

  function send(req, res, status, body, extra) {
    const headers = {
      ...BASE_HEADERS,
      "Cache-Control": status === 200 ? "private, max-age=60" : "no-store",
      ...corsHeaders(req),
      ...(extra || {}),
    };
    for (const [key, value] of Object.entries(headers)) res.set(key, value);
    res.status(status).send(JSON.stringify(body));
  }

  return async function calendarPublicFeedHandler(req, res) {
    if (req.method === "OPTIONS" && isEmulator) {
      const headers = { ...BASE_HEADERS, "Cache-Control": "no-store", ...corsHeaders(req) };
      for (const [key, value] of Object.entries(headers)) res.set(key, value);
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      send(req, res, 405, METHOD_NOT_ALLOWED_BODY, { Allow: "GET" });
      return;
    }

    const raw = req.query ? req.query.t : undefined;
    const token = isWellFormedShareToken(raw) ? raw : null;
    let hash = null;
    try {
      if (!token) {
        logger.info("calendarPublicFeed", { ok: false });
        send(req, res, 404, UNAVAILABLE_BODY);
        return;
      }
      hash = hashShareToken(token);
      const link = await store.findShareLinkByHash(hash);
      if (!link || link.active !== true || link.tokenHash !== hash) {
        logger.info("calendarPublicFeed", { ok: false });
        send(req, res, 404, UNAVAILABLE_BODY);
        return;
      }

      const now = localNow(new Date(clock.now()));
      const today = now.slice(0, 10);
      const range = publicRange(today);
      const [events, areas] = await Promise.all([store.listPublicEventsFrom(range.from), store.listAreas()]);
      const calendar = buildPublicCalendar({
        events: (events || []).filter((e) => e && e.visibility === "public" && e.status !== "archived" && e.startDate <= range.to),
        areas: areas || [],
        today,
        now,
      });
      logger.info("calendarPublicFeed", { ok: true, count: calendar.events.length });
      send(req, res, 200, { ok: true, calendar });
    } catch (error) {
      logger.error("calendarPublicFeed", {
        ok: false,
        name: error && error.name ? String(error.name) : "Error",
        code: error && error.code !== undefined ? String(error.code) : undefined,
        message: scrub(error && error.message, [token, hash]),
      });
      send(req, res, 500, INTERNAL_BODY);
    }
  };
}

module.exports = { createPublicFeedHandler, DEV_ORIGINS, UNAVAILABLE_BODY };
