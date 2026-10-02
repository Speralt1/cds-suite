"use client";

// Controlador de los sheets/diálogos de una actividad (detalle → editar,
// cancelar, eliminar). Un solo diálogo abierto a la vez; al cerrar uno por
// cambio de modo no se pisa el siguiente (setMode funcional por tipo).

import { useCallback, useState } from "react";
import { DEMO_NOW, DEMO_TODAY } from "@/lib/suite-preview/clock";
import { isRecurring } from "@/lib/suite-preview/recurrence";
import type { Occurrence, Ymd } from "@/lib/suite-preview/types";
import { useSuite } from "../provider";
import { ArchiveEventDialog, CancelEventDialog, EditRecurringDialog } from "./event-dialogs";
import { EventDetailSheet } from "./event-detail";
import { EventFormSheet } from "./event-form";
import { findOccurrence } from "./hooks";
import { eventActions } from "./permissions";

type Mode =
  | { kind: "none" }
  | { kind: "detail"; key: string }
  | { kind: "editChoice"; key: string }
  | { kind: "form"; eventId: string | null; returnKey?: string }
  | { kind: "cancel"; key: string }
  | { kind: "archive"; key: string };

export interface EventSheetsApi {
  openDetail: (o: Occurrence) => void;
  openCreate: () => void;
  openEdit: (o: Occurrence) => void;
  openCancel: (o: Occurrence) => void;
  openArchive: (o: Occurrence) => void;
  sheets: React.ReactNode;
}

export function useEventSheets({
  defaultDate,
  onCreated,
}: {
  defaultDate: Ymd;
  onCreated?: (info: { id: string; startDate: Ymd }) => void;
}): EventSheetsApi {
  const { state, profile } = useSuite();
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const closeIf = useCallback((kind: Mode["kind"]) => () => setMode((m) => (m.kind === kind ? { kind: "none" } : m)), []);

  const key = "key" in mode ? mode.key : mode.kind === "form" ? (mode.returnKey ?? null) : null;
  const occurrence = findOccurrence(state.events, key, DEMO_NOW);
  const actions = occurrence ? eventActions(profile, occurrence, state.areas, DEMO_TODAY) : null;
  const formEvent = mode.kind === "form" && mode.eventId ? (state.events.find((e) => e.id === mode.eventId) ?? null) : null;

  const openEdit = useCallback(
    (o: Occurrence) => setMode(isRecurring(o.event) ? { kind: "editChoice", key: o.key } : { kind: "form", eventId: o.eventId, returnKey: o.key }),
    [],
  );

  const sheets = (
    <>
      <EventDetailSheet
        occurrence={occurrence}
        open={mode.kind === "detail"}
        onClose={closeIf("detail")}
        profile={profile}
        areas={state.areas}
        users={state.users}
        today={DEMO_TODAY}
        onEdit={openEdit}
        onCancel={(o) => setMode({ kind: "cancel", key: o.key })}
        onArchive={(o) => setMode({ kind: "archive", key: o.key })}
      />
      <EditRecurringDialog
        open={mode.kind === "editChoice"}
        onClose={() => setMode((m) => (m.kind === "editChoice" ? { kind: "detail", key: m.key } : m))}
        onContinue={() => setMode((m) => (m.kind === "editChoice" ? { kind: "form", eventId: m.key.slice(0, m.key.lastIndexOf("@")), returnKey: m.key } : m))}
      />
      <EventFormSheet
        open={mode.kind === "form"}
        onClose={closeIf("form")}
        event={formEvent}
        defaultDate={defaultDate}
        onSaved={(info) => {
          const wasEdit = mode.kind === "form" && !!mode.eventId;
          const returnKey = mode.kind === "form" ? mode.returnKey : undefined;
          if (wasEdit && returnKey) setMode({ kind: "detail", key: returnKey });
          else setMode({ kind: "none" });
          if (!wasEdit) onCreated?.(info);
        }}
      />
      <CancelEventDialog
        occurrence={mode.kind === "cancel" ? occurrence : null}
        open={mode.kind === "cancel"}
        onClose={() => setMode((m) => (m.kind === "cancel" ? { kind: "detail", key: m.key } : m))}
        onDone={() => setMode((m) => (m.kind === "cancel" ? { kind: "detail", key: m.key } : m))}
        canThisDate={!!actions?.canCancelThisDate}
        canSeries={!!actions?.canCancelSeries}
      />
      <ArchiveEventDialog
        occurrence={mode.kind === "archive" ? occurrence : null}
        open={mode.kind === "archive"}
        onClose={() => setMode((m) => (m.kind === "archive" ? { kind: "detail", key: m.key } : m))}
        onDone={() => setMode({ kind: "none" })}
      />
    </>
  );

  return {
    openDetail: useCallback((o: Occurrence) => setMode({ kind: "detail", key: o.key }), []),
    openCreate: useCallback(() => setMode({ kind: "form", eventId: null }), []),
    openEdit,
    openCancel: useCallback((o: Occurrence) => setMode({ kind: "cancel", key: o.key }), []),
    openArchive: useCallback((o: Occurrence) => setMode({ kind: "archive", key: o.key }), []),
    sheets,
  };
}
