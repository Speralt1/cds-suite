// Sincronización entrante desde el sistema público de inscripciones (doc 40 §7).
//
// Dirección única: sitio público → CDS. CDS nunca escribe en el sitio.
// El adaptador del sitio traduce sus documentos a `InboundRegistration` (este
// contrato es de CDS; los campos reales del sitio se mapean en el adaptador).
//
// Garantías (verificadas por tests/outreach):
// - Idempotencia por (system, externalId) + sourceRevision monótona: repetir un
//   lote, o reanudar desde un cursor viejo, no crea ni duplica nada.
// - El cursor solo avanza hasta el último registro APLICADO o ENVIADO A REVISIÓN;
//   un corte a mitad de lote se reanuda desde ahí sin perder registros.
// - Nunca fusiona personas sola: un posible duplicado entra como inscripción
//   nueva marcada para revisión.
// - Lo editado en CDS no lo pisa la web: se informa como conflicto.
// - Una cancelación web no borra: deja la inscripción «cancelada»; si la persona
//   ya asistió, va a revisión.

import { nameSimilarity } from "./names";
import { normalizeEmail, normalizePhone } from "./members";
import { EDITION_ID_RE, EMPTY_FOLLOW_UP, type ConsentRecord, type Registration } from "./outreach-model";

export interface InboundRegistration {
  externalId: string;
  /** Monótona en la fuente (p. ej. milisegundos de updatedAt o contador). */
  sourceRevision: number;
  /** Año de la edición según la fuente; se valida contra la edición abierta. */
  editionYear: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  invitedByName: string | null;
  adultConfirmed: boolean;
  /** Autorizaciones marcadas en el formulario, con la versión del texto mostrado. */
  consents: { purpose: ConsentRecord["purpose"]; textVersion: string; grantedAt: string }[];
  cancelled: boolean;
  /** Check-in en la puerta en el sitio público (origen); null/ausente si no ha ocurrido. */
  attendedAt?: string | null;
}

export type InboundIssue =
  | "edicion_no_coincide"
  | "edicion_cerrada"
  | "nombre_requerido"
  | "telefono_invalido"
  | "correo_invalido"
  | "posible_duplicado"
  | "conflicto_edicion_local"
  | "cancelada_con_asistencia"
  | "asistencia_revertida_en_origen";

export interface ReviewItem {
  externalId: string;
  sourceRevision: number;
  issue: InboundIssue;
  registrationId: string | null;
  /** Otras inscripciones parecidas (solo ids). */
  candidates: string[];
}

export interface SyncState {
  editionId: string;
  editionClosed: boolean;
  registrations: Registration[];
  /** (externalId → última sourceRevision procesada), incluida la enviada a revisión. */
  seen: Record<string, number>;
  /** Mayor sourceRevision procesada en orden; la fuente se pide «desde aquí». */
  cursor: number;
  review: ReviewItem[];
}

export interface SyncReport {
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  stale: number;
  toReview: number;
  /** Registros de menores (o sin confirmar adulto): se omiten sin guardar nada, ni siquiera en revisión. */
  skippedMinors: number;
  cursor: number;
}

/** Autor de la asistencia marcada en la puerta del sitio público. */
const WEB_ACTOR = "vplt-web";
const PUBLIC_FIELDS = ["fullName", "phoneE164", "email", "invitedByName"] as const;

function regIdFor(editionId: string, externalId: string): string {
  return `${editionId}_web_${externalId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80)}`;
}

function duplicateCandidates(state: SyncState, phone: string | null, email: string | null, name: string, selfId: string): string[] {
  return state.registrations
    .filter((r) => r.id !== selfId && r.status !== "duplicada")
    .filter(
      (r) =>
        (phone && r.phoneE164 === phone && nameSimilarity(r.fullName, name) >= 0.8) ||
        (email && r.email === email && nameSimilarity(r.fullName, name) >= 0.8),
    )
    .map((r) => r.id);
}

/**
 * Aplica un lote ordenado por sourceRevision. `failAfter` simula un corte
 * (proceso muerto) después de N registros, para las pruebas de reanudación.
 */
export function applyInbound(
  prev: SyncState,
  batch: readonly InboundRegistration[],
  ctx: { now: string; failAfter?: number },
): { state: SyncState; report: SyncReport; interrupted: boolean } {
  const state: SyncState = {
    ...prev,
    registrations: [...prev.registrations],
    seen: { ...prev.seen },
    review: [...prev.review],
  };
  const report: SyncReport = { created: 0, updated: 0, cancelled: 0, unchanged: 0, stale: 0, toReview: 0, skippedMinors: 0, cursor: prev.cursor };
  const sorted = [...batch].sort((a, b) => a.sourceRevision - b.sourceRevision);
  const year = Number(EDITION_ID_RE.exec(state.editionId)?.[1]);
  let processed = 0;

  const toReview = (rec: InboundRegistration, issue: InboundIssue, registrationId: string | null, candidates: string[] = []) => {
    // Una misma (externalId, revisión, motivo) entra una sola vez a revisión.
    if (!state.review.some((x) => x.externalId === rec.externalId && x.sourceRevision === rec.sourceRevision && x.issue === issue)) {
      state.review.push({ externalId: rec.externalId, sourceRevision: rec.sourceRevision, issue, registrationId, candidates });
      report.toReview++;
    }
  };

  for (const rec of sorted) {
    if (ctx.failAfter !== undefined && processed >= ctx.failAfter) {
      return { state, report: { ...report, cursor: state.cursor }, interrupted: true };
    }
    processed++;
    const last = state.seen[rec.externalId];
    const advance = () => {
      state.seen[rec.externalId] = rec.sourceRevision;
      state.cursor = Math.max(state.cursor, rec.sourceRevision);
    };
    if (last !== undefined && rec.sourceRevision <= last) {
      if (rec.sourceRevision === last) report.unchanged++;
      else report.stale++;
      continue;
    }
    if (state.editionClosed) {
      toReview(rec, "edicion_cerrada", null);
      advance();
      continue;
    }
    if (rec.editionYear !== year) {
      toReview(rec, "edicion_no_coincide", null);
      advance();
      continue;
    }
    if (!rec.adultConfirmed) {
      // CDS V1 es solo para adultos: no se guardan datos de menores ni en la cola de revisión.
      report.skippedMinors++;
      advance();
      continue;
    }
    const id = regIdFor(state.editionId, rec.externalId);
    const idx = state.registrations.findIndex((r) => r.id === id);
    const existing = idx >= 0 ? state.registrations[idx] : null;

    if (rec.cancelled) {
      if (existing && existing.status === "activa") {
        if (existing.attendance === "asistio") toReview(rec, "cancelada_con_asistencia", id);
        else {
          state.registrations[idx] = { ...existing, status: "cancelada", revision: existing.revision + 1 };
          report.cancelled++;
        }
      } else report.unchanged++;
      advance();
      continue;
    }

    const name = rec.fullName.trim().replace(/\s+/g, " ");
    if (!name) {
      toReview(rec, "nombre_requerido", existing?.id ?? null);
      advance();
      continue;
    }
    let phone: string | null = null;
    if (rec.phone?.trim()) {
      const p = normalizePhone(rec.phone);
      if (!p.ok) {
        toReview(rec, "telefono_invalido", existing?.id ?? null);
        advance();
        continue;
      }
      phone = p.e164;
    }
    let email: string | null = null;
    if (rec.email?.trim()) {
      const e = normalizeEmail(rec.email);
      if (!e.ok) {
        toReview(rec, "correo_invalido", existing?.id ?? null);
        advance();
        continue;
      }
      email = e.value;
    }
    const incoming = { fullName: name, phoneE164: phone, email, invitedByName: rec.invitedByName?.trim() || null };
    const consents: ConsentRecord[] = rec.consents.map((c) => ({
      purpose: c.purpose,
      grantedAt: c.grantedAt,
      source: "formulario_web",
      textVersion: c.textVersion,
      revokedAt: null,
    }));

    if (!existing) {
      const reg: Registration = {
        id,
        editionId: state.editionId,
        identityId: null,
        source: "web",
        externalRef: { system: "vplt-web", id: rec.externalId, sourceRevision: rec.sourceRevision },
        ...incoming,
        status: "activa",
        duplicateOf: null,
        attendance: rec.attendedAt ? "asistio" : "sin_confirmar",
        attendanceAt: rec.attendedAt ?? null,
        attendanceBy: rec.attendedAt ? WEB_ACTOR : null,
        consents,
        doNotContact: false,
        ownerUid: null,
        assignmentBatchId: null,
        locallyEdited: [],
        followUp: { ...EMPTY_FOLLOW_UP },
        memberPersonId: null,
        handedOffAt: null,
        createdAt: ctx.now,
        revision: 1,
      };
      state.registrations.push(reg);
      report.created++;
      const dups = duplicateCandidates(state, phone, email, name, id);
      if (dups.length) toReview(rec, "posible_duplicado", id, dups);
      advance();
      continue;
    }

    // Actualización: solo campos públicos que CDS no editó; nunca reabre una cancelada en CDS.
    const conflicts = PUBLIC_FIELDS.filter((f) => existing.locallyEdited.includes(f) && existing[f] !== incoming[f]);
    const next: Registration = { ...existing, externalRef: { system: "vplt-web", id: rec.externalId, sourceRevision: rec.sourceRevision } };
    let changed = false;
    for (const f of PUBLIC_FIELDS) {
      if (existing.locallyEdited.includes(f)) continue;
      if (existing[f] !== incoming[f]) {
        (next as unknown as Record<string, unknown>)[f] = incoming[f];
        changed = true;
      }
    }
    // Autorizaciones nuevas se agregan; una revocación hecha en CDS nunca se revierte desde la web.
    for (const c of consents) {
      if (!next.consents.some((x) => x.purpose === c.purpose)) {
        next.consents = [...next.consents, c];
        changed = true;
      }
    }
    // Asistencia en origen: solo «asistió» y solo si CDS aún no la marcó; nunca «no asistió» desde la web.
    if (rec.attendedAt && existing.attendance === "sin_confirmar") {
      next.attendance = "asistio";
      next.attendanceAt = rec.attendedAt;
      next.attendanceBy = WEB_ACTOR;
      changed = true;
    } else if (!rec.attendedAt && existing.attendance === "asistio" && existing.attendanceBy === WEB_ACTOR) {
      // Deshacer en la puerta del origen no revierte CDS: lo decide una persona.
      toReview(rec, "asistencia_revertida_en_origen", id);
    }
    if (conflicts.length) toReview(rec, "conflicto_edicion_local", id);
    if (changed) {
      next.revision = existing.revision + 1;
      state.registrations[idx] = next;
      report.updated++;
    } else {
      state.registrations[idx] = next;
      report.unchanged++;
    }
    advance();
  }
  return { state, report: { ...report, cursor: state.cursor }, interrupted: false };
}

export function emptySyncState(editionId: string): SyncState {
  return { editionId, editionClosed: false, registrations: [], seen: {}, cursor: 0, review: [] };
}
