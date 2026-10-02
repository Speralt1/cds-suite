// Integrantes › Consolidación: derivados (edad, estadísticas, alertas, cola de
// atención, dashboard, timeline y duplicados). Nada de esto se guarda.

import { can } from "./access";
import { addDays, compareLocal, dateOf, daysBetween, hoursBetween, isLeap, isValidYmd, parseYmd, ymd } from "./dates";
import { normalizeEmail, normalizePhone } from "./phone";
import type {
  AccessProfile,
  Alert,
  AlertType,
  ClosedReason,
  ConsolidationSettings,
  ConsolidationStatus,
  FollowUp,
  FollowUpInput,
  FollowUpResult,
  FollowUpType,
  LocalDateTime,
  Person,
  PersonChange,
  PersonInput,
  TimelineItem,
  TriState,
  Visit,
  Ymd,
} from "./types";

export const DEFAULT_CONSOLIDATION_SETTINGS: ConsolidationSettings = {
  firstContactMaxHours: 48,
  noReturnDays: 21,
  birthdayLeadDays: 14,
  recentNewDays: 14,
  returnedRecentDays: 7,
};

/** Rangos permitidos (para Ajustes). */
export const SETTINGS_RANGES: Record<keyof ConsolidationSettings, [number, number]> = {
  firstContactMaxHours: [12, 168],
  noReturnDays: [7, 90],
  birthdayLeadDays: [1, 31],
  recentNewDays: [7, 60],
  returnedRecentDays: [1, 30],
};

export interface ConsolidationData {
  persons: readonly Person[];
  visits: readonly Visit[];
  followUps: readonly FollowUp[];
  personChanges: readonly PersonChange[];
  users: readonly AccessProfile[];
}

// ---------- Vocabulario ----------

export const STATUS_LABEL: Record<ConsolidationStatus, string> = {
  por_contactar: "Por contactar",
  en_seguimiento: "En seguimiento",
  integrandose: "Integrándose",
  integrado: "Integrado",
  sin_continuidad: "Sin continuidad",
};
export const STATUS_ORDER: readonly ConsolidationStatus[] = [
  "por_contactar",
  "en_seguimiento",
  "integrandose",
  "integrado",
  "sin_continuidad",
];
export const TRISTATE_LABEL: Record<TriState, string> = { si: "Sí", no: "No", sin_informacion: "Sin información" };
export const CLOSED_REASON_LABEL: Record<ClosedReason, string> = {
  no_responde: "No responde",
  cambio_iglesia: "Se cambió de iglesia",
  se_mudo: "Se mudó",
  no_desea_contacto: "No desea contacto",
  otro: "Otro",
};
export const FOLLOWUP_TYPE_LABEL: Record<FollowUpType, string> = {
  whatsapp: "WhatsApp",
  llamada: "Llamada",
  presencial: "Presencial",
  otro: "Otro",
};
export const FOLLOWUP_RESULT_LABEL: Record<FollowUpResult, string> = {
  contactado: "Contactado",
  sin_respuesta: "Sin respuesta",
  numero_invalido: "Número inválido",
  no_desea_contacto: "No desea contacto",
  otro: "Otro",
};
export const ALERT_LABEL: Record<AlertType, string> = {
  sin_responsable: "Sin responsable",
  sin_primer_contacto: "Sin primer contacto",
  seguimiento_vencido: "Seguimiento vencido",
  cumpleanos_proximo: "Cumpleaños próximo",
  volvio: "Volvió",
  varios_dias_sin_volver: "Varios días sin volver",
  posible_duplicado_telefono: "Posible duplicado (teléfono)",
  posible_duplicado_correo: "Posible duplicado (correo)",
};

// ---------- Edad y cumpleaños ----------

/** Cumpleaños en un año dado: el 29-02 se celebra el 28-02 en años no bisiestos. */
function birthdayIn(birthDate: Ymd, year: number): Ymd {
  const { m, d } = parseYmd(birthDate);
  if (m === 2 && d === 29 && !isLeap(year)) return ymd(year, 2, 28);
  return ymd(year, m, d);
}

/** Años cumplidos a la fecha (null sin fecha de nacimiento). */
export function ageAt(birthDate: Ymd | undefined | null, today: Ymd): number | null {
  if (!birthDate || !isValidYmd(birthDate)) return null;
  const b = parseYmd(birthDate);
  const t = parseYmd(today);
  const age = t.y - b.y - (compareLocal(today, birthdayIn(birthDate, t.y)) < 0 ? 1 : 0);
  return age >= 0 ? age : null;
}

/** "19" o "—". */
export function formatAge(age: number | null): string {
  return age === null ? "—" : String(age);
}

export function isMinor(birthDate: Ymd | undefined | null, today: Ymd): boolean {
  const age = ageAt(birthDate, today);
  return age !== null && age < 18;
}

/** Próximo cumpleaños ≥ hoy (con cruce de año). */
export function nextBirthday(
  birthDate: Ymd | undefined | null,
  today: Ymd,
): { date: Ymd; turns: number; inDays: number } | null {
  if (!birthDate || !isValidYmd(birthDate)) return null;
  const t = parseYmd(today);
  const b = parseYmd(birthDate);
  let date = birthdayIn(birthDate, t.y);
  if (compareLocal(date, today) < 0) date = birthdayIn(birthDate, t.y + 1);
  const year = parseYmd(date).y;
  return { date, turns: year - b.y, inDays: daysBetween(today, date) };
}

// ---------- Estadísticas ----------

export function visitsOf(personId: string, visits: readonly Visit[], includeVoided = false): Visit[] {
  return visits
    .filter((v) => v.personId === personId && (includeVoided || !v.voided))
    .sort((a, b) => compareLocal(a.date, b.date) || compareLocal(a.createdAt, b.createdAt) || a.id.localeCompare(b.id));
}

export function followUpsOf(personId: string, followUps: readonly FollowUp[]): FollowUp[] {
  return followUps.filter((f) => f.personId === personId).sort((a, b) => compareLocal(a.at, b.at) || a.id.localeCompare(b.id));
}

export interface PersonStats {
  visitCount: number;
  firstVisitDate: Ymd | null;
  lastVisitDate: Ymd | null;
  /** La última visita es la primera (nunca volvió). */
  lastVisitIsFirst: boolean;
}

/** Cantidad y fechas de visitas (sin anuladas). */
export function personStats(personId: string, visits: readonly Visit[]): PersonStats {
  const list = visitsOf(personId, visits);
  return {
    visitCount: list.length,
    firstVisitDate: list[0]?.date ?? null,
    lastVisitDate: list.at(-1)?.date ?? null,
    lastVisitIsFirst: list.length <= 1,
  };
}

/** Próxima acción vigente: la del seguimiento MÁS RECIENTE (uno nuevo la reemplaza). */
export function currentNextAction(
  personId: string,
  followUps: readonly FollowUp[],
): { text: string; date: Ymd | null; ownerUid: string | null; followUpId: string } | null {
  const last = followUpsOf(personId, followUps).at(-1);
  if (!last || !last.nextAction) return null;
  return { text: last.nextAction, date: last.nextActionDate ?? null, ownerUid: last.ownerUid, followUpId: last.id };
}

/** Personas activas para alertas (salvo duplicados). */
export function isActiveForAlerts(p: Person): boolean {
  return p.lifecycleStage === "en_consolidacion" && p.consolidationStatus !== "sin_continuidad" && !p.doNotContact;
}

/** Responsable válido: usuario activo con members.consolidation.manage. */
export function isValidOwner(uid: string | null | undefined, users: readonly AccessProfile[]): boolean {
  const u = uid ? users.find((x) => x.uid === uid) : undefined;
  return !!u && can(u, "members.consolidation.manage");
}

export function eligibleOwners(users: readonly AccessProfile[]): AccessProfile[] {
  return users.filter((u) => can(u, "members.consolidation.manage"));
}

// ---------- Duplicados ----------

export interface DuplicateGroup {
  kind: "telefono" | "correo";
  key: string;
  ids: string[];
}

/** Grupos de ≥2 personas con el mismo teléfono normalizado o el mismo correo (todas las personas). */
export function findDuplicates(persons: readonly Person[]): DuplicateGroup[] {
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

/** Coincidencias para el formulario (advertencia que NO bloquea). */
export function duplicateCandidates(
  input: { phone?: string; email?: string },
  persons: readonly Person[],
  excludeId?: string,
): { person: Person; by: ("telefono" | "correo")[] }[] {
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const email = input.email ? normalizeEmail(input.email) : null;
  const out: { person: Person; by: ("telefono" | "correo")[] }[] = [];
  for (const p of persons) {
    if (p.id === excludeId) continue;
    const by: ("telefono" | "correo")[] = [];
    if (phone?.ok && p.phoneE164 === phone.e164) by.push("telefono");
    if (email?.ok && p.email === email.value) by.push("correo");
    if (by.length) out.push({ person: p, by });
  }
  return out;
}

// ---------- Alertas ----------

const PLURAL = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Las 8 alertas derivadas, con los parámetros por defecto. */
export function computeAlerts(
  data: ConsolidationData,
  now: LocalDateTime,
  settings: ConsolidationSettings = DEFAULT_CONSOLIDATION_SETTINGS,
): Alert[] {
  const today = dateOf(now);
  const alerts: Alert[] = [];
  for (const p of data.persons) {
    if (!isActiveForAlerts(p)) continue;
    const fus = followUpsOf(p.id, data.followUps);
    const stats = personStats(p.id, data.visits);
    if (!isValidOwner(p.followUpOwnerUid, data.users))
      alerts.push({
        type: "sin_responsable",
        personId: p.id,
        severity: "high",
        since: p.entryDate,
        detail: p.followUpOwnerUid ? "El responsable ya no tiene acceso" : "Nadie a cargo del seguimiento",
      });
    if (!fus.some((f) => f.result === "contactado") && hoursBetween(p.createdAt, now) > settings.firstContactMaxHours)
      alerts.push({
        type: "sin_primer_contacto",
        personId: p.id,
        severity: "high",
        since: p.entryDate,
        detail: fus.length ? PLURAL(fus.length, "intento", "intentos") : "Sin intentos",
      });
    const next = currentNextAction(p.id, data.followUps);
    if (next?.date && compareLocal(next.date, today) < 0)
      alerts.push({
        type: "seguimiento_vencido",
        personId: p.id,
        severity: "high",
        since: next.date,
        detail: `${next.text} · venció hace ${PLURAL(daysBetween(next.date, today), "día", "días")}`,
      });
    const bday = nextBirthday(p.birthDate, today);
    if (bday && bday.inDays <= settings.birthdayLeadDays)
      alerts.push({
        type: "cumpleanos_proximo",
        personId: p.id,
        severity: "low",
        since: bday.date,
        detail: bday.inDays === 0 ? `Cumple ${bday.turns} hoy` : `Cumple ${bday.turns} en ${PLURAL(bday.inDays, "día", "días")}`,
      });
    if (stats.lastVisitDate && !stats.lastVisitIsFirst) {
      const ago = daysBetween(stats.lastVisitDate, today);
      const after = fus.some((f) => compareLocal(dateOf(f.at), stats.lastVisitDate!) >= 0);
      if (ago >= 0 && ago <= settings.returnedRecentDays && !after)
        alerts.push({
          type: "volvio",
          personId: p.id,
          severity: "positive",
          since: stats.lastVisitDate,
          detail: ago === 0 ? "Volvió hoy" : `Volvió hace ${PLURAL(ago, "día", "días")}`,
        });
    }
    if (stats.lastVisitDate && daysBetween(stats.lastVisitDate, today) > settings.noReturnDays)
      alerts.push({
        type: "varios_dias_sin_volver",
        personId: p.id,
        severity: "medium",
        since: stats.lastVisitDate,
        detail: `${daysBetween(stats.lastVisitDate, today)} días sin volver`,
      });
  }
  // Duplicados: aplican a TODAS las personas, incluso con "No contactar".
  const byId = new Map(data.persons.map((p) => [p.id, p] as const));
  for (const g of findDuplicates(data.persons)) {
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

/** Prioridad de "Necesitan atención" (16a F). Cumpleaños no entra en la cola. */
export const ATTENTION_PRIORITY: readonly AlertType[] = [
  "sin_responsable",
  "sin_primer_contacto",
  "seguimiento_vencido",
  "volvio",
  "varios_dias_sin_volver",
  "posible_duplicado_telefono",
  "posible_duplicado_correo",
];

export const ATTENTION_CTA: Partial<Record<AlertType, string>> = {
  sin_responsable: "Asignar",
  sin_primer_contacto: "Contactar",
  seguimiento_vencido: "Registrar seguimiento",
  volvio: "Agradecer",
  // "Invitar" (de vuelta): verbo pedido por el coordinador para quien lleva días sin volver.
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

function priorityOf(t: AlertType): number {
  const i = ATTENTION_PRIORITY.indexOf(t);
  // Los dos duplicados comparten el último grupo.
  return t === "posible_duplicado_correo" ? ATTENTION_PRIORITY.indexOf("posible_duplicado_telefono") : i;
}

/** Una fila por persona, ordenada por prioridad y, dentro del grupo, lo más antiguo primero. */
export function attentionQueue(alerts: readonly Alert[]): AttentionRow[] {
  const byPerson = new Map<string, Alert[]>();
  for (const a of alerts) byPerson.set(a.personId, [...(byPerson.get(a.personId) ?? []), a]);
  const rows: AttentionRow[] = [];
  for (const [personId, list] of byPerson) {
    const candidates = list
      .filter((a) => ATTENTION_PRIORITY.includes(a.type))
      .sort((a, b) => priorityOf(a.type) - priorityOf(b.type) || compareLocal(a.since, b.since));
    if (!candidates.length) continue;
    const primary = candidates[0];
    rows.push({ personId, primary, others: list.filter((a) => a !== primary), cta: ATTENTION_CTA[primary.type] ?? "Revisar" });
  }
  return rows.sort(
    (a, b) =>
      priorityOf(a.primary.type) - priorityOf(b.primary.type) ||
      compareLocal(a.primary.since, b.primary.since) ||
      a.personId.localeCompare(b.personId),
  );
}

// ---------- Dashboard ----------

export interface ConsolidationDashboard {
  /** Indicadores (exactamente 3). */
  newThisMonth: number;
  withoutFirstContact: number;
  overdueFollowUps: number;
  attention: AttentionRow[];
  birthdays: { person: Person; date: Ymd; turns: number; inDays: number }[];
  recentNew: Person[];
  pendingFollowUps: { person: Person; text: string; date: Ymd; ownerUid: string | null }[];
  returned: { person: Person; date: Ymd }[];
}

export function dashboard(
  data: ConsolidationData,
  now: LocalDateTime,
  settings: ConsolidationSettings = DEFAULT_CONSOLIDATION_SETTINGS,
): ConsolidationDashboard {
  const today = dateOf(now);
  const alerts = computeAlerts(data, now, settings);
  const byId = new Map(data.persons.map((p) => [p.id, p] as const));
  const count = (t: AlertType) => alerts.filter((a) => a.type === t).length;
  const active = data.persons.filter(isActiveForAlerts);
  const birthdays = alerts
    .filter((a) => a.type === "cumpleanos_proximo")
    .map((a) => {
      const person = byId.get(a.personId)!;
      return { person, ...nextBirthday(person.birthDate, today)! };
    })
    .sort((a, b) => a.inDays - b.inDays || a.person.fullName.localeCompare(b.person.fullName, "es"));
  const pendingFollowUps = active
    .map((person) => ({ person, next: currentNextAction(person.id, data.followUps) }))
    .filter(
      (x): x is { person: Person; next: NonNullable<ReturnType<typeof currentNextAction>> & { date: Ymd } } =>
        !!x.next?.date && compareLocal(x.next.date, today) >= 0 && compareLocal(x.next.date, addDays(today, 7)) <= 0,
    )
    .map(({ person, next }) => ({ person, text: next.text, date: next.date, ownerUid: next.ownerUid }))
    .sort((a, b) => compareLocal(a.date, b.date));
  const returned = active
    .map((person) => ({ person, stats: personStats(person.id, data.visits) }))
    .filter(
      ({ stats }) =>
        !!stats.lastVisitDate &&
        !stats.lastVisitIsFirst &&
        daysBetween(stats.lastVisitDate, today) <= settings.returnedRecentDays,
    )
    .map(({ person, stats }) => ({ person, date: stats.lastVisitDate! }))
    .sort((a, b) => compareLocal(b.date, a.date));
  return {
    newThisMonth: data.persons.filter((p) => p.entryDate.slice(0, 7) === today.slice(0, 7)).length,
    withoutFirstContact: count("sin_primer_contacto"),
    overdueFollowUps: count("seguimiento_vencido"),
    attention: attentionQueue(alerts),
    birthdays,
    recentNew: data.persons
      .filter((p) => p.lifecycleStage === "en_consolidacion" && daysBetween(p.entryDate, today) <= settings.recentNewDays)
      .sort((a, b) => compareLocal(b.entryDate, a.entryDate)),
    pendingFollowUps,
    returned,
  };
}

/** Badges derivados "Nuevo" (ingreso reciente) y "Volvió". */
export function personBadges(
  p: Person,
  data: Pick<ConsolidationData, "visits" | "followUps">,
  today: Ymd,
  settings: ConsolidationSettings = DEFAULT_CONSOLIDATION_SETTINGS,
): { isNew: boolean; returned: boolean; minor: boolean } {
  const stats = personStats(p.id, data.visits);
  return {
    isNew: daysBetween(p.entryDate, today) <= settings.recentNewDays,
    returned:
      !!stats.lastVisitDate && !stats.lastVisitIsFirst && daysBetween(stats.lastVisitDate, today) <= settings.returnedRecentDays,
    minor: isMinor(p.birthDate, today),
  };
}

// ---------- Timeline ----------

/** Historial derivado, del más nuevo al más antiguo. */
export function timeline(personId: string, data: ConsolidationData): TimelineItem[] {
  const person = data.persons.find((p) => p.id === personId);
  if (!person) return [];
  const items: TimelineItem[] = [{ id: `created-${person.id}`, kind: "created", at: person.createdAt, title: "Registro de la persona", by: person.createdBy }];
  const visits = visitsOf(personId, data.visits, true);
  const firstValid = visits.find((v) => !v.voided);
  for (const v of visits)
    items.push({
      id: v.id,
      kind: "visit",
      at: `${v.date}T${v === firstValid ? person.createdAt.slice(11, 16) || "00:00" : "00:00"}`,
      title: v === firstValid ? "Primera visita" : "Visita",
      detail: [v.activityLabel, v.note].filter(Boolean).join(" · ") || undefined,
      by: v.createdBy,
      isFirstVisit: v === firstValid,
      voided: v.voided,
    });
  for (const f of followUpsOf(personId, data.followUps))
    items.push({
      id: f.id,
      kind: "followup",
      at: f.at,
      title: `${FOLLOWUP_TYPE_LABEL[f.type]} · ${FOLLOWUP_RESULT_LABEL[f.result]}`,
      detail: [f.note, f.nextAction ? `Próxima acción: ${f.nextAction}` : ""].filter(Boolean).join(" · ") || undefined,
      by: f.createdBy,
    });
  for (const c of data.personChanges.filter((x) => x.personId === personId))
    items.push({ id: c.id, kind: "change", at: c.at, title: changeTitle(c), detail: c.reason, by: c.by });
  const kindOrder: Record<TimelineItem["kind"], number> = { change: 0, followup: 1, visit: 2, created: 3 };
  return items.sort((a, b) => compareLocal(b.at, a.at) || kindOrder[a.kind] - kindOrder[b.kind] || b.id.localeCompare(a.id));
}

function changeTitle(c: PersonChange): string {
  switch (c.field) {
    case "status":
      return `Estado: ${STATUS_LABEL[c.from as ConsolidationStatus] ?? "—"} → ${STATUS_LABEL[c.to as ConsolidationStatus] ?? "—"}`;
    case "stage":
      return c.to === "integrante" ? "Pasó a Integrante" : "Volvió a Consolidación";
    case "owner":
      return "Cambio de responsable";
    case "faithConfession":
      return `Confesión de fe: ${TRISTATE_LABEL[c.to as TriState] ?? "—"}`;
    case "baptized":
      return `Bautizado: ${TRISTATE_LABEL[c.to as TriState] ?? "—"}`;
    case "doNotContact":
      return c.to === "true" ? "Marcada como No contactar" : "Se quitó No contactar";
  }
}

// ---------- Sugerencias (nunca se aplican solas) ----------

export interface FollowUpSuggestion {
  status?: ConsolidationStatus;
  doNotContact?: boolean;
  closedReason?: ClosedReason;
}

/**
 * Lo que el formulario de seguimiento propone (ya marcado) y quien guarda confirma:
 * primer "contactado" estando Por contactar → En seguimiento;
 * "no desea contacto" → No contactar + Sin continuidad.
 */
export function suggestStatusAfterFollowUp(
  person: Person,
  input: Pick<FollowUpInput, "result">,
  previous: readonly FollowUp[],
): FollowUpSuggestion {
  if (input.result === "no_desea_contacto")
    return { status: "sin_continuidad", doNotContact: true, closedReason: "no_desea_contacto" };
  const firstContact = !previous.some((f) => f.personId === person.id && f.result === "contactado");
  if (input.result === "contactado" && firstContact && person.consolidationStatus === "por_contactar")
    return { status: "en_seguimiento" };
  return {};
}

/** Al registrar una visita de una persona cerrada se sugiere "Reabrir seguimiento". */
export function suggestReopenOnVisit(person: Person): boolean {
  return person.consolidationStatus === "sin_continuidad";
}

// ---------- Validación ----------

export type PersonField = "fullName" | "phone" | "email" | "birthDate" | "initialNotes";

export function validatePerson(input: Partial<PersonInput>, today: Ymd): Partial<Record<PersonField, string>> {
  const e: Partial<Record<PersonField, string>> = {};
  const name = input.fullName?.trim() ?? "";
  if (!name) e.fullName = "Escribe el nombre.";
  else if (name.length > 120) e.fullName = "Máximo 120 caracteres.";
  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone);
    if (!phone.ok) e.phone = phone.reason === "empty" ? "Escribe el teléfono." : "Teléfono no válido. Si es extranjero, escribe el código de país con +.";
  }
  if (input.email && !normalizeEmail(input.email).ok) e.email = "Correo no válido.";
  if (input.birthDate) {
    if (!isValidYmd(input.birthDate)) e.birthDate = "Fecha no válida.";
    else if (compareLocal(input.birthDate, today) > 0) e.birthDate = "La fecha de nacimiento no puede ser futura.";
    else if (ageAt(input.birthDate, today)! > 110) e.birthDate = "Revisa el año de nacimiento.";
  }
  if ((input.initialNotes ?? "").length > 1000) e.initialNotes = "Máximo 1.000 caracteres.";
  return e;
}
