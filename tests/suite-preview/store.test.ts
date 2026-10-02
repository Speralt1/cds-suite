import { describe, expect, it } from "vitest";
import { applyAction, initialSuiteState, type SuiteState } from "@/lib/suite-preview/store";
import { personStats } from "@/lib/suite-preview/consolidation";

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
