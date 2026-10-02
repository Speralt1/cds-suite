"use client";

import { useSyncExternalStore } from "react";

// Lectura de la query SIN useSearchParams (que exige Suspense en el prerender
// estático). En el servidor y durante la hidratación devuelve null; después lee
// window.location y se actualiza con popstate y con cada render.

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(QUERY_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(QUERY_EVENT, onChange);
  };
}

/** Evento propio para avisar cambios de query hechos con history.replaceState. */
export const QUERY_EVENT = "sx:querychange";

export function notifyQueryChange() {
  window.dispatchEvent(new Event(QUERY_EVENT));
}

/** Valor de `?name=` (null en el servidor, al hidratar o si no existe). */
export function useQueryParam(name: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
}

const noop = () => () => {};

/** true después de hidratar (el HTML estático siempre se genera con false). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/** Reemplaza (o quita, con null) un parámetro de la URL actual sin navegar. */
export function replaceQueryParam(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(window.history.state, "", url);
  notifyQueryChange();
}
