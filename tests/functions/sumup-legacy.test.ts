// @vitest-environment node
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { MemoryStore, makeClock } from "./sumup-memory-store";

const require = createRequire(import.meta.url);
const engine = require("../../functions/sumup/engine.js");

const CONFIG = { apiKey: "key", merchantCode: "MC-OFFERINGS" };

function legacyItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "legacy-1",
    transaction_id: "legacy-1",
    amount: 5000,
    refunded_amount: 0,
    currency: "CLP",
    timestamp: "2026-01-05T15:00:00Z",
    status: "SUCCESSFUL",
    payment_type: "POS",
    type: "PAYMENT",
    merchant_code: "MC-OFFERINGS",
    ...overrides,
  };
}

describe("runLegacyPage", () => {
  it("procesa una página, ignora post-split y persiste el cursor si hay más páginas", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));

    const result = await engine.runLegacyPage({
      account: "offerings",
      config: CONFIG,
      requestedBy: "system",
      fetchPage: async () => ({
        items: [legacyItem(), legacyItem({ id: "post-split", transaction_id: "post-split", timestamp: "2026-09-10T15:00:00Z" })],
        nextCursor: "cursor-2",
      }),
      store,
      clock,
    });

    expect(result.status).toBe("partial");
    expect(store.finance.has("sumup_offerings_legacy-1")).toBe(true);
    expect(store.finance.has("sumup_offerings_post-split")).toBe(false);
    expect(store.integrations.get("offerings")?.legacyCursor).toBe("cursor-2");
  });

  it("cuando ya no hay nextCursor marca legacyBackfilledAt y no vuelve a procesar", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));

    const result = await engine.runLegacyPage({
      account: "offerings",
      config: CONFIG,
      requestedBy: "system",
      fetchPage: async () => ({ items: [legacyItem()], nextCursor: null }),
      store,
      clock,
    });
    expect(result.status).toBe("completed");
    expect(store.integrations.get("offerings")?.legacyBackfilledAt).toBeTruthy();

    clock.advance(1000);
    let called = false;
    const result2 = await engine.runLegacyPage({
      account: "offerings",
      config: CONFIG,
      requestedBy: "system",
      fetchPage: async () => {
        called = true;
        return { items: [], nextCursor: null };
      },
      store,
      clock,
    });
    expect(result2.status).toBe("completed");
    expect(called).toBe(false);
  });
});
