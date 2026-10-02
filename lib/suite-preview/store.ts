// Store de la sesión de la preview: reducer PURO e inmutable sembrado desde las
// fixtures. Revalida permisos con el perfil del actor (`by`) en cada acción,
// igual que harán las reglas. Nada se borra: cancelar y archivar exigen motivo.

import { can, validateProfileChange } from "./access";
import { slugify, validateArea } from "./areas";
import { canArchiveEvent, canManageEvent, canManageSeries, isSeriesEnded, mergeEventPatch, validateEvent, validateSeriesPatch } from "./calendar";
import { DEMO_NOW } from "./clock";
import { DEFAULT_CONSOLIDATION_SETTINGS, FOLLOWUP_RESULT_LABEL, FOLLOWUP_TYPE_LABEL, isValidOwner, validatePerson } from "./consolidation";
import { compareLocal, dateOf } from "./dates";
import { AREAS, EVENTS, FOLLOWUPS, PERSONS, PERSON_CHANGES, SHARE_LINK, USERS, VISITS } from "./fixtures";
import { normalizeEmail, normalizePhone } from "./phone";
import { isOccurrenceDate, isRecurring } from "./recurrence";
import { nextPreviewToken } from "./share";
import type {
  AccessProfile,
  Area,
  AreaInput,
  CalendarEvent,
  ClosedReason,
  ConsolidationSettings,
  ConsolidationStatus,
  EventChange,
  EventChangeAction,
  EventInput,
  EventPatch,
  FollowUp,
  FollowUpInput,
  LocalDateTime,
  Person,
  PersonChange,
  PersonChangeField,
  PersonInput,
  PersonPatch,
  ShareLink,
  Visit,
  VisitInput,
  Ymd,
} from "./types";

export interface SuiteState {
  /** Contador para ids deterministas: "ev-new-1", "p-new-2", "v-new-3"… */
  seq: number;
  areas: Area[];
  users: AccessProfile[];
  events: CalendarEvent[];
  eventChanges: EventChange[];
  shareLink: ShareLink;
  /** Cantidad de regeneraciones/activaciones (elige el siguiente token demo). */
  shareRegenerations: number;
  persons: Person[];
  visits: Visit[];
  followUps: FollowUp[];
  personChanges: PersonChange[];
  settings: ConsolidationSettings;
}

export type SuiteAction =
  | { type: "event/create"; by: string; input: EventInput }
  | { type: "event/updateSeries"; by: string; id: string; patch: EventPatch }
  | { type: "event/cancel"; by: string; id: string; reason: string }
  | { type: "event/cancelOccurrence"; by: string; id: string; date: Ymd; reason: string }
  | { type: "event/cancelSeriesFrom"; by: string; id: string; reason: string }
  | { type: "event/archive"; by: string; id: string; reason: string }
  | { type: "share/regenerate"; by: string }
  | { type: "share/deactivate"; by: string }
  | { type: "share/activate"; by: string }
  | { type: "area/upsert"; by: string; area: AreaInput }
  | { type: "area/setActive"; by: string; id: string; active: boolean }
  | { type: "user/update"; by: string; profile: AccessProfile }
  | { type: "person/create"; by: string; input: PersonInput }
  | { type: "person/update"; by: string; personId: string; patch: PersonPatch }
  | { type: "visit/register"; by: string; input: VisitInput }
  | { type: "visit/void"; by: string; visitId: string; reason: string }
  | {
      type: "followup/register";
      by: string;
      input: FollowUpInput;
      /** Estado confirmado por quien guarda. Sin esto, el estado NO cambia. */
      confirmStatus?: ConsolidationStatus;
      confirmClosedReason?: ClosedReason;
      confirmDoNotContact?: boolean;
    }
  | {
      type: "person/changeStatus";
      by: string;
      personId: string;
      to: ConsolidationStatus;
      /** Obligatorio para Sin continuidad. */
      reason?: string;
      closedReason?: ClosedReason;
    }
  | { type: "person/assignOwner"; by: string; personId: string; ownerUid: string | null }
  | { type: "demo/reset" };

export type ActionResult =
  | { ok: true; state: SuiteState; /** Id de la entidad creada (event/create, person/create…). */ createdId?: string }
  | { ok: false; error: string; state: SuiteState };

/** Acción sin `by`: el provider la completa con el perfil simulado. */
export type SuiteActionInput = SuiteAction extends infer A ? (A extends { by: string } ? Omit<A, "by"> : A) : never;

export function initialSuiteState(): SuiteState {
  const clone = <T>(x: T): T => structuredClone(x);
  return {
    seq: 0,
    areas: clone([...AREAS]),
    users: clone([...USERS]),
    events: clone([...EVENTS]),
    eventChanges: [],
    shareLink: clone(SHARE_LINK),
    shareRegenerations: 0,
    persons: clone([...PERSONS]),
    visits: clone([...VISITS]),
    followUps: clone([...FOLLOWUPS]),
    personChanges: clone([...PERSON_CHANGES]),
    settings: { ...DEFAULT_CONSOLIDATION_SETTINGS },
  };
}

// ---------- helpers ----------

const fail = (state: SuiteState, error: string): ActionResult => ({ ok: false, error, state });

function nextId(s: SuiteState, prefix: string): [string, number] {
  const seq = s.seq + 1;
  return [`${prefix}-new-${seq}`, seq];
}

function validReason(reason: string | undefined): boolean {
  const r = (reason ?? "").trim();
  return r.length >= 3 && r.length <= 300;
}

const REASON_ERROR = "Escribe un motivo (entre 3 y 300 caracteres).";
const NO_PERMISSION = "Tu perfil no tiene permiso para esta acción.";
const ALREADY_MEMBER = "Esta persona ya está integrada; se gestiona desde Integrantes.";

function replace<T extends { id: string }>(list: readonly T[], item: T): T[] {
  return list.map((x) => (x.id === item.id ? item : x));
}

function eventChange(
  s: SuiteState,
  eventId: string,
  by: string,
  action: EventChangeAction,
  now: LocalDateTime,
  changedFields: string[] = [],
  date?: Ymd,
): { change: EventChange; seq: number } {
  const [id, seq] = nextId(s, "ec");
  return { change: { id, eventId, at: now, by, action, changedFields, ...(date ? { date } : {}) }, seq };
}

function personChange(
  seqBase: number,
  personId: string,
  by: string,
  now: LocalDateTime,
  field: PersonChangeField,
  from: string | null,
  to: string | null,
  reason?: string,
): PersonChange {
  return { id: `pc-new-${seqBase}`, personId, at: now, by, field, from, to, ...(reason ? { reason } : {}) };
}

function eventFromInput(id: string, input: EventInput, by: string, now: LocalDateTime): CalendarEvent {
  const allDay = !!input.allDay;
  return {
    id,
    title: input.title.trim(),
    responsibleAreaId: input.responsibleAreaId,
    participantAreaIds: [...(input.participantAreaIds ?? [])],
    startDate: input.startDate,
    endDate: input.endDate ?? input.startDate,
    allDay,
    ...(allDay ? {} : { startTime: input.startTime, ...(input.endTime ? { endTime: input.endTime } : {}) }),
    ...(input.location?.trim() ? { location: input.location.trim() } : {}),
    ...(input.publicDescription?.trim() ? { publicDescription: input.publicDescription.trim() } : {}),
    ...(input.internalNotes?.trim() ? { internalNotes: input.internalNotes.trim() } : {}),
    visibility: input.visibility ?? "team",
    status: "programada",
    recurrence: input.recurrence ? { ...input.recurrence } : { freq: "none" },
    exceptions: [],
    createdBy: by,
    createdAt: now,
    revision: 1,
  };
}

// ---------- reducer ----------

/** Aplica una acción sin mutar el estado. Re-valida permisos con el actor `by`. */
export function applyAction(s: SuiteState, a: SuiteAction, now: LocalDateTime = DEMO_NOW): ActionResult {
  if (a.type === "demo/reset") return { ok: true, state: initialSuiteState() };
  const actor = s.users.find((u) => u.uid === a.by);
  if (!actor || !actor.active) return fail(s, "Perfil de demostración no válido.");
  const today = dateOf(now);

  switch (a.type) {
    // ----- Calendario -----
    case "event/create": {
      if (!can(actor, "calendar.events.manage_assigned")) return fail(s, NO_PERMISSION);
      const errors = validateEvent(a.input, { profile: actor, areas: s.areas, today });
      const first = Object.values(errors)[0];
      if (first) return fail(s, first);
      const [id, seq] = nextId(s, "ev");
      const event = eventFromInput(id, a.input, actor.uid, now);
      const s1 = { ...s, seq };
      const { change, seq: seq2 } = eventChange(s1, id, actor.uid, "created", now);
      return { ok: true, createdId: id, state: { ...s1, seq: seq2, events: [...s.events, event], eventChanges: [...s.eventChanges, change] } };
    }
    case "event/updateSeries": {
      const e = s.events.find((x) => x.id === a.id);
      if (!e) return fail(s, "La actividad no existe.");
      const allowed = isRecurring(e) ? canManageSeries(actor, e, s.areas, today) : canManageEvent(actor, e, s.areas, today);
      if (!allowed) return fail(s, NO_PERMISSION);
      const errors = validateSeriesPatch(e, a.patch, { profile: actor, areas: s.areas, today });
      const first = Object.values(errors)[0];
      if (first) return fail(s, first);
      const merged = mergeEventPatch(e, a.patch);
      const next: CalendarEvent = {
        ...eventFromInput(e.id, merged, e.createdBy, e.createdAt),
        status: e.status,
        exceptions: e.exceptions,
        ...(e.seriesCancellation ? { seriesCancellation: e.seriesCancellation } : {}),
        ...(e.cancelReason ? { cancelledBy: e.cancelledBy, cancelledAt: e.cancelledAt, cancelReason: e.cancelReason } : {}),
        createdBy: e.createdBy,
        createdAt: e.createdAt,
        updatedBy: actor.uid,
        updatedAt: now,
        revision: e.revision + 1,
      };
      const changed = (Object.keys(a.patch) as (keyof EventPatch)[]).filter(
        (k) => JSON.stringify(a.patch[k]) !== JSON.stringify((e as unknown as Record<string, unknown>)[k]),
      );
      const { change, seq } = eventChange(s, e.id, actor.uid, "updated", now, changed);
      return { ok: true, state: { ...s, seq, events: replace(s.events, next), eventChanges: [...s.eventChanges, change] } };
    }
    case "event/cancel": {
      const e = s.events.find((x) => x.id === a.id);
      if (!e) return fail(s, "La actividad no existe.");
      if (isRecurring(e)) return fail(s, "En una serie, cancela solo una fecha o la serie desde hoy.");
      if (e.status !== "programada") return fail(s, "Solo se puede cancelar una actividad programada.");
      if (compareLocal(e.endDate, today) < 0) return fail(s, "No se puede cancelar una actividad pasada.");
      if (!canManageEvent(actor, e, s.areas, today)) return fail(s, NO_PERMISSION);
      if (!validReason(a.reason)) return fail(s, REASON_ERROR);
      const next: CalendarEvent = {
        ...e,
        status: "cancelada",
        cancelledBy: actor.uid,
        cancelledAt: now,
        cancelReason: a.reason.trim(),
        revision: e.revision + 1,
      };
      const { change, seq } = eventChange(s, e.id, actor.uid, "cancelled", now, ["status"]);
      return { ok: true, state: { ...s, seq, events: replace(s.events, next), eventChanges: [...s.eventChanges, change] } };
    }
    case "event/cancelOccurrence": {
      const e = s.events.find((x) => x.id === a.id);
      if (!e) return fail(s, "La actividad no existe.");
      if (!isRecurring(e)) return fail(s, "Esta actividad no se repite.");
      if (compareLocal(a.date, today) < 0) return fail(s, "No se puede cancelar una fecha pasada.");
      if (!isOccurrenceDate(e, a.date)) return fail(s, "Esa fecha no pertenece a la serie.");
      if (e.exceptions.some((x) => x.date === a.date)) return fail(s, "Esa fecha ya está cancelada.");
      if (!canManageEvent(actor, e, s.areas, today, a.date)) return fail(s, NO_PERMISSION);
      if (!validReason(a.reason)) return fail(s, REASON_ERROR);
      const next: CalendarEvent = {
        ...e,
        exceptions: [...e.exceptions, { date: a.date, type: "cancelled", reason: a.reason.trim(), by: actor.uid, at: now }],
        revision: e.revision + 1,
      };
      const { change, seq } = eventChange(s, e.id, actor.uid, "cancelled_occurrence", now, ["exceptions"], a.date);
      return { ok: true, state: { ...s, seq, events: replace(s.events, next), eventChanges: [...s.eventChanges, change] } };
    }
    case "event/cancelSeriesFrom": {
      const e = s.events.find((x) => x.id === a.id);
      if (!e) return fail(s, "La actividad no existe.");
      if (!isRecurring(e)) return fail(s, "Esta actividad no se repite.");
      if (e.seriesCancellation) return fail(s, "La serie ya está cancelada.");
      if (isSeriesEnded(e, today)) return fail(s, "La serie ya terminó: no quedan fechas por cancelar.");
      if (!canManageSeries(actor, e, s.areas, today)) return fail(s, NO_PERMISSION);
      if (!validReason(a.reason)) return fail(s, REASON_ERROR);
      const next: CalendarEvent = {
        ...e,
        seriesCancellation: { from: today, reason: a.reason.trim(), by: actor.uid, at: now },
        revision: e.revision + 1,
      };
      const { change, seq } = eventChange(s, e.id, actor.uid, "cancelled_series", now, ["seriesCancellation"], today);
      return { ok: true, state: { ...s, seq, events: replace(s.events, next), eventChanges: [...s.eventChanges, change] } };
    }
    case "event/archive": {
      const e = s.events.find((x) => x.id === a.id);
      if (!e) return fail(s, "La actividad no existe.");
      if (!canArchiveEvent(actor, e, s.areas, today)) return fail(s, NO_PERMISSION);
      if (!validReason(a.reason)) return fail(s, REASON_ERROR);
      const next: CalendarEvent = {
        ...e,
        status: "archivada",
        archivedBy: actor.uid,
        archivedAt: now,
        archiveReason: a.reason.trim(),
        revision: e.revision + 1,
      };
      const { change, seq } = eventChange(s, e.id, actor.uid, "archived", now, ["status"]);
      return { ok: true, state: { ...s, seq, events: replace(s.events, next), eventChanges: [...s.eventChanges, change] } };
    }
    case "share/regenerate":
    case "share/activate": {
      if (!can(actor, "calendar.events.manage_all")) return fail(s, NO_PERMISSION);
      if (a.type === "share/activate" && s.shareLink.active) return fail(s, "El enlace ya está activo.");
      // Regenerar y reactivar generan SIEMPRE un enlace nuevo: el anterior deja de funcionar.
      const shareLink: ShareLink = {
        ...s.shareLink,
        token: nextPreviewToken(s.shareRegenerations),
        active: true,
        regeneratedAt: now,
        regeneratedBy: actor.uid,
      };
      return { ok: true, state: { ...s, shareLink, shareRegenerations: s.shareRegenerations + 1 } };
    }
    case "share/deactivate": {
      if (!can(actor, "calendar.events.manage_all")) return fail(s, NO_PERMISSION);
      if (!s.shareLink.active) return fail(s, "El enlace ya está desactivado.");
      return { ok: true, state: { ...s, shareLink: { ...s.shareLink, active: false, deactivatedAt: now, deactivatedBy: actor.uid } } };
    }

    // ----- Configuración -----
    case "area/upsert": {
      if (!can(actor, "settings.manage")) return fail(s, NO_PERMISSION);
      const errors = validateArea(a.area, s.areas);
      const first = Object.values(errors)[0];
      if (first) return fail(s, first);
      if (a.area.id) {
        const cur = s.areas.find((x) => x.id === a.area.id);
        if (!cur) return fail(s, "El área no existe.");
        const next: Area = {
          ...cur,
          name: a.area.name.trim(),
          color: a.area.color,
          ...(a.area.description?.trim() ? { description: a.area.description.trim() } : { description: undefined }),
          active: a.area.active ?? cur.active,
        };
        return { ok: true, state: { ...s, areas: replace(s.areas, next) } };
      }
      const base = slugify(a.area.name) || "area";
      let id = base;
      for (let i = 2; s.areas.some((x) => x.id === id); i++) id = `${base}-${i}`;
      const area: Area = {
        id,
        name: a.area.name.trim(),
        color: a.area.color,
        ...(a.area.description?.trim() ? { description: a.area.description.trim() } : {}),
        active: a.area.active ?? true,
        order: Math.max(0, ...s.areas.map((x) => x.order)) + 1,
      };
      return { ok: true, createdId: id, state: { ...s, areas: [...s.areas, area] } };
    }
    case "area/setActive": {
      if (!can(actor, "settings.manage")) return fail(s, NO_PERMISSION);
      const cur = s.areas.find((x) => x.id === a.id);
      if (!cur) return fail(s, "El área no existe.");
      if (a.active && s.areas.some((x) => x.active && x.id !== cur.id && x.color === cur.color))
        return fail(s, "Su color ya lo usa otra área activa. Cambia el color antes de activarla.");
      return { ok: true, state: { ...s, areas: replace(s.areas, { ...cur, active: a.active }) } };
    }
    case "user/update": {
      if (!can(actor, "settings.manage")) return fail(s, NO_PERMISSION);
      if (!s.users.some((u) => u.uid === a.profile.uid)) return fail(s, "El usuario no existe.");
      const { errors } = validateProfileChange(actor.uid, s.users, a.profile, s.areas);
      if (errors.length) return fail(s, errors[0]);
      const users = s.users.map((u) => (u.uid === a.profile.uid ? structuredClone(a.profile) : u));
      return { ok: true, state: { ...s, users } };
    }

    // ----- Consolidación -----
    case "person/create": {
      if (!can(actor, "members.consolidation.manage")) return fail(s, NO_PERMISSION);
      const errors = validatePerson(a.input, today);
      const first = Object.values(errors)[0];
      if (first) return fail(s, first);
      if (a.input.followUpOwnerUid && !isValidOwner(a.input.followUpOwnerUid, s.users))
        return fail(s, "El responsable debe tener acceso a Consolidación.");
      const phone = normalizePhone(a.input.phone);
      if (!phone.ok) return fail(s, "Teléfono no válido.");
      const email = a.input.email ? normalizeEmail(a.input.email) : null;
      const [id, seq] = nextId(s, "p");
      const person: Person = {
        id,
        fullName: a.input.fullName.trim(),
        phoneE164: phone.e164,
        phoneRaw: a.input.phone.trim(),
        ...(email?.ok ? { email: email.value } : {}),
        ...(a.input.birthDate ? { birthDate: a.input.birthDate } : {}),
        faithConfession: a.input.faithConfession ?? "sin_informacion",
        baptized: a.input.baptized ?? "sin_informacion",
        entryDate: today,
        createdAt: now,
        createdBy: actor.uid,
        ...(a.input.initialNotes?.trim() ? { initialNotes: a.input.initialNotes.trim() } : {}),
        followUpOwnerUid: a.input.followUpOwnerUid ?? null,
        lifecycleStage: "en_consolidacion",
        consolidationStatus: "por_contactar",
        doNotContact: false,
        revision: 1,
      };
      const vSeq = seq + 1;
      const visit: Visit = {
        id: `v-new-${vSeq}`,
        personId: id,
        date: today,
        ...(a.input.arrivedEventId ? { activityEventId: a.input.arrivedEventId } : {}),
        ...(a.input.arrivedLabel ? { activityLabel: a.input.arrivedLabel } : {}),
        voided: false,
        createdBy: actor.uid,
        createdAt: now,
      };
      return {
        ok: true,
        createdId: id,
        state: { ...s, seq: vSeq, persons: [...s.persons, person], visits: [...s.visits, visit] },
      };
    }
    case "person/update": {
      if (!can(actor, "members.consolidation.manage")) return fail(s, NO_PERMISSION);
      const p = s.persons.find((x) => x.id === a.personId);
      if (!p) return fail(s, "La persona no existe.");
      if (p.lifecycleStage === "integrante") return fail(s, ALREADY_MEMBER);
      const patch = a.patch;
      const errors = validatePerson(
        {
          fullName: patch.fullName ?? p.fullName,
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.email ? { email: patch.email } : {}),
          ...(patch.birthDate ? { birthDate: patch.birthDate } : {}),
          initialNotes: patch.initialNotes ?? p.initialNotes,
        },
        today,
      );
      const first = Object.values(errors)[0];
      if (first) return fail(s, first);
      let next: Person = { ...p, revision: p.revision + 1 };
      if (patch.fullName !== undefined) next.fullName = patch.fullName.trim();
      if (patch.phone !== undefined) {
        const phone = normalizePhone(patch.phone);
        if (!phone.ok) return fail(s, "Teléfono no válido.");
        next = { ...next, phoneE164: phone.e164, phoneRaw: patch.phone.trim() };
      }
      if (patch.email !== undefined) {
        const email = patch.email ? normalizeEmail(patch.email) : null;
        next = { ...next, email: email?.ok ? email.value : undefined };
      }
      if (patch.birthDate !== undefined) next = { ...next, birthDate: patch.birthDate ?? undefined };
      if (patch.initialNotes !== undefined) next = { ...next, initialNotes: patch.initialNotes };
      if (patch.integrationAreaId !== undefined) next = { ...next, integrationAreaId: patch.integrationAreaId ?? undefined };
      let seq = s.seq;
      const changes: PersonChange[] = [];
      const track = (field: PersonChangeField, from: string, to: string) => {
        if (from === to) return;
        seq += 1;
        changes.push(personChange(seq, p.id, actor.uid, now, field, from, to));
      };
      if (patch.faithConfession) {
        track("faithConfession", p.faithConfession, patch.faithConfession);
        next = { ...next, faithConfession: patch.faithConfession };
      }
      if (patch.baptized) {
        track("baptized", p.baptized, patch.baptized);
        next = { ...next, baptized: patch.baptized };
      }
      if (patch.doNotContact !== undefined) {
        track("doNotContact", String(p.doNotContact), String(patch.doNotContact));
        next = { ...next, doNotContact: patch.doNotContact };
      }
      return { ok: true, state: { ...s, seq, persons: replace(s.persons, next), personChanges: [...s.personChanges, ...changes] } };
    }
    case "visit/register": {
      if (!can(actor, "members.consolidation.manage")) return fail(s, NO_PERMISSION);
      const p = s.persons.find((x) => x.id === a.input.personId);
      if (!p) return fail(s, "La persona no existe.");
      if (p.lifecycleStage === "integrante") return fail(s, ALREADY_MEMBER);
      if (compareLocal(a.input.date, today) > 0) return fail(s, "La visita no puede ser futura.");
      if ((a.input.note ?? "").length > 500) return fail(s, "La nota admite máximo 500 caracteres.");
      const [id, seq] = nextId(s, "v");
      const visit: Visit = {
        id,
        personId: p.id,
        date: a.input.date,
        ...(a.input.activityEventId ? { activityEventId: a.input.activityEventId } : {}),
        ...(a.input.activityLabel ? { activityLabel: a.input.activityLabel } : {}),
        ...(a.input.note?.trim() ? { note: a.input.note.trim() } : {}),
        voided: false,
        createdBy: actor.uid,
        createdAt: now,
      };
      // Agrega: nunca modifica visitas anteriores.
      return { ok: true, createdId: id, state: { ...s, seq, visits: [...s.visits, visit] } };
    }
    case "visit/void": {
      if (!can(actor, "members.consolidation.manage")) return fail(s, NO_PERMISSION);
      const v = s.visits.find((x) => x.id === a.visitId);
      if (!v) return fail(s, "La visita no existe.");
      if (v.voided) return fail(s, "La visita ya está anulada.");
      if (!validReason(a.reason)) return fail(s, REASON_ERROR);
      return {
        ok: true,
        state: { ...s, visits: replace(s.visits, { ...v, voided: true, voidReason: a.reason.trim(), voidedBy: actor.uid, voidedAt: now }) },
      };
    }
    case "followup/register": {
      if (!can(actor, "members.consolidation.manage")) return fail(s, NO_PERMISSION);
      const p = s.persons.find((x) => x.id === a.input.personId);
      if (!p) return fail(s, "La persona no existe.");
      if (p.lifecycleStage === "integrante") return fail(s, ALREADY_MEMBER);
      if (!Object.hasOwn(FOLLOWUP_TYPE_LABEL, a.input.type)) return fail(s, "Elige un tipo de seguimiento válido.");
      if (!Object.hasOwn(FOLLOWUP_RESULT_LABEL, a.input.result)) return fail(s, "Elige un resultado válido.");
      if (a.input.ownerUid && !isValidOwner(a.input.ownerUid, s.users)) return fail(s, "El responsable debe tener acceso a Consolidación.");
      const at = a.input.at ?? now;
      if (compareLocal(at, now) > 0) return fail(s, "El seguimiento no puede ser futuro.");
      if ((a.input.note ?? "").length > 1000) return fail(s, "La nota admite máximo 1.000 caracteres.");
      if ((a.input.nextAction ?? "").length > 200) return fail(s, "La próxima acción admite máximo 200 caracteres.");
      if (a.input.nextActionDate && compareLocal(a.input.nextActionDate, dateOf(at)) < 0)
        return fail(s, "La fecha de la próxima acción no puede ser anterior al seguimiento.");
      const ownerUid = a.input.ownerUid === undefined ? p.followUpOwnerUid : a.input.ownerUid;
      const [id, firstSeq] = nextId(s, "f");
      let seq = firstSeq;
      const followUp: FollowUp = {
        id,
        personId: p.id,
        at,
        type: a.input.type,
        result: a.input.result,
        ...(a.input.note?.trim() ? { note: a.input.note.trim() } : {}),
        ...(a.input.nextAction?.trim() ? { nextAction: a.input.nextAction.trim() } : {}),
        ...(a.input.nextActionDate ? { nextActionDate: a.input.nextActionDate } : {}),
        ownerUid: ownerUid ?? null,
        createdBy: actor.uid,
      };
      let next: Person = p;
      const changes: PersonChange[] = [];
      if (a.confirmDoNotContact !== undefined && a.confirmDoNotContact !== p.doNotContact) {
        seq += 1;
        changes.push(personChange(seq, p.id, actor.uid, now, "doNotContact", String(p.doNotContact), String(a.confirmDoNotContact)));
        next = { ...next, doNotContact: a.confirmDoNotContact };
      }
      // El estado SOLO cambia si quien guarda lo confirmó.
      if (a.confirmStatus && a.confirmStatus !== p.consolidationStatus) {
        const res = statusTransition(next, a.confirmStatus, actor.uid, now, seq, a.confirmClosedReason ? "Desde un seguimiento" : undefined, a.confirmClosedReason);
        if (!res.ok) return fail(s, res.error);
        next = res.person;
        seq = res.seq;
        changes.push(...res.changes);
      }
      if (next !== p) next = { ...next, revision: p.revision + 1 };
      return {
        ok: true,
        createdId: followUp.id,
        state: {
          ...s,
          seq,
          followUps: [...s.followUps, followUp],
          persons: next === p ? s.persons : replace(s.persons, next),
          personChanges: changes.length ? [...s.personChanges, ...changes] : s.personChanges,
        },
      };
    }
    case "person/changeStatus": {
      if (!can(actor, "members.consolidation.manage")) return fail(s, NO_PERMISSION);
      const p = s.persons.find((x) => x.id === a.personId);
      if (!p) return fail(s, "La persona no existe.");
      if (a.to === p.consolidationStatus) return fail(s, "La persona ya está en ese estado.");
      const res = statusTransition(p, a.to, actor.uid, now, s.seq, a.reason, a.closedReason);
      if (!res.ok) return fail(s, res.error);
      return {
        ok: true,
        state: {
          ...s,
          seq: res.seq,
          persons: replace(s.persons, { ...res.person, revision: p.revision + 1 }),
          personChanges: [...s.personChanges, ...res.changes],
        },
      };
    }
    case "person/assignOwner": {
      if (!can(actor, "members.consolidation.manage")) return fail(s, NO_PERMISSION);
      const p = s.persons.find((x) => x.id === a.personId);
      if (!p) return fail(s, "La persona no existe.");
      if (a.ownerUid && !isValidOwner(a.ownerUid, s.users)) return fail(s, "El responsable debe tener acceso a Consolidación.");
      if (a.ownerUid === p.followUpOwnerUid) return fail(s, "Ya es el responsable.");
      const seq = s.seq + 1;
      const change = personChange(seq, p.id, actor.uid, now, "owner", p.followUpOwnerUid, a.ownerUid);
      return {
        ok: true,
        state: {
          ...s,
          seq,
          persons: replace(s.persons, { ...p, followUpOwnerUid: a.ownerUid, revision: p.revision + 1 }),
          personChanges: [...s.personChanges, change],
        },
      };
    }
  }
}

/** Transición de estado con su(s) PersonChange. Integrado cambia la etapa. */
function statusTransition(
  p: Person,
  to: ConsolidationStatus,
  by: string,
  now: LocalDateTime,
  seqBase: number,
  reason?: string,
  closedReason?: ClosedReason,
): { ok: true; person: Person; changes: PersonChange[]; seq: number } | { ok: false; error: string } {
  if (p.lifecycleStage === "integrante") return { ok: false, error: "Reabrir a un integrante queda para el siguiente slice." };
  if (to === "sin_continuidad" && !closedReason && !validReason(reason))
    return { ok: false, error: "Elige o escribe el motivo de Sin continuidad." };
  let seq = seqBase + 1;
  const changes: PersonChange[] = [personChange(seq, p.id, by, now, "status", p.consolidationStatus, to, reason?.trim() || undefined)];
  let person: Person = { ...p, consolidationStatus: to };
  if (to === "sin_continuidad") person = { ...person, closedReason: closedReason ?? "otro" };
  else if (p.consolidationStatus === "sin_continuidad") person = { ...person, closedReason: undefined };
  if (to === "integrado") {
    seq += 1;
    changes.push(personChange(seq, p.id, by, now, "stage", p.lifecycleStage, "integrante"));
    person = { ...person, lifecycleStage: "integrante" };
  }
  return { ok: true, person, changes, seq };
}
