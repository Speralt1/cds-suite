// @vitest-environment node
// Seed local de Integrantes › Consolidación (scripts/seed-members-emulator.mjs):
// esquema exacto del doc 23 §3–4, datos obviamente ficticios y cobertura de
// todas las alertas (§7), estados y casos especiales. Las alertas se derivan
// aquí con las reglas del doc 23 §7 (independiente de la UI).
import { describe, expect, it } from "vitest";
import { addDays, compareLocal } from "@/lib/shared/dates";
import { can } from "@/lib/shared/access";
import { CONSOLIDATION_STATUSES, PERSON_CHANGE_ACTIONS, PROFILE_FIELDS, isE164, projectionOf } from "@/lib/shared/members";
import { SEED_USERS, buildSeedData } from "../../scripts/seed-platform-calendar-emulator.mjs";
import {
  SEED_MEMBERS_ACTOR,
  SEED_MEMBERS_EVENT_ID,
  SEED_MEMBERS_STALE_OWNERS,
  buildMembersSeed,
  seededPersonIds,
} from "../../scripts/seed-members-emulator.mjs";

const PERSON_KEYS = [
  "arrivalSource", "calendarEventId", "closedReason", "consolidationStatus", "createdAt", "createdBy", "doNotContact", "email", "entryDate",
  "firstContactDate", "firstVisitAt", "firstVisitDate", "followUpCount", "followUpOwnerUid", "fullName", "invitedBy", "lastFollowUpDate",
  "lastVisitDate", "lifecycleStage", "nextAction", "nextActionDate", "nextActionOwnerUid", "phoneE164", "revision", "updatedAt", "updatedBy",
  "visitCount",
].sort();
const VISIT_KEYS = ["calendarEventId", "createdAt", "createdBy", "date", "firstVisit", "note", "personId"].sort();
const FOLLOW_UP_KEYS = ["contactDate", "createdAt", "createdBy", "nextAction", "nextActionDate", "note", "ownerUid", "personId", "result", "type"].sort();
const CHANGE_KEYS = ["action", "actorUid", "at", "changedFields", "field", "from", "personId", "reason", "reasonNote", "refId", "revision", "to"].sort();

type Doc = Record<string, unknown>;

/** Alertas del doc 23 §7 sobre una persona guardada. */
function alertsOf(p: Doc, all: Doc[], owners: Set<string>, today: string, nowMs: number): string[] {
  const out: string[] = [];
  const active = p.lifecycleStage === "en_consolidacion" && p.consolidationStatus !== "sin_continuidad" && p.doNotContact !== true;
  const proj = projectionOf(p);
  if (active) {
    if (!p.followUpOwnerUid || !owners.has(p.followUpOwnerUid as string)) out.push("sin_responsable");
    if (!proj.firstContactDate && nowMs - (p.createdAt as Date).getTime() > 48 * 3600_000) out.push("sin_primer_contacto");
    if (proj.nextActionDate && compareLocal(proj.nextActionDate, today) < 0) out.push("seguimiento_vencido");
    if (
      proj.visitCount >= 2 &&
      proj.lastVisitDate &&
      compareLocal(proj.lastVisitDate, addDays(today, -7)) >= 0 &&
      (!proj.lastFollowUpDate || compareLocal(proj.lastFollowUpDate, proj.lastVisitDate) < 0)
    ) {
      out.push("volvio");
    }
    if (proj.lastVisitDate && compareLocal(proj.lastVisitDate, addDays(today, -21)) < 0) out.push("sin_volver");
  }
  const others = all.filter((o) => o !== p);
  if (others.some((o) => o.phoneE164 === p.phoneE164)) out.push("duplicado_telefono");
  if (p.email && others.some((o) => o.email === p.email)) out.push("duplicado_correo");
  return out;
}

describe.each(["2026-10-05T15:00:00Z", "2026-10-06T02:30:00Z", "2027-01-01T13:00:00Z", "2026-04-05T12:00:00Z"])("seed de Consolidación (ahora = %s)", (iso) => {
  const nowMs = Date.parse(iso);

  async function build() {
    const { localToday } = await import("@/lib/shared/dates");
    const today = localToday(nowMs);
    const data = buildSeedData(today, nowMs);
    const seed = await buildMembersSeed({ nowMs, users: data.users, events: data.events });
    return { today, data, seed };
  }

  it("14 personas con ids deterministas y el esquema exacto del doc 23", async () => {
    const { seed, today } = await build();
    expect(seed.today).toBe(today);
    expect(seed.people).toHaveLength(14);
    expect(seed.people.map((p) => p.id).sort()).toEqual(seededPersonIds().sort());
    const ids = new Set(seed.people.map((p) => p.id));
    for (const { id, data } of seed.people) {
      expect(Object.keys(data).sort(), id).toEqual(PERSON_KEYS);
      expect(id).toMatch(/^[0-9a-f]{24}$/);
      expect(CONSOLIDATION_STATUSES).toContain(data.consolidationStatus);
      expect(compareLocal(data.entryDate as string, today)).toBeLessThanOrEqual(0);
      expect(data.createdAt).toBeInstanceOf(Date);
      expect((data.createdAt as Date).getTime()).toBeLessThanOrEqual(nowMs);
      // La proyección coincide con el historial.
      const visits = seed.visits.filter((v) => v.data.personId === id);
      const follows = seed.followUps.filter((f) => f.data.personId === id);
      expect(data.visitCount).toBe(visits.length);
      expect(data.followUpCount).toBe(follows.length);
      expect(data.lastVisitDate).toBe(visits.map((v) => v.data.date as string).sort().at(-1));
      expect(visits.filter((v) => v.data.firstVisit === true)).toHaveLength(1);
      expect(seed.changes.filter((c) => c.data.personId === id && c.data.revision === data.revision).length).toBeGreaterThan(0);
    }
    for (const v of seed.visits) {
      expect(Object.keys(v.data).sort()).toEqual(VISIT_KEYS);
      expect(ids.has(v.data.personId as string)).toBe(true);
    }
    for (const f of seed.followUps) expect(Object.keys(f.data).sort()).toEqual(FOLLOW_UP_KEYS);
    for (const c of seed.changes) {
      expect(Object.keys(c.data).sort()).toEqual(CHANGE_KEYS);
      expect(PERSON_CHANGE_ACTIONS).toContain(c.data.action);
      expect(c.id).toBe(`${c.data.personId}-r${c.data.revision}-${c.id.split("-").at(-1)}`);
      expect(c.data.actorUid).toBe(SEED_MEMBERS_ACTOR);
      for (const f of c.data.changedFields as string[]) expect(PROFILE_FIELDS).toContain(f);
    }
  });

  it("datos obviamente ficticios: teléfonos +56 9 0000 00NN y correos @example.test", async () => {
    const { seed } = await build();
    for (const { data } of seed.people) {
      expect(isE164(data.phoneE164)).toBe(true);
      expect(data.phoneE164).toMatch(/^\+5690000\d{4}$/);
      if (data.email !== null) expect(data.email).toMatch(/^[a-z.]+@example\.test$/);
      expect(data.fullName).toMatch(/Prueba|Ejemplo|Ficticia|Ficticio|Muestra|Demo/);
    }
    const all = JSON.stringify(seed);
    expect(all).not.toMatch(/@cds\.test|bautism|confes|nacimiento/i);
  });

  it("cubre todos los estados, una integrante, una No contactar y todas las alertas", async () => {
    const { seed, data, today } = await build();
    const people = seed.people.map((p) => p.data);
    expect(new Set(people.map((p) => p.consolidationStatus))).toEqual(new Set(CONSOLIDATION_STATUSES));
    expect(people.filter((p) => p.lifecycleStage === "integrante")).toHaveLength(1);
    expect(people.filter((p) => p.doNotContact === true)).toHaveLength(1);
    expect(people.some((p) => p.calendarEventId === SEED_MEMBERS_EVENT_ID)).toBe(true);
    // Responsables válidos según los perfiles REALES sembrados (lo que devuelve membersOwnerOptions).
    const owners = new Set(data.users.filter((u) => u.data.active === true && can(u.data, "members.consolidation.manage")).map((u) => u.uid));
    for (const stale of SEED_MEMBERS_STALE_OWNERS) expect(owners.has(stale)).toBe(false);
    const alerts = new Set(people.flatMap((p) => alertsOf(p, people, owners, today, nowMs)));
    expect([...alerts].sort()).toEqual(
      ["duplicado_correo", "duplicado_telefono", "seguimiento_vencido", "sin_primer_contacto", "sin_responsable", "sin_volver", "volvio"].sort(),
    );
    // "Sin responsable" por los tres motivos: vacío, sin permiso e inactivo.
    const sinResp = people.filter((p) => alertsOf(p, people, owners, today, nowMs).includes("sin_responsable")).map((p) => p.followUpOwnerUid ?? null);
    expect(sinResp).toEqual(expect.arrayContaining([null, "seed-lider-jovenes", "seed-inactivo"]));
  });
});

describe("usuarios sembrados para Consolidación", () => {
  const users = buildSeedData("2026-10-05", Date.parse("2026-10-05T15:00:00Z")).users;
  const byUid = Object.fromEntries(users.map((u) => [u.uid, u.data]));

  it("coordinadora con manage, apoyo solo lectura y líderes de calendario sin Integrantes", () => {
    expect(can(byUid["seed-coord-consolidacion"], "members.consolidation.manage")).toBe(true);
    expect(can(byUid["seed-apoyo-consolidacion"], "members.consolidation.read")).toBe(true);
    expect(can(byUid["seed-apoyo-consolidacion"], "members.consolidation.manage")).toBe(false);
    for (const uid of ["seed-lider-jovenes", "seed-lider-sin-area", "seed-diacono-publica", "seed-pastor", "seed-finanzas", "seed-sin-modulos", "seed-inactivo"]) {
      expect(can(byUid[uid], "members.consolidation.read"), uid).toBe(false);
    }
    expect(can(byUid["seed-admin"], "members.consolidation.manage")).toBe(true);
    expect(SEED_USERS.find((u) => u.uid === "seed-coord-consolidacion")?.email).toBe("consolidacion@cds.test");
    expect(SEED_USERS.find((u) => u.uid === "seed-apoyo-consolidacion")?.email).toBe("apoyo.consolidacion@cds.test");
  });
});
