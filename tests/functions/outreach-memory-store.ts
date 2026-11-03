// Store en memoria con la misma interfaz que functions/outreach/firestore-store.js
// (getUser, get, list, serverTimestamp, runTransaction con get/list/create/set/update/delete).
// Imita lo que importa de Firestore: lecturas antes que escrituras en una
// transacción, `create` falla si existe, `update` si no existe, y las
// escrituras se aplican solo si la función termina sin error.

export type Doc = Record<string, unknown>;
type Where = [string, string, unknown];
type Write = { kind: "create" | "set" | "update" | "delete"; collection: string; id: string; data?: Doc };

export class OutreachMemoryStore {
  collections = new Map<string, Map<string, Doc>>();
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
    return [...this.col(collection).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, data]) => ({ id, data: structuredClone(data) }));
  }

  /** Todos los documentos de todas las colecciones cuyo nombre empieza por el prefijo. */
  allWithPrefix(prefix: string): Array<{ collection: string; id: string; data: Doc }> {
    const out: Array<{ collection: string; id: string; data: Doc }> = [];
    for (const [collection, docs] of this.collections) if (collection.startsWith(prefix)) for (const [id, data] of docs) out.push({ collection, id, data: structuredClone(data) });
    return out;
  }

  async getUser(uid: string): Promise<Doc | null> {
    return this.doc("users", uid) ?? null;
  }

  async get(collection: string, id: string): Promise<Doc | null> {
    return this.doc(collection, id) ?? null;
  }

  private query(collection: string, where: Where[] = [], limit = 100, afterId: string | null = null) {
    return this.all(collection)
      .filter(({ id }) => (afterId ? id > afterId : true))
      .filter(({ data }) => where.every(([f, op, v]) => op === "==" && data[f] === v))
      .slice(0, limit);
  }

  async list(collection: string, opts: { where?: Where[]; limit?: number; afterId?: string | null } = {}) {
    return this.query(collection, opts.where, opts.limit ?? 100, opts.afterId ?? null);
  }

  serverTimestamp(): Date {
    return new Date(this.clock.now());
  }

  async runTransaction<T>(
    fn: (tx: {
      get(collection: string, id: string): Promise<Doc | null>;
      list(collection: string, where: Where[], limit?: number): Promise<Array<{ id: string; data: Doc }>>;
      create(collection: string, id: string, data: Doc): void;
      set(collection: string, id: string, data: Doc): void;
      update(collection: string, id: string, data: Doc): void;
      delete(collection: string, id: string): void;
    }) => Promise<T>,
  ): Promise<T> {
    if (this.failNextTransaction) {
      const error = this.failNextTransaction;
      this.failNextTransaction = null;
      throw error;
    }
    const writes: Write[] = [];
    const noReadAfterWrite = () => {
      if (writes.length) throw new Error("Firestore: las lecturas deben ir antes de las escrituras");
    };
    const result = await fn({
      get: async (collection, id) => {
        noReadAfterWrite();
        return this.doc(collection, id) ?? null;
      },
      list: async (collection, where, limit = 200) => {
        noReadAfterWrite();
        return this.query(collection, where, limit);
      },
      create: (collection, id, data) => void writes.push({ kind: "create", collection, id, data: structuredClone(data) }),
      set: (collection, id, data) => void writes.push({ kind: "set", collection, id, data: structuredClone(data) }),
      update: (collection, id, data) => void writes.push({ kind: "update", collection, id, data: structuredClone(data) }),
      delete: (collection, id) => void writes.push({ kind: "delete", collection, id }),
    });
    // Validar antes de aplicar (atomicidad) y rechazar `undefined` como Firestore.
    const state = new Map<string, boolean>();
    for (const w of writes) {
      const key = `${w.collection}/${w.id}`;
      const exists = state.has(key) ? state.get(key)! : this.col(w.collection).has(w.id);
      if (w.kind === "create" && exists) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      if (w.kind === "update" && !exists) throw Object.assign(new Error("NOT_FOUND"), { code: 5 });
      if (w.data && JSON.stringify(w.data, (_k, v) => (v === undefined ? "__undefined__" : v)).includes('"__undefined__"'))
        throw new Error("Firestore: valor undefined no permitido");
      state.set(key, w.kind !== "delete");
    }
    if (writes.length > 500) throw new Error("Firestore: más de 500 escrituras en una transacción");
    for (const w of writes) {
      const c = this.col(w.collection);
      if (w.kind === "delete") c.delete(w.id);
      else if (w.kind === "update") c.set(w.id, { ...c.get(w.id), ...w.data });
      else c.set(w.id, w.data!);
    }
    if (writes.length) this.commits.push(writes);
    return result;
  }
}

export const fixedClock = (iso: string) => {
  let now = Date.parse(iso);
  return { now: () => now, advance: (ms: number) => (now += ms), set: (next: string) => (now = Date.parse(next)) };
};
