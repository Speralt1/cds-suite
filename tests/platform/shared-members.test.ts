// @vitest-environment node
// lib/shared/members.ts (doc 23): normalización, validación estricta de payloads,
// pipeline, sugerencias y proyección. La misma lógica corre en las Functions
// (functions/shared/members.js, generado) y en el cliente.
import { describe, expect, it } from "vitest";
import {
  EMPTY_PROJECTION,
  MEMBERS_LIMITS,
  checkTransition,
  formatPhone,
  normalizeEmail,
  normalizePhone,
  parseFollowUpCreate,
  parsePersonCreate,
  parsePersonUpdate,
  parseStatusChange,
  parseVisitCreate,
  payloadTooLarge,
  projectFollowUp,
  projectVisit,
  projectionOf,
  stageFor,
  suggestAfterFollowUp,
  suggestReopenOnVisit,
  whatsappLink,
  type PipelineState,
} from "@/lib/shared/members";

const TODAY = "2026-10-07";
const RID = "req_0123456789";

describe("teléfono (#10–#12, lógica validada en la preview)", () => {
  it("formas equivalentes del mismo celular chileno", () => {
    for (const raw of ["+56 9 1234 5678", "912345678", "56912345678", "(+56) 9-1234-5678", "0912345678", "0056912345678", "9.1234.5678"])
      expect(normalizePhone(raw), raw).toEqual({ ok: true, e164: "+56912345678", isChile: true });
  });
  it("8 dígitos (celular antiguo), fijo y extranjero con +", () => {
    expect(normalizePhone("12345678")).toMatchObject({ ok: true, e164: "+56912345678" });
    expect(normalizePhone("221234567")).toMatchObject({ ok: true, e164: "+56221234567" });
    expect(normalizePhone("022 123 4567")).toMatchObject({ ok: true, e164: "+56221234567" });
    expect(normalizePhone("+58 412 1234567")).toEqual({ ok: true, e164: "+584121234567", isChile: false });
    expect(normalizePhone("+509 3412 3456")).toEqual({ ok: true, e164: "+50934123456", isChile: false });
  });
  it("inválidos y no-strings", () => {
    expect(normalizePhone("  ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizePhone(undefined)).toEqual({ ok: false, reason: "empty" });
    for (const raw of ["123", "1234567890123456", "+56 9 1234 567", "9abc12345", "+1234567", "+56 1 2345 6789", 912345678, {}, "9".repeat(41)])
      expect(normalizePhone(raw).ok, String(raw)).toBe(false);
  });
  it("formato visible y WhatsApp local sin texto, oculto con No contactar (#29)", () => {
    expect(formatPhone("+56912345678")).toBe("+56 9 1234 5678");
    expect(formatPhone("+56322123456")).toBe("+56 32 212 3456");
    expect(formatPhone("+584121234567")).toBe("+584121234567");
    expect(whatsappLink({ phoneE164: "+56912345678", doNotContact: false })).toBe("https://wa.me/56912345678");
    expect(whatsappLink({ phoneE164: "+56912345678", doNotContact: true })).toBeNull();
    expect(whatsappLink({ phoneE164: "+56912345678" })).toBeNull(); // sin dato explícito: no se ofrece
    expect(whatsappLink({ phoneE164: "912345678", doNotContact: false })).toBeNull();
  });
  it("correo: trim + minúsculas (#13)", () => {
    expect(normalizeEmail("  Ana.Torres@Example.Test ")).toEqual({ ok: true, value: "ana.torres@example.test" });
    expect(normalizeEmail("sin-arroba")).toEqual({ ok: false });
    expect(normalizeEmail(`${"a".repeat(160)}@x.cl`)).toEqual({ ok: false });
    expect(normalizeEmail(42)).toEqual({ ok: false });
  });
});

describe("parsePersonCreate", () => {
  const base = { requestId: RID, fullName: "  Ana   Pérez ", phone: "9 1234 5678", firstVisitDate: "2026-10-04" };

  it("normaliza y completa opcionales con null (#9)", () => {
    expect(parsePersonCreate({ ...base, email: " ANA@Example.Test " }, TODAY)).toEqual({
      ok: true,
      value: {
        requestId: RID,
        fullName: "Ana Pérez",
        phoneE164: "+56912345678",
        email: "ana@example.test",
        firstVisitDate: "2026-10-04",
        calendarEventId: null,
        arrivalSource: null,
        invitedBy: null,
        followUpOwnerUid: null,
        visitNote: null,
      },
    });
  });

  it("campos desconocidos y sensibles se rechazan (#40, privacidad)", () => {
    for (const extra of ["birthDate", "faithConfession", "baptized", "initialNotes", "consolidationStatus", "createdBy", "revision"]) {
      const r = parsePersonCreate({ ...base, [extra]: "x" }, TODAY);
      expect(r.ok, extra).toBe(false);
      if (!r.ok) expect(r.errors[extra]).toBe("unknown_field");
    }
  });

  it("obligatorios, tipos y largos", () => {
    const r = parsePersonCreate({ requestId: "x", fullName: "", phone: "123", firstVisitDate: "2026-13-01" }, TODAY);
    expect(r).toEqual({
      ok: false,
      errors: { requestId: "invalid", fullName: "required", phone: "invalid", firstVisitDate: "invalid" },
    });
    expect(parsePersonCreate({ ...base, fullName: "a".repeat(121) }, TODAY)).toMatchObject({ ok: false, errors: { fullName: "too_long" } });
    expect(parsePersonCreate({ ...base, visitNote: "a".repeat(MEMBERS_LIMITS.note + 1) }, TODAY)).toMatchObject({ ok: false, errors: { visitNote: "too_long" } });
    expect(parsePersonCreate({ ...base, invitedBy: "a".repeat(81) }, TODAY)).toMatchObject({ ok: false, errors: { invitedBy: "too_long" } });
    expect(parsePersonCreate({ ...base, arrivalSource: "tiktok" }, TODAY)).toMatchObject({ ok: false, errors: { arrivalSource: "invalid" } });
    expect(parsePersonCreate({ ...base, followUpOwnerUid: "a/b" }, TODAY)).toMatchObject({ ok: false, errors: { followUpOwnerUid: "invalid" } });
  });

  it("fecha de primera visita: no futura ni de hace más de un año", () => {
    expect(parsePersonCreate({ ...base, firstVisitDate: "2026-10-08" }, TODAY)).toMatchObject({ ok: false, errors: { firstVisitDate: "future_date" } });
    expect(parsePersonCreate({ ...base, firstVisitDate: "2025-10-06" }, TODAY)).toMatchObject({ ok: false, errors: { firstVisitDate: "too_old" } });
    expect(parsePersonCreate({ ...base, firstVisitDate: TODAY }, TODAY).ok).toBe(true);
  });

  it("rechaza caracteres de control e invisibles de dirección de texto (A-05)", () => {
    for (const bad of ["Ana\u0000", "Ana\u202Eorev", "Ana\u2066x", "x\u007F"])
      expect(parsePersonCreate({ ...base, fullName: bad }, TODAY)).toMatchObject({ ok: false, errors: { fullName: "invalid" } });
    expect(parsePersonCreate({ ...base, visitNote: "línea 1\nlínea 2" }, TODAY).ok).toBe(true);
    expect(parsePersonCreate({ ...base, visitNote: "x\u202Ey" }, TODAY)).toMatchObject({ ok: false, errors: { visitNote: "invalid" } });
  });

  it("no acepta arrays, null ni prototipos raros", () => {
    expect(parsePersonCreate([base], TODAY).ok).toBe(false);
    expect(parsePersonCreate(null, TODAY).ok).toBe(false);
    expect(parsePersonCreate(Object.create({ fullName: "x" }), TODAY).ok).toBe(false);
  });

  it("payload excesivo (#41)", () => {
    expect(payloadTooLarge({ ...base, visitNote: "a".repeat(5000) })).toBe(true);
    expect(payloadTooLarge(base)).toBe(false);
  });
});

describe("parsePersonUpdate", () => {
  it("solo las claves presentes; null borra opcionales; nada → error", () => {
    expect(parsePersonUpdate({ personId: "p1", expectedRevision: 3, email: null, doNotContact: true })).toEqual({
      ok: true,
      value: { personId: "p1", expectedRevision: 3, patch: { email: null, doNotContact: true } },
    });
    expect(parsePersonUpdate({ personId: "p1", expectedRevision: 3 })).toMatchObject({ ok: false, errors: { _: "required" } });
    expect(parsePersonUpdate({ personId: "p1", expectedRevision: 0, fullName: "x" })).toMatchObject({ ok: false, errors: { expectedRevision: "invalid" } });
    expect(parsePersonUpdate({ personId: "p1", expectedRevision: 1, phone: "" })).toMatchObject({ ok: false, errors: { phone: "required" } });
    expect(parsePersonUpdate({ personId: "p1", expectedRevision: 1, lifecycleStage: "integrante" })).toMatchObject({ ok: false, errors: { lifecycleStage: "unknown_field" } });
    expect(parsePersonUpdate({ personId: "p1", expectedRevision: 1, doNotContact: "true" })).toMatchObject({ ok: false, errors: { doNotContact: "invalid" } });
  });
});

describe("parseStatusChange (#32, #34)", () => {
  const b = { personId: "p1", expectedRevision: 2 };
  it("sin continuidad exige motivo; 'otro' exige texto", () => {
    expect(parseStatusChange({ ...b, status: "sin_continuidad" })).toMatchObject({ ok: false, errors: { closedReason: "required" } });
    expect(parseStatusChange({ ...b, status: "sin_continuidad", closedReason: "otro" })).toMatchObject({ ok: false, errors: { reasonNote: "required" } });
    expect(parseStatusChange({ ...b, status: "sin_continuidad", closedReason: "se_mudo" })).toMatchObject({ ok: true });
  });
  it("integrado exige confirmación explícita", () => {
    expect(parseStatusChange({ ...b, status: "integrado" })).toMatchObject({ ok: false, errors: { confirmIntegrated: "confirm_required" } });
    expect(parseStatusChange({ ...b, status: "integrado", confirmIntegrated: true })).toMatchObject({ ok: true });
  });
  it("motivo fuera de sin continuidad se rechaza", () => {
    expect(parseStatusChange({ ...b, status: "integrandose", closedReason: "se_mudo" })).toMatchObject({ ok: false, errors: { closedReason: "invalid" } });
  });
});

describe("parseVisitCreate y parseFollowUpCreate", () => {
  it("visita: fecha ≤ hoy, nota breve, actividad opcional", () => {
    expect(parseVisitCreate({ requestId: RID, personId: "p1", date: "2026-10-04", calendarEventId: "evt_1" }, TODAY)).toEqual({
      ok: true,
      value: { requestId: RID, personId: "p1", date: "2026-10-04", calendarEventId: "evt_1", note: null },
    });
    expect(parseVisitCreate({ requestId: RID, personId: "p1", date: "2026-10-09" }, TODAY)).toMatchObject({ ok: false, errors: { date: "future_date" } });
  });
  it("seguimiento: próxima acción y fecha van juntas y la fecha no es anterior al contacto (#27)", () => {
    const f = { requestId: RID, personId: "p1", contactDate: "2026-10-05", type: "llamada", result: "contactado" };
    expect(parseFollowUpCreate({ ...f, nextAction: "Invitar al culto" }, TODAY)).toMatchObject({ ok: false, errors: { nextActionDate: "pair_required" } });
    expect(parseFollowUpCreate({ ...f, nextActionDate: "2026-10-10" }, TODAY)).toMatchObject({ ok: false, errors: { nextAction: "pair_required" } });
    expect(parseFollowUpCreate({ ...f, nextAction: "x", nextActionDate: "2026-10-01" }, TODAY)).toMatchObject({ ok: false, errors: { nextActionDate: "before_contact" } });
    expect(parseFollowUpCreate({ ...f, type: "sms" }, TODAY)).toMatchObject({ ok: false, errors: { type: "invalid" } });
    expect(parseFollowUpCreate({ ...f, result: "convertido" }, TODAY)).toMatchObject({ ok: false, errors: { result: "invalid" } });
    expect(parseFollowUpCreate({ ...f, nextAction: "Invitar", nextActionDate: "2026-10-11", applyStatus: "en_seguimiento" }, TODAY)).toMatchObject({
      ok: true,
      value: { nextAction: "Invitar", nextActionDate: "2026-10-11", applyStatus: "en_seguimiento", applyDoNotContact: false, ownerUid: null },
    });
  });
});

describe("pipeline (#30–#35)", () => {
  const s = (consolidationStatus: PipelineState["consolidationStatus"], lifecycleStage: PipelineState["lifecycleStage"] = "en_consolidacion") => ({
    consolidationStatus,
    lifecycleStage,
  });
  it("avanzar y retroceder entre activos; integrar; cerrar", () => {
    expect(checkTransition(s("por_contactar"), "en_seguimiento")).toEqual({ ok: true });
    expect(checkTransition(s("en_seguimiento"), "integrandose")).toEqual({ ok: true });
    expect(checkTransition(s("integrandose"), "integrado")).toEqual({ ok: true });
    expect(checkTransition(s("integrandose"), "por_contactar")).toEqual({ ok: true });
    expect(checkTransition(s("en_seguimiento"), "sin_continuidad")).toEqual({ ok: true });
  });
  it("mismo estado, integrado cerrado y sin continuidad solo reabre a en seguimiento", () => {
    expect(checkTransition(s("en_seguimiento"), "en_seguimiento")).toEqual({ ok: false, reason: "same" });
    expect(checkTransition(s("integrado", "integrante"), "en_seguimiento")).toEqual({ ok: false, reason: "closed_integrated" });
    expect(checkTransition(s("sin_continuidad"), "en_seguimiento")).toEqual({ ok: true });
    expect(checkTransition(s("sin_continuidad"), "integrado")).toEqual({ ok: false, reason: "invalid" });
    expect(checkTransition(s("por_contactar"), "inventado" as never)).toEqual({ ok: false, reason: "invalid" });
  });
  it("integrado cambia la etapa a integrante (misma persona) (#33)", () => {
    expect(stageFor("integrado", "en_consolidacion")).toBe("integrante");
    expect(stageFor("integrandose", "en_consolidacion")).toBe("en_consolidacion");
  });
  it("sugerencias: primer contactado → en seguimiento; no desea contacto → cerrar + No contactar (#25)", () => {
    const p = { ...s("por_contactar"), doNotContact: false, firstContactDate: null };
    expect(suggestAfterFollowUp(p, "contactado")).toEqual({ status: "en_seguimiento", doNotContact: false, closedReason: null });
    expect(suggestAfterFollowUp({ ...p, firstContactDate: "2026-10-01" }, "contactado")).toEqual({ status: null, doNotContact: false, closedReason: null });
    expect(suggestAfterFollowUp({ ...p, consolidationStatus: "en_seguimiento" }, "contactado").status).toBeNull();
    expect(suggestAfterFollowUp(p, "sin_respuesta").status).toBeNull();
    expect(suggestAfterFollowUp(p, "no_desea_contacto")).toEqual({ status: "sin_continuidad", doNotContact: true, closedReason: "no_desea_contacto" });
    expect(suggestAfterFollowUp({ ...p, ...s("integrado", "integrante") }, "no_desea_contacto")).toEqual({ status: null, doNotContact: false, closedReason: null });
  });
  it("volver con el caso cerrado sugiere reabrir", () => {
    expect(suggestReopenOnVisit(s("sin_continuidad"))).toBe(true);
    expect(suggestReopenOnVisit(s("en_seguimiento"))).toBe(false);
  });
});

describe("proyección (#21, #27)", () => {
  it("visitas: cuenta, primera y última; una visita antigua no mueve la última", () => {
    let p = projectVisit(EMPTY_PROJECTION, "2026-09-20");
    p = projectVisit(p, "2026-10-04");
    p = projectVisit(p, "2026-09-27");
    expect(p).toMatchObject({ visitCount: 3, firstVisitDate: "2026-09-20", lastVisitDate: "2026-10-04" });
  });
  it("seguimientos: primer contacto, próxima acción vigente = la del último registrado", () => {
    let p = projectFollowUp(EMPTY_PROJECTION, { contactDate: "2026-10-05", result: "sin_respuesta", nextAction: "Reintentar", nextActionDate: "2026-10-06", ownerUid: "u1" });
    expect(p).toMatchObject({ followUpCount: 1, firstContactDate: null, nextAction: "Reintentar", nextActionOwnerUid: "u1" });
    p = projectFollowUp(p, { contactDate: "2026-10-06", result: "contactado", nextAction: null, nextActionDate: null, ownerUid: "u1" });
    expect(p).toMatchObject({ followUpCount: 2, firstContactDate: "2026-10-06", lastFollowUpDate: "2026-10-06", nextAction: null, nextActionDate: null, nextActionOwnerUid: null });
  });
  it("projectionOf tolera documentos incompletos", () => {
    expect(projectionOf(undefined)).toEqual(EMPTY_PROJECTION);
    expect(projectionOf({ visitCount: -1, lastVisitDate: "ayer", nextAction: "" })).toEqual(EMPTY_PROJECTION);
  });
});
