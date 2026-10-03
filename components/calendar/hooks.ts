"use client";

import { useSyncExternalStore } from "react";
import { expandRecurrence } from "@/lib/shared/recurrence";
import type { CalendarEvent, LocalDateTime, Occurrence } from "@/lib/shared/types";

/** Media query reactiva (false en el servidor y donde no existe matchMedia, p. ej. jsdom). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false),
    () => false,
  );
}

export const MOBILE_QUERY = "(max-width: 767px)";
export const WIDE_QUERY = "(min-width: 1280px)";
export const DESKTOP_QUERY = "(min-width: 1024px)";

/** Ocurrencia vigente por clave `${eventId}@${fecha}` (re-derivada del estado actual). */
export function findOccurrence(events: readonly CalendarEvent[], key: string | null, now: LocalDateTime): Occurrence | null {
  if (!key) return null;
  const at = key.lastIndexOf("@");
  const id = key.slice(0, at);
  const date = key.slice(at + 1);
  const e = events.find((x) => x.id === id);
  if (!e) return null;
  return expandRecurrence(e, date, date, now).find((o) => o.date === date) ?? null;
}
