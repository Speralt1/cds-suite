"use client";

// Controlador de los sheets/diálogos de una actividad (detalle → editar,
// cancelar, eliminar, publicar). Un solo diálogo abierto a la vez; la
// ocurrencia se re-deriva del estado en vivo (si cambia en otra sesión, el
// detalle muestra lo último).

import { useCallback, useState } from "react";
import type { CalendarEvent, Occurrence, Ymd } from "@/lib/shared/types";
import { CancelEventDialog, ArchiveEventDialog, VisibilityDialog } from "./event-dialogs";
import { eventActions } from "./event-actions";
import { EventDetailSheet } from "./event-detail";
import { EventFormSheet, type SavedInfo } from "./event-form";
import { findOccurrence } from "./hooks";
import type { CalendarBase } from "./use-calendar-base";

type Mode =
  | { kind: "none" }
  | { kind: "detail"; key: string }
  | { kind: "form"; eventId: string | null; returnKey?: string }
  | { kind: "cancel"; key: string }
  | { kind: "archive"; key: string }
  | { kind: "publish"; key: string }
  | { kind: "unpublish"; key: string };

export interface EventSheetsApi {
  openDetail: (o: Occurrence) => void;
  openCreate: () => void;
  openEdit: (o: Occurrence) => void;
  openCancel: (o: Occurrence) => void;
  openArchive: (o: Occurrence) => void;
  sheets: React.ReactNode;
}

export function useEventSheets({
  base,
  events,
  defaultDate,
  onCreated,
}: {
  base: CalendarBase;
  events: readonly CalendarEvent[];
  defaultDate: Ymd;
  onCreated?: (info: SavedInfo) => void;
}): EventSheetsApi {
  const { actor, areas, today, now, uid, offline, toast } = base;
  const [mode, setMode] = useState<Mode>({ kind: "none" });

  const key = "key" in mode ? mode.key : mode.kind === "form" ? (mode.returnKey ?? null) : null;
  const occurrence = findOccurrence(events, key, now);
  const formEvent = mode.kind === "form" && mode.eventId ? (events.find((e) => e.id === mode.eventId) ?? null) : null;
  const backToDetail = () => setMode((m) => ("key" in m ? { kind: "detail", key: m.key } : { kind: "none" }));
  const done = (message: string, next: Mode = { kind: "none" }) => {
    toast(message);
    setMode(next);
  };

  const openEdit = useCallback((o: Occurrence) => setMode({ kind: "form", eventId: o.eventId, returnKey: o.key }), []);
  const close = () => setMode({ kind: "none" });

  let sheets: React.ReactNode = null;
  if (mode.kind === "detail" && occurrence) {
    sheets = (
      <EventDetailSheet
        occurrence={occurrence}
        onClose={close}
        actor={actor}
        areas={areas}
        today={today}
        uid={uid}
        offline={offline}
        onEdit={openEdit}
        onCancel={(o) => setMode({ kind: "cancel", key: o.key })}
        onArchive={(o) => setMode({ kind: "archive", key: o.key })}
        onPublish={(o) => setMode({ kind: "publish", key: o.key })}
        onUnpublish={(o) => setMode({ kind: "unpublish", key: o.key })}
      />
    );
  } else if (mode.kind === "form" && (!mode.eventId || formEvent)) {
    const returnKey = mode.returnKey;
    sheets = (
      <EventFormSheet
        key={mode.eventId ?? "new"}
        event={formEvent}
        defaultDate={defaultDate}
        actor={actor}
        areas={areas}
        today={today}
        offline={offline}
        onClose={() => setMode(returnKey ? { kind: "detail", key: returnKey } : { kind: "none" })}
        onSaved={(info) => {
          if (info.created) {
            done("Actividad creada.");
            onCreated?.(info);
          } else done("Cambios guardados.", returnKey ? { kind: "detail", key: returnKey } : { kind: "none" });
        }}
      />
    );
  } else if (mode.kind === "cancel" && occurrence) {
    const actions = eventActions(actor, occurrence, areas, today, offline);
    sheets = (
      <CancelEventDialog
        occurrence={occurrence}
        today={today}
        canThisDate={actions.canCancelThisDate}
        canSeries={actions.canCancelSeries}
        onClose={backToDetail}
        onDone={(msg) => done(msg, { kind: "detail", key: occurrence.key })}
      />
    );
  } else if (mode.kind === "archive" && occurrence) {
    sheets = <ArchiveEventDialog occurrence={occurrence} onClose={backToDetail} onDone={(msg) => done(msg)} />;
  } else if ((mode.kind === "publish" || mode.kind === "unpublish") && occurrence) {
    sheets = (
      <VisibilityDialog
        occurrence={occurrence}
        mode={mode.kind}
        onClose={backToDetail}
        onDone={(msg) => done(msg, { kind: "detail", key: occurrence.key })}
      />
    );
  }

  return {
    openDetail: useCallback((o: Occurrence) => setMode({ kind: "detail", key: o.key }), []),
    openCreate: useCallback(() => setMode({ kind: "form", eventId: null }), []),
    openEdit,
    openCancel: useCallback((o: Occurrence) => setMode({ kind: "cancel", key: o.key }), []),
    openArchive: useCallback((o: Occurrence) => setMode({ kind: "archive", key: o.key }), []),
    sheets,
  };
}
