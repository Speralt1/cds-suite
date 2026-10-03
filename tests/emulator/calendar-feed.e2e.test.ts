// Smoke real: seed → calendarPublicFeed y calendarShareLinkManage a través del
// emulador de Functions (doc 18a §J.4). Solo `npm run test:emulator`.
import { beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_AREA_KEYS, PUBLIC_CALENDAR_KEYS, PUBLIC_EVENT_KEYS } from "@/lib/shared/public-calendar";
import type { PublicCalendar } from "@/lib/shared/types";
import { ARCHIVED_TITLE, SEED_CANARIES, SEED_USERS } from "../../scripts/seed-platform-calendar-emulator.mjs";
import { FEED_URL, callShareLink, fetchFeed, seed, signIn, type FeedResponse } from "./helpers";

const PUBLIC_TITLES = [
  "Culto dominical",
  "Escuela dominical",
  "Reunión de jóvenes",
  "Ayuno congregacional",
  "Vigilia",
  "Campamento de jóvenes",
  "Evangelismo en la plaza",
  "Reunión de damas",
];
const INTERNAL_TITLES = ["Ensayo de alabanza", "Planificación del retiro de jóvenes", "Desayuno de varones", "Taller de matrimonios", ARCHIVED_TITLE];
const UNKNOWN_TOKEN = "Z".repeat(20) + "-_" + "q".repeat(21);

function expectUnavailable(res: FeedResponse, reference: FeedResponse) {
  expect(res.status).toBe(404);
  expect(res.text).toBe('{"ok":false,"error":"unavailable"}');
  expect(res.status).toBe(reference.status);
  expect(res.text).toBe(reference.text);
  expect(res.headers).toEqual(reference.headers);
}

function expectNoLeaks(text: string) {
  for (const canary of Object.values(SEED_CANARIES)) expect(text).not.toContain(canary);
  expect(text).not.toContain("CANARIO");
  for (const u of SEED_USERS) {
    expect(text).not.toContain(u.uid);
    expect(text).not.toContain(u.email);
  }
  expect(text).not.toContain("@cds.test");
  for (const key of ["internalNotes", "cancelReason", "archiveReason", "exceptions", "seriesCancellation", "createdBy", "updatedBy", "tokenHash"]) {
    expect(text).not.toContain(`"${key}"`);
  }
}

describe("calendario público vía emulador de Functions", () => {
  let token = "";
  let pastorToken = "";
  let malformed: FeedResponse;

  beforeAll(async () => {
    const result = await seed();
    token = result.token;
    // El token nunca va en una URL: el enlace lo lleva en el fragmento y el feed lo recibe en el cuerpo.
    expect(result.feedUrl).toBe(FEED_URL);
    expect(result.feedUrl).not.toContain(token);
    expect(result.publicUrl).toBe(`http://localhost:3000/calendario-publico#${token}`);
    pastorToken = await signIn("pastor@cds.test");
    malformed = await fetchFeed("abc");
  });

  it("token válido → 200 con solo actividades públicas y claves en lista blanca, sin canarios", async () => {
    const res = await fetchFeed(token);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.headers["cache-control"]).toBe("no-store");

    const body = JSON.parse(res.text) as { ok: boolean; calendar: PublicCalendar };
    expect(Object.keys(body).sort()).toEqual(["calendar", "ok"]);
    expect(body.ok).toBe(true);
    const cal = body.calendar;
    expect(Object.keys(cal).sort()).toEqual([...PUBLIC_CALENDAR_KEYS].sort());
    expect(cal.events.length).toBeGreaterThan(0);
    for (const e of cal.events) {
      expect(Object.keys(e).sort()).toEqual([...PUBLIC_EVENT_KEYS].sort());
      expect(e.id).toMatch(/^pe_[0-9a-f]{16}$/);
      expect(Object.keys(e.responsibleArea).sort()).toEqual([...PUBLIC_AREA_KEYS].sort());
      for (const a of e.participantAreas) expect(Object.keys(a).sort()).toEqual([...PUBLIC_AREA_KEYS].sort());
    }
    for (const a of cal.areas) expect(Object.keys(a).sort()).toEqual([...PUBLIC_AREA_KEYS].sort());

    const titles = new Set(cal.events.map((e) => e.title));
    for (const t of PUBLIC_TITLES) expect(titles.has(t), t).toBe(true);
    for (const t of INTERNAL_TITLES) expect(titles.has(t), t).toBe(false);

    // Cancelaciones visibles como estado, nunca con su motivo.
    expect(cal.events.find((e) => e.title === "Evangelismo en la plaza")?.status).toBe("cancelled");
    expect(cal.events.some((e) => e.title === "Reunión de jóvenes" && e.status === "cancelled")).toBe(true);
    // Área inactiva fuera del encabezado.
    expect(cal.areas.map((a) => a.slug)).not.toContain("matrimonios");
    expectNoLeaks(res.text);
  });

  it("token mal formado, ausente o desconocido → mismo 404 (estado, cuerpo y headers)", async () => {
    expectUnavailable(malformed, malformed);
    expectUnavailable(await fetchFeed(null), malformed);
    expectUnavailable(await fetchFeed(UNKNOWN_TOKEN), malformed);
    expectUnavailable(await fetchFeed(`${token}x`), malformed);
    expectUnavailable(await fetchFeed(null, { body: JSON.stringify({ token: [token] }) }), malformed);
    expectUnavailable(await fetchFeed(null, { body: JSON.stringify([token]) }), malformed);
  });

  it("token en la query (formato anterior) nunca se acepta: GET → 405 y POST sin cuerpo → el mismo 404", async () => {
    const get = await fetchFeed(null, { method: "GET", query: `t=${encodeURIComponent(token)}` });
    expect(get.status).toBe(405);
    expect(get.text).not.toContain('"calendar"');
    expect(get.headers["cache-control"]).toBe("no-store");
    expectUnavailable(await fetchFeed(null, { query: `t=${encodeURIComponent(token)}` }), malformed);
    expectUnavailable(await fetchFeed(null, { query: `token=${encodeURIComponent(token)}`, body: "{}" }), malformed);
    // El token válido en el cuerpo sigue funcionando.
    expect((await fetchFeed(token)).status).toBe(200);
  });

  it("desactivar el enlace → mismo 404; activarlo devuelve el MISMO enlace (R4)", async () => {
    const off = await callShareLink(pastorToken, "deactivate");
    expect(off.status).toBe(200);
    expect(off.result?.status).toMatchObject({ exists: true, active: false });
    expect(off.result?.token).toBeUndefined();
    expectUnavailable(await fetchFeed(token), malformed);

    const on = await callShareLink(pastorToken, "activate");
    expect(on.result?.status).toMatchObject({ exists: true, active: true });
    expect((await fetchFeed(token)).status).toBe(200);
  });

  it("generar enlace nuevo vía callable (manage_all) → el anterior 404, el nuevo 200", async () => {
    const res = await callShareLink(pastorToken, "regenerate");
    expect(res.status).toBe(200);
    const fresh = res.result?.token ?? "";
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fresh).not.toBe(token);
    expect(JSON.stringify(res.result?.status)).not.toMatch(/tokenHash|[0-9a-f]{64}/);

    expectUnavailable(await fetchFeed(token), malformed);
    const ok = await fetchFeed(fresh);
    expect(ok.status).toBe(200);
    expectNoLeaks(ok.text);
    token = fresh;
  });

  it("admin legacy (fallback) puede consultar el estado; nunca recibe hash ni token", async () => {
    const res = await callShareLink(await signIn("admin@cds.test"), "status");
    expect(res.status).toBe(200);
    expect(res.result?.status).toMatchObject({ exists: true, active: true });
    expect(res.result?.token).toBeUndefined();
    expect(JSON.stringify(res.result)).not.toMatch(/[0-9a-f]{64}/);
  });

  it("líder sin manage_all → permission-denied; sin sesión → unauthenticated; el enlace sigue igual", async () => {
    for (const email of ["lider.jovenes@cds.test", "diacono.publica@cds.test", "finanzas@cds.test"]) {
      const denied = await callShareLink(await signIn(email), "regenerate");
      expect(denied.error?.status, email).toBe("PERMISSION_DENIED");
      expect(denied.error?.message).toBe("share/forbidden");
      expect(denied.result).toBeUndefined();
    }
    const anon = await callShareLink(null, "status");
    expect(anon.error?.status).toBe("UNAUTHENTICATED");
    expect((await fetchFeed(token)).status).toBe(200);
  });

  it("usuario inactivo → permission-denied", async () => {
    const res = await callShareLink(await signIn("inactivo@cds.test"), "status");
    expect(res.error?.status).toBe("PERMISSION_DENIED");
  });
});
