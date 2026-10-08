// @vitest-environment node
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPublicCalendar } from "@/lib/shared/public-calendar";
import { AREAS, CANARIES, EVENTS, NOW, TODAY } from "../platform/public-calendar-fixtures";
import { CalendarMemoryStore, fixedClock } from "./calendar-memory-store";

const require = createRequire(import.meta.url);
const { createPublicFeedHandler } = require("../../functions/calendar/public-feed.js");
const { createShareLinkService } = require("../../functions/calendar/share-links.js");
const { hashShareToken } = require("../../functions/calendar/share-token.js");

// 2026-10-04 12:00 en Santiago (-03, horario de verano)
const CLOCK = fixedClock("2026-10-04T15:00:00Z");
const TOKEN = "T".repeat(20) + "-_" + "x".repeat(21);
const OTHER_TOKEN = "Q".repeat(43);

type Res = {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string | null;
  set(key: string, value: string): Res;
  status(code: number): Res;
  send(body: string): Res;
};

function fakeRes(): Res {
  const res: Res = {
    statusCode: null,
    headers: {},
    body: null,
    set(key, value) {
      res.headers[key.toLowerCase()] = value;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    send(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

// El token viaja en el cuerpo JSON ya parseado ({ token }) — doc 20 §5. `query` existe para
// probar que la URL se ignora.
function fakeReq(
  method: string,
  body: unknown = undefined,
  headers: Record<string, string> = {},
  query: Record<string, unknown> = {},
) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, body, query, headers: lower, get: (name: string) => lower[name.toLowerCase()] };
}
const post = (token: unknown, headers: Record<string, string> = {}) => fakeReq("POST", { token }, headers);

function seededStore(link: Record<string, unknown> | null = { tokenHash: hashShareToken(TOKEN), active: true, rotation: 1 }) {
  const store = new CalendarMemoryStore();
  for (const e of EVENTS) store.events.set(e.id, { ...e });
  for (const a of AREAS) store.areas.set(a.id, { ...a });
  store.shareLink = link;
  return store;
}

async function call(handler: (req: unknown, res: unknown) => Promise<void>, req: ReturnType<typeof fakeReq>) {
  const res = fakeRes();
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null, raw: res.body };
}

const SAFE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
};

let logs: unknown[][] = [];
beforeEach(() => {
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

function expectNoSecretsInLogs(...secrets: string[]) {
  const text = JSON.stringify(logs);
  for (const s of secrets) expect(text).not.toContain(s);
}

describe("calendarPublicFeed · 200", () => {
  it("forma exacta, proyección compartida y headers de privacidad", async () => {
    const handler = createPublicFeedHandler({ store: seededStore(), clock: CLOCK, isEmulator: false });
    const r = await call(handler, post(TOKEN));
    expect(r.status).toBe(200);
    expect(r.headers).toEqual({ ...SAFE_HEADERS, "cache-control": "no-store" });
    expect(Object.keys(r.body).sort()).toEqual(["calendar", "ok"]);
    expect(r.body.ok).toBe(true);
    const expected = buildPublicCalendar({ events: EVENTS, areas: AREAS, today: TODAY, now: NOW });
    expect(r.body.calendar).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(r.body.calendar.range).toEqual({ from: "2026-09-01", to: "2027-04-30" });
    expect(r.headers["cache-control"]).not.toMatch(/max-age|public/);
  });

  it("recurrencia expandida en el servidor; internas y archivadas fuera; canarios ausentes", async () => {
    const handler = createPublicFeedHandler({ store: seededStore(), clock: CLOCK, isEmulator: false });
    const r = await call(handler, post(TOKEN));
    const cultos = r.body.calendar.events.filter((e: { title: string }) => e.title === "Culto dominical");
    expect(cultos.length).toBeGreaterThan(20);
    for (const c of Object.values(CANARIES)) expect(r.raw).not.toContain(c);
    expect(r.raw).not.toContain("@");
    expect(r.raw).not.toContain(hashShareToken(TOKEN));
    expect(r.raw).not.toContain(TOKEN);
  });

  it("solo pide eventos desde el inicio del rango público", async () => {
    const store = seededStore();
    const handler = createPublicFeedHandler({ store, clock: CLOCK });
    await call(handler, post(TOKEN));
    expect(store.calls).toContain("listPublicEventsFrom:2026-09-01");
  });
});

describe("calendarPublicFeed · 404 uniforme", () => {
  it("mal formado, inexistente y desactivado responden idéntico (status + headers + body)", async () => {
    const make = (link: Record<string, unknown> | null) => createPublicFeedHandler({ store: seededStore(link), clock: CLOCK });
    const active = { tokenHash: hashShareToken(TOKEN), active: true };
    const cases = [
      await call(make(active), fakeReq("POST", {})),
      await call(make(active), fakeReq("POST")),
      await call(make(active), fakeReq("POST", TOKEN)),
      await call(make(active), fakeReq("POST", [TOKEN])),
      await call(make(active), fakeReq("POST", Buffer.from(JSON.stringify({ token: TOKEN })))),
      await call(make(active), fakeReq("POST", {}, {}, { t: TOKEN })),
      await call(make(active), post("corto")),
      await call(make(active), post(`${TOKEN}A`)),
      await call(make(active), post(`${TOKEN.slice(0, 42)}=`)),
      await call(make(active), post([TOKEN, TOKEN])),
      await call(make(active), post(OTHER_TOKEN)),
      await call(make(null), post(TOKEN)),
      await call(make({ ...active, active: false }), post(TOKEN)),
      await call(make({ ...active, active: "true" }), post(TOKEN)),
    ];
    const first = cases[0];
    expect(first.status).toBe(404);
    expect(first.raw).toBe('{"ok":false,"error":"unavailable"}');
    expect(first.headers).toEqual({ ...SAFE_HEADERS, "cache-control": "no-store" });
    for (const c of cases) {
      expect({ status: c.status, headers: c.headers, raw: c.raw }).toEqual({ status: first.status, headers: first.headers, raw: first.raw });
    }
    expectNoSecretsInLogs(TOKEN, hashShareToken(TOKEN), OTHER_TOKEN, hashShareToken(OTHER_TOKEN));
  });

  it("un token mal formado no llega al store", async () => {
    const store = seededStore();
    await call(createPublicFeedHandler({ store, clock: CLOCK }), post("nope"));
    expect(store.calls).toEqual([]);
  });

  it("tras regenerar, el token anterior deja de funcionar y el nuevo sí", async () => {
    const store = seededStore(null);
    store.users.set("u-admin", { role: "admin", active: true });
    const service = createShareLinkService({ store, clock: CLOCK });
    const { token: first } = await service.handle("u-admin", "create");
    const handler = createPublicFeedHandler({ store, clock: CLOCK });
    expect((await call(handler, post(first))).status).toBe(200);
    const { token: second } = await service.handle("u-admin", "regenerate");
    expect(second).not.toBe(first);
    const old = await call(handler, post(first));
    const nonexistent = await call(handler, post(OTHER_TOKEN));
    expect(old).toEqual(nonexistent);
    expect(old.status).toBe(404);
    expect((await call(handler, post(second))).status).toBe(200);
    // desactivar corta; activar vuelve a habilitar el MISMO token
    await service.handle("u-admin", "deactivate");
    expect((await call(handler, post(second))).status).toBe(404);
    await service.handle("u-admin", "activate");
    expect((await call(handler, post(second))).status).toBe(200);
    expectNoSecretsInLogs(first, second, hashShareToken(first), hashShareToken(second));
  });
});

describe("calendarPublicFeed · métodos, CORS y errores", () => {
  it("métodos distintos de POST → 405 sin cache, aunque traigan el token en la query o el cuerpo", async () => {
    const store = seededStore();
    const handler = createPublicFeedHandler({ store, clock: CLOCK, isEmulator: false });
    for (const method of ["GET", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
      const r = await call(handler, fakeReq(method, { token: TOKEN }, {}, { t: TOKEN }));
      expect(r.status).toBe(405);
      expect(r.body).toEqual({ ok: false, error: "method_not_allowed" });
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers.allow).toBe("POST");
    }
    expect(store.calls).toEqual([]);
  });

  it("el token en la query nunca se lee (POST con ?t= válido y sin cuerpo → 404 sin tocar el store)", async () => {
    const store = seededStore();
    const r = await call(createPublicFeedHandler({ store, clock: CLOCK }), fakeReq("POST", undefined, {}, { t: TOKEN }));
    expect(r.status).toBe(404);
    expect(store.calls).toEqual([]);
  });

  it("sin emulador nunca emite CORS (aunque el origen sea localhost)", async () => {
    const handler = createPublicFeedHandler({ store: seededStore(), clock: CLOCK, isEmulator: false });
    const r = await call(handler, post(TOKEN, { Origin: "http://localhost:3000" }));
    expect(Object.keys(r.headers).some((k) => k.startsWith("access-control-"))).toBe(false);
    expect(r.headers.vary).toBeUndefined();
  });

  it("en el emulador: CORS solo para localhost:3000 / 127.0.0.1:3000, con Vary: Origin", async () => {
    const handler = createPublicFeedHandler({ store: seededStore(), clock: CLOCK, isEmulator: true });
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      const ok = await call(handler, post(TOKEN, { Origin: origin }));
      expect(ok.status).toBe(200);
      expect(ok.headers["access-control-allow-origin"]).toBe(origin);
      expect(ok.headers.vary).toBe("Origin");
      const missing = await call(handler, post("x", { Origin: origin }));
      expect(missing.status).toBe(404);
      expect(missing.headers["access-control-allow-origin"]).toBe(origin);
    }
    const evil = await call(handler, post(TOKEN, { Origin: "https://evil.example" }));
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    expect(evil.headers.vary).toBe("Origin");
    const preflight = await call(handler, fakeReq("OPTIONS", undefined, { Origin: "http://localhost:3000" }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
    expect(preflight.headers["access-control-allow-headers"]).toBe("Content-Type");
  });

  it("error interno → 500 sin cache y el log no contiene token ni hash", async () => {
    const store = seededStore();
    const hash = hashShareToken(TOKEN);
    store.listAreas = async () => {
      throw Object.assign(new Error(`fallo leyendo con ${TOKEN} y ${hash}`), { code: 14 });
    };
    const r = await call(createPublicFeedHandler({ store, clock: CLOCK }), post(TOKEN));
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ ok: false, error: "internal" });
    expect(r.headers).toEqual({ ...SAFE_HEADERS, "cache-control": "no-store" });
    expect(logs.length).toBeGreaterThan(0);
    expectNoSecretsInLogs(TOKEN, hash);
  });

  it("logs de éxito: solo { ok, count }", async () => {
    await call(createPublicFeedHandler({ store: seededStore(), clock: CLOCK }), post(TOKEN));
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toBe("calendarPublicFeed");
    expect(Object.keys(logs[0][1] as object).sort()).toEqual(["count", "ok"]);
    expectNoSecretsInLogs(TOKEN, hashShareToken(TOKEN));
  });
});
