// @vitest-environment node
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarMemoryStore } from "./calendar-memory-store";

const require = createRequire(import.meta.url);
const { createShareLinkService, createShareLinkCallableHandler, SHARE_ERROR_KEYS } = require("../../functions/calendar/share-links.js");
const { hashShareToken } = require("../../functions/calendar/share-token.js");

const T0 = "2026-10-04T15:00:00.000Z";

const USERS: Record<string, Record<string, unknown>> = {
  "u-admin": { role: "admin", active: true },
  "u-admin-v1": { accessSchemaVersion: 1, role: "admin", active: true, baseRole: "admin", permissions: [], areaIds: [], homeModule: "finance" },
  "u-pastor": { role: "pastor", active: true },
  "u-all-v1": {
    accessSchemaVersion: 1,
    role: "leader",
    active: true,
    baseRole: "standard",
    permissions: ["calendar.events.manage_all"],
    areaIds: [],
    homeModule: "calendar",
  },
  "u-finance": { role: "finance", active: true },
  "u-leader": { role: "leader", active: true },
  "u-publisher-v1": {
    accessSchemaVersion: 1,
    role: "leader",
    active: true,
    baseRole: "standard",
    permissions: ["calendar.events.manage_assigned", "calendar.events.publish_assigned"],
    areaIds: ["jovenes"],
    homeModule: "calendar",
  },
  "u-settings-stored": {
    accessSchemaVersion: 1,
    role: "leader",
    active: true,
    baseRole: "standard",
    permissions: ["settings.manage"],
    areaIds: [],
    homeModule: "calendar",
  },
  "u-admin-inactive": { role: "admin", active: false },
  "u-pastor-inactive-v1": { accessSchemaVersion: 1, role: "pastor", active: false, baseRole: "standard", permissions: ["calendar.events.manage_all"] },
};

function setup(iso = T0) {
  const store = new CalendarMemoryStore();
  for (const [uid, doc] of Object.entries(USERS)) store.users.set(uid, doc);
  let now = Date.parse(iso);
  let seed = 0;
  const clock = { now: () => now };
  const randomBytes = (n: number) => {
    seed += 1;
    return Buffer.alloc(n, seed);
  };
  const service = createShareLinkService({ store, clock, randomBytes });
  return { store, service, advance: (ms: number) => (now += ms) };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message?: string; constructor: { name: string } };
    return { code: e.code, message: e.message, name: e.constructor.name };
  }
  throw new Error("se esperaba un error");
}

function deepStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value instanceof Date) return [value.toISOString()];
  if (Array.isArray(value)) return value.flatMap(deepStrings);
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...deepStrings(v)]);
  return [];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("autorización (manage_all con fallback legacy)", () => {
  it.each(["u-admin", "u-admin-v1", "u-pastor", "u-all-v1"])("%s puede administrar el enlace", async (uid) => {
    const { service } = setup();
    await expect(service.handle(uid, "status")).resolves.toEqual({
      status: { exists: false, active: false, createdAt: null, regeneratedAt: null, disabledAt: null, createdByName: null, regeneratedByName: null, disabledByName: null },
    });
  });

  it.each(["u-finance", "u-leader", "u-publisher-v1", "u-settings-stored", "u-admin-inactive", "u-pastor-inactive-v1", "u-no-existe"])(
    "%s → permission-denied share/forbidden",
    async (uid) => {
      const { service, store } = setup();
      expect(await rejection(service.handle(uid, "create"))).toMatchObject({
        code: "permission-denied",
        message: SHARE_ERROR_KEYS.forbidden,
        name: "HttpsError",
      });
      expect(store.shareLink).toBeNull();
    },
  );

  it("sin sesión → unauthenticated share/unauthenticated (antes de leer nada)", async () => {
    const { service, store } = setup();
    for (const uid of [null, undefined, ""]) {
      expect(await rejection(service.handle(uid, "status"))).toMatchObject({ code: "unauthenticated", message: "share/unauthenticated" });
    }
    expect(store.calls).toEqual([]);
  });

  it("acción inválida → invalid-argument share/invalid-action", async () => {
    const { service } = setup();
    for (const action of [undefined, "delete", "STATUS", 3]) {
      expect(await rejection(service.handle("u-admin", action))).toMatchObject({ code: "invalid-argument", message: "share/invalid-action" });
    }
  });
});

describe("create / regenerate / activate / deactivate", () => {
  it("create: token en claro una sola vez; se guarda solo el hash", async () => {
    const { service, store } = setup();
    const result = await service.handle("u-admin", "create");
    expect(Object.keys(result).sort()).toEqual(["status", "token"]);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.status).toEqual({ exists: true, active: true, createdAt: T0, regeneratedAt: null, disabledAt: null, createdByName: null, regeneratedByName: null, disabledByName: null });
    const doc = store.shareLink!;
    expect(Object.keys(doc).sort()).toEqual(["active", "createdAt", "createdBy", "rotation", "tokenHash", "updatedAt", "updatedBy"]);
    expect(doc).toMatchObject({ tokenHash: hashShareToken(result.token), active: true, createdBy: "u-admin", rotation: 1, updatedBy: "u-admin" });
    expect(deepStrings(doc).some((s) => s.includes(result.token))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(doc.tokenHash as string);
  });

  it("una segunda creación → failed-precondition share/already-exists, sin token y sin escribir", async () => {
    const { service, store } = setup();
    await service.handle("u-admin", "create");
    const before = structuredClone(store.shareLink);
    const writes = store.writes.length;
    expect(await rejection(service.handle("u-pastor", "create"))).toMatchObject({
      code: "failed-precondition",
      message: "share/already-exists",
    });
    expect(store.shareLink).toEqual(before);
    expect(store.writes).toHaveLength(writes);
  });

  it("regenerate: nuevo token, nuevo hash (el anterior muere), rotation+1, reactiva y borra disabledAt", async () => {
    const { service, store, advance } = setup();
    expect(await rejection(service.handle("u-admin", "regenerate"))).toMatchObject({ code: "not-found", message: "share/not-found" });
    const first = await service.handle("u-admin", "create");
    const firstHash = store.shareLink!.tokenHash;
    advance(60_000);
    await service.handle("u-admin", "deactivate");
    advance(60_000);
    const second = await service.handle("u-pastor", "regenerate");
    expect(second.token).not.toBe(first.token);
    const doc = store.shareLink!;
    expect(doc.tokenHash).toBe(hashShareToken(second.token));
    expect(doc.tokenHash).not.toBe(firstHash);
    expect(doc).toMatchObject({ active: true, rotation: 2, createdBy: "u-admin", updatedBy: "u-pastor" });
    expect(doc).not.toHaveProperty("disabledAt");
    expect(second.status).toEqual({
      exists: true,
      active: true,
      createdAt: T0,
      regeneratedAt: "2026-10-04T15:02:00.000Z",
      disabledAt: null,
      createdByName: null,
      regeneratedByName: null,
      disabledByName: null,
    });
    expect(deepStrings(doc).some((s) => s.includes(second.token) || s.includes(first.token))).toBe(false);
    // no es idempotente: cada llamada rota
    const third = await service.handle("u-admin", "regenerate");
    expect(third.token).not.toBe(second.token);
    expect(store.shareLink!.rotation).toBe(3);
  });

  it("deactivate/activate: pausa y reactiva el MISMO enlace; ambos idempotentes", async () => {
    const { service, store, advance } = setup();
    expect(await rejection(service.handle("u-admin", "activate"))).toMatchObject({ code: "not-found" });
    expect(await rejection(service.handle("u-admin", "deactivate"))).toMatchObject({ code: "not-found" });
    await service.handle("u-admin", "create");
    const hash = store.shareLink!.tokenHash;
    advance(1000);
    const off = await service.handle("u-admin", "deactivate");
    expect(off).toEqual({
      status: { exists: true, active: false, createdAt: T0, regeneratedAt: null, disabledAt: "2026-10-04T15:00:01.000Z", createdByName: null, regeneratedByName: null, disabledByName: null },
    });
    expect(store.shareLink).toMatchObject({ active: false, tokenHash: hash });
    const writes = store.writes.length;
    expect(await service.handle("u-admin", "deactivate")).toEqual(off);
    expect(store.writes).toHaveLength(writes);
    const on = await service.handle("u-admin", "activate");
    expect(on.status).toMatchObject({ active: true, disabledAt: null });
    expect(store.shareLink).toMatchObject({ active: true, tokenHash: hash, rotation: 1 });
    expect(store.shareLink).not.toHaveProperty("disabledAt");
    expect(await service.handle("u-admin", "activate")).toEqual(on);
    expect(on).not.toHaveProperty("token");
  });

  it("status nunca expone hash ni token, en ningún estado", async () => {
    const { service, store } = setup();
    const seen: string[] = [];
    const check = async () => {
      const r = await service.handle("u-admin", "status");
      expect(Object.keys(r)).toEqual(["status"]);
      expect(Object.keys(r.status).sort()).toEqual([
        "active", "createdAt", "createdByName", "disabledAt", "disabledByName", "exists", "regeneratedAt", "regeneratedByName",
      ]);
      const json = JSON.stringify(r);
      if (store.shareLink) expect(json).not.toContain(store.shareLink.tokenHash as string);
      for (const t of seen) expect(json).not.toContain(t);
    };
    await check();
    seen.push((await service.handle("u-admin", "create")).token);
    await check();
    seen.push((await service.handle("u-admin", "regenerate")).token);
    await check();
    await service.handle("u-admin", "deactivate");
    await check();
    await service.handle("u-admin", "activate");
    await check();
  });

  it("error inesperado → internal share/internal; el log no contiene el token", async () => {
    const { service, store } = setup();
    const logs: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
    let leaked = "";
    store.shareLinkTransaction = async (fn) =>
      fn({
        current: null,
        set: (data: Record<string, unknown>) => {
          leaked = String(data.tokenHash);
          throw new Error(`commit falló para ${leaked}`);
        },
      });
    expect(await rejection(service.handle("u-admin", "create"))).toMatchObject({ code: "internal", message: "share/internal" });
    expect(leaked).toHaveLength(64);
    expect(JSON.stringify(logs)).not.toContain(leaked);
  });
});

describe("adaptador onCall", () => {
  it("toma uid de request.auth y la acción de request.data", async () => {
    const { service } = setup();
    const handler = createShareLinkCallableHandler(service);
    expect(await rejection(handler({ data: { action: "status" } }))).toMatchObject({ code: "unauthenticated" });
    expect(await rejection(handler({ auth: { uid: "u-leader" }, data: { action: "status" } }))).toMatchObject({ code: "permission-denied" });
    expect(await rejection(handler({ auth: { uid: "u-admin" }, data: null }))).toMatchObject({ code: "invalid-argument" });
    const created = await handler({ auth: { uid: "u-admin" }, data: { action: "create" } });
    expect(created.token).toHaveLength(43);
  });
});

describe("nombres visibles en el estado (createdByName / regeneratedByName / disabledByName)", () => {
  function named() {
    const ctx = setup();
    ctx.store.users.set("u-admin", { ...USERS["u-admin"], displayName: "Ana Pérez", email: "ana@cds.test" });
    ctx.store.users.set("u-pastor", { ...USERS["u-pastor"], displayName: "  Daniel Herrera  ", email: "daniel@cds.test" });
    ctx.store.users.set("u-all-v1", { ...USERS["u-all-v1"], displayName: "correo@cds.test", email: "correo@cds.test" });
    return ctx;
  }

  it("cada acción devuelve el nombre de quien creó, regeneró y pausó; nunca correos ni uids", async () => {
    const { service, store, advance } = named();
    const created = await service.handle("u-admin", "create");
    expect(created.status).toMatchObject({ createdByName: "Ana Pérez", regeneratedByName: null, disabledByName: null });
    advance(1000);
    const regenerated = await service.handle("u-pastor", "regenerate");
    expect(regenerated.status).toMatchObject({ createdByName: "Ana Pérez", regeneratedByName: "Daniel Herrera", disabledByName: null });
    expect(store.shareLink).toMatchObject({ createdBy: "u-admin", regeneratedBy: "u-pastor" });
    advance(1000);
    const off = await service.handle("u-admin", "deactivate");
    expect(off.status).toMatchObject({ active: false, regeneratedByName: "Daniel Herrera", disabledByName: "Ana Pérez" });
    expect(store.shareLink).toMatchObject({ disabledBy: "u-admin", regeneratedBy: "u-pastor" });
    const status = await service.handle("u-pastor", "status");
    expect(status).toEqual(off);
    // reactivar borra quién lo pausó y conserva quién lo regeneró
    const on = await service.handle("u-pastor", "activate");
    expect(on.status).toMatchObject({ active: true, disabledAt: null, disabledByName: null, regeneratedByName: "Daniel Herrera" });
    expect(store.shareLink).not.toHaveProperty("disabledBy");
    for (const r of [created, regenerated, off, status, on]) {
      const json = JSON.stringify(r.status);
      expect(json).not.toMatch(/@|u-admin|u-pastor/);
    }
  });

  it("displayName con forma de correo, vacío o usuario inexistente → null", async () => {
    const { service, store } = named();
    await service.handle("u-all-v1", "create");
    expect((await service.handle("u-admin", "status")).status.createdByName).toBeNull();
    store.shareLink = { ...store.shareLink!, createdBy: "u-borrado" };
    expect((await service.handle("u-admin", "status")).status.createdByName).toBeNull();
    store.users.set("u-blank", { role: "admin", active: true, displayName: "   " });
    store.shareLink = { ...store.shareLink!, createdBy: "u-blank" };
    expect((await service.handle("u-admin", "status")).status.createdByName).toBeNull();
  });

  it("documento previo sin regeneratedBy/disabledBy → nombres null (sin inventar)", async () => {
    const { service, store } = named();
    store.shareLink = {
      tokenHash: "a".repeat(64), active: false, createdAt: new Date(T0), createdBy: "u-admin", rotation: 2,
      regeneratedAt: new Date(T0), disabledAt: new Date(T0), updatedAt: new Date(T0), updatedBy: "u-pastor",
    };
    const r = await service.handle("u-admin", "status");
    expect(r.status).toMatchObject({ createdByName: "Ana Pérez", regeneratedByName: null, disabledByName: null });
  });

  it("una sola lectura por persona distinta, fuera de la transacción", async () => {
    const { service, store } = named();
    await service.handle("u-admin", "create");
    await service.handle("u-admin", "regenerate");
    store.calls = [];
    await service.handle("u-pastor", "status");
    // authorize lee al actor; describeStatus lee una vez a u-admin (creó y regeneró)
    expect(store.calls).toEqual(["getUser:u-pastor", "shareLinkTransaction", "getUser:u-admin"]);
  });
});
