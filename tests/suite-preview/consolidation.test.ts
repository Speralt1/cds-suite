import { describe, expect, it } from "vitest";
import {
  ageAt,
  attentionQueue,
  computeAlerts,
  currentNextAction,
  dashboard,
  duplicateCandidates,
  findDuplicates,
  formatAge,
  nextBirthday,
  personStats,
  suggestStatusAfterFollowUp,
  timeline,
  type ConsolidationData,
} from "@/lib/suite-preview/consolidation";
import { DEMO_NOW, FOLLOWUPS, PERSONS, PERSON_CHANGES, USERS, VISITS } from "@/lib/suite-preview/fixtures";
import { applyAction, initialSuiteState } from "@/lib/suite-preview/store";
import type { AlertType, Person } from "@/lib/suite-preview/types";

const data: ConsolidationData = { persons: PERSONS, visits: VISITS, followUps: FOLLOWUPS, personChanges: PERSON_CHANGES, users: USERS };
const person = (id: string) => PERSONS.find((p) => p.id === id)!;
const typesFor = (id: string, d: ConsolidationData = data) => computeAlerts(d, DEMO_NOW).filter((a) => a.personId === id).map((a) => a.type);
const has = (id: string, t: AlertType, d?: ConsolidationData) => typesFor(id, d).includes(t);

describe("edad y cumpleaños", () => {
  it("cumpleaños hoy y mañana; sin fecha da null y —", () => {
    expect(ageAt("1990-10-04", "2026-10-04")).toBe(36);
    expect(ageAt("1985-10-05", "2026-10-04")).toBe(40);
    expect(ageAt(undefined, "2026-10-04")).toBeNull();
    expect(formatAge(ageAt(undefined, "2026-10-04"))).toBe("—");
  });
  it("el 29-02 cumple el 28-02 en años no bisiestos", () => {
    expect(ageAt("2004-02-29", "2027-02-27")).toBe(22);
    expect(ageAt("2004-02-29", "2027-02-28")).toBe(23);
    expect(ageAt("2004-02-29", "2028-02-28")).toBe(23);
    expect(ageAt("2004-02-29", "2028-02-29")).toBe(24);
    expect(nextBirthday("2004-02-29", "2026-10-04")).toEqual({ date: "2027-02-28", turns: 23, inDays: 147 });
    expect(nextBirthday("2004-02-29", "2027-12-01")?.date).toBe("2028-02-29");
  });
  it("próximo cumpleaños con cruce de año", () => {
    expect(nextBirthday("1992-01-15", "2026-10-04")).toMatchObject({ date: "2027-01-15", turns: 35 });
  });
});

describe("estadísticas", () => {
  it("personStats ignora visitas anuladas", () => {
    expect(personStats("p-03", VISITS)).toEqual({ visitCount: 3, firstVisitDate: "2026-09-06", lastVisitDate: "2026-09-20", lastVisitIsFirst: false });
  });
  it("la próxima acción es la del seguimiento más reciente", () => {
    expect(currentNextAction("p-08", FOLLOWUPS)).toMatchObject({ text: "Acompañar en el campamento", date: "2026-10-17" });
    expect(currentNextAction("p-05", FOLLOWUPS)).toBeNull();
  });
});

describe("las 8 alertas (fixture y contra-fixture)", () => {
  it("sin responsable: vacío o sin acceso / con responsable válido", () => {
    expect(has("p-01", "sin_responsable")).toBe(true);
    expect(has("p-07", "sin_responsable")).toBe(true); // responsable sin acceso a Consolidación
    expect(has("p-03", "sin_responsable")).toBe(false);
  });
  it("sin primer contacto: > 48 h / ingresó hace menos de 48 h", () => {
    expect(computeAlerts(data, DEMO_NOW).find((a) => a.personId === "p-02" && a.type === "sin_primer_contacto")?.detail).toBe("1 intento");
    expect(has("p-01", "sin_primer_contacto")).toBe(false);
    expect(has("p-03", "sin_primer_contacto")).toBe(false);
  });
  it("seguimiento vencido: 01-10 / próxima acción de hoy en adelante", () => {
    expect(has("p-03", "seguimiento_vencido")).toBe(true);
    expect(has("p-02", "seguimiento_vencido")).toBe(false);
  });
  it("cumpleaños próximo: hoy, 05-10 y 10-10 / 19-10 (15 días)", () => {
    for (const id of ["p-06", "p-07", "p-08"]) expect(has(id, "cumpleanos_proximo"), id).toBe(true);
    expect(has("p-02", "cumpleanos_proximo")).toBe(false);
  });
  it("volvió: visita no primera reciente sin seguimiento posterior / con seguimiento posterior", () => {
    expect(has("p-04", "volvio")).toBe(true);
    expect(has("p-06", "volvio")).toBe(false);
  });
  it("varios días sin volver: > 21 días / 14 días", () => {
    expect(has("p-05", "varios_dias_sin_volver")).toBe(true);
    expect(has("p-03", "varios_dias_sin_volver")).toBe(false);
  });
  it("posible duplicado por teléfono y por correo / sin coincidencias", () => {
    expect(has("p-10", "posible_duplicado_telefono") && has("p-11", "posible_duplicado_telefono")).toBe(true);
    expect(has("p-12", "posible_duplicado_correo") && has("p-13", "posible_duplicado_correo")).toBe(true);
    expect(typesFor("p-16").some((t) => t.startsWith("posible_duplicado"))).toBe(false);
  });
  it("No contactar suprime alertas salvo duplicados; Integrado no tiene alertas", () => {
    expect(typesFor("p-15")).toEqual([]); // cumple el 12-10 y lleva > 21 días sin volver, pero No contactar
    const withDup: ConsolidationData = { ...data, persons: PERSONS.map((p) => (p.id === "p-15" ? { ...p, phoneE164: "+56955550110" } : p)) };
    expect(typesFor("p-15", withDup)).toEqual(["posible_duplicado_telefono"]);
    expect(typesFor("p-14")).toEqual([]);
  });
});

describe("cola de atención y dashboard", () => {
  it("una fila por persona, en el orden de prioridad (lo más antiguo primero)", () => {
    const queue = attentionQueue(computeAlerts(data, DEMO_NOW));
    expect(queue.map((r) => `${r.personId}:${r.primary.type}`)).toEqual([
      "p-07:sin_responsable",
      "p-01:sin_responsable",
      "p-02:sin_primer_contacto",
      "p-03:seguimiento_vencido",
      "p-04:volvio",
      "p-05:varios_dias_sin_volver",
      "p-12:posible_duplicado_correo",
      "p-13:posible_duplicado_correo",
      "p-10:posible_duplicado_telefono",
      "p-11:posible_duplicado_telefono",
    ]);
    expect(new Set(queue.map((r) => r.personId)).size).toBe(queue.length);
    expect(queue[0]).toMatchObject({ cta: "Asignar", others: [expect.objectContaining({ type: "cumpleanos_proximo" })] });
    expect(queue.find((r) => r.personId === "p-04")?.cta).toBe("Agradecer");
  });
  it("3 indicadores y secciones", () => {
    const d = dashboard(data, DEMO_NOW);
    expect([d.newThisMonth, d.withoutFirstContact, d.overdueFollowUps]).toEqual([1, 1, 1]);
    expect(d.birthdays.map((b) => b.person.id)).toEqual(["p-06", "p-07", "p-08"]);
    expect(d.returned.map((r) => r.person.id)).toContain("p-04");
    expect(d.pendingFollowUps.every((p) => p.date >= "2026-10-04" && p.date <= "2026-10-11")).toBe(true);
    expect(d.recentNew.map((p) => p.id)).toContain("p-01");
  });
});

describe("timeline y duplicados", () => {
  it("timeline ordenado (más nuevo primero) con creación, visitas, seguimientos y cambios", () => {
    const t = timeline("p-14", data);
    expect(t[0]).toMatchObject({ kind: "change" });
    expect(t.at(-1)).toMatchObject({ kind: "created" });
    expect(t.find((i) => i.isFirstVisit)).toMatchObject({ kind: "visit", title: "Primera visita" });
    expect(t.some((i) => i.title === "Pasó a Integrante")).toBe(true);
    expect(t.map((i) => i.at)).toEqual([...t.map((i) => i.at)].sort().reverse());
    expect(timeline("p-03", data).some((i) => i.voided)).toBe(true);
  });
  it("findDuplicates y duplicateCandidates (no bloquea, normaliza)", () => {
    expect(findDuplicates(PERSONS).map((g) => `${g.kind}:${g.ids.join(",")}`).sort()).toEqual(["correo:p-12,p-13", "telefono:p-10,p-11"]);
    expect(duplicateCandidates({ phone: "(+56) 9 5555-0104" }, PERSONS).map((c) => c.person.id)).toEqual(["p-04"]);
    expect(duplicateCandidates({ email: "FAMILIA.VEGA@demo.invalid" }, PERSONS).map((c) => c.person.id)).toEqual(["p-12", "p-13"]);
    expect(duplicateCandidates({ phone: "955550104" }, PERSONS, "p-04")).toEqual([]);
  });
});

describe("tri-estado y sugerencias", () => {
  it("Sin información se conserva al guardar y no cuenta como No", () => {
    const r = applyAction(initialSuiteState(), { type: "person/create", by: "consolidacion", input: { fullName: "Nueva Persona", phone: "955550199" } });
    if (!r.ok) throw new Error(r.error);
    const p = r.state.persons.find((x) => x.id === r.createdId)!;
    expect([p.faithConfession, p.baptized]).toEqual(["sin_informacion", "sin_informacion"]);
    const noCount = r.state.persons.filter((x) => x.baptized === "no").length;
    expect(noCount).toBe(PERSONS.filter((x) => x.baptized === "no").length);
  });
  it("el primer contacto exitoso sugiere En seguimiento (sin aplicarlo)", () => {
    const p: Person = person("p-02");
    expect(suggestStatusAfterFollowUp(p, { result: "contactado" }, FOLLOWUPS)).toEqual({ status: "en_seguimiento" });
    expect(suggestStatusAfterFollowUp(person("p-03"), { result: "contactado" }, FOLLOWUPS)).toEqual({});
    expect(suggestStatusAfterFollowUp(p, { result: "no_desea_contacto" }, FOLLOWUPS)).toEqual({
      status: "sin_continuidad",
      doNotContact: true,
      closedReason: "no_desea_contacto",
    });
    expect(p.consolidationStatus).toBe("por_contactar");
  });
});
