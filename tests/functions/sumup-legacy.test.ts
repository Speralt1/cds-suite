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

// M2 (Slice 1 review round 2): runLegacyPage must use the ORIGINAL production
// field names on sumupIntegrations/offerings (historyCursor,
// historyBackfillStatus, historyBackfillProcessed, historyBackfilledAt,
// liquidSchemaVersion, liquidMigration*), not new ones, so it resumes
// correctly from whatever state already exists in production.
describe("runLegacyPage", () => {
  it("una cuenta nueva (sin liquidSchemaVersion) arranca en modo recalculación y persiste liquidMigrationCursor", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));

    // A fresh integration doc has no liquidSchemaVersion field, so it reads
    // as 1 (< SUMUP_LIQUID_SCHEMA_VERSION=2) and the ORIGINAL production
    // code always runs the liquid-recalculation branch first — see
    // functions/index.js's old syncLegacyPage / fetchLegacyPage.
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
    const integration = store.integrations.get("offerings") as Record<string, unknown>;
    expect(integration.liquidMigrationCursor).toBe("cursor-2");
    expect(integration.liquidMigrationStatus).toBe("processing");
    expect(integration.historyCursor).toBeUndefined();
  });

  it("cuando ya no hay nextCursor marca historyBackfilledAt y liquidSchemaVersion, y no vuelve a crear runs", async () => {
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
    const integration = store.integrations.get("offerings") as Record<string, unknown>;
    expect(integration.historyBackfilledAt).toBeTruthy();
    expect(integration.historyBackfillStatus).toBe("completed");
    expect(integration.liquidSchemaVersion).toBe(2);

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
    expect(result2.runId).toBeNull();
    expect(called).toBe(false);
  });

  it("con liquidSchemaVersion desactualizado retoma desde liquidMigrationCursor aunque ya esté historyBackfilledAt", async () => {
    const store = new MemoryStore();
    const clock = makeClock(Date.parse("2026-09-16T12:00:00Z"));
    await store.setIntegration("offerings", {
      historyBackfilledAt: clock.now() - 1000,
      liquidSchemaVersion: 1,
      liquidMigrationCursor: "resume-here",
    });

    let receivedCursor: string | null | undefined;
    const result = await engine.runLegacyPage({
      account: "offerings",
      config: CONFIG,
      requestedBy: "system",
      fetchPage: async ({ cursor }: { cursor: string | null }) => {
        receivedCursor = cursor;
        return { items: [], nextCursor: null };
      },
      store,
      clock,
    });

    expect(receivedCursor).toBe("resume-here");
    expect(result.status).toBe("completed");
    const integration = store.integrations.get("offerings") as Record<string, unknown>;
    expect(integration.liquidSchemaVersion).toBe(2);
    expect(integration.liquidMigrationStatus).toBe("completed");
  });
});
