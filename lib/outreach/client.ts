"use client";

// «Ve por los tuyos» (doc 40/42) · cliente real: callables tipados + lecturas
// de Firestore. SOLO se usa desde el espacio de trabajo en vivo (detrás de
// NEXT_PUBLIC_CDS_OUTREACH_LIVE). El cliente NO escribe en Firestore: toda
// escritura pasa por los callables. Lecturas según el CONTRATO DE CONSULTA de
// firestore.rules: un responsable debe filtrar por assigneeUid + editionActive
// + editionId; coordinación basta con editionId. Mapeo tolerante como
// lib/members/client.ts: un campo faltante nunca rompe la pantalla.

import { collection, getDocs, limit as qLimit, query, where, type DocumentData } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions, getFirebaseServices } from "@/lib/firebase";
import { errorCode, errorKey } from "@/lib/calendar/errors";
import { newRequestId } from "@/lib/members/api";
import { toLocalDateTime } from "@/lib/members/client";
import {
  ATTENDANCE,
  EDITION_STATUSES,
  EMPTY_FOLLOW_UP,
  EVENT_CONTACT_RESULTS,
  DECISION_VALUES,
  REGISTRATION_SOURCES,
  REGISTRATION_STATUSES,
  type Attendance,
  type DecisionValue,
  type EditionStatus,
  type EventContactResult,
  type Registration,
} from "@/lib/shared/outreach-model";
import type { InboundRegistration } from "@/lib/shared/outreach-sync";

export { newRequestId };

// ---------- Errores ----------

export type OutreachErrorKind = "permission" | "conflict" | "network" | "not_found" | "closed" | "other";

export const OUTREACH_ERROR_TEXT: Readonly<Record<string, string>> = {
  "outreach/unauthenticated": "Tu sesión expiró. Vuelve a iniciar sesión.",
  "outreach/forbidden": "No tienes permiso para hacer esto. Si cambiaron tus permisos, recarga la página.",
  "outreach/invalid-argument": "Revisa los datos enviados.",
  "outreach/payload-too-large": "El archivo es demasiado grande. Divídelo e inténtalo de nuevo.",
  "outreach/not-found": "No encontramos lo que buscabas. Recarga la página.",
  "outreach/conflict": "Alguien cambió esto mientras trabajabas. Recarga para ver el estado actual.",
  "outreach/conflict:tope": "Superaría el tope de 20. Agrega una nota que lo justifique.",
  "outreach/request-reused": "Esta solicitud ya se usó con otros datos. Vuelve a abrir el formulario.",
  "outreach/edition-closed": "La edición está cerrada: solo se puede consultar.",
  "outreach/invalid-transition": "Ese cambio de etapa ya no es posible. Recarga para ver el estado actual.",
  "outreach/invalid-user": "Esa persona ya no está en el equipo. Elige otra.",
  "outreach/invalid-leader": "Solo un responsable activo del equipo puede encargarse de una mesa.",
  "outreach/not-assigned": "Esta persona ya no está asignada a ti. Recarga tu lista.",
  "outreach/link-unavailable": "La mesa todavía no tiene enlace.",
  "outreach/link-revoked": "El enlace de la mesa fue revocado.",
  "outreach/link-out-of-window": "El enlace solo funciona durante el evento.",
  "outreach/rate-limited": "Demasiados intentos seguidos. Espera unos minutos.",
  "outreach/internal": "Algo salió mal. Inténtalo de nuevo en unos minutos.",
  "outreach/pidio-no-contacto": "La persona pidió no ser contactada.",
  "outreach/no-contactable": "La persona no autorizó seguimiento.",
};
export const OUTREACH_NETWORK_TEXT = "No pudimos completar la acción. Revisa tu conexión e inténtalo de nuevo.";
export const OUTREACH_UNEXPECTED_TEXT = "Algo salió mal. Inténtalo de nuevo en unos minutos.";
const NETWORK_CODES = new Set(["unavailable", "deadline-exceeded", "network-request-failed", "cancelled", "resource-exhausted"]);

export class OutreachApiError extends Error {
  readonly key: string;
  readonly kind: OutreachErrorKind;
  constructor(key: string, kind: OutreachErrorKind, message: string) {
    super(message);
    this.name = "OutreachApiError";
    this.key = key;
    this.kind = kind;
  }
}

/** Cualquier error (callable o lectura) → OutreachApiError con mensaje en español; nunca códigos crudos. */
export function toOutreachError(error: unknown): OutreachApiError {
  if (error instanceof OutreachApiError) return error;
  const msg = errorKey(error);
  const code = errorCode(error);
  if (msg.startsWith("outreach/")) {
    const kind: OutreachErrorKind =
      msg === "outreach/forbidden" || msg === "outreach/unauthenticated" || msg === "outreach/not-assigned"
        ? "permission"
        : msg === "outreach/conflict"
          ? "conflict"
          : msg === "outreach/not-found"
            ? "not_found"
            : msg === "outreach/edition-closed"
              ? "closed"
              : "other";
    const details = (error as { details?: { reason?: unknown } } | null)?.details;
    const text = msg === "outreach/conflict" && details?.reason === "tope" ? OUTREACH_ERROR_TEXT["outreach/conflict:tope"] : OUTREACH_ERROR_TEXT[msg];
    return new OutreachApiError(msg, kind, text ?? OUTREACH_UNEXPECTED_TEXT);
  }
  if (NETWORK_CODES.has(code) || /network|offline/i.test(msg)) return new OutreachApiError("", "network", OUTREACH_NETWORK_TEXT);
  if (code === "permission-denied" || code === "unauthenticated")
    return new OutreachApiError("", "permission", OUTREACH_ERROR_TEXT["outreach/forbidden"]);
  return new OutreachApiError("", "other", OUTREACH_UNEXPECTED_TEXT);
}

// ---------- Callables ----------

type Group = "outreachCoordinatorOp" | "outreachFollowupOp" | "outreachDecisionOp";

async function call<T>(group: Group, op: string, payload: Record<string, unknown>): Promise<T> {
  try {
    const fn = httpsCallable<{ op: string; payload: Record<string, unknown> }, unknown>(getFirebaseFunctions(), group);
    const res = await fn({ op, payload });
    return (res.data ?? {}) as T;
  } catch (error) {
    throw toOutreachError(error);
  }
}
const coord = <T>(op: string, payload: Record<string, unknown>) => call<T>("outreachCoordinatorOp", op, payload);

type Raw = Record<string, unknown>;
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const rec = (v: unknown): Record<string, number> =>
  v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Raw).map(([k, n]) => [k, num(n)])) : {};

export interface EditionSummary {
  id: string;
  year: number;
  status: EditionStatus;
  revision: number;
  eventDate: string | null;
  title: string;
  maxPerOwner: number;
  editionActive: boolean;
  receptionOpen: boolean;
}

export function toEditionSummary(id: string, d: Raw | undefined): EditionSummary {
  const x = d ?? {};
  return {
    id,
    year: num(x.year, Number(/^vplt-(\d{4})$/.exec(id)?.[1] ?? 0)),
    status: (EDITION_STATUSES as readonly string[]).includes(x.status as string) ? (x.status as EditionStatus) : "preparacion",
    revision: Math.max(1, num(x.revision, 1)),
    eventDate: s(x.eventDate),
    title: s(x.title) ?? "Ve por los tuyos",
    maxPerOwner: num(x.maxPerOwner, 20),
    editionActive: x.editionActive === true,
    receptionOpen: x.receptionOpen === true,
  };
}

export const editionTransition = (editionId: string, to: EditionStatus, expectedRevision: number) =>
  coord<{ status?: string; revision?: number }>("editionTransition", { editionId, to, expectedRevision });

export interface ImportReport {
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  stale: number;
  toReview: number;
  skippedMinors: number;
}
export interface ImportResult {
  dryRun: boolean;
  rows: number;
  report: ImportReport;
  review: { issue: string; externalId: string }[];
  reviewTotal: number;
}
const REPORT_KEYS: (keyof ImportReport)[] = ["created", "updated", "cancelled", "unchanged", "stale", "toReview", "skippedMinors"];

/** El servidor admite hasta 1000 filas por llamada: se envía por lotes y se suman los informes. */
export const IMPORT_BATCH = 1000;

export async function importRegistrations(editionId: string, rows: InboundRegistration[], dryRun: boolean): Promise<ImportResult> {
  const total: ImportResult = {
    dryRun,
    rows: 0,
    report: { created: 0, updated: 0, cancelled: 0, unchanged: 0, stale: 0, toReview: 0, skippedMinors: 0 },
    review: [],
    reviewTotal: 0,
  };
  for (let i = 0; i === 0 || i < rows.length; i += IMPORT_BATCH) {
    const raw = await coord<Raw>("importRegistrations", { editionId, dryRun, rows: rows.slice(i, i + IMPORT_BATCH) });
    const rep = (raw.report ?? {}) as Raw;
    for (const k of REPORT_KEYS) total.report[k] += num(rep[k]);
    total.rows += num(raw.rows);
    total.reviewTotal += num(raw.reviewTotal);
    for (const r of arr(raw.review)) total.review.push({ issue: s(r.issue) ?? "otro", externalId: s(r.externalId) ?? "" });
  }
  return total;
}

export interface ReviewItem {
  id: string;
  issue: string;
  externalId: string | null;
  registrationId: string | null;
  candidates: string[];
  sourceRevision: number;
  createdAt: string | null;
}
export async function reviewList(editionId: string, limit = 100): Promise<ReviewItem[]> {
  const raw = await coord<Raw>("reviewList", { editionId, limit });
  return arr(raw.items).map((i) => ({
    id: s(i.id) ?? "",
    issue: s(i.issue) ?? "otro",
    externalId: s(i.externalId),
    registrationId: s(i.registrationId),
    candidates: (Array.isArray(i.candidates) ? i.candidates : []).filter((c): c is string => typeof c === "string"),
    sourceRevision: num(i.sourceRevision),
    createdAt: toLocalDateTime(i.createdAt),
  }));
}
export type ReviewResolution = "dismiss" | "keep_both" | "mark_duplicate";
export const reviewResolve = (p: {
  editionId: string;
  reviewId: string;
  resolution: ReviewResolution;
  targetRegistrationId?: string;
  note?: string;
  requestId: string;
}) => coord<{ replay?: boolean }>("reviewResolve", p);

export interface TeamCandidate {
  uid: string;
  displayName: string;
}
export async function teamCandidates(editionId: string): Promise<TeamCandidate[]> {
  const raw = await coord<Raw>("teamCandidates", { editionId });
  return arr(raw.candidates).flatMap((i) => {
    const uid = s(i.uid);
    return uid ? [{ uid, displayName: s(i.displayName) ?? "Usuario sin nombre" }] : [];
  });
}

export interface TableInfo {
  number: number;
  leaderUid: string | null;
  leaderName: string | null;
  hasLink: boolean;
  linkRevoked: boolean;
  linkIssuedAt: string | null;
}
export async function tablesList(editionId: string): Promise<TableInfo[]> {
  const raw = await coord<Raw>("tablesList", { editionId });
  return arr(raw.tables)
    .map((i) => ({
      number: num(i.number),
      leaderUid: s(i.leaderUid),
      leaderName: s(i.leaderName),
      hasLink: i.hasLink === true,
      linkRevoked: i.linkRevoked === true,
      linkIssuedAt: toLocalDateTime(i.linkIssuedAt) ?? s(i.linkIssuedAt),
    }))
    .filter((t) => t.number > 0)
    .sort((a, b) => a.number - b.number);
}
export const tablesSet = (editionId: string, tables: { number: number; leaderUid?: string }[]) =>
  coord<{ count?: number }>("tablesSet", { editionId, tables });

/** Enlace de mesa: `/mesa#<edición>.<mesa>.<token>`; el fragmento nunca viaja al servidor. */
export function tableLinkUrl(origin: string, editionId: string, table: number, token: string): string {
  return `${origin.replace(/\/+$/, "")}/mesa#${editionId}.${table}.${token}`;
}
export async function tableLinkIssue(
  editionId: string,
  number: number,
): Promise<{ token: string; window: { opensAt: string; closesAt: string } | null }> {
  const raw = await coord<Raw>("tableLinkIssue", { editionId, number });
  const w = raw.window as { opensAt?: unknown; closesAt?: unknown } | null | undefined;
  return {
    token: typeof raw.token === "string" ? raw.token : "",
    window: w && typeof w.opensAt === "string" && typeof w.closesAt === "string" ? { opensAt: w.opensAt, closesAt: w.closesAt } : null,
  };
}
export const tableLinkRevoke = (editionId: string, number: number) => coord<{ revoked?: boolean }>("tableLinkRevoke", { editionId, number });

export const confirmAbsences = (editionId: string, ids: string[], expectedUnknownCount: number) =>
  coord<{ confirmed: number; unchanged: number; skipped: unknown[] }>("confirmAbsences", { editionId, ids, expectedUnknownCount });

export interface Proposal {
  batchId: string;
  assignments: { registrationId: string; ownerUid: string; reason: string }[];
  unassigned: { registrationId: string; reason: string }[];
  summary: { assignments: number; unassigned: number; excluded: Record<string, number>; loads: Record<string, number>; caps: Record<string, number> };
}
export async function distributionPropose(editionId: string, requestId: string, includeUnconfirmed = false): Promise<Proposal> {
  const raw = await coord<Raw>("distributionPropose", { editionId, requestId, includeUnconfirmed });
  const sum = (raw.summary ?? {}) as Raw;
  return {
    batchId: s(raw.batchId) ?? "",
    assignments: arr(raw.assignments).map((a) => ({ registrationId: s(a.registrationId) ?? "", ownerUid: s(a.ownerUid) ?? "", reason: s(a.reason) ?? "" })),
    unassigned: arr(raw.unassigned).map((a) => ({ registrationId: s(a.registrationId) ?? "", reason: s(a.reason) ?? "" })),
    summary: { assignments: num(sum.assignments), unassigned: num(sum.unassigned), excluded: rec(sum.excluded), loads: rec(sum.loads), caps: rec(sum.caps) },
  };
}
export interface BatchOutcome {
  batchId: string;
  applied: number;
  alreadyApplied: number;
  conflicts: { registrationId: string; reason: string }[];
}
/** `notes`: justificación de coordinación (≤200 car.) por persona para superar el tope de 20. */
export async function distributionConfirm(
  editionId: string,
  batchId: string,
  notes?: { registrationId: string; note: string }[],
): Promise<BatchOutcome> {
  const raw = await coord<Raw>("distributionConfirm", { editionId, batchId, ...(notes && notes.length ? { notes } : {}) });
  const count = (v: unknown) => (Array.isArray(v) ? v.length : num(v));
  return {
    batchId: s(raw.batchId) ?? batchId,
    applied: count(raw.applied),
    alreadyApplied: count(raw.alreadyApplied),
    conflicts: arr(raw.conflicts).map((c) => ({ registrationId: s(c.registrationId) ?? "", reason: s(c.reason) ?? "" })),
  };
}

export interface OutreachStats {
  edition: EditionSummary;
  metrics: Record<string, number>;
  tables: { number: number; leaderName: string | null; people: number }[];
  review: { total: number; byIssue: Record<string, number> };
  decisions: { summary: Record<string, number>; suppressedBelow: number } | null;
}
export async function stats(editionId: string): Promise<OutreachStats> {
  const raw = await coord<Raw>("stats", { editionId });
  const rev = (raw.review ?? {}) as Raw;
  const dec = raw.decisions as { summary?: unknown; suppressedBelow?: unknown } | undefined;
  const metrics: Record<string, number> = {};
  for (const [k, v] of Object.entries((raw.metrics ?? {}) as Raw)) if (typeof v === "number") metrics[k] = v;
  return {
    edition: toEditionSummary(editionId, raw.edition as Raw | undefined),
    metrics,
    tables: arr(raw.tables).map((t) => ({ number: num(t.number), leaderName: s(t.leaderName), people: num(t.people) })),
    review: { total: num(rev.total), byIssue: rec(rev.byIssue) },
    decisions: dec ? { summary: rec(dec.summary), suppressedBelow: num(dec.suppressedBelow, 5) } : null,
  };
}

export interface ContactInput {
  editionId: string;
  registrationId: string;
  requestId: string;
  date: string;
  channel: "whatsapp" | "llamada" | "presencial";
  result: EventContactResult;
  nextAction?: string;
  nextActionDate?: string;
}
export const contactRecord = (p: ContactInput) =>
  call<{ contactId?: string; optedOut?: boolean }>("outreachFollowupOp", "contactRecord", { ...p });
export const doNotContactSet = (p: { editionId: string; registrationId: string; value: boolean; reason?: string }) =>
  call<{ revision?: number }>("outreachFollowupOp", "doNotContactSet", { ...p });

export interface DecisionRow {
  registrationId: string;
  fullName: string | null;
  value: DecisionValue;
  tableNumber: number | null;
  recordedAt: string | null;
}
const isDecision = (v: unknown): v is DecisionValue => (DECISION_VALUES as readonly string[]).includes(v as string);

export async function decisionList(editionId: string, cursor?: string): Promise<{ rows: DecisionRow[]; nextCursor: string | null }> {
  const raw = await call<Raw>("outreachDecisionOp", "decisionList", { editionId, ...(cursor ? { cursor } : {}) });
  return {
    rows: arr(raw.rows).flatMap((r) =>
      isDecision(r.value)
        ? [
            {
              registrationId: s(r.registrationId) ?? "",
              fullName: s(r.fullName),
              value: r.value,
              tableNumber: typeof r.tableNumber === "number" ? r.tableNumber : null,
              recordedAt: toLocalDateTime(r.recordedAt) ?? s(r.recordedAt),
            },
          ]
        : [],
    ),
    nextCursor: s(raw.nextCursor),
  };
}

// ---------- Lecturas (Firestore) ----------

export const OUTREACH_COLLECTIONS = {
  editions: "outreachEditions",
  registrations: "outreachRegistrations",
  decisions: "outreachDecisions",
} as const;
export const REGISTRATIONS_LIMIT = 2000;

export function toRegistration(id: string, data: DocumentData | undefined): Registration {
  const d = (data ?? {}) as Raw;
  const fu = (d.followUp ?? {}) as Raw;
  const oneOf = <T extends string>(v: unknown, values: readonly T[], f: T): T => ((values as readonly string[]).includes(v as string) ? (v as T) : f);
  const lastResult = oneOf<EventContactResult | "none">(fu.lastResult, [...EVENT_CONTACT_RESULTS, "none"], "none");
  return {
    id,
    editionId: s(d.editionId) ?? "",
    identityId: s(d.identityId),
    source: oneOf(d.source, REGISTRATION_SOURCES, "web"),
    externalRef: null,
    fullName: s(d.fullName)?.trim() ?? "Sin nombre",
    phoneE164: s(d.phoneE164),
    email: s(d.email),
    invitedByName: s(d.invitedByName),
    status: oneOf(d.status, REGISTRATION_STATUSES, "activa"),
    duplicateOf: s(d.duplicateOf),
    attendance: oneOf<Attendance>(d.attendance, ATTENDANCE, "sin_confirmar"),
    attendanceAt: toLocalDateTime(d.attendanceAt),
    attendanceBy: s(d.attendanceBy),
    consents: arr(d.consents).flatMap((c) =>
      s(c.purpose)
        ? [
            {
              purpose: c.purpose as never,
              grantedAt: toLocalDateTime(c.grantedAt) ?? "1970-01-01T00:00",
              source: (s(c.source) ?? "formulario_web") as never,
              textVersion: s(c.textVersion) ?? "",
              revokedAt: toLocalDateTime(c.revokedAt),
            },
          ]
        : [],
    ),
    doNotContact: d.doNotContact === true,
    ownerUid: s(d.ownerUid) ?? s(d.assigneeUid),
    assignmentBatchId: s(d.assignmentBatchId),
    locallyEdited: (Array.isArray(d.locallyEdited) ? d.locallyEdited : []).filter((x): x is string => typeof x === "string"),
    followUp: {
      ...EMPTY_FOLLOW_UP,
      lastContactAt: s(fu.lastContactAt),
      lastResult: lastResult === "none" ? null : lastResult,
      attempts: num(fu.attempts),
      nextAction: s(fu.nextAction),
      nextActionDate: s(fu.nextActionDate),
    },
    memberPersonId: s(d.memberPersonId),
    handedOffAt: toLocalDateTime(d.handedOffAt),
    tableNumber: typeof d.tableNumber === "number" ? d.tableNumber : null,
    ticketCode: s(d.ticketCode),
    createdAt: toLocalDateTime(d.createdAt) ?? "1970-01-01T00:00",
    revision: Math.max(1, num(d.revision, 1)),
  };
}

/** Ediciones visibles (reglas: cualquier permiso outreach). Más reciente primero. */
export async function fetchEditions(): Promise<EditionSummary[]> {
  try {
    const snap = await getDocs(query(collection(getFirebaseServices().db, OUTREACH_COLLECTIONS.editions), qLimit(20)));
    return snap.docs.map((d) => toEditionSummary(d.id, d.data())).sort((a, b) => b.year - a.year);
  } catch (error) {
    throw toOutreachError(error);
  }
}

/** Responsable: SOLO sus personas (contrato: assigneeUid + editionActive + editionId). */
export async function fetchMyRegistrations(uid: string, editionId: string): Promise<Registration[]> {
  try {
    const q = query(
      collection(getFirebaseServices().db, OUTREACH_COLLECTIONS.registrations),
      where("assigneeUid", "==", uid),
      where("editionActive", "==", true),
      where("editionId", "==", editionId),
      qLimit(REGISTRATIONS_LIMIT),
    );
    return (await getDocs(q)).docs.map((d) => toRegistration(d.id, d.data()));
  } catch (error) {
    throw toOutreachError(error);
  }
}

/** Coordinación: toda la edición (para confirmar ausencias). */
export async function fetchEditionRegistrations(editionId: string): Promise<Registration[]> {
  try {
    const q = query(
      collection(getFirebaseServices().db, OUTREACH_COLLECTIONS.registrations),
      where("editionId", "==", editionId),
      qLimit(REGISTRATIONS_LIMIT),
    );
    return (await getDocs(q)).docs.map((d) => toRegistration(d.id, d.data()));
  } catch (error) {
    throw toOutreachError(error);
  }
}

/** Decisiones de las personas asignadas al líder (mismo contrato que las inscripciones). */
export async function fetchMyDecisions(uid: string, editionId: string): Promise<DecisionRow[]> {
  try {
    const q = query(
      collection(getFirebaseServices().db, OUTREACH_COLLECTIONS.decisions),
      where("assigneeUid", "==", uid),
      where("editionActive", "==", true),
      where("editionId", "==", editionId),
      qLimit(REGISTRATIONS_LIMIT),
    );
    return (await getDocs(q)).docs.flatMap((d) => {
      const x = d.data();
      return isDecision(x.value)
        ? [{ registrationId: d.id, fullName: null, value: x.value, tableNumber: typeof x.tableNumber === "number" ? x.tableNumber : null, recordedAt: toLocalDateTime(x.recordedAt) }]
        : [];
    });
  } catch (error) {
    throw toOutreachError(error);
  }
}
