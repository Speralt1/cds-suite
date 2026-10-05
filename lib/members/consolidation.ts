// Integrantes › Consolidación V1: derivados puros (alertas, cola de atención,
// dashboard, badges, timeline y duplicados). Port de la preview (PR #4)
// conducido por la PROYECCIÓN guardada en `membersPeople` (doc 23 §5.1, §7):
// no se escanea el historial. Nada de esto se guarda.
//
// Excluido en V1: cumpleaños, edad, "Menor", confesión de fe y bautismo.

import { addDays, compareLocal, daysBetween, hoursBetween } from "@/lib/shared/dates";
import { normalizeEmail, normalizePhone } from "@/lib/shared/members";
import type { Alert, AlertType, FollowUp, LocalDateTime, Person, PersonChange, TimelineItem, Visit, Ymd } from "./types";

/** Umbrales fijos de V1 (los ajustes de umbrales son LATER). */
export const CONSOLIDATION_THRESHOLDS = Object.freeze({
  firstContactMaxHours: 48,
  noReturnDays: 21,
  recentNewDays: 14,
  returnedRecentDays: 7,
  pendingFollowUpDays: 7,
});

const T = CONSOLIDATION_THRESHOLDS;

export const ALERT_LABEL: Readonly<Record<AlertType, string>> = {
  sin_responsable: "Sin responsable",
  sin_primer_contacto: "Sin primer contacto",
  seguimiento_vencido: "Seguimiento vencido",
  volvio: "Volvió sin seguimiento",
  varios_dias_sin_volver: "Varios días sin volver",
  posible_duplicado_telefono: "Posible duplicado (teléfono)",
  posible_duplicado_correo: "Posible duplicado (correo)",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Fecha/hora de creación para el umbral de 48 h (sin timestamp: inicio del día de ingreso). */
export function createdAtOf(p: Pick<Person, "createdAt" | "entryDate">): LocalDateTime {
  return p.createdAt ?? `${p.entryDate}T00:00`;
}

/** Activa en Consolidación (no integrada ni cerrada). */
export function isOpen(p: Pick<Person, "lifecycleStage" | "consolidationStatus">): boolean {
  return p.lifecycleStage === "en_consolidacion" && p.consolidationStatus !== "sin_continuidad";
}

/** Personas a las que aplican las alertas (salvo duplicados): abiertas y sin "No contactar". */
export function isActiveForAlerts(p: Pick<Person, "lifecycleStage" | "consolidationStatus" | "doNotContact">): boolean {
  return isOpen(p) && !p.doNotContact;
}

/**
 * Responsable válido: uid presente en `membersOwnerOptions`. Con `owners` null
 * (la lista aún no carga o falló) solo se exige que haya uno: nunca se marca
 * "sin responsable" por un dato que no se pudo leer.
 */
export function isValidOwner(uid: string | null | undefined, owners: ReadonlySet<string> | null): boolean {
  if (!uid) return false;
  return owners ? owners.has(uid) : true;
}

/**
 * Volvió: la última visita es POSTERIOR a la primera (otro día; dos visitas el
 * mismo día no cuentan) y fue en los últimos 7 días.
 */
export function hasReturnedRecently(p: Pick<Person, "projection" | "firstVisitAt">, today: Ymd): boolean {
  const { lastVisitDate } = p.projection;
  const firstVisitDate = p.projection.firstVisitDate ?? p.firstVisitAt;
  if (!lastVisitDate || !firstVisitDate || compareLocal(lastVisitDate, firstVisitDate) <= 0) return false;
  const ago = daysBetween(lastVisitDate, today);
  return ago >= 0 && ago <= T.returnedRecentDays;
}

// ---------- Duplicados ----------

export type DuplicateBy = "telefono" | "correo";

export interface DuplicateGroup {
  kind: DuplicateBy;
  key: string;
  ids: string[];
}

/** Grupos de ≥ 2 personas con el mismo teléfono normalizado o el mismo correo (todas las personas). */
export function findDuplicates(persons: readonly Pick<Person, "id" | "phoneE164" | "email">[]): DuplicateGroup[] {
  const byPhone = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();
  for (const p of persons) {
    if (p.phoneE164) byPhone.set(p.phoneE164, [...(byPhone.get(p.phoneE164) ?? []), p.id]);
    if (p.email) byEmail.set(p.email, [...(byEmail.get(p.email) ?? []), p.id]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, ids] of byPhone) if (ids.length > 1) groups.push({ kind: "telefono", key, ids });
  for (const [key, ids] of byEmail) if (ids.length > 1) groups.push({ kind: "correo", key, ids });
  return groups;
}

/** Coincidencias para el formulario (advertencia que NUNCA bloquea). Normaliza como el servidor. */
export function duplicateCandidates<P extends Pick<Person, "id" | "phoneE164" | "email">>(
  input: { phone?: string; email?: string },
  persons: readonly P[],
  excludeId?: string,
): { person: P; by: DuplicateBy[] }[] {
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  const out: { person: P; by: DuplicateBy[] }[] = [];
  for (const p of persons) {
    if (p.id === excludeId) continue;
    const by: DuplicateBy[] = [];
    if (phone?.ok && p.phoneE164 === phone.e164) by.push("telefono");
    if (email?.ok && p.email === email.value) by.push("correo");
    if (by.length) out.push({ person: p, by });
  }
  return out;
}

// ---------- Alertas ----------

/**
 * Alertas derivadas (doc 23 §7). Aplican a personas abiertas sin "No contactar",
 * salvo los posibles duplicados (todas las personas).
 */
export function computeAlerts(persons: readonly Person[], owners: ReadonlySet<string> | null, now: LocalDateTime): Alert[] {
  const today = now.slice(0, 10);
  const alerts: Alert[] = [];
  for (const p of persons) {
    if (!isActiveForAlerts(p)) continue;
    const pr = p.projection;
    if (!isValidOwner(p.followUpOwnerUid, owners))
      alerts.push({
        type: "sin_responsable",
        personId: p.id,
        severity: "high",
        since: p.entryDate,
        detail: p.followUpOwnerUid ? "El responsable ya no tiene acceso" : "Nadie a cargo del seguimiento",
      });
    if (!pr.firstContactDate && hoursBetween(createdAtOf(p), now) > T.firstContactMaxHours)
      alerts.push({
        type: "sin_primer_contacto",
        personId: p.id,
        severity: "high",
        since: p.entryDate,
        detail: pr.followUpCount ? plural(pr.followUpCount, "intento", "intentos") : "Sin intentos",
      });
    if (pr.nextActionDate && compareLocal(pr.nextActionDate, today) < 0)
      alerts.push({
        type: "seguimiento_vencido",
        personId: p.id,
        severity: "high",
        since: pr.nextActionDate,
        detail: `${pr.nextAction ?? "Próxima acción"} · venció hace ${plural(daysBetween(pr.nextActionDate, today), "día", "días")}`,
      });
    if (
      hasReturnedRecently(p, today) &&
      (!pr.lastFollowUpDate || compareLocal(pr.lastFollowUpDate, pr.lastVisitDate as Ymd) < 0)
    ) {
      const ago = daysBetween(pr.lastVisitDate as Ymd, today);
      alerts.push({
        type: "volvio",
        personId: p.id,
        severity: "positive",
        since: pr.lastVisitDate as Ymd,
        detail: ago === 0 ? "Volvió hoy" : `Volvió hace ${plural(ago, "día", "días")}`,
      });
    }
    if (pr.lastVisitDate && daysBetween(pr.lastVisitDate, today) > T.noReturnDays)
      alerts.push({
        type: "varios_dias_sin_volver",
        personId: p.id,
        severity: "medium",
        since: pr.lastVisitDate,
        detail: `${daysBetween(pr.lastVisitDate, today)} días sin volver`,
      });
  }
  // Duplicados: aplican a TODAS las personas, incluso con "No contactar".
  const byId = new Map(persons.map((p) => [p.id, p] as const));
  for (const g of findDuplicates(persons)) {
    for (const id of g.ids) {
      const others = g.ids.filter((x) => x !== id);
      alerts.push({
        type: g.kind === "telefono" ? "posible_duplicado_telefono" : "posible_duplicado_correo",
        personId: id,
        severity: "medium",
        since: byId.get(id)!.entryDate,
        detail: `Mismo ${g.kind === "telefono" ? "teléfono" : "correo"} que ${others.map((o) => byId.get(o)!.fullName).join(", ")}`,
        otherIds: others,
      });
    }
  }
  return alerts;
}

export function alertsFor(personId: string, alerts: readonly Alert[]): Alert[] {
  return alerts.filter((a) => a.personId === personId);
}

/** Prioridad de "Necesitan atención" (16a F). */
export const ATTENTION_PRIORITY: readonly AlertType[] = [
  "sin_responsable",
  "sin_primer_contacto",
  "seguimiento_vencido",
  "volvio",
  "varios_dias_sin_volver",
  "posible_duplicado_telefono",
  "posible_duplicado_correo",
];

export const ATTENTION_CTA: Readonly<Record<AlertType, string>> = {
  sin_responsable: "Asignar",
  sin_primer_contacto: "Contactar",
  seguimiento_vencido: "Registrar seguimiento",
  volvio: "Agradecer",
  varios_dias_sin_volver: "Invitar",
  posible_duplicado_telefono: "Revisar",
  posible_duplicado_correo: "Revisar",
};

export interface AttentionRow {
  personId: string;
  primary: Alert;
  /** Las demás alertas de la persona ("+n alertas"). */
  others: Alert[];
  cta: string;
}

/** Los dos duplicados comparten el último grupo. */
export function priorityOf(t: AlertType): number {
  return t === "posible_duplicado_correo" ? ATTENTION_PRIORITY.indexOf("posible_duplicado_telefono") : ATTENTION_PRIORITY.indexOf(t);
}

/** Una fila por persona, ordenada por prioridad y, dentro del grupo, lo más antiguo primero. */
export function attentionQueue(alerts: readonly Alert[]): AttentionRow[] {
  const byPerson = new Map<string, Alert[]>();
  for (const a of alerts) byPerson.set(a.personId, [...(byPerson.get(a.personId) ?? []), a]);
  const rows: AttentionRow[] = [];
  for (const [personId, list] of byPerson) {
    const sorted = [...list].sort((a, b) => priorityOf(a.type) - priorityOf(b.type) || compareLocal(a.since, b.since));
    const primary = sorted[0];
    if (!primary) continue;
    rows.push({ personId, primary, others: list.filter((a) => a !== primary), cta: ATTENTION_CTA[primary.type] });
  }
  return rows.sort(
    (a, b) =>
      priorityOf(a.primary.type) - priorityOf(b.primary.type) ||
      compareLocal(a.primary.since, b.primary.since) ||
      a.personId.localeCompare(b.personId),
  );
}

// ---------- Dashboard ----------

export interface PendingFollowUp {
  person: Person;
  text: string;
  date: Ymd;
  ownerUid: string | null;
}

export interface ConsolidationDashboard {
  /** Indicadores (exactamente 3). */
  newThisMonth: number;
  withoutFirstContact: number;
  overdueFollowUps: number;
  /** Fecha más antigua de cada indicador con alertas (contexto del tile). */
  oldestWithoutFirstContact: Ymd | null;
  oldestOverdue: Ymd | null;
  attention: AttentionRow[];
  recentNew: Person[];
  pendingFollowUps: PendingFollowUp[];
  returned: { person: Person; date: Ymd }[];
}

export function dashboard(persons: readonly Person[], alerts: readonly Alert[], today: Ymd): ConsolidationDashboard {
  const ofType = (t: AlertType) => alerts.filter((a) => a.type === t);
  const oldest = (list: Alert[]) => list.map((a) => a.since).sort(compareLocal)[0] ?? null;
  const active = persons.filter(isActiveForAlerts);
  const horizon = addDays(today, T.pendingFollowUpDays);
  const pendingFollowUps = active
    .filter((p) => {
      const d = p.projection.nextActionDate;
      return !!p.projection.nextAction && !!d && compareLocal(d, today) >= 0 && compareLocal(d, horizon) <= 0;
    })
    .map((person) => ({
      person,
      text: person.projection.nextAction as string,
      date: person.projection.nextActionDate as Ymd,
      ownerUid: person.projection.nextActionOwnerUid,
    }))
    .sort((a, b) => compareLocal(a.date, b.date) || a.person.fullName.localeCompare(b.person.fullName, "es"));
  const returned = active
    .filter((p) => hasReturnedRecently(p, today))
    .map((person) => ({ person, date: person.projection.lastVisitDate as Ymd }))
    .sort((a, b) => compareLocal(b.date, a.date) || a.person.fullName.localeCompare(b.person.fullName, "es"));
  const firstContact = ofType("sin_primer_contacto");
  const overdue = ofType("seguimiento_vencido");
  return {
    newThisMonth: persons.filter((p) => p.entryDate.slice(0, 7) === today.slice(0, 7)).length,
    withoutFirstContact: firstContact.length,
    overdueFollowUps: overdue.length,
    oldestWithoutFirstContact: oldest(firstContact),
    oldestOverdue: oldest(overdue),
    attention: attentionQueue(alerts),
    recentNew: persons
      .filter((p) => p.lifecycleStage === "en_consolidacion" && daysBetween(p.entryDate, today) <= T.recentNewDays)
      .sort((a, b) => compareLocal(b.entryDate, a.entryDate) || compareLocal(createdAtOf(b), createdAtOf(a))),
    pendingFollowUps,
    returned,
  };
}

export type DerivedBadge = "nuevo" | "volvio" | "no_contactar";

/** Badges derivados: Nuevo (ingreso reciente), Volvió y No contactar. */
export function personBadges(p: Person, today: Ymd): DerivedBadge[] {
  const badges: DerivedBadge[] = [];
  const open = isOpen(p);
  if (open && daysBetween(p.entryDate, today) <= T.recentNewDays) badges.push("nuevo");
  if (open && hasReturnedRecently(p, today)) badges.push("volvio");
  if (p.doNotContact) badges.push("no_contactar");
  return badges;
}

// ---------- Timeline ----------

/** Acciones de auditoría que se muestran como "cambio" (visitas y seguimientos tienen su propio ítem). */
const CHANGE_ACTIONS_SHOWN = new Set<PersonChange["action"]>([
  "profile_updated",
  "owner_changed",
  "do_not_contact_changed",
  "status_changed",
  "stage_changed",
]);

function timeOf(at: LocalDateTime | null, date: Ymd, fallback: string): LocalDateTime {
  // Registro del mismo día: hora real; registro posterior (con fecha atrasada): hora fija.
  return at && at.slice(0, 10) === date ? at : `${date}T${fallback}`;
}

/**
 * Historial derivado, del más nuevo al más antiguo: registro, visitas,
 * seguimientos y cambios de estado/etapa/responsable/"No contactar"/datos.
 */
export function timeline(
  person: Pick<Person, "id" | "entryDate" | "createdAt" | "createdBy">,
  visits: readonly Visit[],
  followUps: readonly FollowUp[],
  changes: readonly PersonChange[],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const createdAt = createdAtOf(person);
  items.push({ id: `created-${person.id}`, kind: "created", at: createdAt, date: createdAt.slice(0, 10), by: person.createdBy });
  const mine = visits.filter((v) => v.personId === person.id);
  const first =
    mine.find((v) => v.firstVisit) ??
    [...mine].sort((a, b) => compareLocal(a.date, b.date) || compareLocal(a.createdAt ?? "", b.createdAt ?? ""))[0];
  for (const v of mine)
    items.push({
      id: v.id,
      kind: "visit",
      at: timeOf(v.createdAt, v.date, "00:00"),
      date: v.date,
      by: v.createdBy,
      visit: v,
      isFirstVisit: v === first,
    });
  for (const f of followUps.filter((x) => x.personId === person.id))
    items.push({ id: f.id, kind: "followup", at: timeOf(f.createdAt, f.contactDate, "12:00"), date: f.contactDate, by: f.createdBy, followUp: f });
  for (const c of changes.filter((x) => x.personId === person.id && CHANGE_ACTIONS_SHOWN.has(x.action))) {
    const at = c.at ?? createdAt;
    items.push({ id: c.id, kind: "change", at, date: at.slice(0, 10), by: c.actorUid, change: c });
  }
  const kindOrder: Record<TimelineItem["kind"], number> = { change: 0, followup: 1, visit: 2, created: 3 };
  return items.sort((a, b) => compareLocal(b.at, a.at) || kindOrder[a.kind] - kindOrder[b.kind] || b.id.localeCompare(a.id));
}

// ---------- Vista por persona ----------

export interface PersonView {
  person: Person;
  badges: DerivedBadge[];
  /** Próxima acción vigente (la del seguimiento más reciente). */
  next: { text: string; date: Ymd | null; ownerUid: string | null } | null;
  nextOverdue: boolean;
  /** Alertas de la persona, por prioridad. */
  alerts: Alert[];
  /** Nombre del responsable (null si no hay o ya no está en la lista de responsables). */
  ownerName: string | null;
  ownerValid: boolean;
  /** Abierta en Consolidación (no integrada ni cerrada). */
  open: boolean;
}

export function buildPersonView(
  p: Person,
  alerts: readonly Alert[],
  owners: ReadonlyMap<string, string> | null,
  today: Ymd,
): PersonView {
  const pr = p.projection;
  const next = pr.nextAction ? { text: pr.nextAction, date: pr.nextActionDate, ownerUid: pr.nextActionOwnerUid } : null;
  const ownerSet = owners ? new Set(owners.keys()) : null;
  return {
    person: p,
    badges: personBadges(p, today),
    next,
    nextOverdue: !!next?.date && compareLocal(next.date, today) < 0,
    alerts: alertsFor(p.id, alerts).sort((a, b) => priorityOf(a.type) - priorityOf(b.type) || compareLocal(a.since, b.since)),
    ownerName: p.followUpOwnerUid ? (owners?.get(p.followUpOwnerUid) ?? null) : null,
    ownerValid: isValidOwner(p.followUpOwnerUid, ownerSet),
    open: isOpen(p),
  };
}
