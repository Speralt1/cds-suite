// @vitest-environment node
// Datos del seed local (scripts/seed-platform-calendar-emulator.mjs): coherentes
// con lo que validan firestore.rules aunque el Admin SDK no pase por ellas.
import { describe, expect, it } from "vitest";
import { AUDIT_IGNORED_FIELDS, AUDIT_VALUE_FIELDS } from "@/lib/calendar/audit";
import { normalizeAccess, deriveLegacyRole, effectivePermissions } from "@/lib/shared/access";
import { lastDateOf } from "@/lib/shared/calendar-core";
import { addDays, compareLocal } from "@/lib/shared/dates";
import { isOccurrenceDate, validateRecurrence } from "@/lib/shared/recurrence";
import { AREA_COLORS, STORABLE_PERMISSIONS, type CalendarEventDoc, type Permission } from "@/lib/shared/types";
import {
  SEED_AREAS,
  SEED_AUDIT_IGNORED_FIELDS,
  SEED_AUDIT_VALUE_FIELDS,
  SEED_CANARIES,
  SEED_USERS,
  SEED_FINANCE_UID,
  assertSeedEnvironment,
  buildFinanceSeed,
  buildSeedData,
  publicUrlFor,
} from "../../scripts/seed-platform-calendar-emulator.mjs";

const NOW = Date.parse("2026-10-03T15:00:00Z");
const TODAYS = ["2026-10-03", "2026-12-31", "2027-02-28", "2026-04-04", "2026-09-06"];
const EVENT_KEYS = new Set([
  "title", "responsibleAreaId", "participantAreaIds", "startDate", "endDate", "allDay", "startTime", "endTime", "location",
  "publicDescription", "internalNotes", "visibility", "status", "recurrence", "exceptions", "seriesCancellation", "lastDate",
  "cancelReason", "archivedAt", "archiveReason", "revision", "lastChangeId", "createdBy", "createdAt", "updatedBy", "updatedAt",
]);
const V1_KEYS = ["displayName", "email", "role", "active", "createdAt", "baseRole", "position", "permissions", "areaIds", "homeModule", "accessSchemaVersion", "updatedAt", "updatedBy"].sort();
const plusOneYear = (s: string) => `${Number(s.slice(0, 4)) + 1}${s.slice(4)}`;
const sameInstant = (a: unknown, b: unknown) => a instanceof Date && b instanceof Date && a.getTime() === b.getTime();

describe("seed: interlock", () => {
  const ok = { CDS_SEED_LOCAL: "true", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", GCLOUD_PROJECT: "demo-cds-suite" };
  it("solo corre con las cuatro condiciones del emulador local", () => {
    expect(assertSeedEnvironment(ok)).toBe("demo-cds-suite");
    expect(() => assertSeedEnvironment({ ...ok, CDS_SEED_LOCAL: undefined })).toThrow(/CDS_SEED_LOCAL/);
    expect(() => assertSeedEnvironment({ ...ok, FIRESTORE_EMULATOR_HOST: "localhost:8080" })).toThrow(/FIRESTORE_EMULATOR_HOST/);
    expect(() => assertSeedEnvironment({ ...ok, FIREBASE_AUTH_EMULATOR_HOST: undefined })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
    expect(() => assertSeedEnvironment({ ...ok, GCLOUD_PROJECT: "cds-administracion" })).toThrow(/demo-cds-suite/);
  });
  it("URL pública en formato de desarrollo", () => {
    expect(publicUrlFor("abc")).toBe("http://localhost:3000/calendario-publico#abc");
  });
});

describe("seed: usuarios y áreas", () => {
  const data = buildSeedData("2026-10-03", NOW);

  it("correos @cds.test, sin teléfonos; perfiles pedidos", () => {
    for (const u of SEED_USERS) expect(u.email).toMatch(/^[a-z.]+@cds\.test$/);
    expect(JSON.stringify(data.users)).not.toMatch(/phone|\+56/);
    const byEmail = Object.fromEntries(SEED_USERS.map((u) => [u.email, u]));
    expect(byEmail["admin@cds.test"].doc).toEqual({ role: "admin", active: true });
    expect(byEmail["finanzas@cds.test"].doc).toEqual({ role: "finance", active: true });
    expect(byEmail["lider.jovenes@cds.test"].doc.areaIds).toEqual(["jovenes"]);
    expect(byEmail["lider.sinarea@cds.test"].doc.areaIds).toEqual([]);
    expect(byEmail["diacono.publica@cds.test"].doc.areaIds).toEqual(["multimedia", "varones"]);
    expect(byEmail["inactivo@cds.test"].doc.active).toBe(false);
  });

  it("los v1 tienen la forma exacta de validUserV1 y role derivado coherente", () => {
    for (const u of data.users) {
      const d = u.data;
      if (d.accessSchemaVersion !== 1) {
        expect(Object.keys(d).sort()).toEqual(["active", "createdAt", "displayName", "email", "role"]);
        continue;
      }
      expect(Object.keys(d).sort(), u.uid).toEqual(V1_KEYS);
      const perms = d.permissions as Permission[];
      expect(perms.every((p) => STORABLE_PERMISSIONS.includes(p))).toBe(true);
      expect(new Set(perms).size).toBe(perms.length);
      expect(perms.length).toBeLessThanOrEqual(8);
      expect(d.role).toBe(deriveLegacyRole(d.baseRole as "admin" | "standard", perms));
      expect(normalizeAccess(d)?.schema).toBe("v1");
    }
    const diacono = data.users.find((u) => u.uid === "seed-diacono-publica")!.data;
    const eff = effectivePermissions(diacono);
    expect(eff.has("calendar.events.publish_assigned")).toBe(true);
    expect(eff.has("calendar.events.manage_all")).toBe(false);
    expect(effectivePermissions(data.users.find((u) => u.uid === "seed-pastor")!.data).has("calendar.events.manage_all")).toBe(true);
  });

  it("áreas: 9 activas + Matrimonios inactiva, colores de la paleta sin repetir, slug == id", () => {
    expect(SEED_AREAS.filter((a) => a.active)).toHaveLength(9);
    expect(SEED_AREAS.find((a) => a.id === "matrimonios")?.active).toBe(false);
    expect(new Set(SEED_AREAS.map((a) => a.color)).size).toBe(SEED_AREAS.length);
    for (const a of data.areas) {
      expect(a.data.slug).toBe(a.id);
      expect(a.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(AREA_COLORS).toContain(a.data.color);
      expect(Object.keys(a.data).sort()).toEqual(["active", "color", "createdAt", "createdBy", "description", "name", "slug", "updatedAt", "updatedBy"]);
    }
  });
});

describe.each(TODAYS)("seed: actividades coherentes con las reglas (hoy = %s)", (today) => {
  const data = buildSeedData(today, NOW);
  const areaIds = new Set(SEED_AREAS.map((a) => a.id));

  it.each(data.events.map((e) => [e.id, e] as const))("%s", (_id, e) => {
    const d = e.data as unknown as CalendarEventDoc & Record<string, unknown>;
    expect(Object.keys(d).every((k) => EVENT_KEYS.has(k))).toBe(true);
    expect(areaIds.has(d.responsibleAreaId)).toBe(true);
    expect(d.participantAreaIds).not.toContain(d.responsibleAreaId);
    expect(d.participantAreaIds.every((a) => areaIds.has(a))).toBe(true);
    expect(compareLocal(d.endDate, d.startDate)).toBeGreaterThanOrEqual(0);
    expect(d.lastDate).toBe(lastDateOf(d));
    if (d.allDay) expect([d.startTime, d.endTime]).toEqual([null, null]);
    else {
      expect(d.startTime).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      if (d.endTime) expect(d.endDate > d.startDate || d.endTime > d.startTime!).toBe(true);
    }
    if (d.recurrence.freq === "none") {
      expect(d.recurrence).toEqual({ freq: "none" });
      expect(d.exceptions).toEqual([]);
      expect(d.seriesCancellation).toBeUndefined();
      expect(compareLocal(d.endDate, addDays(d.startDate, 31))).toBeLessThanOrEqual(0);
    } else {
      expect(validateRecurrence(d.recurrence, d.startDate, d.endDate)).toEqual([]);
      expect(compareLocal(d.recurrence.until!, plusOneYear(d.startDate))).toBeLessThanOrEqual(0);
      expect(d.status).not.toBe("cancelled");
      for (const x of d.exceptions) {
        expect(Object.keys(x).sort()).toEqual(["by", "date", "reason", "type"]);
        expect(isOccurrenceDate(d, x.date)).toBe(true);
        expect(compareLocal(x.date, today)).toBeGreaterThanOrEqual(0);
      }
      if (d.seriesCancellation) {
        expect(compareLocal(d.seriesCancellation.from, today)).toBeGreaterThanOrEqual(0);
        expect(sameInstant(d.seriesCancellation.at, d.updatedAt)).toBe(true);
      }
    }
    if (d.status === "cancelled") expect(d.cancelReason?.length).toBeGreaterThanOrEqual(3);
    if (d.status === "archived") {
      expect(d.archiveReason?.length).toBeGreaterThanOrEqual(3);
      expect(sameInstant(d.archivedAt, d.updatedAt)).toBe(true);
    }

    // Historial: changes/r1..r{revision}, at/actor coherentes con el evento.
    expect(e.changes.map((c) => c.id)).toEqual(Array.from({ length: d.revision }, (_, i) => `r${i + 1}`));
    expect(d.lastChangeId).toBe(`r${d.revision}`);
    const r1 = e.changes[0].data;
    expect(r1).toMatchObject({ revision: 1, action: "created", changedFields: [], before: null, after: null, reason: null, actorUid: d.createdBy });
    expect(sameInstant(r1.at, d.createdAt)).toBe(true);
    const last = e.changes[e.changes.length - 1].data;
    expect(last.actorUid).toBe(d.updatedBy);
    expect(sameInstant(last.at, d.updatedAt)).toBe(true);
    for (const c of e.changes) {
      const ch = c.data as { changedFields: string[]; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
      for (const side of [ch.before, ch.after]) {
        if (!side) continue;
        expect(Object.keys(side).every((k) => ch.changedFields.includes(k))).toBe(true);
        expect(side).not.toHaveProperty("internalNotes");
      }
    }
  });

  it("canarios solo en campos internos (nunca en título, lugar ni descripción pública)", () => {
    const canaries = Object.values(SEED_CANARIES);
    for (const e of data.events) {
      const d = e.data as unknown as CalendarEventDoc;
      for (const field of [d.title, d.location, d.publicDescription]) for (const c of canaries) expect(field).not.toContain(c);
    }
    const all = JSON.stringify(data.events.map((e) => e.data));
    for (const c of canaries) expect(all).toContain(c);
  });
});

describe("seed: usuario sin módulos y frases internas naturales", () => {
  const data = buildSeedData("2026-10-03", NOW);

  it("sinmodulos@cds.test: v1 activo, sin permisos ni áreas → sin módulos", () => {
    const u = SEED_USERS.find((x) => x.email === "sinmodulos@cds.test")!;
    expect(u.doc).toMatchObject({ active: true, baseRole: "standard", permissions: [], areaIds: [] });
    const d = data.users.find((x) => x.uid === u.uid)!.data;
    expect(d.accessSchemaVersion).toBe(1);
    expect(effectivePermissions(d).size).toBe(0);
  });

  it("las frases internas son texto natural (sin marcadores tipo CANARIO) y únicas", () => {
    const values = Object.values(SEED_CANARIES);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(v).not.toMatch(/CANARIO|_[0-9A-Z]{2}$/);
      expect(v).toMatch(/^[A-ZÁÉÍÓÚÑ][A-Za-záéíóúñü ,]+$/);
      expect(v.length).toBeGreaterThan(20);
    }
  });
});

describe("seed: movimientos financieros ficticios", () => {
  const INCOME = ["Ofrendas", "Donaciones", "Cafetería"];
  const EXPENSE = ["Servicios básicos", "Compras y materiales", "Mantención", "Ministerio Jóvenes"];

  it.each(TODAYS)("hoy=%s: mes anterior completo + mes en curso hasta hoy, ids estables y sin diezmos", (today) => {
    const items = buildFinanceSeed(today);
    const prevMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const { id, input } of items) {
      expect(id).toMatch(/^seed-fin-\d{4}-\d{2}-\d{2}$/);
      expect(id.slice(9, 16)).toBe(input.date.slice(0, 7));
      expect([prevMonth, today.slice(0, 7)]).toContain(input.date.slice(0, 7));
      expect(compareLocal(input.date, today)).toBeLessThanOrEqual(0);
      expect(input.type === "income" ? INCOME : EXPENSE).toContain(input.category);
      expect(input.category).not.toBe("Diezmos");
      expect(Number.isInteger(input.amount) && input.amount > 0).toBe(true);
      expect(input.description.length).toBeGreaterThan(0);
      expect(input.note).toBe("");
    }
    expect(buildFinanceSeed(today)).toEqual(items);
  });

  it("los registra la cuenta de finanzas sembrada", () => {
    expect(SEED_USERS.find((u) => u.uid === SEED_FINANCE_UID)?.doc).toEqual({ role: "finance", active: true });
  });
});

describe("seed: campos de auditoría con una sola fuente", () => {
  it("la lista del seed es la misma (y en el mismo orden) que la de lib/calendar/audit.ts", () => {
    expect([...SEED_AUDIT_VALUE_FIELDS]).toEqual([...AUDIT_VALUE_FIELDS]);
    expect([...SEED_AUDIT_IGNORED_FIELDS]).toEqual([...AUDIT_IGNORED_FIELDS]);
    expect(SEED_AUDIT_VALUE_FIELDS).not.toContain("internalNotes");
    expect(Object.isFrozen(SEED_AUDIT_VALUE_FIELDS)).toBe(true);
  });
});
