// @vitest-environment node
// Paridad TS ↔ CJS: los mismos vectores por el TS importado (cliente) y por el
// CommonJS generado (Functions) dan exactamente lo mismo.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as accessTs from "@/lib/shared/access";
import * as coreTs from "@/lib/shared/calendar-core";
import * as datesTs from "@/lib/shared/dates";
import * as publicTs from "@/lib/shared/public-calendar";
import * as recurrenceTs from "@/lib/shared/recurrence";
import * as tokenTs from "@/lib/shared/share-token-format";
import * as typesTs from "@/lib/shared/types";
import { AREAS, EVENTS, NOW, TODAY } from "../platform/public-calendar-fixtures";

const require = createRequire(import.meta.url);
const accessJs = require("../../functions/shared/access.js") as typeof accessTs;
const coreJs = require("../../functions/shared/calendar-core.js") as typeof coreTs;
const datesJs = require("../../functions/shared/dates.js") as typeof datesTs;
const publicJs = require("../../functions/shared/public-calendar.js") as typeof publicTs;
const recurrenceJs = require("../../functions/shared/recurrence.js") as typeof recurrenceTs;
const tokenJs = require("../../functions/shared/share-token-format.js") as typeof tokenTs;
const typesJs = require("../../functions/shared/types.js") as typeof typesTs;

const USER_DOCS: unknown[] = [
  null,
  { role: "admin", active: true },
  { role: "pastor", active: true },
  { role: "finance", active: true },
  { role: "leader", active: true },
  { role: "leader", active: false },
  { role: "member", active: true },
  { accessSchemaVersion: 1, role: "leader", active: true, baseRole: "standard", permissions: ["calendar.read"], homeModule: "finance" },
  {
    accessSchemaVersion: 1,
    role: "leader",
    active: true,
    baseRole: "standard",
    permissions: ["calendar.events.publish_assigned", "settings.manage", "x"],
    areaIds: ["jovenes"],
    homeModule: "calendar",
  },
  { accessSchemaVersion: 1, role: "admin", active: true, baseRole: "admin", permissions: [], homeModule: "calendar" },
];

describe("paridad TS ↔ CJS", () => {
  it("constantes", () => {
    expect(typesJs.PERMISSIONS).toEqual(typesTs.PERMISSIONS);
    expect(typesJs.STORABLE_PERMISSIONS).toEqual(typesTs.STORABLE_PERMISSIONS);
    expect(typesJs.AREA_COLORS).toEqual(typesTs.AREA_COLORS);
    expect(accessJs.IMPLIES).toEqual(accessTs.IMPLIES);
    expect(accessJs.LEGACY_ROLE_ACCESS).toEqual(accessTs.LEGACY_ROLE_ACCESS);
    expect(accessJs.MODULE_HREF).toEqual(accessTs.MODULE_HREF);
    expect(publicJs.PUBLIC_EVENT_KEYS).toEqual(publicTs.PUBLIC_EVENT_KEYS);
    expect(publicJs.PUBLIC_AREA_KEYS).toEqual(publicTs.PUBLIC_AREA_KEYS);
    expect(publicJs.PUBLIC_CALENDAR_KEYS).toEqual(publicTs.PUBLIC_CALENDAR_KEYS);
    expect(String(tokenJs.SHARE_TOKEN_RE)).toBe(String(tokenTs.SHARE_TOKEN_RE));
  });

  it("acceso: permisos, módulos, aterrizaje y planner", () => {
    for (const doc of USER_DOCS) {
      const d = doc as accessTs.UserAccessDoc;
      expect(accessJs.effectivePermissions(d)).toEqual(accessTs.effectivePermissions(d));
      expect(accessJs.normalizeAccess(d)).toEqual(accessTs.normalizeAccess(d));
      expect(accessJs.visibleModules(d)).toEqual(accessTs.visibleModules(d));
      expect(accessJs.resolveHome(d)).toEqual(accessTs.resolveHome(d));
      expect(accessJs.can(d, "calendar.events.manage_all")).toBe(accessTs.can(d, "calendar.events.manage_all"));
      expect(accessJs.can(d, "finance.records.manage")).toBe(accessTs.can(d, "finance.records.manage"));
      if (d) {
        for (const pastorHome of ["finance", "calendar"] as const) {
          expect(accessJs.planAccessMigration("u1", d, { pastorHome })).toEqual(accessTs.planAccessMigration("u1", d, { pastorHome }));
        }
      }
    }
    expect(accessJs.deriveLegacyRole("standard", ["finance.records.manage"])).toBe("finance");
  });

  it("fechas y recurrencia", () => {
    for (const iso of ["2027-04-04T03:00:00Z", "2027-09-05T04:00:00Z", "2026-10-01T02:30:00Z"]) {
      expect(datesJs.localNow(new Date(iso))).toBe(datesTs.localNow(new Date(iso)));
    }
    for (const e of EVENTS) {
      expect(recurrenceJs.expandRecurrence(e, "2026-09-01", "2027-04-30", NOW)).toEqual(
        recurrenceTs.expandRecurrence(e, "2026-09-01", "2027-04-30", NOW),
      );
      if (e.recurrence.freq !== "none") {
        expect(recurrenceJs.validateRecurrence(e.recurrence, e.startDate, e.endDate)).toEqual(
          recurrenceTs.validateRecurrence(e.recurrence, e.startDate, e.endDate),
        );
      }
      expect(coreJs.lastDateOf(e)).toBe(coreTs.lastDateOf(e));
    }
    expect(coreJs.occurrencesInRange(EVENTS, "2026-10-01", "2026-10-31", NOW, AREAS)).toEqual(
      coreTs.occurrencesInRange(EVENTS, "2026-10-01", "2026-10-31", NOW, AREAS),
    );
  });

  it("proyección pública idéntica", () => {
    const input = { events: EVENTS, areas: AREAS, today: TODAY, now: NOW };
    expect(publicJs.buildPublicCalendar(input)).toEqual(publicTs.buildPublicCalendar(input));
    expect(JSON.stringify(publicJs.buildPublicCalendar(input))).toBe(JSON.stringify(publicTs.buildPublicCalendar(input)));
    expect(publicJs.publicRange("2027-01-31")).toEqual(publicTs.publicRange("2027-01-31"));
    expect(publicJs.fnv1a64("ev-culto@2026-10-04")).toBe(publicTs.fnv1a64("ev-culto@2026-10-04"));
  });

  it("formato del token", () => {
    for (const t of ["a".repeat(43), "a".repeat(42), `${"a".repeat(42)}=`, `${"A".repeat(40)}-_9`, 42, null]) {
      expect(tokenJs.isWellFormedShareToken(t)).toBe(tokenTs.isWellFormedShareToken(t));
    }
  });
});
