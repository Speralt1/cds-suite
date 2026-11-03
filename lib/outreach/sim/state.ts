// SIMULACIÓN · estado del espacio de trabajo «Ve por los tuyos» para revisar la
// interfaz en local. Usa las MISMAS funciones de dominio que usará el backend;
// solo reemplaza Firestore por memoria. Marcador de exclusión: ver fixtures.ts.
import { confirmBatch, moveInProposal, proposeDistribution, type BatchResult, type DistributionProposal } from "../distribution";
import { changeAttendance, pendingAttendance, recordContact, type Edition, type EventContact, type Registration, type TeamMember } from "../model";
import { applyInbound, type InboundRegistration, type ReviewItem, type SyncReport, type SyncState } from "../sync";
import { addAtTable, markAtTable, seatAtTable, tableAffinity, unmarkAtTable, type EventTable, type TableMark } from "../tables";
import type { DecisionRecord } from "../model";
import { OUTREACH_SIM_MARKER, SIM_EDITION, simDecisions, simRegistrations, simTables, simTeam, withAttendance, withTables } from "./fixtures";

export { OUTREACH_SIM_MARKER };

export const SIM_TODAY = "2026-11-30";
/** Reloj de la vista Mesa: la noche del evento. */
export const SIM_TABLE_NOW = "2026-11-28T21:00";

export interface PastEdition {
  edition: Edition;
  totals: { registered: number; attended: number; handedOff: number; optedOut: number };
}

export interface SimState {
  edition: Edition;
  team: TeamMember[];
  sync: SyncState;
  lastSync: { at: string; report: SyncReport } | null;
  proposal: DistributionProposal | null;
  lastBatch: BatchResult | null;
  contacts: EventContact[];
  tables: EventTable[];
  decisions: DecisionRecord[];
  past: PastEdition[];
  /** Último error de una acción (texto corto para la interfaz). */
  error: string | null;
}

export type SimAction =
  | { type: "sync-web" }
  | { type: "confirm-absences"; ids: string[] }
  | { type: "propose" }
  | { type: "move"; registrationId: string; toUid: string; note?: string }
  | { type: "confirm-batch" }
  | { type: "discard-proposal" }
  | { type: "contact"; contact: EventContact }
  | { type: "table-mark"; table: number; registrationId: string; mark: TableMark; moveHere?: boolean }
  | { type: "table-seat"; table: number; registrationId: string; moveHere?: boolean }
  | { type: "table-unmark"; table: number; registrationId: string }
  | { type: "table-add"; table: number; fullName: string; phone: string; requestId: string }
  | { type: "clear-error" };

export function initialSimState(): SimState {
  const team = simTeam(35);
  const tables = simTables(team);
  const registrations = withTables(withAttendance(simRegistrations()), tables);
  const seen: Record<string, number> = {};
  for (const r of registrations) if (r.externalRef) seen[r.externalRef.id] = r.externalRef.sourceRevision;
  return {
    edition: { ...SIM_EDITION },
    team,
    sync: { editionId: SIM_EDITION.id, editionClosed: false, registrations, seen, cursor: registrations.length, review: [] },
    lastSync: null,
    proposal: null,
    lastBatch: null,
    contacts: [],
    tables,
    decisions: simDecisions(registrations),
    past: [
      {
        edition: { ...SIM_EDITION, id: "vplt-2025", year: 2025, title: "Ve por los tuyos 2025", eventDate: "2025-11-29", status: "cerrada", teamCopiedFrom: null },
        totals: { registered: 214, attended: 171, handedOff: 58, optedOut: 19 },
      },
    ],
    error: null,
  };
}

/** Lote web ficticio: 6 altas, 1 corrección, 1 cancelación, 1 posible duplicado y 1 con teléfono inválido. */
function webBatch(state: SimState): InboundRegistration[] {
  const base = state.sync.cursor;
  const mk = (n: number, over: Partial<InboundRegistration>): InboundRegistration => ({
    externalId: `sim${String(n).padStart(3, "0")}`,
    sourceRevision: base + n,
    editionYear: state.edition.year,
    fullName: `Persona Nueva ${n}`,
    phone: `+56900000${String(500 + n).padStart(3, "0")}`,
    email: null,
    invitedByName: null,
    adultConfirmed: true,
    consents: [{ purpose: "seguimiento_evento", textVersion: "web-2026-1", grantedAt: "2026-11-29T10:00" }],
    cancelled: false,
    attendedAt: null,
    ...over,
  });
  const first = state.sync.registrations[0];
  const second = state.sync.registrations[1];
  const batch: InboundRegistration[] = [];
  for (let i = 1; i <= 6; i++) batch.push(mk(400 + i, { externalId: `sim${400 + i + base}` }));
  batch.push({ ...mk(1, {}), externalId: first.externalRef?.id ?? "sim001", fullName: `${first.fullName} (corregido)`, phone: first.phoneE164 });
  batch.push({ ...mk(2, {}), externalId: second.externalRef?.id ?? "sim002", cancelled: true });
  batch.push(mk(3, { externalId: `dup${base}`, fullName: state.sync.registrations[5].fullName, phone: state.sync.registrations[5].phoneE164 }));
  batch.push(mk(4, { externalId: `bad${base}`, phone: "123" }));
  return batch.map((r, i) => ({ ...r, sourceRevision: base + 1 + i }));
}

export function simReducer(state: SimState, action: SimAction): SimState {
  switch (action.type) {
    case "sync-web": {
      const { state: sync, report } = applyInbound(state.sync, webBatch(state), { now: `${SIM_TODAY}T09:00` });
      return { ...state, sync, lastSync: { at: `${SIM_TODAY}T09:00`, report } };
    }
    case "confirm-absences": {
      const regs = state.sync.registrations.map((r) => {
        if (!action.ids.includes(r.id)) return r;
        const res = changeAttendance(r, state.edition, { to: "no_asistio", at: `${SIM_TODAY}T09:05`, by: "sim-coord" });
        return res.ok ? res.value : r;
      });
      return { ...state, sync: { ...state.sync, registrations: regs } };
    }
    case "propose":
      return {
        ...state,
        proposal: proposeDistribution(state.sync.registrations, state.team, {
          editionId: state.edition.id,
          batchId: `lote-${state.contacts.length}-${state.sync.cursor}`,
          defaultMax: state.edition.maxPerOwner,
          // Cada persona va con el encargado de su mesa; el resto lo reparte el equilibrio.
          affinity: tableAffinity(state.sync.registrations, state.tables),
        }),
        lastBatch: null,
      };
    case "move": {
      if (!state.proposal) return state;
      const res = moveInProposal(state.proposal, action.registrationId, action.toUid, action.note);
      return res.ok ? { ...state, proposal: res.value, error: null } : { ...state, error: res.error };
    }
    case "confirm-batch": {
      if (!state.proposal) return state;
      const { registrations, result } = confirmBatch(state.sync.registrations, state.proposal);
      return { ...state, sync: { ...state.sync, registrations }, lastBatch: result, proposal: null };
    }
    case "discard-proposal":
      return { ...state, proposal: null };
    case "contact": {
      let error: string | null = null;
      const regs = state.sync.registrations.map((r: Registration) => {
        if (r.id !== action.contact.registrationId) return r;
        const res = recordContact(r, state.edition, action.contact);
        if (!res.ok) error = res.error;
        return res.ok ? res.value : r;
      });
      return error
        ? { ...state, error }
        : { ...state, error: null, contacts: [...state.contacts, action.contact], sync: { ...state.sync, registrations: regs } };
    }
    case "table-mark": {
      const table = state.tables.find((t) => t.number === action.table);
      if (!table) return state;
      const res = markAtTable(
        { registrations: state.sync.registrations, decisions: state.decisions },
        { table, eventDate: state.edition.eventDate, registrationId: action.registrationId, mark: action.mark, personAgreed: true, moveHere: action.moveHere, now: SIM_TABLE_NOW },
      );
      if (!res.ok) return { ...state, error: res.error === "otra_mesa" ? `está en la mesa ${res.otherTable}` : res.error };
      return { ...state, error: null, decisions: res.value.decisions, sync: { ...state.sync, registrations: res.value.registrations } };
    }
    case "table-seat": {
      const table = state.tables.find((t) => t.number === action.table);
      if (!table) return state;
      const res = seatAtTable(
        { registrations: state.sync.registrations, decisions: state.decisions },
        { table, eventDate: state.edition.eventDate, registrationId: action.registrationId, moveHere: action.moveHere, now: SIM_TABLE_NOW },
      );
      if (!res.ok) return { ...state, error: res.error === "otra_mesa" ? `está en la mesa ${res.otherTable}` : res.error };
      return { ...state, error: null, sync: { ...state.sync, registrations: res.value.registrations } };
    }
    case "table-unmark": {
      const table = state.tables.find((t) => t.number === action.table);
      if (!table) return state;
      const res = unmarkAtTable(
        { registrations: state.sync.registrations, decisions: state.decisions },
        { table, eventDate: state.edition.eventDate, registrationId: action.registrationId, now: SIM_TABLE_NOW },
      );
      return res.ok ? { ...state, error: null, decisions: res.value.decisions } : { ...state, error: res.error };
    }
    case "table-add": {
      const table = state.tables.find((t) => t.number === action.table);
      if (!table) return state;
      const res = addAtTable(state.sync.registrations, {
        table,
        eventDate: state.edition.eventDate,
        editionId: state.edition.id,
        fullName: action.fullName,
        phone: action.phone,
        requestId: action.requestId,
        now: SIM_TABLE_NOW,
      });
      return res.ok ? { ...state, error: null, sync: { ...state.sync, registrations: res.value } } : { ...state, error: res.error };
    }
    case "clear-error":
      return { ...state, error: null };
  }
}

export function reviewQueue(state: SimState): ReviewItem[] {
  return state.sync.review;
}

export function unconfirmed(state: SimState): Registration[] {
  return pendingAttendance(state.sync.registrations);
}
