"use client";

import { useCallback, useMemo } from "react";
import { DEMO_NOW } from "@/lib/suite-preview/clock";
import { computeAlerts, eligibleOwners } from "@/lib/suite-preview/consolidation";
import { dateOf } from "@/lib/suite-preview/dates";
import { formatPhone } from "@/lib/suite-preview/phone";
import type { Person } from "@/lib/suite-preview/types";
import { useSuite } from "../provider";
import { buildView, type PersonView } from "./model";

/** Datos derivados de Consolidación para las pantallas (se recalculan con el store). */
export function useMembers() {
  const suite = useSuite();
  const { state, eff, toast } = suite;
  const today = dateOf(DEMO_NOW);
  const alerts = useMemo(() => computeAlerts(state, DEMO_NOW, state.settings), [state]);
  const views = useMemo(() => {
    const map = new Map<string, PersonView>();
    for (const p of state.persons) map.set(p.id, buildView(p, state, alerts, today, state.settings));
    return map;
  }, [state, alerts, today]);
  const owners = useMemo(() => eligibleOwners(state.users), [state.users]);
  const canManage = eff.has("members.consolidation.manage");

  /** WhatsApp SIMULADO: nunca se navega a wa.me (los números demo podrían ser reales). */
  const whatsapp = useCallback(
    (p: Person) => toast(`Simulación: se abriría WhatsApp con ${formatPhone(p.phoneE164, p.phoneRaw)}.`),
    [toast],
  );

  return { ...suite, now: DEMO_NOW, today, alerts, views, owners, canManage, whatsapp };
}

export type MembersModel = ReturnType<typeof useMembers>;
