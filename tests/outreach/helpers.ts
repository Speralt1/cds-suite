// Utilidades de prueba para el dominio de «Ve por los tuyos». Datos 100 % ficticios.
import { EMPTY_FOLLOW_UP, type ConsentRecord, type Edition, type Registration } from "@/lib/outreach/model";
import { emptySyncState, type InboundRegistration, type SyncState } from "@/lib/outreach/sync";
import { SIM_EDITION, simRegistrations } from "@/lib/outreach/sim/fixtures";

export const NOW = "2026-11-29T19:00";
export const EVENT_DATE = "2026-11-29";

export const edition = (over: Partial<Edition> = {}): Edition => ({ ...SIM_EDITION, ...over });

export const consent = (purpose: ConsentRecord["purpose"], revokedAt: string | null = null): ConsentRecord => ({
  purpose,
  grantedAt: "2026-11-10T19:00",
  source: "formulario_web",
  textVersion: "web-2026-1",
  revokedAt,
});

export function reg(over: Partial<Registration> = {}): Registration {
  return {
    id: "vplt-2026_web_t1",
    editionId: "vplt-2026",
    identityId: null,
    source: "web",
    externalRef: null,
    fullName: "Persona Ficticia Uno",
    phoneE164: "+56900000001",
    email: null,
    invitedByName: null,
    status: "activa",
    duplicateOf: null,
    attendance: "sin_confirmar",
    attendanceAt: null,
    attendanceBy: null,
    consents: [consent("seguimiento_evento"), consent("mensajes_whatsapp"), consent("traspaso_consolidacion")],
    doNotContact: false,
    ownerUid: null,
    assignmentBatchId: null,
    locallyEdited: [],
    followUp: { ...EMPTY_FOLLOW_UP },
    memberPersonId: null,
    handedOffAt: null,
    createdAt: "2026-11-01T12:00",
    revision: 1,
    ...over,
  };
}

/** Convierte el padrón simulado en lo que enviaría el sitio público. */
export function inboundFromSim(count = 300): InboundRegistration[] {
  return simRegistrations({ count }).map((r) => ({
    externalId: r.externalRef!.id,
    sourceRevision: r.externalRef!.sourceRevision,
    editionYear: 2026,
    fullName: r.fullName,
    phone: r.phoneE164,
    email: r.email,
    invitedByName: r.invitedByName,
    adultConfirmed: true,
    consents: r.consents.map((c) => ({ purpose: c.purpose, textVersion: c.textVersion, grantedAt: c.grantedAt })),
    cancelled: false,
  }));
}

export function inbound(over: Partial<InboundRegistration> = {}): InboundRegistration {
  return {
    externalId: "x1",
    sourceRevision: 1,
    editionYear: 2026,
    fullName: "Persona Ficticia Uno",
    phone: "+56900000001",
    email: null,
    invitedByName: null,
    adultConfirmed: true,
    consents: [{ purpose: "seguimiento_evento", textVersion: "web-2026-1", grantedAt: "2026-11-10T19:00" }],
    cancelled: false,
    ...over,
  };
}

export const freshState = (): SyncState => emptySyncState("vplt-2026");
