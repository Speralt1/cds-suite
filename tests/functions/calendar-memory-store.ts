// Store en memoria con la misma interfaz que functions/calendar/firestore-store.js
// (findShareLinkByHash, listPublicEventsFrom, listAreas, getUser,
// shareLinkTransaction). Las "transacciones" son llamadas síncronas sobre
// objetos planos: basta porque los tests no necesitan atomicidad entre procesos.

export type Doc = Record<string, unknown>;

export class CalendarMemoryStore {
  users = new Map<string, Doc>();
  events = new Map<string, Doc>();
  areas = new Map<string, Doc>();
  shareLink: Doc | null = null;
  writes: Doc[] = [];
  calls: string[] = [];

  async findShareLinkByHash(hash: string): Promise<Doc | null> {
    this.calls.push("findShareLinkByHash");
    return this.shareLink && this.shareLink.tokenHash === hash ? structuredClone(this.shareLink) : null;
  }

  async listPublicEventsFrom(from: string): Promise<Doc[]> {
    this.calls.push(`listPublicEventsFrom:${from}`);
    return [...this.events.entries()]
      .filter(([, e]) => e.visibility === "public" && typeof e.lastDate === "string" && e.lastDate >= from)
      .map(([id, e]) => ({ ...structuredClone(e), id }));
  }

  async listAreas(): Promise<Doc[]> {
    this.calls.push("listAreas");
    return [...this.areas.entries()].map(([id, a]) => ({ ...structuredClone(a), id }));
  }

  async getUser(uid: string): Promise<Doc | null> {
    this.calls.push(`getUser:${uid}`);
    const user = this.users.get(uid);
    return user ? structuredClone(user) : null;
  }

  async shareLinkTransaction<T>(fn: (tx: { current: Doc | null; set(data: Doc): void }) => Promise<T> | T): Promise<T> {
    this.calls.push("shareLinkTransaction");
    let pending: Doc | null = null;
    const result = await fn({
      current: this.shareLink ? structuredClone(this.shareLink) : null,
      set: (data) => {
        pending = structuredClone(data);
      },
    });
    if (pending) {
      this.shareLink = pending;
      this.writes.push(structuredClone(pending));
    }
    return result;
  }
}

export const fixedClock = (iso: string) => ({ now: () => Date.parse(iso) });
