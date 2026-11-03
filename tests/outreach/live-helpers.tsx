import { vi } from "vitest";
import type { EditionSummary } from "@/lib/outreach/client";

/** Fábrica de mock para `@/lib/outreach/client`: conserva lo puro y reemplaza cada llamada por un vi.fn. */
export async function clientMock(orig: () => Promise<Record<string, unknown>>) {
  const real = await orig();
  const fns = [
    "fetchEditions", "fetchMyRegistrations", "fetchEditionRegistrations", "fetchMyDecisions", "editionTransition",
    "importRegistrations", "reviewList", "reviewResolve", "teamCandidates", "tablesList", "tablesSet", "tableLinkIssue",
    "tableLinkRevoke", "confirmAbsences", "distributionPropose", "distributionConfirm", "stats", "contactRecord",
    "doNotContactSet", "decisionList",
  ];
  return { ...real, ...Object.fromEntries(fns.map((f) => [f, vi.fn()])) };
}

export const EDITION: EditionSummary = {
  id: "vplt-2026",
  year: 2026,
  status: "seguimiento",
  revision: 4,
  eventDate: "2026-11-28",
  title: "Ve por los tuyos 2026",
  maxPerOwner: 20,
  editionActive: true,
  receptionOpen: false,
};

export const COORD = "members.outreach.coordinate";
export const FOLLOW = "members.outreach.followup_assigned";
export const DECIDE = "members.outreach.decisions";
