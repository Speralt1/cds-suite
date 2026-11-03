import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createOutreachClock, localToInstant } = require("../../functions/outreach/dev-clock");
const { localNow } = require("../../functions/shared/dates");

const real = { now: () => 1_700_000_000_000 };

describe("reloj de Ve por los tuyos (anulación solo en emulador)", () => {
  it("usa OUTREACH_DEV_NOW con FUNCTIONS_EMULATOR=true", () => {
    const c = createOutreachClock(real, { FUNCTIONS_EMULATOR: "true", OUTREACH_DEV_NOW: "2026-11-28T21:00" });
    expect(localNow(c.now())).toBe("2026-11-28T21:00");
  });
  it("lo ignora si FUNCTIONS_EMULATOR no es true", () => {
    expect(createOutreachClock(real, { OUTREACH_DEV_NOW: "2026-11-28T21:00" })).toBe(real);
    expect(createOutreachClock(real, { FUNCTIONS_EMULATOR: "false", OUTREACH_DEV_NOW: "2026-11-28T21:00" })).toBe(real);
  });
  it("ignora valores inválidos", () => {
    for (const v of ["", "mañana", "2026-13-01T10:00", "2026-11-28 21:00", "2026-11-28T25:00"]) {
      expect(localToInstant(v)).toBeNull();
      expect(createOutreachClock(real, { FUNCTIONS_EMULATOR: "true", OUTREACH_DEV_NOW: v })).toBe(real);
    }
  });
});
