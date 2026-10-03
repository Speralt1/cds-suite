// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  calendarFeedUrl,
  fetchPublicCalendar,
  PublicFeedError,
  publicCalendarUrl,
  shareTokenFromLocation,
  usesFunctionsEmulator,
  type FetchLike,
} from "@/lib/calendar/public-feed-client";
import { buildPublicCalendar } from "@/lib/shared/public-calendar";
import { AREAS, EVENTS, NOW, TODAY } from "./public-calendar-fixtures";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd"; // 42
const VALID = `${TOKEN}e`; // 43
const PROD = { nodeEnv: "production", useEmulators: undefined, projectId: "cds-administracion" };
const DEV_EMU = { nodeEnv: "development", useEmulators: "true", projectId: "demo-cds-suite" };
const CAL = buildPublicCalendar({ events: EVENTS, areas: AREAS, today: TODAY, now: NOW });

function response(status: number, body?: unknown, jsonFails = false) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (jsonFails) throw new SyntaxError("bad json");
      return body;
    },
  };
}

describe("calendarFeedUrl", () => {
  it("emulador solo con desarrollo + emuladores + proyecto demo-", () => {
    expect(VALID).toHaveLength(43);
    expect(calendarFeedUrl(DEV_EMU)).toBe("http://127.0.0.1:5001/demo-cds-suite/southamerica-west1/calendarPublicFeed");
    expect(usesFunctionsEmulator(DEV_EMU)).toBe(true);
  });

  it("en cualquier otro caso, el rewrite same-origin", () => {
    expect(calendarFeedUrl(PROD)).toBe("/api/calendario-publico");
    expect(calendarFeedUrl({ ...DEV_EMU, useEmulators: undefined })).toBe("/api/calendario-publico");
    expect(calendarFeedUrl({ ...DEV_EMU, useEmulators: "1" })).toBe("/api/calendario-publico");
    expect(calendarFeedUrl({ ...DEV_EMU, projectId: "cds-administracion" })).toBe("/api/calendario-publico");
    expect(calendarFeedUrl({ ...DEV_EMU, nodeEnv: "production" })).toBe("/api/calendario-publico");
    expect(calendarFeedUrl({ ...DEV_EMU, nodeEnv: "test" })).toBe("/api/calendario-publico");
  });
});

describe("publicCalendarUrl", () => {
  it("producción: /calendario/compartir/<enlace>", () => {
    expect(publicCalendarUrl(VALID, "https://cds-administracion.web.app", PROD)).toBe(
      `https://cds-administracion.web.app/calendario/compartir/${VALID}`,
    );
    expect(publicCalendarUrl(VALID, "https://cds.example/", PROD)).toBe(`https://cds.example/calendario/compartir/${VALID}`);
  });

  it("desarrollo: /calendario-publico?t=<enlace>", () => {
    expect(publicCalendarUrl(VALID, "http://localhost:3000", DEV_EMU)).toBe(`http://localhost:3000/calendario-publico?t=${VALID}`);
    expect(publicCalendarUrl(VALID, "http://localhost:3000", { nodeEnv: "development" })).toBe(
      `http://localhost:3000/calendario-publico?t=${VALID}`,
    );
  });
});

describe("shareTokenFromLocation", () => {
  it("lee el último segmento de /calendario/compartir/<t> o ?t=", () => {
    expect(shareTokenFromLocation({ pathname: `/calendario/compartir/${VALID}`, search: "" })).toBe(VALID);
    expect(shareTokenFromLocation({ pathname: `/calendario/compartir/${VALID}/`, search: "" })).toBe(VALID);
    expect(shareTokenFromLocation({ pathname: "/calendario-publico", search: `?t=${VALID}` })).toBe(VALID);
    expect(shareTokenFromLocation({ pathname: "/calendario-publico", search: "" })).toBeNull();
    expect(shareTokenFromLocation({ pathname: "/calendario/compartir/a/b", search: "" })).toBeNull();
    expect(shareTokenFromLocation({ pathname: "/calendario/compartir/%E0%A4%A", search: "" })).toBeNull();
  });
});

describe("fetchPublicCalendar", () => {
  it("un enlace mal formado nunca se envía", async () => {
    const fetch = vi.fn<FetchLike>();
    for (const bad of [undefined, null, "", "abc", TOKEN, `${VALID}x`, `${TOKEN}=`, `${TOKEN}/`, `${TOKEN}.`, 42, {}]) {
      await expect(fetchPublicCalendar(bad, { fetch, env: PROD })).resolves.toBe("unavailable");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("404 → unavailable", async () => {
    const fetch = vi.fn<FetchLike>(async () => response(404, { ok: false, error: "unavailable" }));
    await expect(fetchPublicCalendar(VALID, { fetch, env: PROD })).resolves.toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`/api/calendario-publico?t=${VALID}`);
    expect(init).toMatchObject({ method: "GET", credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("200 → calendario público; en dev con emuladores pega al emulador", async () => {
    const fetch = vi.fn<FetchLike>(async () => response(200, { ok: true, calendar: CAL }));
    await expect(fetchPublicCalendar(VALID, { fetch, env: DEV_EMU })).resolves.toEqual(CAL);
    expect(fetch.mock.calls[0][0]).toBe(
      `http://127.0.0.1:5001/demo-cds-suite/southamerica-west1/calendarPublicFeed?t=${VALID}`,
    );
  });

  it("red caída, 5xx o respuesta inesperada → lanza (la página ofrece Reintentar)", async () => {
    const offline = vi.fn<FetchLike>(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchPublicCalendar(VALID, { fetch: offline, env: PROD })).rejects.toBeInstanceOf(PublicFeedError);
    await expect(fetchPublicCalendar(VALID, { fetch: offline, env: PROD })).rejects.toMatchObject({ kind: "network" });
    const server = vi.fn<FetchLike>(async () => response(500, { ok: false, error: "internal" }));
    await expect(fetchPublicCalendar(VALID, { fetch: server, env: PROD })).rejects.toMatchObject({ kind: "server" });
    const badJson = vi.fn<FetchLike>(async () => response(200, null, true));
    await expect(fetchPublicCalendar(VALID, { fetch: badJson, env: PROD })).rejects.toMatchObject({ kind: "invalid" });
    const badShape = vi.fn<FetchLike>(async () => response(200, { ok: true, calendar: { events: [] } }));
    await expect(fetchPublicCalendar(VALID, { fetch: badShape, env: PROD })).rejects.toMatchObject({ kind: "invalid" });
  });
});
