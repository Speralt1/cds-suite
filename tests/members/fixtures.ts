// Fixtures de Consolidación V1 para pruebas (sin datos reales).

import { EMPTY_PROJECTION, type PersonProjection } from "@/lib/shared/members";
import type { FollowUp, Person, PersonChange, Visit } from "@/lib/members/types";

export const TODAY = "2026-10-05";
export const NOW = "2026-10-05T12:00";

export function person(over: Partial<Omit<Person, "projection">> & { projection?: Partial<PersonProjection> } = {}): Person {
  const { projection, ...rest } = over;
  return {
    id: "p1",
    fullName: "Persona Prueba",
    phoneE164: "+56955550001",
    email: null,
    entryDate: "2026-10-01",
    firstVisitAt: "2026-10-01",
    arrivalSource: null,
    calendarEventId: null,
    invitedBy: null,
    lifecycleStage: "en_consolidacion",
    consolidationStatus: "en_seguimiento",
    closedReason: null,
    followUpOwnerUid: "u-owner",
    doNotContact: false,
    createdAt: "2026-10-01T10:00",
    createdBy: "u-owner",
    updatedAt: null,
    revision: 3,
    ...rest,
    projection: {
      ...EMPTY_PROJECTION,
      visitCount: 1,
      firstVisitDate: "2026-10-01",
      lastVisitDate: "2026-10-01",
      firstContactDate: "2026-10-02",
      followUpCount: 1,
      lastFollowUpDate: "2026-10-02",
      ...projection,
    },
  };
}

export function visit(over: Partial<Visit> = {}): Visit {
  return {
    id: "v1",
    personId: "p1",
    date: "2026-10-01",
    calendarEventId: null,
    note: null,
    firstVisit: false,
    createdAt: "2026-10-01T10:00",
    createdBy: "u-owner",
    ...over,
  };
}

export function followUp(over: Partial<FollowUp> = {}): FollowUp {
  return {
    id: "f1",
    personId: "p1",
    contactDate: "2026-10-02",
    type: "whatsapp",
    result: "contactado",
    note: null,
    nextAction: null,
    nextActionDate: null,
    ownerUid: null,
    createdAt: "2026-10-02T09:00",
    createdBy: "u-owner",
    ...over,
  };
}

export function change(over: Partial<PersonChange> = {}): PersonChange {
  return {
    id: "c1",
    personId: "p1",
    action: "status_changed",
    field: "consolidationStatus",
    from: "por_contactar",
    to: "en_seguimiento",
    changedFields: [],
    reason: null,
    reasonNote: null,
    refId: null,
    revision: 2,
    actorUid: "u-owner",
    at: "2026-10-02T09:01",
    ...over,
  };
}
