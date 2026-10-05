// Store en memoria con la misma interfaz que functions/members/firestore-store.js
// (getUser, listUsers, getCalendarEvent, findPeople, serverTimestamp,
// runTransaction). Imita lo que importa de Firestore:
// - en una transacción, las lecturas van antes que las escrituras (si no, error);
// - `create` falla si el documento existe y `update` si no existe;
// - las escrituras se aplican solo si la función termina sin error (atómica).

export type Doc = Record<string, unknown>;

type Write = { kind: "create" | "update"; collection: string; id: string; data: Doc };

export class MembersMemoryStore {
  collections = new Map<string, Map<string, Doc>>();
  calls: string[] = [];
  /** Escrituras confirmadas, en orden. */
  commits: Write[][] = [];
  failNextTransaction: Error | null = null;

  constructor(private readonly clock: { now(): number }) {}

  col(name: string): Map<string, Doc> {
    let c = this.collections.get(name);
    if (!c) {
      c = new Map();
      this.collections.set(name, c);
    }
    return c;
  }

  put(collection: string, id: string, data: Doc) {
    this.col(collection).set(id, structuredClone(data));
  }

  doc(collection: string, id: string): Doc | undefined {
    const d = this.col(collection).get(id);
    return d ? structuredClone(d) : undefined;
  }

  all(collection: string): Array<{ id: string; data: Doc }> {
    return [...this.col(collection).entries()].map(([id, data]) => ({ id, data: structuredClone(data) }));
  }

  async getUser(uid: string): Promise<Doc | null> {
    this.calls.push(`getUser:${uid}`);
    return this.doc("users", uid) ?? null;
  }

  async listUsers(): Promise<Array<{ uid: string; data: Doc }>> {
    this.calls.push("listUsers");
    return this.all("users").map(({ id, data }) => ({ uid: id, data }));
  }

  async getCalendarEvent(id: string): Promise<Doc | null> {
    this.calls.push(`getCalendarEvent:${id}`);
    return this.doc("calendarEvents", id) ?? null;
  }

  async findPeople(field: string, value: string, limit: number): Promise<Array<{ id: string; data: Doc }>> {
    this.calls.push(`findPeople:${field}`);
    return this.all("membersPeople")
      .filter(({ data }) => data[field] === value)
      .slice(0, limit);
  }

  serverTimestamp(): Date {
    return new Date(this.clock.now());
  }

  async runTransaction<T>(
    fn: (tx: {
      get(collection: string, id: string): Promise<Doc | null>;
      create(collection: string, id: string, data: Doc): void;
      update(collection: string, id: string, data: Doc): void;
    }) => Promise<T>,
  ): Promise<T> {
    this.calls.push("runTransaction");
    if (this.failNextTransaction) {
      const error = this.failNextTransaction;
      this.failNextTransaction = null;
      throw error;
    }
    const writes: Write[] = [];
    const result = await fn({
      get: async (collection, id) => {
        if (writes.length) throw new Error("Firestore: las lecturas deben ir antes de las escrituras");
        return this.doc(collection, id) ?? null;
      },
      create: (collection, id, data) => {
        writes.push({ kind: "create", collection, id, data: structuredClone(data) });
      },
      update: (collection, id, data) => {
        writes.push({ kind: "update", collection, id, data: structuredClone(data) });
      },
    });
    // Validar todo antes de aplicar (atomicidad).
    const seen = new Set<string>();
    for (const w of writes) {
      const key = `${w.collection}/${w.id}`;
      const exists = this.col(w.collection).has(w.id) || seen.has(key);
      if (w.kind === "create" && exists) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      if (w.kind === "update" && !exists) throw Object.assign(new Error("NOT_FOUND"), { code: 5 });
      if (w.kind === "create") seen.add(key);
    }
    for (const w of writes) {
      const c = this.col(w.collection);
      c.set(w.id, w.kind === "create" ? w.data : { ...c.get(w.id), ...w.data });
    }
    if (writes.length) this.commits.push(writes);
    return result;
  }
}

export const fixedClock = (iso: string) => {
  let now = Date.parse(iso);
  return { now: () => now, advance: (ms: number) => (now += ms), set: (next: string) => (now = Date.parse(next)) };
};
