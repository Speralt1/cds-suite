import { describe, expect, it } from "vitest";
import {
  ALERT_LABEL,
  attentionQueue,
  buildPersonView,
  computeAlerts,
  dashboard,
  duplicateCandidates,
  findDuplicates,
  hasReturnedRecently,
  personBadges,
  timeline,
} from "@/lib/members/consolidation";
import { toFollowUp, toPerson, toPersonChange, toVisit } from "@/lib/members/client";
import { MembersApiError, newRequestId, toMembersError } from "@/lib/members/api";
import { REQUEST_ID_PATTERN, suggestAfterFollowUp, whatsappLink } from "@/lib/shared/members";
import type { AlertType, Person } from "@/lib/members/types";
import { NOW, TODAY, change, followUp, person, visit } from "./fixtures";

const OWNERS = new Set(["u-owner"]);
const types = (p: Person, persons: Person[] = [p], owners: ReadonlySet<string> | null = OWNERS) =>
  computeAlerts(persons, owners, NOW)
    .filter((a) => a.personId === p.id)
    .map((a) => a.type);
const has = (p: Person, t: AlertType, persons?: Person[], owners?: ReadonlySet<string> | null) => types(p, persons, owners).includes(t);

describe("alertas (doc 23 §7)", () => {
  it("V1 no tiene alerta de cumpleaños ni edad", () => {
    expect(Object.keys(ALERT_LABEL).some((k) => /cumple|edad|menor/.test(k))).toBe(false);
  });

  it("sin responsable: vacío o fuera de membersOwnerOptions / válido; sin lista no marca a quien tiene uno", () => {
    expect(has(person({ followUpOwnerUid: null }), "sin_responsable")).toBe(true);
    expect(has(person({ followUpOwnerUid: "u-desactivado" }), "sin_responsable")).toBe(true);
    expect(has(person(), "sin_responsable")).toBe(false);
    expect(has(person({ followUpOwnerUid: "u-x" }), "sin_responsable", undefined, null)).toBe(false);
    expect(has(person({ followUpOwnerUid: null }), "sin_responsable", undefined, null)).toBe(true);
  });

  it("sin primer contacto: > 48 h desde createdAt sin firstContactDate", () => {
    const old = person({ createdAt: "2026-10-03T11:00", projection: { firstContactDate: null, followUpCount: 1 } });
    expect(has(old, "sin_primer_contacto")).toBe(true);
    expect(computeAlerts([old], OWNERS, NOW).find((a) => a.type === "sin_primer_contacto")?.detail).toBe("1 intento");
    expect(has(person({ createdAt: "2026-10-03T13:00", projection: { firstContactDate: null } }), "sin_primer_contacto")).toBe(false);
    expect(has(person({ createdAt: "2026-09-01T10:00" }), "sin_primer_contacto")).toBe(false);
  });

  it("seguimiento vencido: nextActionDate < hoy", () => {
    expect(has(person({ projection: { nextAction: "Llamar", nextActionDate: "2026-10-04" } }), "seguimiento_vencido")).toBe(true);
    expect(has(person({ projection: { nextAction: "Llamar", nextActionDate: TODAY } }), "seguimiento_vencido")).toBe(false);
  });

  it("volvió: última visita posterior a la primera, ≤ 7 días y sin seguimiento posterior", () => {
    const returned = person({ projection: { visitCount: 2, firstVisitDate: "2026-09-20", lastVisitDate: "2026-10-03", lastFollowUpDate: "2026-09-21" } });
    expect(has(returned, "volvio")).toBe(true);
    // Seguimiento el mismo día de la visita (o después) la resuelve.
    expect(has(person({ projection: { ...returned.projection, lastFollowUpDate: "2026-10-03" } }), "volvio")).toBe(false);
    // Hace más de 7 días.
    expect(has(person({ projection: { ...returned.projection, lastVisitDate: "2026-09-27" } }), "volvio")).toBe(false);
  });

  it("M1: dos visitas el MISMO día (duplicado) no producen «Volvió» (ni badge ni bloque)", () => {
    const sameDay = person({ projection: { visitCount: 2, firstVisitDate: "2026-10-04", lastVisitDate: "2026-10-04", lastFollowUpDate: null } });
    expect(hasReturnedRecently(sameDay, TODAY)).toBe(false);
    expect(has(sameDay, "volvio")).toBe(false);
    expect(personBadges(sameDay, TODAY)).not.toContain("volvio");
    expect(dashboard([sameDay], computeAlerts([sameDay], OWNERS, NOW), TODAY).returned).toEqual([]);
  });

  it("varios días sin volver: > 21 días desde la última visita", () => {
    expect(has(person({ projection: { lastVisitDate: "2026-09-13" } }), "varios_dias_sin_volver")).toBe(true);
    expect(has(person({ projection: { lastVisitDate: "2026-09-14" } }), "varios_dias_sin_volver")).toBe(false);
  });

  it("posible duplicado por teléfono y por correo, en todas las personas", () => {
    const a = person({ id: "a", fullName: "Ana", email: "familia@demo.invalid" });
    const b = person({ id: "b", fullName: "Beto", email: "familia@demo.invalid" });
    const c = person({ id: "c", fullName: "Caro", phoneE164: "+56955550009" });
    const all = [a, b, c];
    expect(types(a, all)).toEqual(["posible_duplicado_telefono", "posible_duplicado_correo"]);
    expect(types(c, all)).toEqual([]);
    expect(findDuplicates(all).map((g) => `${g.kind}:${g.ids.join(",")}`)).toEqual(["telefono:a,b", "correo:a,b"]);
  });

  it("No contactar suprime todas las alertas salvo duplicados; integrante y sin continuidad no tienen alertas", () => {
    const noisy = { followUpOwnerUid: null, projection: { lastVisitDate: "2026-08-01", nextAction: "x", nextActionDate: "2026-09-01" } };
    const dnc = person({ id: "d", doNotContact: true, ...noisy });
    expect(types(dnc)).toEqual([]);
    const twin = person({ id: "t" });
    expect(types(dnc, [dnc, twin])).toEqual(["posible_duplicado_telefono"]);
    expect(types(person({ id: "i", lifecycleStage: "integrante", consolidationStatus: "integrado", ...noisy }))).toEqual([]);
    expect(types(person({ id: "s", consolidationStatus: "sin_continuidad", ...noisy }))).toEqual([]);
  });
});

describe("cola de atención y dashboard", () => {
  const p = (id: string, over: Parameters<typeof person>[0]) => person({ id, fullName: id, phoneE164: `+5695555${id.padStart(4, "0")}`, ...over });
  const persons = [
    p("1", { followUpOwnerUid: null, entryDate: "2026-10-04", createdAt: "2026-10-04T10:00" }),
    p("2", { createdAt: "2026-10-01T10:00", projection: { firstContactDate: null } }),
    p("3", { projection: { nextAction: "Llamar", nextActionDate: "2026-10-01" } }),
    p("4", { projection: { visitCount: 3, firstVisitDate: "2026-09-01", lastVisitDate: "2026-10-04", lastFollowUpDate: "2026-09-02" } }),
    p("5", { projection: { lastVisitDate: "2026-09-01" } }),
    p("6", { followUpOwnerUid: null, entryDate: "2026-09-20", createdAt: "2026-09-20T10:00" }),
    p("7", { projection: { nextAction: "Invitar", nextActionDate: "2026-10-09", nextActionOwnerUid: "u-owner" } }),
    p("8", { projection: { nextAction: "Lejana", nextActionDate: "2026-10-20" } }),
  ];
  const alerts = computeAlerts(persons, OWNERS, NOW);

  it("una fila por persona en el orden de prioridad (lo más antiguo primero) con CTA con verbo", () => {
    const q = attentionQueue(alerts);
    expect(q.map((r) => `${r.personId}:${r.primary.type}`)).toEqual([
      "6:sin_responsable",
      "1:sin_responsable",
      "2:sin_primer_contacto",
      "3:seguimiento_vencido",
      "4:volvio",
      "5:varios_dias_sin_volver",
    ]);
    expect(q.map((r) => r.cta)).toEqual(["Asignar", "Asignar", "Contactar", "Registrar seguimiento", "Agradecer", "Invitar"]);
  });

  it("exactamente 3 indicadores y bloques (pendientes = próximos 7 días; volvieron)", () => {
    const d = dashboard(persons, alerts, TODAY);
    expect([d.newThisMonth, d.withoutFirstContact, d.overdueFollowUps]).toEqual([7, 1, 1]);
    expect(d.pendingFollowUps.map((x) => x.person.id)).toEqual(["7"]);
    expect(d.returned.map((x) => x.person.id)).toEqual(["4"]);
    expect(d.recentNew[0].id).toBe("1");
    expect(d.oldestOverdue).toBe("2026-10-01");
    expect(Object.keys(d)).not.toContain("birthdays");
  });

  it("vista por persona: responsable sin acceso, badges y próxima acción vencida", () => {
    const v = buildPersonView(person({ followUpOwnerUid: "u-x", entryDate: "2026-10-04" }), [], new Map([["u-owner", "Carolina Vidal"]]), TODAY);
    expect(v.ownerValid).toBe(false);
    expect(v.ownerName).toBeNull();
    expect(v.badges).toEqual(["nuevo"]);
    const over = buildPersonView(person({ projection: { nextAction: "Llamar", nextActionDate: "2026-10-01" } }), [], null, TODAY);
    expect(over.nextOverdue).toBe(true);
  });
});

describe("timeline", () => {
  it("más nuevo primero; registro al final; visitas/seguimientos sin duplicar su registro de auditoría", () => {
    const p = person({ createdAt: "2026-10-01T10:00" });
    const items = timeline(
      p,
      [visit({ id: "v1", date: "2026-10-01", firstVisit: true }), visit({ id: "v2", date: "2026-10-04", createdAt: "2026-10-04T19:00" })],
      [followUp({ id: "f1" })],
      [
        change({ id: "c1" }),
        change({ id: "c2", action: "visit_recorded", at: "2026-10-04T19:00" }),
        change({ id: "c3", action: "person_created", at: "2026-10-01T10:00" }),
      ],
    );
    expect(items.map((i) => i.id)).toEqual(["v2", "c1", "f1", "v1", "created-p1"]);
    expect(items.find((i) => i.kind === "visit" && i.isFirstVisit)?.id).toBe("v1");
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort().reverse());
  });
});

describe("duplicados en el formulario (advertencia, normaliza como el servidor)", () => {
  const all = [person({ id: "a", phoneE164: "+56955550104", email: "ana@demo.invalid" }), person({ id: "b", phoneE164: "+56955550105" })];
  it("teléfono y correo normalizados; excluye a la propia persona", () => {
    expect(duplicateCandidates({ phone: "(+56) 9 5555-0104" }, all).map((c) => c.person.id)).toEqual(["a"]);
    expect(duplicateCandidates({ email: " ANA@demo.invalid " }, all)[0].by).toEqual(["correo"]);
    expect(duplicateCandidates({ phone: "955550104" }, all, "a")).toEqual([]);
    expect(duplicateCandidates({ phone: "123" }, all)).toEqual([]);
  });
});

describe("WhatsApp y sugerencias", () => {
  it("matriz #29: sin enlace con No contactar o teléfono inválido; enlace wa.me sin texto", () => {
    expect(whatsappLink(person({ doNotContact: true }))).toBeNull();
    expect(whatsappLink(person({ phoneE164: "" }))).toBeNull();
    expect(whatsappLink(person())).toBe("https://wa.me/56955550001");
  });

  it("#25/#26: el primer «contactado» SUGIERE En seguimiento (no lo aplica); después ya no", () => {
    const p = person({ consolidationStatus: "por_contactar", projection: { firstContactDate: null } });
    expect(suggestAfterFollowUp({ ...p, firstContactDate: null }, "contactado")).toEqual({
      status: "en_seguimiento",
      doNotContact: false,
      closedReason: null,
    });
    expect(p.consolidationStatus).toBe("por_contactar");
    expect(suggestAfterFollowUp({ ...p, firstContactDate: "2026-10-02" }, "contactado").status).toBeNull();
    expect(suggestAfterFollowUp({ ...p, firstContactDate: null }, "no_desea_contacto")).toMatchObject({
      status: "sin_continuidad",
      doNotContact: true,
    });
  });
});

describe("cliente: mapeo tolerante y errores", () => {
  it("toPerson tolera campos faltantes y convierte Timestamp a hora de Santiago", () => {
    const p = toPerson("x", {
      fullName: "  Ana  ",
      createdAt: { toDate: () => new Date("2026-10-05T15:00:00Z") },
      entryDate: "2026-10-05",
      visitCount: 2,
      lastVisitDate: "2026-10-05",
      consolidationStatus: "raro",
      birthDate: "1990-01-01",
    });
    expect(p).toMatchObject({ fullName: "Ana", createdAt: "2026-10-05T12:00", consolidationStatus: "por_contactar", revision: 1 });
    expect(p.projection.visitCount).toBe(2);
    expect(p).not.toHaveProperty("birthDate");
    expect(toVisit("v", {}).date).toBe("1970-01-01");
    expect(toFollowUp("f", { type: "x" }).type).toBe("otro");
    expect(toPersonChange("c", { action: "do_not_contact_changed", to: true }).to).toBe(true);
  });

  it("requestId válido y errores members/* en español (conflicto, campos)", () => {
    expect(newRequestId()).toMatch(REQUEST_ID_PATTERN);
    const conflict = toMembersError({ code: "functions/aborted", message: "members/conflict" });
    expect(conflict).toBeInstanceOf(MembersApiError);
    expect(conflict.kind).toBe("conflict");
    expect(conflict.message).toBe("Alguien actualizó esta persona. Recarga para ver los cambios.");
    const fields = toMembersError({ code: "functions/invalid-argument", message: "members/invalid-argument", details: { fields: { phone: "invalid" } } });
    expect(fields.kind).toBe("fields");
    expect(fields.fields.phone).toMatch(/9 dígitos/);
    expect(toMembersError({ code: "functions/failed-precondition", message: "members/suggestion-mismatch" }).message).toBe(
      "La situación de esta persona cambió. Revisa la sugerencia y vuelve a guardar.",
    );
    expect(toMembersError({ code: "functions/unavailable", message: "x" }).kind).toBe("network");
  });
});
