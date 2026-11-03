// SIMULACIÓN · datos 100 % ficticios para pruebas y para revisar la interfaz en
// desarrollo local (NEXT_PUBLIC_CDS_OUTREACH_SIM=1). Nunca debe llegar a la
// build productiva: check:no-preview prohíbe el marcador de abajo, los
// teléfonos +56900000 y el dominio @example.test.
export const OUTREACH_SIM_MARKER = "outreach-sim-fixture";

import { EMPTY_FOLLOW_UP, type ConsentRecord, type DecisionRecord, type Edition, type Registration, type TeamMember } from "../model";
import { TABLE_CONSENT_VERSION, type EventTable } from "../tables";

const FIRST = ["Ana", "Benjamín", "Camila", "Diego", "Elena", "Felipe", "Gabriela", "Héctor", "Isidora", "Joaquín", "Karen", "Luis", "Marta", "Nicolás", "Olga", "Pablo", "Rosa", "Sebastián", "Teresa", "Valentina"];
const LAST = ["Araya", "Bravo", "Castro", "Díaz", "Espinoza", "Fuentes", "González", "Herrera", "Ibáñez", "Jara", "Lagos", "Muñoz", "Navarro", "Orellana", "Pizarro", "Quiroga", "Rojas", "Soto", "Tapia", "Vera"];

/** PRNG determinista (mulberry32): mismas semillas, mismos datos. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SIM_EDITION: Edition = Object.freeze({
  id: "vplt-2026",
  year: 2026,
  title: "Ve por los tuyos 2026",
  eventDate: "2026-11-28",
  status: "seguimiento",
  calendarEventId: null,
  maxPerOwner: 20,
  teamCopiedFrom: "vplt-2025",
}) as Edition;

export function simTeam(owners = 15): TeamMember[] {
  const team: TeamMember[] = [
    { uid: "sim-coord", displayName: "Coordinación (ficticia)", roles: ["coordinacion"], active: true, maxAssigned: null },
    { uid: "sim-recep-1", displayName: "Recepción 1 (ficticia)", roles: ["recepcion"], active: true, maxAssigned: null },
    { uid: "sim-recep-2", displayName: "Recepción 2 (ficticia)", roles: ["recepcion"], active: true, maxAssigned: null },
  ];
  for (let i = 1; i <= owners; i++) {
    const n = String(i).padStart(2, "0");
    team.push({ uid: `sim-resp-${n}`, displayName: `${FIRST[(i * 7) % 20]} ${LAST[(i * 3) % 20]} (R${n})`, roles: ["responsable"], active: true, maxAssigned: null });
  }
  return team;
}

const consent = (purpose: ConsentRecord["purpose"]): ConsentRecord => ({
  purpose,
  grantedAt: "2026-11-10T19:00",
  source: "formulario_web",
  textVersion: "web-2026-1",
  revokedAt: null,
});

export interface SimOptions {
  count?: number;
  seed?: number;
  editionId?: string;
}

/** Padrón ficticio sin asistencia ni asignaciones (estado previo al evento). */
export function simRegistrations({ count = 300, seed = 2026, editionId = SIM_EDITION.id }: SimOptions = {}): Registration[] {
  const rand = rng(seed);
  const out: Registration[] = [];
  for (let i = 1; i <= count; i++) {
    const n = String(i).padStart(3, "0");
    const first = FIRST[Math.floor(rand() * FIRST.length)];
    const last = `${LAST[Math.floor(rand() * LAST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
    const day = 1 + Math.floor((i / count) * 27);
    const consents = [consent("seguimiento_evento")];
    if (rand() < 0.85) consents.push(consent("mensajes_whatsapp"));
    if (rand() < 0.7) consents.push(consent("traspaso_consolidacion"));
    out.push({
      id: `${editionId}_web_sim${n}`,
      editionId,
      identityId: null,
      source: "web",
      externalRef: { system: "vplt-web", id: `sim${n}`, sourceRevision: i },
      fullName: `${first} ${last}`,
      // Teléfono ficticio (prefijo bloqueado en producción); 1 de cada 25 sin teléfono.
      phoneE164: i % 25 === 0 ? null : `+56900000${n}`,
      email: i % 3 === 0 ? `persona${n}@example.test` : null,
      invitedByName: rand() < 0.6 ? `${FIRST[Math.floor(rand() * FIRST.length)]} (invitante ficticio)` : null,
      status: "activa",
      duplicateOf: null,
      attendance: "sin_confirmar",
      attendanceAt: null,
      attendanceBy: null,
      consents,
      doNotContact: false,
      ownerUid: null,
      assignmentBatchId: null,
      locallyEdited: [],
      followUp: { ...EMPTY_FOLLOW_UP },
      memberPersonId: null,
      handedOffAt: null,
      tableNumber: null,
      // Código corto de la entrada (ficticio), como el que muestra el QR del sitio.
      ticketCode: `VP${n}`,
      createdAt: `2026-11-${String(day).padStart(2, "0")}T12:00`,
      revision: 1,
    });
  }
  return out;
}

/**
 * Escenario doc 38 §7: de 300, 240 asisten, 40 ausencias confirmadas y 20 sin
 * confirmar. Determinista: los índices se eligen por semilla.
 */
export function withAttendance(regs: readonly Registration[], { attended = 240, absent = 40, seed = 7 } = {}): Registration[] {
  const rand = rng(seed);
  const order = regs.map((r, i) => ({ i, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.i);
  const next = regs.map((r) => ({ ...r }));
  order.forEach((idx, pos) => {
    const r = next[idx];
    if (pos < attended) Object.assign(r, { attendance: "asistio", attendanceAt: "2026-11-28T19:40", attendanceBy: "sim-recep-1", revision: r.revision + 1 });
    else if (pos < attended + absent) Object.assign(r, { attendance: "no_asistio", attendanceAt: "2026-11-28T23:00", attendanceBy: "sim-coord", revision: r.revision + 1 });
  });
  return next;
}

/** 35 mesas, cada una con su encargado (responsable del seguimiento de su mesa). */
export function simTables(team: readonly TeamMember[]): EventTable[] {
  return team
    .filter((m) => m.roles.includes("responsable"))
    .map((m, i) => ({ number: i + 1, leaderUid: m.uid, leaderName: m.displayName, linkHash: `sim-hash-${i + 1}`, linkRevokedAt: null }));
}

/** Reparte a quienes asistieron entre las mesas (como quedarían sentados). */
export function withTables(regs: readonly Registration[], tables: readonly EventTable[]): Registration[] {
  let k = 0;
  return regs.map((r) => (r.attendance === "asistio" ? { ...r, tableNumber: tables[k++ % tables.length].number } : r));
}

/** Marcas ficticias de la noche del evento: ~1 de cada 3 aceptó, ~1 de cada 8 quiere conversar. */
export function simDecisions(regs: readonly Registration[], seed = 11): DecisionRecord[] {
  const rand = rng(seed);
  const out: DecisionRecord[] = [];
  for (const r of regs) {
    if (r.tableNumber == null) continue;
    const x = rand();
    const value = x < 0.33 ? "acepto_a_cristo" : x < 0.45 ? "desea_conversar" : null;
    if (!value) continue;
    out.push({
      registrationId: r.id,
      editionId: r.editionId,
      value,
      declaredBy: "la_persona",
      consentTextVersion: TABLE_CONSENT_VERSION,
      recordedAt: "2026-11-28T20:30",
      recordedBy: `mesa-${r.tableNumber}`,
      tableNumber: r.tableNumber,
    });
  }
  return out;
}
