"use client";

// Avisos del shell (18a §F, 18b §1.2): una sola región role="status" (polite)
// que muestra
// - el AccessNotice del deep link no permitido ("No tienes acceso a … Te
//   llevamos a …"), visible solo en la ruta de destino y que se limpia en el
//   siguiente cambio de ruta;
// - los toasts de confirmación breves (Calendario, Configuración).
// Finanzas sigue usando su `Notice` inline sin cambios.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CircleCheck, Info, X } from "lucide-react";
import { normalizePath } from "@/lib/access/routes";

const TOAST_MS = 4000;

interface AccessNoticeState {
  message: string;
  /** Ruta donde se muestra (destino del redirect). */
  path: string;
}

interface NoticeContextValue {
  toast: (message: string) => void;
  showAccessNotice: (message: string, path: string) => void;
  dismissAccessNotice: () => void;
  accessNotice: AccessNoticeState | null;
  toastMessage: { id: number; message: string } | null;
}

const NoticeContext = createContext<NoticeContextValue | null>(null);

/** Idempotente: si ya hay un NoticeProvider arriba, reutiliza el suyo. */
export function NoticeProvider({ children }: { children: React.ReactNode }) {
  const parent = useContext(NoticeContext);
  if (parent) return children;
  return <NoticeState>{children}</NoticeState>;
}

function NoticeState({ children }: { children: React.ReactNode }) {
  const [accessNotice, setAccessNotice] = useState<AccessNoticeState | null>(null);
  const [toastMessage, setToastMessage] = useState<{ id: number; message: string } | null>(null);
  const seq = useRef(0);

  const toast = useCallback((message: string) => {
    seq.current += 1;
    setToastMessage({ id: seq.current, message });
  }, []);
  const showAccessNotice = useCallback(
    (message: string, path: string) => setAccessNotice({ message, path: normalizePath(path) }),
    [],
  );
  const dismissAccessNotice = useCallback(() => setAccessNotice(null), []);

  useEffect(() => {
    if (!toastMessage) return;
    const id = toastMessage.id;
    const timer = setTimeout(() => setToastMessage((t) => (t?.id === id ? null : t)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const value = useMemo(
    () => ({ toast, showAccessNotice, dismissAccessNotice, accessNotice, toastMessage }),
    [toast, showAccessNotice, dismissAccessNotice, accessNotice, toastMessage],
  );
  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>;
}

const noop = () => {};

/** `toast(message)`: confirmación breve en la región role="status" del shell. */
export function useToast(): { toast: (message: string) => void } {
  const ctx = useContext(NoticeContext);
  const toast = ctx?.toast ?? noop;
  return useMemo(() => ({ toast }), [toast]);
}

/** Para RouteGuard: publica el aviso del deep link no permitido. */
export function useAccessNoticeControl(): {
  showAccessNotice: (message: string, path: string) => void;
  dismissAccessNotice: () => void;
} {
  const ctx = useContext(NoticeContext);
  return useMemo(
    () => ({
      showAccessNotice: ctx?.showAccessNotice ?? noop,
      dismissAccessNotice: ctx?.dismissAccessNotice ?? noop,
    }),
    [ctx?.showAccessNotice, ctx?.dismissAccessNotice],
  );
}

/** La región role="status" única del shell (la renderiza AppShell). */
export function NoticeRegion() {
  const ctx = useContext(NoticeContext);
  const path = normalizePath(usePathname());
  const notice = ctx?.accessNotice ?? null;
  const dismiss = ctx?.dismissAccessNotice;
  const shownOn = useRef<AccessNoticeState | null>(null);
  const visible = !!notice && notice.path === path;

  // Se limpia al navegar después de haberse mostrado en su ruta de destino.
  useEffect(() => {
    if (!notice) {
      shownOn.current = null;
      return;
    }
    if (notice.path === path) shownOn.current = notice;
    else if (shownOn.current === notice) dismiss?.();
  }, [notice, path, dismiss]);

  const toast = ctx?.toastMessage ?? null;

  return (
    <div role="status" aria-live="polite" aria-atomic="false">
      {visible && notice && (
        <div className="mx-auto max-w-7xl px-6 pt-6 sm:px-8 lg:px-12">
          <div className="flex items-start gap-3 rounded-xl border border-info/20 bg-info-soft py-2 pr-2 pl-4 text-sm text-info">
            <Info className="mt-2.5 size-4 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 py-2 leading-6">{notice.message}</p>
            <button
              type="button"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-white/60"
              aria-label="Cerrar aviso"
              onClick={dismiss}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div
          key={toast.id}
          className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-6"
        >
          <p className="pointer-events-auto flex max-w-md items-center gap-2 rounded-xl bg-side px-4 py-3 text-sm font-medium text-white shadow-lg">
            <CircleCheck className="size-4 shrink-0 text-side-accent" aria-hidden="true" />
            {toast.message}
          </p>
        </div>
      )}
    </div>
  );
}
