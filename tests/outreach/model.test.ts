import { describe, expect, it } from "vitest";
import {
  EDITION_STATUSES,
  canMoveEdition,
  changeAttendance,
  copyTeamStructure,
  editionIdFor,
  hasConsent,
  isContactable,
  isReadOnly,
  parseDecision,
  queueBucket,
  recordContact,
  type EventContact,
  type TeamMember,
} from "@/lib/outreach/model";
import { consent, reg } from "./helpers";

const evento = { status: "evento" } as const;
const contact = (over: Partial<EventContact> = {}): EventContact => ({
  id: "c1",
  registrationId: "vplt-2026_web_t1",
  editionId: "vplt-2026",
  date: "2026-11-30",
  channel: "whatsapp",
  result: "contactado",
  nextAction: null,
  nextActionDate: null,
  byUid: "resp-1",
  ...over,
});

describe("edición", () => {
  it("solo permite las transiciones declaradas", () => {
    expect(canMoveEdition("preparacion", "inscripcion")).toBe(true);
    expect(canMoveEdition("inscripcion", "evento")).toBe(true);
    expect(canMoveEdition("evento", "seguimiento")).toBe(true);
    expect(canMoveEdition("seguimiento", "cerrada")).toBe(true);
    expect(canMoveEdition("preparacion", "evento")).toBe(false);
    expect(canMoveEdition("preparacion", "cerrada")).toBe(false);
    expect(canMoveEdition("seguimiento", "inscripcion")).toBe(false);
  });

  it("una edición cerrada no tiene salida y es de solo lectura", () => {
    for (const to of EDITION_STATUSES) expect(canMoveEdition("cerrada", to)).toBe(false);
    expect(isReadOnly({ status: "cerrada" })).toBe(true);
    expect(isReadOnly({ status: "seguimiento" })).toBe(false);
  });

  it("editionIdFor genera ids estables y rechaza años inválidos", () => {
    expect(editionIdFor(2026)).toBe("vplt-2026");
    expect(() => editionIdFor(1999)).toThrow();
    expect(() => editionIdFor(2026.5)).toThrow();
    expect(() => editionIdFor(2101)).toThrow();
  });
});

describe("equipo", () => {
  it("copyTeamStructure copia estructura de miembros activos y no arrastra personas inactivas ni referencias", () => {
    const prev: TeamMember[] = [
      { uid: "a", displayName: "A", roles: ["responsable"], active: true, maxAssigned: 12 },
      { uid: "b", displayName: "B", roles: ["recepcion"], active: false, maxAssigned: null },
    ];
    const copy = copyTeamStructure(prev);
    expect(copy).toHaveLength(1);
    expect(copy[0]).toEqual(prev[0]);
    expect(copy[0].roles).not.toBe(prev[0].roles);
    // La copia no trae inscripciones ni cargas: la estructura no tiene esos campos.
    expect(Object.keys(copy[0]).sort()).toEqual(["active", "displayName", "maxAssigned", "roles", "uid"]);
  });
});

describe("consentimiento", () => {
  it("hasConsent exige un registro vigente del propósito", () => {
    expect(hasConsent(reg(), "seguimiento_evento")).toBe(true);
    expect(hasConsent(reg({ consents: [] }), "seguimiento_evento")).toBe(false);
    expect(hasConsent(reg({ consents: [consent("mensajes_whatsapp")] }), "seguimiento_evento")).toBe(false);
  });

  it("una revocación quita la autorización", () => {
    const r = reg({ consents: [consent("seguimiento_evento", "2026-11-30T10:00")] });
    expect(hasConsent(r, "seguimiento_evento")).toBe(false);
    expect(isContactable(r)).toBe(false);
  });

  it("doNotContact anula toda autorización", () => {
    const r = reg({ doNotContact: true });
    expect(hasConsent(r, "seguimiento_evento")).toBe(false);
    expect(hasConsent(r, "mensajes_whatsapp")).toBe(false);
    expect(isContactable(r)).toBe(false);
  });

  it("isContactable también exige inscripción activa", () => {
    expect(isContactable(reg())).toBe(true);
    expect(isContactable(reg({ status: "cancelada" }))).toBe(false);
  });
});

describe("asistencia", () => {
  const change = (to: "asistio" | "no_asistio" | "sin_confirmar", reason?: string) => ({ to, at: "2026-11-29T19:40", by: "recep", reason });

  it("«Asistió» se marca con un toque y sube la revisión", () => {
    const res = changeAttendance(reg(), evento, change("asistio"));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.attendance).toBe("asistio");
      expect(res.value.attendanceBy).toBe("recep");
      expect(res.value.revision).toBe(2);
    }
  });

  it("repetir la misma marca es sin_cambio y no modifica nada", () => {
    const once = changeAttendance(reg(), evento, change("asistio"));
    if (!once.ok) throw new Error("debía marcar");
    const twice = changeAttendance(once.value, evento, change("asistio"));
    expect(twice).toEqual({ ok: false, error: "sin_cambio" });
  });

  it("«No asistió» solo se confirma en evento o seguimiento", () => {
    expect(changeAttendance(reg(), { status: "inscripcion" }, change("no_asistio"))).toEqual({ ok: false, error: "fuera_del_evento" });
    expect(changeAttendance(reg(), { status: "preparacion" }, change("no_asistio"))).toEqual({ ok: false, error: "fuera_del_evento" });
    expect(changeAttendance(reg(), evento, change("no_asistio")).ok).toBe(true);
    expect(changeAttendance(reg(), { status: "seguimiento" }, change("no_asistio")).ok).toBe(true);
  });

  it("corregir una marca previa exige motivo", () => {
    const asistio = reg({ attendance: "asistio" });
    expect(changeAttendance(asistio, evento, change("no_asistio"))).toEqual({ ok: false, error: "motivo_requerido" });
    expect(changeAttendance(asistio, evento, change("no_asistio", "   "))).toEqual({ ok: false, error: "motivo_requerido" });
    const ok = changeAttendance(asistio, evento, change("no_asistio", "Se fue antes de empezar"));
    expect(ok.ok).toBe(true);
  });

  it("edición cerrada es de solo lectura y una inscripción cancelada no se marca", () => {
    expect(changeAttendance(reg(), { status: "cerrada" }, change("asistio"))).toEqual({ ok: false, error: "edicion_cerrada" });
    expect(changeAttendance(reg({ status: "cancelada" }), evento, change("asistio"))).toEqual({ ok: false, error: "inscripcion_inactiva" });
  });
});

describe("recordContact", () => {
  const assigned = () => reg({ ownerUid: "resp-1", attendance: "asistio" });

  it("solo el responsable asignado registra el contacto", () => {
    expect(recordContact(assigned(), evento, contact({ byUid: "otro" }))).toEqual({ ok: false, error: "no_asignada" });
    expect(recordContact(reg(), evento, contact())).toEqual({ ok: false, error: "no_asignada" });
    const ok = recordContact(assigned(), evento, contact({ nextAction: "Llamar", nextActionDate: "2026-12-06" }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.followUp).toMatchObject({ attempts: 1, lastResult: "contactado", nextAction: "Llamar", nextActionDate: "2026-12-06" });
    }
  });

  it("«pidió no contacto» marca la baja y limpia la próxima acción", () => {
    const res = recordContact(assigned(), evento, contact({ result: "pidio_no_contacto", nextAction: "Llamar", nextActionDate: "2026-12-06" }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.doNotContact).toBe(true);
      expect(res.value.followUp.nextAction).toBeNull();
      expect(res.value.followUp.nextActionDate).toBeNull();
      expect(isContactable(res.value)).toBe(false);
    }
  });

  it("rechaza una próxima acción incompleta (acción sin fecha o fecha sin acción)", () => {
    expect(recordContact(assigned(), evento, contact({ nextAction: "Llamar", nextActionDate: null }))).toEqual({ ok: false, error: "proxima_accion_incompleta" });
    expect(recordContact(assigned(), evento, contact({ nextAction: null, nextActionDate: "2026-12-06" }))).toEqual({ ok: false, error: "proxima_accion_incompleta" });
  });

  it("no registra sobre personas sin autorización, traspasadas o en edición cerrada", () => {
    expect(recordContact(reg({ ownerUid: "resp-1", consents: [] }), evento, contact())).toEqual({ ok: false, error: "no_contactable" });
    expect(recordContact(reg({ ownerUid: "resp-1", handedOffAt: "2026-12-01T10:00" }), evento, contact())).toEqual({ ok: false, error: "traspasada" });
    expect(recordContact(assigned(), { status: "cerrada" }, contact())).toEqual({ ok: false, error: "edicion_cerrada" });
  });

  it("cada contacto suma un intento sin mutar el original", () => {
    const base = assigned();
    const res = recordContact(base, evento, contact());
    expect(base.followUp.attempts).toBe(0);
    expect(res.ok && res.value.followUp.attempts).toBe(1);
  });
});

describe("queueBucket", () => {
  const D = "2026-11-29";

  it("sin intentos: primer contacto hasta D+2 y vencido después", () => {
    const r = reg({ ownerUid: "resp-1" });
    expect(queueBucket(r, "2026-11-30", D)).toBe("primer_contacto");
    expect(queueBucket(r, "2026-12-01", D)).toBe("primer_contacto");
    expect(queueBucket(r, "2026-12-02", D)).toBe("vencido");
  });

  it("sin fecha de evento nunca está vencido por D+2", () => {
    expect(queueBucket(reg({ ownerUid: "resp-1" }), "2027-01-01", null)).toBe("primer_contacto");
  });

  it("con próxima acción: vencido, hoy, próximo; sin próxima acción, al día", () => {
    const base = reg({ ownerUid: "resp-1" });
    const f = (nextActionDate: string | null) => ({ ...base, followUp: { ...base.followUp, attempts: 1, nextActionDate, nextAction: nextActionDate ? "x" : null } });
    expect(queueBucket(f("2026-12-05"), "2026-12-06", D)).toBe("vencido");
    expect(queueBucket(f("2026-12-06"), "2026-12-06", D)).toBe("hoy");
    expect(queueBucket(f("2026-12-07"), "2026-12-06", D)).toBe("proximo");
    expect(queueBucket(f(null), "2026-12-06", D)).toBe("al_dia");
  });

  it("baja o sin autorización van a «baja»", () => {
    expect(queueBucket(reg({ doNotContact: true }), "2026-11-30", D)).toBe("baja");
    expect(queueBucket(reg({ consents: [] }), "2026-11-30", D)).toBe("baja");
  });
});

describe("decisión voluntaria", () => {
  const ok = { registrationId: "r1", editionId: "vplt-2026", value: "desea_conversar", declaredBy: "la_persona", consentTextVersion: "dec-1", recordedAt: "2026-11-29T20:00", recordedBy: "resp-1" } as const;

  it("acepta una declaración propia con consentimiento y auditoría", () => {
    expect(parseDecision(ok).ok).toBe(true);
  });

  it("rechaza que alguien declare por otro", () => {
    const res = parseDecision({ ...ok, declaredBy: "responsable" as unknown as "la_persona" });
    expect(res).toEqual({ ok: false, error: "solo_declaracion_propia" });
  });

  it("rechaza si falta el consentimiento, el valor o la auditoría", () => {
    expect(parseDecision({ ...ok, consentTextVersion: "  " })).toEqual({ ok: false, error: "consentimiento_requerido" });
    expect(parseDecision({ ...ok, consentTextVersion: undefined })).toEqual({ ok: false, error: "consentimiento_requerido" });
    expect(parseDecision({ ...ok, value: "otro" as unknown as "desea_conversar" })).toEqual({ ok: false, error: "valor_invalido" });
    expect(parseDecision({ ...ok, recordedBy: undefined })).toEqual({ ok: false, error: "auditoria_requerida" });
    expect(parseDecision({ ...ok, registrationId: undefined })).toEqual({ ok: false, error: "inscripcion_requerida" });
  });
});
