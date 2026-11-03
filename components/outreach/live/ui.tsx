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

export const ISSUE_LABEL: Record<string, string> = {
  posible_duplicado: "Posible duplicado: confirmar si es la misma persona",
  telefono_invalido: "Teléfono no válido en la inscripción",
  correo_invalido: "Correo no válido en la inscripción",
  nombre_requerido: "Inscripción sin nombre",
  conflicto_edicion_local: "La web cambió un dato que coordinación ya corrigió",
  cancelada_con_asistencia: "Cancelada en la web, pero asistió",
  edicion_no_coincide: "La inscripción es de otra edición",
  edicion_cerrada: "Llegó después del cierre de la edición",
  asistencia_revertida_en_origen: "La puerta deshizo un ingreso",
};

/** Texto de un archivo elegido (File.text, o FileReader donde no exista). */
export function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
