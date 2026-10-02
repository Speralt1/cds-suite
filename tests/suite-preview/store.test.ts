import { describe, expect, it } from "vitest";
import { applyAction, initialSuiteState, type SuiteState } from "@/lib/suite-preview/store";
import { personStats } from "@/lib/suite-preview/consolidation";
import { canManageEvent, canManageSeries, TEMPORAL_LOCK_HELP } from "@/lib/suite-preview/calendar";

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

const fresh = (): SuiteState => deepFreeze(initialSuiteState());

describe("store de la sesión", () => {
  it("es puro: no muta el estado congelado (todas las familias de acciones)", () => {
    const s = fresh();
    const snapshot = JSON.stringify(s);
    const actions = [
      { type: "event/create", by: "lider", input: { title: "Noche de jóvenes", responsibleAreaId: "jovenes", startDate: "2026-10-21", startTime: "20:00" } },
      { type: "event/cancelOccurrence", by: "lider", id: "ev-jovenes", date: "2026-10-09", reason: "Feriado largo" },
      { type: "event/archive", by: "admin", id: "ev-fiesta-luz", reason: "Duplicada" },
      { type: "share/regenerate", by: "admin" },
      { type: "visit/register", by: "consolidacion", input: { personId: "p-03", date: "2026-10-04" } },
      { type: "followup/register", by: "consolidacion", input: { personId: "p-02", type: "llamada", result: "contactado" }, confirmStatus: "en_seguimiento" },
      { type: "person/changeStatus", by: "consolidacion", personId: "p-08", to: "integrado" },
      { type: "area/upsert", by: "admin", area: { name: "Matrimonios jóvenes", color: "carmin" } },
    ] as const;
    for (const a of actions) {
      const r = applyAction(s, a as never);
      expect(r.ok, a.type).toBe(true);
    }
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it("visit/register agrega: incrementa cantidad, actualiza la última visita y no toca las previas", () => {
    const s = fresh();
    const before = personStats("p-05", s.visits);
    const r = applyAction(s, { type: "visit/register", by: "consolidacion", input: { personId: "p-05", date: "2026-10-04", activityLabel: "Culto dominical" } });
    expect(r.ok && r.createdId).toBe("v-new-1");
    const after = personStats("p-05", r.state.visits);
    expect(after.visitCount).toBe(before.visitCount + 1);
    expect(after.lastVisitDate).toBe("2026-10-04");
    expect(r.state.visits.slice(0, s.visits.length)).toEqual(s.visits);
    expect(applyAction(s, { type: "visit/register", by: "consolidacion", input: { personId: "p-05", date: "2026-10-05" } }).ok).toBe(false);
  });

  it("person/create crea la persona con su primera visita (ids deterministas)", () => {
    const r = applyAction(fresh(), {
      type: "person/create",
      by: "consolidacion",
      input: { fullName: "  Lucía Peña ", phone: "+56 9 5555 0150", email: "Lucia@Demo.Invalid", arrivedLabel: "Culto dominical" },
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.createdId).toBe("p-new-1");
    const p = r.state.persons.at(-1)!;
    expect(p).toMatchObject({ fullName: "Lucía Peña", phoneE164: "+56955550150", email: "lucia@demo.invalid", entryDate: "2026-10-04", consolidationStatus: "por_contactar", lifecycleStage: "en_consolidacion" });
    expect(r.state.visits.filter((v) => v.personId === p.id)).toEqual([expect.objectContaining({ id: "v-new-2", date: "2026-10-04", activityLabel: "Culto dominical" })]);
  });

  it("followup/register sin confirmStatus NO cambia el estado; con confirmación sí (con PersonChange)", () => {
    const s = fresh();
    const r1 = applyAction(s, { type: "followup/register", by: "consolidacion", input: { personId: "p-02", type: "llamada", result: "contactado" } });
    expect(r1.ok && r1.state.persons.find((p) => p.id === "p-02")!.consolidationStatus).toBe("por_contactar");
    const r2 = applyAction(s, { type: "followup/register", by: "consolidacion", input: { personId: "p-02", type: "llamada", result: "contactado" }, confirmStatus: "en_seguimiento" });
    expect(r2.ok && r2.state.persons.find((p) => p.id === "p-02")!.consolidationStatus).toBe("en_seguimiento");
    expect(r2.state.personChanges.at(-1)).toMatchObject({ personId: "p-02", field: "status", from: "por_contactar", to: "en_seguimiento" });
  });

  it("Integrado cambia la etapa y conserva el historial", () => {
    const s = fresh();
    const r = applyAction(s, { type: "person/changeStatus", by: "consolidacion", personId: "p-08", to: "integrado" });
    const p = r.state.persons.find((x) => x.id === "p-08")!;
    expect(p).toMatchObject({ consolidationStatus: "integrado", lifecycleStage: "integrante" });
    expect(r.state.personChanges.slice(-2).map((c) => c.field)).toEqual(["status", "stage"]);
    expect(r.state.visits.filter((v) => v.personId === "p-08")).toHaveLength(3);
    expect(applyAction(s, { type: "person/changeStatus", by: "consolidacion", personId: "p-03", to: "sin_continuidad" }).ok).toBe(false);
  });

  it("re-valida permisos con el actor", () => {
    const s = fresh();
    expect(applyAction(s, { type: "event/archive", by: "lider", id: "ev-culto", reason: "No corresponde" })).toMatchObject({ ok: false });
    expect(applyAction(s, { type: "event/archive", by: "lider", id: "ev-campamento", reason: "Duplicado" }).ok).toBe(true);
    expect(applyAction(s, { type: "event/create", by: "lider", input: { title: "X", responsibleAreaId: "pastoral", startDate: "2026-10-21", startTime: "10:00" } }).ok).toBe(false);
    expect(applyAction(s, { type: "person/create", by: "finanzas", input: { fullName: "X", phone: "955550190" } })).toMatchObject({ ok: false });
    expect(applyAction(s, { type: "area/upsert", by: "pastor", area: { name: "Nueva", color: "carmin" } }).ok).toBe(false);
    expect(applyAction(s, { type: "visit/register", by: "no-existe", input: { personId: "p-01", date: "2026-10-04" } }).ok).toBe(false);
  });

  it("cancelar y archivar exigen motivo; nada se borra", () => {
    const s = fresh();
    expect(applyAction(s, { type: "event/archive", by: "admin", id: "ev-fiesta-luz", reason: "" }).ok).toBe(false);
    const r = applyAction(s, { type: "event/archive", by: "admin", id: "ev-fiesta-luz", reason: "Duplicada" });
    expect(r.state.events).toHaveLength(s.events.length);
    expect(r.state.events.find((e) => e.id === "ev-fiesta-luz")).toMatchObject({ status: "archivada", archiveReason: "Duplicada" });
    expect(r.state.eventChanges.at(-1)).toMatchObject({ action: "archived", eventId: "ev-fiesta-luz" });
    expect(applyAction(s, { type: "event/cancel", by: "admin", id: "ev-culto", reason: "Lluvia" }).ok).toBe(false); // serie
    expect(applyAction(s, { type: "event/cancelOccurrence", by: "admin", id: "ev-culto", date: "2026-09-27", reason: "Lluvia" }).ok).toBe(false); // pasado
  });

  it("demo/reset vuelve a las fixtures", () => {
    const r = applyAction(fresh(), { type: "visit/register", by: "consolidacion", input: { personId: "p-01", date: "2026-10-04" } });
    const reset = applyAction(r.state, { type: "demo/reset" });
    expect(reset.state).toEqual(initialSuiteState());
  });
});

// ---------- Correcciones ciclo 1 (S10/S12) ----------

/** Estado mutable (sin congelar) para preparar escenarios. */
const editable = (): SuiteState => initialSuiteState();
const withUser = (s: SuiteState, uid: string, patch: Partial<SuiteState["users"][number]>): SuiteState => ({
  ...s,
  users: s.users.map((u) => (u.uid === uid ? { ...u, ...patch } : u)),
});
const withEvent = (s: SuiteState, id: string, patch: Partial<SuiteState["events"][number]>): SuiteState => ({
  ...s,
  events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
});

describe("store · user/update", () => {
  const user = (s: SuiteState, uid: string) => s.users.find((u) => u.uid === uid)!;

  it("un perfil sin Administrar configuración no puede editar usuarios", () => {
    const s = fresh();
    const r = applyAction(s, { type: "user/update", by: "pastor", profile: { ...user(s, "lider"), displayName: "Otro nombre" } });
    expect(r).toMatchObject({ ok: false, error: "Tu perfil no tiene permiso para esta acción." });
    expect(applyAction(s, { type: "user/update", by: "admin", profile: { ...user(s, "lider"), displayName: "Otro nombre" } }).ok).toBe(true);
  });

  it("debe quedar al menos un administrador activo", () => {
    const s = fresh();
    const r = applyAction(s, { type: "user/update", by: "admin", profile: { ...user(s, "admin"), baseRole: "standard" } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/al menos un administrador activo/);
  });

  it("autodegradación: con otro admin activo, igual no puede quitarse el rol ni desactivarse", () => {
    const base = editable();
    const s = { ...base, users: [...base.users, { ...user(base, "admin"), uid: "admin-2", displayName: "Otra Admin" }] };
    const demote = applyAction(s, { type: "user/update", by: "admin", profile: { ...user(s, "admin"), baseRole: "standard" } });
    expect(!demote.ok && demote.error).toBe("No puedes quitarte el rol de administrador.");
    const off = applyAction(s, { type: "user/update", by: "admin", profile: { ...user(s, "admin"), active: false } });
    expect(!off.ok && off.error).toBe("No puedes desactivar tu propia cuenta.");
    // Otro admin sí puede desactivarlo (queda uno activo).
    expect(applyAction(s, { type: "user/update", by: "admin-2", profile: { ...user(s, "admin"), active: false } }).ok).toBe(true);
  });
});

describe("store · calendario (permisos y bloqueos)", () => {
  it("bloqueo temporal: en una serie iniciada no se cambia día ni hora (sí el título)", () => {
    const s = fresh();
    const hour = applyAction(s, { type: "event/updateSeries", by: "lider", id: "ev-jovenes", patch: { startTime: "19:00" } });
    expect(hour).toMatchObject({ ok: false, error: TEMPORAL_LOCK_HELP });
    const day = applyAction(s, { type: "event/updateSeries", by: "admin", id: "ev-jovenes", patch: { startDate: "2026-10-06", endDate: "2026-10-06" } });
    expect(day).toMatchObject({ ok: false, error: TEMPORAL_LOCK_HELP });
    const title = applyAction(s, { type: "event/updateSeries", by: "lider", id: "ev-jovenes", patch: { title: "Reunión de jóvenes (nuevo formato)" } });
    expect(title.ok).toBe(true);
    expect(title.state.events.find((e) => e.id === "ev-jovenes")).toMatchObject({ title: "Reunión de jóvenes (nuevo formato)", startTime: "20:00", revision: 2 });
  });

  it("Líder no archiva una serie ya iniciada aunque sea de SU área", () => {
    const s = fresh();
    expect(applyAction(s, { type: "event/archive", by: "lider", id: "ev-jovenes", reason: "Ya no se hace" })).toMatchObject({ ok: false });
    expect(applyAction(s, { type: "event/archive", by: "admin", id: "ev-jovenes", reason: "Ya no se hace" }).ok).toBe(true);
  });

  it("actor inactivo: se rechaza cualquier acción", () => {
    const s = withUser(editable(), "lider", { active: false });
    const r = applyAction(s, { type: "event/updateSeries", by: "lider", id: "ev-jovenes", patch: { title: "X nueva" } });
    expect(r).toMatchObject({ ok: false, error: "Perfil de demostración no válido." });
    expect(applyAction(s, { type: "share/regenerate", by: "lider" }).ok).toBe(false);
  });

  it("serie terminada (until < hoy): solo lectura para manage_assigned; nadie cancela 'desde hoy'", () => {
    const s = withEvent(editable(), "ev-jovenes", { recurrence: { freq: "weekly", until: "2026-09-25" } });
    const e = s.events.find((x) => x.id === "ev-jovenes")!;
    const lider = s.users.find((u) => u.uid === "lider")!;
    expect(canManageSeries(lider, e, s.areas, "2026-10-04")).toBe(false);
    expect(canManageSeries(lider, e, s.areas, "2026-09-20")).toBe(true);
    expect(canManageSeries(s.users.find((u) => u.uid === "admin")!, e, s.areas, "2026-10-04")).toBe(true);
    expect(applyAction(s, { type: "event/updateSeries", by: "lider", id: "ev-jovenes", patch: { title: "Jóvenes 2" } })).toMatchObject({ ok: false });
    expect(applyAction(s, { type: "event/updateSeries", by: "admin", id: "ev-jovenes", patch: { title: "Jóvenes 2" } }).ok).toBe(true);
    for (const by of ["lider", "admin"]) {
      const r = applyAction(s, { type: "event/cancelSeriesFrom", by, id: "ev-jovenes", reason: "Se termina el ciclo" });
      expect(r.ok, by).toBe(false);
    }
    // Serie vigente: el líder sí cancela desde hoy.
    expect(applyAction(fresh(), { type: "event/cancelSeriesFrom", by: "lider", id: "ev-jovenes", reason: "Se termina el ciclo" }).ok).toBe(true);
  });

  it("una actividad simple cancelada no es editable (ni por Administración)", () => {
    const s = fresh();
    const e = s.events.find((x) => x.id === "ev-evangelismo")!;
    expect(canManageEvent(s.users.find((u) => u.uid === "admin")!, e, s.areas, "2026-10-04")).toBe(false);
    expect(applyAction(s, { type: "event/updateSeries", by: "admin", id: "ev-evangelismo", patch: { title: "Evangelismo (reprogramado)" } })).toMatchObject({ ok: false });
  });
});

describe("store · configuración de áreas", () => {
  it("area/setActive: solo Administración; activar exige color libre", () => {
    const s = fresh();
    expect(applyAction(s, { type: "area/setActive", by: "pastor", id: "jovenes", active: false })).toMatchObject({ ok: false });
    const off = applyAction(s, { type: "area/setActive", by: "admin", id: "jovenes", active: false });
    expect(off.ok && off.state.areas.find((a) => a.id === "jovenes")!.active).toBe(false);
    const on = applyAction(s, { type: "area/setActive", by: "admin", id: "matrimonios", active: true });
    expect(on.ok && on.state.areas.find((a) => a.id === "matrimonios")!.active).toBe(true);
    const clash = { ...editable(), areas: editable().areas.map((a) => (a.id === "matrimonios" ? { ...a, color: "azul" as const } : a)) };
    expect(applyAction(clash, { type: "area/setActive", by: "admin", id: "matrimonios", active: true })).toMatchObject({ ok: false });
  });

  it("editar un área inactiva sin `active` usa su estado actual (puede conservar un color usado por otra activa)", () => {
    const r = applyAction(fresh(), { type: "area/upsert", by: "admin", area: { id: "matrimonios", name: "Matrimonios", color: "azul" } });
    expect(r.ok).toBe(true);
    expect(r.state.areas.find((a) => a.id === "matrimonios")).toMatchObject({ color: "azul", active: false });
    // Activa: sigue rechazando el color repetido.
    expect(applyAction(fresh(), { type: "area/upsert", by: "admin", area: { id: "jovenes", name: "Jóvenes", color: "azul" } }).ok).toBe(false);
  });
});

describe("store · consolidación (validaciones del servidor)", () => {
  it("una persona integrante no admite visitas, seguimientos ni edición desde Consolidación", () => {
    const s = fresh();
    const msg = "Esta persona ya está integrada; se gestiona desde Integrantes.";
    expect(s.persons.find((p) => p.id === "p-14")!.lifecycleStage).toBe("integrante");
    expect(applyAction(s, { type: "visit/register", by: "consolidacion", input: { personId: "p-14", date: "2026-10-04" } })).toMatchObject({ ok: false, error: msg });
    expect(
      applyAction(s, { type: "followup/register", by: "consolidacion", input: { personId: "p-14", type: "llamada", result: "contactado" } }),
    ).toMatchObject({ ok: false, error: msg });
    expect(applyAction(s, { type: "person/update", by: "consolidacion", personId: "p-14", patch: { fullName: "Otro" } })).toMatchObject({ ok: false, error: msg });
  });

  it("followup/register valida responsable, tipo y resultado contra listas cerradas", () => {
    const s = fresh();
    const base = { personId: "p-02", type: "llamada", result: "contactado" } as const;
    expect(applyAction(s, { type: "followup/register", by: "consolidacion", input: { ...base, ownerUid: "finanzas" } })).toMatchObject({ ok: false });
    expect(applyAction(s, { type: "followup/register", by: "consolidacion", input: { ...base, type: "telegrama" as never } })).toMatchObject({ ok: false });
    expect(applyAction(s, { type: "followup/register", by: "consolidacion", input: { ...base, result: "toString" as never } })).toMatchObject({ ok: false });
    expect(applyAction(s, { type: "followup/register", by: "consolidacion", input: { ...base, ownerUid: "consolidacion" } }).ok).toBe(true);
  });

  it("visit/void guarda quién y cuándo anuló", () => {
    const s = fresh();
    const v = s.visits.find((x) => !x.voided)!;
    const r = applyAction(s, { type: "visit/void", by: "consolidacion", visitId: v.id, reason: "Registrada dos veces" }, "2026-10-04T12:30");
    expect(r.ok && r.state.visits.find((x) => x.id === v.id)).toMatchObject({ voided: true, voidReason: "Registrada dos veces", voidedBy: "consolidacion", voidedAt: "2026-10-04T12:30" });
  });
});
