"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PERIOD, parsePeriod, periodKey, type Period } from "@/lib/finance-preview/selectors";
import { SuiteToastContext } from "@/components/suite-preview/toast-context";
import { QUERY_EVENT, notifyQueryChange } from "@/components/suite-preview/use-query";

/** Estado forzado de demostración (?estado=cargando|vacio|error) para revisar los estados de §10. */
export type DemoState = "ok" | "loading" | "empty" | "error";

interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

interface PreviewContextValue {
  period: Period;
  setPeriod: (p: Period) => void;
  demoState: DemoState;
  toast: (message: string, undo?: () => void) => void;
  simulate: (what?: string, undo?: () => void) => void;
}

const PreviewContext = createContext<PreviewContextValue | null>(null);

function readQuery(): { period: Period; state: DemoState } {
  if (typeof window === "undefined") return { period: DEFAULT_PERIOD, state: "ok" };
  const q = new URLSearchParams(window.location.search);
  const estado = q.get("estado");
  return {
    period: parsePeriod(q.get("periodo")),
    state: estado === "cargando" ? "loading" : estado === "vacio" ? "empty" : estado === "error" ? "error" : "ok",
  };
}

export function PreviewProvider({ children }: { children: React.ReactNode }) {
  // Dentro de la suite (app/preview/layout.tsx) los toasts van a la región única
  // de SuiteProvider; sin suite (tests de PR #3) se comporta igual que antes.
  const suiteToast = useContext(SuiteToastContext);
  const [period, setPeriodState] = useState<Period>(DEFAULT_PERIOD);
  const [demoState, setDemoState] = useState<DemoState>("ok");
  const [current, setCurrent] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El período y el estado viven en la URL (?periodo=2026-09, ?estado=error);
  // se leen después de hidratar porque el export estático no conoce la query.
  useEffect(() => {
    const sync = () => {
      const q = readQuery();
      // Conserva la misma referencia si el período no cambió: QUERY_EVENT se emite
      // por cualquier cambio de query y no debe re-renderizar a los consumidores.
      setPeriodState((prev) => (periodKey(prev) === periodKey(q.period) ? prev : q.period));
      setDemoState((prev) => (prev === q.state ? prev : q.state));
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener(QUERY_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(QUERY_EVENT, sync);
    };
  }, []);

  const setPeriod = useCallback((p: Period) => {
    setPeriodState(p);
    const url = new URL(window.location.href);
    url.searchParams.set("periodo", periodKey(p));
    // state null: Next copia sus internos y sincroniza su URL canónica.
    window.history.replaceState(null, "", url);
    notifyQueryChange();
  }, []);

  const toast = useCallback(
    (message: string, undo?: () => void) => {
      if (suiteToast) return suiteToast.toast(message, undo);
      if (timer.current) clearTimeout(timer.current);
      setCurrent({ id: Date.now(), message, undo });
      timer.current = setTimeout(() => setCurrent(null), undo ? 6000 : 5000);
    },
    [suiteToast],
  );

  const simulate = useCallback(
    (what?: string, undo?: () => void) =>
      toast(`${what ? `${what}. ` : ""}Simulación: no se guardó nada.`, undo),
    [toast],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(
    () => ({ period, setPeriod, demoState, toast, simulate }),
    [period, setPeriod, demoState, toast, simulate],
  );

  return (
    <PreviewContext.Provider value={value}>
      {children}
      {!suiteToast && (
        <div className="fx-toast-region" role="status" aria-live="polite">
          {current && (
            <div
              className="fx-toast"
              key={current.id}
              onMouseEnter={() => timer.current && clearTimeout(timer.current)}
              onFocus={() => timer.current && clearTimeout(timer.current)}
              onMouseLeave={() => {
                timer.current = setTimeout(() => setCurrent(null), 3000);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span>{current.message}</span>
              {current.undo && (
                <button
                  type="button"
                  onClick={() => {
                    current.undo?.();
                    setCurrent(null);
                  }}
                >
                  Deshacer
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </PreviewContext.Provider>
  );
}

/** null fuera de PreviewProvider (lo usa el shell global para "Registrar"). */
export function usePreviewOptional() {
  return useContext(PreviewContext);
}

export function usePreview() {
  const ctx = useContext(PreviewContext);
  if (!ctx) throw new Error("usePreview debe usarse dentro de PreviewProvider");
  return ctx;
}
