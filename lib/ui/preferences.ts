"use client";

// Preferencias de interfaz de este dispositivo (Design Lock 28 §C3 y §C4):
// - tamaño del texto ("Aa"): normal 100 % · large 110 % · xlarge 125 %;
// - barra lateral en ≥1280: expandida o contraída a rail.
// Se guardan en localStorage (cds.ui.textSize, cds.ui.sidebar) y se reflejan
// en <html data-text-size data-sidebar>. Todo acceso al almacenamiento va en
// try/catch: en una ventana privada sin localStorage la preferencia funciona
// durante la sesión (memoria) y no falla.
// Solo lo usa el shell privado; las rutas públicas no lo importan.

import { useCallback, useSyncExternalStore } from "react";
import {
  SIDEBAR_KEY,
  SIDEBAR_VALUES,
  TEXT_SIZE_KEY,
  TEXT_SIZE_VALUES,
} from "./prepaint";

export type TextSize = (typeof TEXT_SIZE_VALUES)[number];
export type SidebarPref = (typeof SIDEBAR_VALUES)[number];

export const DEFAULT_TEXT_SIZE: TextSize = "normal";
export const DEFAULT_SIDEBAR: SidebarPref = "expanded";

export const TEXT_SIZE_OPTIONS: readonly { value: TextSize; label: string; percent: number }[] = [
  { value: "normal", label: "Normal", percent: 100 },
  { value: "large", label: "Grande", percent: 110 },
  { value: "xlarge", label: "Muy grande", percent: 125 },
];

export function textSizeLabel(value: TextSize): string {
  return TEXT_SIZE_OPTIONS.find((o) => o.value === value)?.label ?? "Normal";
}

/** Valor elegido en esta sesión cuando el almacenamiento no acepta escrituras. */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const value = memory.get(key) ?? readStorage(key);
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function setHtmlAttribute(name: string, value: string) {
  if (typeof document === "undefined") return;
  try {
    document.documentElement.setAttribute(name, value);
  } catch {
    // Sin DOM utilizable: la preferencia igual queda guardada.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function write(key: string, value: string) {
  if (writeStorage(key, value)) memory.delete(key);
  else memory.set(key, value);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Otra pestaña cambió la preferencia: se adopta su valor.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === TEXT_SIZE_KEY || event.key === SIDEBAR_KEY) {
      if (event.key) memory.delete(event.key);
      listener();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function getTextSize(): TextSize {
  return read(TEXT_SIZE_KEY, TEXT_SIZE_VALUES, DEFAULT_TEXT_SIZE);
}

export function applyTextSize(value: TextSize) {
  setHtmlAttribute("data-text-size", value);
}

export function setTextSize(value: TextSize) {
  applyTextSize(value);
  write(TEXT_SIZE_KEY, value);
}

export function getSidebarPref(): SidebarPref {
  return read(SIDEBAR_KEY, SIDEBAR_VALUES, DEFAULT_SIDEBAR);
}

export function applySidebarPref(value: SidebarPref) {
  setHtmlAttribute("data-sidebar", value);
}

export function setSidebarPref(value: SidebarPref) {
  applySidebarPref(value);
  write(SIDEBAR_KEY, value);
}

/** Tamaño del texto actual (en el servidor y la hidratación: "normal"). */
export function useTextSize(): [TextSize, (value: TextSize) => void] {
  const value = useSyncExternalStore(subscribe, getTextSize, () => DEFAULT_TEXT_SIZE);
  return [value, setTextSize];
}

/** Preferencia de la barra lateral en ≥1280 (por defecto expandida). */
export function useSidebarPref(): [SidebarPref, (value: SidebarPref) => void] {
  const value = useSyncExternalStore(subscribe, getSidebarPref, () => DEFAULT_SIDEBAR);
  return [value, setSidebarPref];
}

function rootFontPx(): number {
  try {
    const px = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(px) && px > 0 ? px : 16;
  } catch {
    return 16;
  }
}

/**
 * Píxeles de 1rem en este momento (16 al 100 %, 17,6 al 110 %, 20 al 125 %).
 * Para medidas que una biblioteca exige en px (p. ej. el ancho del eje Y de
 * recharts) y que deben seguir al tamaño del texto.
 */
export function useRemPx(): number {
  return useSyncExternalStore(subscribe, rootFontPx, () => 16);
}

/** Media query reactiva (false en el servidor y donde no existe matchMedia, p. ej. jsdom). */
export function useMediaQuery(query: string): boolean {
  const subscribeMedia = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribeMedia,
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

/** Solo para tests: olvida los valores en memoria. */
export function resetPreferencesForTests() {
  memory.clear();
}
