"use client";

// Bottom sheet móvil sobre <dialog> nativo (mismo patrón que el `Modal`
// productivo): showModal, Esc cierra y el foco vuelve al control que lo abrió.
// Solo se monta abierto: así su contenido (p. ej. "Cerrar sesión") no se
// duplica en el DOM.

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.hasAttribute("open")) {
      // Sin soporte de showModal (navegadores antiguos, jsdom): abierto no modal.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    return () => {
      if (dialog?.hasAttribute("open")) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      opener?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="m-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border-0 bg-white p-0 pb-[env(safe-area-inset-bottom)] text-ink shadow-[0_-12px_40px_#14231d33] backdrop:bg-[#19302680]"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Clic en el fondo (fuera del contenido) cierra.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line py-2 pr-2 pl-5">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
          aria-label="Cerrar"
          onClick={onClose}
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="px-3 py-3">{children}</div>
    </dialog>
  );
}
