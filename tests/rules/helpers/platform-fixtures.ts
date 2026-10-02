// Fixtures compartidos de los tests de reglas de Platform Core V1 + Calendario.
// Solo emulador (proyecto demo-cds-suite). Datos ficticios, dominio reservado @cds.test.
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

export async function createRulesEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: "demo-cds-suite",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
}

export function dbOf(env: RulesTestEnvironment, uid: string): Firestore {
  return env.authenticatedContext(uid).firestore() as unknown as Firestore;
}

/** true si la operación fue permitida; false si las reglas la negaron. */
export async function allowed(op: () => Promise<unknown>): Promise<boolean> {
  try {
    await op();
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "permission-denied" || /PERMISSION_DENIED/.test(String(error)))
      return false;
    throw error;
  }
}

// ── Permisos (catálogo 18a §B) ─────────────────────────────────────────────
export const P = {
  summary: "finance.summary.read",
  details: "finance.details.read",
  records: "finance.records.manage",
  pastoral: "finance.pastoral.manage",
  calRead: "calendar.read",
  manageAssigned: "calendar.events.manage_assigned",
  manageAll: "calendar.events.manage_all",
  publish: "calendar.events.publish_assigned",
} as const;

export const LEGACY_PERMS = {
  pastor: [P.summary, P.details, P.records, P.pastoral, P.calRead, P.manageAll],
  finance: [P.summary, P.details, P.records, P.calRead],
  leader: [P.summary, P.calRead, P.manageAssigned],
};

type Role = "admin" | "pastor" | "finance" | "leader";

export function legacyUser(uid: string, role: Role, active = true) {
  return {
    displayName: uid,
    email: `${uid}@cds.test`,
    role,
    active,
    createdAt: Timestamp.fromDate(new Date("2026-01-15T12:00:00Z")),
  };
}

export function v1User(
  uid: string,
  o: {
    role: Role;
    baseRole?: "admin" | "standard";
    permissions?: string[];
    areaIds?: string[];
    homeModule?: "finance" | "calendar";
    active?: boolean;
    position?: string;
  },
) {
  return {
    displayName: uid,
    email: `${uid}@cds.test`,
    role: o.role,
    active: o.active ?? true,
    createdAt: Timestamp.fromDate(new Date("2026-01-15T12:00:00Z")),
    baseRole: o.baseRole ?? (o.role === "admin" ? "admin" : "standard"),
    position: o.position ?? "",
    permissions: o.permissions ?? [],
    areaIds: o.areaIds ?? [],
    homeModule: o.homeModule ?? "finance",
    accessSchemaVersion: 1,
    updatedAt: Timestamp.fromDate(new Date("2026-02-01T12:00:00Z")),
    updatedBy: "seed",
  };
}

/** Perfiles de 18a §J.3 (legacy + v1). */
export const USERS: Record<string, DocumentData> = {
  admin: legacyUser("admin", "admin"),
  pastor: legacyUser("pastor", "pastor"),
  finance: legacyUser("finance", "finance"),
  leader: legacyUser("leader", "leader"),
  inactive: legacyUser("inactive", "admin", false),
  "v1-admin": v1User("v1-admin", { role: "admin" }),
  "v1-pastor": v1User("v1-pastor", { role: "pastor", permissions: LEGACY_PERMS.pastor }),
  "v1-finance": v1User("v1-finance", { role: "finance", permissions: LEGACY_PERMS.finance }),
  "v1-leader": v1User("v1-leader", {
    role: "leader",
    permissions: LEGACY_PERMS.leader,
    homeModule: "calendar",
  }),
  "v1-leader-jovenes": v1User("v1-leader-jovenes", {
    role: "leader",
    permissions: LEGACY_PERMS.leader,
    areaIds: ["jovenes"],
    homeModule: "calendar",
  }),
  "v1-leader-matrimonios": v1User("v1-leader-matrimonios", {
    role: "leader",
    permissions: LEGACY_PERMS.leader,
    areaIds: ["matrimonios"],
    homeModule: "calendar",
  }),
  "v1-publisher-jovenes": v1User("v1-publisher-jovenes", {
    role: "leader",
    permissions: [...LEGACY_PERMS.leader, P.publish],
    areaIds: ["jovenes"],
    homeModule: "calendar",
  }),
  // 20 áreas (máximo) con publicar: peor caso de presupuesto de expresiones de las reglas.
  "v1-publisher-multi": v1User("v1-publisher-multi", {
    role: "leader",
    permissions: [...LEGACY_PERMS.leader, P.publish],
    areaIds: ["jovenes", "alabanza", ...Array.from({ length: 18 }, (_, i) => `area-${i + 3}`)],
    homeModule: "calendar",
  }),
  "v1-manager-all": v1User("v1-manager-all", {
    role: "leader",
    permissions: [P.manageAll],
    homeModule: "calendar",
  }),
  "v1-reader": v1User("v1-reader", {
    role: "leader",
    permissions: [P.calRead],
    areaIds: ["jovenes"],
    homeModule: "calendar",
  }),
  "v1-none": v1User("v1-none", { role: "leader", permissions: [] }),
  "v1-inactive": v1User("v1-inactive", {
    role: "pastor",
    permissions: LEGACY_PERMS.pastor,
    areaIds: ["jovenes"],
    active: false,
  }),
};

export function area(slug: string, name: string, color: string, active = true) {
  return {
    name,
    slug,
    color,
    description: "",
    active,
    createdAt: Timestamp.fromDate(new Date("2026-01-20T12:00:00Z")),
    createdBy: "admin",
    updatedAt: Timestamp.fromDate(new Date("2026-01-20T12:00:00Z")),
    updatedBy: "admin",
  };
}

export const AREAS: Record<string, DocumentData> = {
  jovenes: area("jovenes", "Jóvenes", "azul"),
  alabanza: area("alabanza", "Alabanza", "verde"),
  matrimonios: area("matrimonios", "Matrimonios", "cafe", false),
};

export async function seedBase(env: RulesTestEnvironment) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, data] of Object.entries(USERS))
      await setDoc(doc(db, "users", uid), data);
    for (const [id, data] of Object.entries(AREAS))
      await setDoc(doc(db, "areas", id), data);
  });
}

// ── Fechas locales (America/Santiago) ──────────────────────────────────────
export function santiagoToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
export const TODAY = santiagoToday();

// ── Eventos ────────────────────────────────────────────────────────────────
type Recurrence = {
  freq: "none" | "weekly" | "biweekly" | "monthly";
  until?: string;
  monthly?: { mode: "nth_weekday"; weekday: number; ordinal: number };
};

function computedLastDate(e: DocumentData): string {
  const r = e.recurrence as Recurrence;
  if (r.freq === "none") return e.endDate as string;
  const span = e.endDate === e.startDate ? 0 : 1;
  return addDays(r.until as string, span);
}

/** Documento de evento listo para crear (audit con serverTimestamp). */
export function eventData(uid: string, o: DocumentData = {}): DocumentData {
  const startDate = (o.startDate as string) ?? addDays(TODAY, 20);
  const base: DocumentData = {
    title: "Reunión de jóvenes",
    responsibleAreaId: "jovenes",
    participantAreaIds: [],
    startDate,
    endDate: startDate,
    allDay: false,
    startTime: "19:00",
    endTime: "21:00",
    location: "Templo",
    publicDescription: "",
    internalNotes: "",
    visibility: "internal",
    status: "scheduled",
    recurrence: { freq: "none" },
    exceptions: [],
    revision: 1,
    lastChangeId: "r1",
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    ...o,
  };
  if (!("lastDate" in o)) base.lastDate = computedLastDate(base);
  return base;
}

export function createdChange(uid: string, o: DocumentData = {}): DocumentData {
  return {
    revision: 1,
    action: "created",
    actorUid: uid,
    at: serverTimestamp(),
    changedFields: [],
    before: null,
    after: null,
    reason: null,
    ...o,
  };
}

/** Crea evento + changes/r1 en un mismo lote, como el cliente productivo. */
export function createEvent(
  env: RulesTestEnvironment,
  uid: string,
  id: string,
  overrides: DocumentData = {},
  change: DocumentData | null = {},
) {
  const db = dbOf(env, uid);
  const batch = writeBatch(db);
  batch.set(doc(db, "calendarEvents", id), eventData(uid, overrides));
  if (change !== null)
    batch.set(doc(db, "calendarEvents", id, "changes", "r1"), createdChange(uid, change));
  return batch.commit();
}

/** Siembra un evento existente (sin reglas) con auditoría fija. */
export async function seedEvent(
  env: RulesTestEnvironment,
  id: string,
  o: DocumentData = {},
) {
  const data = eventData("seed", {
    createdAt: Timestamp.fromDate(new Date("2026-03-01T12:00:00Z")),
    updatedAt: Timestamp.fromDate(new Date("2026-03-01T12:00:00Z")),
    ...o,
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "calendarEvents", id), data);
    await setDoc(doc(db, "calendarEvents", id, "changes", `r${data.revision}`), {
      ...createdChange("seed", { revision: data.revision }),
      at: Timestamp.fromDate(new Date("2026-03-01T12:00:00Z")),
    });
  });
  return data;
}

export async function readEvent(env: RulesTestEnvironment, id: string) {
  let data: DocumentData | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore(), "calendarEvents", id))).data();
  });
  return data as DocumentData;
}

const META = ["revision", "lastChangeId", "updatedBy", "updatedAt", "lastDate"];

function sameValue(a: unknown, b: unknown): boolean {
  if (b !== null && typeof b === "object" && "isEqual" in (b as object)) {
    // FieldValue (serverTimestamp) o Timestamp
    return typeof (b as { isEqual: (x: unknown) => boolean }).isEqual === "function" &&
      a !== undefined &&
      a !== null &&
      (b as { isEqual: (x: unknown) => boolean }).isEqual(a);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Espejo del expectedAction de las reglas (y de buildChange en el cliente). */
export function expectedAction(before: DocumentData, after: DocumentData, changed: string[]) {
  if (after.status === "archived" && before.status !== "archived") return "archived";
  if (
    (after.status === "cancelled" && before.status !== "cancelled") ||
    changed.includes("exceptions") ||
    changed.includes("seriesCancellation")
  )
    return "cancelled";
  if (changed.includes("visibility")) return "visibility_changed";
  if (changed.includes("recurrence")) return "recurrence_updated";
  return "updated";
}

export type UpdateOptions = {
  action?: string;
  actorUid?: string;
  changedFields?: string[];
  noChange?: boolean;
  revisionStep?: number;
  change?: DocumentData;
};

/** Actualiza un evento + changes/r{rev} en un lote (patch parcial sobre lo guardado). */
export async function updateEvent(
  env: RulesTestEnvironment,
  uid: string,
  id: string,
  patch: DocumentData,
  opts: UpdateOptions = {},
) {
  const stored = await readEvent(env, id);
  const rev = (stored.revision as number) + (opts.revisionStep ?? 1);
  const changed = Object.keys(patch).filter(
    (k) => !META.includes(k) && !sameValue(stored[k], patch[k]),
  );
  const action = opts.action ?? expectedAction(stored, { ...stored, ...patch }, changed);
  const db = dbOf(env, uid);
  const batch = writeBatch(db);
  batch.update(doc(db, "calendarEvents", id), {
    revision: rev,
    lastChangeId: `r${rev}`,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    ...patch,
  });
  if (!opts.noChange)
    batch.set(doc(db, "calendarEvents", id, "changes", `r${rev}`), {
      revision: rev,
      action,
      actorUid: opts.actorUid ?? uid,
      at: serverTimestamp(),
      changedFields: opts.changedFields ?? changed,
      before: null,
      after: null,
      reason: null,
      ...opts.change,
    });
  return batch.commit();
}
