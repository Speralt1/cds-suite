"use client";

// Piezas compartidas del espacio en vivo: carga con estados, errores y avisos.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { OUTREACH_UNEXPECTED_TEXT, toOutreachError } from "@/lib/outreach/client";

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Carga asíncrona con reintento; ignora respuestas de una carga anterior. `loading` se deriva de la clave. */
export function useLoad<T>(fn: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [tick, setTick] = useState(0);
  const key = `${JSON.stringify(deps)}#${tick}`;
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key: "", data: null, error: null });
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    let alive = true;
    ref.current().then(
      (data) => alive && setState({ key, data, error: null }),
      (e) => alive && setState({ key, data: null, error: toOutreachError(e).message || OUTREACH_UNEXPECTED_TEXT }),
    );
    return () => {
      alive = false;
    };
  }, [key]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const fresh = state.key === key;
  return { data: state.data, error: fresh ? state.error : null, loading: !fresh, reload };
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <p className="vp-error" role="alert">
      <AlertTriangle size={16} aria-hidden="true" /> {message}
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </p>
  );
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <p className="vp-small" role="status">
      <Loader2 size={14} aria-hidden="true" /> {label}
    </p>
  );
}

export function Done({ children }: { children: React.ReactNode }) {
  return (
    <p className="vp-result" role="status">
      <CheckCircle2 size={16} aria-hidden="true" /> {children}
    </p>
  );
}

/** Ejecuta una acción con estado de envío y error en español (un solo envío a la vez). */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(toOutreachError(e).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError(null) };
}
